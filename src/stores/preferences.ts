// 偏好持久化：语言、主题、空闲自动锁定。全部存 localStorage（非敏感配置）。

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { Locale, ThemeMode } from '@/types'

const STORAGE_KEY = 'mend.preferences'
const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')

interface StoredPrefs {
  locale?: Locale
  theme?: ThemeMode
  autoLockMinutes?: number
  /** 自动检查更新间隔（天）：7 = 每周、30 = 每月、365 = 每年。 */
  updateCheckIntervalDays?: number
  /** 上次成功检查更新的时间戳（ms），用于按间隔节流提醒。 */
  lastUpdateCheckTs?: number
}

function readStored(): StoredPrefs {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return {}
  try {
    return JSON.parse(raw) as StoredPrefs
  } catch {
    return {}
  }
}

function detectLocale(stored: StoredPrefs): Locale {
  if (stored.locale === 'zh-CN' || stored.locale === 'en') return stored.locale
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

function computeDark(mode: ThemeMode) {
  return mode === 'dark' || (mode === 'system' && colorScheme.matches)
}

export const usePreferencesStore = defineStore('preferences', () => {
  const stored = readStored()

  const locale = ref<Locale>(detectLocale(stored))
  const theme = ref<ThemeMode>(stored.theme ?? 'system')
  /** 当前是否为深色：Tailwind 的 `.dark` 与 naive-ui 的 darkTheme 都以此为准。 */
  const isDark = ref(computeDark(theme.value))
  /** 空闲自动锁定（分钟），0 = 关闭。 */
  const autoLockMinutes = ref<number>(stored.autoLockMinutes ?? 15)
  /** 自动检查更新间隔（天），默认每周。 */
  const updateCheckIntervalDays = ref<number>(stored.updateCheckIntervalDays ?? 7)
  /** 上次检查更新的时间戳（ms），默认 0（= 首次启动即检查）。 */
  const lastUpdateCheckTs = ref<number>(stored.lastUpdateCheckTs ?? 0)

  /** 把主题应用到 `<html>`，并同步给 NConfigProvider。 */
  function applyTheme(mode: ThemeMode = theme.value) {
    isDark.value = computeDark(mode)
    document.documentElement.classList.toggle('dark', isDark.value)
  }

  watch(
    [locale, theme, autoLockMinutes, updateCheckIntervalDays, lastUpdateCheckTs],
    () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          locale: locale.value,
          theme: theme.value,
          autoLockMinutes: autoLockMinutes.value,
          updateCheckIntervalDays: updateCheckIntervalDays.value,
          lastUpdateCheckTs: lastUpdateCheckTs.value,
        }),
      )
      applyTheme()
    },
    { deep: false },
  )

  function setLocale(next: Locale) {
    locale.value = next
  }

  function setTheme(next: ThemeMode) {
    theme.value = next
  }

  function setAutoLockMinutes(next: number) {
    autoLockMinutes.value = next
  }

  function setUpdateCheckIntervalDays(next: number) {
    updateCheckIntervalDays.value = next
  }

  function setLastUpdateCheckTs(next: number) {
    lastUpdateCheckTs.value = next
  }

  /** 启动时调用：应用已保存的主题，并在 system 模式下跟随系统变化。 */
  function initTheme() {
    applyTheme()
    colorScheme.addEventListener('change', () => {
      if (theme.value === 'system') applyTheme('system')
    })
  }

  return {
    locale,
    theme,
    isDark,
    autoLockMinutes,
    updateCheckIntervalDays,
    lastUpdateCheckTs,
    setLocale,
    setTheme,
    setAutoLockMinutes,
    setUpdateCheckIntervalDays,
    setLastUpdateCheckTs,
    initTheme,
  }
})
