import { signal, Text, token, View } from 'nsh'
import type { JSX } from 'nsh'
import { Button, Input, Select, Switch, Tooltip, type SelectItem } from 'nsh/base'

import { touchActivity } from '../lib/state'

import { Icon, type IconName } from './Icon'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_CLASS: Record<ButtonVariant, string> = {
  primary:
    'h-8 flex-row items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 text-primary-foreground ' +
    'hover:opacity-90 active:opacity-75 disabled:opacity-45',
  secondary:
    'h-8 flex-row items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 ' +
    'text-foreground hover:bg-accent active:opacity-75 disabled:opacity-45',
  ghost:
    'h-8 flex-row items-center justify-center gap-1.5 rounded-md px-2.5 text-foreground ' +
    'hover:bg-accent active:opacity-75 disabled:opacity-45',
  danger:
    'h-8 flex-row items-center justify-center gap-1.5 rounded-md bg-destructive px-2.5 ' +
    'text-white hover:opacity-90 active:opacity-75 disabled:opacity-45',
}

/** nsh 的 `Dialog` 在桌面把 popup 放在透明层的左上角，且默认没有遮罩视图。
 *  所有弹窗统一加这两个类：popup 居中 + 半透明遮罩。 */
export const MODAL_CLASS = 'm-auto'
export const MODAL_BACKDROP_CLASS = 'bg-black/50'

/** `Input` 的文字样式显式走内联 style。
 *  nsh 0.5.0 的 Input 对 `text-foreground` 这类 token 颜色类解析不可靠：
 *  值能写入、提交也有效，但输入的文字渲染不出来（占位符却正常）。
 *  `style` 优先于 `class`，`token()` 是响应式的，主题切换会重算颜色。 */
function inputTextStyle() {
  return {
    color: token('foreground'),
    fontSize: 12,
    placeholderColor: token('muted-foreground'),
    caretColor: token('foreground'),
  }
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
      class={`${BUTTON_CLASS[variant]} ${props.class ?? ''}`}
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
}) {
  return (
    <Button
      testID={props.testID}
      class={
        'h-7 w-7 items-center justify-center rounded-md ' +
        (props.active
          ? 'bg-accent text-foreground '
          : 'text-muted-foreground hover:bg-accent hover:text-foreground ') +
        'active:opacity-70 disabled:opacity-35 ' +
        (props.class ?? '')
      }
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
        color={token(props.active ? 'foreground' : 'muted-foreground')}
      />
    </Button>
  )
}

export function Field(props: {
  label: string
  hint?: string
  children: JSX.Element
  class?: string
}) {
  return (
    <View class={`gap-1 ${props.class ?? ''}`}>
      <Text class="text-xs font-medium text-muted-foreground">{props.label}</Text>
      {props.children}
      {props.hint ? <Text class="text-[11px] text-muted-foreground">{props.hint}</Text> : null}
    </View>
  )
}

export function TextField(props: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  masked?: boolean
  multiline?: boolean
  autoFocus?: boolean
  maxLength?: number
  onSubmit?: () => void
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
      placeholder={props.placeholder}
      masked={props.masked}
      multiline={props.multiline}
      autoFocus={props.autoFocus}
      maxLength={props.maxLength}
      readonly={props.disabled}
      accessibilityLabel={props.accessibilityLabel}
      // The generated types narrow autoComplete to a union; the app only uses
      // standard values and the native side ignores unknown ones.
      autoComplete={props.autoComplete as never}
      onPressDown={undefined}
      onSubmit={props.onSubmit ? () => props.onSubmit?.() : undefined}
      class={
        'w-full rounded-md border border-input bg-background px-2.5 text-xs ' +
        'focus:border-ring ' +
        (props.multiline ? 'py-1.5 ' : 'h-8 ') +
        (props.class ?? '')
      }
      style={{ ...inputTextStyle(), ...props.style }}
    />
  )
}

export function SelectField(props: {
  items: SelectItem[]
  value: string | null
  onChange: (value: string | null) => void
  placeholder?: string
  cleanable?: boolean
  disabled?: boolean
  class?: string
}) {
  const selectedTitle =
    props.items.find((item) => item.value === props.value)?.title ?? props.placeholder ?? ''
  return (
    <Select
      items={props.items}
      value={props.value}
      onChange={(event) => {
        touchActivity()
        props.onChange(event.value)
      }}
      placeholder={props.placeholder}
      cleanable={props.cleanable}
      disabled={props.disabled}
      class={props.class}
      popupClass="rounded-md border border-border bg-popover p-1 shadow-lg"
      listClass="max-h-72"
      itemClass="rounded px-2 py-1 text-xs text-popover-foreground focus:bg-accent focus:text-accent-foreground selected:bg-accent selected:text-accent-foreground"
      trigger={
        <View
          class={
            'h-8 w-full flex-row items-center justify-between gap-2 rounded-md border border-input ' +
            'bg-background px-2.5 ' +
            (props.disabled ? 'opacity-45' : 'hover:bg-accent')
          }
        >
          <Text class={props.value ? 'text-xs text-foreground' : 'text-xs text-muted-foreground'}>
            {selectedTitle}
          </Text>
          <Icon name="chevron-down" size={12} color={token('muted-foreground')} />
        </View>
      }
    />
  )
}

export function SwitchField(props: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  return (
    <View class="flex-row items-center justify-between gap-2 py-1.5">
      <View class="flex-1 gap-0.5">
        <Text class="text-xs text-foreground">{props.label}</Text>
        {props.hint ? <Text class="text-[11px] text-muted-foreground">{props.hint}</Text> : null}
      </View>
      <Switch
        checked={props.checked}
        onChange={(event) => {
          touchActivity()
          props.onChange(event.checked)
        }}
        disabled={props.disabled}
        accessibilityLabel={props.label}
        trackClass="h-4 w-7 rounded-full border border-input bg-muted checked:bg-primary"
        thumbClass="h-3 w-3 rounded-full bg-background checked:translate-x-3"
      />
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
        (props.onPress ? 'hover:bg-accent active:opacity-70 ' : '') +
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

export function SectionTitle(props: { title: string; hint?: string }) {
  return (
    <View class="gap-0.5">
      <Text class="text-sm font-semibold text-foreground">{props.title}</Text>
      {props.hint ? <Text class="text-[11px] text-muted-foreground">{props.hint}</Text> : null}
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

/** 弹窗内容框：在 `Dialog` 居中之外再提供「按住标题栏拖动」。
 *  nsh 的 Dialog 没有 draggable，鼠标事件只在视图内上报，所以把
 *  按下/移动/松开都绑在整个弹窗上，用 `pagePosition` 计算位移；
 *  指针离开弹窗即结束拖动，避免快速拖动后卡住。 */
const DRAG_ZONE_HEIGHT = 44
const DRAG_LIMIT = 400

export function ModalFrame(props: { class?: string; maxHeight?: number; children: JSX.Element }) {
  const offsetX = signal(0)
  const offsetY = signal(0)
  const origin = signal<{ pageX: number; pageY: number; x: number; y: number } | null>(null)

  const clamp = (value: number) => Math.max(-DRAG_LIMIT, Math.min(DRAG_LIMIT, value))

  return (
    <View
      class={props.class}
      style={{
        translate: `${offsetX()}px ${offsetY()}px`,
        maxHeight: props.maxHeight,
      }}
      onPressDown={(event) => {
        if (event.position.y <= DRAG_ZONE_HEIGHT) {
          origin.set({
            pageX: event.pagePosition.x,
            pageY: event.pagePosition.y,
            x: offsetX(),
            y: offsetY(),
          })
        }
      }}
      onMouseMove={(event) => {
        const start = origin()
        if (!start || !event.pressedButton) return
        offsetX.set(clamp(start.x + event.pagePosition.x - start.pageX))
        offsetY.set(clamp(start.y + event.pagePosition.y - start.pageY))
      }}
      onMouseUp={() => origin.set(null)}
      onMouseLeave={() => origin.set(null)}
    >
      {props.children}
    </View>
  )
}
