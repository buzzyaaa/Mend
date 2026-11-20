import { computed, Text, token, View } from 'nsh'
import { Menu, MenuItem, MenuSeparator } from 'nsh/base'
import { t } from 'nsh/i18n'

import { clearTagFilters, entries, setTagFilter, tagColorOf, tagFilters, tags } from '../lib/state'
import { Icon } from './Icon'
import { TagPill } from './TagPill'
import { ActionButton } from './ui'

/** 标签多选筛选：无 props。
 *  - 选项来自**标签定义**（`tags()`，按维护弹窗里的顺序），而不是当前列表里
 *    出现过的标签：这样删到空库也不会丢掉筛选入口，新标签建好即出现。
 *  - 兜底：条目上仍带、但定义表里没有的旧标签（理论上迁移已回填）追加在末尾，
 *    避免它们永远筛不到。
 *  - 每项 `closeOnSelect={false}`，点完菜单保持展开，可连续勾选多个标签。
 *  - 颜色取自标签定义，与列表里的胶囊完全一致；无定义时回退文字 hash 配色。 */
export function TagFilterMenu() {
  const allTags = computed(() => {
    const defined = tags().map((tag) => tag.name)
    const extra = Array.from(new Set(entries().flatMap((entry) => entry.tags)))
      .filter((name) => !defined.includes(name))
      .sort((a, b) => a.localeCompare(b))
    return [...defined, ...extra]
  })

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
        class="h-8 cursor-pointer flex-row items-center gap-2 rounded px-2 transition hover:bg-accent"
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
              'h-8 cursor-pointer flex-row items-center gap-2 rounded px-2 transition ' +
              (tagFilters().includes(tag) ? 'bg-accent' : 'hover:bg-accent')
            }
            indicatorClass="w-4 items-center justify-center opacity-0 checked:opacity-100"
            indicator={<Icon name="check" size={12} color={token('primary')} />}
            accessibilityLabel={tag}
            onSelect={() => setTagFilter(tag)}
          >
            <TagPill
              label={tag}
              color={tagColorOf(tag)}
              class={tagFilters().includes(tag) ? 'ring-2 ring-primary' : 'opacity-90'}
            />
          </MenuItem>
        ))}
      </If>

      {/* 没有任何标签时给个禁用占位，避免空菜单。 */}
      <If when={allTags().length === 0}>
        <MenuItem
          disabled
          class="h-8 cursor-not-allowed flex-row items-center rounded px-2"
          accessibilityLabel={t('entry.allTags')}
        >
          <Text class="text-xs text-muted-foreground">{t('entry.allTags')}</Text>
        </MenuItem>
      </If>
    </Menu>
  )
}
