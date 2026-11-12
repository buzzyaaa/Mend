<script setup lang="ts">
// 备注弹窗：查看完整 Markdown 备注（白名单渲染，口径同 docs/05 §3），
// 并提供单独编辑该条备注的入口；回收站视图只读（与列表「不可编辑」口径一致）。
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NCard, NInput, NModal, NTabPane, NTabs, NText } from 'naive-ui'
import { useEntryStore } from '@/stores/entry'
import { useToast } from '@/composables/useToast'
import { OVERLAY_TARGET } from '@/lib/theme'
import { renderMarkdown } from '@/lib/markdown'
import { errorText } from '@/lib/errorMessage'
import type { EntryInput, EntryView } from '@/types'

const props = defineProps<{
  open: boolean
  entry: EntryView | null
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()
const store = useEntryStore()
const toast = useToast()

type Mode = 'view' | 'edit'
const mode = ref<Mode>('view')
const notesTab = ref<'edit' | 'preview'>('edit')

// content：查看态展示的备注正文（保存成功后就地更新，避免等 store 刷新回灌）。
// draft：编辑态草稿，取消即丢弃。
const content = ref('')
const draft = ref('')
const busy = ref(false)
const formError = ref('')

// 回收站视图不提供编辑按钮，与 EntryList 展开区的口径一致。
const readonly = computed(() => store.isTrashView)
const heading = computed(() => {
  const title = props.entry?.title
  return title ? `${t('entry.notes')} · ${title}` : t('entry.notes')
})
const viewHtml = computed(() => renderMarkdown(content.value))
const draftHtml = computed(() => renderMarkdown(draft.value))

watch(
  () => [props.open, props.entry?.id] as const,
  ([open]) => {
    if (!open) return
    mode.value = 'view'
    notesTab.value = 'edit'
    content.value = props.entry?.notes ?? ''
    draft.value = ''
    formError.value = ''
    busy.value = false
  },
  { immediate: true },
)

function enterEdit() {
  draft.value = content.value
  notesTab.value = 'edit'
  formError.value = ''
  mode.value = 'edit'
}

function cancelEdit() {
  mode.value = 'view'
  draft.value = ''
  formError.value = ''
}

/** 其余字段原样映射回 EntryInput，只替换 notes（形状参考 EntryDialog 的提交逻辑）。 */
async function save() {
  const entry = props.entry
  if (!entry) return
  const input: EntryInput = {
    categoryId: entry.categoryId,
    title: entry.title,
    url: entry.url ?? null,
    username: entry.username,
    password: entry.password,
    email: entry.email,
    phone: entry.phone,
    notes: draft.value,
    favorite: entry.favorite,
    tags: [...entry.tags],
  }
  busy.value = true
  formError.value = ''
  try {
    await store.updateEntry(entry.id, input)
    content.value = draft.value
    mode.value = 'view'
    toast.success(t('toast.saved'))
  } catch (err) {
    formError.value = errorText(err, t)
  } finally {
    busy.value = false
  }
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
      closable
      size="large"
      style="width: min(720px, calc(100vw - 32px))"
      :content-style="{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }"
      @close="emit('close')"
    >
      <!-- 查看态：渲染结果是白名单标签，原始 HTML 已被转义（src/lib/markdown.ts） -->
      <div v-if="mode === 'view'" class="md-preview text-sm leading-relaxed">
        <div v-if="content.trim()" v-html="viewHtml"></div>
        <NText v-else :depth="3" class="text-xs">{{ t('entry.noNotes') }}</NText>
      </div>

      <!-- 编辑态：编辑 / 预览切换口径与 EntryDialog 备注 Tabs 一致 -->
      <div v-else>
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
          v-model:value="draft"
          type="textarea"
          :rows="12"
          :placeholder="t('entry.notesPlaceholder')"
          class="font-mono"
        />
        <div
          v-else
          class="md-preview min-h-40 overflow-x-auto rounded-lg border border-border px-3 py-2 text-sm leading-relaxed"
        >
          <div v-if="draft.trim()" v-html="draftHtml"></div>
          <NText v-else :depth="3" class="text-xs">{{ t('entry.noNotes') }}</NText>
        </div>
      </div>

      <NAlert v-if="formError" type="error" :show-icon="false" class="mt-3">{{ formError }}</NAlert>

      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <template v-if="mode === 'view'">
            <NButton v-if="!readonly" type="primary" secondary @click="enterEdit">
              {{ t('entry.edit') }}
            </NButton>
          </template>
          <template v-else>
            <NButton :disabled="busy" @click="cancelEdit">{{ t('common.cancel') }}</NButton>
            <NButton type="primary" :loading="busy" @click="save">{{ t('common.save') }}</NButton>
          </template>
        </div>
      </template>
    </NCard>
  </NModal>
</template>
