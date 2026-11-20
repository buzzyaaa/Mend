import { signal, Text, token, View } from 'nsh'
import { Menu, MenuItem, MenuSeparator } from 'nsh/base'
import { t } from 'nsh/i18n'

import { preferences } from '../lib/preferences'
import {
  activePage,
  closeDetail,
  lockVault,
  pickExistingVaultFile,
  pickNewVaultFile,
  status,
  switchToVaultFile,
  useDefaultVaultFile,
} from '../lib/state'
import { Icon } from './Icon'
import { IconButton } from './ui'

/** 解锁后的左侧功能导航栏：列表 / 设置 / 锁定，底部是「切换数据库」入口。
 *  紧凑布局下复用同一组动作（含切换位），横向放在内容区下方。
 *  选中项用品牌色底 + 品牌色图标，与设置子导航的选中态一致。 */
export function NavRail(props: { compact?: boolean }) {
  const currentPath = () => status().dbPath
  const recent = () => preferences().recentVaults
  const switchOpen = signal(false)

  /** 路径只显示文件名，完整路径在 tooltip（accessibilityLabel）里可读。 */
  const baseName = (path: string) => {
    const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    return cut >= 0 ? path.slice(cut + 1) : path
  }

  const recentItems = () =>
    recent().map((path, index) => {
      const isCurrent = path === currentPath()
      return (
        <MenuItem
          class="h-8 flex-row items-center gap-2 rounded px-2 hover:bg-accent"
          accessibilityLabel={path}
          testID={`nav-switch-recent-${index}`}
          onSelect={() => {
            if (!isCurrent) void switchToVaultFile(path)
          }}
        >
          <View class="w-4 items-center justify-center">
            {isCurrent ? <Icon name="check" size={13} color={token('primary')} /> : null}
          </View>
          <Text class="max-w-[220px] text-xs text-popover-foreground" style={{ numberOfLines: 1 }}>
            {baseName(path)}
          </Text>
        </MenuItem>
      )
    })

  const switcher = (
    <Menu
      open={switchOpen()}
      onOpenChange={(event) => switchOpen.set(event.open)}
      placement="top"
      align="end"
      offset={6}
      margin={8}
      popupClass="max-h-[360px] min-w-[240px] rounded-lg border border-border bg-popover p-1.5 shadow-lg"
      trigger={
        <View
          role="button"
          accessibilityLabel={t('nav.switchVault')}
          testID="nav-switch"
          class="h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-dashed border-border transition hover:bg-accent"
        >
          <Icon name="database" size={18} color={token('muted-foreground')} />
        </View>
      }
    >
      <Text class="px-2 py-1 text-[11px] text-muted-foreground">{t('vault.recentTitle')}</Text>
      {recent().length > 0 ? (
        recentItems()
      ) : (
        <Text class="px-2 py-1.5 text-xs text-muted-foreground">{t('vault.noRecent')}</Text>
      )}
      <MenuSeparator class="my-1 h-px bg-border" />
      <MenuItem
        class="h-8 flex-row items-center gap-2 rounded px-2 hover:bg-accent"
        accessibilityLabel={t('vault.switch')}
        testID="nav-switch-other"
        onSelect={() => void pickExistingVaultFile()}
      >
        <View class="w-4 items-center justify-center">
          <Icon name="folder" size={13} color={token('muted-foreground')} />
        </View>
        <Text class="text-xs text-popover-foreground">{t('vault.switch')}</Text>
      </MenuItem>
      <MenuItem
        class="h-8 flex-row items-center gap-2 rounded px-2 hover:bg-accent"
        accessibilityLabel={t('vault.create')}
        testID="nav-switch-new"
        onSelect={() => void pickNewVaultFile()}
      >
        <View class="w-4 items-center justify-center">
          <Icon name="plus" size={13} color={token('muted-foreground')} />
        </View>
        <Text class="text-xs text-popover-foreground">{t('vault.create')}</Text>
      </MenuItem>
      <MenuItem
        class="h-8 flex-row items-center gap-2 rounded px-2 hover:bg-accent"
        accessibilityLabel={t('vault.useDefault')}
        testID="nav-switch-default"
        onSelect={() => void useDefaultVaultFile()}
      >
        <View class="w-4 items-center justify-center">
          <Icon name="restore" size={13} color={token('muted-foreground')} />
        </View>
        <Text class="text-xs text-popover-foreground">{t('vault.useDefault')}</Text>
      </MenuItem>
    </Menu>
  )

  const actions = (
    <>
      <IconButton
        icon="list"
        label={t('entry.listTitle')}
        testID="nav-entries"
        active={activePage() === 'entries'}
        iconColor={activePage() === 'entries' ? token('primary') : undefined}
        size={18}
        class={'h-10 w-10 rounded-xl ' + (activePage() === 'entries' ? 'bg-primary/10' : '')}
        onPress={() => {
          closeDetail()
          activePage.set('entries')
        }}
      />
      <IconButton
        icon="settings"
        label={t('nav.settings')}
        testID="nav-settings"
        active={activePage() === 'settings'}
        iconColor={activePage() === 'settings' ? token('primary') : undefined}
        size={18}
        class={'h-10 w-10 rounded-xl ' + (activePage() === 'settings' ? 'bg-primary/10' : '')}
        onPress={() => {
          closeDetail()
          activePage.set('settings')
        }}
      />
      <IconButton
        icon="lock"
        label={t('header.lock')}
        testID="nav-lock"
        size={18}
        class="h-10 w-10 rounded-xl"
        onPress={() => void lockVault()}
      />
    </>
  )

  if (props.compact) {
    return (
      <View class="flex-row items-center justify-around border-t border-border bg-card px-2 py-1">
        {actions}
        {switcher}
      </View>
    )
  }

  return (
    <View class="h-full w-16 shrink-0 items-center gap-2 border-r border-border bg-secondary py-3">
      {actions}
      <View class="flex-1" />
      {switcher}
    </View>
  )
}
