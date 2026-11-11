import { ref } from 'vue'
import { useMessage } from 'naive-ui'

export type ToastKind = 'success' | 'error' | 'warning' | 'info'

export interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}

const items = ref<ToastItem[]>([])
let seq = 0

function push(text: string, kind: ToastKind = 'success', duration = 2200) {
  const id = ++seq
  items.value = [...items.value, { id, kind, text }]
  window.setTimeout(() => {
    items.value = items.value.filter((item) => item.id !== id)
  }, duration)
}

export function useToast() {
  const message = useMessage()
  return {
    items,
    success: (text: string) => {
      message.success(text)
      push(text, 'success')
    },
    error: (text: string) => {
      message.error(text)
      push(text, 'error', 3200)
    },
    warning: (text: string) => {
      message.warning(text)
      push(text, 'warning', 3200)
    },
    info: (text: string) => {
      message.info(text)
      push(text, 'info', 3200)
    },
    dismiss: (id: number) => {
      items.value = items.value.filter((item) => item.id !== id)
    },
  }
}
