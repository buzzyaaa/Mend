// Tauri IPC 封装：阶段 1 仅占位；阶段 2 起对接 Rust 命令（契约见 docs/03-architecture.md §3）。
// 浏览器（纯 Vite 开发）环境下不调用 invoke，避免报错。

type InvokeArgs = Record<string, unknown>

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** 统一调用入口；Rust 命令落地前，未实现的命令抛出明确错误。 */
export async function invoke<T>(command: string, args?: InvokeArgs): Promise<T> {
  if (!isTauri()) {
    throw new Error(`[ipc] ${command} 仅在 Tauri 运行时可用（当前为浏览器预览）`)
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}
