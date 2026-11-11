// 操作反馈统一走 NMessageProvider（在 App.vue 装配），不再维护第二套 Toast 队列。
import { useMessage } from 'naive-ui'

export function useToast() {
  const message = useMessage()
  return {
    success: (text: string) => message.success(text),
    error: (text: string) => message.error(text),
    warning: (text: string) => message.warning(text),
    info: (text: string) => message.info(text),
  }
}
