import { effect, Scroll, signal, Text, token, View, windowSize } from 'nsh'
import { Dialog, NumberInput, Tab, Tabs, TextView } from 'nsh/base'
import { t } from 'nsh/i18n'

import { errorText } from '../lib/errors'
import { categoryEmoji } from '../lib/category-icons'
import { categories, confirm, entryEditor, presets, saveEntry } from '../lib/state'
import type { EntryEditorState, EntryInput, Preset } from '../lib/types'
import { splitTags } from '../lib/format'
import * as native from '../lib/native'
import { Icon } from './Icon'
import {
  ActionButton,
  Field,
  IconButton,
  SelectField,
  Spinner,
  SwitchField,
  PasswordField,
  TextField,
  MODAL_BACKDROP_CLASS,
  MODAL_CLASS,
  ModalFrame,
} from './ui'

function emptyForm(categoryId: string | null): EntryInput {
  return {
    categoryId,
    title: '',
    url: null,
    username: '',
    password: '',
    email: '',
    phone: '',
    notes: '',
    favorite: false,
    tags: [],
  }
}

function formKey(form: EntryInput, tagsText: string): string {
  return JSON.stringify({ ...form, tags: splitTags(tagsText) })
}

function presetItems(type: string): { value: string; title: string }[] {
  return presets()
    .filter((preset: Preset) => preset.fieldType === type)
    .map((preset) => ({ value: preset.id, title: preset.label }))
}

function applyPreset(
  type: string,
  value: string | null,
  form: { update: (fn: (current: EntryInput) => EntryInput) => void },
) {
  if (!value) return
  const preset = presets().find((item) => item.id === value)
  if (!preset) return
  form.update((current) => {
    if (type === 'username') return { ...current, username: preset.value }
    if (type === 'email') return { ...current, email: preset.value }
    if (type === 'phone') return { ...current, phone: preset.value }
    if (type === 'password') return { ...current, password: preset.value }
    return current
  })
}

export function EntryEditor(props: { state: EntryEditorState }) {
  const form = signal<EntryInput>(emptyForm(props.state.categoryId))
  const tagsText = signal('')
  const original = signal('')
  const loading = signal(props.state.id !== null)
  const busy = signal(false)
  const error = signal('')
  const tab = signal<'edit' | 'preview'>('edit')
  const generatorOpen = signal(false)
  const generated = signal('')
  const generatorError = signal('')
  const generator = signal({
    length: 16,
    uppercase: true,
    lowercase: true,
    digits: true,
    symbols: true,
    excludeAmbiguous: false,
  })

  effect(() => {
    const id = props.state.id
    if (!id) {
      const initial = emptyForm(props.state.categoryId)
      form.set(initial)
      tagsText.set('')
      original.set(formKey(initial, ''))
      loading.set(false)
      return
    }
    loading.set(true)
    try {
      const entry = native.getEntry(id)
      const next: EntryInput = {
        categoryId: entry.categoryId ?? null,
        title: entry.title,
        url: entry.url ?? null,
        username: entry.username,
        password: entry.password,
        email: entry.email,
        phone: entry.phone,
        notes: entry.notes,
        favorite: entry.favorite,
        tags: entry.tags,
      }
      form.set(next)
      tagsText.set(entry.tags.join(', '))
      original.set(formKey(next, entry.tags.join(', ')))
    } catch (cause) {
      error.set(errorText(cause))
    } finally {
      loading.set(false)
    }
  })

  const dirty = () => formKey(form(), tagsText()) !== original()

  function requestClose() {
    if (busy()) return
    if (dirty()) {
      confirm.set({
        title: t('entry.discard'),
        message: t('entry.discardHint'),
        confirmLabel: t('entry.discard'),
        destructive: true,
        onConfirm: () => entryEditor.set(null),
      })
      return
    }
    entryEditor.set(null)
  }

  async function save() {
    if (busy()) return
    error.set('')
    const current = form()
    if (!current.title.trim()) {
      error.set(t('entry.titleRequired'))
      return
    }
    busy.set(true)
    try {
      const input: EntryInput = {
        ...current,
        title: current.title.trim(),
        url: current.url?.trim() ? current.url.trim() : null,
        tags: splitTags(tagsText()),
      }
      await saveEntry(input, props.state.id)
      entryEditor.set(null)
    } catch (cause) {
      error.set(errorText(cause))
    } finally {
      busy.set(false)
    }
  }

  async function generate() {
    generatorError.set('')
    try {
      generated.set(await native.generatePassword(generator()))
    } catch (cause) {
      generatorError.set(errorText(cause))
    }
  }

  function useGenerated() {
    if (!generated()) return
    form.update((current) => ({ ...current, password: generated() }))
    generatorOpen.set(false)
  }

  const categoryItems = [
    { value: '', title: t('entry.uncategorized') },
    ...categories().map((category) => ({
      value: category.id,
      title: `${categoryEmoji(category.icon)} ${category.name}`,
    })),
  ]

  const body = (
    <View class="gap-3">
      <View class="flex-row items-start gap-3">
        <View class="flex-1 gap-1">
          <Text class="text-sm font-semibold text-foreground">
            {props.state.id ? t('entry.dialogEdit') : t('entry.dialogCreate')}
          </Text>
          <Text class="text-xs text-muted-foreground">{t('entry.formHint')}</Text>
        </View>
        <IconButton icon="close" label={t('common.close')} onPress={requestClose} />
      </View>

      <If when={loading()}>
        <View class="items-center justify-center py-10">
          <Spinner label={t('common.loading')} />
        </View>
      </If>

      <If when={!loading()}>
        <View class="gap-3">
          <Field label={t('entry.title')}>
            <TextField
              value={form().title}
              onChange={(value) => form.update((current) => ({ ...current, title: value }))}
              placeholder={t('entry.titlePlaceholder')}
              maxLength={120}
              autoFocus
              accessibilityLabel={t('entry.title')}
            />
          </Field>

          <Field label={t('entry.category')}>
            <SelectField
              items={categoryItems}
              value={form().categoryId ?? null}
              onChange={(value) =>
                form.update((current) => ({
                  ...current,
                  categoryId: value ? value : null,
                }))
              }
              placeholder={t('entry.uncategorized')}
            />
          </Field>

          <View class="flex-row gap-3">
            <View class="flex-1">
              <Field label={t('entry.username')}>
                <TextField
                  value={form().username}
                  onChange={(value) => form.update((current) => ({ ...current, username: value }))}
                  autoComplete="username"
                  accessibilityLabel={t('entry.username')}
                />
              </Field>
            </View>
            <If when={presetItems('username').length > 0}>
              <View class="w-24 self-end">
                <SelectField
                  items={presetItems('username')}
                  value={null}
                  onChange={(value) => applyPreset('username', value, form)}
                  placeholder={t('preset.choose')}
                />
              </View>
            </If>
          </View>

          <View class="flex-row gap-3">
            <View class="flex-1">
              <Field label={t('entry.password')}>
                <View class="flex-row items-center gap-1.5">
                  <PasswordField
                    value={form().password}
                    onChange={(value) =>
                      form.update((current) => ({ ...current, password: value }))
                    }
                    placeholder={t('entry.password')}
                    autoComplete="new-password"
                    accessibilityLabel={t('entry.password')}
                    class="flex-1"
                  />
                  <IconButton
                    icon="sparkles"
                    label={t('generator.open')}
                    active={generatorOpen()}
                    onPress={() => {
                      generatorOpen.update((value) => !value)
                      if (generatorOpen() && !generated()) void generate()
                    }}
                  />
                </View>
              </Field>
            </View>
            <If when={presetItems('password').length > 0}>
              <View class="w-24 self-end">
                <SelectField
                  items={presetItems('password')}
                  value={null}
                  onChange={(value) => applyPreset('password', value, form)}
                  placeholder={t('preset.choose')}
                />
              </View>
            </If>
          </View>

          <If when={generatorOpen()}>
            <View class="gap-3 rounded-lg border border-border bg-muted/40 p-3">
              <View class="flex-row items-center justify-between gap-3">
                <Text class="text-xs font-medium text-muted-foreground">
                  {t('generator.length')}
                </Text>
                <View class="flex-row items-center gap-2">
                  <Text class="text-xs text-muted-foreground">{String(generator().length)}</Text>
                  <NumberInput
                    value={generator().length}
                    min={6}
                    max={64}
                    onChange={(event) => {
                      const value = event.value
                      if (value === null) return
                      generator.update((current) => ({ ...current, length: value }))
                    }}
                    class="w-24"
                  />
                </View>
              </View>
              <View class="flex-row flex-wrap gap-x-6">
                <View class="w-[45%]">
                  <SwitchField
                    label={t('generator.uppercase')}
                    checked={generator().uppercase}
                    onChange={(checked) =>
                      generator.update((current) => ({ ...current, uppercase: checked }))
                    }
                  />
                </View>
                <View class="w-[45%]">
                  <SwitchField
                    label={t('generator.lowercase')}
                    checked={generator().lowercase}
                    onChange={(checked) =>
                      generator.update((current) => ({ ...current, lowercase: checked }))
                    }
                  />
                </View>
                <View class="w-[45%]">
                  <SwitchField
                    label={t('generator.digits')}
                    checked={generator().digits}
                    onChange={(checked) =>
                      generator.update((current) => ({ ...current, digits: checked }))
                    }
                  />
                </View>
                <View class="w-[45%]">
                  <SwitchField
                    label={t('generator.symbols')}
                    checked={generator().symbols}
                    onChange={(checked) =>
                      generator.update((current) => ({ ...current, symbols: checked }))
                    }
                  />
                </View>
              </View>
              <SwitchField
                label={t('generator.excludeAmbiguous')}
                checked={generator().excludeAmbiguous}
                onChange={(checked) =>
                  generator.update((current) => ({
                    ...current,
                    excludeAmbiguous: checked,
                  }))
                }
              />
              <View class="flex-row items-center gap-2">
                <View class="flex-1 rounded-md border border-border bg-background px-3 py-2">
                  <Text class="text-xs font-mono text-foreground">
                    {generated() || t('generator.placeholder')}
                  </Text>
                </View>
                <ActionButton
                  label={t('generator.regenerate')}
                  icon="refresh"
                  onPress={() => void generate()}
                />
                <ActionButton
                  label={t('generator.fill')}
                  icon="check"
                  variant="primary"
                  onPress={useGenerated}
                />
              </View>
              <If when={generatorError()}>
                <Text class="text-xs text-destructive">{generatorError()}</Text>
              </If>
            </View>
          </If>

          <View class="flex-row gap-3">
            <View class="flex-1">
              <Field label={t('entry.email')}>
                <TextField
                  value={form().email}
                  onChange={(value) => form.update((current) => ({ ...current, email: value }))}
                  autoComplete="email"
                  accessibilityLabel={t('entry.email')}
                />
              </Field>
            </View>
            <If when={presetItems('email').length > 0}>
              <View class="w-24 self-end">
                <SelectField
                  items={presetItems('email')}
                  value={null}
                  onChange={(value) => applyPreset('email', value, form)}
                  placeholder={t('preset.choose')}
                />
              </View>
            </If>
          </View>

          <View class="flex-row gap-3">
            <View class="flex-1">
              <Field label={t('entry.phone')}>
                <TextField
                  value={form().phone}
                  onChange={(value) => form.update((current) => ({ ...current, phone: value }))}
                  autoComplete="tel"
                  accessibilityLabel={t('entry.phone')}
                />
              </Field>
            </View>
            <If when={presetItems('phone').length > 0}>
              <View class="w-24 self-end">
                <SelectField
                  items={presetItems('phone')}
                  value={null}
                  onChange={(value) => applyPreset('phone', value, form)}
                  placeholder={t('preset.choose')}
                />
              </View>
            </If>
          </View>

          <Field label={t('entry.url')}>
            <TextField
              value={form().url ?? ''}
              onChange={(value) =>
                form.update((current) => ({
                  ...current,
                  url: value.trim() ? value : null,
                }))
              }
              placeholder="https://"
              autoComplete="url"
              accessibilityLabel={t('entry.url')}
            />
          </Field>

          <Field label={t('entry.tags')} hint={t('entry.tagsPlaceholder')}>
            <TextField
              value={tagsText()}
              onChange={tagsText.set}
              placeholder={t('entry.tagsPlaceholder')}
              accessibilityLabel={t('entry.tags')}
            />
          </Field>

          <View class="gap-2">
            <View class="flex-row items-center justify-between">
              <Text class="text-xs font-medium text-muted-foreground">{t('entry.notes')}</Text>
              <Tabs class="flex-row gap-1 rounded-md bg-muted p-0.5">
                <Tab
                  selected={tab() === 'edit'}
                  onPress={() => tab.set('edit')}
                  class="rounded px-2.5 py-1 selected:bg-card"
                >
                  <Text class="text-xs text-foreground">{t('entry.notesEdit')}</Text>
                </Tab>
                <Tab
                  selected={tab() === 'preview'}
                  onPress={() => tab.set('preview')}
                  class="rounded px-2.5 py-1 selected:bg-card"
                >
                  <Text class="text-xs text-foreground">{t('entry.notesPreview')}</Text>
                </Tab>
              </Tabs>
            </View>
            <If when={tab() === 'edit'}>
              <TextField
                value={form().notes}
                onChange={(value) => form.update((current) => ({ ...current, notes: value }))}
                multiline
                placeholder={t('entry.notesPlaceholder')}
                accessibilityLabel={t('entry.notes')}
                style={{ height: 180 }}
              />
            </If>
            <If when={tab() === 'preview'}>
              <View
                class="rounded-md border border-input bg-background p-3"
                style={{ height: 180 }}
              >
                <Scroll class="flex-1">
                  <If when={form().notes.trim().length > 0}>
                    <TextView markdown={form().notes} selectable class="text-xs text-foreground" />
                  </If>
                  <If when={form().notes.trim().length === 0}>
                    <Text class="text-xs text-muted-foreground">{t('entry.noNotes')}</Text>
                  </If>
                </Scroll>
              </View>
            </If>
          </View>

          <SwitchField
            label={t('entry.star')}
            hint={t('entry.starredHint')}
            checked={form().favorite}
            onChange={(checked) => form.update((current) => ({ ...current, favorite: checked }))}
          />

          <If when={error()}>
            <View class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
              <Text class="text-xs text-destructive">{error()}</Text>
            </View>
          </If>

          <View class="flex-row justify-end gap-2 pt-1">
            <ActionButton label={t('common.cancel')} variant="ghost" onPress={requestClose} />
            <ActionButton
              label={t('common.save')}
              variant="primary"
              icon="check"
              disabled={busy()}
              onPress={() => void save()}
            />
          </View>
        </View>
      </If>
    </View>
  )

  return (
    <Dialog
      open={true}
      closeOnBackdropPress={false}
      closeOnEscape={false}
      animation="fade"
      accessibilityLabel={props.state.id ? t('entry.dialogEdit') : t('entry.dialogCreate')}
      class={MODAL_CLASS}
      backdropClass={MODAL_BACKDROP_CLASS}
      style={{ width: 760, maxWidth: '94%' }}
    >
      <ModalFrame
        class="overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        maxHeight={Math.max(360, windowSize().height - 72)}
      >
        <Scroll style={{ maxHeight: Math.max(360, windowSize().height - 72) }} contentClass="p-4">
          {body}
        </Scroll>
      </ModalFrame>
    </Dialog>
  )
}
