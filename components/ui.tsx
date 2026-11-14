import { computed, signal, Text, token, View } from 'nsh'
import type { JSX } from 'nsh'
import { Button, Input, Switch, Tooltip, type SelectItem } from 'nsh/base'

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

/** 输入框文字与背景的着色约定（实测于 nsh 0.5.0 / Windows）：
 *
 *  - 文字色必须走 `class` 里的 `text-foreground`／`placeholder:text-muted-foreground`，
 *    写进 `style.color` 只作用于外层容器、够不到内部文本框；
 *  - 值文本的**字形绘制**在 0.5.0 的 Windows 宿主上有缺陷（布局与光标位置正确、
 *    字形不上屏，占位符正常），属于引擎问题，已在 nsh 0.5.1 修复（#1978）；
 *    应用侧不改写组件、也不叠加浮层，等引擎版本跟上即可。 */
const INPUT_CLASS =
  'w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs ' +
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
      class={`${INPUT_CLASS} ${props.class ?? ''}`}
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
      class={`${INPUT_CLASS} ${props.class ?? ''}`}
      style={{ fontSize: 12 }}
    />
  )
}

/** 下拉选择：**自带列表**，展开在触发器下方（不再用 `nsh/base` 的 `Select`）。
 *
 *  两个实测坑（nsh 0.5.0 / Windows）：
 *  1. `Select` 的列表是独立弹出层，放进 `Dialog`（本身也是弹出层）后永远弹不出来，
 *     这就是「选择分类没有用」；改成组件内自渲染后弹窗内外都能用。
 *  2. 组件函数体只执行一次（Solid 语义），`const title = ...props.value` 这类
 *     语句不会跟着 props 更新，必须放进 `computed()` 或 JSX 表达式里。 */
export function SelectField(props: {
  items: SelectItem[]
  value: string | null
  onChange: (value: string | null) => void
  placeholder?: string
  cleanable?: boolean
  disabled?: boolean
  class?: string
}) {
  const open = signal(false)
  const title = computed(
    () => props.items.find((item) => item.value === props.value)?.title ?? props.placeholder ?? '',
  )
  const hasValue = computed(() => props.value !== null && props.value !== '')
  return (
    <View class={`w-full gap-1 ${props.class ?? ''}`}>
      <View
        class={
          'h-8 w-full flex-row items-center justify-between gap-2 rounded-md border border-input ' +
          'bg-background px-2.5 ' +
          (props.disabled ? 'opacity-45' : open() ? 'bg-accent' : 'hover:bg-accent')
        }
        onPress={
          props.disabled
            ? undefined
            : () => {
                touchActivity()
                open.update((current: boolean) => !current)
              }
        }
        role="button"
        accessibilityLabel={title()}
      >
        {hasValue() ? (
          <Text class="text-xs text-foreground">{title()}</Text>
        ) : (
          <Text class="text-xs text-muted-foreground">{title()}</Text>
        )}
        <Icon name="chevron-down" size={12} color={token('muted-foreground')} />
      </View>
      {open() ? (
        <View class="w-full overflow-hidden rounded-md border border-border bg-popover p-1">
          <View class="gap-0.5">
            {props.items.map((item) => (
              <Button
                class={
                  'h-7 w-full flex-row items-center justify-start rounded px-2 ' +
                  (item.value === props.value ? 'bg-accent' : 'hover:bg-accent active:opacity-70')
                }
                onPress={() => {
                  touchActivity()
                  props.onChange(item.value)
                  open.set(false)
                }}
                accessibilityLabel={item.title}
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
              </Button>
            ))}
          </View>
        </View>
      ) : null}
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
