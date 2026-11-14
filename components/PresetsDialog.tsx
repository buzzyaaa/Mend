import { Scroll, signal, Text, View, windowSize } from 'nsh'
import { Dialog, Tab, Tabs } from 'nsh/base'
import { t } from 'nsh/i18n'

import { confirm, presets, presetsOpen, removePreset, savePreset } from '../lib/state'
import type { Preset, PresetInput } from '../lib/types'
import {
  ActionButton,
  EmptyState,
  Field,
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

export function PresetsDialog() {
  const activeType = signal<PresetType>('username')
  const editingId = signal<string | null>(null)
  const label = signal('')
  const value = signal('')
  const error = signal('')
  const busy = signal(false)

  const forType = (type: string) => presets().filter((preset) => preset.fieldType === type)

  function resetForm() {
    editingId.set(null)
    label.set('')
    value.set('')
    error.set('')
  }

  function startEdit(preset: Preset) {
    editingId.set(preset.id)
    label.set(preset.label)
    value.set(preset.value)
    error.set('')
  }

  async function submit() {
    if (busy()) return
    const trimmedLabel = label().trim()
    const trimmedValue = value().trim()
    if (!trimmedLabel || !trimmedValue) {
      error.set(t('preset.hint'))
      return
    }
    busy.set(true)
    try {
      const input: PresetInput = {
        fieldType: activeType(),
        label: trimmedLabel,
        value: trimmedValue,
      }
      const result = await savePreset(input, editingId())
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

        <Scroll class="min-h-[160px] max-h-[260px]" contentClass="gap-1">
          <If when={forType(activeType()).length === 0}>
            <EmptyState icon="key" title={t('preset.empty')} />
          </If>
          <Each of={forType(activeType())} key={(preset) => preset.id}>
            {(preset) => {
              const item = preset()
              return (
                <View class="flex-row items-center gap-3 rounded-md border border-border bg-background px-3 py-2">
                  <View class="flex-1 gap-0.5">
                    <Text class="text-xs font-medium text-foreground">{item.label}</Text>
                    <Text class="text-xs text-muted-foreground" style={{ numberOfLines: 1 }}>
                      {item.value}
                    </Text>
                  </View>
                  <IconButton
                    icon="edit"
                    label={t('preset.edit')}
                    onPress={() => startEdit(item)}
                  />
                  <IconButton
                    icon="trash"
                    label={t('common.delete')}
                    onPress={() =>
                      confirm.set({
                        title: t('preset.edit'),
                        message: t('preset.deleteConfirm'),
                        confirmLabel: t('common.delete'),
                        destructive: true,
                        onConfirm: () => void removePreset(item.id),
                      })
                    }
                  />
                </View>
              )
            }}
          </Each>
        </Scroll>

        <View class="gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <View class="flex-row items-center justify-between">
            <Text class="text-xs font-medium text-foreground">
              {editingId() ? t('preset.edit') : t('preset.add')}
            </Text>
            <View class="rounded-full bg-muted px-2 py-0.5">
              <Text class="text-[11px] text-muted-foreground">{typeLabel(activeType())}</Text>
            </View>
          </View>
          <View class="flex-row flex-wrap items-end gap-2">
            <View class="w-40">
              <Field label={t('preset.label')}>
                <TextField
                  value={label()}
                  onChange={label.set}
                  placeholder={t('preset.labelPlaceholder')}
                  maxLength={40}
                  accessibilityLabel={t('preset.label')}
                />
              </Field>
            </View>
            <View class="flex-1">
              <Field label={t('preset.value')}>
                <TextField
                  value={value()}
                  onChange={value.set}
                  placeholder={t('preset.value')}
                  accessibilityLabel={t('preset.value')}
                />
              </Field>
            </View>
            <View class="justify-end">
              <ActionButton
                label={editingId() ? t('common.save') : t('preset.add')}
                variant="primary"
                icon={editingId() ? 'check' : 'plus'}
                disabled={busy()}
                onPress={() => void submit()}
              />
            </View>
          </View>
          <If when={editingId()}>
            <View class="flex-row justify-end">
              <ActionButton label={t('common.cancel')} variant="ghost" onPress={resetForm} />
            </View>
          </If>
          <If when={error()}>
            <Text class="text-xs text-destructive">{error()}</Text>
          </If>
        </View>

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
