import { List, Text, token, View } from 'nsh'
import { Checkbox, Input, Menu, MenuItem, MenuSeparator, Switch } from 'nsh/base'
import { t } from 'nsh/i18n'

import {
  canManualReorder,
  categories,
  categoriesSheetOpen,
  clearSelection,
  confirm,
  copyEntryFull,
  copyField,
  copySelectedEntries,
  currentCategoryId,
  deleteEntry,
  displayedEntries,
  entryEditor,
  entryFields,
  fieldsLoading,
  hiddenPasswords,
  isArchiveView,
  isTrashView,
  keyword,
  loadMoreEntries,
  moveEntry,
  passwordVisible,
  presetsOpen,
  purgeAllTrash,
  purgeEntry,
  refreshEntries,
  restoreEntry,
  selectEntry,
  selectedIds,
  setKeyword,
  setShowPasswords,
  setSortMode,
  setTagFilter,
  setTypeFilter,
  setViewMode,
  showPasswords,
  sortBy,
  tagFilter,
  toggleFavorite,
  togglePasswordFor,
  toggleSelectAll,
  toggleSelected,
  typeFilter,
  unarchiveEntry,
  viewMode,
  visibleEntries,
} from '../lib/state'
import type { EntrySummary, SortMode } from '../lib/types'
import { EntryIcon } from './EntryIcon'
import { Icon, type IconName } from './Icon'
import { TagPill } from './TagPill'
import { ActionButton, Chip, EmptyState, IconButton, SelectField } from './ui'

/** 列表单元格一行最多放几个标签胶囊，多余的折叠为 `+N`（单行高度固定）。 */
const LIST_TAG_LIMIT = 2

const SORT_OPTIONS: { value: SortMode; titleKey: string }[] = [
  { value: 'updated', titleKey: 'entry.sortUpdated' },
  { value: 'title', titleKey: 'entry.sortTitle' },
  { value: 'favorite', titleKey: 'entry.sortFavorite' },
  { value: 'manual', titleKey: 'entry.sortManual' },
]

/** 表头与数据行共用的列宽类，保证逐列对齐。 */
const COL = {
  check: 'w-5 shrink-0',
  name: 'w-32 shrink-0',
  category: 'w-[76px] shrink-0',
  // 给最小宽度：窄窗口下也不能让字段列塌成 0 宽而把值藏掉（列表可横向溢出）。
  field: 'flex-1 min-w-[80px]',
  tags: 'w-[140px] shrink-0',
  phone: 'w-[88px] shrink-0',
  actions: 'w-[84px] shrink-0',
}

function categoryOf(entry: EntrySummary) {
  return categories().find((category) => category.id === entry.categoryId)
}

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
    <MenuItem class="h-8 min-w-[168px] flex-row items-center gap-2.5 rounded-md px-2.5 hover:bg-accent focus:bg-accent" accessibilityLabel={props.label} onSelect={props.onSelect}>
      <View class="w-4 items-center justify-center">
        <Icon name={props.icon} size={15} color={iconColor} />
      </View>
      <Text class={props.tone === 'destructive' ? 'text-xs text-destructive' : 'text-xs text-popover-foreground'}>
        {props.label}
      </Text>
    </MenuItem>
  )
}

/** 单元格：字段值 + 复制按钮（密码另带眼睛图标）。复制按钮与行点击互不干扰。 */
function FieldCell(props: {
  value: string
  label: string
  mono?: boolean
  secret?: boolean
  revealed?: boolean
  onToggleReveal?: () => void
}) {
  const display = () => {
    if (!props.value) return t('entry.notSet')
    if (props.secret && !props.revealed) return '••••••••'
    return props.value
  }
  return (
    <View class={`${COL.field} flex-row items-center gap-1`}>
      <Text
        class={
          'min-w-0 shrink text-[11px] ' +
          (props.value ? 'text-foreground' : 'text-muted-foreground') +
          (props.mono ? ' font-mono' : '')
        }
        style={{ numberOfLines: 1 }}
      >
        {display()}
      </Text>
      <If when={props.secret && Boolean(props.value)}>
        <IconButton
          icon={props.revealed ? 'eye-off' : 'eye'}
          label={props.revealed ? t('entry.hide') : t('entry.show')}
          size={12}
          class="h-6 w-6 shrink-0"
          onPress={() => props.onToggleReveal?.()}
        />
      </If>
      <If when={Boolean(props.value)}>
        <IconButton
          icon="copy"
          label={props.label}
          size={12}
          class="h-6 w-6 shrink-0"
          onPress={() => void copyField(props.value, props.label)}
        />
      </If>
    </View>
  )
}

/** 行组件收到的是 List 的 accessor（单元格会被回收给别的条目），
 *  必须在用到的地方通过 e() 读取，不能在函数体里解构成固定对象。 */
function EntryRow(props: { entry: () => EntrySummary }) {
  const e = props.entry
  const fields = () => entryFields()[e().id]
  const category = () => categoryOf(e())
  // 已进入某个分组时，左侧导航与上下文已表明分类，避免重复；其余视图显示分类列。
  const showCategory = () => !currentCategoryId()
  const compact = () => viewMode() === 'compact'
  const revealed = () => passwordVisible(e().id)

  function requestDelete() {
    confirm.set({
      title: t('entry.delete'),
      message: t('entry.deleteConfirm'),
      confirmLabel: t('common.delete'),
      destructive: true,
      onConfirm: () => void deleteEntry(e().id),
    })
  }

  function requestArchive() {
    confirm.set({
      title: t('entry.archive'),
      message: t('entry.archiveConfirmContent'),
      confirmLabel: t('entry.archive'),
      destructive: false,
      onConfirm: () => void deleteEntry(e().id, true),
    })
  }

  function requestPurge() {
    confirm.set({
      title: t('trash.purge'),
      message: t('trash.purgeConfirm'),
      confirmLabel: t('trash.purge'),
      destructive: true,
      onConfirm: () => void purgeEntry(e().id),
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
          onSelect={() => entryEditor.set({ id: e().id, categoryId: e().categoryId ?? null })}
        />
        <MenuAction
          icon="copy"
          label={t('entry.copyAll')}
          onSelect={() => void copyEntryFull(e().id)}
        />
        <MenuSeparator class="my-1 h-px bg-border" />
        <MenuAction icon="archive" label={t('entry.archive')} onSelect={requestArchive} />
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
              onConfirm: () => void unarchiveEntry(e().id),
            })
          }}
        />
        <MenuAction icon="trash" label={t('entry.delete')} tone="destructive" onSelect={requestDelete} />
      </If>
      <If when={isTrashView()}>
        <MenuAction icon="restore" label={t('trash.restore')} onSelect={() => void restoreEntry(e().id)} />
        <MenuAction icon="trash" label={t('trash.purge')} tone="destructive" onSelect={requestPurge} />
      </If>
      <If when={canManualReorder() && !isTrashView() && !isArchiveView()}>
        <MenuSeparator class="my-1 h-px bg-border" />
        <MenuAction icon="arrow-up" label={t('entry.moveUp')} onSelect={() => void moveEntry(e(), -1)} />
        <MenuAction icon="arrow-down" label={t('entry.moveDown')} onSelect={() => void moveEntry(e(), 1)} />
      </If>
    </Menu>
  )

  return (
    <View
      class={
        'flex-row items-center gap-2 rounded-xl border border-border bg-card px-3 ' +
        (compact() ? 'py-1.5' : 'py-2') +
        ' hover:bg-accent'
      }
      accessibilityLabel={e().title}
    >
      <View class={COL.check}>
        <Checkbox
          checked={selectedIds().has(e().id)}
          onChange={() => toggleSelected(e().id)}
          accessibilityLabel={e().title}
          indicatorClass="h-4 w-4 items-center justify-center rounded border border-input bg-background checked:border-primary checked:bg-primary"
          indicator={<Icon name="check" size={11} color={token('primary-foreground')} />}
        />
      </View>

      <View
        class={`${COL.name} flex-row items-center gap-2`}
        onPress={() => void selectEntry(e().id)}
        role="button"
      >
        <EntryIcon entry={e()} category={category()} />
        <View class="min-w-0 flex-1">
          <Text class="text-xs font-medium text-foreground" style={{ numberOfLines: 1 }}>
            {e().title}
          </Text>
        </View>
      </View>

      <If when={showCategory()}>
        <View class={COL.category}>
          <Text class="text-[11px] text-muted-foreground" style={{ numberOfLines: 1 }}>
            {category()?.name ?? t('entry.uncategorized')}
          </Text>
        </View>
      </If>

      <FieldCell value={fields()?.username ?? ''} label={t('entry.copyUsername')} mono />
      <FieldCell
        value={fields()?.password ?? ''}
        label={t('entry.copyPassword')}
        mono
        secret
        revealed={revealed()}
        onToggleReveal={() => togglePasswordFor(e().id)}
      />
      <FieldCell value={fields()?.email ?? ''} label={t('entry.copyEmail')} />
      <View class={`${COL.phone} flex-row items-center gap-1`}>
        <Text
          class={
            'min-w-0 shrink text-[11px] ' +
            (fields()?.phone ? 'text-foreground' : 'text-muted-foreground')
          }
          style={{ numberOfLines: 1 }}
        >
          {fields()?.phone || t('entry.notSet')}
        </Text>
        <If when={Boolean(fields()?.phone)}>
          <IconButton
            icon="copy"
            label={t('entry.copyPhone')}
            size={12}
            class="h-6 w-6 shrink-0"
            onPress={() => void copyField(fields()?.phone ?? '', t('entry.copyPhone'))}
          />
        </If>
      </View>

      <View class={`${COL.tags} flex-row items-center gap-1 overflow-hidden`}>
        {e().tags.length > 0 ? (
          <>
            {e().tags.slice(0, LIST_TAG_LIMIT).map((tag) => (
              <TagPill label={`#${tag}`} />
            ))}
            <If when={e().tags.length > LIST_TAG_LIMIT}>
              <View class="shrink-0 rounded-full bg-muted px-1.5 py-0.5">
                <Text class="text-[10px] font-medium text-muted-foreground" style={{ numberOfLines: 1 }}>
                  {`+${e().tags.length - LIST_TAG_LIMIT}`}
                </Text>
              </View>
            </If>
          </>
        ) : (
          <Text class="text-[11px] text-muted-foreground" style={{ numberOfLines: 1 }}>
            {t('entry.notSet')}
          </Text>
        )}
      </View>

      <View class={`${COL.actions} flex-row items-center justify-end gap-0.5`}>
        <If when={!isTrashView()}>
          <IconButton
            icon={e().favorite ? 'star-filled' : 'star'}
            label={e().favorite ? t('entry.unstar') : t('entry.star')}
            size={13}
            class="h-7 w-7"
            iconColor={token(e().favorite ? 'warning' : 'muted-foreground')}
            onPress={() => void toggleFavorite(e())}
          />
        </If>
        <IconButton
          icon="copy"
          label={t('entry.copyAll')}
          size={13}
          class="h-7 w-7"
          onPress={() => void copyEntryFull(e().id)}
        />
        {menu}
      </View>
    </View>
  )
}

function ColumnHeader() {
  const shown = () => displayedEntries()
  const allSelected = () => shown().length > 0 && shown().every((e) => selectedIds().has(e.id))
  const someSelected = () => shown().some((e) => selectedIds().has(e.id))
  const typeItems = () => [
    { value: '', title: t('entry.allTypes') },
    ...categories().map((category) => ({ value: category.id, title: category.name })),
  ]
  return (
    <>
      {/* 第一行：搜索 + 视图切换 + 新建 */}
      <View class="flex-row items-center gap-2 px-4 pt-3">
        <View class="relative h-9 flex-1 flex-row items-center gap-2 rounded-xl border border-input bg-card px-3">
          <Icon name="search" size={15} color={token('muted-foreground')} />
          <Input
            value={keyword()}
            onChange={(event) => setKeyword(event.value)}
            placeholder={t('entry.searchPlaceholder')}
            accessibilityLabel={t('entry.searchPlaceholder')}
            class="flex-1 border-0 bg-transparent px-0 py-0.5 text-xs text-foreground placeholder:text-muted-foreground"
            style={{
              color: token('foreground'),
              fontSize: 12,
              placeholderColor: token('muted-foreground'),
              caretColor: token('foreground'),
            }}
          />
          <If when={keyword().length > 0}>
            <IconButton
              icon="close"
              label={t('common.close')}
              size={12}
              class="absolute right-1 top-1 h-6 w-6"
              onPress={() => setKeyword('')}
            />
          </If>
        </View>
        <IconButton
          icon="list"
          label={t('entry.listView')}
          active={viewMode() === 'list'}
          class="h-9 w-9 rounded-xl border border-input"
          onPress={() => setViewMode('list')}
        />
        <IconButton
          icon="grid"
          label={t('entry.compactView')}
          active={viewMode() === 'compact'}
          class="h-9 w-9 rounded-xl border border-input"
          onPress={() => setViewMode('compact')}
        />
        <ActionButton
          label={t('entry.add')}
          icon="plus"
          variant="primary"
          class="h-9 rounded-xl px-3"
          testID="add-entry"
          onPress={() => entryEditor.set({ id: null, categoryId: currentCategoryId() })}
        />
      </View>

      {/* 第二行：类型 / 排序 / 显示密码 / 预设 / 刷新 */}
      <View class="flex-row items-center gap-2 px-4 py-2.5">
        <SelectField
          items={typeItems()}
          value={typeFilter() ?? ''}
          onChange={(value) => setTypeFilter(value || null)}
          class="w-32"
        />
        <If when={!isTrashView() && !isArchiveView()}>
          <SelectField
            items={SORT_OPTIONS.map((option) => ({ value: option.value, title: t(option.titleKey) }))}
            value={sortBy()}
            onChange={(value) => {
              if (value) setSortMode(value as SortMode)
            }}
            class="w-32"
          />
        </If>
        <View class="flex-1" />
        <Text class="text-[11px] text-muted-foreground">{t('entry.showPasswords')}</Text>
        <Switch
          checked={showPasswords()}
          onChange={(event) => setShowPasswords(event.checked)}
          accessibilityLabel={t('entry.showPasswords')}
          trackClass="h-5 w-9 flex-row items-center justify-start rounded-full bg-muted p-0.5 checked:bg-primary"
          thumbClass="h-4 w-4 rounded-full bg-background checked:translate-x-4"
        />
        <IconButton
          icon="clipboard-list"
          label={t('nav.presets')}
          class="h-7 w-7"
          onPress={() => presetsOpen.set(true)}
        />
        <IconButton icon="refresh" label={t('common.retry')} class="h-7 w-7" onPress={() => refreshEntries()} />
      </View>

      {/* 表头 */}
      <View class="mx-4 mb-1 flex-row items-center gap-2 rounded-lg bg-secondary px-3 py-1.5">
        <View class={COL.check}>
          <Checkbox
            checked={allSelected()}
            indeterminate={!allSelected() && someSelected()}
            onChange={() => toggleSelectAll()}
            accessibilityLabel={t('entry.selectAll')}
            indicatorClass="h-4 w-4 items-center justify-center rounded border border-input bg-background checked:border-primary checked:bg-primary indeterminate:border-primary indeterminate:bg-primary"
            indicator={<Icon name="check" size={11} color={token('primary-foreground')} />}
          />
        </View>
        <Text class={`${COL.name} text-[11px] font-medium text-muted-foreground`} style={{ numberOfLines: 1 }}>{t('entry.title')}</Text>
        <If when={!currentCategoryId()}>
          <Text class={`${COL.category} text-[11px] font-medium text-muted-foreground`} style={{ numberOfLines: 1 }}>{t('entry.category')}</Text>
        </If>
        <Text class={`${COL.field} text-[11px] font-medium text-muted-foreground`} style={{ numberOfLines: 1 }}>{t('entry.username')}</Text>
        <Text class={`${COL.field} text-[11px] font-medium text-muted-foreground`} style={{ numberOfLines: 1 }}>{t('entry.password')}</Text>
        <Text class={`${COL.field} text-[11px] font-medium text-muted-foreground`} style={{ numberOfLines: 1 }}>{t('entry.email')}</Text>
        <Text class={`${COL.phone} text-[11px] font-medium text-muted-foreground`} style={{ numberOfLines: 1 }}>{t('entry.phone')}</Text>
        <Text class={`${COL.tags} text-[11px] font-medium text-muted-foreground`} style={{ numberOfLines: 1 }}>{t('entry.tags')}</Text>
        <View class={`${COL.actions} flex-row justify-end`}>
          <Text class="text-[11px] font-medium text-muted-foreground" style={{ numberOfLines: 1 }}>{t('common.actions')}</Text>
        </View>
      </View>
    </>
  )
}

export function EntryList() {
  const count = () => visibleEntries().length
  const selectedCount = () => selectedIds().size

  const empty = (
    <EmptyState
      icon={
        isTrashView()
          ? 'trash'
          : isArchiveView()
            ? 'archive'
            : keyword().trim() || tagFilter() || typeFilter()
              ? 'search'
              : 'key'
      }
      title={
        isTrashView()
          ? t('trash.empty')
          : isArchiveView()
            ? t('entry.emptyInBucket')
            : keyword().trim() || tagFilter() || typeFilter()
              ? t('entry.empty')
              : t('entry.emptyInBucket')
      }
      hint={keyword().trim() || tagFilter() || typeFilter() ? t('entry.emptyHint') : undefined}
      action={
        keyword().trim() || tagFilter() || typeFilter() ? (
          <ActionButton
            label={t('entry.clearFilters')}
            variant="secondary"
            onPress={() => {
              setKeyword('')
              setTagFilter(null)
              setTypeFilter(typeFilter())
            }}
          />
        ) : !isTrashView() && !isArchiveView() ? (
          <ActionButton
            label={t('entry.add')}
            icon="plus"
            variant="primary"
            onPress={() => entryEditor.set({ id: null, categoryId: currentCategoryId() })}
          />
        ) : undefined
      }
    />
  )

  return (
    <View class="flex-1 min-h-0">
      <ColumnHeader />

      <If when={tagFilter()}>
        <View class="mx-4 mb-1 flex-row items-center gap-2">
          <Text class="text-xs text-muted-foreground">{t('entry.tagFilterHint')}</Text>
          <Chip label={t('entry.clearFilters')} onPress={() => setTagFilter(null)} />
        </View>
      </If>

      <List
        each={displayedEntries()}
        keyExtractor={(item) => item.id}
        estimatedItemSize={viewMode() === 'compact' ? 46 : 52}
        loadMoreThreshold={2}
        onLoadMore={() => loadMoreEntries()}
        class="flex-1 min-h-0"
        contentClass="gap-1.5 px-4 pb-2"
        empty={empty}
      >
        {(item) => <EntryRow entry={item} />}
      </List>

      {/* 底部：记录总数（无分页）+ 多选批量操作 + 加载更多指示 */}
      <View class="mx-4 mb-2 flex-row items-center gap-3 border-t border-border pt-2">
        <Text class="text-[11px] font-medium text-foreground">{t('entry.listTitle')}</Text>
        <Text class="text-[11px] text-muted-foreground">{t('entry.records', { count: count() })}</Text>
        <If when={selectedCount() > 0}>
          <Text class="text-[11px] text-primary">{t('entry.selectedCount', { count: selectedCount() })}</Text>
          <ActionButton
            label={t('entry.copyAll')}
            icon="copy"
            variant="ghost"
            class="h-6"
            onPress={() => void copySelectedEntries()}
          />
          <ActionButton label={t('common.close')} variant="ghost" class="h-6" onPress={clearSelection} />
        </If>
        <View class="flex-1" />
        <If when={fieldsLoading()}>
          <Text class="text-[11px] text-muted-foreground">{t('entry.loadingMore')}</Text>
        </If>
      </View>
    </View>
  )
}
