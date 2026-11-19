/** Shapes shared by the TSX UI and the `mend/native` module.
 *
 * The native DTOs are re-exported so the UI cannot drift from the generated
 * declarations in `.nsh/types/mend/native.d.ts`.
 */
export type {
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
} from 'mend/native'

export type ThemeMode = 'system' | 'light' | 'dark'

/** 列表列标识，供列显示/隐藏配置使用。
 *  0.5.0 起账号+密码、邮箱+手机号各合并为一格，旧的四列偏好在读取时迁移。 */
export type ColumnKey = 'credentials' | 'contact' | 'notes'

/** 支持拖动调整宽度的列：标题/分类/账号密码/邮箱手机号/备注，加首尾固定列。
 *  标签不再独占一列：它写在标题下面，与标题共用 name 列。 */
export type ResizableColumnKey =
  'check' | 'name' | 'category' | 'credentials' | 'contact' | 'notes' | 'actions'

/** 表格中实际有数据的列（不含最左选择框与最右操作列）的顺序。 */
export const DATA_COLUMN_KEYS: readonly ResizableColumnKey[] = [
  'name',
  'category',
  'credentials',
  'contact',
  'notes',
] as const

export interface Preferences {
  language: string | null
  theme: ThemeMode
  autoLockMinutes: number
  updateCheckIntervalDays: number
  lastUpdateCheckTs: number
  /** 是否从条目自己的网站抓取真实 favicon（缓存进库；关掉即零请求）。 */
  siteIcons: boolean
  /** Desktop three-column widths (sidebar, list); the detail column takes the rest. */
  columnSizes: number[]
  /** 列表各列是否显示。 */
  visibleColumns: Record<ColumnKey, boolean>
  /** 用户拖动调整后的各列宽（points）。 */
  columnWidths: Record<ResizableColumnKey, number>
}

export type SortMode = 'updated' | 'title' | 'favorite' | 'manual'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

export interface ConfirmState {
  title: string
  message: string
  confirmLabel: string
  destructive: boolean
  onConfirm: () => void | Promise<void>
}

export interface EntryEditorState {
  id: string | null
  categoryId: string | null
}

const BUILTIN_BUCKETS = ['all', 'favorites', 'archive', 'uncategorized', 'trash'] as const

export type BuiltinBucket = (typeof BUILTIN_BUCKETS)[number]

export function isBuiltinBucket(value: string): value is BuiltinBucket {
  return (BUILTIN_BUCKETS as readonly string[]).includes(value)
}
