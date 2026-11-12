<script setup lang="ts">
// 条目列表（Data Table 版）：搜索 / 排序 / 备注缩略 + 展开看完整 Markdown / 随时编辑。
import { computed, h, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Archive,
  ArchiveRestore,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  GripVertical,
  Pencil,
  Plus,
  Search,
  Star,
  StarOff,
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
  NTooltip,
  useDialog,
  type DataTableColumns,
} from 'naive-ui'
import { useEntryStore, type SortBy } from '@/stores/entry'
import { useVaultStore } from '@/stores/vault'
import { useClipboard } from '@/composables/useClipboard'
import { useToast } from '@/composables/useToast'
import { markdownSummary, renderMarkdown } from '@/lib/markdown'
import { errorText } from '@/lib/errorMessage'
import { OVERLAY_TARGET } from '@/lib/theme'
import { categoryTint, resolveCategoryIcon } from '@/lib/categoryIcons'
import EntryDialog from '@/components/entry/EntryDialog.vue'
import NotesDialog from '@/components/entry/NotesDialog.vue'
import type { Category, EntryView } from '@/types'

const { t } = useI18n()
const store = useEntryStore()
const vault = useVaultStore()
const { copy } = useClipboard()
const toast = useToast()
const dialog = useDialog()

const dialogOpen = ref(false)
const editing = ref<EntryView | null>(null)
// 备注弹窗：独立于条目编辑弹窗，传当前行快照（store.refresh 替换条目时弹窗内容不被打断）。
const notesOpen = ref(false)
const notesEntry = ref<EntryView | null>(null)
const revealedPasswordIds = ref<Set<string>>(new Set())
const expandedKeys = ref<string[]>([])

// —— 手动排序拖拽（HTML5 原生 DnD，行由 naive-ui 渲染，故经 row-props 注入事件）——
// 仅「手动排序」且非回收站 / 星标 / 归档视图时启用；拖拽顺序是后端 `sort_order` 的内存镜像。
const dragEnabled = computed(
  () =>
    store.sortBy === 'manual' && !store.isTrashView && !store.isArchiveView && !store.isStarredView,
)
const draggingId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null)
/** 行/手柄共用的动效类：150–250ms ease-out；全局已按 prefers-reduced-motion 降速。 */
const DRAG_TRANSITION = 'transition-colors transition-opacity duration-200 ease-out'

// 锁定（手动 / 空闲自动）后清掉本地明文残留：已显示密码的条目集合与展开行。
// store 侧的 entries / trash / presets 由 vault.lock() 统一 reset。
watch(
  () => vault.status.unlocked,
  (unlocked) => {
    if (unlocked) return
    revealedPasswordIds.value = new Set()
    expandedKeys.value = []
    dialogOpen.value = false
    editing.value = null
    notesOpen.value = false
    notesEntry.value = null
  },
)

function clearTagFilter() {
  if (store.tagFilter) store.toggleTagFilter(store.tagFilter)
}

const listTitle = computed(() => {
  if (store.isTrashView) return t('nav.trash')
  if (store.isArchiveView) return t('nav.archive')
  if (store.isStarredView) return t('nav.starred')
  return t('entry.listTitle')
})
const sortOptions = computed(() => [
  { label: t('entry.sortUpdated'), value: 'updated' },
  { label: t('entry.sortTitle'), value: 'title' },
  { label: t('entry.sortFavorite'), value: 'favorite' },
  { label: t('entry.sortManual'), value: 'manual' },
])
/** 拖拽手柄列宽：手动排序时出现，因此同步抬高横向滚动阈值。 */
const dragHandleWidth = 34
const scrollX = computed(() => {
  const extra = dragEnabled.value ? dragHandleWidth : 0
  return store.selectedCategoryId ? 1180 + extra : 1312 + extra
})
const emptyText = computed(() => {
  if (store.isTrashView) return t('trash.empty')
  if (store.isArchiveView) return t('entry.archivedHint')
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

function openNotes(entry: EntryView) {
  notesEntry.value = entry
  notesOpen.value = true
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

function categoryOf(id: string | null): Category | undefined {
  if (!id) return undefined
  return store.categories.find((cat) => cat.id === id)
}

function categoryName(id: string | null): string {
  return categoryOf(id)?.name ?? t('entry.uncategorized')
}

function summary(text: string): string {
  return markdownSummary(text, 120)
}

function openUrl(url: string) {
  // 无 scheme 的网址（如 example.com）直接打开会被解析成相对应用自身 origin 的路径，
  // 统一补 https://；与展开区 ExternalLink 按钮共用同一打开机制。
  const target = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
  window.open(target, '_blank', 'noopener,noreferrer')
}

function issueOf(entry: EntryView) {
  return store.passwordIssues.get(entry.id)
}

function messageOf(err: unknown): string {
  // 后端 MendError 为 { code, message } 结构，统一走 errorText 映射（docs/07 §5）。
  return errorText(err, t)
}

// —— 星标 ——

/** 点击标题前的星标：直接调 store 立即更新 DB，成功后给 Toast。 */
async function toggleStar(entry: EntryView) {
  try {
    await store.toggleStar(entry.id)
    toast.success(t('toast.saved'))
  } catch (err) {
    toast.error(t('toast.failed', { message: messageOf(err) }))
  }
}

// —— 拖拽排序（原生 HTML5 DnD；naive-ui 行由其内部渲染，故经 row-props 注入事件）——

/** 当前桶渲染顺序的 id 列表（与 `store.visibleEntries` 一一对应）。 */
function visibleIds(): string[] {
  return store.visibleEntries.map((row) => row.id)
}

function onDragStart(event: DragEvent, row: EntryView) {
  if (!dragEnabled.value) {
    event.preventDefault()
    return
  }
  draggingId.value = row.id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    // Chromium WebView 需 setData 才会显示可拖拽光标
    event.dataTransfer.setData('text/plain', row.id)
  }
}

/** 悬停即交换：把拖拽行移动到目标行位置，实时反映在列表与内存顺序里。 */
function onDragOver(event: DragEvent, target: EntryView) {
  if (!dragEnabled.value || !draggingId.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropTargetId.value = target.id
  if (draggingId.value === target.id) return
  const ids = visibleIds()
  const from = ids.indexOf(draggingId.value)
  const to = ids.indexOf(target.id)
  if (from < 0 || to < 0) return
  const [moved] = ids.splice(from, 1)
  ids.splice(to, 0, moved)
  store.setManualOrder(ids)
}

/** 落库：把内存里的最终顺序写回后端 `sort_order`（单事务），并复位拖拽状态。 */
let finalizing = false
async function finalizeDrag() {
  if (finalizing) return
  finalizing = true
  try {
    const ids = visibleIds()
    await store.reorder(ids)
    toast.success(t('entry.reorderSaved'))
  } catch (err) {
    toast.error(t('toast.failed', { message: messageOf(err) }))
  } finally {
    finalizing = false
    draggingId.value = null
    dropTargetId.value = null
  }
}

function onDrop(event: DragEvent) {
  if (!dragEnabled.value || !draggingId.value) return
  event.preventDefault()
  void finalizeDrag()
}

/** 松手必然触发：即使落在行外的空白处（没有 onDrop）也按最终顺序落库。 */
function onDragEnd() {
  if (draggingId.value) void finalizeDrag()
}

/** naive-ui row-props：仅手动排序时给 <tr> 注入拖拽事件与高亮/降透类。 */
function rowProps(row: EntryView) {
  if (!dragEnabled.value) return {}
  const dragging = draggingId.value === row.id
  const isTarget = dropTargetId.value === row.id && !dragging
  return {
    class: [
      dragging ? 'opacity-50' : '',
      isTarget ? 'bg-primary/10 ring-1 ring-primary' : '',
      DRAG_TRANSITION,
    ]
      .filter(Boolean)
      .join(' '),
    onDragover: (event: DragEvent) => onDragOver(event, row),
    onDrop: (event: DragEvent) => onDrop(event),
    onDragend: onDragEnd,
  }
}

// —— 展开行（完整 Markdown 备注 + 字段 + 标签 + 编辑）——

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
    // 展开区保留渲染摘要展示，另提供「查看备注」入口开弹窗。
    blocks.push(
      h('div', { class: 'flex items-start justify-between gap-2' }, [
        h('div', {
          class: 'md-preview min-w-0 flex-1',
          innerHTML: renderMarkdown(row.notes),
        }),
        iconBtn(ExternalLink, t('entry.viewNotes'), () => openNotes(row)),
      ]),
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
              iconBtn(revealed ? EyeOff : Eye, revealed ? t('entry.hide') : t('entry.show'), () =>
                togglePassword(row.id),
              ),
            )
          }
          if (f.href)
            controls.push(iconBtn(ExternalLink, t('entry.openUrl'), () => openUrl(f.value)))
          controls.push(iconBtn(Copy, t('entry.copy'), () => copy(f.value)))

          return h('div', { class: 'flex items-center gap-2' }, [
            h(NText, { depth: 3, class: 'w-14 shrink-0 text-xs' }, () => f.label),
            h(
              NText,
              {
                code: true,
                class: revealed
                  ? 'min-w-0 flex-1 truncate'
                  : 'min-w-0 flex-1 truncate tracking-widest',
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
    // 回收站视图不提供标签过滤入口（与「回收站不可编辑/复制」口径一致）。
    const filterable = !store.isTrashView
    blocks.push(
      h(
        'div',
        { class: 'mt-2 flex flex-wrap gap-1' },
        row.tags.map((tag) => {
          const active = filterable && store.tagFilter === tag
          return h(
            NTag,
            {
              size: 'small',
              round: true,
              // 过滤中的标签用语义 type + 描边区分，不写死颜色
              type: active ? 'primary' : 'default',
              bordered: active,
              ...(filterable
                ? {
                    class: 'cursor-pointer',
                    title: t('entry.tagFilterHint'),
                    onClick: (e: MouseEvent) => {
                      e.stopPropagation()
                      store.toggleTagFilter(tag)
                    },
                  }
                : {}),
            },
            () => `#${tag}`,
          )
        }),
      ),
    )
  }

  if (!store.isTrashView && !store.isArchiveView) {
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

// 数据单元格：空值显示「—」；非回收站且有值时整格可点复制（iconBtn 自带
// stopPropagation，按钮点击不会重复触发单元格 onClick）。
function copyableCell(value: string) {
  const copyable = !store.isTrashView && !!value
  return h(
    'div',
    {
      class: ['flex min-w-0 items-center gap-1', copyable ? 'cursor-pointer' : ''],
      onClick: copyable
        ? (e: MouseEvent) => {
            e.stopPropagation()
            copy(value)
          }
        : undefined,
    },
    [
      h(
        NText,
        { depth: value ? undefined : 3, class: 'min-w-0 flex-1 truncate' },
        () => value || '—',
      ),
      ...(copyable ? [iconBtn(Copy, t('entry.copy'), () => copy(value))] : []),
    ],
  )
}

const columns = computed<DataTableColumns<EntryView>>(() => {
  // 选中具体分类时隐藏分类列（全部 / 未分类 / 回收站保留）。
  const hideCategory = store.selectedCategoryId !== null
  const base: DataTableColumns<EntryView> = [
    // 拖拽手柄列：仅手动排序时出现（回收站 / 星标视图不启用拖拽）。
    ...(dragEnabled.value
      ? [
          {
            title: '',
            key: '__drag',
            width: dragHandleWidth,
            className: 'text-center',
            render: (row: EntryView) =>
              h(
                'span',
                {
                  class:
                    'inline-flex cursor-grab items-center justify-center text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground active:cursor-grabbing',
                  draggable: true,
                  title: t('entry.dragHint'),
                  'aria-label': t('entry.dragHint'),
                  onDragstart: (event: DragEvent) => onDragStart(event, row),
                },
                [h(NIcon, { component: GripVertical, size: 14 })],
              ),
          } satisfies DataTableColumns<EntryView>[number],
        ]
      : []),
    // 展开列：naive-ui 只在 type === 'expand' 的列上读取 renderExpand，
    // 表格级 render-expand / expandable 不是有效 prop，展开功能因此从未生效。
    {
      type: 'expand',
      width: 36,
      renderExpand: (row) => renderExpand(row),
    },
    {
      title: t('entry.title'),
      key: 'title',
      minWidth: 160,
      ellipsis: { tooltip: true },
      // 标题不做整格点击复制（保留整行展开 / 编辑交互），仅列尾挂复制按钮。
      render: (row) => {
        // 星标按钮：标题最前面放一个 Star 图标，星标条目金色/语义色（走 --warning CSS 变量）。
        // stopPropagation 防止点击星标触发展开；回收站 / 归档视图只读，不提供。
        const star =
          store.isTrashView || store.isArchiveView
            ? null
            : h(
                NButton,
                {
                  quaternary: true,
                  circle: true,
                  size: 'tiny',
                  class: 'shrink-0',
                  title: row.favorite ? t('entry.unstar') : t('entry.star'),
                  ariaLabel: row.favorite ? t('entry.unstar') : t('entry.star'),
                  onClick: (e: MouseEvent) => {
                    e.stopPropagation()
                    toggleStar(row)
                  },
                },
                {
                  default: () =>
                    h(NIcon, {
                      component: row.favorite ? Star : StarOff,
                      size: 14,
                      style: row.favorite ? 'color: hsl(var(--warning))' : undefined,
                    }),
                },
              )

        // url 非空时标题渲染为链接（语义色走 --primary CSS 变量）：点击打开网址，
        // stopPropagation 防止触发展开/行内复制；回收站视图同样可点开（查看性质）。
        const url = row.url
        const title = url
          ? h(
              'span',
              {
                class:
                  'min-w-0 flex-1 cursor-pointer truncate font-bold text-primary underline-offset-2 hover:text-primary-hover hover:underline',
                title: t('entry.openUrl'),
                onClick: (e: MouseEvent) => {
                  e.stopPropagation()
                  openUrl(url)
                },
              },
              row.title,
            )
          : h(NText, { strong: true, class: 'min-w-0 flex-1 truncate' }, () => row.title)
        return h('div', { class: 'flex min-w-0 items-center gap-1' }, [
          star,
          title,
          ...(store.isTrashView ? [] : [iconBtn(Copy, t('entry.copy'), () => copy(row.title))]),
        ])
      },
    },
    {
      title: t('entry.username'),
      key: 'username',
      width: 150,
      ellipsis: { tooltip: true },
      render: (row) => copyableCell(row.username),
    },
    {
      title: t('entry.email'),
      key: 'email',
      width: 160,
      ellipsis: { tooltip: true },
      render: (row) => copyableCell(row.email),
    },
    {
      title: t('entry.phone'),
      key: 'phone',
      width: 140,
      ellipsis: { tooltip: true },
      render: (row) => copyableCell(row.phone),
    },
    {
      title: t('entry.password'),
      key: 'password',
      width: 170,
      render: (row) => {
        const revealed = isRevealed(row.id)
        // 点击单元格空白处复制明文；eye 按钮经 iconBtn 已 stopPropagation，显隐与复制共存。
        const copyable = !store.isTrashView && !!row.password
        return h(
          'div',
          {
            class: ['flex items-center gap-1', copyable ? 'cursor-pointer' : ''],
            onClick: copyable
              ? (e: MouseEvent) => {
                  e.stopPropagation()
                  copy(row.password)
                }
              : undefined,
          },
          [
            h(NText, { code: true, class: 'min-w-0 flex-1 truncate' }, () =>
              row.password ? (revealed ? row.password : '••••••••') : '—',
            ),
            iconBtn(revealed ? EyeOff : Eye, revealed ? t('entry.hide') : t('entry.show'), () =>
              togglePassword(row.id),
            ),
            ...(copyable ? [iconBtn(Copy, t('entry.copy'), () => copy(row.password))] : []),
          ],
        )
      },
    },
    // 分类列按条件插入（在固定五列之后、备注之前）。
    ...(hideCategory
      ? []
      : [
          {
            title: t('entry.category'),
            key: 'categoryId',
            width: 132,
            ellipsis: { tooltip: true },
            render: (row: EntryView) => {
              const cat = categoryOf(row.categoryId)
              const tint = cat?.color ? categoryTint(cat.color, 0.1) : undefined
              return h(
                'div',
                {
                  class: 'flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5',
                  style: tint ? { background: tint } : undefined,
                },
                [
                  h(NIcon, { component: resolveCategoryIcon(cat?.icon), size: 14 }),
                  h(NText, { depth: 3, class: 'min-w-0 flex-1 truncate' }, () =>
                    categoryName(row.categoryId),
                  ),
                ],
              )
            },
          } satisfies DataTableColumns<EntryView>[number],
        ]),
    {
      title: t('entry.notes'),
      key: 'notes',
      minWidth: 160,
      ellipsis: { tooltip: true },
      // 点击备注单元格直接打开备注弹窗（展开行仍可由最左侧展开箭头触发）。
      render: (row) =>
        h(
          'div',
          {
            class:
              'line-clamp-2 cursor-pointer text-xs text-muted-foreground hover:text-foreground',
            title: t('entry.viewNotes'),
            onClick: (e: MouseEvent) => {
              e.stopPropagation()
              openNotes(row)
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
      width: 112,
      render: (row) => {
        if (store.isTrashView) {
          return h('div', { class: 'flex gap-1' }, [
            h(
              NButton,
              {
                size: 'small',
                quaternary: true,
                onClick: (e: MouseEvent) => {
                  e.stopPropagation()
                  restore(row)
                },
              },
              () => t('trash.restore'),
            ),
            h(
              NButton,
              {
                size: 'small',
                quaternary: true,
                type: 'error',
                onClick: (e: MouseEvent) => {
                  e.stopPropagation()
                  purge(row)
                },
              },
              () => t('trash.purge'),
            ),
          ])
        }
        if (store.isArchiveView) {
          // 归档视图只读：仅提供「取消归档」，不提供编辑 / 删除（与回收站口径一致）。
          return iconBtn(ArchiveRestore, t('entry.unarchive'), () => unarchiveEntry(row))
        }
        // 普通视图：编辑 / 归档 / 删除。归档与删除均走二次确认。
        return h('div', { class: 'flex gap-1' }, [
          iconBtn(Pencil, t('entry.edit'), () => openEdit(row)),
          iconBtn(Archive, t('entry.archive'), () => archiveEntry(row)),
          iconBtn(Trash2, t('common.delete'), () => confirmDelete(row)),
        ])
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

// —— 归档操作 ——

/** 归档二次确认：确认后调 store.archiveEntry（软状态，可取消归档）。 */
function archiveEntry(entry: EntryView) {
  dialog.warning({
    title: t('entry.archiveConfirm', { title: entry.title }),
    content: t('entry.archiveConfirmContent', { title: entry.title }),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        await store.archiveEntry(entry.id)
        toast.success(t('entry.archived'))
      } catch (err) {
        toast.error(t('toast.failed', { message: messageOf(err) }))
      }
    },
  })
}

/** 取消归档二次确认：确认后调 store.unarchiveEntry。 */
function unarchiveEntry(entry: EntryView) {
  dialog.warning({
    title: t('entry.unarchiveConfirm', { title: entry.title }),
    content: t('entry.unarchiveConfirmContent', { title: entry.title }),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        await store.unarchiveEntry(entry.id)
        toast.success(t('entry.unarchived'))
      } catch (err) {
        toast.error(t('toast.failed', { message: messageOf(err) }))
      }
    },
  })
}

/** 删除二次确认：与编辑弹窗删除口径一致（软删除进回收站，可恢复）。 */
function confirmDelete(entry: EntryView) {
  dialog.warning({
    title: t('common.delete'),
    content: t('entry.deleteConfirm'),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        await store.deleteEntry(entry.id)
        toast.success(t('toast.deleted'))
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

      <!-- 标签过滤状态徽标：关闭即清除过滤（复用 toggleTagFilter 的“再点一次取消”语义） -->
      <NTooltip
        v-if="store.tagFilter && !store.isTrashView"
        :show-arrow="false"
        :to="OVERLAY_TARGET"
      >
        <template #trigger>
          <NTag
            type="primary"
            size="small"
            round
            closable
            :aria-label="t('entry.tags')"
            @close="clearTagFilter"
          >
            {{ t('entry.tags') }}: #{{ store.tagFilter }}
          </NTag>
        </template>
        {{ t('entry.tagFilterHint') }}
      </NTooltip>

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
        v-if="!store.isTrashView && !store.isArchiveView"
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
      <NButton
        v-else-if="!store.isTrashView && !store.isArchiveView"
        type="primary"
        @click="openCreate"
      >
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
        :row-props="rowProps"
        :expanded-row-keys="expandedKeys"
        :bordered="false"
        :single-line="false"
        size="small"
        flex-height
        :scroll-x="scrollX"
        @update:expanded-row-keys="
          (keys: Array<string | number>) => (expandedKeys = keys.map(String))
        "
      >
        <template #empty>
          <NEmpty :description="emptyText" class="py-16">
            <template v-if="!store.isTrashView && !store.isArchiveView" #extra>
              <NButton size="small" @click="openCreate">{{ t('entry.add') }}</NButton>
            </template>
          </NEmpty>
        </template>
      </NDataTable>
    </div>

    <EntryDialog :open="dialogOpen" :entry="editing" @close="dialogOpen = false" />
    <NotesDialog :open="notesOpen" :entry="notesEntry" @close="notesOpen = false" />
  </section>
</template>
