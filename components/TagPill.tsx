import { colorScheme, Text, View } from 'nsh'

/** 一对前景/背景色，直接喂给 inline style（nsh 的 class 不能动态拼色）。 */
export interface TagColor {
  background: string
  foreground: string
}

/** 预定义柔和色板：每色给出浅色/深色两套。背景浅、文字深（浅色主题），
 *  背景深、文字亮（深色主题），保证两种主题下对比度都够。
 *  顺序即 hash 落点，改动顺序会改变历史标签配色，谨慎调整。 */
const PALETTE: ReadonlyArray<{ light: TagColor; dark: TagColor }> = [
  {
    light: { background: '#dcebf9', foreground: '#215283' },
    dark: { background: '#22384f', foreground: '#8ebdeb' },
  },
  {
    light: { background: '#dcf9eb', foreground: '#218352' },
    dark: { background: '#224f38', foreground: '#8eebbd' },
  },
  {
    light: { background: '#f9eddc', foreground: '#835a21' },
    dark: { background: '#4f3c22', foreground: '#ebc48e' },
  },
  {
    light: { background: '#f9dce6', foreground: '#832141' },
    dark: { background: '#4f2231', foreground: '#eb8ead' },
  },
  {
    light: { background: '#ebdcf9', foreground: '#522183' },
    dark: { background: '#38224f', foreground: '#bd8eeb' },
  },
  {
    light: { background: '#dcf4f9', foreground: '#217283' },
    dark: { background: '#22474f', foreground: '#8edceb' },
  },
  {
    light: { background: '#f9f4dc', foreground: '#837221' },
    dark: { background: '#4f4722', foreground: '#ebdc8e' },
  },
  {
    light: { background: '#f9dcdc', foreground: '#832121' },
    dark: { background: '#4f2222', foreground: '#eb8e8e' },
  },
  {
    light: { background: '#dcf9dc', foreground: '#218321' },
    dark: { background: '#224f22', foreground: '#8eeb8e' },
  },
  {
    light: { background: '#f9dcf4', foreground: '#832172' },
    dark: { background: '#4f2247', foreground: '#eb8edc' },
  },
]

/** djb2 稳定 hash → 色板下标。同样文字永远落到同一槽位，不依赖 render 次数。 */
export function tagColorIndex(tag: string): number {
  let hash = 5381
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) + hash + tag.charCodeAt(i)) >>> 0
  }
  return hash % PALETTE.length
}

/** 按当前主题返回标签配色。内部读取响应式 `colorScheme()`，需在 JSX
 *  （style 表达式）里调用才能随主题切换更新，不要在组件函数体里快照。 */
export function tagColor(tag: string): TagColor {
  const slot = PALETTE[tagColorIndex(tag)]
  return colorScheme() === 'dark' ? slot.dark : slot.light
}

/** 单个「小胶囊」标签：圆角底色 + 彩色文字。颜色按 label 确定性生成。 */
export function TagPill(props: {
  /** 完整显示文字，含 `#` 前缀，如 `#work`。 */
  label: string
  onPress?: () => void
  class?: string
}) {
  const color = () => tagColor(props.label)
  return (
    <View
      class={'shrink-0 flex-row items-center rounded-full px-1.5 py-0.5 ' + (props.class ?? '')}
      style={{ backgroundColor: color().background }}
      onPress={props.onPress}
      role={props.onPress ? 'button' : undefined}
    >
      <Text
        class="text-[11px] font-medium"
        style={{ color: color().foreground, numberOfLines: 1, lineHeight: 15 }}
      >
        {props.label}
      </Text>
    </View>
  )
}
