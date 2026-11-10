<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEntryStore, type Bucket } from '@/stores/entry'
import { useToast } from '@/composables/useToast'
import { cn } from '@/lib/utils'
import type { Category } from '@/types'

const { t } = useI18n()
const entryStore = useEntryStore()
const toast = useToast()

const editing = ref<{ mode: 'create' | 'rename'; category?: Category } | null>(null)
const nameInput = ref('')
const formError = ref('')
const busy = ref(false)
const deleting = ref<Category | null>(null)

onMounted(async () => {
  try {
    await entryStore.refresh()
  } catch (err) {
    // 未解锁或浏览器预览下静默，避免打断界面
    console.warn('[sidebar] 加载数据失败', err)
  }
})

function select(next: Bucket) {
  entryStore.selectBucket(next)
}

function openCreate() {
  editing.value = { mode: 'create' }
  nameInput.value = ''
  formError.value = ''
}

function openRename(category: Category) {
  editing.value = { mode: 'rename', category }
  nameInput.value = category.name
  formError.value = ''
}

async function submitCategory() {
  const name = nameInput.value.trim()
  if (!name) {
    formError.value = t('sidebar.nameRequired')
    return
  }
  busy.value = true
  formError.value = ''
  try {
    if (editing.value?.mode === 'create') {
      await entryStore.createCategory(name)
    } else if (editing.value?.category) {
      await entryStore.renameCategory(editing.value.category.id, name)
    }
    editing.value = null
  } catch (err) {
    formError.value = messageOf(err)
  } finally {
    busy.value = false
  }
}

async function confirmDelete() {
  if (!deleting.value) return
  busy.value = true
  try {
    await entryStore.deleteCategory(deleting.value.id)
    toast.success(t('toast.deleted'))
    deleting.value = null
  } catch (err) {
    toast.error(t('toast.failed', { message: messageOf(err) }))
  } finally {
    busy.value = false
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
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
        :class="cn(entryStore.bucket === 'all' && 'bg-accent font-medium')"
        @click="select('all')"
      >
        <span>{{ t('nav.all') }}</span>
        <span class="text-xs text-muted-foreground">{{ entryStore.entries.length }}</span>
      </button>

      <button
        type="button"
        class="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent"
        :class="cn(entryStore.bucket === 'uncategorized' && 'bg-accent font-medium')"
        @click="select('uncategorized')"
      >
        <span>{{ t('nav.uncategorized') }}</span>
        <span class="text-xs text-muted-foreground">{{ entryStore.uncategorizedCount }}</span>
      </button>

      <button
        type="button"
        class="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent"
        :class="cn(entryStore.bucket === 'trash' && 'bg-accent font-medium')"
        @click="select('trash')"
      >
        <span>{{ t('nav.trash') }}</span>
        <span class="text-xs text-muted-foreground">{{ entryStore.trash.length }}</span>
      </button>

      <div
        v-for="cat in entryStore.categories"
        :key="cat.id"
        class="group flex items-center gap-1 rounded-md transition-colors hover:bg-accent"
        :class="cn(entryStore.bucket === cat.id && 'bg-accent')"
      >
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center justify-between px-2.5 py-2 text-sm"
          :class="cn(entryStore.bucket === cat.id && 'font-medium')"
          @click="select(cat.id)"
        >
          <span class="truncate">{{ cat.name }}</span>
          <span class="shrink-0 text-xs text-muted-foreground">{{ cat.entryCount ?? 0 }}</span>
        </button>
        <div class="flex shrink-0 items-center gap-0.5 pr-1 opacity-0 group-hover:opacity-100">
          <button
            type="button"
            class="rounded p-1 text-xs text-muted-foreground hover:text-foreground"
            :title="t('sidebar.rename')"
            @click.stop="openRename(cat)"
          >
            ✎
          </button>
          <button
            type="button"
            class="rounded p-1 text-xs text-muted-foreground hover:text-destructive"
            :title="t('sidebar.delete')"
            @click.stop="deleting = cat"
          >
            ✕
          </button>
        </div>
      </div>

      <p v-if="entryStore.categories.length === 0" class="px-2.5 py-2 text-xs text-muted-foreground">
        {{ t('sidebar.placeholder') }}
      </p>
    </nav>

    <div class="border-t border-border p-2">
      <button
        type="button"
        class="w-full rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        @click="openCreate"
      >
        ＋ {{ t('sidebar.new') }}
      </button>
    </div>

    <!-- 新增 / 重命名分类 -->
    <div
      v-if="editing"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      @click.self="editing = null"
    >
      <div class="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg">
        <h3 class="mb-3 text-sm font-semibold">
          {{ editing.mode === 'create' ? t('sidebar.new') : t('sidebar.rename') }}
        </h3>
        <label class="mb-1 block text-xs text-muted-foreground">{{ t('sidebar.nameLabel') }}</label>
        <input
          v-model="nameInput"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          :placeholder="t('sidebar.namePlaceholder')"
          maxlength="40"
          @keyup.enter="submitCategory"
        />
        <p v-if="formError" class="mt-2 text-xs text-destructive">{{ formError }}</p>
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
            @click="editing = null"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-60"
            :disabled="busy"
            @click="submitCategory"
          >
            {{ t('common.save') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 删除分类确认 -->
    <div
      v-if="deleting"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      @click.self="deleting = null"
    >
      <div class="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg">
        <h3 class="mb-2 text-sm font-semibold">{{ t('sidebar.delete') }}：{{ deleting.name }}</h3>
        <p class="text-xs text-muted-foreground">{{ t('sidebar.deleteConfirm') }}</p>
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
            @click="deleting = null"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground hover:opacity-90 disabled:opacity-60"
            :disabled="busy"
            @click="confirmDelete"
          >
            {{ t('common.delete') }}
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>
