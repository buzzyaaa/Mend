import { Clipboard, computed, effect, cleanup, lifecycle, openUrl, signal } from 'nsh'
import { t } from 'nsh/i18n'

import { errorText, parseError } from './errors'
import { normalizeUrl, sortEntries } from './format'
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
/** 免主密码解锁是否已开启（由密钥文件是否存在决定）。 */
export const deviceUnlockOn = signal(false)

/** 是否有弹窗（Dialog）正在显示。
 *
 *  nsh 的 `Dialog` 在桌面端是**独立原生窗口层**，「永远在最上面」的主界面
 *  Overlay 盖不住它的遮罩。因此 toast 层必须渲染进当前打开的那个弹窗里
 *  （见 `components/ui.tsx` 的 `ModalFrame`），并在弹窗打开时隐藏主界面那份，
 *  否则同一句提示会出现两次（一份被遮罩压暗、一份清晰）。 */
export const modalOpen = computed<boolean>(
  () =>
    settingsOpen() ||
    presetsOpen() ||
    confirm() !== null ||
    entryEditor() !== null ||
    categoryEditor() !== null ||
    categoriesSheetOpen(),
)

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
  // 先让出一拍再碰原生接口。
  //
  // nsh 的 Rust 运行时是在「挂载之外的后续 turn」里才进入的：`boot()` 由挂载
  // 期间的 effect 直接调用时，同步原生接口内部调用 `data_dir()` 这类 ambient
  // 服务会 panic（`no reactive runtime: signals are used on the engine thread,
  // while components run`）。这里先 await 一个 0ms 定时器，把真正的启动挪到
  // 下一拍，与旧代码里 `await Storage.getItem()` 起到的效果一致。
  await sleep(0)
  let lastError: unknown = null
  for (let attempt = 0; attempt <= BOOT_MAX_RETRIES; attempt += 1) {
    if (attempt > 0) await sleep(BOOT_RETRY_DELAY_MS)
    try {
      await native.initVault()
      // 偏好（语言/主题/自动锁定）紧跟 initVault：偏好文件就放在原生层刚
      // 解析出来的数据目录里。loadPreferences 自己吞掉读写/JSON 错误并回退
      // 默认值，绝不让偏好问题把启动推进 Fatal。
      try {
        await loadPreferences()
      } catch {
        // 偏好不是启动必需品：读不出来就用模块里的默认值。
      }
      status.set(await native.status())
      // 用户开过「免主密码解锁」就直接进主界面，不再要求输密码。
      tryDeviceUnlock()
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

/** 免主密码解锁：只有用户显式打开过才存在密钥文件。
 *  文件失效（例如刚恢复过备份）时退回输密码，不阻断启动。 */
function tryDeviceUnlock(): void {
  try {
    // 严格比较 `=== true`：跨桥对接时除 true 以外的任何返回值都当「未开启」，
    // 免得一个包装对象被当成真值。
    deviceUnlockOn.set(native.deviceUnlockEnabled() === true)
    if (!deviceUnlockOn() || !status().initialized) return
    status.set(native.unlockWithDeviceKey())
    touchActivity()
  } catch (error) {
    deviceUnlockOn.set(false)
    showError(error)
  }
}

/** 切换「免主密码解锁」。开启时把当前会话密钥写到数据目录，
 *  关闭时删除该文件。需要已解锁（密钥来自当前会话）。 */
export async function setDeviceUnlock(enabled: boolean): Promise<void> {
  try {
    deviceUnlockOn.set(
      enabled ? native.enableDeviceUnlock() === true : native.disableDeviceUnlock() === true,
    )
    toast(
      enabled ? t('settings.deviceUnlockOn') : t('settings.deviceUnlockOff'),
      enabled ? 'info' : 'success',
      4000,
    )
  } catch (error) {
    showError(error)
    try {
      deviceUnlockOn.set(native.deviceUnlockEnabled())
    } catch {
      deviceUnlockOn.set(false)
    }
  }
}

// ---------------------------------------------------------------------------
// 库文件（用户自选）
// ---------------------------------------------------------------------------
//
//  库文件本身就是完整的保险库：主密码的 salt / Argon2 参数 / 被包裹的 DEK
//  都在文件里。所以「换一座库」＝换一个文件，不需要任何账户或同步机制；
//  用户自己拷贝文件、换台机器带走，或者在设置里随时切回另一座库。

/** 当前库文件所在目录，给文件选择框一个合理的起点。 */
function vaultDir(): string | null {
  const path = status().dbPath
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut > 0 ? path.slice(0, cut) : status().dataDir || null
}

/** 切换库文件并重新走一遍启动流程（等价于「刷新页面」）。 */
async function applyVaultFile(path: string | null): Promise<void> {
  authBusy.set(true)
  try {
    const next = native.switchVault(path)
    // 切换后原库的列表还在内存里，先清掉：新库没解锁时界面不该闪出旧数据。
    entries.set([])
    categories.set([])
    presets.set([])
    selectedId.set(null)
    selected.set(null)
    // 弹窗是独立原生窗口层，不会随主界面重建而消失，这里显式关掉。
    settingsOpen.set(false)
    presetsOpen.set(false)
    entryEditor.set(null)
    categoryEditor.set(null)
    categoriesSheetOpen.set(false)
    confirm.set(null)
    status.set(next)
    deviceUnlockOn.set(native.deviceUnlockEnabled() === true)
    toast(t('vault.switched', { path: next.dbPath }), 'info', 5000)
  } catch (error) {
    showError(error)
    return
  } finally {
    authBusy.set(false)
  }
  await retryBoot()
}

/** 选一个已有的库文件并切换过去。 */
export async function pickExistingVaultFile(): Promise<void> {
  try {
    const path = await native.pickVaultFile(t('vault.pickTitle'), t('vault.pickButton'), vaultDir())
    if (path) await applyVaultFile(path)
  } catch (error) {
    showError(error)
  }
}

/** 指定一个新库文件的位置并切过去；空文件会在设好主密码后建库。 */
export async function pickNewVaultFile(): Promise<void> {
  try {
    const path = await native.pickNewVaultFile(
      t('vault.createTitle'),
      t('vault.createButton'),
      vaultDir(),
      'mend-vault.menddb',
    )
    if (path) await applyVaultFile(path)
  } catch (error) {
    showError(error)
  }
}

/** 回到数据目录里的默认库（`mend.db`）。原有自选文件的指针会被删掉。 */
export async function useDefaultVaultFile(): Promise<void> {
  await applyVaultFile(null)
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
