import { setColorScheme, signal } from 'nsh'
import { setLocale } from 'nsh/i18n'

import * as native from './native'
import type { ColumnKey, Preferences, ThemeMode } from './types'

const DEFAULT_COLUMN_SIZES = [240, 360]
const COLUMN_MIN = 160
const COLUMN_MAX = 640
/** 最近使用的数据库最多记这么多个，避免偏好文件无限增长。 */
const MAX_RECENT_VAULTS = 8

const DEFAULTS: Preferences = {
  language: null,
  theme: 'system',
  autoLockMinutes: 15,
  updateCheckIntervalDays: 7,
  lastUpdateCheckTs: 0,
  siteIcons: true,
  recentVaults: [],
  columnSizes: [...DEFAULT_COLUMN_SIZES],
  visibleColumns: { credentials: true, contact: true, notes: true },
}

export const preferences = signal<Preferences>({ ...DEFAULTS })

/** 界面可用的语言。新增语言只需改这里（加上 `locales/<tag>.json`）：
 *  解锁页的悬停语言菜单与设置里的语言下拉都从这里生成。 */
export const LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
]

function isTheme(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

/** Only known columns are persisted; each is clamped to its own range so a
 *  corrupt/old value can never collapse a column or blow up the layout. */
function sanitizeColumns(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 2) return [...DEFAULT_COLUMN_SIZES]
  const sizes = value.slice(0, 3).map(Number)
  if (sizes.some((size) => !Number.isFinite(size) || size <= 0)) {
    return [...DEFAULT_COLUMN_SIZES]
  }
  return sizes.map((size) => Math.max(COLUMN_MIN, Math.min(COLUMN_MAX, size)))
}

/** 旧偏好把四个字段拆成四列；合并后只要其中任一列可见，整格就保留，
 *  避免升级后用户原本要看的字段突然消失。 */
const LEGACY_VISIBLE_KEYS: Readonly<Record<'credentials' | 'contact', readonly string[]>> = {
  credentials: ['username', 'password'],
  contact: ['email', 'phone'],
}

/** 逐键白名单重建：缺省或类型错误一律回落默认全 true。 */
function sanitizeVisibleColumns(value: unknown): Record<ColumnKey, boolean> {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const legacyVisible = (keys: readonly string[]): boolean | undefined => {
    const values = keys.filter((key) => typeof raw[key] === 'boolean').map((key) => raw[key])
    return values.length > 0 ? values.some(Boolean) : undefined
  }
  const result: Record<ColumnKey, boolean> = {
    credentials:
      typeof raw.credentials === 'boolean'
        ? raw.credentials
        : (legacyVisible(LEGACY_VISIBLE_KEYS.credentials) ?? true),
    contact:
      typeof raw.contact === 'boolean'
        ? raw.contact
        : (legacyVisible(LEGACY_VISIBLE_KEYS.contact) ?? true),
    notes: typeof raw.notes === 'boolean' ? raw.notes : true,
  }
  // 列配置菜单也会兜底，但偏好文件本身不该出现「一列都不显示」。
  if (!result.credentials && !result.contact && !result.notes) result.credentials = true
  return result
}

/** 最近库：只留非空字符串、去重（大小写/斜杠不敏感由调用方的路径比较负责），限长。 */
function sanitizeRecentVaults(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || seen.has(item)) continue
    seen.add(item)
    result.push(item)
    if (result.length >= MAX_RECENT_VAULTS) break
  }
  return result
}

/** 把某个库文件提到「最近使用」列表最前；路径为空则忽略。
 *  最多留 MAX_RECENT_VAULTS 个，重复路径移到最前而不是保留旧位置。 */
export function rememberVault(path: string | null | undefined): void {
  if (!path || !path.trim()) return
  const rest = preferences().recentVaults.filter((item) => item !== path)
  updatePreferences({ recentVaults: [path, ...rest].slice(0, MAX_RECENT_VAULTS) })
}

function sanitize(raw: unknown): Preferences {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS }
  const value = raw as Partial<Preferences>
  const autoLock = Number(value.autoLockMinutes)
  const updateDays = Number(value.updateCheckIntervalDays)
  const lastCheck = Number(value.lastUpdateCheckTs)
  return {
    language:
      typeof value.language === 'string' && value.language.trim() ? value.language.trim() : null,
    theme: isTheme(value.theme) ? value.theme : DEFAULTS.theme,
    autoLockMinutes: [0, 1, 5, 10, 15, 30, 60].includes(autoLock)
      ? autoLock
      : DEFAULTS.autoLockMinutes,
    updateCheckIntervalDays: [0, 7, 30, 365].includes(updateDays)
      ? updateDays
      : DEFAULTS.updateCheckIntervalDays,
    lastUpdateCheckTs: Number.isFinite(lastCheck) && lastCheck >= 0 ? lastCheck : 0,
    siteIcons: typeof value.siteIcons === 'boolean' ? value.siteIcons : DEFAULTS.siteIcons,
    recentVaults: sanitizeRecentVaults(value.recentVaults),
    columnSizes: sanitizeColumns(value.columnSizes),
    visibleColumns: sanitizeVisibleColumns(value.visibleColumns),
  }
}

export function applyPreferences(next: Preferences): void {
  setColorScheme(next.theme)
  setLocale(next.language)
}

/** 启动时读回持久化偏好并应用（`boot()` 在 `Vault.init` 之后调用一次：
 *  偏好文件就放在解析出来的数据目录里）。失败一律回退默认值，
 *  绝不让偏好问题阻断启动或把应用推进 Fatal 页。
 *
 *  为什么不用 nsh 的 `Storage`：它把 `storage.json` 写到
 *  `%APPDATA%\com.mend.app`，而被系统以更低权限启动的进程永远写不进去
 *  （写入失败只会进日志），表现为「设置里的语言/主题重启后又变回去」。
 *  数据目录是应用自己解析、并且已经验证过可写的位置。 */
export async function loadPreferences(): Promise<Preferences> {
  let next = { ...DEFAULTS }
  try {
    const raw = await native.loadPreferences()
    if (raw.trim()) next = sanitize(JSON.parse(raw))
  } catch {
    // 读不出来（首次运行 / 文件损坏 / 数据目录未就绪）：回到默认偏好。
    next = { ...DEFAULTS }
  }
  preferences.set(next)
  try {
    applyPreferences(next)
  } catch {
    // 例如存储里的语言标签非法、平台拒绝主题切换：保留读回的偏好值，
    // 只跳过本次应用，不影响启动流程。
  }
  return next
}

export function savePreferences(next: Preferences): void {
  preferences.set(next)
  applyPreferences(next)
  try {
    native.savePreferences(JSON.stringify(next))
  } catch {
    // 偏好不是必需品：写不进去也不影响使用，下次启动用默认值。
  }
}

export function updatePreferences(patch: Partial<Preferences>): Preferences {
  const next = sanitize({ ...preferences(), ...patch })
  savePreferences(next)
  return next
}

export function setTheme(theme: ThemeMode): void {
  updatePreferences({ theme })
}

export function setLanguage(language: string | null): void {
  updatePreferences({ language })
}

export function setAutoLockMinutes(minutes: number): void {
  updatePreferences({ autoLockMinutes: minutes })
}

export function setColumnSizes(sizes: number[]): void {
  updatePreferences({ columnSizes: sizes })
}

export function setColumnVisible(column: ColumnKey, visible: boolean): void {
  updatePreferences({ visibleColumns: { ...preferences().visibleColumns, [column]: visible } })
}

export function setUpdateCheckIntervalDays(days: number): void {
  updatePreferences({ updateCheckIntervalDays: days })
}

/** 网站图标开关：关掉之后不再有任何抓取请求，列表回退到内置图标。 */
export function setSiteIcons(enabled: boolean): void {
  updatePreferences({ siteIcons: enabled })
}

export function markUpdateChecked(): void {
  updatePreferences({ lastUpdateCheckTs: Date.now() })
}
