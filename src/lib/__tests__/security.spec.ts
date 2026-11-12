// analyzePasswords：弱密码（长度/字符类）与重复密码标记。
// 全部使用明显伪造的口令，不含任何真实凭据。
import { describe, it, expect } from 'vitest'
import { analyzePasswords, type PasswordIssue } from '@/lib/security'
import type { EntryView } from '@/types'

function entry(id: string, password: string): EntryView {
  return {
    id,
    categoryId: null,
    title: `fake-title-${id}`,
    username: 'fake-user',
    password,
    email: '',
    phone: '',
    notes: '',
    favorite: false,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

function issues(entries: EntryView[]): Map<string, PasswordIssue> {
  return analyzePasswords(entries)
}

describe('analyzePasswords — 空密码', () => {
  it('无密码条目 weak=false duplicate=false', () => {
    const map = issues([entry('a', '')])
    expect(map.get('a')).toEqual({ weak: false, duplicate: false })
  })

  it('空列表返回空 Map', () => {
    expect(issues([]).size).toBe(0)
  })
})

describe('analyzePasswords — 弱密码判定', () => {
  it('长度 <8 判弱（即使多类字符）', () => {
    expect(issues([entry('a', 'Ab1!')]).get('a')?.weak).toBe(true)
  })

  it('长度 ≥8 但单一字符类判弱', () => {
    expect(issues([entry('a', 'abcdefgh')]).get('a')?.weak).toBe(true) // 全小写
    expect(issues([entry('a', 'ABCDEFGH')]).get('a')?.weak).toBe(true) // 全大写
    expect(issues([entry('a', '12345678')]).get('a')?.weak).toBe(true) // 全数字
    expect(issues([entry('a', '!@#!@#!@#')]).get('a')?.weak).toBe(true) // 全符号
  })

  it('长度 ≥8 且 ≥2 类不判弱', () => {
    expect(issues([entry('a', 'hunter2fake')]).get('a')?.weak).toBe(false) // 小写+数字
    expect(issues([entry('a', 'FakePassw0rd')]).get('a')?.weak).toBe(false)
  })

  it('边界：恰好 8 位两类不弱，7 位两类判弱', () => {
    expect(issues([entry('ok8', 'aaaaaa1')]).get('ok8')?.weak).toBe(true) // 7 位
    expect(issues([entry('ok8b', 'aaaaaaaa1')]).get('ok8b')?.weak).toBe(false)
  })
})

describe('analyzePasswords — 重复密码', () => {
  it('两条共用同一密码都标 duplicate', () => {
    const map = issues([entry('a', 'sameFake1!'), entry('b', 'sameFake1!')])
    expect(map.get('a')?.duplicate).toBe(true)
    expect(map.get('b')?.duplicate).toBe(true)
  })

  it('三条共用同一密码都标 duplicate', () => {
    const map = issues([
      entry('a', 'trioFake2@'),
      entry('b', 'trioFake2@'),
      entry('c', 'trioFake2@'),
    ])
    for (const id of ['a', 'b', 'c']) expect(map.get(id)?.duplicate).toBe(true)
  })

  it('密码不同时都不标 duplicate', () => {
    const map = issues([entry('a', 'uniqueFake1'), entry('b', 'uniqueFake2')])
    expect(map.get('a')?.duplicate).toBe(false)
    expect(map.get('b')?.duplicate).toBe(false)
  })

  it('空密码条目不参与重复计数', () => {
    const map = issues([entry('a', ''), entry('b', '')])
    expect(map.get('a')).toEqual({ weak: false, duplicate: false })
    expect(map.get('b')).toEqual({ weak: false, duplicate: false })
  })
})

describe('analyzePasswords — 混合场景', () => {
  it('一次断言 Map 完整键集与各项标记', () => {
    const entries = [
      entry('empty', ''), // 无密码 → 全 false
      entry('short', 'Ab1!'), // 太短 → weak
      entry('mono', 'abcdefgh'), // 单类 → weak
      entry('dup1', 'sharedFake9#'), // 强 + 重复
      entry('dup2', 'sharedFake9#'), // 强 + 重复
      entry('ok', 'hunter2fake'), // 强，唯一
    ]
    const map = issues(entries)
    expect([...map.keys()].sort()).toEqual(['dup1', 'dup2', 'empty', 'mono', 'ok', 'short'])
    expect(map.get('empty')).toEqual({ weak: false, duplicate: false })
    expect(map.get('short')).toEqual({ weak: true, duplicate: false })
    expect(map.get('mono')).toEqual({ weak: true, duplicate: false })
    expect(map.get('dup1')).toEqual({ weak: false, duplicate: true })
    expect(map.get('dup2')).toEqual({ weak: false, duplicate: true })
    expect(map.get('ok')).toEqual({ weak: false, duplicate: false })
  })
})
