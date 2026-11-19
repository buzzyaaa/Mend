// The small leading tile in an entry row: the site's real favicon when one has
// been cached, otherwise a brand glyph when the entry's website is known,
// otherwise the category emoji on the category colour.
import { Image, Text, View, token } from 'nsh'

import { categoryEmoji } from '../lib/category-icons'
import { siteIconFor } from '../lib/site-icons-cache'
import { siteIconForUrl } from '../lib/site-icons'
import type { Category, EntrySummary } from '../lib/types'

/** token() may return 6-digit (#rrggbb) or 8-digit (#rrggbbaa) hex.
 *  Append an alpha suffix to the RGB part only, avoiding invalid 10-digit colors. */
function withAlpha(color: string, alpha: string): string {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color)
  return hex ? `#${hex[1]}${alpha}` : color
}

/** Very dark brand marks (Apple, Microsoft…) disappear on dark surfaces.
 *  Lift them to a mid grey that stays readable on both themes. */
function brandTint(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance < 0.2 ? '#a1a1aa' : hex
}

export function EntryIcon(props: { entry: EntrySummary; category: Category | null | undefined }) {
  // 三级回退：库里缓存的真实 favicon → 内置品牌 SVG（离线可用）→ 分类 emoji。
  // 真实图标是彩色位图，不能再叠 tintColor（那会把它压成单色剪影）。
  const real = () => siteIconFor(props.entry.url)
  // 真实图标优先：离线/未抓到时才用内置品牌 glyph。
  const brand = () => (real() ? null : siteIconForUrl(props.entry.url))
  const categoryColor = () => props.category?.color ?? token('muted-foreground')

  return (
    <View
      class="h-8 w-8 shrink-0 items-center justify-center rounded-lg"
      style={{ backgroundColor: withAlpha(categoryColor(), '22') }}
    >
      <If when={real()}>{(icon) => <Image src={icon()} style={{ width: 20, height: 20 }} />}</If>
      <If when={brand()}>
        {(icon) => (
          <Image
            src={icon().asset}
            accessibilityLabel={icon().name}
            style={{ width: 18, height: 18, tintColor: brandTint(icon().hex) }}
          />
        )}
      </If>
      <If when={!real() && !brand()}>
        <Text class="text-sm">{categoryEmoji(props.category?.icon)}</Text>
      </If>
    </View>
  )
}
