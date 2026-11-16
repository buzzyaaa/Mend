import { t } from 'nsh/i18n'

interface AppError {
  code: string
  message: string
}

/** Native calls reject with `code|message` (see native/src/error.rs). */
export function parseError(error: unknown): AppError {
  const raw =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error)
  const separator = raw.indexOf('|')
  if (separator > 0) {
    const code = raw.slice(0, separator)
    if (/^[a-z_]+$/.test(code)) {
      return { code, message: raw.slice(separator + 1) }
    }
  }
  if (raw === 'locked' || raw.endsWith('|库未解锁')) {
    return { code: 'locked', message: raw }
  }
  return { code: 'unknown', message: raw }
}

const CODE_KEYS: Record<string, string> = {
  locked: 'error.locked',
  crypto: 'error.crypto',
  db: 'error.db',
  db_readonly: 'error.dbReadonly',
  not_found: 'error.notFound',
  cancelled: 'error.cancelled',
  vault: 'error.vault',
  io: 'error.vault',
  internal: 'error.vault',
  export_dir: 'vault.dirUnwritable',
  vault_not_db: 'vault.notDb',
  title_required: 'entry.titleRequired',
  title_too_long: 'entry.titleTooLong',
  tags_invalid: 'entry.tagsInvalid',
  category_name_required: 'sidebar.nameRequired',
  category_name_too_long: 'sidebar.nameTooLong',
  password_too_short: 'unlock.errors.tooShort',
  preset_invalid: 'preset.invalid',
  generator_invalid: 'generator.invalidOptions',
  device_key: 'unlock.errors.deviceKey',
}

/** 这些 code 的文案只是一句「失败了」，光看它无法判断原因（磁盘权限、
 *  文件路径、SQLite 状态……）。原生消息里带着路径与 OS 错误，对排查有用，
 *  因此拼在本地化文案后面；其余 code 的文案本身已经说清了原因，不拼。 */
const CODES_WITH_DETAIL = new Set(['vault', 'internal', 'io'])

/** A localized message for a native error. Unknown codes fall back to the
 * native message, which is still human-readable and never contains secrets. */
export function errorText(error: unknown, context?: string): string {
  const { code, message } = parseError(error)
  if (code === 'crypto' && context === 'unlock') {
    return t('unlock.errors.wrongPassword')
  }
  const key = CODE_KEYS[code]
  if (!key) return message || t('error.unknown')
  const text = t(key)
  if (CODES_WITH_DETAIL.has(code) && message && message !== text) {
    return `${text}：${message}`
  }
  return text
}
