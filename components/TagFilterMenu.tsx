import { computed, Text, token, View } from 'nsh'
import { Menu, MenuItem, MenuSeparator } from 'nsh/base'
import { t } from 'nsh/i18n'

import { clearTagFilters, entries, setTagFilter, tagFilters } from '../lib/state'
import { Icon } from './Icon'
import { TagPill } from './TagPill'
import { ActionButton } from './ui'

/** 标签多选筛选：无 props。
 *  - 选项来自全库 `entries()` 的 tags 去重排序（不是当前 buckets），
 *    否则被筛掉的标签就再也选不回来。
 *  - 每项 `closeOnSelect={false}`，点完菜单保持展开，可连续勾选多个标签。
 *  - 颜色走 `TagPill`（内部去 `#` 后确定性配色），与列表里的胶囊完全一致。 */
export function TagFilterMenu() {
  const allTags = computed(() =>
    Array.from(new Set(entries().flatMap((entry) => entry.tags))).sort((a, b) =>
      a.localeCompare(b),
    ),
  )

  const trigger = (
    <ActionButton
      icon="filter"
      label={
        tagFilters().length > 0
          ? `${t('entry.tagFilter')} (${tagFilters().length})`
          : t('entry.tagFilter')
      }
    />
  )

  return (
    <Menu
      placement="bottom"
      align="start"
      offset={6}
      popupClass="min-w-[200px] rounded-lg border border-border bg-popover p-1.5 shadow-lg"
      trigger={trigger}
    >
      {/* 顶部：取消全部筛选。 */}
      <MenuItem
        closeOnSelect={false}
        class="h-8 flex-row items-center gap-2 rounded px-2 hover:bg-accent"
        accessibilityLabel={t('entry.clearFilters')}
        onSelect={() => clearTagFilters()}
      >
        <View class="w-4 items-center justify-center">
          <Icon name="close" size={13} color={token('muted-foreground')} />
        </View>
        <Text class="text-xs text-popover-foreground">{t('entry.clearFilters')}</Text>
      </MenuItem>

      <MenuSeparator class="my-1 h-px bg-border" />

      <If when={allTags().length > 0}>
        {allTags().map((tag) => (
          <MenuItem
            checked={tagFilters().includes(tag)}
            closeOnSelect={false}
            class={
              'h-8 flex-row items-center gap-2 rounded px-2 ' +
              (tagFilters().includes(tag) ? 'bg-accent' : 'hover:bg-accent')
            }
            indicatorClass="w-4 items-center justify-center opacity-0 checked:opacity-100"
            indicator={<Icon name="check" size={12} color={token('primary')} />}
            accessibilityLabel={tag}
            onSelect={() => setTagFilter(tag)}
          >
            <TagPill
              label={tag}
              class={tagFilters().includes(tag) ? 'ring-2 ring-primary' : 'opacity-90'}
            />
          </MenuItem>
        ))}
      </If>

      {/* 没有任何标签时给个禁用占位，避免空菜单。 */}
      <If when={allTags().length === 0}>
        <MenuItem
          disabled
          class="h-8 flex-row items-center rounded px-2"
          accessibilityLabel={t('entry.allTags')}
        >
          <Text class="text-xs text-muted-foreground">{t('entry.allTags')}</Text>
        </MenuItem>
      </If>
    </Menu>
  )
}
