<script setup lang="ts">
// 条目列表（Data Table 版）：搜索 / 排序 / 备注缩略 + 展开看完整 Markdown / 随时编辑。
import { computed, h, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
} from 'lucide-vue-next'
import {
  NButton,
  NDataTable,
  NEmpty,
  NIcon,
  NInput,
  NPopconfirm,
  NSelect,
  NTag,
  NText,
  useDialog,
  type DataTableColumns,
} from 'naive-ui'
import { useEntryStore, type SortBy } from '@/stores/entry'
import { useClipboard } from '@/composables/useClipboard'
import { useToast } from '@/composables/useToast'
import { markdownSummary, renderMarkdown } from '@/lib/markdown'
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
const expandedKeys = ref<string[]>([])

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

function isRevealed(id: string) {
  return revealedPasswordIds.value.has(id)
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

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// —— 展开行（完整 Markdown 备注 + 字段 + 标签 + 编辑）——
function toggleExpand(id: string) {
  expandedKeys.value = expandedKeys.value.includes(id)
    ? expandedKeys.value.filter((k) => k !== id)
    : [...expandedKeys.value, id]
}

function iconBtn(icon: unknown, label: string, onClick: () => void) {
  return h(
    NButton,
    {
      quaternary: true,
      circle: true,
      size: 'tiny',
      title: label,
      ariaLabel: label,
      onClick: (e: MouseEvent) => {
        e.stopPropagation()
        onClick()
      },
    },
    { default: () => h(NIcon, { component: icon as never, size: 14 }) },
  )
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
      masked: !isRevealed(entry.id),
    })
  if (entry.email) rows.push({ key: 'email', label: t('entry.email'), value: entry.email })
  if (entry.phone) rows.push({ key: 'phone', label: t('entry.phone'), value: entry.phone })
  if (entry.url) rows.push({ key: 'url', label: t('entry.url'), value: entry.url, href: entry.url })
  return rows
}

function renderExpand(row: EntryView) {
  const blocks: ReturnType<typeof h>[] = []

  if (row.notes.trim()) {
    blocks.push(
      h('div', {
        class: 'md-preview',
        innerHTML: renderMarkdown(row.notes),
      }),
    )
  }

  const fields = fieldRows(row)
  if (fields.length) {
    blocks.push(
      h(
        'div',
        { class: 'mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2' },
        fields.map((f) => {
          const revealed = f.masked && isRevealed(row.id)
          const controls = []
          if (f.masked) {
            controls.push(
              iconBtn(
                revealed ? EyeOff : Eye,
                revealed ? t('entry.hide') : t('entry.show'),
                () => togglePassword(row.id),
              ),
            )
          }
          if (f.href) controls.push(iconBtn(ExternalLink, t('entry.openUrl'), () => openUrl(f.value)))
          controls.push(iconBtn(Copy, t('entry.copy'), () => copy(f.value)))

          return h('div', { class: 'flex items-center gap-2' }, [
            h(NText, { depth: 3, class: 'w-14 shrink-0 text-xs' }, () => f.label),
            h(
              NText,
              {
                code: true,
                class: revealed ? 'min-w-0 flex-1 truncate' : 'min-w-0 flex-1 truncate tracking-widest',
              },
              () => (f.masked && !revealed ? '••••••••' : f.value),
            ),
            ...controls,
          ])
        }),
      ),
    )
  }

  if (row.tags.length) {
    blocks.push(
      h(
        'div',
        { class: 'mt-2 flex flex-wrap gap-1' },
        row.tags.map((tag) =>
          h(NTag, { size: 'small', round: true, bordered: false }, () => `#${tag}`),
        ),
      ),
    )
  }

  if (!store.isTrashView) {
    blocks.push(
      h(
        NButton,
        {
          size: 'small',
          class: 'mt-3',
          onClick: (e: MouseEvent) => {
            e.stopPropagation()
            openEdit(row)
          },
        },
        {
          default: () => t('entry.edit'),
          icon: () => h(NIcon, { component: Pencil, size: 14 }),
        },
      ),
    )
  }

  return h('div', { class: 'px-3 pb-3 pt-1' }, blocks)
}

// —— 列定义 ——
const columns = computed<DataTableColumns<EntryView>>(() => {
  const base: DataTableColumns<EntryView> = [
    // 展开列：naive-ui 只在 type === 'expand' 的列上读取 renderExpand，
    // 表格级 render-expand / expandable 不是有效 prop，展开功能因此从未生效。
    {
      type: 'expand',
      width: 36,
      renderExpand: (row) => renderExpand(row),
    },
    {
      title: '',
      key: '__fav',
      width: 32,
      render: (row) =>
        row.favorite
          ? h(NIcon, {
              component: Star,
              size: 14,
              style: 'color: hsl(var(--warning))',
            })
          : null,
    },
    {
      title: t('entry.title'),
      key: 'title',
      minWidth: 160,
      ellipsis: { tooltip: true },
      render: (row) => h(NText, { strong: true, class: 'truncate' }, () => row.title),
    },
    {
      title: t('entry.category'),
      key: 'categoryId',
      width: 110,
      ellipsis: { tooltip: true },
      render: (row) => h(NText, { depth: 3, class: 'truncate' }, () => categoryName(row.categoryId)),
    },
    {
      title: t('entry.username'),
      key: 'username',
      width: 150,
      ellipsis: { tooltip: true },
      render: (row) =>
        h(NText, { class: 'truncate' }, () => row.username || '—'),
    },
    {
      title: t('entry.password'),
      key: 'password',
      width: 150,
      render: (row) => {
        const revealed = isRevealed(row.id)
        return h('div', { class: 'flex items-center gap-1' }, [
          h(
            NText,
            { code: true, class: 'min-w-0 flex-1 truncate' },
            () => (revealed ? row.password : '••••••••'),
          ),
          iconBtn(revealed ? EyeOff : Eye, revealed ? t('entry.hide') : t('entry.show'), () =>
            togglePassword(row.id),
          ),
          iconBtn(Copy, t('entry.copy'), () => copy(row.password)),
        ])
      },
    },
    {
      title: t('entry.notes'),
      key: 'notes',
      minWidth: 160,
      ellipsis: { tooltip: true },
      render: (row) =>
        h(
          'div',
          {
            class:
              'line-clamp-2 cursor-pointer text-xs text-muted-foreground hover:text-foreground',
            title: t('entry.expandNotes'),
            onClick: (e: MouseEvent) => {
              e.stopPropagation()
              toggleExpand(row.id)
            },
          },
          row.notes.trim() ? summary(row.notes) : '—',
        ),
    },
    {
      title: t('entry.status'),
      key: '__status',
      width: 84,
      render: (row) => {
        const issue = issueOf(row)
        if (!issue) return null
        const chips = []
        if (issue.weak)
          chips.push(
            h(NTag, { size: 'small', type: 'warning', bordered: false, round: true }, () =>
              t('entry.weakShort'),
            ),
          )
        if (issue.duplicate)
          chips.push(
            h(NTag, { size: 'small', type: 'error', bordered: false, round: true }, () =>
              t('entry.dupShort'),
            ),
          )
        return h('div', { class: 'flex flex-wrap gap-1' }, chips)
      },
    },
    {
      title: t('common.actions'),
      key: '__actions',
      width: 96,
      render: (row) => {
        if (store.isTrashView) {
          return h('div', { class: 'flex gap-1' }, [
            h(
              NButton,
              { size: 'small', quaternary: true, onClick: (e: MouseEvent) => { e.stopPropagation(); restore(row) } },
              () => t('trash.restore'),
            ),
            h(
              NButton,
              {
                size: 'small',
                quaternary: true,
                type: 'error',
                onClick: (e: MouseEvent) => { e.stopPropagation(); purge(row) },
              },
              () => t('trash.purge'),
            ),
          ])
        }
        return iconBtn(Pencil, t('entry.edit'), () => openEdit(row))
      },
    },
  ]
  return base
})

// —— 回收站操作 ——
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

      <NPopconfirm
        v-if="store.isTrashView && store.trash.length"
        :positive-text="t('common.confirm')"
        :negative-text="t('common.cancel')"
        @positive-click="purgeAll"
      >
        <template #trigger>
          <NButton type="error" secondary>
            <template #icon><NIcon :component="Trash2" :size="16" /></template>
            {{ t('trash.purgeAll') }}
          </NButton>
        </template>
        {{ t('trash.purgeAllConfirm') }}
      </NPopconfirm>
      <NButton v-else-if="!store.isTrashView" type="primary" @click="openCreate">
        <template #icon><NIcon :component="Plus" :size="16" /></template>
        {{ t('entry.add') }}
      </NButton>
    </div>

    <!-- 列表 -->
    <!-- flex-height 需要表格根节点拿到确定高度：父级给 flex 列 + 表格自身 flex-1，
         否则表体 flex-basis:0 会整块塌成 0 高，表现就是「表格内容空白」。 -->
    <div class="flex min-h-0 flex-1 flex-col p-4">
      <NDataTable
        class="min-h-0 flex-1"
        :columns="columns"
        :data="store.visibleEntries"
        :row-key="(row: EntryView) => row.id"
        :expanded-row-keys="expandedKeys"
        :bordered="false"
        :single-line="false"
        size="small"
        flex-height
        :scroll-x="760"
        @update:expanded-row-keys="(keys: Array<string | number>) => (expandedKeys = keys.map(String))"
      >
        <template #empty>
          <NEmpty :description="emptyText" class="py-16">
            <template v-if="!store.isTrashView" #extra>
              <NButton size="small" @click="openCreate">{{ t('entry.add') }}</NButton>
            </template>
          </NEmpty>
        </template>
      </NDataTable>
    </div>

    <EntryDialog :open="dialogOpen" :entry="editing" @close="dialogOpen = false" />
  </section>
</template>
