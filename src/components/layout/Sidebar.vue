<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useEntryStore } from '@/stores/entry'
import { cn } from '@/lib/utils'

const { t } = useI18n()
const entryStore = useEntryStore()

function select(id: string | null) {
  entryStore.selectCategory(id)
}
</script>

<template>
  <aside class="flex w-60 shrink-0 flex-col border-r border-border bg-card">
    <div class="px-3 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {{ t('nav.categories') }}
    </div>

    <nav class="flex-1 space-y-1 overflow-y-auto px-2">
      <button
        type="button"
        class="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent"
        :class="cn(entryStore.selectedCategoryId === null && 'bg-accent font-medium')"
        @click="select(null)"
      >
        <span>{{ t('nav.all') }}</span>
        <span class="text-xs text-muted-foreground">{{ entryStore.entries.length }}</span>
      </button>

      <button
        v-for="cat in entryStore.categories"
        :key="cat.id"
        type="button"
        class="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent"
        :class="cn(entryStore.selectedCategoryId === cat.id && 'bg-accent font-medium')"
        @click="select(cat.id)"
      >
        <span class="truncate">{{ cat.name }}</span>
        <span class="text-xs text-muted-foreground">{{ cat.entryCount ?? 0 }}</span>
      </button>

      <p v-if="entryStore.categories.length === 0" class="px-2.5 py-2 text-xs text-muted-foreground">
        {{ t('sidebar.placeholder') }}
      </p>
    </nav>

    <div class="border-t border-border p-2">
      <button
        type="button"
        class="w-full rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        ＋ {{ t('nav.addCategory') }}
      </button>
    </div>
  </aside>
</template>
