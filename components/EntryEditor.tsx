import { computed, effect, Scroll, signal, Text, token, View, windowSize } from 'nsh'
import { Dialog, Button, Menu, MenuItem, MenuSeparator, Tab, Tabs, TextView } from 'nsh/base'
import { t } from 'nsh/i18n'

import { errorText } from '../lib/errors'
import { categoryEmoji } from '../lib/category-icons'
import {
  categories,
  confirm,
  entryEditor,
  presets,
  saveEntry,
  tagColorOf,
  tags,
  touchActivity,
} from '../lib/state'
import type { EntryEditorState, EntryInput } from '../lib/types'
import * as native from '../lib/native'
import { Icon } from './Icon'
import { GeneratorDialog } from './GeneratorDialog'
import { PresetPicker } from './PresetPicker'
import { TagPill } from './TagPill'
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

function formKey(form: EntryInput): string {
  return JSON.stringify(form)
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
      original.set(formKey(initial))
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
      original.set(formKey(next))
    } catch (cause) {
      error.set(errorText(cause))
    } finally {
      loading.set(false)
    }
  })

  const dirty = () => formKey(form()) !== original()

  function toggleTag(tag: string) {
    touchActivity()
    form.update((current) => ({
      ...current,
      tags: current.tags.includes(tag)
        ? current.tags.filter((item) => item !== tag)
        : [...current.tags, tag],
    }))
  }

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

  /** 可选项：标签定义（按维护顺序）+ 条目上残留的未定义旧标签（兜底）。 */
  const tagChoices = computed(() => {
    const defined = tags().map((tag) => tag.name)
    const extra = form().tags.filter((name) => !defined.includes(name))
    return [...defined, ...extra]
  })

  /** 小的文字型触发按钮（无边框，靠 hover 底色提示可点），放在「星标」之后。 */
  const tagButton = (disabled: boolean) => (
    <Button
      class={
        'h-7 flex-row items-center gap-1.5 rounded-md px-2 ' +
        (disabled
          ? 'text-muted-foreground opacity-45'
          : 'text-muted-foreground hover:bg-accent active:opacity-70')
      }
      disabled={disabled}
      accessibilityLabel={t('entry.chooseTags')}
      testID="entry-tags-trigger"
    >
      <Icon name="tag" size={13} color={token('muted-foreground')} />
      <Text class="text-[11px] font-medium">
        {form().tags.length > 0
          ? `${t('entry.chooseTags')} (${form().tags.length})`
          : t('entry.chooseTags')}
      </Text>
      <Icon name="chevron-down" size={11} color={token('muted-foreground')} />
    </Button>
  )

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

          {/* 标签整块放在星标之后：标题 + 已选胶囊 + 说明，选择入口在下面左对齐。
              标签只能从标签维护弹窗里定义的集合中选，这里不提供新建/自由输入。 */}
          <Field
            label={t('entry.tags')}
            hint={tags().length > 0 ? t('entry.tagsSelectHint') : undefined}
          >
            <View class="gap-1.5">
              <If when={form().tags.length > 0}>
                <View class="flex-row flex-wrap items-center gap-1.5">
                  {form().tags.map((name) => (
                    <TagPill
                      label={name}
                      color={tagColorOf(name)}
                      accessibilityLabel={name}
                      class="ring-1 ring-border"
                      onPress={() => toggleTag(name)}
                    />
                  ))}
                </View>
              </If>
              <If when={form().tags.length === 0 && tags().length > 0}>
                <Text class="text-[11px] text-muted-foreground">{t('entry.noTagsSelected')}</Text>
              </If>
              <If when={tags().length === 0}>
                <View class="rounded-md border border-dashed border-border bg-muted/50 px-2.5 py-2">
                  <Text class="text-[11px] text-muted-foreground">{t('tag.noneHint')}</Text>
                </View>
              </If>
            </View>
          </Field>

          {/* 标签多选入口：星标之后、左对齐的小按钮，和「标签筛选」同一套菜单；
              菜单向上弹，避免贴到底部被裁掉。没有标签定义时按钮置灰。 */}
          <View class="flex-row justify-start">
            <If when={tags().length > 0} else={tagButton(true)}>
              <Menu
                placement="top"
                align="end"
                offset={6}
                popupClass="min-w-[220px] rounded-lg border border-border bg-popover p-1.5 shadow-lg"
                trigger={tagButton(false)}
              >
                <MenuItem
                  closeOnSelect={false}
                  disabled={form().tags.length === 0}
                  class="h-8 flex-row items-center gap-2 rounded px-2 hover:bg-accent"
                  accessibilityLabel={t('entry.clearTags')}
                  onSelect={() => {
                    touchActivity()
                    form.update((current) => ({ ...current, tags: [] }))
                  }}
                >
                  <View class="w-4 items-center justify-center">
                    <Icon name="close" size={13} color={token('muted-foreground')} />
                  </View>
                  <Text class="text-xs text-popover-foreground">{t('entry.clearTags')}</Text>
                </MenuItem>

                <MenuSeparator class="my-1 h-px bg-border" />

                {tagChoices().map((name) => (
                  <MenuItem
                    checked={form().tags.includes(name)}
                    closeOnSelect={false}
                    class={
                      'h-8 flex-row items-center gap-2 rounded px-2 ' +
                      (form().tags.includes(name) ? 'bg-accent' : 'hover:bg-accent')
                    }
                    indicatorClass="w-4 items-center justify-center opacity-0 checked:opacity-100"
                    indicator={<Icon name="check" size={12} color={token('primary')} />}
                    accessibilityLabel={name}
                    onSelect={() => toggleTag(name)}
                  >
                    <TagPill
                      label={name}
                      color={tagColorOf(name)}
                      class={form().tags.includes(name) ? 'ring-2 ring-primary' : 'opacity-90'}
                    />
                  </MenuItem>
                ))}
              </Menu>
            </If>
          </View>

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
