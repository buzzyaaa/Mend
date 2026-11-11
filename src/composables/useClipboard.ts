// 复制到剪贴板：仅写入，不做任何后续读取或清空，避免干扰用户剪贴板。
// 之前的"复制后到时自动清空"会因 WebView 静默失败而误导用户，已移除。

import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'

export function useClipboard() {
  const toast = useToast()
  const { t } = useI18n()

  /** 复制到剪贴板并给出 Toast；返回是否成功。 */
  async function copy(text: string): Promise<boolean> {
    if (!text) return false
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('toast.copied'))
      return true
    } catch {
      toast.error(t('toast.copyFailed'))
      return false
    }
  }

  return { copy }
}
