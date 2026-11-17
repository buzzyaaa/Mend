import { Scroll, signal, Text, token, View, windowSize } from 'nsh'
import { Dialog, Tab, Tabs } from 'nsh/base'
import { t } from 'nsh/i18n'

import {
  confirm,
  movePreset,
  presets,
  presetsOpen,
  removePreset,
  savePreset,
} from '../lib/state'
import type { Preset, PresetInput } from '../lib/types'
import { Icon } from './Icon'
import {
  ActionButton,
  EmptyState,
  IconButton,
  TextField,
  MODAL_BACKDROP_CLASS,
  MODAL_CLASS,
  ModalFrame,
} from './ui'

const TYPES = ['username', 'email', 'phone', 'password'] as const
type PresetType = (typeof TYPES)[number]

function typeLabel(type: string): string {
  return t(`preset.types.${type}`)
}

/** 值在前面且必填，说明在后面且选填；点击任一字段就地编辑，失焦/回车/保存按钮提交。
 *  只提交被改的字段，说明可以清空。 */
function PresetRow(props: {
  preset: Preset
  index: number
  total: number
  onInvalid: () => void
}) {
  const editing = signal<'value' | 'label' | null>(null)
  const draft = signal('')
  const busy = signal(false)

  function begin(field: 'value' | 'label') {
    if (busy()) return
    draft.set(field === 'value' ? props.preset.value : props.preset.label)
    editing.set(field)
  }

  async function commit() {
    const field = editing()
    if (!field || busy()) return
    const next = draft().trim()
    const current = props.preset
    const original = field === 'value' ? current.value : current.label
    editing.set(null)
    if (field === 'value' && !next) {
      props.onInvalid()
      return
    }
    if (next === original) return

    const input: PresetInput = {
      fieldType: current.fieldType,
      label: field === 'label' ? next : current.label,
      value: field === 'value' ? next : current.value,
    }
    busy.set(true)
    try {
      await savePreset(input, current.id)
    } finally {
      busy.set(false)
    }
  }

  function fieldView(field: 'value' | 'label') {
    return (
      <If
        when={editing() === field}
        else={
          <View
            class="flex h-7 min-w-0 flex-1 items-center rounded px-1.5 hover:bg-accent/60 active:opacity-70"
            onPress={() => begin(field)}
          >
            <Text
              class={
                field === 'value'
                  ? 'text-xs font-medium text-foreground'
                  : 'text-xs text-muted-foreground'
              }
              style={{ numberOfLines: 1 }}
            >
              {field === 'value'
                ? props.preset.value
                : props.preset.label.trim() || '—'}
            </Text>
          </View>
        }
      >
        <TextField
          value={draft()}
          onChange={draft.set}
          onBlur={() => void commit()}
          onSubmit={() => void commit()}
          autoFocus
          maxLength={field === 'value' ? 512 : 40}
          accessibilityLabel={field === 'value' ? t('preset.value') : t('preset.label')}
          class="h-7 border-primary bg-background px-1.5"
        />
      </If>
    )
  }

  return (
    <View class="flex-row items-center gap-1.5 rounded-lg border border-border bg-background px-1.5 py-1">
      <View class="flex min-w-0 flex-row items-center" style={{ flex: 3 }}>
        {fieldView('value')}
      </View>
      <View class="flex min-w-0 flex-row items-center" style={{ flex: 2 }}>
        {fieldView('label')}
      </View>
      <IconButton
        icon="check"
        label={t('common.save')}
        size={14}
        class="h-7 w-7"
        disabled={!editing() || busy()}
        onPress={() => void commit()}
      />
      <IconButton
        icon="arrow-up"
        label={t('entry.moveUp')}
        size={14}
        class="h-7 w-7"
        disabled={props.index === 0 || busy()}
        onPress={() => void movePreset(props.preset, -1)}
      />
      <IconButton
        icon="arrow-down"
        label={t('entry.moveDown')}
        size={14}
        class="h-7 w-7"
        disabled={props.index === props.total - 1 || busy()}
        onPress={() => void movePreset(props.preset, 1)}
      />
      <IconButton
        icon="trash"
        label={t('common.delete')}
        size={14}
        class="h-7 w-7"
        onPress={() =>
          confirm.set({
            title: t('preset.edit'),
            message: t('preset.deleteConfirm'),
            confirmLabel: t('common.delete'),
            destructive: true,
            onConfirm: () => void removePreset(props.preset.id),
          })
        }
      />
    </View>
  )
}

export function PresetsDialog() {
  const activeType = signal<PresetType>('username')
  const label = signal('')
  const value = signal('')
  const error = signal('')
  const busy = signal(false)

  const forType = (type: string) => presets().filter((preset) => preset.fieldType === type)

  function resetForm() {
    label.set('')
    value.set('')
    error.set('')
  }

  async function submit() {
    if (busy()) return
    const trimmedValue = value().trim()
    const trimmedLabel = label().trim()
    if (!trimmedValue) {
      error.set(t('preset.invalid'))
      return
    }
    busy.set(true)
    try {
      const input: PresetInput = {
        fieldType: activeType(),
        label: trimmedLabel,
        value: trimmedValue,
      }
      const result = await savePreset(input, null)
      if (result) resetForm()
    } finally {
      busy.set(false)
    }
  }

  return (
    <Dialog
      open={presetsOpen()}
      closeOnBackdropPress={false}
      onOpenChange={(event) => {
        if (!event.open) presetsOpen.set(false)
      }}
      onCancel={() => presetsOpen.set(false)}
      accessibilityLabel={t('preset.title')}
      class={MODAL_CLASS}
      backdropClass={MODAL_BACKDROP_CLASS}
      style={{ width: 720, maxWidth: '94%' }}
    >
      <ModalFrame
        class="gap-3 overflow-hidden rounded-xl border border-border bg-card p-4 shadow-xl"
        maxHeight={Math.max(340, windowSize().height - 80)}
      >
        <View class="flex-row items-start gap-3">
          <View class="flex-1 gap-0.5">
            <Text class="text-sm font-semibold text-foreground">{t('preset.title')}</Text>
            <Text class="text-xs text-muted-foreground">{t('preset.hint')}</Text>
          </View>
          <IconButton
            icon="close"
            label={t('common.close')}
            testID="presets-close"
            onPress={() => presetsOpen.set(false)}
          />
        </View>

        {/* 新增表单置顶：一行 [值（必填）][说明（选填）][新增]，新增到当前选中的类型 */}
        <View class="gap-1.5 rounded-lg border border-border bg-muted/40 p-2.5">
          <View class="flex-row items-center gap-2">
            <View class="flex min-w-0 flex-1 flex-row items-center">
              <TextField
                value={value()}
                onChange={value.set}
                placeholder={t('preset.valuePlaceholder')}
                maxLength={512}
                accessibilityLabel={t('preset.value')}
                onSubmit={() => void submit()}
                class="h-8"
              />
            </View>
            <View class="flex min-w-0 flex-1 flex-row items-center">
              <TextField
                value={label()}
                onChange={label.set}
                placeholder={t('preset.labelPlaceholder')}
                maxLength={40}
                accessibilityLabel={t('preset.label')}
                onSubmit={() => void submit()}
                class="h-8"
              />
            </View>
            <ActionButton
              label={t('preset.addFor', { type: typeLabel(activeType()) })}
              variant="primary"
              icon="plus"
              disabled={busy()}
              onPress={() => void submit()}
            />
          </View>
          <If when={error()}>
            <Text class="text-xs text-destructive">{error()}</Text>
          </If>
        </View>

        <Tabs class="flex-row gap-1 rounded-lg bg-muted p-1">
          <Each of={TYPES} key={(type) => type}>
            {(type) => (
              <Tab
                selected={activeType() === type()}
                onPress={() => {
                  activeType.set(type())
                  resetForm()
                }}
                class="flex-1 items-center rounded-md px-2.5 py-1.5 selected:bg-card"
              >
                <Text class="text-xs text-foreground">
                  {`${typeLabel(type())} (${forType(type()).length})`}
                </Text>
              </Tab>
            )}
          </Each>
        </Tabs>

        <Scroll class="min-h-[160px] max-h-[260px]" contentClass="gap-1.5">
          <If when={forType(activeType()).length === 0}>
            <EmptyState icon="clipboard-list" title={t('preset.empty')} />
          </If>
          <Each of={forType(activeType())} key={(preset) => preset.id}>
            {(preset, index) => (
              <PresetRow
                preset={preset()}
                index={index()}
                total={forType(activeType()).length}
                onInvalid={() => error.set(t('preset.invalid'))}
              />
            )}
          </Each>
        </Scroll>

        <View class="flex-row justify-end">
          <ActionButton
            label={t('common.close')}
            variant="secondary"
            onPress={() => presetsOpen.set(false)}
          />
        </View>
      </ModalFrame>
    </Dialog>
  )
}
