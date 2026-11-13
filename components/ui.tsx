import { Text, token, View } from 'nsh'
import type { JSX } from 'nsh'
import { Button, Input, Select, Switch, type SelectItem } from 'nsh/base'

import { touchActivity } from '../lib/state'

import { Icon, type IconName } from './Icon'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_CLASS: Record<ButtonVariant, string> = {
  primary:
    'h-9 flex-row items-center justify-center gap-2 rounded-md bg-primary px-3.5 text-primary-foreground ' +
    'hover:opacity-90 active:opacity-75 disabled:opacity-45',
  secondary:
    'h-9 flex-row items-center justify-center gap-2 rounded-md border border-border bg-card px-3.5 ' +
    'text-foreground hover:bg-accent active:opacity-75 disabled:opacity-45',
  ghost:
    'h-9 flex-row items-center justify-center gap-2 rounded-md px-3 text-foreground ' +
    'hover:bg-accent active:opacity-75 disabled:opacity-45',
  danger:
    'h-9 flex-row items-center justify-center gap-2 rounded-md bg-destructive px-3.5 ' +
    'text-white hover:opacity-90 active:opacity-75 disabled:opacity-45',
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
      <View class="flex-row items-center justify-center gap-2">
        {props.icon ? (
          <Icon
            name={props.icon}
            size={16}
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
                ? 'text-sm font-medium text-primary-foreground'
                : variant === 'danger'
                  ? 'text-sm font-medium text-white'
                  : 'text-sm font-medium text-foreground'
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
        'h-8 w-8 items-center justify-center rounded-md ' +
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
      tooltip={props.label}
    >
      <Icon
        name={props.icon}
        size={props.size ?? 18}
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
    <View class={`gap-1.5 ${props.class ?? ''}`}>
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
        'w-full rounded-md border border-input bg-background px-3 text-sm text-foreground ' +
        'placeholder:text-muted-foreground focus:border-ring ' +
        (props.multiline ? 'py-2 ' : 'h-9 ') +
        (props.class ?? '')
      }
      style={props.style}
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
      itemClass="rounded px-2.5 py-1.5 text-sm text-popover-foreground focus:bg-accent focus:text-accent-foreground selected:bg-accent selected:text-accent-foreground"
      trigger={
        <View
          class={
            'h-9 w-full flex-row items-center justify-between gap-2 rounded-md border border-input ' +
            'bg-background px-3 ' +
            (props.disabled ? 'opacity-45' : 'hover:bg-accent')
          }
        >
          <Text class={props.value ? 'text-sm text-foreground' : 'text-sm text-muted-foreground'}>
            {selectedTitle}
          </Text>
          <Icon name="chevron-down" size={14} color={token('muted-foreground')} />
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
    <View class="flex-row items-center justify-between gap-3 py-2">
      <View class="flex-1 gap-0.5">
        <Text class="text-sm text-foreground">{props.label}</Text>
        {props.hint ? <Text class="text-xs text-muted-foreground">{props.hint}</Text> : null}
      </View>
      <Switch
        checked={props.checked}
        onChange={(event) => {
          touchActivity()
          props.onChange(event.checked)
        }}
        disabled={props.disabled}
        accessibilityLabel={props.label}
        trackClass="h-5 w-9 rounded-full border border-input bg-muted checked:bg-primary"
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
    <View class="flex-1 items-center justify-center gap-3 p-8">
      <View class="h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icon name={props.icon} size={22} color={token('muted-foreground')} />
      </View>
      <Text class="text-center text-base font-medium text-foreground">{props.title}</Text>
      {props.hint ? (
        <Text class="max-w-md text-center text-sm text-muted-foreground">{props.hint}</Text>
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
      {props.hint ? <Text class="text-xs text-muted-foreground">{props.hint}</Text> : null}
    </View>
  )
}

export function Spinner(props: { label?: string }) {
  return (
    <View class="flex-row items-center gap-2">
      <Text class="text-sm text-muted-foreground">{props.label ?? '…'}</Text>
    </View>
  )
}
