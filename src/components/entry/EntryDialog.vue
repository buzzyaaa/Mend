<script setup lang="ts">
import { computed, reactive, ref, watch, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEntryStore } from '@/stores/entry'
import { usePresetStore } from '@/stores/preset'
import { useMessage } from 'naive-ui'
import { generatorApi } from '@/lib/ipc'
import { renderMarkdown } from '@/lib/markdown'
import type { EntryInput, EntryView, GeneratorOptions, PresetFieldType } from '@/types'
import { NButton, NInput, NSelect, NCheckbox, NDivider, NRadioGroup, NRadio, NText, NTag } from 'naive-ui'

const props = defineProps<{
  open: boolean
  entry: EntryView | null
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()
const store = useEntryStore()
const generatorLength = computed(() => generatorOptions.length.toString())
const presetStore = usePresetStore()
const message = useMessage()

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
    message.success(t('toast.saved'))
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
    message.success(t('toast.deleted'))
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
    class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-2xl rounded-xl border border-border bg-card p-5 shadow-lg">
      <h3 class="mb-4 text-lg font-semibold">{{ heading }}</h3>

      <div class="space-y-3">
        <NInput
          v-model:value="form.title"
          :placeholder="t('entry.title')"
          :maxlength="120"
          show-count
        />

        <div class="grid grid-cols-2 gap-3">
          <NSelect
            v-model:value="form.categoryId"
            :options="[{ label: t('entry.uncategorized'), value: null as any }].concat(
              store.categories.map((cat) => ({
                label: cat.name,
                value: cat.id,
              }))
            )"
            :placeholder="t('entry.category')"
          />
          <NInput
            v-model:value="form.url"
            :placeholder="t('entry.url')"
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <span class="mb-1 block text-xs text-muted-foreground">{{ t('entry.username') }}</span>
            <div class="flex gap-1">
              <NInput
                v-model:value="form.username"
                class="min-w-0 flex-1"
              />
              <NSelect
                v-if="presetStore.grouped.username.length"
                v-model:value="form.username"
                :options="[{ label: t('preset.choose'), value: '' as any }].concat(
                  presetStore.grouped.username.map((p) => ({
                    label: p.label,
                    value: p.id,
                  }))
                )"
                class="shrink-0 w-24"
              />
            </div>
          </div>

          <div>
            <span class="mb-1 block text-xs text-muted-foreground">{{ t('entry.password') }}</span>
            <div class="flex gap-1">
              <NInput
                v-model:value="form.password"
                type="text"
                autocomplete="off"
                class="min-w-0 flex-1"
              />
              <NButton
                size="small"
                @click="showGenerator = !showGenerator"
              >
                {{ t('generator.open') }}
              </NButton>
            </div>

            <!-- 生成器面板 -->
            <div
              v-if="showGenerator"
              class="mt-2 space-y-2 rounded-md border border-dashed border-border p-2"
            >
              <div class="flex items-center gap-2 text-xs">
                <span class="text-muted-foreground">{{ t('generator.length') }}</span>
                <NInput
                  v-model:value="generatorLength"
                  type="text"
                  :min="6"
                  :max="64"
                  class="w-16"
                />
                <span class="flex-1 text-muted-foreground">{{ t('generator.hint') }}</span>
              </div>

              <div class="flex flex-wrap items-center gap-3 text-xs">
                <NCheckbox v-model:checked="generatorOptions.uppercase">
                  {{ t('generator.uppercase') }}
                </NCheckbox>
                <NCheckbox v-model:checked="generatorOptions.lowercase">
                  {{ t('generator.lowercase') }}
                </NCheckbox>
                <NCheckbox v-model:checked="generatorOptions.digits">
                  {{ t('generator.digits') }}
                </NCheckbox>
                <NCheckbox v-model:checked="generatorOptions.symbols">
                  {{ t('generator.symbols') }}
                </NCheckbox>
                <NCheckbox v-model:checked="generatorOptions.excludeAmbiguous">
                  {{ t('generator.excludeAmbiguous') }}
                </NCheckbox>
              </div>

              <div class="rounded bg-muted px-2 py-1 font-mono text-xs break-all">
                {{ generated || '—' }}
              </div>

              <p v-if="generatorError" class="text-xs text-red-500">{{ generatorError }}</p>

              <div class="flex justify-end gap-2 text-xs">
                <NButton size="small" @click="generate">
                  {{ t('generator.regenerate') }}
                </NButton>
                <NButton
                  size="small"
                  type="primary"
                  :disabled="!generated"
                  @click="fillGenerated"
                >
                  {{ t('generator.fill') }}
                </NButton>
              </div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <span class="mb-1 block text-xs text-muted-foreground">{{ t('entry.email') }}</span>
            <div class="flex gap-1">
              <NInput
                v-model:value="form.email"
                class="min-w-0 flex-1"
              />
              <NSelect
                v-if="presetStore.grouped.email.length"
                v-model:value="form.email"
                :options="[{ label: t('preset.choose'), value: '' as any }].concat(
                  presetStore.grouped.email.map((p) => ({
                    label: p.label,
                    value: p.id,
                  }))
                )"
                class="shrink-0 w-24"
              />
            </div>
          </div>

          <div>
            <span class="mb-1 block text-xs text-muted-foreground">{{ t('entry.phone') }}</span>
            <div class="flex gap-1">
              <NInput
                v-model:value="form.phone"
                class="min-w-0 flex-1"
              />
              <NSelect
                v-if="presetStore.grouped.phone.length"
                v-model:value="form.phone"
                :options="[{ label: t('preset.choose'), value: '' as any }].concat(
                  presetStore.grouped.phone.map((p) => ({
                    label: p.label,
                    value: p.id,
                  }))
                )"
                class="shrink-0 w-24"
              />
            </div>
          </div>
        </div>

        <NDivider />

        <div class="flex items-center gap-2">
          <NCheckbox v-model:checked="form.favorite" />
          <span class="text-sm">{{ t('entry.favorite') }}</span>
        </div>

        <NInput
          v-model:value="tagsText"
          :placeholder="t('entry.tagsPlaceholder')"
          show-count
        />

        <div>
          <div class="mb-2 flex items-center justify-between">
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

      <p v-if="formError" class="mt-3 text-xs text-red-500">{{ formError }}</p>

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
