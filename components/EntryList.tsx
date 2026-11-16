import { List, Text, token, View } from 'nsh'
import { Menu, MenuItem, MenuSeparator } from 'nsh/base'
import { t } from 'nsh/i18n'

import {
  canManualReorder,
  categories,
  confirm,
  currentCategoryId,
  deleteEntry,
  entryEditor,
  isArchiveView,
  isTrashView,
  keyword,
  moveEntry,
  purgeAllTrash,
  purgeEntry,
  restoreEntry,
  selectEntry,
  setKeyword,
  setSortMode,
  setTagFilter,
  sortBy,
  tagFilter,
  toggleFavorite,
  unarchiveEntry,
  visibleEntries,
} from '../lib/state'
import { formatDate } from '../lib/format'
import type { EntrySummary, SortMode } from '../lib/types'
import { EntryIcon } from './EntryIcon'
import { Icon, type IconName } from './Icon'
import { ActionButton, Chip, EmptyState, IconButton, SelectField } from './ui'

const SORT_OPTIONS: { value: SortMode; titleKey: string }[] = [
  { value: 'updated', titleKey: 'entry.sortUpdated' },
  { value: 'title', titleKey: 'entry.sortTitle' },
  { value: 'favorite', titleKey: 'entry.sortFavorite' },
  { value: 'manual', titleKey: 'entry.sortManual' },
]

function categoryOf(entry: EntrySummary) {
  return categories().find((category) => category.id === entry.categoryId)
}

/** One consistently-spaced row for every action menu. nsh paints nothing
 *  behind menu items, so each row needs its own hover/focus background. */
const MENU_ITEM_CLASS =
  'h-8 min-w-[168px] flex-row items-center gap-2.5 rounded-md px-2.5 hover:bg-accent focus:bg-accent'

function MenuAction(props: {
  icon: IconName
  label: string
  onSelect: () => void
  tone?: 'warning' | 'destructive'
}) {
  const iconColor =
    props.tone === 'destructive'
      ? token('destructive')
      : props.tone === 'warning'
        ? token('warning')
        : token('muted-foreground')
  return (
    <MenuItem class={MENU_ITEM_CLASS} accessibilityLabel={props.label} onSelect={props.onSelect}>
      <View class="w-4 items-center justify-center">
        <Icon name={props.icon} size={15} color={iconColor} />
      </View>
      <Text
        class={
          props.tone === 'destructive'
            ? 'text-xs text-destructive'
            : 'text-xs text-popover-foreground'
        }
      >
        {props.label}
      </Text>
    </MenuItem>
  )
}

function EntryRow(props: { entry: EntrySummary; index: number }) {
  const category = () => categoryOf(props.entry)
  const showDate = () => !isTrashView()

  function requestDelete() {
    confirm.set({
      title: t('entry.delete'),
      message: t('entry.deleteConfirm'),
      confirmLabel: t('common.delete'),
      destructive: true,
      onConfirm: () => void deleteEntry(props.entry.id),
    })
  }

  function requestArchive() {
    confirm.set({
      title: t('entry.archive'),
      message: t('entry.archiveConfirmContent'),
      confirmLabel: t('entry.archive'),
      destructive: false,
      onConfirm: () => void deleteEntry(props.entry.id, true),
    })
  }

  function requestPurge() {
    confirm.set({
      title: t('trash.purge'),
      message: t('trash.purgeConfirm'),
      confirmLabel: t('trash.purge'),
      destructive: true,
      onConfirm: () => void purgeEntry(props.entry.id),
    })
  }

  const menu = (
    <Menu
      placement="bottom"
      align="end"
      offset={6}
      trigger={
        <IconButton icon="more-horizontal" label={t('common.actions')} size={14} class="h-7 w-7" />
      }
      popupClass="min-w-[176px] rounded-lg border border-border bg-popover p-1.5 shadow-lg"
    >
      <If when={!isTrashView() && !isArchiveView()}>
        <MenuAction
          icon="edit"
          label={t('entry.edit')}
          onSelect={() =>
            entryEditor.set({ id: props.entry.id, categoryId: props.entry.categoryId ?? null })
          }
        />
        <MenuAction
          icon={props.entry.favorite ? 'star-filled' : 'star'}
          label={props.entry.favorite ? t('entry.unstar') : t('entry.star')}
          tone={props.entry.favorite ? 'warning' : undefined}
          onSelect={() => void toggleFavorite(props.entry)}
        />
        <MenuAction icon="archive" label={t('entry.archive')} onSelect={requestArchive} />
        <MenuSeparator class="my-1 h-px bg-border" />
        <MenuAction
          icon="trash"
          label={t('entry.delete')}
          tone="destructive"
          onSelect={requestDelete}
        />
      </If>
      <If when={isArchiveView()}>
        <MenuAction
          icon="restore"
          label={t('entry.unarchive')}
          onSelect={() => {
            confirm.set({
              title: t('entry.unarchive'),
              message: t('entry.unarchiveConfirmContent'),
              confirmLabel: t('entry.unarchive'),
              destructive: false,
              onConfirm: () => void unarchiveEntry(props.entry.id),
            })
          }}
        />
        <MenuAction
          icon="trash"
          label={t('entry.delete')}
          tone="destructive"
          onSelect={requestDelete}
        />
      </If>
      <If when={isTrashView()}>
        <MenuAction
          icon="restore"
          label={t('trash.restore')}
          onSelect={() => void restoreEntry(props.entry.id)}
        />
        <MenuAction
          icon="trash"
          label={t('trash.purge')}
          tone="destructive"
          onSelect={requestPurge}
        />
      </If>
      <If when={canManualReorder() && !isTrashView() && !isArchiveView()}>
        <MenuSeparator class="my-1 h-px bg-border" />
        <MenuAction
          icon="arrow-up"
          label={t('entry.moveUp')}
          onSelect={() => void moveEntry(props.entry, -1)}
        />
        <MenuAction
          icon="arrow-down"
          label={t('entry.moveDown')}
          onSelect={() => void moveEntry(props.entry, 1)}
        />
      </If>
    </Menu>
  )

  return (
    <View
      class="flex-row items-center gap-3 rounded-lg border border-transparent bg-card px-3 py-2 hover:border-border hover:bg-accent active:opacity-90"
      onPress={isTrashView() ? undefined : () => void selectEntry(props.entry.id)}
      role={isTrashView() ? undefined : 'button'}
      accessibilityLabel={props.entry.title}
    >
      <EntryIcon entry={props.entry} category={category()} />

      <View class="flex-1 gap-0.5">
        <View class="flex-row items-center gap-2">
          <Text class="flex-1 text-xs font-medium text-foreground" style={{ numberOfLines: 1 }}>
            {props.entry.title}
          </Text>
          <If when={props.entry.archived}>
            <Text class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">
              {t('entry.archived')}
            </Text>
          </If>
        </View>
        <View class="flex-row items-center gap-2">
          <Text class="text-[11px] text-muted-foreground">
            {category()?.name ?? t('entry.uncategorized')}
          </Text>
          <If when={props.entry.tags.length > 0}>
            <View class="flex-row items-center gap-1">
              <Each of={props.entry.tags.slice(0, 2)} key={(tag) => tag}>
                {(tag) => <Text class="text-[11px] text-muted-foreground">{`#${tag()}`}</Text>}
              </Each>
              <If when={props.entry.tags.length > 2}>
                <Text class="text-[11px] text-muted-foreground">
                  {`+${props.entry.tags.length - 2}`}
                </Text>
              </If>
            </View>
          </If>
        </View>
      </View>

      <View class="flex-row items-center gap-1.5">
        <If when={showDate()}>
          <Text class="text-[11px] text-muted-foreground">{formatDate(props.entry.updatedAt)}</Text>
        </If>
        <If when={!isTrashView() && !isArchiveView()}>
          <IconButton
            icon={props.entry.favorite ? 'star-filled' : 'star'}
            label={props.entry.favorite ? t('entry.unstar') : t('entry.star')}
            size={14}
            class="h-7 w-7"
            iconColor={token(props.entry.favorite ? 'warning' : 'muted-foreground')}
            onPress={() => void toggleFavorite(props.entry)}
          />
        </If>
        {menu}
      </View>
    </View>
  )
}

export function EntryList() {
  const count = () => visibleEntries().length

  const empty = (
    <EmptyState
      icon={
        isTrashView()
          ? 'trash'
          : isArchiveView()
            ? 'archive'
            : keyword().trim() || tagFilter()
              ? 'search'
              : 'key'
      }
      title={
        isTrashView()
          ? t('trash.empty')
          : isArchiveView()
            ? t('entry.emptyInBucket')
            : keyword().trim() || tagFilter()
              ? t('entry.empty')
              : t('entry.emptyInBucket')
      }
      hint={keyword().trim() || tagFilter() ? t('entry.emptyHint') : undefined}
      action={
        keyword().trim() || tagFilter() ? (
          <ActionButton
            label={t('entry.clearFilters')}
            variant="secondary"
            onPress={() => {
              setKeyword('')
              setTagFilter(null)
            }}
          />
        ) : !isTrashView() && !isArchiveView() ? (
          <ActionButton
            label={t('entry.add')}
            icon="plus"
            variant="primary"
            onPress={() =>
              entryEditor.set({
                id: null,
                categoryId: currentCategoryId(),
              })
            }
          />
        ) : undefined
      }
    />
  )

  return (
    <View class="flex-1 min-h-0">
      <View class="flex-row items-center gap-2 px-3 py-2">
        <View class="flex-1 gap-0.5">
          <Text class="text-sm font-semibold text-foreground">{t('entry.listTitle')}</Text>
          <Text class="text-[11px] text-muted-foreground">
            {`${count()} ${t('entry.countSuffix')}`}
          </Text>
        </View>
        <If when={tagFilter()}>
          <Chip label={`#${tagFilter()}`} active onPress={() => setTagFilter(tagFilter())} />
        </If>
        <If when={!isTrashView() && !isArchiveView()}>
          <SelectField
            items={SORT_OPTIONS.map((option) => ({
              value: option.value,
              title: t(option.titleKey),
            }))}
            value={sortBy()}
            onChange={(value) => {
              if (value) setSortMode(value as SortMode)
            }}
            class="w-36"
          />
        </If>
        <If when={isTrashView()}>
          <ActionButton
            label={t('trash.purgeAll')}
            icon="trash"
            variant="ghost"
            onPress={() =>
              confirm.set({
                title: t('trash.purgeAll'),
                message: t('trash.purgeAllConfirm'),
                confirmLabel: t('trash.purgeAll'),
                destructive: true,
                onConfirm: () => void purgeAllTrash(),
              })
            }
          />
        </If>
      </View>

      <If when={tagFilter()}>
        <View class="flex-row items-center gap-2 px-3 pb-2">
          <Text class="text-xs text-muted-foreground">{t('entry.tagFilterHint')}</Text>
          <Chip label={t('entry.clearFilters')} onPress={() => setTagFilter(null)} />
        </View>
      </If>

      <List
        each={visibleEntries()}
        keyExtractor={(item) => item.id}
        class="flex-1"
        contentClass="gap-1 px-2.5 pb-3"
        empty={empty}
        children={(item) => <EntryRow entry={item()} index={0} />}
      />
    </View>
  )
}
