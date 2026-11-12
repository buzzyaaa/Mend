// 后端错误归一化与词条映射，约定见 docs/07-i18n.md §5：
// Rust 侧 MendError 序列化为 { code, message }（code: vault / db / crypto / not_found / locked），
// 前端按 code 映射 i18n 词条，不直接展示后端原始串。
// 本模块兼容三种历史/未来形态：
// 1. 结构化对象（Tauri 把 reject 值原样传过来时）：{ code, message }
// 2. JSON 字符串（Tauri v2 有时把非字符串 reject 序列化成 JSON 串）
// 3. 纯字符串（旧格式）：code 为空，message 为原串
// 任何解析失败都不抛异常，一律兜底为 { code: '', message: String(err) }。

/** 后端错误码 → i18n 词条 key（词条位于 locales 的 error.* 命名空间）。 */
const CODE_TO_KEY: Record<string, string> = {
  locked: 'error.locked',
  crypto: 'error.crypto',
  db: 'error.db',
  not_found: 'error.notFound',
  vault: 'error.vault',
}

/**
 * 从任意 reject/throw 值中提取 { code, message }。
 * 解析任何一步失败都不抛异常，兜底为 { code: '', message: String(err) }。
 */
export function normalizeError(err: unknown): { code: string; message: string } {
  try {
    // Error 实例（前端本地抛错，如 ipc.ts 的"仅在 Tauri 运行时可用"）。
    if (err instanceof Error) {
      return { code: '', message: err.message }
    }

    // 形态 1：结构化对象。
    if (err !== null && typeof err === 'object') {
      const raw = err as Record<string, unknown>
      const code = typeof raw.code === 'string' ? raw.code : ''
      const message = typeof raw.message === 'string' ? raw.message : String(raw.message ?? '')
      return { code, message }
    }

    // 形态 2/3：字符串。先尝试按 JSON 解析（Tauri 可能把对象序列化成 JSON 串）。
    if (typeof err === 'string') {
      try {
        const parsed: unknown = JSON.parse(err)
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const raw = parsed as Record<string, unknown>
          if (typeof raw.code === 'string' || typeof raw.message === 'string') {
            return {
              code: typeof raw.code === 'string' ? raw.code : '',
              message: typeof raw.message === 'string' ? raw.message : '',
            }
          }
        }
      } catch {
        // 不是 JSON，按旧格式纯字符串处理。
      }
      return { code: '', message: err }
    }

    return { code: '', message: String(err) }
  } catch {
    // 兜底：连 String(err) 都可能抛错（如 Symbol、Proxy 陷阱），绝不向调用方抛异常。
    return { code: '', message: 'Unknown error' }
  }
}

/**
 * 把任意错误值转成可展示文案：已知 code 映射 error.* 词条；
 * 无 code 或未知 code 时返回后端 message 原文（旧格式无结构化 code 时的兼容路径）。
 */
export function errorText(
  err: unknown,
  t: (key: string, named?: Record<string, unknown>) => string,
): string {
  const { code, message } = normalizeError(err)
  const key = CODE_TO_KEY[code]
  if (key) return t(key)
  return message || t('error.vault')
}
