<script setup lang="ts">
// 预设值独立页面：从设置页迁出，账号/邮箱/手机号预设在此维护。
import { h } from 'vue'
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePresetStore } from '@/stores/preset'
import { useToast } from '@/composables/useToast'
import type { Preset, PresetFieldType } from '@/types'
import { NButton, NInput, NSelect, NDataTable, NSpace, NTag, NEmpty, NDivider, NText } from 'naive-ui'

const { t } = useI18n()
const presetStore = usePresetStore()
const toast = useToast()

const fieldTypes: PresetFieldType[] = ['username', 'email', 'phone']

const form = reactive<{ fieldType: PresetFieldType; label: string; value: string }>({
  fieldType: 'username',
  label: '',
  value: '',
})
const editId = ref<string | null>(null)
const formError = ref('')
const busy = ref(false)

const headingOfForm = computed(() => (editId.value ? t('preset.edit') : t('preset.add')))

onMounted(() => {
  presetStore.refresh().catch(() => {
    // 未解锁或浏览器预览：静默
  })
})

function startEdit(preset: Preset) {
  editId.value = preset.id
  form.fieldType = preset.fieldType
  form.label = preset.label
  form.value = preset.value
  formError.value = ''
}

function resetForm() {
  editId.value = null
  form.label = ''
  form.value = ''
  formError.value = ''
}

async function submit() {
  formError.value = ''
  if (!form.label.trim() || !form.value.trim()) {
    formError.value = t('preset.hint')
    return
  }
  busy.value = true
  try {
    const input = { fieldType: form.fieldType, label: form.label.trim(), value: form.value.trim() }
    if (editId.value) await presetStore.update(editId.value, input)
    else await presetStore.create(input)
    toast.success(t('toast.saved'))
    resetForm()
  } catch (err) {
    formError.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

async function remove(preset: Preset) {
  if (!window.confirm(t('preset.deleteConfirm'))) return
  try {
    await presetStore.remove(preset.id)
    toast.success(t('toast.deleted'))
    if (editId.value === preset.id) resetForm()
  } catch (err) {
    toast.error(t('toast.failed', { message: err instanceof Error ? err.message : String(err) }))
  }
}

const columns = [
  {
    title: t('preset.label'),
    key: 'label',
    width: 150,
    ellipsis: { tooltip: true },
  },
  {
    title: t('preset.value'),
    key: 'value',
    ellipsis: { tooltip: true },
    render: (row: Preset) => (
      h(NText, { code: true }, () => row.value)
    ),
  },
  {
    title: t('preset.type'),
    key: 'fieldType',
    width: 120,
    render: (row: Preset) => {
      const typeMap: Record<PresetFieldType, { label: string; color: string }> = {
        username: { label: t('preset.types.username'), color: '#18a058' },
        email: { label: t('preset.types.email'), color: '#2080f0' },
        phone: { label: t('preset.types.phone'), color: '#f0a020' },
      }
      const { label, color } = typeMap[row.fieldType] || { label: row.fieldType, color: '#999' }
      return h(NTag, { type: 'default', color: { color, textColor: '#fff' } }, { default: () => label })
    },
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 140,
    render: (row: Preset) =>
      h(NSpace, { size: 'small' }, () => [
        h(
          NButton,
          {
            size: 'small',
            onClick: () => startEdit(row),
          },
          { default: () => t('common.rename') }
        ),
        h(
          NButton,
          {
            size: 'small',
            type: 'error',
            onClick: () => remove(row),
          },
          { default: () => t('common.delete') }
        ),
      ]),
  },
]

const filteredPresets = computed(() => {
  if (editId.value) return presetStore.presets
  return presetStore.presets
})
</script>

<template>
  <main class="flex h-full flex-col overflow-hidden">
    <section class="flex flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card p-4">
      <div class="mb-3 flex items-center justify-between">
        <h1 class="text-lg font-medium">{{ t('preset.title') }}</h1>
        <span class="text-xs text-muted-foreground">{{ t('preset.hint') }}</span>
      </div>

      <div class="flex-1 overflow-auto">
        <NDataTable
          v-if="filteredPresets.length > 0"
          :columns="columns"
          :data="filteredPresets"
          :scroll-x="800"
          :bordered="false"
          :single-line="false"
          :max-height="600"
          class="h-full"
        >
          <template #empty>
            <NEmpty :description="t('preset.empty')" />
          </template>
        </NDataTable>
        <NEmpty v-else :description="t('preset.empty')" />
      </div>

      <NDivider />

      <div class="mb-1 flex items-center justify-between">
        <div class="text-sm font-medium">{{ headingOfForm }}</div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <NSelect
          v-model:value="form.fieldType"
          :options="fieldTypes.map((type) => ({
            label: t(`preset.types.${type}`),
            value: type,
          }))"
          style="width: 120px"
        />
        <NInput
          v-model:value="form.label"
          :placeholder="t('preset.labelPlaceholder')"
          :max-length="40"
          style="width: 150px"
        />
        <NInput
          v-model:value="form.value"
          :placeholder="t('preset.value')"
          class="min-w-0 flex-1"
        />
        <NButton
          type="primary"
          :loading="busy"
          @click="submit"
        >
          {{ editId ? t('common.save') : t('preset.add') }}
        </NButton>
        <NButton
          v-if="editId"
          @click="resetForm"
        >
          {{ t('common.cancel') }}
        </NButton>
      </div>
      <p v-if="formError" class="mt-1 text-xs text-red-500">{{ formError }}</p>
    </section>
  </main>
</template>
