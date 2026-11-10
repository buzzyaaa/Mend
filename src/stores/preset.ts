// 预设值仓库：账号 / 邮箱 / 手机号的下拉候选，值只在解锁态可见。

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { isTauri, presetApi } from '@/lib/ipc'
import type { Preset, PresetFieldType, PresetInput } from '@/types'

export const usePresetStore = defineStore('preset', () => {
  const presets = ref<Preset[]>([])
  const loading = ref(false)

  function byType(type: PresetFieldType): Preset[] {
    return presets.value.filter((item) => item.fieldType === type)
  }

  const grouped = computed(() => ({
    username: byType('username'),
    email: byType('email'),
    phone: byType('phone'),
  }))

  async function refresh() {
    if (!isTauri()) return
    loading.value = true
    try {
      presets.value = await presetApi.list()
    } finally {
      loading.value = false
    }
  }

  async function create(input: PresetInput) {
    await presetApi.create(input)
    await refresh()
  }

  async function update(id: string, input: PresetInput) {
    await presetApi.update(id, input)
    await refresh()
  }

  async function remove(id: string) {
    await presetApi.remove(id)
    await refresh()
  }

  return { presets, grouped, loading, refresh, create, update, remove, byType }
})
