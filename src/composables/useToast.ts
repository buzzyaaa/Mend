import { ref } from 'vue'

export type ToastKind = 'success' | 'error'

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
  return {
    items,
    success: (text: string) => push(text, 'success'),
    error: (text: string) => push(text, 'error', 3200),
    dismiss: (id: number) => {
      items.value = items.value.filter((item) => item.id !== id)
    },
  }
}
