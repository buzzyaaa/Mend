<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
// 阶段 2 对接 vault_unlock / vault_setup 命令
const { t } = useI18n()
const password = ref('')
</script>

<template>
  <div class="flex h-screen items-center justify-center bg-background p-4">
    <div class="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
      <div class="mb-1 text-center text-xl font-semibold">{{ t('app.name') }}</div>
      <p class="mb-6 text-center text-sm text-muted-foreground">{{ t('unlock.subtitle') }}</p>

      <label class="mb-1 block text-sm text-muted-foreground">{{ t('unlock.password') }}</label>
      <input
        v-model="password"
        type="password"
        class="mb-4 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        :placeholder="t('unlock.password')"
      />

      <button
        type="button"
        class="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {{ t('unlock.unlock') }}
      </button>
    </div>
  </div>
</template>
