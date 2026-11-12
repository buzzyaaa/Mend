<script setup lang="ts">
// 条目列表（Data Table 版）：搜索 / 排序 / 备注缩略 + 展开看完整 Markdown / 随时编辑。
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Sortable from 'sortablejs'
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
import { isTauri } from '@/lib/ipc'
import { OVERLAY_TARGET } from '@/lib/theme'
import { resolveCategoryIcon } from '@/lib/categoryIcons'
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
/** 表格根节点：SortableJS 需要拿到 naive-ui 内部真实渲染的 `<tbody>`，故包一层 ref。 */
const tableWrapRef = ref<HTMLElement | null>(null)

// —— 手动排序拖拽（SortableJS，直接操作 naive-ui 渲染出的真实 `<tbody>`）——
// 主列表（全部 / 未分类 / 具体分类）始终显示拖拽手柄；拖拽即切到「手动排序」并按
// 后端 `sort_order` 落库。回收站 / 星标 / 归档视图不启用（非单一手动序或只读）。
const dragEnabled = computed(
  () => !store.isTrashView && !store.isArchiveView && !store.isStarredView,
)

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

// —— 响应式列宽：按表格容器宽度分档，小屏收窄 / 隐藏次要列，避免固定 scrollX
// 把表格撑到 1300+ 导致最右侧操作列被挤出视口、无法点击。
type WidthTier = 'normal' | 'compact' | 'tiny'

interface TierWidths {
  drag: number
  expand: number
  title: number
  username: number
  email: number
  phone: number
  password: number
  category: number
  notes: number
  status: number
  actions: number
}

const TIER_WIDTHS: Record<WidthTier, TierWidths> = {
  // 正常档沿用现有列宽，宽屏行为不变。
  normal: {
    drag: 34,
    expand: 36,
    title: 160,
    username: 150,
    email: 160,
    phone: 140,
    password: 170,
    category: 132,
    notes: 160,
    status: 84,
    actions: 128,
  },
  // 紧凑档（700-1023）：内容列收窄（默认值之和已控制在 700 内）；
  // 操作列按「三个图标按钮 / 回收站两个文字按钮」中更宽者留足宽度。
  compact: {
    drag: 30,
    expand: 30,
    title: 72,
    username: 60,
    email: 64,
    phone: 48,
    password: 80,
    category: 66,
    notes: 64,
    status: 46,
    // 操作列需容纳三个图标按钮；回收站视图是两个文字按钮（更宽），故留余量。
    actions: 112,
  },
  // 极窄档（<700）：隐藏 email / phone / notes 三个低频字段列（内容仍可在
  // 展开行查看），其余列进一步收窄，保证操作列始终可见。
  tiny: {
    drag: 28,
    expand: 30,
    title: 64,
    username: 56,
    email: 0,
    phone: 0,
    password: 76,
    category: 62,
    notes: 0,
    status: 44,
    // 操作列在极窄档仍需容纳回收站视图的两个文字按钮（比图标按钮宽）。
    actions: 128,
  },
}

/**
 * 表格容器宽度：ResizeObserver 监听（兜底 window resize），驱动列宽档位与 scrollX。
 * 初始值先按窗口宽度估算（侧栏 w-60 + 列表左右 p-4 ≈ 272px），mount 后由
 * ResizeObserver 校正，避免首帧误落 tiny 档导致列闪烁。
 */
const tableWidth = ref(
  typeof window !== 'undefined' ? Math.max(480, window.innerWidth - 272) : 1280,
)
let resizeObserver: ResizeObserver | null = null

const tier = computed<WidthTier>(() => {
  const w = tableWidth.value
  if (w >= 1024) return 'normal'
  if (w >= 700) return 'compact'
  return 'tiny'
})

/** compact / tiny 档：列宽取 TIER_WIDTHS 中对应档位。 */
const tierWidths = computed(() => TIER_WIDTHS[tier.value])

/** tiny 档隐藏的低频字段列（email / phone / notes）；展开行仍可查看完整内容。 */
const hideEmail = computed(() => tier.value === 'tiny')
const hidePhone = computed(() => tier.value === 'tiny')
const hideNotes = computed(() => tier.value === 'tiny')

/** 当前档位实际渲染的列宽之和（作为 scrollX 的内容最小宽度兜底）。 */
const tierColumnSum = computed(() => {
  const w = tierWidths.value
  const hideCategory = store.selectedCategoryId !== null
  return (
    w.expand +
    w.title +
    w.username +
    (hideEmail.value ? 0 : w.email) +
    (hidePhone.value ? 0 : w.phone) +
    w.password +
    (hideCategory ? 0 : w.category) +
    (hideNotes.value ? 0 : w.notes) +
    w.status +
    w.actions
  )
})

const scrollX = computed(() => {
  const w = tierWidths.value
  const extra = dragEnabled.value ? w.drag : 0
  if (tier.value === 'normal') {
    // 宽屏沿用既有固定阈值，保持当前行为不变。
    return store.selectedCategoryId ? 1180 + extra : 1312 + extra
  }
  // 小屏以容器宽度为准（不低于内容最小宽度）：表格铺满容器、列按 minWidth 收缩，
  // 不再强制出现横向滚动，最右侧操作列始终落在视口右边缘。
  const minWidth = tierColumnSum.value + extra
  return tableWidth.value ? Math.max(minWidth, tableWidth.value) : minWidth
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

async function openUrl(url: string) {
  if (!url) return
  // 无 scheme 的网址（如 example.com）直接打开会被解析成相对应用自身 origin 的路径，
  // 统一补 https://；与展开区 ExternalLink 按钮共用同一打开机制。
  const normalized = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
  if (isTauri()) {
    // Tauri 生产环境经 opener 插件唤起系统浏览器（跨平台，不受 WebView 限制）。
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(normalized)
  } else {
    // 浏览器预览环境无 opener 插件，回退原生 window.open。
    window.open(normalized, '_blank', 'noopener,noreferrer')
  }
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

// —— 拖拽排序（SortableJS）：直接绑定 naive-ui 渲染出的真实 `<tbody>`，绕开 rowProps 事件转发不可靠问题 ——

/**
 * naive-ui row-props：**始终**给 <tr> 打 `data-id`，Sortable 据此把 DOM 行映射回条目 id；
 * 拖拽启用时附加行高亮类（拖拽中的视觉由 Sortable 的 ghost/chosen/drag 类负责）。
 */
function rowProps(row: EntryView) {
  return {
    'data-id': row.id,
    ...(dragEnabled.value ? { class: 'mend-drag-row' } : {}),
  }
}

let sortableInstance: Sortable | null = null

function setupSortable() {
  if (!dragEnabled.value) return
  const tbody = tableWrapRef.value?.querySelector('tbody')
  if (!tbody || sortableInstance) return
  sortableInstance = Sortable.create(tbody, {
    handle: '.drag-handle',
    animation: 200,
    ghostClass: 'mend-drag-ghost',
    chosenClass: 'mend-drag-chosen',
    dragClass: 'mend-drag-dragging',
    onEnd: () => {
      const ids = Array.from(tbody!.querySelectorAll('tr[data-id]'))
        .map((tr) => tr.getAttribute('data-id'))
        .filter(Boolean) as string[]
      if (!ids.length) return
      // 在「最近更新 / 名称 / 星标优先」下拖拽：先切到「手动排序」再落库，否则拖拽结果
      // 只写库、界面仍按原排序键展示（用户看到的就是"拖了没反应"）。
      if (store.sortBy !== 'manual') store.setSortBy('manual')
      store
        .reorder(ids)
        .then(() => toast.success(t('entry.reorderSaved')))
        .catch((err: unknown) => {
          toast.error(t('toast.failed', { message: messageOf(err) }))
        })
    },
  })
}

function destroySortable() {
  sortableInstance?.destroy()
  sortableInstance = null
}

function syncTableWidth() {
  if (tableWrapRef.value) tableWidth.value = tableWrapRef.value.clientWidth
}

function handleWindowResize() {
  syncTableWidth()
}

onMounted(() => {
  nextTick(() => {
    setupSortable()
    syncTableWidth()
    if (typeof ResizeObserver !== 'undefined' && tableWrapRef.value) {
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0]
        if (entry) tableWidth.value = entry.contentRect.width
      })
      resizeObserver.observe(tableWrapRef.value)
    } else {
      // 兜底：环境不支持 ResizeObserver 时监听窗口尺寸。
      window.addEventListener('resize', handleWindowResize)
    }
  })
})

onBeforeUnmount(() => {
  destroySortable()
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('resize', handleWindowResize)
})

watch(
  () => [dragEnabled.value, store.bucket] as const,
  () => {
    // 视图切换（如 全部 ↔ 具体分类）会重建表格行，重新挂载 Sortable 才能在新 tbody 上生效。
    if (dragEnabled.value) nextTick(setupSortable)
    else destroySortable()
  },
)

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
    // 拖拽手柄列：主列表（全部 / 未分类 / 具体分类）始终出现，回收站 / 星标 / 归档视图不启用拖拽。
    ...(dragEnabled.value
      ? [
          {
            title: '',
            key: '__drag',
            width: tierWidths.value.drag,
            className: 'text-center',
            render: () =>
              h(
                'span',
                {
                  class:
                    'drag-handle inline-flex cursor-grab items-center justify-center text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground active:cursor-grabbing',
                  title: t('entry.dragHint'),
                  'aria-label': t('entry.dragHint'),
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
      width: tierWidths.value.expand,
      renderExpand: (row) => renderExpand(row),
    },
    {
      title: t('entry.title'),
      key: 'title',
      minWidth: tierWidths.value.title,
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
      width: tierWidths.value.username,
      ellipsis: { tooltip: true },
      render: (row) => copyableCell(row.username),
    },
    // 极窄档隐藏 email / phone（内容仍可在展开行查看）：这两列在极窄容器下
    // 几乎放不下有效字符，保留只会逼出横向滚动条、把操作列挤出视口。
    ...(hideEmail.value
      ? []
      : [
          {
            title: t('entry.email'),
            key: 'email',
            width: tierWidths.value.email,
            ellipsis: { tooltip: true },
            render: (row) => copyableCell(row.email),
          } satisfies DataTableColumns<EntryView>[number],
        ]),
    ...(hidePhone.value
      ? []
      : [
          {
            title: t('entry.phone'),
            key: 'phone',
            width: tierWidths.value.phone,
            ellipsis: { tooltip: true },
            render: (row) => copyableCell(row.phone),
          } satisfies DataTableColumns<EntryView>[number],
        ]),
    {
      title: t('entry.password'),
      key: 'password',
      width: tierWidths.value.password,
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
            width: tierWidths.value.category,
            ellipsis: { tooltip: true },
            render: (row: EntryView) => {
              const cat = categoryOf(row.categoryId)
              return h(
                'div',
                {
                  class: 'flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5',
                },
                [
                  // 分类图标跟随分类文字颜色。注意必须用 NIcon 的 `color` prop：
                  // 图标 svg 用 `fill: currentColor`，而 NIcon 的 mergedStyle 会输出
                  // `color: undefined`，normalizeStyle 合并数组时会覆盖掉 attrs 里的
                  // `style.color`，导致 style 写法无效。
                  h(NIcon, {
                    component: resolveCategoryIcon(cat?.icon),
                    size: 14,
                    color: cat?.color || undefined,
                  }),
                  h(
                    NText,
                    {
                      class: 'min-w-0 flex-1 truncate',
                      style: cat?.color ? { color: cat.color } : undefined,
                    },
                    () => categoryName(row.categoryId),
                  ),
                ],
              )
            },
          } satisfies DataTableColumns<EntryView>[number],
        ]),
    // 极窄档隐藏备注列：完整内容始终可在展开行查看，保留窄列只会挤压主字段。
    ...(hideNotes.value
      ? []
      : [
          {
            title: t('entry.notes'),
            key: 'notes',
            minWidth: tierWidths.value.notes,
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
          } satisfies DataTableColumns<EntryView>[number],
        ]),
    {
      title: t('entry.status'),
      key: '__status',
      width: tierWidths.value.status,
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
      minWidth: tierWidths.value.actions,
      render: (row) => {
        if (store.isTrashView) {
          return h('div', { class: 'flex items-center gap-1 whitespace-nowrap' }, [
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
          // 归档视图：提供「取消归档」与「删除」（删除走二次确认，软删进回收站可恢复）。
          return h('div', { class: 'flex items-center gap-1 whitespace-nowrap' }, [
            iconBtn(ArchiveRestore, t('entry.unarchive'), () => unarchiveEntry(row)),
            iconBtn(Trash2, t('common.delete'), () => confirmDeleteArchived(row)),
          ])
        }
        // 普通视图：编辑 / 归档 / 删除。归档与删除均走二次确认。
        return h('div', { class: 'flex items-center gap-1 whitespace-nowrap' }, [
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

/** 归档视图删除二次确认：软删除进回收站，可恢复（后端已移除归档守卫）。 */
function confirmDeleteArchived(entry: EntryView) {
  dialog.warning({
    title: t('common.delete'),
    content: t('entry.archiveDeleteConfirm', { title: entry.title }),
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
      <div ref="tableWrapRef" class="flex min-h-0 flex-1">
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
    </div>

    <EntryDialog :open="dialogOpen" :entry="editing" @close="dialogOpen = false" />
    <NotesDialog :open="notesOpen" :entry="notesEntry" @close="notesOpen = false" />
  </section>
</template>
