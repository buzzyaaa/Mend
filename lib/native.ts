// The only place the UI touches the native vault. The generated module is
// `mend/native`; its TypeScript declarations live in `.nsh/types`.
import { Vault } from 'mend/native'

import type {
  Category,
  CategoryInput,
  EntryInput,
  EntrySummary,
  EntryView,
  GeneratorOptions,
  IconFetchReport,
  ListFilter,
  Preset,
  PresetInput,
  Tag,
  TagInput,
  VaultStatus,
} from './types'

/** `process.dataDir` is the per-app directory nsh gives us. Passing it
 * explicitly keeps the old Tauri data directory (`%APPDATA%\com.mend.app`)
 * as the single source of truth on every platform. */
export function initVault(): Promise<VaultStatus> {
  const dir = typeof process !== 'undefined' ? process.dataDir : null
  return Vault.init(dir ?? null)
}

export function status(): VaultStatus {
  return Vault.status()
}

export function setup(masterPassword: string): Promise<VaultStatus> {
  return Vault.setup(masterPassword)
}

export function unlock(masterPassword: string): Promise<VaultStatus> {
  return Vault.unlock(masterPassword)
}

export function lock(): void {
  return Vault.lock()
}

export function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  return Vault.changePassword(oldPassword, newPassword)
}

export function listEntries(filter: ListFilter): EntrySummary[] {
  return Vault.listEntries(filter)
}

export function getEntry(id: string): EntryView {
  return Vault.getEntry(id)
}

export function createEntry(input: EntryInput): EntryView {
  return Vault.createEntry(input)
}

export function updateEntry(id: string, input: EntryInput): EntryView {
  return Vault.updateEntry(id, input)
}

export function setFavorite(id: string, favorite: boolean): EntrySummary {
  return Vault.setFavorite(id, favorite)
}

export function deleteEntry(id: string): void {
  return Vault.deleteEntry(id)
}

export function restoreEntry(id: string): void {
  return Vault.restoreEntry(id)
}

export function purgeEntry(id: string): void {
  return Vault.purgeEntry(id)
}

export function purgeAllTrash(): number {
  return Vault.purgeAllTrash()
}

export function archiveEntry(id: string): void {
  return Vault.archiveEntry(id)
}

export function unarchiveEntry(id: string): void {
  return Vault.unarchiveEntry(id)
}

export function reorderEntries(ids: string[]): void {
  return Vault.reorderEntries(ids)
}

export function listCategories(): Category[] {
  return Vault.listCategories()
}

export function createCategory(input: CategoryInput): Category {
  return Vault.createCategory(input)
}

export function updateCategory(id: string, input: CategoryInput): Category {
  return Vault.updateCategory(id, input)
}

export function deleteCategory(id: string): void {
  return Vault.deleteCategory(id)
}

export function reorderCategories(ids: string[]): void {
  return Vault.reorderCategories(ids)
}

export function listPresets(): Preset[] {
  return Vault.listPresets()
}

export function createPreset(input: PresetInput): Preset {
  return Vault.createPreset(input)
}

export function updatePreset(id: string, input: PresetInput): Preset {
  return Vault.updatePreset(id, input)
}

export function deletePreset(id: string): void {
  return Vault.deletePreset(id)
}

/** Persist a manual order for presets of one field type (sort_order only). */
export function reorderPresets(fieldType: string, ids: string[]): void {
  return Vault.reorderPresets(fieldType, ids)
}

export function listTags(): Tag[] {
  return Vault.listTags()
}

export function createTag(input: TagInput): Tag {
  return Vault.createTag(input)
}

/** 改名时后端会把所有条目上的旧标签名一起换掉。 */
export function updateTag(id: string, input: TagInput): Tag {
  return Vault.updateTag(id, input)
}

/** 删除标签定义，同时从所有条目上摘掉这个标签。 */
export function deleteTag(id: string): void {
  return Vault.deleteTag(id)
}

export function generatePassword(options: GeneratorOptions): string {
  return Vault.generatePassword(options)
}

/** 切换当前使用的库文件；`null` = 回到数据目录里的默认库。
 *  切换会锁定库（清掉会话密钥），调用方随后应重新走一次启动流程。 */
export function switchVault(path: string | null): VaultStatus {
  return Vault.switchVault(path)
}

/** 系统「打开文件」对话框选一个已存在的库文件；取消时 `null`。 */
export function pickVaultFile(
  title: string,
  buttonLabel: string,
  startDir: string | null,
): Promise<string | null> {
  return Vault.pickVaultFile(title, buttonLabel, startDir)
}

/** 系统「保存文件」对话框指定新库文件的位置；取消时 `null`。
 *  只返回路径，真正建库发生在设置主密码时。 */
export function pickNewVaultFile(
  title: string,
  buttonLabel: string,
  startDir: string | null,
  fileName: string | null,
): Promise<string | null> {
  return Vault.pickNewVaultFile(title, buttonLabel, startDir, fileName)
}

/** 在系统文件管理器里定位当前库文件（选中该文件）。 */
export function revealVaultFile(): Promise<void> {
  return Vault.revealVaultFile()
}

/** 免主密码解锁是否已开启。 */
export function deviceUnlockEnabled(): boolean {
  return Vault.deviceUnlockEnabled()
}

/** 打开免主密码解锁（把当前会话密钥存到数据目录）。 */
export function enableDeviceUnlock(): boolean {
  return Vault.enableDeviceUnlock()
}

/** 关闭免主密码解锁（删除密钥文件）。 */
export function disableDeviceUnlock(): boolean {
  return Vault.disableDeviceUnlock()
}

/** 用已保存的密钥解锁，不询问主密码。 */
export function unlockWithDeviceKey(): VaultStatus {
  return Vault.unlockWithDeviceKey()
}

/** 非敏感 UI 偏好的 JSON，未保存过时为空串。 */
export function loadPreferences(): Promise<string> {
  return Vault.loadPreferences()
}

export function savePreferences(json: string): void {
  Vault.savePreferences(json)
}

/** 条目网址对应的缓存站点图标（`data:` URI）；没有时为空串。
 *  同步、不联网：图标由原生侧的 `fetchSiteIcons` 抓回并缓存进库。 */
export function siteIcon(url: string): string {
  return Vault.siteIcon(url)
}

/** 抓取并缓存下一批站点图标（网络与解码都在原生侧的阻塞线程）。 */
export function fetchSiteIcons(limit: number): Promise<IconFetchReport> {
  return Vault.fetchSiteIcons(limit)
}

/** 清空图标缓存，返回删掉的行数。 */
export function clearSiteIcons(): number {
  return Vault.clearSiteIcons()
}
