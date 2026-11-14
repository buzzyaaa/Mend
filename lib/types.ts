/** Shapes shared by the TSX UI and the `mend/native` module.
 *
 * The native DTOs are re-exported so the UI cannot drift from the generated
 * declarations in `.nsh/types/mend/native.d.ts`.
 */
export type {
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
} from 'mend/native'

export type ThemeMode = 'system' | 'light' | 'dark'

export interface Preferences {
  language: string | null
  theme: ThemeMode
  autoLockMinutes: number
  updateCheckIntervalDays: number
  lastUpdateCheckTs: number
  /** Desktop three-column widths (sidebar, list); the detail column takes the rest. */
  columnSizes: number[]
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
