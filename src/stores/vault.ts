import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { VaultStatus } from '@/types'

export const useVaultStore = defineStore('vault', () => {
  // 阶段 1：前端占位状态；阶段 2 由 Rust 命令 vault_status/unlock/lock 驱动
  const status = ref<VaultStatus>({ initialized: false, unlocked: false })

  function setStatus(next: VaultStatus) {
    status.value = next
  }

  function lock() {
    status.value = { ...status.value, unlocked: false }
  }

  return { status, setStatus, lock }
})
