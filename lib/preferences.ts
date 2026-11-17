import { setColorScheme, signal } from 'nsh'
import { setLocale } from 'nsh/i18n'

import * as native from './native'
import type {
  ColumnKey,
  Preferences,
  ResizableColumnKey,
  ThemeMode,
} from './types'

const DEFAULT_COLUMN_SIZES = [240, 360]
const COLUMN_KEYS: readonly ColumnKey[] = ['username', 'password', 'email', 'phone', 'notes']
const RESIZABLE_COLUMN_KEYS: readonly ResizableColumnKey[] = ['check', 'actions']
/** 默认宽度需与 EntryList 的 COL.check / COL.actions 类保持一致（w-5=20, w-[72px]=72）。 */
const DEFAULT_COLUMN_WIDTHS: Record<ResizableColumnKey, number> = { check: 20, actions: 72 }
const COLUMN_WIDTH_RANGE: Record<ResizableColumnKey, { min: number; max: number }> = {
  check: { min: 16, max: 64 },
  actions: { min: 44, max: 200 },
}
const COLUMN_MIN = 160
const COLUMN_MAX = 640

const DEFAULTS: Preferences = {
  language: null,
  theme: 'system',
  autoLockMinutes: 15,
  updateCheckIntervalDays: 7,
  lastUpdateCheckTs: 0,
  columnSizes: [...DEFAULT_COLUMN_SIZES],
  visibleColumns: { username: true, password: true, email: true, phone: true, notes: true },
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

/** Only the two resizable columns are persisted; clamp to the same range as
 *  the panels so a corrupt/old value can never squeeze the layout. */
function sanitizeColumns(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 2) return [...DEFAULT_COLUMN_SIZES]
  const sizes = value.slice(0, 3).map(Number)
  if (sizes.some((size) => !Number.isFinite(size) || size <= 0)) {
    return [...DEFAULT_COLUMN_SIZES]
  }
  return sizes.map((size) => Math.max(COLUMN_MIN, Math.min(COLUMN_MAX, size)))
}

/** 逐键白名单重建：缺省或类型错误一律回落默认全 true。 */
function sanitizeVisibleColumns(value: unknown): Record<ColumnKey, boolean> {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Record<ColumnKey, unknown>>
  const result = {} as Record<ColumnKey, boolean>
  for (const key of COLUMN_KEYS) {
    result[key] = typeof raw[key] === 'boolean' ? (raw[key] as boolean) : true
  }
  return result
}

/** 逐键白名单重建：缺省或非法一律回落默认，并按列范围 clamp。 */
function sanitizeColumnWidths(value: unknown): Record<ResizableColumnKey, number> {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<
    Record<ResizableColumnKey, unknown>
  >
  const result = {} as Record<ResizableColumnKey, number>
  for (const key of RESIZABLE_COLUMN_KEYS) {
    const size = Number(raw[key])
    const { min, max } = COLUMN_WIDTH_RANGE[key]
    result[key] =
      Number.isFinite(size) && size > 0
        ? Math.max(min, Math.min(max, Math.round(size)))
        : DEFAULT_COLUMN_WIDTHS[key]
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

export function setColumnWidths(widths: Record<ResizableColumnKey, number>): void {
  updatePreferences({ columnWidths: sanitizeColumnWidths(widths) })
}

export function setUpdateCheckIntervalDays(days: number): void {
  updatePreferences({ updateCheckIntervalDays: days })
}

export function markUpdateChecked(): void {
  updatePreferences({ lastUpdateCheckTs: Date.now() })
}
