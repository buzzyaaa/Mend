<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { usePreferencesStore } from '@/stores/preferences'
import { setI18nLocale } from '@/i18n'
import type { Locale } from '@/types'

const { t } = useI18n()
const router = useRouter()
const preferences = usePreferencesStore()

const locales: { value: Locale; label: string }[] = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: 'EN' },
]

function onLocaleChange(event: Event) {
  const next = (event.target as HTMLSelectElement).value as Locale
  preferences.setLocale(next)
  setI18nLocale(next)
}
</script>

<template>
  <div class="flex h-screen flex-col">
    <header class="flex h-14 items-center gap-3 border-b border-border bg-card px-4">
      <button
        type="button"
        class="text-sm text-muted-foreground hover:text-foreground"
        @click="router.push('/main')"
      >
        ← {{ t('app.name') }}
      </button>
      <span class="text-sm font-medium">{{ t('settings.language') }}</span>
    </header>

    <main class="flex-1 space-y-4 p-6">
      <div class="flex items-center justify-between rounded-lg border border-border bg-card p-4">
        <span class="text-sm">{{ t('settings.language') }}</span>
        <select
          :value="preferences.locale"
          class="rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          @change="onLocaleChange"
        >
          <option v-for="l in locales" :key="l.value" :value="l.value">{{ l.label }}</option>
        </select>
      </div>

      <!-- 阶段 5 接入备份/恢复；阶段 6 接入主题 -->
      <div class="flex items-center justify-between rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        {{ t('backup.export') }} / {{ t('backup.import') }}
      </div>
    </main>
  </div>
</template>
