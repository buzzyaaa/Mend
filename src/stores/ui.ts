// 顶栏弹窗开关状态。
// 设置 / 语言选择 / 预设值原先都是独立路由页，改为弹窗后不再占用路由：
// 三个对话框统一挂在 App.vue（NMessage/NDialog Provider 内部），开关由这里持有。
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const settingsOpen = ref(false)
  const presetsOpen = ref(false)
  const languageOpen = ref(false)

  function openSettings() {
    settingsOpen.value = true
  }

  function closeSettings() {
    settingsOpen.value = false
  }

  function openPresets() {
    presetsOpen.value = true
  }

  function closePresets() {
    presetsOpen.value = false
  }

  function openLanguage() {
    languageOpen.value = true
  }

  function closeLanguage() {
    languageOpen.value = false
  }

  function closeAll() {
    closeSettings()
    closePresets()
    closeLanguage()
  }

  return {
    settingsOpen,
    presetsOpen,
    languageOpen,
    openSettings,
    closeSettings,
    openPresets,
    closePresets,
    openLanguage,
    closeLanguage,
    closeAll,
  }
})
