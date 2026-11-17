import { View } from 'nsh'
import { t } from 'nsh/i18n'

import { activePage, closeDetail, lockVault, toast } from '../lib/state'
import { IconButton } from './ui'

/** 解锁后的左侧功能导航栏：列表 / 设置 / 锁定，底部保留扩展入口。
 *  紧凑布局下复用同一组动作（不含扩展位），横向放在内容区下方。 */
export function NavRail(props: { compact?: boolean }) {
  const actions = (
    <>
      <IconButton
        icon="list"
        label={t('entry.listTitle')}
        testID="nav-entries"
        active={activePage() === 'entries'}
        size={18}
        class="h-10 w-10 rounded-xl"
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
        size={18}
        class="h-10 w-10 rounded-xl"
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
      </View>
    )
  }

  return (
    <View class="h-full w-16 shrink-0 items-center gap-2 border-r border-border bg-secondary py-3">
      {actions}
      {/* 扩展预留位：后续模块（安全中心/生成器/导入导出）从这里进入，不重做布局。 */}
      <View class="flex-1" />
      <IconButton
        icon="plus"
        label={t('nav.extensions')}
        size={18}
        class="h-10 w-10 rounded-xl border border-dashed border-border"
        onPress={() => toast(t('nav.extensions'), 'info')}
      />
    </View>
  )
}
