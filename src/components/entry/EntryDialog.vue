<script setup lang="ts">
// 条目编辑弹窗：字段录入、四类预设回填、强密码生成器、Markdown 备注编辑/预览。
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Star, StarOff } from 'lucide-vue-next'
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NDivider,
  NIcon,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NTabPane,
  NTabs,
  NText,
  useDialog,
  useMessage,
  type SelectOption,
} from 'naive-ui'
import { useEntryStore } from '@/stores/entry'
import { usePresetStore } from '@/stores/preset'
import { generatorApi } from '@/lib/ipc'
import { OVERLAY_TARGET } from '@/lib/theme'
import { renderMarkdown } from '@/lib/markdown'
import { errorText } from '@/lib/errorMessage'
import type { EntryInput, EntryView, GeneratorOptions, Preset, PresetFieldType } from '@/types'

const props = defineProps<{
  open: boolean
  entry: EntryView | null
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()
const store = useEntryStore()
const presetStore = usePresetStore()
const message = useMessage()
const dialog = useDialog()

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
  categoryId: '',
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
const categoryOptions = computed<SelectOption[]>(() => [
  { label: t('entry.uncategorized'), value: '' },
  ...store.categories.map((cat) => ({ label: cat.name, value: cat.id })),
])

function presetOptions(list: Preset[]): SelectOption[] {
  return list.map((preset) => ({ label: preset.label, value: preset.id }))
}

function fillFrom(entry: EntryView | null) {
  // 新建时默认沿用当前列表打开的分类；编辑时保留条目自身的分类。
  form.categoryId = entry ? (entry.categoryId ?? '') : (store.selectedCategoryId ?? '')
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

/** 选中预设后按类型把「值」回填到对应字段；下拉本身不受控，选完回到占位文案。 */
function applyPresetById(field: PresetFieldType, id: string | null) {
  if (!id) return
  const preset = presetStore.presets.find((item) => item.id === id)
  if (!preset) return
  if (field === 'username') form.username = preset.value
  else if (field === 'email') form.email = preset.value
  else if (field === 'phone') form.phone = preset.value
  else form.password = preset.value
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

function onLengthChange(value: number | null) {
  if (value === null) return
  generatorOptions.length = Math.min(64, Math.max(6, Math.round(value)))
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

function remove() {
  if (!props.entry) return
  dialog.warning({
    title: t('common.delete'),
    content: t('entry.deleteConfirm'),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      busy.value = true
      try {
        await store.deleteEntry(props.entry!.id)
        message.success(t('toast.deleted'))
        emit('close')
      } catch (err) {
        formError.value = messageOf(err)
      } finally {
        busy.value = false
      }
    },
  })
}

function messageOf(err: unknown): string {
  // 后端 MendError 为 { code, message } 结构，统一走 errorText 映射（docs/07 §5）。
  return errorText(err, t)
}
</script>

<template>
  <NModal
    :show="open"
    :to="OVERLAY_TARGET"
    :mask-closable="false"
    @update:show="
      (show: boolean) => {
        if (!show) emit('close')
      }
    "
  >
    <NCard
      :title="heading"
      :bordered="false"
      size="large"
      style="width: min(760px, calc(100vw - 32px))"
      :content-style="{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }"
    >
      <div class="grid gap-3 pr-1">
        <NInput
          v-model:value="form.title"
          :placeholder="t('entry.title')"
          :maxlength="120"
          show-count
        />

        <div class="grid grid-cols-2 gap-3">
          <NSelect
            :value="form.categoryId"
            :options="categoryOptions"
            :placeholder="t('entry.category')"
            @update:value="(value: string) => (form.categoryId = value)"
          />
          <NInput v-model:value="form.url" :placeholder="t('entry.url')" />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <!-- 账号 + 账号预设 -->
          <div>
            <NText :depth="3" class="mb-1 block text-xs">{{ t('entry.username') }}</NText>
            <div class="flex gap-1">
              <NInput v-model:value="form.username" class="min-w-0 flex-1" />
              <NSelect
                v-if="presetStore.grouped.username.length"
                :value="null"
                :options="presetOptions(presetStore.grouped.username)"
                :placeholder="t('preset.choose')"
                class="w-28 shrink-0"
                @update:value="(id: string | null) => applyPresetById('username', id)"
              />
            </div>
          </div>

          <!-- 密码 + 常用密码预设 + 生成器 -->
          <div>
            <NText :depth="3" class="mb-1 block text-xs">{{ t('entry.password') }}</NText>
            <div class="flex gap-1">
              <NInput
                v-model:value="form.password"
                type="text"
                autocomplete="off"
                class="min-w-0 flex-1"
              />
              <NSelect
                v-if="presetStore.grouped.password.length"
                :value="null"
                :options="presetOptions(presetStore.grouped.password)"
                :placeholder="t('preset.choose')"
                class="w-28 shrink-0"
                @update:value="(id: string | null) => applyPresetById('password', id)"
              />
              <NButton size="small" class="shrink-0" @click="showGenerator = !showGenerator">
                {{ t('generator.open') }}
              </NButton>
            </div>

            <div v-if="showGenerator" class="mt-2 grid gap-2 rounded-lg border border-border p-2.5">
              <div class="flex items-center gap-2">
                <NText :depth="3" class="shrink-0 text-xs">{{ t('generator.length') }}</NText>
                <NInputNumber
                  :value="generatorOptions.length"
                  :min="6"
                  :max="64"
                  size="small"
                  style="width: 92px"
                  @update:value="onLengthChange"
                />
                <NText :depth="3" class="min-w-0 flex-1 text-xs">{{ t('generator.hint') }}</NText>
              </div>

              <div class="flex flex-wrap gap-x-3 gap-y-1">
                <NCheckbox v-model:checked="generatorOptions.uppercase" size="small">
                  {{ t('generator.uppercase') }}
                </NCheckbox>
                <NCheckbox v-model:checked="generatorOptions.lowercase" size="small">
                  {{ t('generator.lowercase') }}
                </NCheckbox>
                <NCheckbox v-model:checked="generatorOptions.digits" size="small">
                  {{ t('generator.digits') }}
                </NCheckbox>
                <NCheckbox v-model:checked="generatorOptions.symbols" size="small">
                  {{ t('generator.symbols') }}
                </NCheckbox>
                <NCheckbox v-model:checked="generatorOptions.excludeAmbiguous" size="small">
                  {{ t('generator.excludeAmbiguous') }}
                </NCheckbox>
              </div>

              <NInput :value="generated" readonly size="small" class="font-mono" placeholder="—" />
              <NAlert v-if="generatorError" type="error" :show-icon="false">{{
                generatorError
              }}</NAlert>

              <div class="flex justify-end gap-2">
                <NButton size="small" @click="generate">{{ t('generator.regenerate') }}</NButton>
                <NButton size="small" type="primary" :disabled="!generated" @click="fillGenerated">
                  {{ t('generator.fill') }}
                </NButton>
              </div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <NText :depth="3" class="mb-1 block text-xs">{{ t('entry.email') }}</NText>
            <div class="flex gap-1">
              <NInput v-model:value="form.email" class="min-w-0 flex-1" />
              <NSelect
                v-if="presetStore.grouped.email.length"
                :value="null"
                :options="presetOptions(presetStore.grouped.email)"
                :placeholder="t('preset.choose')"
                class="w-28 shrink-0"
                @update:value="(id: string | null) => applyPresetById('email', id)"
              />
            </div>
          </div>

          <div>
            <NText :depth="3" class="mb-1 block text-xs">{{ t('entry.phone') }}</NText>
            <div class="flex gap-1">
              <NInput v-model:value="form.phone" class="min-w-0 flex-1" />
              <NSelect
                v-if="presetStore.grouped.phone.length"
                :value="null"
                :options="presetOptions(presetStore.grouped.phone)"
                :placeholder="t('preset.choose')"
                class="w-28 shrink-0"
                @update:value="(id: string | null) => applyPresetById('phone', id)"
              />
            </div>
          </div>
        </div>

        <NDivider class="!my-1" />

        <div class="flex items-center gap-2">
          <NButton
            quaternary
            circle
            :type="form.favorite ? 'warning' : 'default'"
            :aria-label="t('entry.star')"
            :title="form.favorite ? t('entry.unstar') : t('entry.star')"
            @click="form.favorite = !form.favorite"
          >
            <template #icon>
              <NIcon :component="form.favorite ? Star : StarOff" :size="16" />
            </template>
          </NButton>
          <NText class="text-sm">{{ t('entry.star') }}</NText>
          <NText v-if="form.favorite" :depth="3" class="text-xs">
            {{ t('entry.starredHint') }}
          </NText>
        </div>

        <div>
          <NText :depth="3" class="mb-1 block text-xs">{{ t('entry.tags') }}</NText>
          <NInput v-model:value="tagsText" :placeholder="t('entry.tagsPlaceholder')" />
        </div>

        <div>
          <NTabs v-model:value="notesTab" type="segment" size="small" class="mb-2">
            <NTabPane name="edit">
              <template #tab>{{ t('entry.notesEdit') }}</template>
            </NTabPane>
            <NTabPane name="preview">
              <template #tab>{{ t('entry.notesPreview') }}</template>
            </NTabPane>
          </NTabs>
          <NInput
            v-if="notesTab === 'edit'"
            v-model:value="form.notes"
            type="textarea"
            :rows="7"
            :placeholder="t('entry.notesPlaceholder')"
            class="font-mono"
          />
          <!-- 渲染结果是白名单标签，原始 HTML 已被转义 -->
          <div
            v-else
            class="min-h-40 overflow-x-auto rounded-lg border border-border px-3 py-2 text-sm leading-relaxed"
          >
            <div v-if="form.notes.trim()" v-html="previewHtml"></div>
            <NText v-else :depth="3" class="text-xs">{{ t('entry.noNotes') }}</NText>
          </div>
        </div>
      </div>

      <NAlert v-if="formError" type="error" :show-icon="false" class="mt-3">{{ formError }}</NAlert>

      <template #footer>
        <div class="flex items-center justify-between">
          <NButton v-if="entry" type="error" quaternary :disabled="busy" @click="remove">
            {{ t('common.delete') }}
          </NButton>
          <span v-else></span>
          <div class="flex gap-2">
            <NButton @click="emit('close')">{{ t('common.cancel') }}</NButton>
            <NButton type="primary" :loading="busy" @click="save">{{ t('common.save') }}</NButton>
          </div>
        </div>
      </template>
    </NCard>
  </NModal>
</template>
