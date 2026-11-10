// 条目密码体检：弱密码（太短 / 只有一类字符）与重复密码（多条共用同一密码）。
// 纯前端计算，密码不离开内存；解锁后才可用。

import type { EntryView } from '@/types'

export interface PasswordIssue {
  weak: boolean
  duplicate: boolean
}

const MIN_SAFE_LENGTH = 8

function classesOf(password: string): number {
  let classes = 0
  if (/[a-z]/.test(password)) classes += 1
  if (/[A-Z]/.test(password)) classes += 1
  if (/[0-9]/.test(password)) classes += 1
  if (/[^a-zA-Z0-9]/.test(password)) classes += 1
  return classes
}

/** 返回 entryId → 问题标记；没有密码的条目视为无风险。 */
export function analyzePasswords(entries: EntryView[]): Map<string, PasswordIssue> {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    if (!entry.password) continue
    counts.set(entry.password, (counts.get(entry.password) ?? 0) + 1)
  }

  const result = new Map<string, PasswordIssue>()
  for (const entry of entries) {
    if (!entry.password) {
      result.set(entry.id, { weak: false, duplicate: false })
      continue
    }
    const weak = entry.password.length < MIN_SAFE_LENGTH || classesOf(entry.password) < 2
    const duplicate = (counts.get(entry.password) ?? 0) > 1
    result.set(entry.id, { weak, duplicate })
  }
  return result
}
