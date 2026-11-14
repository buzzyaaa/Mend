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
  title_required: 'entry.titleRequired',
  title_too_long: 'entry.titleTooLong',
  tags_invalid: 'entry.tagsInvalid',
  category_name_required: 'sidebar.nameRequired',
  category_name_too_long: 'sidebar.nameTooLong',
  password_too_short: 'unlock.errors.tooShort',
  preset_invalid: 'preset.invalid',
  generator_invalid: 'generator.invalidOptions',
  backup_invalid: 'backup.invalidFile',
  backup_password: 'backup.wrongPassword',
}

/** A localized message for a native error. Unknown codes fall back to the
 * native message, which is still human-readable and never contains secrets. */
export function errorText(error: unknown, context?: string): string {
  const { code, message } = parseError(error)
  if (code === 'crypto' && context === 'unlock') {
    return t('unlock.errors.wrongPassword')
  }
  const key = CODE_KEYS[code]
  if (key) return t(key)
  return message || t('error.unknown')
}

export function isCancelled(error: unknown): boolean {
  return parseError(error).code === 'cancelled'
}
