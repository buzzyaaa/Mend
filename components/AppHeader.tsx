import { Text, View } from 'nsh'
import { t } from 'nsh/i18n'

import { bucketTitle, presetsOpen, tagsOpen } from '../lib/state'
import { ActionButton, IconButton } from './ui'

/** 顶部标题栏：当前分类标题 + 右上角维护入口。
 *
 *  「预设值」「标签」都用图标 + 文字，宽屏/窄屏都能一眼看出入口含义；
 *  标签维护是 0.5.x 新增的独立弹窗（与预设值同级），条目编辑里只能选标签。 */
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
      </View>
    </View>
  )
}
