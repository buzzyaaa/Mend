import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Category, EntryView } from '@/types'

export const useEntryStore = defineStore('entry', () => {
  const categories = ref<Category[]>([])
  const entries = ref<EntryView[]>([])
  const selectedCategoryId = ref<string | null>(null)
  const keyword = ref('')

  function setCategories(list: Category[]) {
    categories.value = list
  }

  function setEntries(list: EntryView[]) {
    entries.value = list
  }

  function selectCategory(id: string | null) {
    selectedCategoryId.value = id
  }

  function setKeyword(value: string) {
    keyword.value = value
  }

  return { categories, entries, selectedCategoryId, keyword, setCategories, setEntries, selectCategory, setKeyword }
})
