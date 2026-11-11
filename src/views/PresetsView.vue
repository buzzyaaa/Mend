<script setup lang="ts">
// 预设值页面：账号 / 邮箱 / 手机号 / 常用密码四类分组，均用 Data Table 展示。
// 值落盘加密，仅在解锁态内存中明文显示（密码类同样明文展示，不做遮挡）。
import { computed, h, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NDataTable,
  NDivider,
  NEmpty,
  NInput,
  NSelect,
  NSpace,
  NTabPane,
  NTabs,
  NTag,
  NText,
} from 'naive-ui'
import { usePresetStore } from '@/stores/preset'
import { useToast } from '@/composables/useToast'
import type { DataTableColumns } from 'naive-ui'
import type { Preset, PresetFieldType } from '@/types'

const { t } = useI18n()
const presetStore = usePresetStore()
const toast = useToast()

const fieldTypes: PresetFieldType[] = ['username', 'email', 'phone', 'password']
const activeTab = ref<PresetFieldType>('username')

const TYPE_META: Record<PresetFieldType, { color: string }> = {
  username: { color: '#18a058' },
  email: { color: '#2080f0' },
  phone: { color: '#f0a020' },
  password: { color: '#d03050' },
}

const form = reactive<{ fieldType: PresetFieldType; label: string; value: string }>({
  fieldType: 'username',
  label: '',
  value: '',
})
const editId = ref<string | null>(null)
const formError = ref('')
const busy = ref(false)

const headingOfForm = computed(() => (editId.value ? t('preset.edit') : t('preset.add')))
const rowsOfActive = computed(() => presetStore.byType(activeTab.value))

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
  form.fieldType = activeTab.value
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
    activeTab.value = form.fieldType
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

const columns = computed<DataTableColumns<Preset>>(() => [
  {
    title: t('preset.label'),
    key: 'label',
    width: 180,
    ellipsis: { tooltip: true },
  },
  {
    title: t('preset.value'),
    key: 'value',
    ellipsis: { tooltip: true },
    render: (row) =>
      h(
        NText,
        { code: true, class: row.fieldType === 'password' ? 'whitespace-pre-wrap' : '' },
        () => row.value
      ),
  },
  {
    title: t('preset.type'),
    key: 'fieldType',
    width: 130,
    render: (row) =>
      h(
        NTag,
        {
          bordered: false,
          color: { color: TYPE_META[row.fieldType].color, textColor: '#fff' },
        },
        { default: () => t(`preset.types.${row.fieldType}`) }
      ),
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 150,
    render: (row) =>
      h(NSpace, { size: 'small', wrap: false }, () => [
        h(NButton, { size: 'small', onClick: () => startEdit(row) }, () => t('common.rename')),
        h(
          NButton,
          { size: 'small', type: 'error', ghost: true, onClick: () => remove(row) },
          () => t('common.delete')
        ),
      ]),
  },
])
</script>

<template>
  <main class="flex h-full flex-col overflow-hidden p-6">
    <section class="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card p-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 class="text-lg font-medium">{{ t('preset.title') }}</h1>
        <span class="text-xs text-muted-foreground">{{ t('preset.hint') }}</span>
      </div>

      <NTabs v-model:value="activeTab" type="line" animated class="min-h-0 flex-1">
        <NTabPane
          v-for="type in fieldTypes"
          :key="type"
          :name="type"
          :tab="`${t(`preset.types.${type}`)} (${presetStore.byType(type).length})`"
        >
          <div class="pt-2">
            <NDataTable
              :columns="columns"
              :data="rowsOfActive"
              :bordered="false"
              :single-line="false"
              :row-key="(row: Preset) => row.id"
              :max-height="420"
              virtual-scroll
              size="small"
            >
              <template #empty>
                <NEmpty :description="t('preset.empty')" />
              </template>
            </NDataTable>
          </div>
        </NTabPane>
      </NTabs>

      <NDivider />

      <div class="mb-2 text-sm font-medium">{{ headingOfForm }}</div>

      <div class="flex flex-wrap items-center gap-2">
        <NSelect
          v-model:value="form.fieldType"
          :options="fieldTypes.map((type) => ({ label: t(`preset.types.${type}`), value: type }))"
          style="width: 140px"
        />
        <NInput
          v-model:value="form.label"
          :placeholder="t('preset.labelPlaceholder')"
          :maxlength="40"
          style="width: 180px"
        />
        <NInput
          v-model:value="form.value"
          :placeholder="t('preset.value')"
          class="min-w-0 flex-1"
        />
        <NButton type="primary" :loading="busy" @click="submit">
          {{ editId ? t('common.save') : t('preset.add') }}
        </NButton>
        <NButton v-if="editId" @click="resetForm">
          {{ t('common.cancel') }}
        </NButton>
      </div>
      <p v-if="formError" class="mt-1 text-xs text-red-500">{{ formError }}</p>
    </section>
  </main>
</template>
