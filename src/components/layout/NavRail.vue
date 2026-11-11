<script setup lang="ts">
// 最左侧图标导航栏：上方主页/预设，下方语言、设置、锁定。
import { h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Home, IdCard, KeyRound, Languages, Lock, Settings } from 'lucide-vue-next'
import { usePreferencesStore } from '@/stores/preferences'
import { useVaultStore } from '@/stores/vault'
import { setI18nLocale } from '@/i18n'
import type { Locale } from '@/types'
import { NMenu, NIcon, NButton, NSpace } from 'naive-ui'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const preferences = usePreferencesStore()
const vault = useVaultStore()

const collapsed = defineModel<boolean>('collapsed', { default: false })

const navItems = [
  { name: 'main', to: '/main', icon: Home, label: 'nav.home' },
  { name: 'presets', to: '/presets', icon: IdCard, label: 'nav.presets' },
] as const

/** 切换中/英：写入偏好，同时立即更新界面语言。 */
function toggleLocale() {
  const next: Locale = preferences.locale === 'zh-CN' ? 'en' : 'zh-CN'
  preferences.setLocale(next)
  setI18nLocale(next)
}

/** 锁定：Rust 侧销毁会话密钥，前端回到解锁页。 */
async function onLock() {
  try {
    await vault.lock()
  } finally {
    await router.replace({ name: 'unlock' })
  }
}

function renderIcon(icon: any) {
  return () => h(NIcon, null, { default: () => h(icon) })
}

const menuOptions = navItems.map((item) => ({
  key: item.name,
  label: t(item.label),
  icon: renderIcon(item.icon),
  onClick: () => router.push(item.to),
}))
</script>

<template>
  <div class="flex h-full flex-col items-center gap-2 px-2 py-2">
    <!-- Logo -->
    <div class="mb-1 flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
      <NIcon :component="KeyRound" class="h-5 w-5" />
    </div>

    <!-- 主菜单 -->
    <NSpace vertical size="small" class="flex-1">
      <NMenu
        :collapsed="collapsed"
        :collapsed-width="64"
        :collapsed-icon-size="22"
        :options="menuOptions"
        :value="route.name as string"
        @update:value="(key: string) => router.push((navItems.find((i) => i.name === key) as any)?.to)"
      />
    </NSpace>

    <!-- 底部操作 -->
    <NSpace vertical size="small">
      <NButton text :title="t('nav.language')" @click="toggleLocale">
        <template #icon>
          <NIcon :component="Languages" />
        </template>
      </NButton>
      <NButton text :title="t('nav.settings')" @click="router.push('/settings')">
        <template #icon>
          <NIcon :component="Settings" />
        </template>
      </NButton>
      <NButton text :title="t('nav.lock')" @click="onLock" class="hover:text-red-500">
        <template #icon>
          <NIcon :component="Lock" />
        </template>
      </NButton>
    </NSpace>
  </div>
</template>
