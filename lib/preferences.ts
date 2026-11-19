import { setColorScheme, signal } from 'nsh'
import { setLocale } from 'nsh/i18n'

import * as native from './native'
import type { ColumnKey, Preferences, ResizableColumnKey, ThemeMode } from './types'

const DEFAULT_COLUMN_SIZES = [240, 360]
const RESIZABLE_COLUMN_KEYS: readonly ResizableColumnKey[] = [
  'check',
  'name',
  'category',
  'credentials',
  'contact',
  'notes',
  'actions',
]
/** 默认宽度需与 EntryList 的 colStyle 保持一致，保证老用户无感知。
 *  账号/密码与邮箱/手机号各占两行，所以比旧单列宽；操作按钮全部摊开后也需要位置。 */
const DEFAULT_COLUMN_WIDTHS: Record<ResizableColumnKey, number> = {
  check: 32,
  name: 148,
  category: 64,
  credentials: 148,
  contact: 148,
  notes: 88,
  actions: 232,
}
/** 内容列能压到的最窄宽度（points）—— 表头字号 11px，两个汉字约 22px，
 *  留出余量。这是唯一的真源：拖动范围校验与布局层 minWidth 都用它。 */
const MIN_TWO_CHAR_COLUMN_WIDTH = 28
/** 标题列还带着行首图标（32）和间隙（8），比纯文字列再宽一点。 */
const MIN_NAME_COLUMN_WIDTH = 56
/** 每列的拖动范围。 */
const COLUMN_WIDTH_RANGE: Record<ResizableColumnKey, { min: number; max: number }> = {
  check: { min: 24, max: 56 },
  name: { min: MIN_NAME_COLUMN_WIDTH, max: 480 },
  category: { min: MIN_TWO_CHAR_COLUMN_WIDTH, max: 480 },
  // 存的是基准宽度；表格会在窗口变宽时按比例放大，所以上限留出余量，
  // 避免「放大后再拖一次」被 clamp 回去。
  credentials: { min: 72, max: 960 },
  contact: { min: 72, max: 960 },
  notes: { min: MIN_TWO_CHAR_COLUMN_WIDTH, max: 960 },
  // 行内按钮全部可见，DataTable 固定列至少放得下 8~9 个图标按钮。
  actions: { min: 216, max: 360 },
}
const COLUMN_MIN = 160
const COLUMN_MAX = 640

const DEFAULTS: Preferences = {
  language: null,
  theme: 'system',
  autoLockMinutes: 15,
  updateCheckIntervalDays: 7,
  lastUpdateCheckTs: 0,
  siteIcons: true,
  columnSizes: [...DEFAULT_COLUMN_SIZES],
  visibleColumns: { credentials: true, contact: true, notes: true },
  columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
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

/** 旧宽度映射：两行格取原来两列里较宽的那列再加余量，比直接回落默认值
 *  更接近用户拖过的手感。 */
const LEGACY_WIDTH_KEYS: Partial<Record<ResizableColumnKey, readonly string[]>> = {
  credentials: LEGACY_VISIBLE_KEYS.credentials,
  contact: LEGACY_VISIBLE_KEYS.contact,
}

/** 逐键白名单重建：缺省或非法一律回落默认，并按列范围 clamp。 */
function sanitizeColumnWidths(value: unknown): Record<ResizableColumnKey, number> {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const result = {} as Record<ResizableColumnKey, number>
  for (const key of RESIZABLE_COLUMN_KEYS) {
    const size = Number(raw[key])
    const { min, max } = COLUMN_WIDTH_RANGE[key]
    const legacy = (LEGACY_WIDTH_KEYS[key] ?? [])
      .map((legacyKey) => Number(raw[legacyKey]))
      .filter((width) => Number.isFinite(width) && width > 0)
    const fallback = legacy.length > 0 ? Math.max(...legacy) + 52 : DEFAULT_COLUMN_WIDTHS[key]
    const chosen = Number.isFinite(size) && size > 0 ? size : fallback
    result[key] = Math.max(min, Math.min(max, Math.round(chosen)))
  }
  return result
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
    columnSizes: sanitizeColumns(value.columnSizes),
    visibleColumns: sanitizeVisibleColumns(value.visibleColumns),
    columnWidths: sanitizeColumnWidths(value.columnWidths),
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

/** 某列的拖动范围。拖动时用它约束列宽，保证表头可读。 */
export function columnWidthRange(column: ResizableColumnKey): { min: number; max: number } {
  return COLUMN_WIDTH_RANGE[column]
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
