import { createI18n } from 'vue-i18n'
import zhCN from '@/locales/zh-CN.json'
import en from '@/locales/en.json'
import type { Locale } from '@/types'

const saved = ((): Locale => {
  try {
    const raw = localStorage.getItem('mend.preferences')
    if (raw) {
      const parsed = JSON.parse(raw) as { locale?: Locale }
      if (parsed.locale === 'zh-CN' || parsed.locale === 'en') return parsed.locale
    }
  } catch {
    /* fall through */
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
})()

export const i18n = createI18n({
  legacy: false,
  locale: saved,
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    en,
  },
})

export function setI18nLocale(locale: Locale) {
  i18n.global.locale.value = locale
  document.documentElement.lang = locale === 'zh-CN' ? 'zh-CN' : 'en'
}
