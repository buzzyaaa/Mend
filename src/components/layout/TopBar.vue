<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { usePreferencesStore } from '@/stores/preferences'
import { useVaultStore } from '@/stores/vault'
import { setI18nLocale } from '@/i18n'
import type { Locale } from '@/types'
import { cn } from '@/lib/utils'

const { t } = useI18n()
const router = useRouter()
const preferences = usePreferencesStore()
const vault = useVaultStore()

const locales: { value: Locale; label: string }[] = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: 'EN' },
]

function onLocaleChange(event: Event) {
  const next = (event.target as HTMLSelectElement).value as Locale
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
  <header class="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
    <!-- 左侧：Logo + 软件名，右侧紧邻语言切换（需求 R12） -->
    <div class="flex items-center gap-2">
      <span
        class="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground"
      >
        <!-- 占位图标，阶段 6 替换为正式 Logo -->
        <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      </span>
      <span class="text-base font-semibold tracking-tight">{{ t('app.name') }}</span>

      <label class="ml-2 flex items-center gap-1.5 text-sm text-muted-foreground">
        <span class="sr-only">{{ t('topbar.language') }}</span>
        <select
          :value="preferences.locale"
          :aria-label="t('topbar.language')"
          class="rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
          @change="onLocaleChange"
        >
          <option v-for="l in locales" :key="l.value" :value="l.value">{{ l.label }}</option>
        </select>
      </label>
    </div>

    <div class="ml-auto flex items-center gap-2">
      <button
        type="button"
        class="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        @click="router.push('/settings')"
      >
        {{ t('topbar.settings') }}
      </button>
      <button
        type="button"
        class="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        @click="onLock"
      >
        {{ t('topbar.lock') }}
      </button>
    </div>
  </header>
</template>
