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
