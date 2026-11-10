<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEntryStore } from '@/stores/entry'
import { useToast } from '@/composables/useToast'
import { renderMarkdown } from '@/lib/markdown'
import type { EntryInput, EntryView } from '@/types'

const props = defineProps<{
  open: boolean
  entry: EntryView | null
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()
const store = useEntryStore()
const toast = useToast()

const busy = ref(false)
const formError = ref('')
const notesTab = ref<'edit' | 'preview'>('edit')

const form = reactive<EntryInput>({
  categoryId: null,
  title: '',
  url: null,
  username: '',
  password: '',
  email: '',
  phone: '',
  notes: '',
  favorite: false,
})

const heading = computed(() => (props.entry ? t('entry.dialogEdit') : t('entry.dialogCreate')))
const previewHtml = computed(() => renderMarkdown(form.notes))

function fillFrom(entry: EntryView | null) {
  form.categoryId = entry?.categoryId ?? null
  form.title = entry?.title ?? ''
  form.url = entry?.url ?? null
  form.username = entry?.username ?? ''
  form.password = entry?.password ?? ''
  form.email = entry?.email ?? ''
  form.phone = entry?.phone ?? ''
  form.notes = entry?.notes ?? ''
  form.favorite = entry?.favorite ?? false
  notesTab.value = 'edit'
  formError.value = ''
}

watch(
  () => [props.open, props.entry?.id] as const,
  ([open]) => {
    if (open) fillFrom(props.entry)
  },
  { immediate: true },
)

async function save() {
  formError.value = ''
  const title = form.title.trim()
  if (!title) {
    formError.value = t('entry.titleRequired')
    return
  }

  const input: EntryInput = {
    categoryId: form.categoryId || null,
    title,
    url: form.url?.trim() || null,
    username: form.username,
    password: form.password,
    email: form.email,
    phone: form.phone,
    notes: form.notes,
    favorite: form.favorite,
  }

  busy.value = true
  try {
    if (props.entry) {
      await store.updateEntry(props.entry.id, input)
    } else {
      await store.createEntry(input)
    }
    toast.success(t('toast.saved'))
    emit('close')
  } catch (err) {
    formError.value = messageOf(err)
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (!props.entry) return
  if (!window.confirm(t('entry.deleteConfirm'))) return
  busy.value = true
  try {
    await store.deleteEntry(props.entry.id)
    toast.success(t('toast.deleted'))
    emit('close')
  } catch (err) {
    formError.value = messageOf(err)
  } finally {
    busy.value = false
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-2xl rounded-xl border border-border bg-card p-5 shadow-lg">
      <h3 class="mb-3 text-base font-semibold">{{ heading }}</h3>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="block sm:col-span-2">
          <span class="mb-1 block text-xs text-muted-foreground">{{ t('entry.title') }} *</span>
          <input
            v-model="form.title"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            maxlength="120"
          />
        </label>

        <label class="block">
          <span class="mb-1 block text-xs text-muted-foreground">{{ t('entry.category') }}</span>
          <select
            v-model="form.categoryId"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option :value="null">{{ t('entry.uncategorized') }}</option>
            <option v-for="cat in store.categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
          </select>
        </label>

        <label class="block">
          <span class="mb-1 block text-xs text-muted-foreground">{{ t('entry.url') }}</span>
          <input
            v-model="form.url"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="https://"
          />
        </label>

        <label class="block">
          <span class="mb-1 block text-xs text-muted-foreground">{{ t('entry.username') }}</span>
          <input
            v-model="form.username"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        <label class="block">
          <span class="mb-1 block text-xs text-muted-foreground">{{ t('entry.password') }}</span>
          <input
            v-model="form.password"
            type="text"
            autocomplete="off"
            class="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        <label class="block">
          <span class="mb-1 block text-xs text-muted-foreground">{{ t('entry.email') }}</span>
          <input
            v-model="form.email"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        <label class="block">
          <span class="mb-1 block text-xs text-muted-foreground">{{ t('entry.phone') }}</span>
          <input
            v-model="form.phone"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        <label class="flex items-center gap-2 sm:col-span-2">
          <input v-model="form.favorite" type="checkbox" class="h-4 w-4 accent-current" />
          <span class="text-sm">{{ t('entry.favorite') }}</span>
        </label>

        <div class="sm:col-span-2">
          <div class="mb-1 flex items-center justify-between">
            <span class="text-xs text-muted-foreground">{{ t('entry.notes') }}</span>
            <div class="flex gap-1 rounded-md bg-muted p-0.5 text-xs">
              <button
                type="button"
                class="rounded px-2 py-0.5"
                :class="notesTab === 'edit' ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground'"
                @click="notesTab = 'edit'"
              >
                {{ t('entry.notesEdit') }}
              </button>
              <button
                type="button"
                class="rounded px-2 py-0.5"
                :class="notesTab === 'preview' ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground'"
                @click="notesTab = 'preview'"
              >
                {{ t('entry.notesPreview') }}
              </button>
            </div>
          </div>

          <textarea
            v-if="notesTab === 'edit'"
            v-model="form.notes"
            rows="7"
            class="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:ring-2 focus:ring-ring"
            :placeholder="t('entry.notesPlaceholder')"
          />
          <div
            v-else
            class="min-h-[10rem] overflow-x-auto rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed"
          >
            <template v-if="form.notes.trim()">
              <!-- 渲染结果是白名单标签，原始 HTML 已被转义 -->
              <div v-html="previewHtml"></div>
            </template>
            <p v-else class="text-xs text-muted-foreground">{{ t('entry.noNotes') }}</p>
          </div>
        </div>
      </div>

      <p v-if="formError" class="mt-3 text-xs text-destructive">{{ formError }}</p>

      <div class="mt-4 flex items-center justify-between">
        <button
          v-if="entry"
          type="button"
          class="rounded-md px-3 py-1.5 text-sm text-destructive hover:bg-accent disabled:opacity-60"
          :disabled="busy"
          @click="remove"
        >
          {{ t('common.delete') }}
        </button>
        <span v-else></span>

        <div class="flex gap-2">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
            @click="emit('close')"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-60"
            :disabled="busy"
            @click="save"
          >
            {{ t('common.save') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
