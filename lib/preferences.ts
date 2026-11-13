import { setColorScheme, signal } from 'nsh'
import { Storage } from 'nsh'
import { setLocale } from 'nsh/i18n'

import type { Preferences, ThemeMode } from './types'

const KEY = 'mend.preferences.v1'

const DEFAULTS: Preferences = {
  language: null,
  theme: 'system',
  autoLockMinutes: 15,
  updateCheckIntervalDays: 7,
  lastUpdateCheckTs: 0,
}

export const preferences = signal<Preferences>({ ...DEFAULTS })

function isTheme(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
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
  }
}

export function applyPreferences(next: Preferences): void {
  setColorScheme(next.theme)
  setLocale(next.language)
}

export async function loadPreferences(): Promise<Preferences> {
  let next = { ...DEFAULTS }
  try {
    const raw = await Storage.getItem(KEY)
    if (raw) next = sanitize(JSON.parse(raw))
  } catch {
    next = { ...DEFAULTS }
  }
  preferences.set(next)
  applyPreferences(next)
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

export function setUpdateCheckIntervalDays(days: number): void {
  updatePreferences({ updateCheckIntervalDays: days })
}

export function markUpdateChecked(): void {
  updatePreferences({ lastUpdateCheckTs: Date.now() })
}
