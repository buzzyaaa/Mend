<script setup lang="ts">
// 设置弹窗：外观与行为、修改主密码、加密备份与恢复。
// 原为独立 /settings 路由页，改为弹窗后顶栏不再跳转路由。
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Download, FolderOpen, KeyRound, LockKeyhole, Palette, RefreshCw, Upload } from 'lucide-vue-next'
import {
  NAlert,
  NButton,
  NCard,
  NIcon,
  NInput,
  NModal,
  NSelect,
  NText,
  useDialog,
} from 'naive-ui'
import { usePreferencesStore } from '@/stores/preferences'
import { useVaultStore } from '@/stores/vault'
import { useToast } from '@/composables/useToast'
import { backupApi, isTauri } from '@/lib/ipc'
import { getAppVersion } from '@/lib/update'
import { useUpdateChecker } from '@/composables/useUpdateChecker'
import { OVERLAY_TARGET } from '@/lib/theme'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import type { AppPaths, ThemeMode } from '@/types'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()
const router = useRouter()
const preferences = usePreferencesStore()
const vaultStore = useVaultStore()
const toast = useToast()
const dialog = useDialog()
const { checking, runCheck } = useUpdateChecker()

const autoLockValues = [1, 5, 10, 15, 30, 60]

const themeOptions = computed(() => [
  { label: t('settings.themeSystem'), value: 'system' },
  { label: t('settings.themeLight'), value: 'light' },
  { label: t('settings.themeDark'), value: 'dark' },
])
const autoLockOptions = computed(() => [
  { label: t('settings.off'), value: 0 },
  ...autoLockValues.map((n) => ({ label: t('settings.minutes', { n }), value: n })),
])
const updateIntervalOptions = computed(() => [
  { label: t('update.intervalWeek'), value: 7 },
  { label: t('update.intervalMonth'), value: 30 },
  { label: t('update.intervalYear'), value: 365 },
])

// —— 更新 ——
const appVersion = ref('')

async function checkNow() {
  await runCheck(true)
}

// —— 备份与恢复 ——
const paths = ref<AppPaths | null>(null)
const exportPath = ref('')
const exportPassword = ref('')
const importPath = ref('')
const importPassword = ref('')
const backupBusy = ref(false)
const backupError = ref('')

/** 默认导出路径：数据目录 + 带日期的文件名，用户可改成任意位置。 */
function defaultExportPath(dir: string): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const sep = dir.endsWith('\\') || dir.endsWith('/') ? '' : '\\'
  return `${dir}${sep}mend-backup-${stamp}.mendbak`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 用系统文件管理器选导出位置（取消返回 null）。 */
async function chooseExportPath(): Promise<string | null> {
  try {
    const picked = await saveDialog({
      title: t('backup.export'),
      defaultPath: exportPath.value || defaultExportPath(paths.value?.dataDir ?? ''),
      filters: [{ name: 'Mend backup', extensions: ['mendbak'] }],
    })
    if (typeof picked === 'string' && picked) {
      const path = picked.toLowerCase().endsWith('.mendbak') ? picked : `${picked}.mendbak`
      exportPath.value = path
      return path
    }
  } catch (err) {
    backupError.value = err instanceof Error ? err.message : String(err)
  }
  return null
}

/** 用系统文件管理器挑备份文件（取消返回 null）。 */
async function chooseImportPath(): Promise<string | null> {
  try {
    const picked = await openDialog({
      title: t('backup.import'),
      multiple: false,
      directory: false,
      filters: [{ name: 'Mend backup', extensions: ['mendbak'] }],
    })
    if (typeof picked === 'string' && picked) {
      importPath.value = picked
      return picked
    }
  } catch (err) {
    backupError.value = err instanceof Error ? err.message : String(err)
  }
  return null
}

async function exportBackup() {
  backupError.value = ''
  if (!exportPassword.value) {
    backupError.value = t('backup.passwordPlaceholder')
    return
  }
  let path = exportPath.value
  if (!path) {
    const picked = await chooseExportPath()
    if (!picked) return
    path = picked
  }
  backupBusy.value = true
  try {
    const result = await backupApi.export(path, exportPassword.value)
    toast.success(t('backup.exported', { path: result.path, size: formatSize(result.bytes) }))
    exportPassword.value = ''
  } catch (err) {
    backupError.value = err instanceof Error ? err.message : String(err)
  } finally {
    backupBusy.value = false
  }
}

function importBackup() {
  backupError.value = ''
  if (!importPassword.value) {
    backupError.value = t('backup.passwordPlaceholder')
    return
  }
  dialog.warning({
    title: t('backup.import'),
    content: t('backup.importConfirm'),
    positiveText: t('backup.importAction'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      let path = importPath.value
      if (!path) {
        const picked = await chooseImportPath()
        if (!picked) return
        path = picked
      }
      backupBusy.value = true
      try {
        const result = await backupApi.import(path, importPassword.value)
        // 后端恢复后会锁定会话，前端同步状态并回到解锁页
        vaultStore.setStatus({ initialized: true, unlocked: false })
        toast.success(
          t('backup.imported', { entries: result.entries, categories: result.categories }),
        )
        await router.push('/unlock')
      } catch (err) {
        backupError.value = err instanceof Error ? err.message : String(err)
      } finally {
        backupBusy.value = false
      }
    },
  })
}

// 每次打开弹窗都重新取一次路径与版本，关闭期间不发起 IPC
watch(
  () => props.open,
  (open) => {
    if (!open || !isTauri()) return
    backupApi
      .paths()
      .then((p) => {
        paths.value = p
        if (!exportPath.value) exportPath.value = defaultExportPath(p.dataDir)
      })
      .catch(() => {
        // 拿不到路径只影响默认值，不阻塞弹窗
      })
    getAppVersion()
      .then((v) => {
        appVersion.value = v
      })
      .catch(() => {
        // 拿不到版本只影响展示
      })
  },
  { immediate: true },
)

// —— 修改主密码 ——
const pwForm = reactive({ old: '', next: '', confirm: '' })
const pwError = ref('')
const pwBusy = ref(false)

async function changePassword() {
  pwError.value = ''
  if (pwForm.next.length < 4) {
    pwError.value = t('settings.passwordTooShort')
    return
  }
  if (pwForm.next !== pwForm.confirm) {
    pwError.value = t('settings.passwordMismatch')
    return
  }
  pwBusy.value = true
  try {
    await vaultStore.changePassword(pwForm.old, pwForm.next)
    pwForm.old = ''
    pwForm.next = ''
    pwForm.confirm = ''
    toast.success(t('settings.passwordChanged'))
  } catch (err) {
    pwError.value = err instanceof Error ? err.message : String(err)
  } finally {
    pwBusy.value = false
  }
}
</script>

<template>
  <NModal
    :show="open"
    :to="OVERLAY_TARGET"
    :mask-closable="false"
    @update:show="(show: boolean) => { if (!show) emit('close') }"
  >
    <NCard
      :title="t('nav.settings')"
      :bordered="false"
      closable
      size="large"
      style="width: min(760px, calc(100vw - 32px))"
      :content-style="{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }"
      @close="emit('close')"
    >
      <div class="grid gap-4">
        <!-- 外观与行为 -->
        <NCard size="small">
          <template #header>
            <div class="flex items-center gap-2">
              <NIcon :component="Palette" :size="17" />
              <NText strong>{{ t('settings.appearance') }}</NText>
            </div>
          </template>

          <div class="divide-y divide-border">
            <div class="flex items-center justify-between gap-4 py-2.5">
              <NText class="text-sm">{{ t('settings.theme') }}</NText>
              <NSelect
                :value="preferences.theme"
                :options="themeOptions"
                style="width: 160px"
                @update:value="(value: string) => preferences.setTheme(value as ThemeMode)"
              />
            </div>
            <div class="flex items-center justify-between gap-4 py-2.5">
              <div class="min-w-0">
                <NText class="block text-sm">{{ t('settings.autoLock') }}</NText>
                <NText :depth="3" class="block text-xs">{{ t('settings.autoLockHint') }}</NText>
              </div>
              <NSelect
                :value="preferences.autoLockMinutes"
                :options="autoLockOptions"
                style="width: 160px"
                @update:value="(value: number) => preferences.setAutoLockMinutes(value)"
              />
            </div>
            <div class="flex items-center justify-between gap-4 py-2.5">
              <div class="min-w-0">
                <NText class="block text-sm">{{ t('update.checkInterval') }}</NText>
                <NText :depth="3" class="block text-xs">{{ t('update.checkIntervalHint') }}</NText>
              </div>
              <NSelect
                :value="preferences.updateCheckIntervalDays"
                :options="updateIntervalOptions"
                style="width: 160px"
                @update:value="(value: number) => preferences.setUpdateCheckIntervalDays(value)"
              />
            </div>
          </div>
        </NCard>

        <!-- 更新 -->
        <NCard size="small">
          <template #header>
            <div class="flex items-center gap-2">
              <NIcon :component="Download" :size="17" />
              <NText strong>{{ t('update.title') }}</NText>
            </div>
          </template>
          <NText :depth="3" class="mb-3 block text-xs">{{ t('update.hint') }}</NText>

          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <NText :depth="3" class="text-xs">{{ t('update.currentVersion') }}</NText>
              <NText class="font-mono text-sm">{{ appVersion || '—' }}</NText>
            </div>
            <NButton size="small" :loading="checking" :disabled="!isTauri()" @click="checkNow">
              <template #icon><NIcon :component="RefreshCw" :size="14" /></template>
              {{ t('update.checkNow') }}
            </NButton>
          </div>
        </NCard>

        <!-- 修改主密码 -->
        <NCard size="small">
          <template #header>
            <div class="flex items-center gap-2">
              <NIcon :component="LockKeyhole" :size="17" />
              <NText strong>{{ t('settings.changePassword') }}</NText>
            </div>
          </template>
          <NText :depth="3" class="mb-3 block text-xs">{{ t('settings.changePasswordHint') }}</NText>

          <div class="grid max-w-md gap-2">
            <NInput
              v-model:value="pwForm.old"
              type="password"
              show-password-on="click"
              autocomplete="current-password"
              :placeholder="t('settings.oldPassword')"
            >
              <template #prefix><NIcon :component="KeyRound" :size="15" /></template>
            </NInput>
            <NInput
              v-model:value="pwForm.next"
              type="password"
              show-password-on="click"
              autocomplete="new-password"
              :placeholder="t('settings.newPassword')"
            />
            <NInput
              v-model:value="pwForm.confirm"
              type="password"
              show-password-on="click"
              autocomplete="new-password"
              :placeholder="t('settings.confirmPassword')"
            />
            <NAlert v-if="pwError" type="error" :show-icon="false" class="mt-1">{{ pwError }}</NAlert>
            <div class="flex justify-end">
              <NButton
                type="primary"
                :loading="pwBusy"
                :disabled="!pwForm.old || !pwForm.next"
                @click="changePassword"
              >
                {{ t('common.confirm') }}
              </NButton>
            </div>
          </div>
        </NCard>

        <!-- 备份与恢复 -->
        <NCard size="small">
          <template #header>
            <div class="flex items-center gap-2">
              <NIcon :component="FolderOpen" :size="17" />
              <NText strong>{{ t('backup.title') }}</NText>
            </div>
          </template>
          <NText :depth="3" class="mb-3 block text-xs">{{ t('backup.hint') }}</NText>

          <div class="mb-4 grid gap-2">
            <div class="flex items-center gap-2">
              <NText :depth="3" class="w-20 shrink-0 text-xs">{{ t('backup.dataDir') }}</NText>
              <NInput :value="paths?.dataDir ?? ''" readonly size="small" class="font-mono min-w-0 flex-1" />
            </div>
            <NText :depth="3" class="block text-xs">{{ t('backup.dataDirHint') }}</NText>
            <NText :depth="3" class="block text-xs">{{ t('backup.pickHint') }}</NText>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="min-w-0 rounded-lg border border-border p-3">
              <NText strong class="mb-2 block text-sm">{{ t('backup.export') }}</NText>
              <div class="grid gap-2">
                <div class="flex items-center gap-2">
                  <NButton size="small" :disabled="backupBusy" class="shrink-0" @click="chooseExportPath">
                    <template #icon><NIcon :component="FolderOpen" :size="14" /></template>
                    {{ t('backup.chooseExport') }}
                  </NButton>
                  <div class="min-w-0 flex-1 truncate font-mono text-xs text-[var(--n-text-color-3,#999)]">{{ exportPath || t('backup.noLocation') }}</div>
                </div>
                <NInput
                  v-model:value="exportPassword"
                  type="password"
                  show-password-on="click"
                  autocomplete="off"
                  size="small"
                  :placeholder="t('backup.passwordPlaceholder')"
                />
                <NButton block type="primary" :loading="backupBusy" @click="exportBackup">
                  <template #icon><NIcon :component="Download" :size="15" /></template>
                  {{ t('backup.exportAction') }}
                </NButton>
              </div>
            </div>

            <div class="min-w-0 rounded-lg border border-border p-3">
              <NText strong class="mb-2 block text-sm">{{ t('backup.import') }}</NText>
              <div class="grid gap-2">
                <div class="flex items-center gap-2">
                  <NButton size="small" :disabled="backupBusy" class="shrink-0" @click="chooseImportPath">
                    <template #icon><NIcon :component="FolderOpen" :size="14" /></template>
                    {{ t('backup.chooseImport') }}
                  </NButton>
                  <div class="min-w-0 flex-1 truncate font-mono text-xs text-[var(--n-text-color-3,#999)]">{{ importPath || t('backup.noLocation') }}</div>
                </div>
                <NInput
                  v-model:value="importPassword"
                  type="password"
                  show-password-on="click"
                  autocomplete="off"
                  size="small"
                  :placeholder="t('backup.passwordPlaceholder')"
                />
                <NButton block type="error" secondary :loading="backupBusy" @click="importBackup">
                  <template #icon><NIcon :component="Upload" :size="15" /></template>
                  {{ t('backup.importAction') }}
                </NButton>
              </div>
            </div>
          </div>

          <NAlert v-if="backupError" type="error" :show-icon="false" class="mt-3">
            {{ backupError }}
          </NAlert>
        </NCard>
      </div>

      <template #footer>
        <div class="flex justify-end">
          <NButton @click="emit('close')">{{ t('common.close') }}</NButton>
        </div>
      </template>
    </NCard>
  </NModal>
</template>
