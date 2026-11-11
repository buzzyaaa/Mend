// 与 Rust 侧 IPC 结构体一一对应的前端类型（契约见 docs/03-architecture.md §3）

export interface Category {
  id: string
  name: string
  color?: string | null
  icon?: string | null
  sortOrder: number
  entryCount?: number
}

export interface EntryView {
  id: string
  categoryId: string | null
  title: string
  url?: string | null
  username: string
  password: string
  email: string
  phone: string
  notes: string
  favorite: boolean
  /** 明文标签列表（语义同分类名）。 */
  tags: string[]
  createdAt: number
  updatedAt: number
  /** 回收站条目才有值（删除时间戳）。 */
  deletedAt?: number | null
}

/** 提交给 entry_create / entry_update 的明文入参（IPC 传输，不落盘）。 */
export interface EntryInput {
  categoryId: string | null
  title: string
  url: string | null
  username: string
  password: string
  email: string
  phone: string
  notes: string
  favorite: boolean
  /** 逗号分隔输入解析前的最终数组形式；提交前由表单拆分。 */
  tags: string[]
}

export type PresetFieldType = 'username' | 'email' | 'phone' | 'password'

export interface Preset {
  id: string
  fieldType: PresetFieldType
  label: string
  value: string
  sortOrder: number
}

/** 提交给 preset_create / preset_update 的明文入参。 */
export interface PresetInput {
  fieldType: PresetFieldType
  label: string
  value: string
}

export interface GeneratorOptions {
  length: number
  uppercase: boolean
  lowercase: boolean
  digits: boolean
  symbols: boolean
  excludeAmbiguous: boolean
}

export interface VaultStatus {
  initialized: boolean
  unlocked: boolean
}

/** 应用数据目录：设置页展示，便于手动拷贝库文件。 */
export interface AppPaths {
  dataDir: string
  dbPath: string
}

export interface BackupExportResult {
  path: string
  bytes: number
}

/** 恢复结果：条目/分类数用于提示确认，previousBackup 为旧库留底文件名。 */
export interface BackupImportResult {
  entries: number
  categories: number
  previousBackup?: string | null
}

export type Locale = 'zh-CN' | 'en'

/** 主题：跟随系统 / 固定浅色 / 固定深色。 */
export type ThemeMode = 'system' | 'light' | 'dark'
