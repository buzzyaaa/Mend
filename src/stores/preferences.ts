// 偏好持久化：语言、主题、空闲自动锁定、剪贴板清空。全部存 localStorage（非敏感配置）。

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { Locale, ThemeMode } from '@/types'

const STORAGE_KEY = 'mend.preferences'

interface StoredPrefs {
  locale?: Locale
  theme?: ThemeMode
  autoLockMinutes?: number
  clipboardClearSeconds?: number
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

/** 把主题应用到 `<html>`：`system` 跟随系统，其余直接切换 `.dark`。 */
function applyTheme(mode: ThemeMode) {
  const dark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export const usePreferencesStore = defineStore('preferences', () => {
  const stored = readStored()

  const locale = ref<Locale>(detectLocale(stored))
  const theme = ref<ThemeMode>(stored.theme ?? 'system')
  /** 空闲自动锁定（分钟），0 = 关闭。 */
  const autoLockMinutes = ref<number>(stored.autoLockMinutes ?? 15)
  /** 复制后自动清空剪贴板（秒），0 = 关闭。 */
  const clipboardClearSeconds = ref<number>(stored.clipboardClearSeconds ?? 30)

  watch(
    [locale, theme, autoLockMinutes, clipboardClearSeconds],
    () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          locale: locale.value,
          theme: theme.value,
          autoLockMinutes: autoLockMinutes.value,
          clipboardClearSeconds: clipboardClearSeconds.value,
        }),
      )
      applyTheme(theme.value)
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

  function setClipboardClearSeconds(next: number) {
    clipboardClearSeconds.value = next
  }

  /** 启动时调用：应用已保存的主题，并在 system 模式下跟随系统变化。 */
  function initTheme() {
    applyTheme(theme.value)
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (theme.value === 'system') applyTheme('system')
    })
  }

  return {
    locale,
    theme,
    autoLockMinutes,
    clipboardClearSeconds,
    setLocale,
    setTheme,
    setAutoLockMinutes,
    setClipboardClearSeconds,
    initTheme,
  }
})
