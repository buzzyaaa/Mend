// 手动排序顺序重建：把后端返回的条目列表映射成各桶 id 顺序。
// 后端 `entry_list` 固定按 `updated_at DESC` 返回，因此这里必须显式按
// `sort_order` 重排，否则「手动排序」在刷新 / 重启后不会恢复拖拽顺序。
// 纯函数，便于单测（契约见 docs/04 §2.3 / docs/03 §3）。

import type { Category, EntryView } from '@/types'

export type ManualOrderMap = Record<string, string[]>

/** 同桶内排序：`sort_order` 升序，再按 `updated_at` 倒序兜底。 */
function bySortOrder(a: EntryView, b: EntryView): number {
  return a.sortOrder - b.sortOrder || b.updatedAt - a.updatedAt
}

/**
 * 从后端返回顺序重建各桶手动序：
 * - 每个分类 / 未分类桶：同桶内按 `sort_order` 升序；
 * - `all` / `starred`：跨分类桶，先按分类顺序（`categories.sortOrder`）分组，
 *   再在组内按 `sort_order` 升序——`sort_order` 只在桶内唯一，跨桶比较没有意义；
 * - 归档桶（禁用拖拽）与回收站不参与，展示回退 `updated_at`。
 */
export function buildManualOrders(list: EntryView[], categories: Category[] = []): ManualOrderMap {
  const buckets: Record<string, EntryView[]> = {}
  for (const entry of list) {
    const key = entry.categoryId ?? 'uncategorized'
    ;(buckets[key] ??= []).push(entry)
  }
  for (const bucket of Object.values(buckets)) bucket.sort(bySortOrder)

  const orders: ManualOrderMap = {}
  for (const [key, bucket] of Object.entries(buckets)) orders[key] = bucket.map((e) => e.id)

  // 跨分类桶：分类顺序取侧栏 `categories.sortOrder`，未归类的排最后。
  const categoryRank = new Map(categories.map((cat, index) => [cat.id, index]))
  const cross = (source: EntryView[]): string[] =>
    source
      .sort((a, b) => {
        const rank = (entry: EntryView) =>
          entry.categoryId
            ? (categoryRank.get(entry.categoryId) ?? Number.MAX_SAFE_INTEGER)
            : Number.MAX_SAFE_INTEGER
        return rank(a) - rank(b) || bySortOrder(a, b)
      })
      .map((entry) => entry.id)

  orders.all = cross(list)
  orders.starred = cross(list.filter((entry) => entry.favorite))
  return orders
}
