<script setup lang="ts">
// 预设值页面：账号 / 邮箱 / 手机号 / 常用密码四类分组，均用 Data Table 展示。
// 值落盘加密，仅在解锁态内存中明文显示（密码类同样明文展示，不做遮挡）。
import { computed, h, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
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
  useDialog,
  type DataTableColumns,
  type SelectOption,
} from 'naive-ui'
import { usePresetStore } from '@/stores/preset'
import { useToast } from '@/composables/useToast'
import type { Preset, PresetFieldType } from '@/types'

const { t } = useI18n()
const presetStore = usePresetStore()
const toast = useToast()
const dialog = useDialog()

const fieldTypes: PresetFieldType[] = ['username', 'email', 'phone', 'password']
const activeTab = ref<PresetFieldType>('username')

/** 类型徽标走语义色，深浅主题都由 NConfigProvider 决定。 */
const TYPE_TAG: Record<PresetFieldType, 'success' | 'info' | 'warning' | 'error'> = {
  username: 'success',
  email: 'info',
  phone: 'warning',
  password: 'error',
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
const typeOptions = computed<SelectOption[]>(() =>
  fieldTypes.map((type) => ({ label: t(`preset.types.${type}`), value: type })),
)

onMounted(() => {
  presetStore.refresh().catch(() => {
    // 未解锁或浏览器预览：静默
  })
})

// 新增态下表单类型跟随当前 Tab，编辑态保持原类型
watch(activeTab, (type) => {
  if (!editId.value) form.fieldType = type
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

function remove(preset: Preset) {
  dialog.warning({
    title: t('common.delete'),
    content: t('preset.deleteConfirm'),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        await presetStore.remove(preset.id)
        toast.success(t('toast.deleted'))
        if (editId.value === preset.id) resetForm()
      } catch (err) {
        toast.error(t('toast.failed', { message: err instanceof Error ? err.message : String(err) }))
      }
    },
  })
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
        () => row.value,
      ),
  },
  {
    title: t('preset.type'),
    key: 'fieldType',
    width: 130,
    render: (row) =>
      h(
        NTag,
        { bordered: false, round: true, type: TYPE_TAG[row.fieldType] },
        { default: () => t(`preset.types.${row.fieldType}`) },
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
          () => t('common.delete'),
        ),
      ]),
  },
])
</script>

<template>
  <main class="flex h-screen flex-col overflow-hidden p-5">
    <section class="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-card p-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <NText strong class="text-lg">{{ t('preset.title') }}</NText>
        <NText :depth="3" class="text-xs">{{ t('preset.hint') }}</NText>
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
              :data="presetStore.byType(type)"
              :bordered="false"
              :single-line="false"
              :row-key="(row: Preset) => row.id"
              :max-height="420"
              size="small"
            >
              <template #empty>
                <NEmpty :description="t('preset.empty')" />
              </template>
            </NDataTable>
          </div>
        </NTabPane>
      </NTabs>

      <NDivider class="my-3" />

      <NText strong class="mb-2 block text-sm">{{ headingOfForm }}</NText>

      <div class="flex flex-wrap items-center gap-2">
        <NSelect v-model:value="form.fieldType" :options="typeOptions" style="width: 140px" />
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
        <NButton v-if="editId" @click="resetForm">{{ t('common.cancel') }}</NButton>
      </div>
      <NAlert v-if="formError" type="error" :show-icon="false" class="mt-2">
        {{ formError }}
      </NAlert>
    </section>
  </main>
</template>
