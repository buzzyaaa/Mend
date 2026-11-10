import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { VaultStatus } from '@/types'
import { isTauri, vaultApi } from '@/lib/ipc'

export const useVaultStore = defineStore('vault', () => {
  const status = ref<VaultStatus>({ initialized: false, unlocked: false })
  const busy = ref(false)

  function setStatus(next: VaultStatus) {
    status.value = next
  }

  /** 从 Rust 侧读取真实状态；浏览器预览下保持占位值。 */
  async function refresh() {
    if (!isTauri()) return
    status.value = await vaultApi.status()
  }

  /** 首次建库：成功后即进入解锁态。 */
  async function setup(masterPassword: string) {
    busy.value = true
    try {
      const result = await vaultApi.setup(masterPassword)
      status.value = { initialized: true, unlocked: result.unlocked }
    } finally {
      busy.value = false
    }
  }

  async function unlock(masterPassword: string) {
    busy.value = true
    try {
      const result = await vaultApi.unlock(masterPassword)
      status.value = { ...status.value, unlocked: result.unlocked }
    } finally {
      busy.value = false
    }
  }

  /** 锁定：通知 Rust 销毁会话密钥，并同步前端状态。 */
  async function lock() {
    if (isTauri()) await vaultApi.lock()
    status.value = { ...status.value, unlocked: false }
  }

  return { status, busy, setStatus, refresh, setup, unlock, lock }
})
