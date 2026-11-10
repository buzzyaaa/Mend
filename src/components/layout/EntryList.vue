<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useEntryStore } from '@/stores/entry'

const { t } = useI18n()
const entryStore = useEntryStore()
</script>

<template>
  <section class="flex-1 overflow-y-auto p-4">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-sm font-medium text-muted-foreground">{{ t('entry.listTitle') }}</h2>
    </div>

    <div
      v-if="entryStore.entries.length === 0"
      class="flex h-40 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground"
    >
      {{ t('entry.empty') }}
    </div>

    <!-- 阶段 3 渲染真实条目卡片；阶段 1 仅占位列表 -->
    <div
      v-for="entry in entryStore.entries"
      :key="entry.id"
      class="mb-2 rounded-lg border border-border bg-card p-3"
    >
      <div class="font-medium">{{ entry.title }}</div>
    </div>
  </section>
</template>
