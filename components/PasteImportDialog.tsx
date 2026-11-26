import { computed, effect, Scroll, signal, Text, token, View, windowSize } from 'nsh'
import { Checkbox, Dialog } from 'nsh/base'
import { t } from 'nsh/i18n'

import { categoryEmoji } from '../lib/category-icons'
import { errorText } from '../lib/errors'
import * as native from '../lib/native'
import { parsePastedEntries, toEntryInput } from '../lib/paste-import'
import type { PasteEntry, PasteFormat } from '../lib/paste-import'
import {
  categories,
  pasteImportOpen,
  refreshCategories,
  refreshEntries,
  tags,
  toast,
} from '../lib/state'
import { Icon } from './Icon'
import {
  ActionButton,
  Field,
  IconButton,
  MODAL_BACKDROP_CLASS,
  MODAL_CLASS,
  ModalFrame,
  SelectField,
  TextField,
} from './ui'

const FORMAT_KEYS: Record<PasteFormat, string> = {
  table: 'pasteImport.formatTable',
  csv: 'pasteImport.formatCsv',
  keyvalue: 'pasteImport.formatKeyValue',
  delimited: 'pasteImport.formatDelimited',
  lines: 'pasteImport.formatLines',
}

/** 本地粘贴导入：粘贴文本 → 本地解析 → 预览/微调 → 走原生接口加密入库。
 *
 *  全程不联网、不把明文交给任何外部程序；弹窗内的明文草稿只存在于内存，
 *  关闭或锁定后随组件卸载。标签只取库内已定义的名字，分类按名称匹配。 */
export function PasteImportDialog() {
  const raw = signal('')
  const drafts = signal<PasteEntry[]>([])
  const selected = signal<Set<number>>(new Set())
  const parsed = signal(false)
  const format = signal<PasteFormat>('lines')
  const skipped = signal(0)
  const categoryId = signal<string | null>(null)
  const editingIndex = signal<number | null>(null)
  const editing = signal<PasteEntry | null>(null)
  const busy = signal(false)
  const error = signal('')
  const selectedCount = computed(() => selected().size)

  // 关闭 / 锁定 / 切库时立即丢掉内存里的明文草稿，不留在挂载着的组件里。
  effect(() => {
    if (!pasteImportOpen()) clearAll()
  })

  const categoryItems = () => [
    { value: '', title: t('entry.uncategorized') },
    ...categories().map((category) => ({
      value: category.id,
      title: `${categoryEmoji(category.icon)} ${category.name}`,
    })),
  ]

  function clearAll() {
    raw.set('')
    drafts.set([])
    selected.set(new Set())
    parsed.set(false)
    skipped.set(0)
    editing.set(null)
    editingIndex.set(null)
    error.set('')
  }

  function close() {
    if (busy()) return
    pasteImportOpen.set(false)
  }

  function parse() {
    const result = parsePastedEntries(raw())
    drafts.set(result.entries)
    selected.set(new Set(result.entries.map((_, index) => index)))
    format.set(result.format)
    skipped.set(result.skipped)
    parsed.set(true)
    editing.set(null)
    editingIndex.set(null)
    error.set(result.entries.length === 0 ? t('pasteImport.noEntries') : '')
  }

  function toggle(index: number) {
    const next = new Set(selected())
    if (next.has(index)) next.delete(index)
    else next.add(index)
    selected.set(next)
  }

  function selectAll(yes: boolean) {
    selected.set(yes ? new Set(drafts().map((_, index) => index)) : new Set())
  }

  function remove(index: number) {
    drafts.update((list) => list.filter((_, i) => i !== index))
    const next = new Set<number>()
    selected().forEach((i) => {
      if (i < index) next.add(i)
      else if (i > index) next.add(i - 1)
    })
    selected.set(next)
    const current = editingIndex()
    if (current === index) {
      editing.set(null)
      editingIndex.set(null)
    } else if (current !== null && current > index) {
      editingIndex.set(current - 1)
    }
  }

  function startEdit(index: number) {
    const draft = drafts()[index]
    if (!draft) return
    editingIndex.set(index)
    editing.set({ ...draft, tags: [...draft.tags] })
  }

  function finishEdit() {
    const index = editingIndex()
    const draft = editing()
    if (index === null || !draft) return
    drafts.update((list) => list.map((item, i) => (i === index ? draft : item)))
    editing.set(null)
    editingIndex.set(null)
  }

  function setEditField(
    field: 'title' | 'username' | 'password' | 'email' | 'phone' | 'notes' | 'tags',
    value: string,
  ) {
    editing.update((current) => {
      if (!current) return current
      if (field === 'tags') {
        return {
          ...current,
          tags: value
            .split(/[,，;；]/)
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0 && tag.length <= 32)
            .slice(0, 8),
        }
      }
      return { ...current, [field]: value }
    })
  }

  function importSelected() {
    if (busy()) return
    const list = drafts().filter((_, index) => selected().has(index))
    if (list.length === 0) {
      error.set(t('pasteImport.noneSelected'))
      return
    }
    busy.set(true)
    error.set('')
    try {
      const defined = tags().map((tag) => tag.name)
      for (const draft of list) {
        native.createEntry(toEntryInput(draft, categoryId(), defined))
      }
      refreshCategories()
      refreshEntries()
      toast(t('pasteImport.imported', { count: list.length }))
      pasteImportOpen.set(false)
    } catch (cause) {
      // 已写入的条目不回滚：明确告诉用户可能部分成功，避免重试造成重复条目。
      error.set(`${t('pasteImport.partialFailure')} ${errorText(cause)}`)
    } finally {
      busy.set(false)
    }
  }

  const body = (
    <View class="gap-3">
      <View class="flex-row items-start gap-3">
        <View class="flex-1 gap-1">
          <Text class="text-sm font-semibold text-foreground">{t('pasteImport.title')}</Text>
          <Text class="text-xs text-muted-foreground">{t('pasteImport.localOnly')}</Text>
        </View>
        <IconButton icon="close" label={t('common.close')} onPress={close} />
      </View>

      <Field label={t('pasteImport.input')} hint={t('pasteImport.inputHint')}>
        <View class="overflow-hidden rounded-md border border-input bg-background">
          <TextField
            value={raw()}
            onChange={(value) => raw.set(value)}
            multiline
            placeholder={t('pasteImport.placeholder')}
            accessibilityLabel={t('pasteImport.input')}
            class="w-full"
            style={{
              height: 150,
              paddingTop: 10,
              paddingBottom: 10,
              paddingLeft: 12,
              paddingRight: 12,
            }}
          />
        </View>
      </Field>

      <View class="flex-row items-center gap-2">
        <ActionButton
          label={t('pasteImport.parse')}
          icon="clipboard-list"
          variant="primary"
          onPress={parse}
          disabled={raw().trim().length === 0 || busy()}
        />
        <ActionButton label={t('pasteImport.clear')} variant="ghost" onPress={clearAll} disabled={busy()} />
        <If when={parsed()}>
          <Text class="flex-1 text-right text-xs text-muted-foreground">
            {t('pasteImport.parsed', { count: drafts().length, format: t(FORMAT_KEYS[format()]) })}
          </Text>
        </If>
      </View>

      <If when={parsed() && drafts().length > 0}>
        <View class="gap-2 rounded-md border border-border bg-background p-3">
          <View class="flex-row items-center gap-2">
            <Checkbox
              checked={selectedCount() === drafts().length}
              indeterminate={selectedCount() > 0 && selectedCount() < drafts().length}
              onChange={() => selectAll(selectedCount() !== drafts().length)}
              accessibilityLabel={t('pasteImport.selectAll')}
              indicatorClass="h-4 w-4 items-center justify-center rounded border border-input bg-background transition hover:border-primary checked:border-primary checked:bg-primary"
              indicator={<Icon name="check" size={11} color={token('primary-foreground')} />}
            />
            <Text class="flex-1 text-xs text-muted-foreground">{t('pasteImport.selectAll')}</Text>
            <Text class="text-xs text-muted-foreground">
              {t('pasteImport.selectedCount', { count: selectedCount() })}
            </Text>
          </View>

          <Scroll style={{ maxHeight: 260 }} class="gap-1">
            {drafts().map((draft, index) => (
              <View
                class="flex-row items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5"
                style={{ opacity: selected().has(index) ? 1 : 0.55 }}
              >
                <Checkbox
                  checked={selected().has(index)}
                  onChange={() => toggle(index)}
                  accessibilityLabel={draft.title}
                  indicatorClass="h-4 w-4 items-center justify-center rounded border border-input bg-background transition hover:border-primary checked:border-primary checked:bg-primary"
                  indicator={<Icon name="check" size={11} color={token('primary-foreground')} />}
                />
                <View class="flex-1 gap-0.5">
                  <Text class="text-xs font-medium text-foreground" style={{ numberOfLines: 1 }}>
                    {draft.title}
                  </Text>
                  <Text class="text-[11px] text-muted-foreground" style={{ numberOfLines: 1 }}>
                    {[
                      draft.username || draft.email || t('entry.notSet'),
                      draft.password ? '••••' : t('entry.notSet'),
                      draft.url ?? '',
                    ]
                      .filter((part) => part !== '')
                      .join(' · ')}
                  </Text>
                </View>
                <IconButton
                  icon="edit"
                  label={t('common.edit')}
                  onPress={() => startEdit(index)}
                  disabled={editingIndex() === index}
                />
                <IconButton
                  icon="trash"
                  label={t('common.delete')}
                  tone="destructive"
                  onPress={() => remove(index)}
                />
              </View>
            ))}
          </Scroll>

          <If when={skipped() > 0}>
            <Text class="text-[11px] text-muted-foreground">
              {t('pasteImport.skipped', { count: skipped() })}
            </Text>
          </If>

          <If when={editing()}>
            <View class="gap-2 rounded-md border border-primary/30 bg-background p-3">
              <View class="flex-row items-center justify-between">
                <Text class="text-xs font-medium text-foreground">{t('pasteImport.editDraft')}</Text>
                <IconButton icon="close" label={t('common.close')} onPress={() => editing.set(null)} />
              </View>
              <View class="flex-row gap-2">
                <View class="flex-1">
                  <Field label={t('entry.title')}>
                    <TextField
                      value={editing()?.title ?? ''}
                      onChange={(value) => setEditField('title', value)}
                      accessibilityLabel={t('entry.title')}
                    />
                  </Field>
                </View>
                <View class="flex-1">
                  <Field label={t('entry.username')}>
                    <TextField
                      value={editing()?.username ?? ''}
                      onChange={(value) => setEditField('username', value)}
                      accessibilityLabel={t('entry.username')}
                    />
                  </Field>
                </View>
              </View>
              <Field label={t('entry.password')}>
                <TextField
                  value={editing()?.password ?? ''}
                  onChange={(value) => setEditField('password', value)}
                  accessibilityLabel={t('entry.password')}
                />
              </Field>
              <View class="flex-row gap-2">
                <View class="flex-1">
                  <Field label={t('entry.email')}>
                    <TextField
                      value={editing()?.email ?? ''}
                      onChange={(value) => setEditField('email', value)}
                      accessibilityLabel={t('entry.email')}
                    />
                  </Field>
                </View>
                <View class="flex-1">
                  <Field label={t('entry.phone')}>
                    <TextField
                      value={editing()?.phone ?? ''}
                      onChange={(value) => setEditField('phone', value)}
                      accessibilityLabel={t('entry.phone')}
                    />
                  </Field>
                </View>
              </View>
              <Field label={t('entry.url')}>
                <TextField
                  value={editing()?.url ?? ''}
                  onChange={(value) =>
                    editing.update((current) =>
                      current ? { ...current, url: value.trim() ? value : null } : current,
                    )
                  }
                  accessibilityLabel={t('entry.url')}
                />
              </Field>
              <Field label={t('entry.tags')} hint={t('pasteImport.tagsHint')}>
                <TextField
                  value={editing()?.tags.join(', ') ?? ''}
                  onChange={(value) => setEditField('tags', value)}
                  accessibilityLabel={t('entry.tags')}
                />
              </Field>
              <Field label={t('entry.notes')}>
                <TextField
                  value={editing()?.notes ?? ''}
                  onChange={(value) => setEditField('notes', value)}
                  multiline
                  style={{ height: 72, paddingTop: 8, paddingLeft: 10 }}
                  accessibilityLabel={t('entry.notes')}
                />
              </Field>
              <View class="flex-row justify-end">
                <ActionButton label={t('pasteImport.editDone')} variant="secondary" onPress={finishEdit} />
              </View>
            </View>
          </If>

          <Field label={t('entry.category')} hint={t('pasteImport.categoryHint')}>
            <SelectField
              items={categoryItems()}
              value={categoryId()}
              onChange={(value) => categoryId.set(value ? value : null)}
              placeholder={t('entry.uncategorized')}
            />
          </Field>
        </View>
      </If>

      <If when={error()}>
        <View class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
          <Text class="text-xs text-destructive">{error()}</Text>
        </View>
      </If>

      <View class="flex-row justify-end gap-2 pt-1">
        <ActionButton label={t('common.cancel')} variant="ghost" onPress={close} disabled={busy()} />
        <ActionButton
          label={t('pasteImport.import', { count: selectedCount() })}
          variant="primary"
          icon="check"
          disabled={!parsed() || selectedCount() === 0 || busy()}
          onPress={importSelected}
        />
      </View>
    </View>
  )

  return (
    <Dialog
      open={pasteImportOpen()}
      closeOnBackdropPress={false}
      closeOnEscape={false}
      animation="fade"
      accessibilityLabel={t('pasteImport.title')}
      class={MODAL_CLASS}
      backdropClass={MODAL_BACKDROP_CLASS}
      style={{ width: 720, maxWidth: '94%' }}
    >
      <ModalFrame
        class="overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        maxHeight={Math.max(400, windowSize().height - 72)}
      >
        <Scroll style={{ maxHeight: Math.max(400, windowSize().height - 72) }} contentClass="p-4">
          {body}
        </Scroll>
      </ModalFrame>
    </Dialog>
  )
}
