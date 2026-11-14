import { Clipboard, computed, effect, cleanup, lifecycle, openUrl, Picker, signal } from 'nsh'
import { t } from 'nsh/i18n'
import { btoa } from 'buffer'

import { errorText, isCancelled, parseError } from './errors'
import { formatBytes, normalizeUrl, sortEntries } from './format'
import * as native from './native'
import { loadPreferences, preferences } from './preferences'
import {
  isBuiltinBucket,
  type Category,
  type CategoryInput,
  type ConfirmState,
  type EntryEditorState,
  type EntryInput,
  type EntrySummary,
  type EntryView,
  type ImportResult,
  type ListFilter,
  type Preset,
  type PresetInput,
  type SortMode,
  type ToastItem,
  type ToastKind,
  type VaultStatus,
} from './types'

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

export const status = signal<VaultStatus>({
  initialized: false,
  unlocked: false,
  dataDir: '',
  dbPath: '',
})
export const bootReady = signal(false)
export const fatalError = signal<string | null>(null)
/** 最近一次启动失败的原始错误细节（`code|message`），供 Fatal 页诊断小字展示。 */
export const fatalDetail = signal<string | null>(null)
/** boot / 重试流程进行中：Fatal 页用它禁用重试按钮并显示「重试中…」。 */
export const bootRetrying = signal(false)
export const authBusy = signal(false)
export const detailBusy = signal(false)

export const categories = signal<Category[]>([])
export const entries = signal<EntrySummary[]>([])
export const presets = signal<Preset[]>([])

export const bucket = signal<string>('all')
export const keyword = signal('')
export const tagFilter = signal<string | null>(null)
export const sortBy = signal<SortMode>('updated')

export const selectedId = signal<string | null>(null)
export const selected = signal<EntryView | null>(null)

export const toasts = signal<ToastItem[]>([])
export const confirm = signal<ConfirmState | null>(null)
export const entryEditor = signal<EntryEditorState | null>(null)
export const settingsOpen = signal(false)
export const presetsOpen = signal(false)
export const categoryEditor = signal<{ id: string | null } | null>(null)
export const categoriesSheetOpen = signal(false)

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

let toastSeq = 0
const toastTimers = new Map<number, number>()

export function dismissToast(id: number): void {
  const timer = toastTimers.get(id)
  if (timer !== undefined) {
    clearTimeout(timer)
    toastTimers.delete(id)
  }
  toasts.update((list) => list.filter((item) => item.id !== id))
}

export function toast(message: string, kind: ToastKind = 'success', duration = 2800): void {
  if (!message) return
  const id = ++toastSeq
  toasts.update((list) => [...list, { id, message, kind }].slice(-3))
  const timer = setTimeout(() => dismissToast(id), duration)
  toastTimers.set(id, timer)
}

export function showError(error: unknown, context?: string): void {
  const parsed = parseError(error)
  if (parsed.code === 'locked') {
    void handleLocked()
    return
  }
  toast(errorText(error, context), 'error', 3600)
}

async function runAction<T>(action: () => T | Promise<T>, success?: string): Promise<T | null> {
  try {
    const result = await action()
    if (success) toast(success)
    return result
  } catch (error) {
    showError(error)
    return null
  }
}

// ---------------------------------------------------------------------------
// Boot and auth
// ---------------------------------------------------------------------------

let bootStarted = false

/** code=db 的瞬时错误自动重试参数：最多 2 次重试、间隔 300ms。
 *  库文件被短暂占用（另一实例收尾、杀毒扫描等）时在这里消化掉，不进 Fatal。 */
const BOOT_MAX_RETRIES = 2
const BOOT_RETRY_DELAY_MS = 300

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 只有 SQLite busy/locked 类的瞬时 db 错误才值得自动重试：
 *  crypto / vault 等业务错误、损坏或权限类持久错误重试没有意义。 */
function isTransientDbError(error: unknown): boolean {
  const parsed = parseError(error)
  return parsed.code === 'db' && /busy|locked/i.test(parsed.message)
}

/** 原始 `code|message`，用于 Fatal 页的诊断小字（不替换主文案的 i18n 映射）。 */
function rawErrorText(error: unknown): string {
  const { code, message } = parseError(error)
  return `${code}|${message}`
}

export async function boot(): Promise<void> {
  if (bootStarted) return
  bootStarted = true
  bootRetrying.set(true)
  // 偏好（语言/主题/自动锁定）存在 Storage，与库无关，必须在 initVault 之前
  // 读回并应用：否则设置里改过的语言/主题/自动锁定会在重启后丢失。
  // loadPreferences 自己吞掉 Storage/JSON 错误并回退默认值；这里再兜一层，
  // 保证偏好绝不是进 Fatal 的原因（只有 initVault/status/loadAll 失败才进）。
  try {
    await loadPreferences()
  } catch {
    // 偏好不是启动必需品：读不出来就用模块里的默认值。
  }
  let lastError: unknown = null
  for (let attempt = 0; attempt <= BOOT_MAX_RETRIES; attempt += 1) {
    if (attempt > 0) await sleep(BOOT_RETRY_DELAY_MS)
    try {
      await native.initVault()
      status.set(await native.status())
      if (status().unlocked) await loadAll()
      lastError = null
      break
    } catch (error) {
      lastError = error
      if (!isTransientDbError(error)) break
    }
  }
  bootRetrying.set(false)
  if (lastError === null) {
    // 重试成功后清掉上一轮失败的文案，避免 Fatal 残留
    fatalError.set(null)
    fatalDetail.set(null)
  } else {
    // 启动失败时附带实际解析出的数据目录/库文件路径：只读、权限、路径错配
    // 类问题一眼可辨。status() 不依赖数据库连接，init 失败后仍返回路径。
    let location = ''
    try {
      const paths = native.status()
      const path = paths.dbPath || paths.dataDir
      if (path) location = ` @ ${path}`
    } catch {
      // 状态查询失败时不掩盖原始错误
    }
    fatalDetail.set(`${rawErrorText(lastError)}${location}`)
    fatalError.set(errorText(lastError))
  }
  bootReady.set(true)
}

export async function retryBoot(): Promise<void> {
  // 只重置守卫再重跑 boot()；期间不清 fatalError / bootReady，
  // 让 Fatal 页保持可见：按钮禁用显示「重试中…」，失败后原页更新错误细节。
  bootStarted = false
  await boot()
}

export async function setupVault(masterPassword: string): Promise<void> {
  authBusy.set(true)
  try {
    status.set(await native.setup(masterPassword))
    await loadAll()
    touchActivity()
  } finally {
    authBusy.set(false)
  }
}

export async function unlockVault(masterPassword: string): Promise<void> {
  authBusy.set(true)
  try {
    status.set(await native.unlock(masterPassword))
    await loadAll()
    touchActivity()
  } finally {
    authBusy.set(false)
  }
}

function clearSensitiveState(): void {
  entries.set([])
  presets.set([])
  selectedId.set(null)
  selected.set(null)
  entryEditor.set(null)
  settingsOpen.set(false)
  presetsOpen.set(false)
  categoryEditor.set(null)
  categoriesSheetOpen.set(false)
  confirm.set(null)
  keyword.set('')
  tagFilter.set(null)
}

async function handleLocked(): Promise<void> {
  clearSensitiveState()
  status.update((current) => ({ ...current, unlocked: false }))
}

export async function lockVault(auto = false): Promise<void> {
  try {
    await native.lock()
  } catch {
    // The UI locks regardless: a stale session is not worth keeping visible.
  }
  clearSensitiveState()
  status.update((current) => ({ ...current, unlocked: false }))
  toast(auto ? t('toast.autoLocked') : t('toast.locked'), 'info')
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function loadAll(): Promise<void> {
  try {
    const [categoryList, presetList] = await Promise.all([
      native.listCategories(),
      native.listPresets(),
    ])
    categories.set(categoryList)
    presets.set(presetList)
    await refreshEntries()
  } catch (error) {
    showError(error)
  }
}

export async function refreshCategories(): Promise<void> {
  try {
    categories.set(await native.listCategories())
  } catch (error) {
    showError(error)
  }
}

async function refreshPresets(): Promise<void> {
  try {
    presets.set(await native.listPresets())
  } catch (error) {
    showError(error)
  }
}

export function refreshEntries(): void {
  if (!status().unlocked) return
  const current = bucket()
  const filter: ListFilter = {
    bucket: isBuiltinBucket(current) ? current : 'category',
    categoryId: isBuiltinBucket(current) ? null : current,
    keyword: keyword().trim() || null,
    tag: tagFilter(),
  }
  try {
    entries.set(native.listEntries(filter))
  } catch (error) {
    showError(error)
  }
}

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

export const currentCategoryId = computed<string | null>(() =>
  isBuiltinBucket(bucket()) ? null : bucket(),
)

export const bucketTitle = computed<string>(() => {
  const current = bucket()
  switch (current) {
    case 'all':
      return t('nav.all')
    case 'favorites':
      return t('nav.starred')
    case 'archive':
      return t('nav.archive')
    case 'uncategorized':
      return t('nav.uncategorized')
    case 'trash':
      return t('nav.trash')
    default:
      return categories().find((category) => category.id === current)?.name ?? t('nav.all')
  }
})

export function visibleEntries(): EntrySummary[] {
  return sortEntries(entries(), sortBy(), categories(), bucket())
}

export const isTrashView = computed(() => bucket() === 'trash')
export const isArchiveView = computed(() => bucket() === 'archive')
export const isFavoritesView = computed(() => bucket() === 'favorites')
export const canManualReorder = computed(
  () => !isTrashView() && !isArchiveView() && !isFavoritesView() && bucket() !== 'all',
)

// ---------------------------------------------------------------------------
// Navigation and list actions
// ---------------------------------------------------------------------------

export function selectBucket(next: string): void {
  bucket.set(next)
  tagFilter.set(null)
  selectedId.set(null)
  selected.set(null)
  sortBy.set(
    isBuiltinBucket(next) && (next === 'archive' || next === 'trash') ? 'updated' : sortBy(),
  )
  touchActivity()
  void refreshEntries()
}

let searchTimer: number | null = null

export function setKeyword(value: string): void {
  keyword.set(value)
  touchActivity()
  if (searchTimer !== null) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchTimer = null
    void refreshEntries()
  }, 120)
}

export function setTagFilter(tag: string | null): void {
  tagFilter.set(tag === tagFilter() ? null : tag)
  touchActivity()
  void refreshEntries()
}

export function setSortMode(mode: SortMode): void {
  sortBy.set(mode)
  touchActivity()
}

export async function selectEntry(id: string | null): Promise<void> {
  touchActivity()
  selectedId.set(id)
  if (!id) {
    selected.set(null)
    return
  }
  detailBusy.set(true)
  try {
    selected.set(await native.getEntry(id))
  } catch (error) {
    selected.set(null)
    showError(error)
  } finally {
    detailBusy.set(false)
  }
}

export async function toggleFavorite(entry: EntrySummary): Promise<void> {
  try {
    const next = await native.setFavorite(entry.id, !entry.favorite)
    entries.update((list) =>
      list.map((item) =>
        item.id === next.id
          ? { ...item, favorite: next.favorite, updatedAt: next.updatedAt }
          : item,
      ),
    )
    selected.update((view) =>
      view && view.id === next.id
        ? { ...view, favorite: next.favorite, updatedAt: next.updatedAt }
        : view,
    )
    toast(t('toast.saved'))
  } catch (error) {
    showError(error)
  }
}

export async function saveEntry(input: EntryInput, id: string | null): Promise<EntryView> {
  const view = id ? await native.updateEntry(id, input) : await native.createEntry(input)
  selectedId.set(view.id)
  selected.set(view)
  await refreshCategories()
  await refreshEntries()
  toast(t('toast.saved'))
  return view
}

export async function deleteEntry(id: string, archive = false): Promise<void> {
  const result = await runAction(
    () => (archive ? native.archiveEntry(id) : native.deleteEntry(id)),
    archive ? t('entry.archived') : t('toast.deleted'),
  )
  if (result === null) return
  if (selectedId() === id) {
    selectedId.set(null)
    selected.set(null)
  }
  await refreshCategories()
  await refreshEntries()
}

export async function archiveEntry(id: string): Promise<void> {
  await deleteEntry(id, true)
}

export async function unarchiveEntry(id: string): Promise<void> {
  const ok = await runAction(() => native.unarchiveEntry(id), t('entry.unarchived'))
  if (ok === null) return
  if (selectedId() === id) {
    selectedId.set(null)
    selected.set(null)
  }
  await refreshCategories()
  await refreshEntries()
}

export async function restoreEntry(id: string): Promise<void> {
  const ok = await runAction(() => native.restoreEntry(id), t('trash.restored'))
  if (ok === null) return
  if (selectedId() === id) {
    selectedId.set(null)
    selected.set(null)
  }
  await refreshCategories()
  await refreshEntries()
}

export async function purgeEntry(id: string): Promise<void> {
  const ok = await runAction(() => native.purgeEntry(id), t('trash.purged'))
  if (ok === null) return
  await refreshEntries()
}

export async function purgeAllTrash(): Promise<void> {
  const count = await runAction(() => native.purgeAllTrash())
  if (count === null) return
  toast(t('trash.purgedMany', { count }))
  await refreshEntries()
}

export async function reorderEntries(ids: string[]): Promise<void> {
  try {
    await native.reorderEntries(ids)
    sortBy.set('manual')
    await refreshEntries()
    toast(t('entry.reorderSaved'))
  } catch (error) {
    showError(error)
  }
}

export async function moveEntry(entry: EntrySummary, delta: number): Promise<void> {
  const list = visibleEntries()
  const index = list.findIndex((item) => item.id === entry.id)
  if (index < 0) return
  const target = index + delta
  if (target < 0 || target >= list.length) return
  const next = [...list]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  await reorderEntries(next.map((item) => item.id))
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function saveCategory(
  input: CategoryInput,
  id: string | null,
): Promise<Category | null> {
  try {
    const category = id
      ? await native.updateCategory(id, input)
      : await native.createCategory(input)
    toast(t('toast.saved'))
    await refreshCategories()
    await refreshEntries()
    return category
  } catch (error) {
    showError(error)
    return null
  }
}

export async function removeCategory(id: string): Promise<void> {
  const ok = await runAction(() => native.deleteCategory(id), t('toast.deleted'))
  if (ok === null) return
  if (bucket() === id) {
    bucket.set('all')
  }
  selectedId.set(null)
  selected.set(null)
  await refreshCategories()
  await refreshEntries()
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export async function savePreset(input: PresetInput, id: string | null): Promise<Preset | null> {
  try {
    const preset = id ? await native.updatePreset(id, input) : await native.createPreset(input)
    toast(t('toast.saved'))
    await refreshPresets()
    return preset
  } catch (error) {
    showError(error)
    return null
  }
}

export async function removePreset(id: string): Promise<void> {
  const ok = await runAction(() => native.deletePreset(id), t('toast.deleted'))
  if (ok === null) return
  await refreshPresets()
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

export async function changeMasterPassword(
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  await native.changePassword(oldPassword, newPassword)
  toast(t('settings.passwordChanged'))
}

// ---------------------------------------------------------------------------
// Clipboard and links
// ---------------------------------------------------------------------------

export async function copyText(text: string): Promise<void> {
  if (!text) return
  touchActivity()
  try {
    await Clipboard.writeText(text)
    toast(t('toast.copied'))
  } catch {
    toast(t('toast.copyFailed'), 'error')
  }
}

export async function openExternal(raw: string): Promise<void> {
  const url = normalizeUrl(raw)
  if (!url) {
    toast(t('entry.openUrl'), 'error')
    return
  }
  touchActivity()
  try {
    const result = await openUrl(url)
    if (!result.opened) toast(t('toast.failed'), 'error')
  } catch {
    toast(t('toast.failed'), 'error')
  }
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

function stamp(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function defaultBackupName(): string {
  return `mend-backup-${stamp()}.mendbak`
}

export async function exportBackup(masterPassword: string): Promise<boolean> {
  try {
    const result = await native.exportBackup(null, defaultBackupName(), masterPassword)
    toast(
      t('backup.exported', {
        path: result.path,
        size: formatBytes(result.bytes),
      }),
      'success',
      4500,
    )
    return true
  } catch (error) {
    if (!isCancelled(error)) showError(error)
    return false
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

export async function pickBackupFile(): Promise<File | null> {
  try {
    const picked = await Picker.pickFiles({
      multiple: false,
      filters: [{ name: 'Mend backup', extensions: ['mendbak'] }],
    })
    return picked[0]?.file ?? null
  } catch (error) {
    showError(error)
    return null
  }
}

export async function importBackup(
  file: File,
  masterPassword: string,
): Promise<ImportResult | null> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const base64 = bytesToBase64(bytes)
    const result = await native.importBackupBase64(base64, masterPassword)
    clearSensitiveState()
    status.update((current) => ({ ...current, initialized: true, unlocked: false }))
    toast(
      t('backup.imported', {
        entries: result.entries,
        categories: result.categories,
      }),
      'success',
      4500,
    )
    return result
  } catch (error) {
    showError(error)
    return null
  }
}

// ---------------------------------------------------------------------------
// Idle lock
// ---------------------------------------------------------------------------

let lastActivity = Date.now()

export function touchActivity(): void {
  lastActivity = Date.now()
}

export function startAutoLock(): void {
  effect(() => {
    if (!status().unlocked) {
      lastActivity = Date.now()
      return
    }
    const minutes = preferences().autoLockMinutes
    if (!minutes) return
    const timer = setInterval(() => {
      if (!status().unlocked) {
        lastActivity = Date.now()
        return
      }
      if (Date.now() - lastActivity >= minutes * 60_000) {
        void lockVault(true)
      }
    }, 15_000)
    cleanup(() => clearInterval(timer))
  })

  effect(() => {
    if (lifecycle() === 'active') lastActivity = Date.now()
  })
}
