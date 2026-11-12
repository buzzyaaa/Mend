// 主界面数据仓库：分类 + 条目（明文仅驻留内存，落库前由 Rust 侧加密）。

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { categoryApi, entryApi, isTauri } from '@/lib/ipc'
import { analyzePasswords, type PasswordIssue } from '@/lib/security'
import { buildManualOrders } from '@/lib/manualOrder'
import type { Category, EntryInput, EntryView } from '@/types'

/** 侧栏选中的桶：全部 / 星标 / 归档 / 未分类 / 回收站 / 某个分类 id */
export type Bucket = 'all' | 'starred' | 'archive' | 'uncategorized' | 'trash' | string

/** 列表排序：最近更新 / 名称 / 星标优先 / 手动排序 */
export type SortBy = 'updated' | 'title' | 'favorite' | 'manual'

export const useEntryStore = defineStore('entry', () => {
  const categories = ref<Category[]>([])
  const entries = ref<EntryView[]>([])
  const archived = ref<EntryView[]>([])
  const trash = ref<EntryView[]>([])
  const bucket = ref<Bucket>('all')
  const keyword = ref('')
  /** 标签过滤：点卡片上的标签 chip 设置，再点同一个清除。 */
  const tagFilter = ref<string | null>(null)
  const sortBy = ref<SortBy>('updated')
  const loading = ref(false)
  /**
   * 手动排序的本地顺序：bucket → 按拖拽结果排列的条目 id。
   * `EntryView.sortOrder` 由后端下发（同桶内升序），`refresh()` 时据此重建各桶顺序，
   * 使拖拽结果跨刷新 / 重启仍然生效（见 docs/04 §2.3 / docs/03 §3）。
   */
  const manualOrders = ref<Record<string, string[]>>({})

  const selectedCategoryId = computed<string | null>(() =>
    bucket.value === 'all' ||
    bucket.value === 'starred' ||
    bucket.value === 'archive' ||
    bucket.value === 'uncategorized' ||
    bucket.value === 'trash'
      ? null
      : bucket.value,
  )

  /** 关键字命中：标题 / 账号 / 邮箱 / 手机 / 网址 / 备注（备注为密文列，只能在内存里过滤）。 */
  function matches(entry: EntryView, kw: string): boolean {
    if (!kw) return true
    const haystack = [
      entry.title,
      entry.username,
      entry.email,
      entry.phone,
      entry.url ?? '',
      entry.notes,
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(kw)
  }

  const filteredEntries = computed(() => {
    const kw = keyword.value.trim().toLowerCase()
    const tag = tagFilter.value
    // 归档桶的数据源是 entry_archive_list（archived = 1），主列表（archived = 0）不参与。
    const isArchiveBucket = bucket.value === 'archive'
    const source = isArchiveBucket ? archived.value : entries.value
    const list = source.filter((item) => {
      if (isArchiveBucket && !item.archived) return false
      if (bucket.value === 'uncategorized' && item.categoryId) return false
      if (bucket.value === 'starred' && !item.favorite) return false
      if (
        !isArchiveBucket &&
        bucket.value !== 'all' &&
        bucket.value !== 'uncategorized' &&
        bucket.value !== 'trash' &&
        bucket.value !== 'starred' &&
        item.categoryId !== bucket.value
      ) {
        return false
      }
      if (tag && !item.tags.includes(tag)) return false
      return matches(item, kw)
    })

    const sorted = [...list]
    if (sortBy.value === 'manual') {
      // 手动排序：按当前桶的拖拽顺序升序；不在顺序表里的条目（新建 / 未拖拽）按
      // updatedAt 排在最后，避免与已固定的手动序混排。该顺序镜像后端 `sort_order`
      // （`EntryView.sortOrder` 随列表下发，refresh 后据此重建，见 docs/04 §2.3）。
      // 归档桶禁用拖拽，正常不会进入该分支，兜底仍按 updatedAt。
      const order = manualOrders.value[bucket.value] ?? []
      const rank = (id: string) => {
        const index = order.indexOf(id)
        return index < 0 ? Number.MAX_SAFE_INTEGER : index
      }
      sorted.sort((a, b) => rank(a.id) - rank(b.id) || b.updatedAt - a.updatedAt)
    } else if (isArchiveBucket) {
      // 归档桶：星标置顶逻辑不生效，一律按最近更新倒序（与回收站口径一致）。
      sorted.sort((a, b) => b.updatedAt - a.updatedAt)
    } else {
      // 其他排序模式下星标条目稳定置顶：先按 favorite 降序，再按各自排序键。
      const bySortKey = (a: EntryView, b: EntryView): number => {
        if (sortBy.value === 'title') return a.title.localeCompare(b.title, 'zh-Hans-CN')
        return b.updatedAt - a.updatedAt
      }
      sorted.sort((a, b) => Number(b.favorite) - Number(a.favorite) || bySortKey(a, b))
    }
    return sorted
  })

  const filteredTrash = computed(() => {
    const kw = keyword.value.trim().toLowerCase()
    return trash.value
      .filter((item) => matches(item, kw))
      .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
  })

  /** 当前列表实际渲染的数组：回收站桶用回收站数据，归档桶用归档数据。 */
  const visibleEntries = computed(() =>
    bucket.value === 'trash' ? filteredTrash.value : filteredEntries.value,
  )

  const isTrashView = computed(() => bucket.value === 'trash')
  const isArchiveView = computed(() => bucket.value === 'archive')
  const isStarredView = computed(() => bucket.value === 'starred')

  /** 密码体检结果：entryId → 弱密码 / 重复密码。 */
  const passwordIssues = computed<Map<string, PasswordIssue>>(() => analyzePasswords(entries.value))

  const uncategorizedCount = computed(() => entries.value.filter((item) => !item.categoryId).length)

  /** 星标条目数（侧栏「星标」桶计数）。 */
  const starredCount = computed(() => entries.value.filter((item) => item.favorite).length)

  /** 归档条目数（当前 UI 不在侧栏显示数字，仅作为可选计算属性保留）。 */
  const archivedCount = computed(() => archived.value.length)

  /** 从 Rust 侧拉全量分类与条目；浏览器预览下不做任何请求。 */
  async function refresh() {
    if (!isTauri()) return
    loading.value = true
    try {
      const [cats, list, trashList, archiveList] = await Promise.all([
        categoryApi.list(),
        entryApi.list(null, null),
        entryApi.listTrash(),
        entryApi.archiveList(),
      ])
      categories.value = cats
      entries.value = list
      trash.value = trashList
      archived.value = archiveList
      // 后端 `entry_list` 固定按 updated_at 返回，这里用下发的 `sortOrder` 重建各桶
      // 手动序，使拖拽顺序跨刷新 / 重启保留。
      manualOrders.value = buildManualOrders(list, cats)
    } finally {
      loading.value = false
    }
  }

  async function createCategory(name: string) {
    await categoryApi.create(name)
    await refresh()
  }

  async function renameCategory(id: string, name: string) {
    await categoryApi.rename(id, name)
    await refresh()
  }

  async function deleteCategory(id: string) {
    await categoryApi.remove(id)
    if (bucket.value === id) bucket.value = 'all'
    await refresh()
  }

  async function createEntry(input: EntryInput) {
    const created = await entryApi.create(input)
    await refresh()
    return created
  }

  async function updateEntry(id: string, input: EntryInput) {
    const updated = await entryApi.update(id, input)
    await refresh()
    return updated
  }

  /** 星标开关：复用 entries.favorite 列，直接更新后刷新列表。 */
  async function toggleStar(id: string) {
    const entry = entries.value.find((item) => item.id === id)
    if (!entry) return
    await updateEntry(id, { ...entry, url: entry.url ?? null, favorite: !entry.favorite })
    return !entry.favorite
  }

  async function deleteEntry(id: string) {
    await entryApi.remove(id)
    await refresh()
  }

  /** 回收站：恢复回原分类（分类已删除则回未分类）。 */
  async function restoreEntry(id: string) {
    await entryApi.restore(id)
    await refresh()
  }

  /** 回收站：彻底删除（物理删除，不可恢复）。 */
  async function purgeEntry(id: string) {
    await entryApi.purge(id)
    await refresh()
  }

  async function purgeAllTrash() {
    const count = await entryApi.purgeAll()
    await refresh()
    return count
  }

  /** 归档：条目移出主列表、进入归档列表（与回收站正交）。 */
  async function archiveEntry(id: string) {
    await entryApi.archive(id)
    await refresh()
  }

  /** 取消归档：条目回到主列表、移出归档列表。 */
  async function unarchiveEntry(id: string) {
    await entryApi.unarchive(id)
    await refresh()
  }

  /**
   * 仅更新内存里的手动顺序（拖拽过程中的实时反馈），不落库。
   * `ids` 为当前桶按新顺序排列的条目 id，与 `visibleEntries` 一一对应。
   */
  function setManualOrder(ids: string[]) {
    manualOrders.value[bucket.value] = ids
  }

  /**
   * 拖拽结束落库：先乐观更新内存顺序，再按顺序写后端 `sort_order = 0..n-1`；
   * 失败则回滚内存顺序并抛出，由组件提示。
   */
  async function reorder(ids: string[]) {
    const previous = manualOrders.value[bucket.value] ?? []
    manualOrders.value[bucket.value] = ids
    try {
      await entryApi.reorder(ids)
    } catch (err) {
      manualOrders.value[bucket.value] = previous
      throw err
    }
  }

  function setSortBy(next: SortBy) {
    sortBy.value = next
  }

  function selectBucket(next: Bucket) {
    bucket.value = next
    tagFilter.value = null
  }

  /** 点同一个标签取消过滤，点新标签切换。 */
  function toggleTagFilter(tag: string) {
    tagFilter.value = tagFilter.value === tag ? null : tag
  }

  function setKeyword(value: string) {
    keyword.value = value
  }

  /** 锁定清空：丢弃内存里全部解密后的明文（条目 / 回收站 / 分类随带的名称不算敏感），视图状态一并归零。 */
  function reset() {
    categories.value = []
    entries.value = []
    archived.value = []
    trash.value = []
    bucket.value = 'all'
    keyword.value = ''
    tagFilter.value = null
    sortBy.value = 'updated'
    manualOrders.value = {}
  }

  return {
    categories,
    entries,
    archived,
    trash,
    filteredEntries,
    filteredTrash,
    visibleEntries,
    isTrashView,
    isArchiveView,
    isStarredView,
    passwordIssues,
    uncategorizedCount,
    starredCount,
    archivedCount,
    bucket,
    selectedCategoryId,
    keyword,
    tagFilter,
    sortBy,
    loading,
    manualOrders,
    refresh,
    createCategory,
    renameCategory,
    deleteCategory,
    createEntry,
    updateEntry,
    toggleStar,
    deleteEntry,
    restoreEntry,
    purgeEntry,
    purgeAllTrash,
    archiveEntry,
    unarchiveEntry,
    setManualOrder,
    reorder,
    setSortBy,
    selectBucket,
    setKeyword,
    toggleTagFilter,
    reset,
  }
})
