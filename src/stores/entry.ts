// 主界面数据仓库：分类 + 条目（明文仅驻留内存，落库前由 Rust 侧加密）。

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { categoryApi, entryApi, isTauri } from '@/lib/ipc'
import type { Category, EntryInput, EntryView } from '@/types'

/** 侧栏选中的桶：全部 / 未分类 / 某个分类 id */
export type Bucket = 'all' | 'uncategorized' | string

export const useEntryStore = defineStore('entry', () => {
  const categories = ref<Category[]>([])
  const entries = ref<EntryView[]>([])
  const bucket = ref<Bucket>('all')
  const keyword = ref('')
  const loading = ref(false)

  const selectedCategoryId = computed<string | null>(() =>
    bucket.value === 'all' || bucket.value === 'uncategorized' ? null : bucket.value,
  )

  const filteredEntries = computed(() => {
    const kw = keyword.value.trim().toLowerCase()
    return entries.value.filter((item) => {
      if (bucket.value === 'uncategorized' && item.categoryId) return false
      if (bucket.value !== 'all' && bucket.value !== 'uncategorized' && item.categoryId !== bucket.value) {
        return false
      }
      if (!kw) return true
      const haystack = [item.title, item.username, item.email, item.phone, item.url ?? '']
        .join(' ')
        .toLowerCase()
      return haystack.includes(kw)
    })
  })

  const uncategorizedCount = computed(() => entries.value.filter((item) => !item.categoryId).length)

  /** 从 Rust 侧拉全量分类与条目；浏览器预览下不做任何请求。 */
  async function refresh() {
    if (!isTauri()) return
    loading.value = true
    try {
      const [cats, list] = await Promise.all([categoryApi.list(), entryApi.list(null, null)])
      categories.value = cats
      entries.value = list
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

  function selectBucket(next: Bucket) {
    bucket.value = next
  }

  function setKeyword(value: string) {
    keyword.value = value
  }

  return {
    categories,
    entries,
    filteredEntries,
    uncategorizedCount,
    bucket,
    selectedCategoryId,
    keyword,
    loading,
    refresh,
    createCategory,
    renameCategory,
    deleteCategory,
    createEntry,
    updateEntry,
    deleteEntry,
    selectBucket,
    setKeyword,
  }
})
