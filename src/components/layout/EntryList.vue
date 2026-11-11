<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEntryStore, type SortBy } from '@/stores/entry'
import { useClipboard } from '@/composables/useClipboard'
import { useToast } from '@/composables/useToast'
import { markdownSummary } from '@/lib/markdown'
import EntryDialog from '@/components/entry/EntryDialog.vue'
import type { EntryView } from '@/types'

const { t } = useI18n()
const store = useEntryStore()
const { copy } = useClipboard()
const toast = useToast()

const dialogOpen = ref(false)
const editing = ref<EntryView | null>(null)
const revealedPasswordIds = ref<Set<string>>(new Set())

const listTitle = computed(() => (store.isTrashView ? t('nav.trash') : t('entry.listTitle')))

function openCreate() {
  editing.value = null
  dialogOpen.value = true
}

function openEdit(entry: EntryView) {
  editing.value = entry
  dialogOpen.value = true
}

function togglePassword(id: string) {
  const next = new Set(revealedPasswordIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  revealedPasswordIds.value = next
}

function categoryName(id: string | null): string {
  if (!id) return t('entry.uncategorized')
  return store.categories.find((cat) => cat.id === id)?.name ?? t('entry.uncategorized')
}

function summary(text: string): string {
  return markdownSummary(text, 120)
}

function openUrl(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function onSortChange(event: Event) {
  store.setSortBy((event.target as HTMLSelectElement).value as SortBy)
}

function issueOf(entry: EntryView) {
  return store.passwordIssues.get(entry.id)
}

async function restore(entry: EntryView) {
  try {
    await store.restoreEntry(entry.id)
    toast.success(t('trash.restored'))
  } catch (err) {
    toast.error(t('toast.failed', { message: messageOf(err) }))
  }
}

async function purge(entry: EntryView) {
  if (!window.confirm(t('trash.purgeConfirm', { title: entry.title }))) return
  try {
    await store.purgeEntry(entry.id)
    toast.success(t('trash.purged'))
  } catch (err) {
    toast.error(t('toast.failed', { message: messageOf(err) }))
  }
}

async function purgeAll() {
  if (!window.confirm(t('trash.purgeAllConfirm'))) return
  try {
    const count = await store.purgeAllTrash()
    toast.success(t('trash.purgedMany', { count }))
  } catch (err) {
    toast.error(t('toast.failed', { message: messageOf(err) }))
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface FieldRow {
  key: string
  label: string
  value: string
  masked?: boolean
  href?: string
}

function fieldRows(entry: EntryView): FieldRow[] {
  const rows: FieldRow[] = []
  if (entry.username)
    rows.push({ key: 'username', label: t('entry.username'), value: entry.username })
  if (entry.password)
    rows.push({
      key: 'password',
      label: t('entry.password'),
      value: entry.password,
      masked: !revealedPasswordIds.value.has(entry.id),
    })
  if (entry.email) rows.push({ key: 'email', label: t('entry.email'), value: entry.email })
  if (entry.phone) rows.push({ key: 'phone', label: t('entry.phone'), value: entry.phone })
  if (entry.url) rows.push({ key: 'url', label: t('entry.url'), value: entry.url, href: entry.url })
  return rows
}

function formatDate(ms: number | null | undefined): string {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString()
}
</script>

<template>
  <section class="flex min-w-0 flex-1 flex-col bg-background">
    <div class="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
      <h2 class="shrink-0 text-sm font-medium">{{ listTitle }}</h2>

      <input
        :value="store.keyword"
        class="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        :placeholder="t('entry.searchPlaceholder')"
        @input="store.setKeyword(($event.target as HTMLInputElement).value)"
      />

      <select
        v-if="!store.isTrashView"
        :value="store.sortBy"
        class="shrink-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs text-muted-foreground outline-none"
        @change="onSortChange"
      >
        <option value="updated">{{ t('entry.sortUpdated') }}</option>
        <option value="title">{{ t('entry.sortTitle') }}</option>
        <option value="favorite">{{ t('entry.sortFavorite') }}</option>
      </select>

      <button
        v-if="store.isTrashView"
        type="button"
        class="shrink-0 rounded-md border border-destructive px-3 py-1.5 text-sm text-destructive hover:bg-accent disabled:opacity-60"
        :disabled="store.trash.length === 0"
        @click="purgeAll"
      >
        {{ t('trash.purgeAll') }}
      </button>

      <button
        v-else
        type="button"
        class="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        @click="openCreate"
      >
        ＋ {{ t('entry.add') }}
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-4">
      <div
        v-if="store.visibleEntries.length === 0"
        class="flex h-40 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground"
      >
        {{
          store.isTrashView
            ? t('trash.empty')
            : store.entries.length === 0
              ? t('entry.empty')
              : t('entry.emptyInBucket')
        }}
      </div>

      <div
        v-for="entry in store.visibleEntries"
        :key="entry.id"
        class="mb-3 rounded-lg border border-border bg-card p-3 shadow-sm transition-colors hover:border-primary/40"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span v-if="entry.favorite" class="text-xs text-amber-500">★</span>
              <h3 class="truncate text-sm font-semibold">{{ entry.title }}</h3>

              <!-- 密码体检标记 -->
              <span
                v-if="issueOf(entry)?.weak"
                class="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600"
                :title="t('entry.weakPassword')"
                >{{ t('entry.weakShort') }}</span
              >
              <span
                v-if="issueOf(entry)?.duplicate"
                class="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive"
                :title="t('entry.duplicatePassword')"
                >{{ t('entry.dupShort') }}</span
              >
            </div>
            <p class="mt-0.5 text-xs text-muted-foreground">
              {{ categoryName(entry.categoryId) }}
              <span v-if="store.isTrashView">
                · {{ t('trash.deletedAt') }} {{ formatDate(entry.deletedAt) }}</span
              >
            </p>
            <div v-if="entry.tags.length && !store.isTrashView" class="mt-1 flex flex-wrap gap-1">
              <button
                v-for="tag in entry.tags"
                :key="tag"
                type="button"
                class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                :class="store.tagFilter === tag ? 'bg-accent text-foreground' : ''"
                :title="t('entry.tagFilterHint')"
                @click="store.toggleTagFilter(tag)"
              >
                #{{ tag }}
              </button>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-1">
            <template v-if="store.isTrashView">
              <button
                type="button"
                class="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                @click="restore(entry)"
              >
                {{ t('trash.restore') }}
              </button>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-xs text-destructive hover:bg-accent"
                @click="purge(entry)"
              >
                {{ t('trash.purge') }}
              </button>
            </template>
            <button
              v-else
              type="button"
              class="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              @click="openEdit(entry)"
            >
              {{ t('entry.edit') }}
            </button>
          </div>
        </div>

        <!-- 回收站里只展示账号等摘要，不提供复制（避免已删数据继续扩散） -->
        <div v-if="!store.isTrashView" class="mt-2 space-y-1">
          <div
            v-for="row in fieldRows(entry)"
            :key="row.key"
            class="flex items-center gap-2 text-sm"
          >
            <span class="w-16 shrink-0 text-xs text-muted-foreground">{{ row.label }}</span>
            <span
              class="min-w-0 flex-1 truncate font-mono"
              :class="row.masked ? 'tracking-widest text-muted-foreground' : ''"
            >
              {{ row.masked ? '••••••••' : row.value }}
            </span>

            <button
              v-if="row.masked"
              type="button"
              class="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              :title="t('entry.show')"
              @click="togglePassword(entry.id)"
            >
              👁
            </button>
            <button
              v-else-if="row.key === 'password'"
              type="button"
              class="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              :title="t('entry.hide')"
              @click="togglePassword(entry.id)"
            >
              🙈
            </button>

            <button
              v-if="row.href"
              type="button"
              class="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              :title="t('entry.openUrl')"
              @click="openUrl(row.value)"
            >
              ↗
            </button>

            <button
              type="button"
              class="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              :title="t('entry.copy')"
              @click="copy(row.value)"
            >
              ⧉
            </button>
          </div>
        </div>

        <p v-if="entry.notes.trim()" class="mt-2 line-clamp-2 text-xs text-muted-foreground">
          {{ summary(entry.notes) }}
        </p>
      </div>
    </div>

    <EntryDialog :open="dialogOpen" :entry="editing" @close="dialogOpen = false" />
  </section>
</template>
