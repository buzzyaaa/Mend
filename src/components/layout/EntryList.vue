<script setup lang="ts">
// 条目列表：搜索 / 排序 / 卡片字段展示 / 回收站视图。
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
} from 'lucide-vue-next'
import {
  NButton,
  NCard,
  NEmpty,
  NIcon,
  NInput,
  NSelect,
  NTag,
  NText,
  NTooltip,
  useDialog,
} from 'naive-ui'
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
const dialog = useDialog()

const dialogOpen = ref(false)
const editing = ref<EntryView | null>(null)
const revealedPasswordIds = ref<Set<string>>(new Set())

const listTitle = computed(() => (store.isTrashView ? t('nav.trash') : t('entry.listTitle')))
const sortOptions = computed(() => [
  { label: t('entry.sortUpdated'), value: 'updated' },
  { label: t('entry.sortTitle'), value: 'title' },
  { label: t('entry.sortFavorite'), value: 'favorite' },
])
const emptyText = computed(() => {
  if (store.isTrashView) return t('trash.empty')
  return store.entries.length === 0 ? t('entry.empty') : t('entry.emptyInBucket')
})

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

function purge(entry: EntryView) {
  dialog.warning({
    title: t('trash.purge'),
    content: t('trash.purgeConfirm', { title: entry.title }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        await store.purgeEntry(entry.id)
        toast.success(t('trash.purged'))
      } catch (err) {
        toast.error(t('toast.failed', { message: messageOf(err) }))
      }
    },
  })
}

function purgeAll() {
  dialog.warning({
    title: t('trash.purgeAll'),
    content: t('trash.purgeAllConfirm'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        const count = await store.purgeAllTrash()
        toast.success(t('trash.purgedMany', { count }))
      } catch (err) {
        toast.error(t('toast.failed', { message: messageOf(err) }))
      }
    },
  })
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
    <!-- 工具条 -->
    <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      <NText strong class="mr-1 shrink-0 text-base">{{ listTitle }}</NText>

      <NInput
        :value="store.keyword"
        clearable
        class="min-w-40 flex-1"
        :placeholder="t('entry.searchPlaceholder')"
        @update:value="(value: string) => store.setKeyword(value)"
      >
        <template #prefix><NIcon :component="Search" :size="16" /></template>
      </NInput>

      <NSelect
        v-if="!store.isTrashView"
        :value="store.sortBy"
        :options="sortOptions"
        style="width: 132px"
        @update:value="(value: SortBy) => store.setSortBy(value)"
      />

      <NButton
        v-if="store.isTrashView"
        type="error"
        secondary
        :disabled="store.trash.length === 0"
        @click="purgeAll"
      >
        <template #icon><NIcon :component="Trash2" :size="16" /></template>
        {{ t('trash.purgeAll') }}
      </NButton>
      <NButton v-else type="primary" @click="openCreate">
        <template #icon><NIcon :component="Plus" :size="16" /></template>
        {{ t('entry.add') }}
      </NButton>
    </div>

    <!-- 列表 -->
    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <NEmpty v-if="store.visibleEntries.length === 0" :description="emptyText" class="py-16">
        <template v-if="!store.isTrashView" #extra>
          <NButton size="small" @click="openCreate">{{ t('entry.add') }}</NButton>
        </template>
      </NEmpty>

      <NCard
        v-for="entry in store.visibleEntries"
        :key="entry.id"
        size="small"
        hoverable
        class="mb-3"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-1.5">
              <NIcon
                v-if="entry.favorite"
                :component="Star"
                :size="14"
                color="hsl(var(--warning))"
              />
              <NText strong class="truncate text-sm">{{ entry.title }}</NText>

              <NTooltip v-if="issueOf(entry)?.weak" :show-arrow="false">
                <template #trigger>
                  <NTag size="small" type="warning" :bordered="false" round>
                    {{ t('entry.weakShort') }}
                  </NTag>
                </template>
                {{ t('entry.weakPassword') }}
              </NTooltip>
              <NTooltip v-if="issueOf(entry)?.duplicate" :show-arrow="false">
                <template #trigger>
                  <NTag size="small" type="error" :bordered="false" round>
                    {{ t('entry.dupShort') }}
                  </NTag>
                </template>
                {{ t('entry.duplicatePassword') }}
              </NTooltip>
            </div>

            <NText :depth="3" class="mt-0.5 block text-xs">
              {{ categoryName(entry.categoryId) }}
              <span v-if="store.isTrashView">
                · {{ t('trash.deletedAt') }} {{ formatDate(entry.deletedAt) }}
              </span>
            </NText>

            <div v-if="entry.tags.length && !store.isTrashView" class="mt-1.5 flex flex-wrap gap-1">
              <NTooltip v-for="tag in entry.tags" :key="tag" :show-arrow="false">
                <template #trigger>
                  <NTag
                    size="small"
                    round
                    :bordered="false"
                    :type="store.tagFilter === tag ? 'primary' : 'default'"
                    class="cursor-pointer"
                    @click="store.toggleTagFilter(tag)"
                  >
                    #{{ tag }}
                  </NTag>
                </template>
                {{ t('entry.tagFilterHint') }}
              </NTooltip>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-1">
            <template v-if="store.isTrashView">
              <NButton size="small" quaternary @click="restore(entry)">
                <template #icon><NIcon :component="RotateCcw" :size="14" /></template>
                {{ t('trash.restore') }}
              </NButton>
              <NButton size="small" quaternary type="error" @click="purge(entry)">
                {{ t('trash.purge') }}
              </NButton>
            </template>
            <NButton v-else size="small" quaternary @click="openEdit(entry)">
              <template #icon><NIcon :component="Pencil" :size="14" /></template>
              {{ t('entry.edit') }}
            </NButton>
          </div>
        </div>

        <!-- 回收站里不展示可复制字段，避免已删数据继续扩散 -->
        <div v-if="!store.isTrashView" class="mt-2 space-y-1">
          <div v-for="row in fieldRows(entry)" :key="row.key" class="flex items-center gap-2">
            <NText :depth="3" class="w-16 shrink-0 text-xs">{{ row.label }}</NText>
            <NText
              code
              class="min-w-0 flex-1 truncate"
              :class="row.masked ? 'tracking-widest' : ''"
            >
              {{ row.masked ? '••••••••' : row.value }}
            </NText>

            <NTooltip v-if="row.key === 'password'" :show-arrow="false">
              <template #trigger>
                <NButton
                  quaternary
                  circle
                  size="tiny"
                  :aria-label="row.masked ? t('entry.show') : t('entry.hide')"
                  @click="togglePassword(entry.id)"
                >
                  <template #icon>
                    <NIcon :component="row.masked ? Eye : EyeOff" :size="14" />
                  </template>
                </NButton>
              </template>
              {{ row.masked ? t('entry.show') : t('entry.hide') }}
            </NTooltip>

            <NTooltip v-if="row.href" :show-arrow="false">
              <template #trigger>
                <NButton
                  quaternary
                  circle
                  size="tiny"
                  :aria-label="t('entry.openUrl')"
                  @click="openUrl(row.value)"
                >
                  <template #icon><NIcon :component="ExternalLink" :size="14" /></template>
                </NButton>
              </template>
              {{ t('entry.openUrl') }}
            </NTooltip>

            <NTooltip :show-arrow="false">
              <template #trigger>
                <NButton
                  quaternary
                  circle
                  size="tiny"
                  :aria-label="t('entry.copy')"
                  @click="copy(row.value)"
                >
                  <template #icon><NIcon :component="Copy" :size="14" /></template>
                </NButton>
              </template>
              {{ t('entry.copy') }}
            </NTooltip>
          </div>
        </div>

        <NText v-if="entry.notes.trim()" :depth="3" class="mt-2 line-clamp-2 block text-xs">
          {{ summary(entry.notes) }}
        </NText>
      </NCard>
    </div>

    <EntryDialog :open="dialogOpen" :entry="editing" @close="dialogOpen = false" />
  </section>
</template>
