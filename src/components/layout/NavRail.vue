<script setup lang="ts">
// 最左侧图标导航栏：上方条目/预设值，下方语言、设置、锁定。
// 折叠规则全栏统一：展开时图标 + 文字，折叠时只有图标（Tooltip 补说明）。
import { computed, h, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Home, IdCard, KeyRound, Languages, Lock, Settings } from 'lucide-vue-next'
import { NMenu, NIcon, NButton, NTooltip, type MenuOption } from 'naive-ui'
import { usePreferencesStore } from '@/stores/preferences'
import { useVaultStore } from '@/stores/vault'
import { setI18nLocale } from '@/i18n'
import { OVERLAY_TARGET } from '@/lib/theme'
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

/** 左下角操作与上方菜单共用同一套折叠规则，避免一处有文字、一处永远只有图标。 */
type RailAction = {
  key: string
  icon: Component
  label: string
  hint: string
  type: 'default' | 'primary'
  onClick: () => void
}

const actions = computed<RailAction[]>(() => [
  {
    key: 'language',
    icon: Languages,
    label: t('nav.language'),
    hint: t('nav.languageHint'),
    type: 'default',
    onClick: toggleLocale,
  },
  {
    key: 'settings',
    icon: Settings,
    label: t('nav.settings'),
    hint: t('nav.settings'),
    type: isSettings.value ? 'primary' : 'default',
    onClick: () => router.push('/settings'),
  },
  {
    key: 'lock',
    icon: Lock,
    label: t('nav.lock'),
    hint: t('nav.lock'),
    type: 'default',
    onClick: onLock,
  },
])
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

    <div
      class="mt-auto flex flex-col gap-1 pb-1"
      :class="collapsed ? 'items-center' : 'items-stretch'"
    >
      <NTooltip
        v-for="action in actions"
        :key="action.key"
        placement="right"
        :show-arrow="false"
        :to="OVERLAY_TARGET"
        :disabled="!collapsed"
      >
        <template #trigger>
          <NButton
            quaternary
            :circle="collapsed"
            :block="!collapsed"
            :type="action.type"
            :aria-label="action.label"
            :title="collapsed ? action.label : undefined"
            :class="collapsed ? 'h-12 w-12' : ''"
            :style="collapsed ? undefined : { justifyContent: 'flex-start', paddingLeft: '12px' }"
            @click="action.onClick"
          >
            <template #icon>
              <NIcon :component="action.icon" />
            </template>
            <span v-if="!collapsed" class="truncate">{{ action.label }}</span>
          </NButton>
        </template>
        {{ action.hint }}
      </NTooltip>
    </div>
  </div>
</template>
