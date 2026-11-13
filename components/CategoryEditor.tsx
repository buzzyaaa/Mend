import { effect, signal, Text, token, View, windowSize } from 'nsh'
import { Dialog } from 'nsh/base'
import { t } from 'nsh/i18n'

import { errorText } from '../lib/errors'
import { categories, categoryEditor, confirm, removeCategory, saveCategory } from '../lib/state'
import { CATEGORY_COLORS, CATEGORY_ICON_OPTIONS, categoryEmoji } from '../lib/category-icons'
import type { CategoryInput } from '../lib/types'
import { Icon } from './Icon'
import { ActionButton, Field, IconButton, TextField } from './ui'

function validHex(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const body = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
  if (body.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(body)) return null
  return `#${body.toUpperCase()}`
}

export function CategoryEditor(props: { state: { id: string | null } }) {
  const name = signal('')
  const color = signal<string | null>(null)
  const icon = signal<string | null>(null)
  const colorText = signal('')
  const error = signal('')
  const busy = signal(false)
  const editing = () => props.state.id !== null

  effect(() => {
    if (!props.state.id) {
      name.set('')
      color.set(null)
      icon.set(null)
      colorText.set('')
      return
    }
    const category = categories().find((item) => item.id === props.state.id)
    if (!category) return
    name.set(category.name)
    color.set(category.color ?? null)
    icon.set(category.icon ?? null)
    colorText.set(category.color ?? '')
  })

  async function submit() {
    if (busy()) return
    const trimmed = name().trim()
    if (!trimmed) {
      error.set(t('sidebar.nameRequired'))
      return
    }
    if (colorText().trim() && !validHex(colorText())) {
      error.set(t('category.colorHint'))
      return
    }
    busy.set(true)
    try {
      const input: CategoryInput = {
        name: trimmed,
        color: validHex(colorText()),
        icon: icon(),
      }
      const result = await saveCategory(input, props.state.id)
      if (result) categoryEditor.set(null)
    } catch (cause) {
      error.set(errorText(cause))
    } finally {
      busy.set(false)
    }
  }

  function chooseColor(value: string | null) {
    color.set(value)
    colorText.set(value ?? '')
  }

  return (
    <Dialog
      open={true}
      closeOnBackdropPress={false}
      closeOnEscape={false}
      animation="fade"
      accessibilityLabel={editing() ? t('sidebar.rename') : t('nav.addCategory')}
      style={{ width: 540, maxWidth: '94%' }}
    >
      <View
        class="gap-4 overflow-hidden rounded-xl border border-border bg-card p-5 shadow-xl"
        style={{ maxHeight: Math.max(320, windowSize().height - 80) }}
      >
        <View class="flex-row items-start gap-3">
          <View class="flex-1 gap-0.5">
            <Text class="text-lg font-semibold text-foreground">
              {editing() ? t('sidebar.rename') : t('nav.addCategory')}
            </Text>
            <Text class="text-xs text-muted-foreground">{t('category.hint')}</Text>
          </View>
          <IconButton
            icon="close"
            label={t('common.close')}
            onPress={() => categoryEditor.set(null)}
          />
        </View>

        <View class="gap-3">
          <Field label={t('sidebar.nameLabel')}>
            <TextField
              value={name()}
              onChange={name.set}
              placeholder={t('sidebar.namePlaceholder')}
              maxLength={40}
              autoFocus
              accessibilityLabel={t('sidebar.nameLabel')}
            />
          </Field>

          <Field label={t('category.color')} hint={t('category.colorHint')}>
            <View class="flex-row flex-wrap items-center gap-2">
              <View
                class={
                  'h-7 w-7 items-center justify-center rounded-full border ' +
                  (color() === null ? 'border-ring bg-muted' : 'border-border bg-card')
                }
                onPress={() => chooseColor(null)}
                role="button"
                accessibilityLabel={t('category.noColor')}
              >
                <Icon name="close" size={12} color={token('muted-foreground')} />
              </View>
              <Each of={CATEGORY_COLORS} key={(value) => value}>
                {(value) => (
                  <View
                    class={
                      'h-7 w-7 items-center justify-center rounded-full border ' +
                      (color() === value() ? 'border-ring' : 'border-transparent')
                    }
                    style={{ backgroundColor: value() }}
                    onPress={() => chooseColor(value())}
                    role="button"
                    accessibilityLabel={value()}
                  >
                    <If when={color() === value()}>
                      <Icon name="check" size={12} color="#ffffff" />
                    </If>
                  </View>
                )}
              </Each>
              <View class="w-24">
                <TextField
                  value={colorText()}
                  onChange={colorText.set}
                  placeholder="#RRGGBB"
                  maxLength={7}
                  accessibilityLabel={t('category.color')}
                />
              </View>
            </View>
          </Field>

          <Field label={t('category.icon')}>
            <View class="flex-row flex-wrap gap-1.5">
              <View
                class={
                  'h-9 w-9 items-center justify-center rounded-md border text-lg ' +
                  (icon() === null
                    ? 'border-ring bg-accent'
                    : 'border-border bg-background hover:bg-accent')
                }
                onPress={() => icon.set(null)}
                role="button"
                accessibilityLabel={t('category.noIcon')}
              >
                <Text class="text-base">{categoryEmoji(null)}</Text>
              </View>
              <Each of={CATEGORY_ICON_OPTIONS} key={(option) => option.id}>
                {(option) => (
                  <View
                    class={
                      'h-9 w-9 items-center justify-center rounded-md border text-lg ' +
                      (icon() === option().id
                        ? 'border-ring bg-accent'
                        : 'border-border bg-background hover:bg-accent')
                    }
                    onPress={() => icon.set(option().id)}
                    role="button"
                    accessibilityLabel={option().id}
                  >
                    <Text class="text-base">{option().emoji}</Text>
                  </View>
                )}
              </Each>
            </View>
          </Field>

          <If when={error()}>
            <View class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
              <Text class="text-sm text-destructive">{error()}</Text>
            </View>
          </If>

          <View class="flex-row items-center justify-between gap-2 pt-1">
            <If when={editing()}>
              <ActionButton
                label={t('sidebar.delete')}
                icon="trash"
                variant="ghost"
                onPress={() =>
                  confirm.set({
                    title: t('sidebar.delete'),
                    message: t('sidebar.deleteConfirm'),
                    confirmLabel: t('common.delete'),
                    destructive: true,
                    onConfirm: () => {
                      categoryEditor.set(null)
                      void removeCategory(props.state.id as string)
                    },
                  })
                }
              />
            </If>
            <View class="flex-1" />
            <ActionButton
              label={t('common.cancel')}
              variant="ghost"
              onPress={() => categoryEditor.set(null)}
            />
            <ActionButton
              label={t('common.save')}
              variant="primary"
              icon="check"
              disabled={busy()}
              onPress={() => void submit()}
            />
          </View>
        </View>
      </View>
    </Dialog>
  )
}
