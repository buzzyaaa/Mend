<script setup lang="ts">
// 应用装配：naive-ui 主题/语言 + 消息与确认浮层 + 路由出口。
// 主题来源只有 preferences.isDark，浅/深两套共用 main.css 的 CSS 变量。
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { RouterView } from 'vue-router'
import {
  NConfigProvider,
  NGlobalStyle,
  NMessageProvider,
  NDialogProvider,
  darkTheme,
  zhCN,
  enUS,
  dateZhCN,
  dateEnUS,
} from 'naive-ui'
import { showWindowMenu } from '@/lib/titlebarMenu'
import { usePreferencesStore } from '@/stores/preferences'
import { useUiStore } from '@/stores/ui'
import { OVERLAY_TARGET, createThemeOverrides } from '@/lib/theme'
import TitleBar from '@/components/layout/TitleBar.vue'
import UpdateChecker from '@/components/UpdateChecker.vue'
import SettingsDialog from '@/components/settings/SettingsDialog.vue'
import PresetsDialog from '@/components/presets/PresetsDialog.vue'
import LanguageDialog from '@/components/language/LanguageDialog.vue'

const preferences = usePreferencesStore()
const ui = useUiStore()
const theme = computed(() => (preferences.isDark ? darkTheme : null))
const locale = computed(() => (preferences.locale === 'zh-CN' ? zhCN : enUS))
const dateLocale = computed(() => (preferences.locale === 'zh-CN' ? dateZhCN : dateEnUS))
// 主题切换后 `.dark` 已由 applyTheme 更新，这里重新读取 CSS 变量生成具体色值
const themeOverrides = computed(() => {
  void preferences.isDark
  return createThemeOverrides()
})

// 全局右键菜单：默认抑制（保持桌面应用观感，Ctrl+C/V 仍可复制粘贴）；
// 仅标题栏（[data-titlebar]）右键弹出 Windows 风格菜单。
function onContextMenu(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (target?.closest('[data-titlebar]')) {
    e.preventDefault()
    void showWindowMenu(e.clientX, e.clientY)
    return
  }
  e.preventDefault()
}

onMounted(() => document.addEventListener('contextmenu', onContextMenu))
onBeforeUnmount(() => document.removeEventListener('contextmenu', onContextMenu))
</script>

<template>
  <NConfigProvider
    :theme="theme"
    :theme-overrides="themeOverrides"
    :locale="locale"
    :date-locale="dateLocale"
  >
    <NGlobalStyle />
    <!-- 浮层统一挂在这里，确保继承 NConfigProvider 的主题变量 -->
    <div id="mend-overlays"></div>
    <NMessageProvider :to="OVERLAY_TARGET" :max="3">
      <NDialogProvider :to="OVERLAY_TARGET">
        <!-- 整体纵向布局：顶部自定义标题栏 + 下方内容区 -->
        <div class="flex h-screen flex-col overflow-hidden">
          <TitleBar class="shrink-0" />
          <div class="min-h-0 flex-1">
            <RouterView />
          </div>
        </div>
        <!-- 顶栏弹窗：设置 / 预设值 / 语言选择（原先为独立路由页，现统一为弹窗） -->
        <SettingsDialog :open="ui.settingsOpen" @close="ui.closeSettings()" />
        <PresetsDialog :open="ui.presetsOpen" @close="ui.closePresets()" />
        <LanguageDialog :open="ui.languageOpen" @close="ui.closeLanguage()" />
        <UpdateChecker />
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
