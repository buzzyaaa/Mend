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
/** 标签筛选：空数组 = 不限；多个标签按 OR 语义（命中任一即显示）。 */
export const tagFilters = signal<string[]>([])
export const sortBy = signal<SortMode>('updated')

export const selectedId = signal<string | null>(null)
export const selected = signal<EntryView | null>(null)
/** 条目详情弹窗：列表上的「查看详情」按钮打开，关闭时清空选中项。 */
export const detailOpen = signal(false)
/** 解锁后的主页面：左侧图标栏在密码列表与设置页之间切换。 */
export const activePage = signal<'entries' | 'settings'>('entries')
/** 列表直接展示的敏感字段。只在解锁期间驻留内存，锁定即清空。
 *  只解密「已加载窗口」内的条目：滚动到底部时再增量解密下一批，
 *  避免上万条一次性解密把引擎线程卡住。 */
export type FieldValues = { username: string; password: string; email: string; phone: string }
export const entryFields = signal<Record<string, FieldValues>>({})
/** 与 entryFields 并行填充的备注明文（列表行备注简写用），锁定即清空。 */
export const entryNotes = signal<Record<string, string>>({})
/** 备注编辑弹窗：null = 关闭，字符串 = 要编辑备注的 entry id。 */
export const notesEditor = signal<string | null>(null)

/** 滚动加载：一次加载/解密的条目数。 */
export const PAGE_SIZE = 50
/** 当前已解密并交给列表渲染的条目数（visibleEntries 的前 N 条）。 */
export const loadedCount = signal(0)
/** 正在增量解密下一批（列表底部转圈）。 */
export const fieldsLoading = signal(false)
/** 视图：常规表格 / 紧凑。 */
export const viewMode = signal<'list' | 'compact'>('list')
/** 全局“显示密码”开关（工具栏），锁定后重置。 */
export const showPasswords = signal(true)
/** 逐条密码临时隐藏（每行眼睛图标），锁定后清空。 */
export const hiddenPasswords = signal<Set<string>>(new Set())
/** 多选：当前勾选的条目 id。 */
export const selectedIds = signal<Set<string>>(new Set())
/** 第二行“全部类型”筛选：按分类 id 过滤，null 为不限。 */
export const typeFilter = signal<string | null>(null)

export const toasts = signal<ToastItem[]>([])
export const confirm = signal<ConfirmState | null>(null)
export const entryEditor = signal<EntryEditorState | null>(null)
export const settingsOpen = signal(false)
export const presetsOpen = signal(false)
export const categoryEditor = signal<{ id: string | null } | null>(null)
export const categoriesSheetOpen = signal(false)
/** 更新确认弹窗：由设置页的「立即更新」打开，确认后交给 lib/update 下载安装。 */
export type UpdateTarget = 'app' | 'package'
export const updatePromptOpen = signal(false)
export const updateTarget = signal<UpdateTarget | null>(null)
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
    detailOpen() ||
    presetsOpen() ||
    confirm() !== null ||
    entryEditor() !== null ||
    categoryEditor() !== null ||
    categoriesSheetOpen() ||
    notesEditor() !== null ||
    updatePromptOpen(),
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
    entryFields.set({})
    entryNotes.set({})
    notesEditor.set(null)
    loadedCount.set(0)
    fieldsLoading.set(false)
    selectedIds.set(new Set())
    hiddenPasswords.set(new Set())
    typeFilter.set(null)
    tagFilters.set([])
    categories.set([])
    presets.set([])
    closeDetail()
    activePage.set('entries')
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
  entryFields.set({})
  entryNotes.set({})
  notesEditor.set(null)
  loadedCount.set(0)
  fieldsLoading.set(false)
  selectedIds.set(new Set())
  hiddenPasswords.set(new Set())
  showPasswords.set(true)
  typeFilter.set(null)
  viewMode.set('list')
  presets.set([])
  selectedId.set(null)
  selected.set(null)
  detailOpen.set(false)
  activePage.set('entries')
  entryEditor.set(null)
  settingsOpen.set(false)
  presetsOpen.set(false)
  categoryEditor.set(null)
  categoriesSheetOpen.set(false)
  confirm.set(null)
  keyword.set('')
  tagFilters.set([])
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

/** 解密一段条目（按可见顺序 [from, to)）的四个敏感字段，并入 entryFields。
 *  逐条 try：单条损坏不应让整批/整个列表消失。同步原生调用，跑在引擎线程。 */
function decryptRange(list: EntrySummary[], from: number, to: number): void {
  const patch: Record<string, FieldValues> = {}
  const notesPatch: Record<string, string> = {}
  for (const entry of list.slice(from, to)) {
    try {
      const view = native.getEntry(entry.id)
      patch[entry.id] = {
        username: view.username,
        password: view.password,
        email: view.email,
        phone: view.phone,
      }
      // 同一次 getEntry 顺带取备注明文，不增加原生调用次数。
      notesPatch[entry.id] = view.notes
    } catch {
      // 单条读取失败：该行字段显示为空，仍可展开详情重试。
    }
  }
  if (Object.keys(patch).length > 0) {
    entryFields.update((prev) => ({ ...prev, ...patch }))
  }
  if (Object.keys(notesPatch).length > 0) {
    entryNotes.update((prev) => ({ ...prev, ...notesPatch }))
  }
}

/** 重置窗口并解密第一批。所有会改变列表内容/顺序的操作都走这里，
 *  避免上万条数据每次刷新都把全库解密一遍（那是滚动卡顿的根因）。 */
function reloadVisibleWindow(): void {
  if (!status().unlocked) return
  const all = visibleEntries()
  entryFields.set({})
  entryNotes.set({})
  selectedIds.set(new Set())
  if (all.length === 0) {
    loadedCount.set(0)
    return
  }
  const first = Math.min(PAGE_SIZE, all.length)
  loadedCount.set(first)
  decryptRange(all, 0, first)
}

export function refreshEntries(): void {
  if (!status().unlocked) return
  const current = bucket()
  const filter: ListFilter = {
    bucket: isBuiltinBucket(current) ? current : 'category',
    categoryId: isBuiltinBucket(current) ? null : current,
    keyword: keyword().trim() || null,
    // 标签筛选改到 visibleEntries() 做客户端 OR 过滤，不给原生层传单个 tag。
    tag: null,
  }
  try {
    entries.set(native.listEntries(filter))
    reloadVisibleWindow()
  } catch (error) {
    showError(error)
  }
}

/** 列表触底时调用：增量解密下一批字段并扩大可见窗口。
 *  同步完成（getEntry 是同步原生调用）；fieldsLoading 只作重入保护。 */
export function loadMoreEntries(): void {
  if (fieldsLoading() || !status().unlocked) return
  const all = visibleEntries()
  const from = loadedCount()
  if (from >= all.length) return
  const to = Math.min(from + PAGE_SIZE, all.length)
  fieldsLoading.set(true)
  try {
    decryptRange(all, from, to)
    loadedCount.set(to)
  } finally {
    fieldsLoading.set(false)
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
  const all = sortEntries(entries(), sortBy(), categories(), bucket())
  const type = typeFilter()
  const byType = type ? all.filter((entry) => entry.categoryId === type) : all
  const tags = tagFilters()
  if (tags.length === 0) return byType
  // 多选标签：命中其中任一即显示（OR）。
  return byType.filter((entry) => entry.tags.some((t) => tags.includes(t)))
}

/** 当前真正交给列表渲染的子集：随滚动逐步扩大，避免一次性挂载全部行。 */
export const displayedEntries = computed<EntrySummary[]>(() =>
  visibleEntries().slice(0, loadedCount()),
)

export const hasMoreEntries = computed<boolean>(() => loadedCount() < visibleEntries().length)

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
  tagFilters.set([])
  closeDetail()
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

/** 传字符串 = toggle 该标签（已在则移除，不在则加入）；传 null = 清空全部。 */
export function setTagFilter(tag: string | null): void {
  if (tag === null) {
    tagFilters.set([])
  } else {
    tagFilters.update((list) =>
      list.includes(tag) ? list.filter((item) => item !== tag) : [...list, tag],
    )
  }
  touchActivity()
  void refreshEntries()
}

export function clearTagFilters(): void {
  setTagFilter(null)
}

export function setSortMode(mode: SortMode): void {
  sortBy.set(mode)
  touchActivity()
  // 顺序变了，已解密窗口对应的不再是当前前 N 条：重置并解密新的第一批。
  reloadVisibleWindow()
}

export function setTypeFilter(categoryId: string | null): void {
  typeFilter.set(typeFilter() === categoryId ? null : categoryId)
  touchActivity()
  reloadVisibleWindow()
}

export function setViewMode(mode: 'list' | 'compact'): void {
  viewMode.set(mode)
}

export function setShowPasswords(value: boolean): void {
  showPasswords.set(value)
  hiddenPasswords.set(new Set())
}

/** 单行眼睛图标：仅覆盖这一行的密码可见性，与全局开关互不影响。 */
export function togglePasswordFor(id: string): void {
  hiddenPasswords.update((set) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
}

export function passwordVisible(id: string): boolean {
  return showPasswords() && !hiddenPasswords().has(id)
}

export function toggleSelected(id: string): void {
  selectedIds.update((set) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
}

/** 全选/全不选当前已加载窗口内的条目（不操作尚未加载的行）。 */
export function toggleSelectAll(): void {
  const shown = displayedEntries()
  const allSelected = shown.length > 0 && shown.every((entry) => selectedIds().has(entry.id))
  selectedIds.set(allSelected ? new Set() : new Set(shown.map((entry) => entry.id)))
}

export function clearSelection(): void {
  selectedIds.set(new Set())
}

/** 复制单个字段，toast 里带上字段名（如“邮箱已复制”）。fieldLabel 为已翻译文案。 */
export async function copyField(raw: string, fieldLabel: string): Promise<void> {
  if (!raw) return
  touchActivity()
  try {
    await Clipboard.writeText(raw)
    toast(t('toast.fieldCopied', { field: fieldLabel }))
  } catch {
    toast(t('toast.copyFailed'), 'error')
  }
}

/** 复制单条记录：标题 + 账号 / 密码 / 邮箱 / 手机号 / 备注，空字段省略。 */
export async function copyEntryFull(id: string): Promise<void> {
  touchActivity()
  try {
    const view = native.getEntry(id)
    const lines: string[] = [`${t('entry.title')}：${view.title}`]
    const push = (label: string, value: string) => {
      if (value) lines.push(`${label}：${value}`)
    }
    push(t('entry.username'), view.username)
    push(t('entry.password'), view.password)
    push(t('entry.email'), view.email)
    push(t('entry.phone'), view.phone)
    push(t('entry.notes'), view.notes)
    await Clipboard.writeText(lines.join('\n'))
    toast(t('toast.entryCopied'))
  } catch (error) {
    showError(error)
  }
}

/** 复制勾选的多条记录，每条之间空一行。 */
export async function copySelectedEntries(): Promise<void> {
  const ids = [...selectedIds()]
  if (ids.length === 0) return
  touchActivity()
  try {
    const blocks: string[] = []
    for (const id of ids) {
      try {
        const view = native.getEntry(id)
        const lines: string[] = [`${t('entry.title')}：${view.title}`]
        const push = (label: string, value: string) => {
          if (value) lines.push(`${label}：${value}`)
        }
        push(t('entry.username'), view.username)
        push(t('entry.password'), view.password)
        push(t('entry.email'), view.email)
        push(t('entry.phone'), view.phone)
        push(t('entry.notes'), view.notes)
        blocks.push(lines.join('\n'))
      } catch {
        // 单条失败跳过，不打断整批复制。
      }
    }
    if (blocks.length === 0) return
    await Clipboard.writeText(blocks.join('\n\n'))
    toast(t('toast.entryCopied'))
    clearSelection()
  } catch (error) {
    showError(error)
  }
}

export function closeDetail(): void {
  selectedId.set(null)
  selected.set(null)
  detailOpen.set(false)
}

export async function selectEntry(id: string | null): Promise<void> {
  touchActivity()
  selectedId.set(id)
  detailOpen.set(id !== null)
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

/** 同步保存单条备注：getEntry/updateEntry 均为同步 API。读回完整 EntryView，
 *  组装完整 EntryInput 只替换 notes，其余字段原样写回。 */
export function saveEntryNotes(id: string, notes: string): void {
  try {
    const view = native.getEntry(id)
    const input: EntryInput = {
      categoryId: view.categoryId,
      title: view.title,
      url: view.url,
      username: view.username,
      password: view.password,
      email: view.email,
      phone: view.phone,
      notes,
      favorite: view.favorite,
      tags: view.tags,
    }
    native.updateEntry(id, input)
    entryNotes.update((prev) => ({ ...prev, [id]: notes }))
    toast(t('entry.notesSaved'))
    touchActivity()
  } catch (error) {
    showError(error)
  }
}

export async function deleteEntry(id: string, archive = false): Promise<void> {
  const result = await runAction(
    () => (archive ? native.archiveEntry(id) : native.deleteEntry(id)),
    archive ? t('entry.archived') : t('toast.deleted'),
  )
  if (result === null) return
  if (selectedId() === id) {
    closeDetail()
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
    closeDetail()
  }
  await refreshCategories()
  await refreshEntries()
}

export async function restoreEntry(id: string): Promise<void> {
  const ok = await runAction(() => native.restoreEntry(id), t('trash.restored'))
  if (ok === null) return
  if (selectedId() === id) {
    closeDetail()
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
  closeDetail()
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

/** 按给定顺序持久化某一类型的预设（只写 sort_order，不动密文）。 */
export async function reorderPresets(fieldType: string, ids: string[]): Promise<void> {
  try {
    native.reorderPresets(fieldType, ids)
    await refreshPresets()
  } catch (error) {
    showError(error)
  }
}

/** 在当前类型的预设里上移 / 下移一位。 */
export async function movePreset(preset: Preset, delta: number): Promise<void> {
  const list = presets().filter((item) => item.fieldType === preset.fieldType)
  const index = list.findIndex((item) => item.id === preset.id)
  if (index < 0) return
  const target = index + delta
  if (target < 0 || target >= list.length) return
  const next = [...list]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  await reorderPresets(
    preset.fieldType,
    next.map((item) => item.id),
  )
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
