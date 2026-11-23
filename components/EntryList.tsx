import { platform, Text, token, View, windowSize } from 'nsh'
import { Input, Switch } from 'nsh/base'
import { t } from 'nsh/i18n'

import {
  clearSelection,
  clearTagFilters,
  copySelectedEntries,
  currentCategoryId,
  entryEditor,
  fieldsLoading,
  isArchiveView,
  isTrashView,
  keyword,
  presetsOpen,
  requestDeleteSelected,
  selectedIds,
  setKeyword,
  setShowPasswords,
  setSortMode,
  setViewMode,
  showPasswords,
  sortBy,
  tagFilters,
  tagsOpen,
  viewMode,
  visibleEntries,
} from '../lib/state'
import type { SortMode } from '../lib/types'
import { ColumnConfigMenu } from './ColumnConfigMenu'
import { EntryCardList } from './EntryCardList'
import { EntryDataTable } from './EntryDataTable'
import { Icon } from './Icon'
import { TagFilterMenu } from './TagFilterMenu'
import { ActionButton, Chip, EmptyState, IconButton, SelectField } from './ui'

const SORT_OPTIONS: { value: SortMode; titleKey: string }[] = [
  { value: 'updated', titleKey: 'entry.sortUpdated' },
  { value: 'title', titleKey: 'entry.sortTitle' },
  { value: 'favorite', titleKey: 'entry.sortFavorite' },
  { value: 'manual', titleKey: 'entry.sortManual' },
]

/** 与 MainScreen 的 compact 判定同口径：窄屏隐藏工具栏里的「预设值/标签」
 *  文字入口，改由 AppHeader 提供，避免 390 宽时整行溢出。 */
function compactToolbar(): boolean {
  return platform.idiom === 'phone' || platform.idiom === 'pad' || windowSize().width < 900
}

function ColumnHeader() {
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
          testID="view-list"
          onPress={() => setViewMode('list')}
        />
        <IconButton
          icon="grid"
          label={t('entry.cardView')}
          active={viewMode() === 'card'}
          class="h-9 w-9 rounded-xl border border-input"
          testID="view-card"
          onPress={() => setViewMode('card')}
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

      {/* 第二行：标签筛选（多选）/ 排序 / 显示列 / 显示密码 / 预设 / 标签 / 刷新 */}
      <View class="flex-row items-center gap-2 px-4 py-2.5">
        <TagFilterMenu />
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
            class="w-32"
          />
        </If>
        <View class="flex-1" />
        <If when={viewMode() === 'list'}>
          <ColumnConfigMenu />
        </If>
        <View
          class="cursor-pointer flex-row items-center gap-2"
          onPress={() => setShowPasswords(!showPasswords())}
        >
          <Text class="text-[11px] text-muted-foreground">{t('entry.showPasswords')}</Text>
          <Switch
            checked={showPasswords()}
            onChange={(event) => setShowPasswords(event.checked)}
            accessibilityLabel={t('entry.showPasswords')}
            trackClass="h-5 w-9 cursor-pointer flex-row items-center justify-start rounded-full bg-muted p-0.5 transition checked:bg-primary"
            thumbClass="h-4 w-4 rounded-full bg-background checked:translate-x-4"
          />
        </View>
        {/* 预设值 / 标签入口只在宽屏工具栏展示图标+文字；窄屏由 AppHeader
            统一提供同样的两个入口，避免一行挤到放不下。 */}
        <If when={!compactToolbar()}>
          <ActionButton
            icon="clipboard-list"
            label={t('nav.presets')}
            variant="ghost"
            class="h-7 px-2"
            onPress={() => presetsOpen.set(true)}
          />
          <ActionButton
            icon="tag"
            label={t('nav.tags')}
            variant="ghost"
            class="h-7 px-2"
            onPress={() => tagsOpen.set(true)}
          />
        </If>
      </View>
    </>
  )
}

export function EntryList() {
  const count = () => visibleEntries().length
  const selectedCount = () => selectedIds().size
  const filtering = () => keyword().trim().length > 0 || tagFilters().length > 0

  const empty = (
    <EmptyState
      icon={isTrashView() ? 'trash' : isArchiveView() ? 'archive' : filtering() ? 'search' : 'key'}
      title={
        isTrashView()
          ? t('trash.empty')
          : isArchiveView()
            ? t('entry.emptyInBucket')
            : filtering()
              ? t('entry.empty')
              : t('entry.emptyInBucket')
      }
      hint={filtering() ? t('entry.emptyHint') : undefined}
      action={
        filtering() ? (
          <ActionButton
            label={t('entry.clearFilters')}
            variant="secondary"
            onPress={() => {
              setKeyword('')
              clearTagFilters()
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

      <If when={tagFilters().length > 0}>
        <View class="mx-4 mb-1 flex-row items-center gap-2">
          <Text class="text-xs text-muted-foreground">{t('entry.tagFilterHint')}</Text>
          <Chip label={t('entry.clearFilters')} onPress={() => clearTagFilters()} />
        </View>
      </If>

      <If when={viewMode() === 'list'}>
        <EntryDataTable empty={empty} />
      </If>
      <If when={viewMode() === 'card'}>
        <EntryCardList empty={empty} />
      </If>

      {/* 底部：记录总数（无分页）+ 多选批量操作 + 加载更多指示 */}
      <View class="mx-4 mb-2 flex-row items-center gap-3 border-t border-border pt-2">
        <Text class="text-[11px] font-medium text-foreground">{t('entry.listTitle')}</Text>
        <Text class="text-[11px] text-muted-foreground">
          {t('entry.records', { count: count() })}
        </Text>
        <If when={selectedCount() > 0}>
          <Text class="text-[11px] text-primary">
            {t('entry.selectedCount', { count: selectedCount() })}
          </Text>
          <ActionButton
            label={t('entry.copyAll')}
            icon="copy"
            variant="ghost"
            class="h-6"
            onPress={() => void copySelectedEntries()}
          />
          <ActionButton
            label={t('entry.deleteSelected')}
            icon="trash"
            variant="danger-ghost"
            class="h-6"
            testID="delete-selected"
            onPress={requestDeleteSelected}
          />
          <ActionButton
            label={t('entry.clearSelection')}
            variant="ghost"
            class="h-6"
            testID="clear-selection"
            onPress={clearSelection}
          />
        </If>
        <View class="flex-1" />
        <If when={fieldsLoading()}>
          <Text class="text-[11px] text-muted-foreground">{t('entry.loadingMore')}</Text>
        </If>
      </View>
    </View>
  )
}
