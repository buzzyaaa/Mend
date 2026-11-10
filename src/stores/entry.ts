// 主界面数据仓库：分类 + 条目（明文仅驻留内存，落库前由 Rust 侧加密）。

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { categoryApi, entryApi, isTauri } from '@/lib/ipc'
import { analyzePasswords, type PasswordIssue } from '@/lib/security'
import type { Category, EntryInput, EntryView } from '@/types'

/** 侧栏选中的桶：全部 / 未分类 / 回收站 / 某个分类 id */
export type Bucket = 'all' | 'uncategorized' | 'trash' | string

/** 列表排序：最近更新 / 标题 / 收藏优先 */
export type SortBy = 'updated' | 'title' | 'favorite'

export const useEntryStore = defineStore('entry', () => {
  const categories = ref<Category[]>([])
  const entries = ref<EntryView[]>([])
  const trash = ref<EntryView[]>([])
  const bucket = ref<Bucket>('all')
  const keyword = ref('')
  const sortBy = ref<SortBy>('updated')
  const loading = ref(false)

  const selectedCategoryId = computed<string | null>(() =>
    bucket.value === 'all' || bucket.value === 'uncategorized' || bucket.value === 'trash'
      ? null
      : bucket.value,
  )

  /** 关键字命中：标题 / 账号 / 邮箱 / 手机 / 网址 / 备注（备注为密文列，只能在内存里过滤）。 */
  function matches(entry: EntryView, kw: string): boolean {
    if (!kw) return true
    const haystack = [entry.title, entry.username, entry.email, entry.phone, entry.url ?? '', entry.notes]
      .join(' ')
      .toLowerCase()
    return haystack.includes(kw)
  }

  const filteredEntries = computed(() => {
    const kw = keyword.value.trim().toLowerCase()
    const list = entries.value.filter((item) => {
      if (bucket.value === 'uncategorized' && item.categoryId) return false
      if (
        bucket.value !== 'all' &&
        bucket.value !== 'uncategorized' &&
        bucket.value !== 'trash' &&
        item.categoryId !== bucket.value
      ) {
        return false
      }
      return matches(item, kw)
    })

    const sorted = [...list]
    if (sortBy.value === 'title') {
      sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
    } else if (sortBy.value === 'favorite') {
      sorted.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt)
    } else {
      sorted.sort((a, b) => b.updatedAt - a.updatedAt)
    }
    return sorted
  })

  const filteredTrash = computed(() => {
    const kw = keyword.value.trim().toLowerCase()
    return trash.value
      .filter((item) => matches(item, kw))
      .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
  })

  /** 当前列表实际渲染的数组：回收站桶用回收站数据。 */
  const visibleEntries = computed(() =>
    bucket.value === 'trash' ? filteredTrash.value : filteredEntries.value,
  )

  const isTrashView = computed(() => bucket.value === 'trash')

  /** 密码体检结果：entryId → 弱密码 / 重复密码。 */
  const passwordIssues = computed<Map<string, PasswordIssue>>(() => analyzePasswords(entries.value))

  const uncategorizedCount = computed(() => entries.value.filter((item) => !item.categoryId).length)


  /** 从 Rust 侧拉全量分类与条目；浏览器预览下不做任何请求。 */
  async function refresh() {
    if (!isTauri()) return
    loading.value = true
    try {
      const [cats, list, trashList] = await Promise.all([
        categoryApi.list(),
        entryApi.list(null, null),
        entryApi.listTrash(),
      ])
      categories.value = cats
      entries.value = list
      trash.value = trashList
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

  function setSortBy(next: SortBy) {
    sortBy.value = next
  }

  function selectBucket(next: Bucket) {
    bucket.value = next
  }

  function setKeyword(value: string) {
    keyword.value = value
  }

  return {
    categories,
    entries,
    trash,
    filteredEntries,
    filteredTrash,
    visibleEntries,
    isTrashView,
    passwordIssues,
    uncategorizedCount,
    bucket,
    selectedCategoryId,
    keyword,
    sortBy,
    loading,
    refresh,
    createCategory,
    renameCategory,
    deleteCategory,
    createEntry,
    updateEntry,
    deleteEntry,
    restoreEntry,
    purgeEntry,
    purgeAllTrash,
    setSortBy,
    selectBucket,
    setKeyword,
  }
})
