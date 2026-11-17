import { effect, Scroll, signal, Text, View, windowSize } from 'nsh'
import { Dialog, Tab, Tabs, TextView } from 'nsh/base'
import { t } from 'nsh/i18n'

import { errorText } from '../lib/errors'
import { categoryEmoji } from '../lib/category-icons'
import { categories, confirm, entryEditor, presets, saveEntry } from '../lib/state'
import type { EntryEditorState, EntryInput } from '../lib/types'
import { splitTags } from '../lib/format'
import * as native from '../lib/native'
import { Icon } from './Icon'
import { GeneratorDialog } from './GeneratorDialog'
import { PresetPicker } from './PresetPicker'
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
            <If when={presets().some((preset) => preset.fieldType === 'username')}>
              <View class="w-40 self-end">
                <PresetPicker type="username" onPick={(id) => applyPreset('username', id, form)} />
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
                    onPress={() => generatorOpen.set(true)}
                  />
                </View>
              </Field>
            </View>
            <If when={presets().some((preset) => preset.fieldType === 'password')}>
              <View class="w-40 self-end">
                <PresetPicker type="password" onPick={(id) => applyPreset('password', id, form)} />
              </View>
            </If>
          </View>

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
            <If when={presets().some((preset) => preset.fieldType === 'email')}>
              <View class="w-40 self-end">
                <PresetPicker type="email" onPick={(id) => applyPreset('email', id, form)} />
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
            <If when={presets().some((preset) => preset.fieldType === 'phone')}>
              <View class="w-40 self-end">
                <PresetPicker type="phone" onPick={(id) => applyPreset('phone', id, form)} />
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
              {/* 固定高度 + 裁剪的容器：把滚动尺寸测量挡在这一层，避免多行 Input
                  在聚焦/切换 Tab 后把自身内容高度报给外层 Scroll 而撑大弹窗；
                  文本滚动仍由 nsh 多行 Input 自己负责（单一滚动所有者）。 */}
              <View class="overflow-hidden" style={{ height: 180 }}>
                <TextField
                  value={form().notes}
                  onChange={(value) => form.update((current) => ({ ...current, notes: value }))}
                  multiline
                  placeholder={t('entry.notesPlaceholder')}
                  accessibilityLabel={t('entry.notes')}
                  class="h-full"
                  style={{
                    paddingTop: 10,
                    paddingBottom: 10,
                    paddingLeft: 12,
                    paddingRight: 12,
                  }}
                />
              </View>
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
    <>
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
      <GeneratorDialog
        open={generatorOpen()}
        onClose={() => generatorOpen.set(false)}
        onUse={(password) => form.update((current) => ({ ...current, password }))}
      />
    </>
  )
}
