<script setup lang="ts">
// 最左侧图标导航栏：上方条目/预设值，下方语言、设置、锁定。
import { computed, h, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Home, IdCard, KeyRound, Languages, Lock, Settings } from 'lucide-vue-next'
import { NMenu, NIcon, NButton, NTooltip, type MenuOption } from 'naive-ui'
import { usePreferencesStore } from '@/stores/preferences'
import { useVaultStore } from '@/stores/vault'
import { setI18nLocale } from '@/i18n'
import type { Locale } from '@/types'

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

function renderIcon(icon: Component) {
  return () => h(NIcon, null, { default: () => h(icon) })
}

// computed 保证切换语言后菜单文案立即刷新
const menuOptions = computed<MenuOption[]>(() =>
  navItems.map((item) => ({
    key: item.name,
    label: t(item.label),
    icon: renderIcon(item.icon),
  })),
)

function onMenuSelect(key: string) {
  const target = navItems.find((item) => item.name === key)
  if (target) router.push(target.to)
}

const isSettings = computed(() => route.name === 'settings')
</script>

<template>
  <div class="flex h-screen flex-col gap-1 px-2 py-3">
    <!-- 品牌标识 -->
    <div class="mb-3 flex h-10 items-center justify-center gap-2">
      <div
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"
      >
        <NIcon :component="KeyRound" :size="20" />
      </div>
      <span v-if="!collapsed" class="truncate text-sm font-semibold tracking-tight">
        {{ t('app.name') }}
      </span>
    </div>

    <NMenu
      :collapsed="collapsed"
      :collapsed-width="48"
      :collapsed-icon-size="21"
      :options="menuOptions"
      :value="route.name as string"
      :indent="12"
      @update:value="onMenuSelect"
    />

    <div class="mt-auto flex flex-col items-center gap-1 pb-1">
      <NTooltip placement="right" :show-arrow="false">
        <template #trigger>
          <NButton
            quaternary
            circle
            :aria-label="t('nav.language')"
            :title="t('nav.language')"
            @click="toggleLocale"
          >
            <template #icon>
              <NIcon :component="Languages" />
            </template>
          </NButton>
        </template>
        {{ preferences.locale === 'zh-CN' ? 'English' : '中文' }}
      </NTooltip>

      <NTooltip placement="right" :show-arrow="false">
        <template #trigger>
          <NButton
            quaternary
            circle
            :type="isSettings ? 'primary' : 'default'"
            :aria-label="t('nav.settings')"
            :title="t('nav.settings')"
            @click="router.push('/settings')"
          >
            <template #icon>
              <NIcon :component="Settings" />
            </template>
          </NButton>
        </template>
        {{ t('nav.settings') }}
      </NTooltip>

      <NTooltip placement="right" :show-arrow="false">
        <template #trigger>
          <NButton
            quaternary
            circle
            :aria-label="t('nav.lock')"
            :title="t('nav.lock')"
            @click="onLock"
          >
            <template #icon>
              <NIcon :component="Lock" />
            </template>
          </NButton>
        </template>
        {{ t('nav.lock') }}
      </NTooltip>
    </div>
  </div>
</template>
