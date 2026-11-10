// 空闲自动锁定：解锁态下监听用户活动，超过设定时长无操作即锁定并回到解锁页。
// 设定值来自偏好（分钟，0 = 关闭）。用 30 秒轮询 + 活动时间戳，避免每次事件都重设定时器。

import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useVaultStore } from '@/stores/vault'
import { usePreferencesStore } from '@/stores/preferences'
import { useToast } from '@/composables/useToast'
import { isTauri } from '@/lib/ipc'

export function useAutoLock() {
  const router = useRouter()
  const { t } = useI18n()
  const vault = useVaultStore()
  const preferences = usePreferencesStore()
  const toast = useToast()

  const lastActivity = ref(Date.now())
  let timer: number | null = null
  let locked = false

  function touch() {
    lastActivity.value = Date.now()
  }

  async function lockNow() {
    if (locked) return
    locked = true
    try {
      await vault.lock()
      toast.success(t('toast.autoLocked'))
      await router.push('/unlock')
    } finally {
      // 解锁后再次进入时由 check() 重置
      locked = false
    }
  }

  function check() {
    const minutes = preferences.autoLockMinutes
    if (!minutes || minutes <= 0) return
    if (!vault.status.unlocked) {
      // 未解锁时也刷新时间戳，避免刚解锁就被判定为空闲
      lastActivity.value = Date.now()
      return
    }
    if (Date.now() - lastActivity.value >= minutes * 60_000) void lockNow()
  }

  const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'focus']

  onMounted(() => {
    for (const name of events) window.addEventListener(name, touch, { passive: true })
    timer = window.setInterval(check, 30_000)
    // 浏览器预览下没有真实会话，不跑定时器
    if (!isTauri()) return
  })

  onBeforeUnmount(() => {
    for (const name of events) window.removeEventListener(name, touch)
    if (timer !== null) window.clearInterval(timer)
  })

  return { touch, check, lockNow }
}
