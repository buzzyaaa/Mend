// The only place the UI touches the native vault. The generated module is
// `mend/native`; its TypeScript declarations live in `.nsh/types`.
import { Vault } from 'mend/native'

import type {
  AppPaths,
  Category,
  CategoryInput,
  EntryInput,
  EntrySummary,
  EntryView,
  ExportResult,
  GeneratorOptions,
  ImportResult,
  ListFilter,
  Preset,
  PresetInput,
  VaultStatus,
} from './types'

/** `process.dataDir` is the per-app directory nsh gives us. Passing it
 * explicitly keeps the old Tauri data directory (`%APPDATA%\com.mend.app`)
 * as the single source of truth on every platform. */
export function initVault(): VaultStatus {
  const dir = typeof process !== 'undefined' ? process.dataDir : null
  return Vault.init(dir ?? null)
}

export function status(): VaultStatus {
  return Vault.status()
}

export function setup(masterPassword: string): VaultStatus {
  return Vault.setup(masterPassword)
}

export function unlock(masterPassword: string): VaultStatus {
  return Vault.unlock(masterPassword)
}

export function lock(): void {
  return Vault.lock()
}

export function changePassword(oldPassword: string, newPassword: string): void {
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

export function generatePassword(options: GeneratorOptions): string {
  return Vault.generatePassword(options)
}

export function appPaths(): AppPaths {
  return Vault.appPaths()
}

export function exportBackup(
  path: string | null,
  fileName: string | null,
  masterPassword: string,
): ExportResult {
  return Vault.exportBackup(path, fileName, masterPassword)
}

export function importBackupBase64(dataBase64: string, masterPassword: string): ImportResult {
  return Vault.importBackupBase64(dataBase64, masterPassword)
}

export function revealDataDir(): Promise<void> {
  return Vault.revealDataDir()
}
