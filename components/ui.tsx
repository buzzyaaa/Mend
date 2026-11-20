import { cleanup, computed, effect, signal, Text, token, View } from 'nsh'
import type { JSX } from 'nsh'
import {
  Button,
  ColorArea,
  ColorField,
  ColorPicker,
  ColorSlider,
  Input,
  Menu,
  MenuItem,
  Switch,
  Tooltip,
  type SelectItem,
} from 'nsh/base'
import { t } from 'nsh/i18n'

import { touchActivity } from '../lib/state'

import { Icon, type IconName } from './Icon'
import { ToastHost } from './ToastHost'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_CLASS: Record<ButtonVariant, string> = {
  primary:
    'h-8 flex-row items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 text-primary-foreground ' +
    'transition hover:opacity-90 active:opacity-75 disabled:opacity-45',
  secondary:
    'h-8 flex-row items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 ' +
    'text-foreground transition hover:bg-accent active:opacity-75 disabled:opacity-45',
  ghost:
    'h-8 flex-row items-center justify-center gap-1.5 rounded-md px-2.5 text-foreground ' +
    'transition hover:bg-accent active:opacity-75 disabled:opacity-45',
  danger:
    'h-8 flex-row items-center justify-center gap-1.5 rounded-md bg-destructive px-2.5 ' +
    'text-white transition hover:opacity-90 active:opacity-75 disabled:opacity-45',
}

/** 所有文字按钮统一的小手光标；禁用态由 Button 的 disabled 变体接管。 */
const BUTTON_CURSOR = 'cursor-pointer disabled:cursor-not-allowed'

/** nsh 的 `Dialog` 在桌面把 popup 放在透明层的左上角，且默认没有遮罩视图。
 *  所有弹窗统一加这两个类：popup 居中 + 半透明遮罩。 */
export const MODAL_CLASS = 'm-auto'
export const MODAL_BACKDROP_CLASS = 'bg-black/50'

/** ColorPicker 在带 alpha 的格式下会给出 8 位 hex；库里只存 `#RRGGBB`。 */
export function hexColor(value: string): string {
  const trimmed = value.trim()
  return /^#[0-9a-fA-F]{8}$/.test(trimmed) ? trimmed.slice(0, 7) : trimmed
}

/** 标签与分类共用的颜色选择器：饱和度/明度区域 + 色相滑杆 + 十六进制输入。
 *  受控组件：值来自调用方 signal，每次改动经 `onChange` 回写已归一化的 7 位 hex。 */
export function ColorPickerControl(props: {
  value: string
  onChange: (color: string) => void
  class?: string
}) {
  return (
    <ColorPicker
      value={props.value}
      format="hex"
      onChange={({ value }) => props.onChange(hexColor(value))}
      class={props.class ?? 'gap-1.5'}
    >
      <ColorArea
        accessibilityLabel={t('tag.color')}
        class="h-16"
        panelClass="rounded-md"
        thumbClass="h-3.5 w-3.5 rounded-full border-2 border-white"
        fillThumb
      />
      <View class="flex-row items-center gap-2">
        <ColorSlider
          colorSpace="hsl"
          channel="hue"
          accessibilityLabel={t('tag.color')}
          class="h-6 flex-1 justify-center px-2"
          trackClass="h-2.5 rounded-full"
          thumbClass="h-3.5 w-3.5 rounded-full border-2 border-white"
          fillThumb
        />
        <ColorField
          format="hex"
          accessibilityLabel={t('tag.hex')}
          class="h-7 w-24 rounded-md border border-border bg-background px-2 text-right text-[11px]"
        />
      </View>
    </ColorPicker>
  )
}

export function ActionButton(props: {
  label?: string
  variant?: ButtonVariant
  icon?: IconName
  onPress?: () => void
  disabled?: boolean
  class?: string
  accessibilityLabel?: string
  testID?: string
}) {
  const variant = props.variant ?? 'secondary'
  return (
    <Button
      class={`${BUTTON_CLASS[variant]} ${BUTTON_CURSOR} ${props.class ?? ''}`}
      onPress={
        props.onPress
          ? () => {
              touchActivity()
              props.onPress?.()
            }
          : undefined
      }
      disabled={props.disabled}
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      testID={props.testID}
    >
      <View class="flex-row items-center justify-center gap-1.5">
        {props.icon ? (
          <Icon
            name={props.icon}
            size={14}
            color={
              variant === 'primary'
                ? token('primary-foreground')
                : variant === 'danger'
                  ? '#ffffff'
                  : token('foreground')
            }
          />
        ) : null}
        {props.label ? (
          <Text
            class={
              variant === 'primary'
                ? 'text-xs font-medium text-primary-foreground'
                : variant === 'danger'
                  ? 'text-xs font-medium text-white'
                  : 'text-xs font-medium text-foreground'
            }
          >
            {props.label}
          </Text>
        ) : null}
      </View>
    </Button>
  )
}

export function IconButton(props: {
  icon: IconName
  label: string
  onPress?: () => void
  disabled?: boolean
  active?: boolean
  size?: number
  class?: string
  testID?: string
  /** 图标色，不传时按 `tone` / `active` 取主题色（星标这类有状态的图标用 tone 上色）。 */
  iconColor?: string
  /** 语义色：删除类红、星标类黄；悬停底色用同族浅色 tint，图标保持语义色。 */
  tone?: 'destructive' | 'warning'
}) {
  // Button 没有 onMouseEnter/Leave（ComponentHostProps 不含），外层 View 的
  // mouseenter 含子视图，用它驱动悬停态：图标色随悬停提亮，底色走 hover: 类。
  const hovered = signal(false)
  const toneColor = () =>
    props.tone === 'destructive'
      ? token('destructive')
      : props.tone === 'warning'
        ? token('warning')
        : null
  const baseColor = () =>
    props.iconColor ?? toneColor() ?? token(props.active ? 'foreground' : 'muted-foreground')
  const hoverColor = () => props.iconColor ?? toneColor() ?? token('foreground')
  const hoverBg = props.disabled
    ? ''
    : props.tone === 'destructive'
      ? 'hover:bg-destructive/10 '
      : props.tone === 'warning'
        ? 'hover:bg-warning/10 '
        : props.active
          ? 'hover:bg-accent/70 '
          : 'hover:bg-accent '
  return (
    <View
      class={
        'h-7 w-7 items-center justify-center rounded-md transition ' +
        (props.active ? 'bg-accent ' : '') +
        hoverBg +
        (props.disabled ? 'cursor-not-allowed ' : props.onPress ? 'cursor-pointer ' : '') +
        (props.class ?? '')
      }
      onMouseEnter={() => hovered.set(true)}
      onMouseLeave={() => hovered.set(false)}
    >
      <Button
        testID={props.testID}
        class="h-full w-full items-center justify-center rounded-md active:opacity-70 disabled:opacity-35"
        onPress={
          props.onPress
            ? () => {
                touchActivity()
                props.onPress?.()
              }
            : undefined
        }
        disabled={props.disabled}
        accessibilityLabel={props.label}
        tooltip={
          <Tooltip
            placement="top"
            delay={350}
            class="rounded-md border border-border bg-popover px-2 py-1 shadow-md"
          >
            <Text class="text-[11px] text-popover-foreground">{props.label}</Text>
          </Tooltip>
        }
      >
        <Icon
          name={props.icon}
          size={props.size ?? 16}
          color={hovered() && !props.disabled ? hoverColor() : baseColor()}
        />
      </Button>
    </View>
  )
}

/** 单元格截断文字的悬停完整内容气泡：列表里省略号裁掉的部分靠它读全。
 *  长备注允许换行到 8 行，气泡宽度封顶避免铺满屏幕。 */
export function fullTextTip(text: string): JSX.Element {
  return (
    <Tooltip
      placement="top"
      delay={350}
      testID="full-text-tip"
      class="max-w-[320px] rounded-md border border-border bg-popover px-2 py-1 shadow-md"
    >
      <Text class="text-[11px] text-popover-foreground" style={{ numberOfLines: 8 }}>
        {text}
      </Text>
    </Tooltip>
  )
}

export function Field(props: {
  label: string
  hint?: string
  icon?: IconName
  children: JSX.Element
  class?: string
}) {
  return (
    <View class={`gap-1 ${props.class ?? ''}`}>
      <View class="flex-row items-center gap-1.5">
        {props.icon ? <Icon name={props.icon} size={13} color={token('primary')} /> : null}
        <Text class="text-xs font-medium text-muted-foreground">{props.label}</Text>
      </View>
      {props.children}
      {props.hint ? <Text class="text-[11px] text-muted-foreground">{props.hint}</Text> : null}
    </View>
  )
}

/** 输入框文字与背景的着色约定（实测于 nsh 0.5.x / Windows）：
 *
 *  - 文字色必须走 `class` 里的 `text-foreground`／`placeholder:text-muted-foreground`，
 *    写进 `style.color` 只作用于外层容器、够不到内部文本框。
 *
 *  高度统一为 32（`h-8`），与 `ActionButton`／`SelectField` 的触发器同高，
 *  这样「输入框 + 按钮」并排时不会一高一矮（预设弹窗那行就是这个问题）。
 *  多行输入自己带 `style.height`，不套 `h-8`。 */
const INPUT_CLASS =
  'w-full rounded-md border border-input bg-background px-2.5 text-xs ' +
  'text-foreground placeholder:text-muted-foreground'

export function TextField(props: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  multiline?: boolean
  autoFocus?: boolean
  maxLength?: number
  onSubmit?: () => void
  /** 失焦回调；行内编辑用它做「失焦即保存」。 */
  onBlur?: () => void
  class?: string
  style?: Record<string, unknown>
  accessibilityLabel?: string
  autoComplete?: string
  disabled?: boolean
}) {
  return (
    <Input
      value={props.value}
      onChange={(event) => {
        touchActivity()
        props.onChange(event.value)
      }}
      onBlur={props.onBlur ? () => props.onBlur?.() : undefined}
      placeholder={props.placeholder}
      multiline={!!props.multiline}
      autoFocus={props.autoFocus}
      maxLength={props.maxLength}
      readonly={props.disabled}
      accessibilityLabel={props.accessibilityLabel}
      // The generated types narrow autoComplete to a union; the app only uses
      // standard values and the native side ignores unknown ones.
      autoComplete={props.autoComplete as never}
      onSubmit={props.onSubmit ? () => props.onSubmit?.() : undefined}
      class={`${INPUT_CLASS} ${props.multiline ? '' : 'h-8'} ${props.class ?? ''}`}
      style={{
        fontSize: 12,
        ...props.style,
      }}
    />
  )
}

/** 密码输入框（原生 `Input`，明文显示）。
 *
 * 离线自用软件，按用户要求直接明文显示、不再用 `masked` 圆点掩码，也不叠加浮层，
 * 以保证输入法、光标、点击体验与原生一致。`reveal` 保留为可选参数（兼容旧调用），
 * 但当前始终明文；如需隐藏可在调用处自行处理。 */
export function PasswordField(props: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  reveal?: boolean
  autoFocus?: boolean
  autoComplete?: string
  onSubmit?: () => void
  accessibilityLabel?: string
  class?: string
}) {
  return (
    <Input
      value={props.value}
      onChange={(event) => {
        touchActivity()
        props.onChange(event.value)
      }}
      placeholder={props.placeholder}
      autoFocus={props.autoFocus}
      autoComplete={props.autoComplete as never}
      onSubmit={props.onSubmit ? () => props.onSubmit?.() : undefined}
      accessibilityLabel={props.accessibilityLabel}
      class={`${INPUT_CLASS} h-8 ${props.class ?? ''}`}
      style={{ fontSize: 12 }}
    />
  )
}

/** 下拉选择：用官方的 `Menu` 承载列表（触发器自己画）。
 *
 *  为什么不自己渲染列表：自渲染列表只能排在文档流里，展开时会把下面的内容顶下去
 *  （「弹出不是浮在界面上」）；改成 `absolute` 又会被后续兄弟（列表行、表单字段）
 *  盖住——nsh 的 `zIndex` 只对同级生效，抬不到外层兄弟之上。
 *  官方 `Menu` 是**独立弹出的浮层**（桌面端弹出在自己的窗口里），不占文档流、
 *  不会被内容盖住、放不下时自己滚动，`Dialog` 里也能用（`Select` 的弹层在
 *  `Dialog` 里弹不出来，这才是当初「选择分类没有用」的根因）。
 *
 *  另外：组件函数体只执行一次（Solid 语义），`props` 的派生值必须放进
 *  `computed()` 或 JSX 表达式，否则选中后触发器文字不更新。 */
export function SelectField(props: {
  items: SelectItem[]
  value: string | null
  onChange: (value: string | null) => void
  placeholder?: string
  cleanable?: boolean
  disabled?: boolean
  class?: string
}) {
  const title = computed(
    () => props.items.find((item) => item.value === props.value)?.title ?? props.placeholder ?? '',
  )
  const hasValue = computed(() => props.value !== null && props.value !== '')
  const trigger = (
    <Button
      class={
        'h-8 w-full flex-row items-center justify-between gap-2 rounded-md border border-input ' +
        'bg-background px-2.5 transition ' +
        (props.disabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer hover:bg-accent')
      }
      disabled={props.disabled}
      accessibilityLabel={title()}
    >
      {hasValue() ? (
        <Text class="flex-1 text-xs text-foreground" style={{ numberOfLines: 1 }}>
          {title()}
        </Text>
      ) : (
        <Text class="flex-1 text-xs text-muted-foreground" style={{ numberOfLines: 1 }}>
          {title()}
        </Text>
      )}
      <Icon name="chevron-down" size={12} color={token('muted-foreground')} />
    </Button>
  )

  if (props.disabled) return <View class={props.class ?? 'w-full'}>{trigger}</View>

  return (
    // 宽度类必须挂在外层 View 上：把 `class` 直接给 `Menu` 会让它的宿主塌成 0 宽，
    // 触发器整块不显示（实测）。
    <View class={props.class ?? 'w-full'}>
      <Menu
        placement="bottom"
        align="start"
        offset={4}
        popupClass="rounded-md border border-border bg-popover p-1 shadow-lg"
        trigger={trigger}
      >
        {props.items.map((item) => (
          <MenuItem
            class={
              'h-7 min-w-[120px] cursor-pointer flex-row items-center rounded px-2 transition ' +
              (item.value === props.value ? 'bg-accent' : 'hover:bg-accent')
            }
            accessibilityLabel={item.title}
            onSelect={() => {
              touchActivity()
              props.onChange(item.value)
            }}
          >
            <Text
              class={
                item.value === props.value
                  ? 'text-xs font-medium text-accent-foreground'
                  : 'text-xs text-popover-foreground'
              }
            >
              {item.title}
            </Text>
          </MenuItem>
        ))}
      </Menu>
    </View>
  )
}

export function SwitchField(props: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
  /** 开关紧贴文案左侧（默认开关在行尾右侧）。 */
  leading?: boolean
}) {
  const cursorClass = props.disabled ? 'cursor-not-allowed' : 'cursor-pointer'
  const control = (
    <Switch
      checked={props.checked}
      onChange={(event) => {
        touchActivity()
        props.onChange(event.checked)
      }}
      disabled={props.disabled}
      accessibilityLabel={props.label}
      trackClass={`h-5 w-9 flex-row items-center justify-start rounded-full bg-muted p-0.5 transition checked:bg-primary ${cursorClass}`}
      thumbClass="h-4 w-4 rounded-full bg-background checked:translate-x-4"
    />
  )
  const press = props.disabled
    ? undefined
    : () => {
        touchActivity()
        props.onChange(!props.checked)
      }
  if (props.leading) {
    // 开关 + 标题一行；说明另起一行，左缘与开关对齐。
    return (
      <View class={`gap-1.5 py-1.5 ${props.disabled ? '' : 'cursor-pointer'}`} onPress={press}>
        <View class="flex-row items-center gap-2.5">
          {control}
          <Text class="text-xs text-foreground">{props.label}</Text>
        </View>
        {props.hint ? <Text class="text-[11px] text-muted-foreground">{props.hint}</Text> : null}
      </View>
    )
  }
  return (
    <View
      class={`flex-row items-center justify-between gap-2 py-1.5 ${props.disabled ? '' : 'cursor-pointer'}`}
      onPress={press}
    >
      <View class="flex-1 gap-0.5">
        <Text class="text-xs text-foreground">{props.label}</Text>
        {props.hint ? <Text class="text-[11px] text-muted-foreground">{props.hint}</Text> : null}
      </View>
      {control}
    </View>
  )
}

export function Chip(props: {
  label: string
  onPress?: () => void
  active?: boolean
  class?: string
}) {
  return (
    <View
      class={
        'flex-row items-center gap-1 rounded-full px-2 py-0.5 ' +
        (props.active ? 'bg-primary text-primary-foreground ' : 'bg-muted text-muted-foreground ') +
        (props.onPress ? 'cursor-pointer transition hover:bg-accent active:opacity-70 ' : '') +
        (props.class ?? '')
      }
      onPress={props.onPress}
      role={props.onPress ? 'button' : undefined}
    >
      <Text
        class={
          props.active
            ? 'text-[11px] font-medium text-primary-foreground'
            : 'text-[11px] font-medium text-muted-foreground'
        }
      >
        {props.label}
      </Text>
    </View>
  )
}

export function EmptyState(props: {
  icon: IconName
  title: string
  hint?: string
  action?: JSX.Element
}) {
  return (
    <View class="flex-1 items-center justify-center gap-2 p-6">
      <View class="h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Icon name={props.icon} size={18} color={token('muted-foreground')} />
      </View>
      <Text class="text-center text-sm font-medium text-foreground">{props.title}</Text>
      {props.hint ? (
        <Text class="max-w-sm text-center text-[11px] text-muted-foreground">{props.hint}</Text>
      ) : null}
      {props.action}
    </View>
  )
}

export function Divider() {
  return <View class="h-px w-full bg-border" />
}

export function Badge(props: {
  label: string
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
}) {
  const tone = props.tone ?? 'neutral'
  const classes =
    tone === 'success'
      ? 'bg-success/10 text-success'
      : tone === 'warning'
        ? 'bg-warning/10 text-warning'
        : tone === 'danger'
          ? 'bg-destructive/10 text-destructive'
          : 'bg-muted text-muted-foreground'
  return (
    <View class={`rounded-full px-2 py-0.5 ${classes}`}>
      <Text class={`text-[11px] font-medium ${classes}`}>{props.label}</Text>
    </View>
  )
}

/** 设置页卡片：白色 surface + 细边框 + 12px 圆角，内容间距统一。 */
export function SettingsCard(props: { children: JSX.Element; class?: string }) {
  return (
    <View class={`gap-3 rounded-xl border border-border bg-card p-5 ${props.class ?? ''}`}>
      {props.children}
    </View>
  )
}

/** 卡片头：左侧品牌色图标块 + 标题/说明。 */
export function CardHeader(props: { icon: IconName; title: string; hint?: string }) {
  return (
    <View class="flex-row items-start gap-2.5">
      <View class="h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon name={props.icon} size={16} color={token('primary')} />
      </View>
      <View class="flex-1 gap-0.5 pt-0.5">
        <Text class="text-sm font-semibold text-foreground">{props.title}</Text>
        {props.hint ? <Text class="text-[11px] text-muted-foreground">{props.hint}</Text> : null}
      </View>
    </View>
  )
}

/** 警示条：降低安全性的选项必须配完整、醒目的风险说明。 */
export function WarningBanner(props: { text: string }) {
  return (
    <View class="flex-row items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
      <Icon name="alert-triangle" size={14} color={token('warning')} class="mt-0.5 shrink-0" />
      <Text class="flex-1 text-[11px] text-warning">{props.text}</Text>
    </View>
  )
}

export function Spinner(props: { label?: string }) {
  return (
    <View class="flex-row items-center gap-2">
      <Text class="text-xs text-muted-foreground">{props.label ?? '…'}</Text>
    </View>
  )
}

/** 弹窗内容框：只负责尺寸与最大高度。
 *  拖动功能已移除（原 mouse 事件实现不稳定、易卡住）。
 *
 *  这里同时挂一份 `ToastHost`：桌面端 `Dialog` 是**独立原生窗口层**，主界面
 *  里的 Overlay 永远盖不住它的遮罩，所以提示条必须跟着弹窗一起抬上去
 *  （`Overlay` 会自动挂到最近的 Dialog 根视图）。弹窗打开时主界面那份由
 *  `modalOpen` 隐藏，避免同一句提示出现两次。 */
export function ModalFrame(props: { class?: string; maxHeight?: number; children: JSX.Element }) {
  return (
    <View class={props.class} style={{ maxHeight: props.maxHeight }}>
      {props.children}
      <ToastHost />
    </View>
  )
}

/** 页面进入时的淡入：切换解锁页 / 主界面时不再硬切。
 *
 *  首帧必须停在起点、下一帧再切到终点，声明式的 `transition` 才会补间；
 *  组件函数体只执行一次（Solid 语义），所以起点由 signal 决定、在挂载后的
 *  第一帧里翻过来。 */
export function FadeIn(props: { children: JSX.Element; duration?: number }) {
  const shown = signal(false)
  const duration = props.duration ?? 200

  effect(() => {
    const frame = requestAnimationFrame(() => shown.set(true))
    cleanup(() => cancelAnimationFrame(frame))
  })

  return (
    <View
      class="flex-1"
      style={{
        opacity: shown() ? 1 : 0,
        transitionProperty: 'opacity',
        transitionDuration: duration,
        transitionTimingFunction: 'ease-out',
      }}
    >
      {props.children}
    </View>
  )
}
