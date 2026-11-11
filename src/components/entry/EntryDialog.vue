<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEntryStore } from '@/stores/entry'
import { usePresetStore } from '@/stores/preset'
import { useToast } from '@/composables/useToast'
import { generatorApi } from '@/lib/ipc'
import { renderMarkdown } from '@/lib/markdown'
import type { EntryInput, EntryView, GeneratorOptions, PresetFieldType } from '@/types'

const props = defineProps<{
  open: boolean
  entry: EntryView | null
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()
const store = useEntryStore()
const presetStore = usePresetStore()
const toast = useToast()

const busy = ref(false)
const formError = ref('')
const notesTab = ref<'edit' | 'preview'>('edit')

// 生成器面板：只在弹窗内存在，关闭即丢弃，生成的密码仅在填入后随条目加密落库。
const showGenerator = ref(false)
const generated = ref('')
const generatorError = ref('')
const generatorOptions = reactive<GeneratorOptions>({
  length: 16,
  uppercase: true,
  lowercase: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
})

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
  tags: [],
})

/** 标签在表单里以逗号分隔输入，提交时拆分成数组。 */
const tagsText = ref('')

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
  tagsText.value = entry?.tags.join(', ') ?? ''
  notesTab.value = 'edit'
  formError.value = ''
  showGenerator.value = false
  generated.value = ''
  generatorError.value = ''
}

watch(
  () => [props.open, props.entry?.id] as const,
  ([open]) => {
    if (!open) return
    fillFrom(props.entry)
    presetStore.refresh().catch(() => {
      // 未解锁 / 浏览器预览：静默，下拉只是不显示
    })
  },
  { immediate: true },
)

/** 从预设下拉选中后填入对应字段。 */
function applyPreset(field: PresetFieldType, event: Event) {
  const select = event.target as HTMLSelectElement
  const preset = presetStore.presets.find((item) => item.id === select.value)
  if (preset) {
    if (field === 'username') form.username = preset.value
    else if (field === 'email') form.email = preset.value
    else form.phone = preset.value
  }
  select.value = ''
}

async function generate() {
  generatorError.value = ''
  try {
    generated.value = await generatorApi.generate({ ...generatorOptions })
  } catch (err) {
    generatorError.value = messageOf(err)
  }
}

function fillGenerated() {
  if (!generated.value) return
  form.password = generated.value
  showGenerator.value = false
}

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
    tags: tagsText.value
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0),
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
            <option v-for="cat in store.categories" :key="cat.id" :value="cat.id">
              {{ cat.name }}
            </option>
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

        <div class="block">
          <span class="mb-1 block text-xs text-muted-foreground">{{ t('entry.username') }}</span>
          <div class="flex gap-1">
            <input
              v-model="form.username"
              class="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <select
              v-if="presetStore.grouped.username.length"
              class="shrink-0 rounded-md border border-input bg-background px-1 text-xs text-muted-foreground outline-none"
              @change="applyPreset('username', $event)"
            >
              <option value="">{{ t('preset.choose') }}</option>
              <option v-for="p in presetStore.grouped.username" :key="p.id" :value="p.id">
                {{ p.label }}
              </option>
            </select>
          </div>
        </div>

        <div class="block">
          <span class="mb-1 block text-xs text-muted-foreground">{{ t('entry.password') }}</span>
          <div class="flex gap-1">
            <input
              v-model="form.password"
              type="text"
              autocomplete="off"
              class="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              class="shrink-0 rounded-md border border-input px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              @click="showGenerator = !showGenerator"
            >
              {{ t('generator.open') }}
            </button>
          </div>

          <!-- 生成器面板 -->
          <div
            v-if="showGenerator"
            class="mt-2 space-y-2 rounded-md border border-dashed border-border p-2"
          >
            <div class="flex items-center gap-2 text-xs">
              <span class="text-muted-foreground">{{ t('generator.length') }}</span>
              <input
                v-model.number="generatorOptions.length"
                type="number"
                min="6"
                max="64"
                class="w-16 rounded border border-input bg-background px-2 py-1 text-xs outline-none"
              />
              <span class="flex-1 text-muted-foreground">{{ t('generator.hint') }}</span>
            </div>

            <div class="flex flex-wrap items-center gap-3 text-xs">
              <label class="flex items-center gap-1">
                <input v-model="generatorOptions.uppercase" type="checkbox" />
                {{ t('generator.uppercase') }}
              </label>
              <label class="flex items-center gap-1">
                <input v-model="generatorOptions.lowercase" type="checkbox" />
                {{ t('generator.lowercase') }}
              </label>
              <label class="flex items-center gap-1">
                <input v-model="generatorOptions.digits" type="checkbox" />
                {{ t('generator.digits') }}
              </label>
              <label class="flex items-center gap-1">
                <input v-model="generatorOptions.symbols" type="checkbox" />
                {{ t('generator.symbols') }}
              </label>
              <label class="flex items-center gap-1">
                <input v-model="generatorOptions.excludeAmbiguous" type="checkbox" />
                {{ t('generator.excludeAmbiguous') }}
              </label>
            </div>

            <div class="rounded bg-muted px-2 py-1 font-mono text-xs break-all">
              {{ generated || '—' }}
            </div>

            <p v-if="generatorError" class="text-xs text-destructive">{{ generatorError }}</p>

            <div class="flex justify-end gap-2 text-xs">
              <button
                type="button"
                class="rounded px-2 py-1 text-muted-foreground hover:bg-accent"
                @click="generate"
              >
                {{ t('generator.regenerate') }}
              </button>
              <button
                type="button"
                class="rounded bg-primary px-2 py-1 text-primary-foreground disabled:opacity-60"
                :disabled="!generated"
                @click="fillGenerated"
              >
                {{ t('generator.fill') }}
              </button>
            </div>
          </div>
        </div>

        <div class="block">
          <span class="mb-1 block text-xs text-muted-foreground">{{ t('entry.email') }}</span>
          <div class="flex gap-1">
            <input
              v-model="form.email"
              class="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <select
              v-if="presetStore.grouped.email.length"
              class="shrink-0 rounded-md border border-input bg-background px-1 text-xs text-muted-foreground outline-none"
              @change="applyPreset('email', $event)"
            >
              <option value="">{{ t('preset.choose') }}</option>
              <option v-for="p in presetStore.grouped.email" :key="p.id" :value="p.id">
                {{ p.label }}
              </option>
            </select>
          </div>
        </div>

        <div class="block">
          <span class="mb-1 block text-xs text-muted-foreground">{{ t('entry.phone') }}</span>
          <div class="flex gap-1">
            <input
              v-model="form.phone"
              class="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <select
              v-if="presetStore.grouped.phone.length"
              class="shrink-0 rounded-md border border-input bg-background px-1 text-xs text-muted-foreground outline-none"
              @change="applyPreset('phone', $event)"
            >
              <option value="">{{ t('preset.choose') }}</option>
              <option v-for="p in presetStore.grouped.phone" :key="p.id" :value="p.id">
                {{ p.label }}
              </option>
            </select>
          </div>
        </div>

        <label class="flex items-center gap-2 sm:col-span-2">
          <input v-model="form.favorite" type="checkbox" class="h-4 w-4 accent-current" />
          <span class="text-sm">{{ t('entry.favorite') }}</span>
        </label>

        <label class="block sm:col-span-2">
          <span class="mb-1 block text-xs text-muted-foreground">{{ t('entry.tags') }}</span>
          <input
            v-model="tagsText"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            :placeholder="t('entry.tagsPlaceholder')"
          />
        </label>

        <div class="sm:col-span-2">
          <div class="mb-1 flex items-center justify-between">
            <span class="text-xs text-muted-foreground">{{ t('entry.notes') }}</span>
            <div class="flex gap-1 rounded-md bg-muted p-0.5 text-xs">
              <button
                type="button"
                class="rounded px-2 py-0.5"
                :class="
                  notesTab === 'edit' ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground'
                "
                @click="notesTab = 'edit'"
              >
                {{ t('entry.notesEdit') }}
              </button>
              <button
                type="button"
                class="rounded px-2 py-0.5"
                :class="
                  notesTab === 'preview' ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground'
                "
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
