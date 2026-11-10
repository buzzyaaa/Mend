// 复制到剪贴板 + 超时清空：只在剪贴板内容仍是我们写入的那段文字时才清空，
// 避免把用户后来复制的东西一起抹掉；读取被限制时静默跳过（宁可不删）。

import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { usePreferencesStore } from '@/stores/preferences'

export function useClipboard() {
  const toast = useToast()
  const { t } = useI18n()
  const preferences = usePreferencesStore()

  let clearTimer: number | null = null

  function scheduleClear(value: string) {
    if (clearTimer !== null) window.clearTimeout(clearTimer)
    const seconds = preferences.clipboardClearSeconds
    if (!seconds || seconds <= 0) return

    clearTimer = window.setTimeout(async () => {
      clearTimer = null
      try {
        const current = await navigator.clipboard.readText()
        if (!current || current !== value) return
        await navigator.clipboard.writeText('')
        toast.success(t('toast.clipboardCleared'))
      } catch {
        // WebView 拒绝读取剪贴板：不清空，避免误删用户内容
      }
    }, seconds * 1000)
  }

  /** 复制到剪贴板并给出 Toast；返回是否成功。 */
  async function copy(text: string): Promise<boolean> {
    if (!text) return false
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('toast.copied'))
      scheduleClear(text)
      return true
    } catch {
      toast.error(t('toast.copyFailed'))
      return false
    }
  }

  return { copy }
}
