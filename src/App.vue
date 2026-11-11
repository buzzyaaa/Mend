<script setup lang="ts">
// 应用装配：naive-ui 主题/语言 + 消息与确认浮层 + 路由出口。
// 主题来源只有 preferences.isDark，浅/深两套共用 main.css 的 CSS 变量。
import { computed } from 'vue'
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
import { usePreferencesStore } from '@/stores/preferences'
import { OVERLAY_TARGET, createThemeOverrides } from '@/lib/theme'

const preferences = usePreferencesStore()
const theme = computed(() => (preferences.isDark ? darkTheme : null))
const locale = computed(() => (preferences.locale === 'zh-CN' ? zhCN : enUS))
const dateLocale = computed(() => (preferences.locale === 'zh-CN' ? dateZhCN : dateEnUS))
// 主题切换后 `.dark` 已由 applyTheme 更新，这里重新读取 CSS 变量生成具体色值
const themeOverrides = computed(() => {
  void preferences.isDark
  return createThemeOverrides()
})
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
        <RouterView />
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
