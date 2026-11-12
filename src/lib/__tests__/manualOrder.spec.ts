// buildManualOrders：把后端按 updated_at 返回的条目列表，按 sort_order 重建各桶手动序。
import { describe, it, expect } from 'vitest'
import { buildManualOrders } from '@/lib/manualOrder'
import type { Category, EntryView } from '@/types'

let seq = 0
function entry(
  id: string,
  categoryId: string | null,
  opts: { sortOrder?: number; updatedAt?: number; favorite?: boolean } = {},
): EntryView {
  seq += 1
  return {
    id,
    categoryId,
    title: `fake-${id}`,
    username: '',
    password: '',
    email: '',
    phone: '',
    notes: '',
    favorite: opts.favorite ?? false,
    tags: [],
    createdAt: seq,
    updatedAt: opts.updatedAt ?? seq,
    sortOrder: opts.sortOrder ?? 0,
  }
}

function cat(id: string, sortOrder: number): Category {
  return { id, name: `cat-${id}`, sortOrder }
}

describe('buildManualOrders', () => {
  it('空列表返回空顺序表（all/starred 均为空数组）', () => {
    const orders = buildManualOrders([])
    expect(orders.all).toEqual([])
    expect(orders.starred).toEqual([])
  })

  it('按 categoryId 分组，未分类落到 uncategorized 桶', () => {
    const orders = buildManualOrders([
      entry('a', 'cat-1', { sortOrder: 0 }),
      entry('b', null, { sortOrder: 0 }),
      entry('c', 'cat-2', { sortOrder: 0 }),
      entry('d', 'cat-1', { sortOrder: 1 }),
    ])
    expect(orders['cat-1']).toEqual(['a', 'd'])
    expect(orders['cat-2']).toEqual(['c'])
    expect(orders.uncategorized).toEqual(['b'])
  })

  it('桶内按 sort_order 升序重排，忽略后端 updated_at 返回顺序', () => {
    // 故意让返回顺序与 sort_order 相反：updated_at 越大的 sort_order 越小。
    const orders = buildManualOrders([
      entry('late', 'cat', { sortOrder: 2, updatedAt: 30 }),
      entry('mid', 'cat', { sortOrder: 1, updatedAt: 20 }),
      entry('first', 'cat', { sortOrder: 0, updatedAt: 10 }),
    ])
    expect(orders.cat).toEqual(['first', 'mid', 'late'])
  })

  it('sort_order 相同时按 updated_at 倒序兜底', () => {
    const orders = buildManualOrders([
      entry('old', 'cat', { sortOrder: 0, updatedAt: 1 }),
      entry('new', 'cat', { sortOrder: 0, updatedAt: 9 }),
    ])
    expect(orders.cat).toEqual(['new', 'old'])
  })

  it('all 按分类顺序分组，starred 只含星标且保持相对顺序', () => {
    const orders = buildManualOrders(
      [
        entry('a1', 'cat-2', { sortOrder: 0, favorite: true }),
        entry('b1', 'cat-1', { sortOrder: 0 }),
        entry('a2', 'cat-2', { sortOrder: 1, favorite: true }),
        entry('none', null, { sortOrder: 0 }),
      ],
      [cat('cat-1', 0), cat('cat-2', 1)],
    )
    // cat-1 组在前，未归类排最后；组内按 sort_order。
    expect(orders.all).toEqual(['b1', 'a1', 'a2', 'none'])
    expect(orders.starred).toEqual(['a1', 'a2'])
  })
})
