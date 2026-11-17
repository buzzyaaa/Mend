import { computed, Text, token } from 'nsh'
import { Menu, MenuItem } from 'nsh/base'
import { t } from 'nsh/i18n'

import { preferences, setColumnVisible } from '../lib/preferences'
import type { ColumnKey } from '../lib/types'
import { Icon } from './Icon'
import { ActionButton } from './ui'

/** 五个可配置列；label 存 key 而不是 t() 结果，保证切换语言时文案跟着变。 */
const COLUMNS: ReadonlyArray<{ key: ColumnKey; labelKey: string }> = [
  { key: 'username', labelKey: 'entry.columnUsername' },
  { key: 'password', labelKey: 'entry.columnPassword' },
  { key: 'email', labelKey: 'entry.columnEmail' },
  { key: 'phone', labelKey: 'entry.columnPhone' },
  { key: 'notes', labelKey: 'entry.columnNotes' },
]

/** 列表列显示配置：无 props。
 *  每项 `checked` 绑定 `preferences().visibleColumns[col]`，`closeOnSelect={false}`
 *  让菜单保持展开，可连续开关多列。
 *  保底：至少保留一列可见——已是最后一列可见时禁用该项，禁止把它也关掉。 */
export function ColumnConfigMenu() {
  const visibleCount = computed(
    () => COLUMNS.filter((col) => preferences().visibleColumns[col.key]).length,
  )

  const trigger = <ActionButton icon="settings" label={t('entry.columns')} />

  return (
    <Menu
      placement="bottom"
      align="start"
      offset={6}
      popupClass="min-w-[176px] rounded-lg border border-border bg-popover p-1.5 shadow-lg"
      trigger={trigger}
    >
      {COLUMNS.map((col) => {
        const visible = preferences().visibleColumns[col.key]
        return (
          <MenuItem
            checked={visible}
            closeOnSelect={false}
            // 最后一列可见时禁止取消，避免出现只剩标题的空列表。
            disabled={visible && visibleCount() === 1}
            class="h-8 min-w-[176px] flex-row items-center gap-2 rounded px-2 hover:bg-accent"
            indicatorClass="w-4 items-center justify-center opacity-0 checked:opacity-100"
            indicator={<Icon name="check" size={12} color={token('primary')} />}
            accessibilityLabel={t(col.labelKey)}
            onSelect={() => setColumnVisible(col.key, !preferences().visibleColumns[col.key])}
          >
            <Text
              class={
                visible && visibleCount() === 1
                  ? 'text-xs text-muted-foreground'
                  : 'text-xs text-popover-foreground'
              }
            >
              {t(col.labelKey)}
            </Text>
          </MenuItem>
        )
      })}
    </Menu>
  )
}
