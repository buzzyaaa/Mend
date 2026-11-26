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

/** 表格列标识：首尾固定列 + 数据列。列宽不可拖动，由表格按窗口宽度分配。
 *  标签不再独占一列：它写在标题下面，与标题共用 name 列。 */
export type TableColumnKey =
  'check' | 'name' | 'category' | 'credentials' | 'contact' | 'notes' | 'actions'

export interface Preferences {
  language: string | null
  theme: ThemeMode
  autoLockMinutes: number
  updateCheckIntervalDays: number
  lastUpdateCheckTs: number
  /** 上次更新流程里已下载完成但没能重启应用的版本（整包/代码包都可能）。
   *  下次启动若发现该版本仍然可用，跳过检查频率节流立即重新弹窗。 */
  pendingUpdateVersion: string
  pendingUpdateTs: number
  /** 上一次「直接安装已下载代码包」的触发时间；>0 表示装过一次但版本
   *  仍未更新（启动器可能拒绝了旧包），再次遇到已下载包时回退为重新
   *  下载，避免反复重启进一个无效包。确认已最新时清零。 */
  packageReadyInstallTs: number
  /** 是否从条目自己的网站抓取真实 favicon（缓存进库；关掉即零请求）。 */
  siteIcons: boolean
  /** 离线模式：不发起任何外部网络请求（站点图标抓取、更新检查与下载）。 */
  offline: boolean
  /** 最近使用的库文件绝对路径（最新在前，去重限长）；偏好在全局数据目录，切库不丢。 */
  recentVaults: string[]
  /** Desktop three-column widths (sidebar, list); the detail column takes the rest. */
  columnSizes: number[]
  /** 列表各列是否显示。 */
  visibleColumns: Record<ColumnKey, boolean>
  /** 关闭主窗口时是否缩到系统托盘而不是退出。首次关闭会询问一次，之后只读这个值。 */
  closeMinimizeToTray: boolean
  /** 是否已经就「关闭时最小化到托盘」做过选择（含首次询问的确定/取消与设置里手动改）。 */
  trayChoiceMade: boolean
  /** 是否随系统开机启动。仅桌面端生效，实际状态以原生注册项为准。 */
  autoStart: boolean
  /** 界面整体缩放（1 = 100%）：由设置-外观里的滑块控制，只影响布局不改变字号系统设置。 */
  layoutScale: number
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
  /** 取消按钮文案；缺省用 common.cancel。关闭询问用它表达「直接退出」。 */
  cancelLabel?: string
  destructive: boolean
  onConfirm: () => void | Promise<void>
  /** 取消 / Esc / 点遮罩时执行；关闭询问靠它在取消时记下选择并退出。 */
  onCancel?: () => void | Promise<void>
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
