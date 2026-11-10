import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { Locale } from '@/types'

const STORAGE_KEY = 'mend.preferences'

function detectLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as { locale?: Locale }
      if (parsed.locale === 'zh-CN' || parsed.locale === 'en') return parsed.locale
    } catch {
      /* ignore corrupted storage */
    }
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export const usePreferencesStore = defineStore('preferences', () => {
  const locale = ref<Locale>(detectLocale())
  const theme = ref<'system' | 'light' | 'dark'>('system')

  watch(
    locale,
    (value) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ locale: value, theme: theme.value }))
    },
    { deep: true },
  )

  function setLocale(next: Locale) {
    locale.value = next
  }

  return { locale, theme, setLocale }
})
