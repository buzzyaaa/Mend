/** 列表行首的站点图标：库里缓存的真实 favicon，取不到时由 `EntryIcon` 回退
 *  到内置品牌 SVG 或分类图标。
 *
 *  抓取完全由原生层完成（`fetchSiteIcons` 走 Rust/ureq，直达条目自己的站点），
 *  TSX 只做两件事：读缓存（`siteIcon`，同步、不联网）和在界面静下来之后排一批
 *  抓取任务。所有网络请求都因此只有一个出口，也不会把整份站点清单交给第三方
 *  图标服务。
 */
import { signal } from 'nsh'

import * as native from './native'
import { preferences } from './preferences'

/** 每次有新的图标落地就加一：`EntryIcon` 读它来重新渲染整份列表。 */
export const iconRevision = signal(0)

/** url → `data:` URI；`''` 表示库里没有这个站点的图标（负结果也缓存，
 *  免得每次渲染都查一遍库）。 */
const cache = new Map<string, string>()

/** 一个条目网址对应的真实图标；没有时返回空串。同步、不联网。 */
export function siteIconFor(url: string | null | undefined): string {
  // 读 revision 建立依赖：抓取批次结束后列表会自己重画。
  iconRevision()
  if (!url) return ''
  const cached = cache.get(url)
  if (cached !== undefined) return cached
  let value = ''
  try {
    value = native.siteIcon(url)
  } catch {
    value = ''
  }
  cache.set(url, value)
  return value
}

/** 丢掉内存缓存并触发重画（清空库缓存、切换库之后调用）。 */
export function resetSiteIcons(): void {
  cache.clear()
  iconRevision.update((revision) => revision + 1)
}

/** 清空库里的图标缓存，之后重新排队抓取。 */
export async function clearSiteIcons(): Promise<number> {
  const removed = native.clearSiteIcons()
  resetSiteIcons()
  if (preferences().siteIcons && !preferences().offline) kickSiteIconFetch()
  return removed
}
/** 一批抓取的站点数：小批量让界面始终有喘息，进度也可见。 */
const BATCH_SIZE = 4
/** 解锁后先等这么久，把网络让给更新检查与首屏绘制。 */
const START_DELAY_MS = 3000
/** 两批之间再歇一会儿，避免一个队列长时间占着网络。 */
const BATCH_GAP_MS = 1200

let running = false
let timer: ReturnType<typeof setTimeout> | null = null

/** 目前是否还在排队抓取（设置页据此显示状态）。 */
export function siteIconFetching(): boolean {
  return running
}

async function runBatch(): Promise<number> {
  if (!preferences().siteIcons || preferences().offline) return 0
  if (!native.status().unlocked) return 0
  const report = await native.fetchSiteIcons(BATCH_SIZE)
  if (report.fetched > 0) {
    // 上一轮缓存的负结果可能刚好抓到图标了：整份清掉最省心。
    cache.clear()
    iconRevision.update((revision) => revision + 1)
  }
  return report.remaining
}

/** 解锁后调用一次：等列表静下来，再一批一批把缺的图标补上。
 *  重复调用是安全的（内部有重入保护）。 */
export function startSiteIconFetch(): void {
  if (running || preferences().offline) return
  running = true
  schedule(START_DELAY_MS)
}

/** 新增/编辑条目之后调用：马上（稍等 1 秒）补上新站点的图标。 */
export function kickSiteIconFetch(): void {
  if (running) return
  startSiteIconFetch()
}

/** 关掉开关时调用：已经排着的批次会在下一步自然停住。 */
export function stopSiteIconFetch(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  running = false
}

function schedule(delay: number): void {
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void step()
  }, delay)
}

async function step(): Promise<void> {
  if (preferences().offline || !preferences().siteIcons || !native.status().unlocked) {
    running = false
    return
  }
  try {
    const remaining = await runBatch()
    if (
      remaining > 0 &&
      !preferences().offline &&
      preferences().siteIcons &&
      native.status().unlocked
    ) {
      schedule(BATCH_GAP_MS)
    } else {
      running = false
    }
  } catch {
    // 网络不通 / 库被切换：安静停下，下次进入主界面再试。
    running = false
  }
}
