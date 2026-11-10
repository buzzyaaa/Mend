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
  createdAt: number
  updatedAt: number
}

export type PresetFieldType = 'username' | 'email' | 'phone'

export interface Preset {
  id: string
  fieldType: PresetFieldType
  label: string
  value: string
  sortOrder: number
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

export type Locale = 'zh-CN' | 'en'
