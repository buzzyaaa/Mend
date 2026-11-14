import { setColorScheme, signal } from 'nsh'
import { Storage } from 'nsh'
import { setLocale } from 'nsh/i18n'

import type { Preferences, ThemeMode } from './types'

const KEY = 'mend.preferences.v1'

const DEFAULT_COLUMN_SIZES = [240, 360]
const COLUMN_MIN = 160
const COLUMN_MAX = 640

const DEFAULTS: Preferences = {
  language: null,
  theme: 'system',
  autoLockMinutes: 15,
  updateCheckIntervalDays: 7,
  lastUpdateCheckTs: 0,
  columnSizes: [...DEFAULT_COLUMN_SIZES],
}

export const preferences = signal<Preferences>({ ...DEFAULTS })

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
  }
}

export function applyPreferences(next: Preferences): void {
  setColorScheme(next.theme)
  setLocale(next.language)
}

/** 启动时读回持久化偏好并应用（`boot()` 在初始化 Vault 之前调用一次）。
 *  Storage 是异步 API，读出后再 set signal；失败一律回退默认值，
 *  绝不让偏好问题阻断启动或把应用推进 Fatal 页。 */
export async function loadPreferences(): Promise<Preferences> {
  let next = { ...DEFAULTS }
  try {
    const raw = await Storage.getItem(KEY)
    if (raw) next = sanitize(JSON.parse(raw))
  } catch {
    // Storage 不可用（平台不支持 / 被拒）或内容损坏：回到默认偏好。
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
  void Storage.setItem(KEY, JSON.stringify(next)).catch(() => {
    // Preferences are non-essential; a full storage does not break the app.
  })
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

export function setUpdateCheckIntervalDays(days: number): void {
  updatePreferences({ updateCheckIntervalDays: days })
}

export function markUpdateChecked(): void {
  updatePreferences({ lastUpdateCheckTs: Date.now() })
}
