<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { usePreferencesStore } from '@/stores/preferences'
import { usePresetStore } from '@/stores/preset'
import { useVaultStore } from '@/stores/vault'
import { useToast } from '@/composables/useToast'
import { backupApi, isTauri } from '@/lib/ipc'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { setI18nLocale } from '@/i18n'
import type { AppPaths, Locale, Preset, PresetFieldType, ThemeMode } from '@/types'

const { t } = useI18n()
const router = useRouter()
const preferences = usePreferencesStore()
const presetStore = usePresetStore()
const vaultStore = useVaultStore()
const toast = useToast()

const locales: { value: Locale; label: string }[] = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: 'EN' },
]

const autoLockOptions = [1, 5, 10, 15, 30, 60]
const clipboardOptions = [15, 30, 60, 120]

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
  const picked = await saveDialog({
    title: t('backup.export'),
    defaultPath: exportPath.value || defaultExportPath(paths.value?.dataDir ?? ''),
    filters: [{ name: 'Mend backup', extensions: ['mendbak'] }],
  })
  if (typeof picked === 'string' && picked) {
    // 用户没写扩展名时补上，避免产出无后缀文件
    const path = picked.toLowerCase().endsWith('.mendbak') ? picked : `${picked}.mendbak`
    exportPath.value = path
    return path
  }
  return null
}

/** 用系统文件管理器挑备份文件（取消返回 null）。 */
async function chooseImportPath(): Promise<string | null> {
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
  return null
}

async function exportBackup() {
  backupError.value = ''
  const path = await chooseExportPath()
  if (!path) return
  if (!exportPassword.value) {
    backupError.value = t('backup.masterPassword')
    return
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

async function importBackup() {
  backupError.value = ''
  const path = await chooseImportPath()
  if (!path) return
  if (!importPassword.value) {
    backupError.value = t('backup.masterPassword')
    return
  }
  if (!window.confirm(t('backup.importConfirm'))) return
  backupBusy.value = true
  try {
    const result = await backupApi.import(path, importPassword.value)
    // 后端恢复后会锁定会话，前端同步状态并回到解锁页
    vaultStore.setStatus({ initialized: true, unlocked: false })
    window.alert(t('backup.imported', { entries: result.entries, categories: result.categories }))
    router.push('/unlock')
  } catch (err) {
    backupError.value = err instanceof Error ? err.message : String(err)
  } finally {
    backupBusy.value = false
  }
}

onMounted(() => {
  presetStore.refresh().catch(() => {
    // 未解锁或浏览器预览：静默
  })
  if (!isTauri()) return
  backupApi
    .paths()
    .then((p) => {
      paths.value = p
      if (!exportPath.value) exportPath.value = defaultExportPath(p.dataDir)
    })
    .catch(() => {
      // 拿不到路径只影响默认值，不阻塞页面
    })
})

function onLocaleChange(event: Event) {
  const next = (event.target as HTMLSelectElement).value as Locale
  preferences.setLocale(next)
  setI18nLocale(next)
}

function onThemeChange(event: Event) {
  preferences.setTheme((event.target as HTMLSelectElement).value as ThemeMode)
}

function onAutoLockChange(event: Event) {
  preferences.setAutoLockMinutes(Number((event.target as HTMLSelectElement).value))
}

function onClipboardChange(event: Event) {
  preferences.setClipboardClearSeconds(Number((event.target as HTMLSelectElement).value))
}

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
  <div class="flex h-screen flex-col">
    <header class="flex h-14 items-center gap-3 border-b border-border bg-card px-4">
      <button
        type="button"
        class="text-sm text-muted-foreground hover:text-foreground"
        @click="router.push('/main')"
      >
        ← {{ t('app.name') }}
      </button>
      <span class="text-sm font-medium">{{ t('topbar.settings') }}</span>
    </header>

    <main class="flex-1 space-y-4 overflow-y-auto p-6">
      <div class="flex items-center justify-between rounded-lg border border-border bg-card p-4">
        <span class="text-sm">{{ t('settings.language') }}</span>
        <select
          :value="preferences.locale"
          class="rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          @change="onLocaleChange"
        >
          <option v-for="l in locales" :key="l.value" :value="l.value">{{ l.label }}</option>
        </select>
      </div>

      <!-- 外观与行为 -->
      <section class="divide-y divide-border rounded-lg border border-border bg-card">
        <div class="flex items-center justify-between p-4">
          <span class="text-sm">{{ t('settings.theme') }}</span>
          <select
            :value="preferences.theme"
            class="rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            @change="onThemeChange"
          >
            <option value="system">{{ t('settings.themeSystem') }}</option>
            <option value="light">{{ t('settings.themeLight') }}</option>
            <option value="dark">{{ t('settings.themeDark') }}</option>
          </select>
        </div>

        <div class="flex items-center justify-between gap-4 p-4">
          <div>
            <div class="text-sm">{{ t('settings.autoLock') }}</div>
            <div class="text-xs text-muted-foreground">{{ t('settings.autoLockHint') }}</div>
          </div>
          <select
            :value="preferences.autoLockMinutes"
            class="shrink-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            @change="onAutoLockChange"
          >
            <option :value="0">{{ t('settings.off') }}</option>
            <option v-for="m in autoLockOptions" :key="m" :value="m">
              {{ t('settings.minutes', { n: m }) }}
            </option>
          </select>
        </div>

        <div class="flex items-center justify-between gap-4 p-4">
          <div>
            <div class="text-sm">{{ t('settings.clipboard') }}</div>
            <div class="text-xs text-muted-foreground">{{ t('settings.clipboardHint') }}</div>
          </div>
          <select
            :value="preferences.clipboardClearSeconds"
            class="shrink-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            @change="onClipboardChange"
          >
            <option :value="0">{{ t('settings.off') }}</option>
            <option v-for="s in clipboardOptions" :key="s" :value="s">
              {{ t('settings.seconds', { n: s }) }}
            </option>
          </select>
        </div>
      </section>

      <!-- 修改主密码 -->
      <section class="rounded-lg border border-border bg-card p-4">
        <h2 class="text-sm font-medium">{{ t('settings.changePassword') }}</h2>
        <p class="mb-3 mt-0.5 text-xs text-muted-foreground">
          {{ t('settings.changePasswordHint') }}
        </p>

        <div class="grid max-w-md grid-cols-1 gap-2">
          <input
            v-model="pwForm.old"
            type="password"
            autocomplete="current-password"
            class="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            :placeholder="t('settings.oldPassword')"
          />
          <input
            v-model="pwForm.next"
            type="password"
            autocomplete="new-password"
            class="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            :placeholder="t('settings.newPassword')"
          />
          <input
            v-model="pwForm.confirm"
            type="password"
            autocomplete="new-password"
            class="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            :placeholder="t('settings.confirmPassword')"
          />

          <p v-if="pwError" class="text-xs text-destructive">{{ pwError }}</p>

          <div class="flex justify-end">
            <button
              type="button"
              class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              :disabled="pwBusy || !pwForm.old || !pwForm.next"
              @click="changePassword"
            >
              {{ t('common.confirm') }}
            </button>
          </div>
        </div>
      </section>

      <!-- 预设值：账号 / 邮箱 / 手机号 -->
      <section class="rounded-lg border border-border bg-card p-4">
        <div class="mb-1 flex items-center justify-between">
          <h2 class="text-sm font-medium">{{ t('preset.title') }}</h2>
          <span class="text-xs text-muted-foreground">{{ t('preset.hint') }}</span>
        </div>

        <p v-if="presetStore.presets.length === 0" class="py-3 text-xs text-muted-foreground">
          {{ t('preset.empty') }}
        </p>

        <div v-else class="space-y-3 py-2">
          <div v-for="type in fieldTypes" :key="type">
            <template v-if="presetStore.byType(type).length">
              <div class="mb-1 text-xs font-medium text-muted-foreground">
                {{ t(`preset.types.${type}`) }}
              </div>
              <div class="space-y-1">
                <div
                  v-for="preset in presetStore.byType(type)"
                  :key="preset.id"
                  class="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                >
                  <span class="w-24 shrink-0 truncate">{{ preset.label }}</span>
                  <span class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                    {{ preset.value }}
                  </span>
                  <button
                    type="button"
                    class="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    @click="startEdit(preset)"
                  >
                    {{ t('common.rename') }}
                  </button>
                  <button
                    type="button"
                    class="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-destructive"
                    @click="remove(preset)"
                  >
                    {{ t('common.delete') }}
                  </button>
                </div>
              </div>
            </template>
          </div>
        </div>

        <div class="mt-3 space-y-2 rounded-md border border-dashed border-border p-3">
          <div class="text-xs font-medium">{{ headingOfForm }}</div>
          <div class="flex flex-wrap items-center gap-2">
            <select
              v-model="form.fieldType"
              class="rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none"
            >
              <option v-for="type in fieldTypes" :key="type" :value="type">
                {{ t(`preset.types.${type}`) }}
              </option>
            </select>
            <input
              v-model="form.label"
              :placeholder="t('preset.labelPlaceholder')"
              maxlength="40"
              class="w-36 rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none"
            />
            <input
              v-model="form.value"
              :placeholder="t('preset.value')"
              class="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none"
            />
            <button
              type="button"
              class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
              :disabled="busy"
              @click="submit"
            >
              {{ editId ? t('common.save') : t('preset.add') }}
            </button>
            <button
              v-if="editId"
              type="button"
              class="rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent"
              @click="resetForm"
            >
              {{ t('common.cancel') }}
            </button>
          </div>
          <p v-if="formError" class="text-xs text-destructive">{{ formError }}</p>
        </div>
      </section>

      <!-- 备份与恢复 -->
      <section class="rounded-lg border border-border bg-card p-4">
        <div class="mb-1 flex items-center justify-between">
          <h2 class="text-sm font-medium">{{ t('backup.title') }}</h2>
          <span class="text-xs text-muted-foreground">{{ t('backup.hint') }}</span>
        </div>

        <div class="mt-3 space-y-1">
          <div class="flex items-center gap-2 text-xs">
            <span class="w-24 shrink-0 text-muted-foreground">{{ t('backup.dataDir') }}</span>
            <input
              :value="paths?.dataDir ?? ''"
              readonly
              class="min-w-0 flex-1 rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs"
            />
          </div>
          <p class="text-xs text-muted-foreground">{{ t('backup.dataDirHint') }}</p>
          <p class="text-xs text-muted-foreground">{{ t('backup.pickHint') }}</p>
        </div>

        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <!-- 导出 -->
          <div class="space-y-2 rounded-md border border-dashed border-border p-3">
            <div class="text-xs font-medium">{{ t('backup.export') }}</div>
            <input
              :value="exportPath"
              readonly
              :placeholder="t('backup.exportPathPlaceholder')"
              class="w-full rounded-md border border-border bg-muted px-2 py-1.5 font-mono text-xs outline-none"
            />
            <input
              v-model="exportPassword"
              type="password"
              :placeholder="t('backup.passwordPlaceholder')"
              autocomplete="off"
              class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none"
            />
            <button
              type="button"
              class="w-full rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
              :disabled="backupBusy"
              @click="exportBackup"
            >
              {{ t('backup.exportAction') }}
            </button>
          </div>

          <!-- 恢复 -->
          <div class="space-y-2 rounded-md border border-dashed border-border p-3">
            <div class="text-xs font-medium">{{ t('backup.import') }}</div>
            <input
              :value="importPath"
              readonly
              :placeholder="t('backup.exportPathPlaceholder')"
              class="w-full rounded-md border border-border bg-muted px-2 py-1.5 font-mono text-xs outline-none"
            />
            <input
              v-model="importPassword"
              type="password"
              :placeholder="t('backup.passwordPlaceholder')"
              autocomplete="off"
              class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none"
            />
            <button
              type="button"
              class="w-full rounded-md border border-destructive px-3 py-1.5 text-sm text-destructive hover:bg-accent disabled:opacity-60"
              :disabled="backupBusy"
              @click="importBackup"
            >
              {{ t('backup.importAction') }}
            </button>
          </div>
        </div>

        <p v-if="backupError" class="mt-2 text-xs text-destructive">{{ backupError }}</p>
      </section>

      <!-- WebDAV：只放占位，不联网 -->
      <div
        class="flex items-center justify-between rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground"
      >
        <span>{{ t('backup.webdav') }}</span>
        <span class="text-xs">{{ t('backup.webdavDisabled') }}</span>
      </div>
    </main>
  </div>
</template>
