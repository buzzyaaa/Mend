/** 本地粘贴解析：把从任意对话框复制来的文本整理成条目草稿。
 *
 *  纯函数：不联网、不碰数据库、不接触密钥；明文只在调用方内存里短暂停留，
 *  最终仍经 `mend/native` 的 createEntry 在 Rust 侧加密落盘。
 *
 *  支持四类常见格式（按优先级嗅探）：
 *  1. Markdown 表格（带 `|---|` 分隔行）
 *  2. CSV / TSV（首行为字段名，如「标题,网址,账号,密码」）
 *  3. 字段块（「账号：xxx」「password: yyy」，空行或 --- 分隔多条）
 *  4. 无表头的竖线 / 制表符分隔行（按特征值分配到字段）
 *  都不匹配时，每行按标题处理。
 */

export interface PasteEntry {
  title: string
  url: string | null
  username: string
  password: string
  email: string
  phone: string
  notes: string
  tags: string[]
  favorite: boolean
  /** 分类名，导入时按名称匹配库内已有分类；不存在则落到未分类。 */
  categoryName: string | null
}

export type PasteFormat = 'table' | 'csv' | 'keyvalue' | 'delimited' | 'lines'

export interface PasteParseResult {
  format: PasteFormat
  entries: PasteEntry[]
  /** 被跳过的空行 / 无法识别的行数。 */
  skipped: number
}

type FieldKey =
  | 'title'
  | 'url'
  | 'username'
  | 'password'
  | 'email'
  | 'phone'
  | 'notes'
  | 'tags'
  | 'favorite'
  | 'category'

const MAX_ENTRIES = 200

/** 键名先去空格、下划线、连字符并转小写，再查表。 */
function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_\-]/g, '')
}

const FIELD_ALIASES: Record<string, FieldKey> = {
  '标题': 'title',
  '名称': 'title',
  '网站': 'title',
  '站点': 'title',
  '服务': 'title',
  '应用': 'title',
  '项目': 'title',
  'title': 'title',
  'name': 'title',
  'site': 'title',
  'service': 'title',
  'app': 'title',
  '网址': 'url',
  '链接': 'url',
  '地址': 'url',
  '站点地址': 'url',
  'url': 'url',
  'link': 'url',
  'website': 'url',
  'websiteurl': 'url',
  'homepage': 'url',
  '账号': 'username',
  '用户名': 'username',
  '用户': 'username',
  '登录名': 'username',
  '登录账号': 'username',
  '登陆账号': 'username',
  'username': 'username',
  'user': 'username',
  'account': 'username',
  'login': 'username',
  '密码': 'password',
  '口令': 'password',
  'password': 'password',
  'pwd': 'password',
  'pass': 'password',
  '邮箱': 'email',
  '电子邮箱': 'email',
  '邮件': 'email',
  'email': 'email',
  'mail': 'email',
  '手机号': 'phone',
  '手机': 'phone',
  '电话': 'phone',
  '联系电话': 'phone',
  'phone': 'phone',
  'tel': 'phone',
  'mobile': 'phone',
  '备注': 'notes',
  '说明': 'notes',
  '描述': 'notes',
  'notes': 'notes',
  'note': 'notes',
  'remark': 'notes',
  'comment': 'notes',
  'description': 'notes',
  '标签': 'tags',
  'tags': 'tags',
  '星标': 'favorite',
  '收藏': 'favorite',
  'favorite': 'favorite',
  'star': 'favorite',
  '分类': 'category',
  '分组': 'category',
  'category': 'category',
}

function fieldOf(raw: string): FieldKey | null {
  return FIELD_ALIASES[normalizeKey(raw)] ?? null
}

function emptyEntry(): PasteEntry {
  return {
    title: '',
    url: null,
    username: '',
    password: '',
    email: '',
    phone: '',
    notes: '',
    tags: [],
    favorite: false,
    categoryName: null,
  }
}

function isTruthy(value: string): boolean {
  return ['1', '是', 'yes', 'true', 'on', 'y', '✓'].includes(value.trim().toLowerCase())
}

function splitTags(value: string): string[] {
  const seen = new Set<string>()
  for (const raw of value.split(/[,，;；]/)) {
    const tag = raw.trim()
    if (!tag || tag.length > 32) continue
    seen.add(tag)
    if (seen.size >= 8) break
  }
  return [...seen]
}

/** 无表头时按特征识别网址 / 邮箱 / 手机号，其余依次落到标题、账号、密码、备注。 */
function looksLikeUrl(value: string): boolean {
  return /^(https?:\/\/)/i.test(value) || /^[\w-]+(\.[\w-]+)+([/?#:]|$)/.test(value)
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function looksLikePhone(value: string): boolean {
  return /^\+?[\d\s\-()]{7,20}$/.test(value) && /\d{6,}/.test(value.replace(/\s/g, ''))
}

function normalizeUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^[\w-]+(\.[\w-]+)+([/?#:]|$)/.test(trimmed)) return `https://${trimmed}`
  return null
}

function titleFromUrl(url: string | null): string {
  if (!url) return ''
  const match = /^(?:https?:\/\/)?([^/?#:]+)/i.exec(url)
  return match ? match[1].replace(/^www\./i, '') : ''
}

/** 给一条草稿补齐必填标题，并清理多余空白。 */
function finalize(entry: PasteEntry, index: number): PasteEntry | null {
  const cleaned: PasteEntry = {
    title: entry.title.trim().slice(0, 120),
    url: normalizeUrl(entry.url ?? ''),
    username: entry.username.trim(),
    password: entry.password,
    email: entry.email.trim(),
    phone: entry.phone.trim(),
    notes: entry.notes.trim(),
    tags: entry.tags,
    favorite: entry.favorite,
    categoryName: entry.categoryName?.trim() || null,
  }
  if (!cleaned.title) cleaned.title = titleFromUrl(cleaned.url)
  if (!cleaned.title && cleaned.username) cleaned.title = cleaned.username
  if (!cleaned.title && cleaned.email) cleaned.title = cleaned.email
  if (!cleaned.title) cleaned.title = `导入条目 ${index + 1}`
  // 全空行不应变成条目。
  const hasValue =
    cleaned.username || cleaned.password || cleaned.email || cleaned.phone || cleaned.notes || cleaned.url
  return hasValue || entry.title.trim() ? cleaned : null
}

function assign(entry: PasteEntry, field: FieldKey, value: string): void {
  const trimmed = value.trim()
  switch (field) {
    case 'title':
      entry.title = trimmed
      break
    case 'url':
      entry.url = trimmed
      break
    case 'username':
      entry.username = trimmed
      break
    case 'password':
      // 密码保留原样（含前后空格可能是真实密码的一部分）。
      entry.password = value.trim() === '' ? '' : value.trim()
      break
    case 'email':
      entry.email = trimmed
      break
    case 'phone':
      entry.phone = trimmed
      break
    case 'notes':
      entry.notes = trimmed
      break
    case 'tags':
      entry.tags = splitTags(value)
      break
    case 'favorite':
      entry.favorite = isTruthy(value)
      break
    case 'category':
      entry.categoryName = trimmed || null
      break
  }
}

/** CSV / TSV 单行切分，支持双引号包裹与引号转义。 */
function splitDelimited(line: string, separator: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        quoted = !quoted
      }
    } else if (char === separator && !quoted) {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  return cells
}

/** 表头命中至少两个已知字段才认作表头，避免把普通数据行误判。 */
function headerFields(cells: string[]): (FieldKey | null)[] | null {
  const fields = cells.map((cell) => fieldOf(cell))
  const count = fields.filter((field) => field !== null).length
  return count >= 2 ? fields : null
}

function isTableDivider(cells: string[]): boolean {
  if (cells.length === 0) return false
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
}

function tableCells(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return null
  const parts = trimmed.split('|')
  // 首尾是空段（行以 | 开始/结束）；没有结尾 | 时按多余的一段处理。
  if (parts[0].trim() !== '') return null
  parts.shift()
  if (parts.length > 0 && parts[parts.length - 1].trim() === '') parts.pop()
  return parts.map((part) => part.trim())
}

/** 字段块的行：`账号：xxx` / `password: yyy` / `- 密码 = zzz`。 */
function keyValueLine(line: string): { field: FieldKey; value: string } | null {
  const match = /^\s*(?:[-*•]|\d+[.)])?\s*([^:：=]{1,20})\s*[:：=]\s*(.*)$/.exec(line)
  if (!match) return null
  const field = fieldOf(match[1])
  if (!field) return null
  return { field, value: match[2] }
}

function isSeparator(line: string): boolean {
  const trimmed = line.trim()
  return trimmed === '' || /^(-{3,}|={3,}|———+|\*{3,})$/.test(trimmed)
}

/** 从带序号 / 项目符号的行里取出标题文字。 */
function plainTitle(line: string): string {
  return line.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '').trim()
}

function parseTable(lines: string[]): PasteParseResult {
  const header = tableCells(lines[0]) ?? []
  const fields = headerFields(header) ?? []
  const entries: PasteEntry[] = []
  let skipped = 0
  for (let i = 2; i < lines.length; i += 1) {
    const cells = tableCells(lines[i])
    if (!cells) {
      skipped += 1
      continue
    }
    const entry = emptyEntry()
    cells.forEach((cell, index) => {
      const field = fields[index]
      if (field) assign(entry, field, cell)
    })
    const result = finalize(entry, entries.length)
    if (result) entries.push(result)
    else skipped += 1
    if (entries.length >= MAX_ENTRIES) break
  }
  return { format: 'table', entries, skipped }
}

function parseDelimitedWithHeader(
  lines: string[],
  separator: string,
  format: 'csv' | 'delimited',
): PasteParseResult {
  const fields = headerFields(splitDelimited(lines[0], separator)) ?? []
  const entries: PasteEntry[] = []
  let skipped = 0
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) {
      skipped += 1
      continue
    }
    const cells = splitDelimited(lines[i], separator)
    const entry = emptyEntry()
    cells.forEach((cell, index) => {
      const field = fields[index]
      if (field) assign(entry, field, cell)
    })
    const result = finalize(entry, entries.length)
    if (result) entries.push(result)
    else skipped += 1
    if (entries.length >= MAX_ENTRIES) break
  }
  return { format, entries, skipped }
}

/** 无表头：按值特征分配，避免「4 列究竟是标题/网址/账号/密码还是标题/账号/密码/备注」的猜测。 */
function parseHeaderlessRows(lines: string[], separator: string): PasteParseResult {
  const entries: PasteEntry[] = []
  let skipped = 0
  for (const line of lines) {
    if (!line.trim()) {
      skipped += 1
      continue
    }
    const cells = splitDelimited(line, separator).filter((cell) => cell !== '')
    if (cells.length < 2) {
      skipped += 1
      continue
    }
    const entry = emptyEntry()
    const remaining: string[] = []
    for (const cell of cells) {
      if (!entry.url && looksLikeUrl(cell)) entry.url = cell
      else if (!entry.email && looksLikeEmail(cell)) entry.email = cell
      else if (!entry.phone && looksLikePhone(cell)) entry.phone = cell
      else remaining.push(cell)
    }
    if (remaining.length > 0) entry.title = remaining.shift() ?? ''
    if (remaining.length > 0) entry.username = remaining.shift() ?? ''
    if (remaining.length > 0) entry.password = remaining.shift() ?? ''
    if (remaining.length > 0) entry.notes = remaining.join(' ')
    const result = finalize(entry, entries.length)
    if (result) entries.push(result)
    else skipped += 1
    if (entries.length >= MAX_ENTRIES) break
  }
  return { format: 'delimited', entries, skipped }
}

function parseKeyValue(lines: string[]): PasteParseResult {
  const entries: PasteEntry[] = []
  let current = emptyEntry()
  let started = false
  let skipped = 0
  const flush = () => {
    if (!started) return
    const result = finalize(current, entries.length)
    if (result) entries.push(result)
    else skipped += 1
    current = emptyEntry()
    started = false
  }

  for (const line of lines) {
    if (isSeparator(line)) {
      flush()
      continue
    }
    const pair = keyValueLine(line)
    if (pair) {
      // 连续字段块没有空行/--- 时，用「又出现一个标题且本条已有内容」切条。
      if (
        pair.field === 'title' &&
        current.title &&
        (current.username || current.password || current.email || current.phone)
      ) {
        flush()
      }
      started = true
      assign(current, pair.field, pair.value)
      continue
    }
    // 「1. GitHub」「- Gmail」这类块标题。
    const text = plainTitle(line)
    if (!text) continue
    if (!started || (!current.title && !current.username)) {
      current.title = text
      started = true
    } else {
      // 块内没有字段名的自由行并入备注。
      current.notes = current.notes ? `${current.notes}\n${text}` : text
      started = true
    }
  }
  flush()
  return { format: 'keyvalue', entries, skipped }
}

/** 主入口：嗅探格式并返回条目草稿。输入为空时返回空结果而非抛错。 */
export function parsePastedEntries(raw: string): PasteParseResult {
  const lines = raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const meaningful = lines.filter((line) => line.trim() !== '')
  if (meaningful.length === 0) return { format: 'lines', entries: [], skipped: 0 }

  const first = meaningful[0]
  const firstCells = tableCells(first)
  if (firstCells && meaningful.length > 1 && isTableDivider(tableCells(meaningful[1]) ?? [])) {
    return parseTable(meaningful)
  }

  const commaHeader = headerFields(splitDelimited(first, ','))
  const tabHeader = headerFields(splitDelimited(first, '\t'))
  if (commaHeader && (!tabHeader || splitDelimited(first, ',').length >= splitDelimited(first, '\t').length)) {
    return parseDelimitedWithHeader(meaningful, ',', 'csv')
  }
  if (tabHeader) return parseDelimitedWithHeader(meaningful, '\t', 'delimited')

  if (meaningful.some((line) => keyValueLine(line) !== null)) {
    return parseKeyValue(lines)
  }

  const pipeRows = meaningful.filter((line) => line.includes('|'))
  if (pipeRows.length === meaningful.length && pipeRows.every((line) => line.split('|').length >= 3)) {
    return parseHeaderlessRows(meaningful, '|')
  }
  const tabRows = meaningful.filter((line) => line.includes('\t'))
  if (tabRows.length === meaningful.length) return parseHeaderlessRows(meaningful, '\t')

  const entries: PasteEntry[] = []
  let skipped = 0
  for (const line of meaningful) {
    const result = finalize({ ...emptyEntry(), title: plainTitle(line) }, entries.length)
    if (result) entries.push(result)
    else skipped += 1
    if (entries.length >= MAX_ENTRIES) break
  }
  return { format: 'lines', entries, skipped }
}

/** 把草稿转成原生接口需要的 EntryInput。tags 只保留库内已定义标签，避免绕过标签维护。 */
export function toEntryInput(
  draft: PasteEntry,
  categoryId: string | null,
  definedTags: string[],
): import('./types').EntryInput {
  const allowed = new Set(definedTags)
  return {
    categoryId,
    title: draft.title,
    url: draft.url,
    username: draft.username,
    password: draft.password,
    email: draft.email,
    phone: draft.phone,
    notes: draft.notes,
    favorite: draft.favorite,
    tags: draft.tags.filter((tag) => allowed.has(tag)),
  }
}
