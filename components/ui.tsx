import { computed, Text, token, View } from 'nsh'
import type { JSX } from 'nsh'
import { Button, Input, Menu, MenuItem, Switch, Tooltip, type SelectItem } from 'nsh/base'

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
  /** 图标色，不传时按 `active` 走主题色（星标这类有状态的图标用它上色）。 */
  iconColor?: string
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
        color={props.iconColor ?? token(props.active ? 'foreground' : 'muted-foreground')}
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
        'bg-background px-2.5 ' +
        (props.disabled ? 'opacity-45' : 'hover:bg-accent')
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
              'h-7 min-w-[120px] flex-row items-center rounded px-2 ' +
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
}) {
  return (
    <View
      class="flex-row items-center justify-between gap-2 py-1.5"
      onPress={
        props.disabled
          ? undefined
          : () => {
              touchActivity()
              props.onChange(!props.checked)
            }
      }
    >
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
        trackClass="h-5 w-9 flex-row items-center justify-start rounded-full bg-muted p-0.5 checked:bg-primary"
        thumbClass="h-4 w-4 rounded-full bg-background checked:translate-x-4"
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

/** 弹窗内容框：只负责尺寸与最大高度。
 *  拖动功能已移除（原 mouse 事件实现不稳定、易卡住）。 */
export function ModalFrame(props: { class?: string; maxHeight?: number; children: JSX.Element }) {
  return (
    <View class={props.class} style={{ maxHeight: props.maxHeight }}>
      {props.children}
    </View>
  )
}
