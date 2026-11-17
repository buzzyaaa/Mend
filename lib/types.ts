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
  ListFilter,
  Preset,
  PresetInput,
  VaultStatus,
} from 'mend/native'

export type ThemeMode = 'system' | 'light' | 'dark'

/** 列表列标识，供列显示/隐藏配置使用。 */
export type ColumnKey = 'username' | 'password' | 'email' | 'phone' | 'notes'

/** 可由用户拖动调整宽度的两列。 */
export type ResizableColumnKey = 'check' | 'actions'

export interface Preferences {
  language: string | null
  theme: ThemeMode
  autoLockMinutes: number
  updateCheckIntervalDays: number
  lastUpdateCheckTs: number
  /** Desktop three-column widths (sidebar, list); the detail column takes the rest. */
  columnSizes: number[]
  /** 列表各列是否显示。 */
  visibleColumns: Record<ColumnKey, boolean>
  /** 用户拖动调整后的「选择 / 操作」列宽（points）。 */
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
