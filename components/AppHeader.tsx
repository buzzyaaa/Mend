import { Text, View } from 'nsh'
import { t } from 'nsh/i18n'

import { bucketTitle, presetsOpen } from '../lib/state'
import { IconButton } from './ui'

/** 顶部只保留当前分类标题与预设入口。
 *  应用名/版本已由系统标题栏显示，搜索框移到了密码列表顶部。 */
export function AppHeader(props: { compact: () => boolean; onOpenCategories?: () => void }) {
  return (
    <View class="border-b border-border bg-card">
      <View class="h-10 flex-row items-center gap-1.5 px-2.5">
        <If when={props.compact()}>
          <IconButton
            icon="menu"
            label={t('nav.categories')}
            onPress={() => props.onOpenCategories?.()}
          />
        </If>

        <Text class="flex-1 text-sm font-semibold text-foreground" style={{ numberOfLines: 1 }}>
          {bucketTitle()}
        </Text>

        <IconButton
          icon="clipboard-list"
          label={t('nav.presets')}
          onPress={() => presetsOpen.set(true)}
        />
      </View>
    </View>
  )
}
