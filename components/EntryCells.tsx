import { Text, token, View } from 'nsh'
import { Checkbox } from 'nsh/base'
import { t } from 'nsh/i18n'

import { normalizeUrl, notesPreview } from '../lib/format'
import {
  canManualReorder,
  categories,
  confirm,
  copyEntryFull,
  copyField,
  deleteEntry,
  displayedEntries,
  entryEditor,
  entryFields,
  entryNotes,
  isArchiveView,
  isTrashView,
  moveEntry,
  notesEditor,
  openExternal,
  passwordVisible,
  purgeEntry,
  restoreEntry,
  selectedIds,
  tagColorOf,
  toggleFavorite,
  togglePasswordFor,
  toggleSelected,
  unarchiveEntry,
} from '../lib/state'
import type { Category, EntrySummary } from '../lib/types'
import { EntryIcon } from './EntryIcon'
import { Icon } from './Icon'
import { TagPill } from './TagPill'
import { fullTextTip, IconButton } from './ui'

/** 列表单元格一行最多放几个标签胶囊，多余的折叠为 `+N`（单行高度固定）。 */
export const LIST_TAG_LIMIT = 2
/** 备注在列表里显示的简写字数（Markdown 会被压成纯文本一行）。 */
export const NOTES_PREVIEW_CHARS = 28
/** 两行字段格低于这个列宽就不再显示「账号：」前缀，把宽度让给值本身。 */
export const FIELD_PAIR_COMPACT_WIDTH = 120

export function categoryOf(entry: EntrySummary): Category | undefined {
  return categories().find((category) => category.id === entry.categoryId)
}

/** 行选择框。DataTable 的单元格里带 onPress 的子视图不会触发行选择，正合适。 */
export function EntryCheckbox(props: { entry: () => EntrySummary }) {
  return (
    <View class="h-full cursor-pointer flex-row items-center justify-center">
      <Checkbox
        checked={selectedIds().has(props.entry().id)}
        onChange={() => toggleSelected(props.entry().id)}
        accessibilityLabel={props.entry().title}
        indicatorClass="h-4 w-4 items-center justify-center rounded border border-input bg-background transition hover:border-primary checked:border-primary checked:bg-primary"
        indicator={<Icon name="check" size={11} color={token('primary-foreground')} />}
      />
    </View>
  )
}

/** 表头全选框，与行选择框共用同一套外观。 */
export function SelectAllCheckbox(props: { onChange: () => void }) {
  return (
    <View class="h-full cursor-pointer flex-row items-center justify-center">
      <Checkbox
        checked={
          displayedEntries().length > 0 &&
          displayedEntries().every((entry) => selectedIds().has(entry.id))
        }
        indeterminate={
          displayedEntries().some((entry) => selectedIds().has(entry.id)) &&
          !(
            displayedEntries().length > 0 &&
            displayedEntries().every((entry) => selectedIds().has(entry.id))
          )
        }
        onChange={props.onChange}
        accessibilityLabel={t('entry.selectAll')}
        indicatorClass="h-4 w-4 items-center justify-center rounded border border-input bg-background transition hover:border-primary checked:border-primary checked:bg-primary indeterminate:border-primary indeterminate:bg-primary"
        indicator={<Icon name="check" size={11} color={token('primary-foreground')} />}
      />
    </View>
  )
}

/** 标题 + 标签共用一格：有标题时两行一起垂直居中，没标题时只剩标签也居中。
 *  entry 传 accessor 而不是快照，DataTable 的单元格会被回收给别的行。 */
export function EntryTitleCell(props: {
  entry: () => EntrySummary
  category?: () => Category | undefined
  card?: boolean
}) {
  const link = () => (props.entry().url?.trim() ? normalizeUrl(props.entry().url ?? '') : null)
  const limit = () => (props.card ? 4 : LIST_TAG_LIMIT)
  return (
    <View
      class="min-w-0 flex-row items-center gap-2"
      style={{ cursor: link() ? 'pointer' : undefined }}
      role={link() ? 'button' : undefined}
      onPress={link() ? () => void openExternal(props.entry().url ?? '') : undefined}
      accessibilityLabel={link() ? t('entry.openInBrowser') : undefined}
    >
      <EntryIcon entry={props.entry()} category={props.category?.() ?? categoryOf(props.entry())} />
      <View class="min-w-0 flex-1 flex-col justify-center gap-0.5">
        <If when={Boolean(props.entry().title)}>
          <Text
            class={
              'text-xs font-medium ' + (link() ? 'text-primary hover:underline' : 'text-foreground')
            }
            style={{ numberOfLines: 1 }}
            tooltip={fullTextTip(props.entry().title)}
          >
            {props.entry().title}
          </Text>
        </If>
        <View
          class="min-w-0 flex-row items-center gap-1 overflow-hidden"
          tooltip={
            props.entry().tags.length > 0 ? fullTextTip(props.entry().tags.join(', ')) : undefined
          }
        >
          {props.entry().tags.length > 0 ? (
            <>
              {props
                .entry()
                .tags.slice(0, limit())
                .map((tag) => (
                  <TagPill label={tag} color={tagColorOf(tag)} />
                ))}
              <If when={props.entry().tags.length > limit()}>
                <View class="shrink-0 rounded-full bg-muted px-1.5 py-0.5">
                  <Text
                    class="text-[10px] font-medium text-muted-foreground"
                    style={{ numberOfLines: 1 }}
                  >
                    {`+${props.entry().tags.length - limit()}`}
                  </Text>
                </View>
              </If>
            </>
          ) : (
            <Text class="text-[10px] text-muted-foreground" style={{ numberOfLines: 1 }}>
              {t('entry.notSet')}
            </Text>
          )}
        </View>
      </View>
    </View>
  )
}

export type FieldPairRow = {
  value: string
  /** 行内前缀文案（如「账号：」），只用于显示，不进剪贴板。 */
  displayLabel: string
  /** 复制按钮的 tooltip / toast 文案，如「复制账号」。 */
  label: string
  mono?: boolean
  secret?: boolean
  revealed?: boolean
  onToggleReveal?: () => void
}

/** 两行字段格：账号/密码 或 邮箱/手机号纵向排列，共用一个列宽。
 *  rows 是 accessor，避免 DataTable 回收单元格后显示上一行的数据。
 *  行内显示「账号：xxx」，复制按钮只写原始字段值，不会把前缀一起复制进剪贴板。
 *  列宽被均分压到 120pt 以下时前缀让位（`compact`）：前缀不可压缩，留着会把值挤成 0 宽、
 *  整格只剩「账号：」而看不到内容；此时只渲染值本身，字段身份靠掩码/眼睛图标与复制按钮文案区分。 */
export function EntryFieldPair(props: {
  rows: () => ReadonlyArray<FieldPairRow>
  card?: boolean
  compact?: () => boolean
}) {
  return (
    <View class={'min-w-0 flex-col justify-center ' + (props.card ? 'gap-1' : 'gap-0.5')}>
      <Each of={props.rows()} key={(row) => row.label}>
        {(row) => (
          <View class="min-w-0 flex-row items-center gap-1">
            <View class="min-w-0 flex-1 flex-row items-center">
              <If when={!props.compact?.()}>
                <Text
                  class="shrink-0 text-[11px] text-muted-foreground"
                  style={{ numberOfLines: 1 }}
                >
                  {`${row().displayLabel}：`}
                </Text>
              </If>
              <Text
                class={
                  'min-w-0 shrink text-[11px] ' +
                  (row().value ? 'text-foreground' : 'text-muted-foreground') +
                  (row().mono ? ' font-mono' : '')
                }
                style={{ numberOfLines: 1 }}
                tooltip={
                  row().value && !(row().secret && !row().revealed)
                    ? fullTextTip(row().value)
                    : undefined
                }
              >
                {!row().value
                  ? t('entry.notSet')
                  : row().secret && !row().revealed
                    ? '••••••••'
                    : row().value}
              </Text>
            </View>
            <If when={row().secret && Boolean(row().value)}>
              <IconButton
                icon={row().revealed ? 'eye-off' : 'eye'}
                label={row().revealed ? t('entry.hide') : t('entry.show')}
                size={11}
                class="h-5 w-5 shrink-0"
                onPress={() => row().onToggleReveal?.()}
              />
            </If>
            <If when={Boolean(row().value)}>
              <IconButton
                icon="copy"
                label={row().label}
                size={11}
                class="h-5 w-5 shrink-0"
                onPress={() => void copyField(row().value, row().label)}
              />
            </If>
          </View>
        )}
      </Each>
    </View>
  )
}

/** 账号/密码两行所需的行数据。 */
export function credentialsRows(entry: EntrySummary) {
  const fields = entryFields()[entry.id]
  return [
    {
      value: fields?.username ?? '',
      displayLabel: t('entry.username'),
      label: t('entry.copyUsername'),
      mono: true,
    },
    {
      value: fields?.password ?? '',
      displayLabel: t('entry.password'),
      label: t('entry.copyPassword'),
      mono: true,
      secret: true,
      revealed: passwordVisible(entry.id),
      onToggleReveal: () => togglePasswordFor(entry.id),
    },
  ] as const satisfies ReadonlyArray<FieldPairRow>
}

/** 邮箱/手机号两行所需的行数据。 */
export function contactRows(entry: EntrySummary) {
  const fields = entryFields()[entry.id]
  return [
    { value: fields?.email ?? '', displayLabel: t('entry.email'), label: t('entry.copyEmail') },
    {
      value: fields?.phone ?? '',
      displayLabel: t('entry.phoneShort'),
      label: t('entry.copyPhone'),
    },
  ] as const satisfies ReadonlyArray<FieldPairRow>
}

/** 备注格：表格里从左上角起最多两行、超出省略号，悬停读全文；点击打开备注编辑弹窗。
 *  卡片视图沿用单行简写。 */
export function EntryNotesCell(props: { entry: () => EntrySummary; card?: boolean }) {
  const raw = () => entryNotes()[props.entry().id] ?? ''
  const notes = () =>
    props.card
      ? notesPreview(raw(), NOTES_PREVIEW_CHARS)
      : notesPreview(raw(), Number.MAX_SAFE_INTEGER)
  return (
    <View
      class={
        'cursor-pointer rounded-md transition hover:bg-accent/50 ' +
        (props.card ? 'flex-row items-center' : 'h-full min-w-0 flex-row items-start pt-1.5')
      }
      role="button"
      testID="edit-notes"
      accessibilityLabel={t('entry.editNotes')}
      onPress={() => notesEditor.set(props.entry().id)}
      tooltip={notes() ? fullTextTip(notes()) : undefined}
    >
      <Text
        class={
          'min-w-0 shrink text-[11px] ' + (notes() ? 'text-foreground' : 'text-muted-foreground')
        }
        style={{ numberOfLines: props.card ? 1 : 2 }}
      >
        {notes() || t('entry.notSet')}
      </Text>
    </View>
  )
}

/** 行内图标动作。列表视图与卡片视图共用，保证两个视图功能一致。
 *  全部走共享的 IconButton：悬停底色/图标提亮/小手光标由它统一提供。 */
export function EntryActions(props: { entry: () => EntrySummary; card?: boolean }) {
  const actionClass = props.card ? 'h-6 w-6 shrink-0' : 'h-5 w-5 shrink-0'
  const actionSize = props.card ? 13 : 12

  function requestDelete() {
    const id = props.entry().id
    confirm.set({
      title: t('entry.delete'),
      message: t('entry.deleteConfirm'),
      confirmLabel: t('common.delete'),
      destructive: true,
      onConfirm: () => void deleteEntry(id),
    })
  }

  function requestArchive() {
    const id = props.entry().id
    confirm.set({
      title: t('entry.archive'),
      message: t('entry.archiveConfirmContent'),
      confirmLabel: t('entry.archive'),
      destructive: false,
      onConfirm: () => void deleteEntry(id, true),
    })
  }

  function requestUnarchive() {
    const id = props.entry().id
    confirm.set({
      title: t('entry.unarchive'),
      message: t('entry.unarchiveConfirmContent'),
      confirmLabel: t('entry.unarchive'),
      destructive: false,
      onConfirm: () => void unarchiveEntry(id),
    })
  }

  function requestPurge() {
    const id = props.entry().id
    confirm.set({
      title: t('trash.purge'),
      message: t('trash.purgeConfirm'),
      confirmLabel: t('trash.purge'),
      destructive: true,
      onConfirm: () => void purgeEntry(id),
    })
  }

  return (
    <View
      class={
        'min-w-0 flex-row items-center ' +
        (props.card ? 'flex-wrap justify-end gap-0.5' : 'justify-center gap-0')
      }
    >
      <If when={!isTrashView() && !isArchiveView()}>
        <IconButton
          size={actionSize}
          class={actionClass}
          icon="edit"
          label={t('entry.edit')}
          onPress={() =>
            entryEditor.set({
              id: props.entry().id,
              categoryId: props.entry().categoryId ?? null,
            })
          }
        />
      </If>
      <IconButton
        size={actionSize}
        class={actionClass}
        icon="copy"
        label={t('entry.copyAll')}
        onPress={() => void copyEntryFull(props.entry().id)}
      />
      <If when={!isTrashView()}>
        <IconButton
          size={actionSize}
          class={actionClass}
          icon={props.entry().favorite ? 'star-filled' : 'star'}
          label={props.entry().favorite ? t('entry.unstar') : t('entry.star')}
          tone={props.entry().favorite ? 'warning' : undefined}
          onPress={() => void toggleFavorite(props.entry())}
        />
      </If>
      <If when={!isTrashView() && !isArchiveView()}>
        <IconButton
          size={actionSize}
          class={actionClass}
          icon="archive"
          label={t('entry.archive')}
          onPress={requestArchive}
        />
        <IconButton
          size={actionSize}
          class={actionClass}
          icon="trash"
          label={t('entry.delete')}
          tone="destructive"
          onPress={requestDelete}
        />
      </If>
      <If when={isArchiveView()}>
        <IconButton
          size={actionSize}
          class={actionClass}
          icon="restore"
          label={t('entry.unarchive')}
          onPress={requestUnarchive}
        />
        <IconButton
          size={actionSize}
          class={actionClass}
          icon="trash"
          label={t('entry.delete')}
          tone="destructive"
          onPress={requestDelete}
        />
      </If>
      <If when={isTrashView()}>
        <IconButton
          size={actionSize}
          class={actionClass}
          icon="restore"
          label={t('trash.restore')}
          onPress={() => void restoreEntry(props.entry().id)}
        />
        <IconButton
          size={actionSize}
          class={actionClass}
          icon="trash"
          label={t('trash.purge')}
          tone="destructive"
          onPress={requestPurge}
        />
      </If>
      <If when={canManualReorder() && !isTrashView() && !isArchiveView()}>
        <IconButton
          size={actionSize}
          class={actionClass}
          icon="arrow-up"
          label={t('entry.moveUp')}
          onPress={() => void moveEntry(props.entry(), -1)}
        />
        <IconButton
          size={actionSize}
          class={actionClass}
          icon="arrow-down"
          label={t('entry.moveDown')}
          onPress={() => void moveEntry(props.entry(), 1)}
        />
      </If>
    </View>
  )
}
