import { TextView } from 'nsh/base'
import { locale } from 'nsh'

import type { Category, EntrySummary, SortMode } from './types'

export function formatDate(ms: number, withTime = false): string {
  if (!ms) return ''
  const date = new Date(ms)
  try {
    return new Intl.DateTimeFormat(locale(), {
      dateStyle: 'medium',
      ...(withTime ? { timeStyle: 'short' } : {}),
    }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function passwordStrength(password: string): {
  score: number
  level: 'weak' | 'medium' | 'strong'
} {
  if (!password) return { score: 0, level: 'weak' }
  let score = 0
  if (password.length >= 8) score += 1
  if (password.length >= 12) score += 1
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1
  return {
    score,
    level: score <= 1 ? 'weak' : score <= 3 ? 'medium' : 'strong',
  }
}

/** Markdown notes as one plain-text line for list rows. */
export function notesPreview(notes: string, limit = 120): string {
  const text = notes.trim()
  if (!text) return ''
  try {
    const document = TextView.parse(text)
    const plain = TextView.plainText(document).replace(/\s+/g, ' ').trim()
    return plain.length > limit ? `${plain.slice(0, limit)}…` : plain
  } catch {
    const plain = text
      .replace(/[#*_>`~[\]()!-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return plain.length > limit ? `${plain.slice(0, limit)}…` : plain
  }
}

export function normalizeUrl(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export function splitTags(raw: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const part of raw.split(/[,，]/)) {
    const tag = part.trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  return tags
}

export function sortEntries(
  list: EntrySummary[],
  mode: SortMode,
  categories: Category[],
  bucket: string,
): EntrySummary[] {
  const copy = [...list]
  if (bucket === 'trash') {
    return copy.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
  }
  if (bucket === 'archive') {
    return copy.sort((a, b) => b.updatedAt - a.updatedAt)
  }
  if (mode === 'manual') {
    const categoryOrder = new Map(categories.map((category, index) => [category.id, index]))
    return copy.sort((a, b) => {
      const aOrder = a.categoryId ? (categoryOrder.get(a.categoryId) ?? 10_000) : 9_999
      const bOrder = b.categoryId ? (categoryOrder.get(b.categoryId) ?? 10_000) : 9_999
      if (aOrder !== bOrder) return aOrder - bOrder
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
      return b.updatedAt - a.updatedAt
    })
  }
  const compareTitle = (a: string, b: string): number => {
    try {
      return a.localeCompare(b, locale(), { sensitivity: 'base', numeric: true })
    } catch {
      const left = a.toLowerCase()
      const right = b.toLowerCase()
      return left < right ? -1 : left > right ? 1 : 0
    }
  }
  const pinned = (entry: EntrySummary) => (entry.favorite ? 0 : 1)
  return copy.sort((a, b) => {
    if (pinned(a) !== pinned(b)) return pinned(a) - pinned(b)
    if (mode === 'title') return compareTitle(a.title, b.title)
    return b.updatedAt - a.updatedAt
  })
}

export function categoryLabel(
  categoryId: string | null,
  categories: Category[],
  uncategorized: string,
): string {
  if (!categoryId) return uncategorized
  return categories.find((category) => category.id === categoryId)?.name ?? uncategorized
}
