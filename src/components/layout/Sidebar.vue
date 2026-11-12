<script setup lang="ts">
// 分类侧栏：固定桶（全部/星标/归档/未分类/回收站）+ 自定义分类，支持新增、重命名、删除。
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Pencil, Trash2, Archive, Inbox, Layers, Trash, Folder, Star } from 'lucide-vue-next'
import { NButton, NColorPicker, NIcon, NInput, NModal, NText, NTooltip, useDialog } from 'naive-ui'
import { useEntryStore, type Bucket } from '@/stores/entry'
import { useVaultStore } from '@/stores/vault'
import { useToast } from '@/composables/useToast'
import { errorText } from '@/lib/errorMessage'
import { OVERLAY_TARGET } from '@/lib/theme'
import { categoryApi } from '@/lib/ipc'
import { CATEGORY_ICON_OPTIONS, categoryTint, resolveCategoryIcon } from '@/lib/categoryIcons'
import type { Category } from '@/types'

const { t } = useI18n()
const entryStore = useEntryStore()
const vault = useVaultStore()
const toast = useToast()
const dialog = useDialog()

const editing = ref<{ mode: 'create' | 'rename'; category?: Category } | null>(null)
const nameInput = ref('')
const colorInput = ref<string | null>(null)
const iconInput = ref('')
const formError = ref('')
const busy = ref(false)
const deleting = ref<Category | null>(null)

async function load() {
  try {
    await entryStore.refresh()
  } catch (err) {
    // 未解锁或浏览器预览下静默，避免打断界面（err 只是错误消息，不含明文数据）
    console.warn('[sidebar] 加载数据失败', err)
  }
}

onMounted(() => {
  if (vault.status.unlocked) void load()
})

// 锁定会清空 store 缓存；重新解锁时（无论组件是否重新挂载）都要把列表拉回来，
// 否则「锁定 → 解锁」后主界面会是空列表。
watch(
  () => vault.status.unlocked,
  (unlocked) => {
    if (unlocked) void load()
  },
)

function select(next: Bucket) {
  entryStore.selectBucket(next)
}

function openCreate() {
  editing.value = { mode: 'create' }
  nameInput.value = ''
  colorInput.value = null
  iconInput.value = ''
  formError.value = ''
}

function openRename(category: Category) {
  editing.value = { mode: 'rename', category }
  nameInput.value = category.name
  colorInput.value = category.color ?? null
  iconInput.value = category.icon ?? ''
  formError.value = ''
}

async function submitCategory() {
  const name = nameInput.value.trim()
  if (!name) {
    formError.value = t('sidebar.nameRequired')
    return
  }
  const input = {
    name,
    color: colorInput.value?.trim() ? colorInput.value.trim() : null,
    icon: iconInput.value.trim() || null,
  }
  busy.value = true
  formError.value = ''
  try {
    if (editing.value?.mode === 'create') {
      await categoryApi.create(input)
    } else if (editing.value?.category) {
      await categoryApi.rename(editing.value.category.id, input)
    }
    await entryStore.refresh()
    editing.value = null
  } catch (err) {
    formError.value = messageOf(err)
  } finally {
    busy.value = false
  }
}

function askDelete(category: Category) {
  deleting.value = category
  dialog.warning({
    title: t('sidebar.delete'),
    content: t('sidebar.deleteConfirm'),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: confirmDelete,
  })
}

async function confirmDelete() {
  if (!deleting.value) return
  busy.value = true
  try {
    await entryStore.deleteCategory(deleting.value.id)
    toast.success(t('toast.deleted'))
    deleting.value = null
  } catch (err) {
    toast.error(t('toast.failed', { message: messageOf(err) }))
  } finally {
    busy.value = false
  }
}

function messageOf(err: unknown): string {
  // 后端 MendError 为 { code, message } 结构，统一走 errorText 映射（docs/07 §5）。
  return errorText(err, t)
}

/** 桶行的统一渲染数据，避免三段重复模板。
 *  顺序：全部 → 星标 → 归档 → 未分类 → 回收站（高频操作在前，回收站沉底）。 */
const fixedBuckets = [
  { key: 'all' as const, label: 'nav.all', icon: Layers },
  { key: 'starred' as const, label: 'nav.starred', icon: Star },
  { key: 'archive' as const, label: 'nav.archive', icon: Archive },
  { key: 'uncategorized' as const, label: 'nav.uncategorized', icon: Inbox },
  { key: 'trash' as const, label: 'nav.trash', icon: Trash },
]

/** 图标网格：首个为「无图标」（空名字 = 回退默认文件夹），其余来自注册表。 */
const iconOptions = [{ name: '', component: Folder }, ...CATEGORY_ICON_OPTIONS]

/** 颜色快选（常见色），仍可在弹出的取色面板里自由选。 */
const colorSwatches = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
]

/** 取色面板按钮：确认 + 清除（清除即回到无色）。 */
const colorPickerActions: Array<'confirm' | 'clear'> = ['confirm', 'clear']

/** 未选中且已设颜色时用 10% 背景填充；选中态交给 bg-accent 优先。 */
function categoryRowStyle(cat: Category) {
  if (entryStore.bucket === cat.id || !cat.color) return undefined
  return { background: categoryTint(cat.color, 0.1) }
}
</script>

<template>
  <aside class="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
    <div class="px-4 pb-2 pt-4">
      <NText :depth="3" class="text-xs font-medium uppercase tracking-wide">
        {{ t('nav.categories') }}
      </NText>
    </div>

    <nav class="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
      <!-- 固定桶 -->
      <NButton
        v-for="bucket in fixedBuckets"
        :key="bucket.key"
        block
        class="!justify-start min-h-9"
        :type="entryStore.bucket === bucket.key ? 'primary' : 'default'"
        :quaternary="entryStore.bucket === bucket.key"
        :text="entryStore.bucket !== bucket.key"
        @click="select(bucket.key)"
      >
        <template #icon>
          <NIcon :component="bucket.icon" :size="16" />
        </template>
        <span class="min-w-0 flex-1 truncate leading-normal text-left">{{ t(bucket.label) }}</span>
      </NButton>

      <div class="px-2 pb-1 pt-3">
        <NText :depth="3" class="text-[11px] uppercase tracking-wide">
          {{ t('nav.addCategory') }}
        </NText>
      </div>

      <!-- 自定义分类 -->
      <div
        v-for="cat in entryStore.categories"
        :key="cat.id"
        class="group flex min-h-9 items-center rounded-md transition-colors hover:bg-accent"
        :class="entryStore.bucket === cat.id ? 'bg-accent' : ''"
        :style="categoryRowStyle(cat)"
      >
        <NButton
          block
          class="!h-auto !justify-start min-h-9 min-w-0 flex-1 border-0 bg-transparent shadow-none"
          :type="entryStore.bucket === cat.id ? 'primary' : 'default'"
          text
          @click="select(cat.id)"
        >
          <template #icon>
            <NIcon :component="resolveCategoryIcon(cat.icon)" :size="16" />
          </template>
          <span class="min-w-0 flex-1 truncate leading-normal text-left">{{ cat.name }}</span>
        </NButton>
        <div
          class="flex shrink-0 items-center pr-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <NTooltip :show-arrow="false">
            <template #trigger>
              <NButton
                quaternary
                circle
                size="tiny"
                :aria-label="t('sidebar.rename')"
                @click.stop="openRename(cat)"
              >
                <template #icon><NIcon :component="Pencil" :size="14" /></template>
              </NButton>
            </template>
            {{ t('sidebar.rename') }}
          </NTooltip>
          <NTooltip :show-arrow="false">
            <template #trigger>
              <NButton
                quaternary
                circle
                size="tiny"
                :aria-label="t('sidebar.delete')"
                @click.stop="askDelete(cat)"
              >
                <template #icon><NIcon :component="Trash2" :size="14" /></template>
              </NButton>
            </template>
            {{ t('sidebar.delete') }}
          </NTooltip>
        </div>
      </div>

      <NText v-if="entryStore.categories.length === 0" :depth="3" class="block px-3 py-2 text-xs">
        {{ t('sidebar.placeholder') }}
      </NText>
    </nav>

    <div class="border-t border-border p-2">
      <NButton block dashed @click="openCreate">
        <template #icon><NIcon :component="Plus" :size="16" /></template>
        {{ t('sidebar.new') }}
      </NButton>
    </div>

    <!-- 新增 / 重命名分类 -->
    <NModal
      :show="Boolean(editing)"
      :to="OVERLAY_TARGET"
      preset="card"
      :title="editing?.mode === 'create' ? t('sidebar.new') : t('sidebar.rename')"
      style="width: min(420px, calc(100vw - 32px))"
      :bordered="false"
      @update:show="
        (show: boolean) => {
          if (!show) editing = null
        }
      "
    >
      <NText :depth="3" class="mb-1 block text-xs">{{ t('sidebar.nameLabel') }}</NText>
      <NInput
        v-model:value="nameInput"
        :placeholder="t('sidebar.namePlaceholder')"
        :maxlength="40"
        :status="formError ? 'error' : undefined"
        @keydown.enter="submitCategory"
      />

      <div class="mt-3">
        <NText :depth="3" class="mb-1 block text-xs">{{ t('sidebar.颜色') }}</NText>
        <NColorPicker
          v-model:value="colorInput"
          :show-alpha="false"
          :swatches="colorSwatches"
          :actions="colorPickerActions"
          size="small"
          style="width: 100%"
        />
        <NText :depth="3" class="mt-1 block text-[11px]">{{ t('sidebar.颜色提示') }}</NText>
      </div>

      <div class="mt-3">
        <NText :depth="3" class="mb-1 block text-xs">{{ t('sidebar.图标') }}</NText>
        <div class="grid grid-cols-7 gap-1">
          <NButton
            v-for="opt in iconOptions"
            :key="opt.name"
            quaternary
            circle
            size="small"
            class="!h-8 !w-8"
            :class="iconInput === opt.name ? '!bg-primary !text-white' : ''"
            :aria-label="opt.name || t('sidebar.无图标')"
            :title="opt.name || t('sidebar.无图标')"
            @click="iconInput = opt.name"
          >
            <template #icon><NIcon :component="opt.component" :size="16" /></template>
          </NButton>
        </div>
      </div>

      <NText v-if="formError" type="error" class="mt-2 block text-xs">{{ formError }}</NText>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="editing = null">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="busy" @click="submitCategory">
            {{ t('common.save') }}
          </NButton>
        </div>
      </template>
    </NModal>
  </aside>
</template>
