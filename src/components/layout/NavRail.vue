<script setup lang="ts">
// 最左侧图标导航栏：上方主页/预设，下方语言、设置、锁定。
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Home, IdCard, KeyRound, Languages, Lock, Settings } from 'lucide-vue-next'
import { usePreferencesStore } from '@/stores/preferences'
import { useVaultStore } from '@/stores/vault'
import { setI18nLocale } from '@/i18n'
import type { Locale } from '@/types'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const preferences = usePreferencesStore()
const vault = useVaultStore()

/** 图标按钮的公共样式：默认 / hover / focus / active 状态齐全。 */
const iconButton =
  'flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-80'

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
</script>

<template>
  <nav
    class="flex h-screen w-14 shrink-0 flex-col items-center justify-between border-r border-border bg-card py-3"
    :aria-label="t('app.name')"
  >
    <div class="flex flex-col items-center gap-1">
      <span
        class="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"
        :title="t('app.name')"
        aria-hidden="true"
      >
        <KeyRound class="h-5 w-5" />
      </span>

      <RouterLink
        v-for="item in navItems"
        :key="item.name"
        :to="item.to"
        :class="[iconButton, route.name === item.name && 'bg-accent text-foreground']"
        :title="t(item.label)"
        :aria-label="t(item.label)"
        :aria-current="route.name === item.name ? 'page' : undefined"
      >
        <component :is="item.icon" class="h-5 w-5" />
      </RouterLink>
    </div>

    <div class="flex flex-col items-center gap-1">
      <button
        type="button"
        :class="iconButton"
        :title="t('nav.language')"
        :aria-label="t('nav.language')"
        @click="toggleLocale"
      >
        <Languages class="h-5 w-5" />
      </button>

      <RouterLink
        to="/settings"
        :class="[iconButton, route.name === 'settings' && 'bg-accent text-foreground']"
        :title="t('nav.settings')"
        :aria-label="t('nav.settings')"
        :aria-current="route.name === 'settings' ? 'page' : undefined"
      >
        <Settings class="h-5 w-5" />
      </RouterLink>

      <button
        type="button"
        :class="[iconButton, 'hover:text-destructive']"
        :title="t('nav.lock')"
        :aria-label="t('nav.lock')"
        @click="onLock"
      >
        <Lock class="h-5 w-5" />
      </button>
    </div>
  </nav>
</template>
