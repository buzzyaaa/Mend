// Tauri IPC 封装：命令契约见 docs/03-architecture.md §3。
// 浏览器（纯 Vite 开发）环境下不调用 invoke，避免报错。

import type {
  AppPaths,
  BackupExportResult,
  BackupImportResult,
  Category,
  EntryView,
  GeneratorOptions,
  Preset,
  PresetInput,
  VaultStatus,
} from '@/types'

type InvokeArgs = Record<string, unknown>

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** 统一调用入口；非 Tauri 运行时抛出明确错误。 */
export async function invoke<T>(command: string, args?: InvokeArgs): Promise<T> {
  if (!isTauri()) {
    throw new Error(`[ipc] ${command} 仅在 Tauri 运行时可用（当前为浏览器预览）`)
  }
  const api = await import('@tauri-apps/api/core')
  return api.invoke<T>(command, args)
}

export interface UnlockResult {
  unlocked: boolean
}

/** 金库命令：不涉及任何明文落盘，敏感字段由 Rust 侧加密。 */
export const vaultApi = {
  status: () => invoke<VaultStatus>('vault_status'),
  setup: (masterPassword: string) => invoke<UnlockResult>('vault_setup', { masterPassword }),
  unlock: (masterPassword: string) => invoke<UnlockResult>('vault_unlock', { masterPassword }),
  lock: () => invoke<void>('vault_lock'),
}

export const categoryApi = {
  list: () => invoke<Category[]>('category_list'),
  create: (name: string) => invoke<Category>('category_create', { input: { name } }),
  rename: (id: string, name: string) => invoke<void>('category_rename', { id, input: { name } }),
  remove: (id: string) => invoke<void>('category_delete', { id }),
}

export const entryApi = {
  list: (categoryId?: string | null, keyword?: string | null) =>
    invoke<EntryView[]>('entry_list', { categoryId: categoryId ?? null, keyword: keyword ?? null }),
  get: (id: string) => invoke<EntryView>('entry_get', { id }),
  create: (input: unknown) => invoke<EntryView>('entry_create', { input }),
  update: (id: string, input: unknown) => invoke<EntryView>('entry_update', { id, input }),
  remove: (id: string) => invoke<void>('entry_delete', { id }),
}

/** 预设值：值在 Rust 侧加密落库，前端只见解密后的展示模型。 */
export const presetApi = {
  list: () => invoke<Preset[]>('preset_list'),
  create: (input: PresetInput) => invoke<Preset>('preset_create', { input }),
  update: (id: string, input: PresetInput) => invoke<Preset>('preset_update', { id, input }),
  remove: (id: string) => invoke<void>('preset_delete', { id }),
}

/** 密码生成器：纯本地 CSPRNG，结果不落库。 */
export const generatorApi = {
  generate: (options: GeneratorOptions) => invoke<string>('generator_generate', { options }),
}

/** 备份与恢复：文件读写全部在 Rust 侧完成，前端只传路径与主密码。 */
export const backupApi = {
  paths: () => invoke<AppPaths>('app_paths'),
  export: (path: string, masterPassword: string) =>
    invoke<BackupExportResult>('backup_export', { path, masterPassword }),
  import: (path: string, masterPassword: string) =>
    invoke<BackupImportResult>('backup_import', { path, masterPassword }),
}
