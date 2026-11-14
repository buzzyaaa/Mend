import { appInfo, Text, token, View } from 'nsh'
import { Input } from 'nsh/base'
import { t } from 'nsh/i18n'

import {
  bucketTitle,
  currentCategoryId,
  entryEditor,
  keyword,
  lockVault,
  presetsOpen,
  setKeyword,
  settingsOpen,
} from '../lib/state'
import { Icon } from './Icon'
import { ActionButton, IconButton } from './ui'

export function AppHeader(props: { compact: () => boolean; onOpenCategories?: () => void }) {
  const version = appInfo().version ?? '0.4.0'

  const search = (
    <View class="h-8 flex-1 flex-row items-center gap-1.5 rounded-md border border-input bg-background px-2">
      <Icon name="search" size={14} color={token('muted-foreground')} />
      <Input
        value={keyword()}
        onChange={(event) => setKeyword(event.value)}
        placeholder={t('entry.searchPlaceholder')}
        accessibilityLabel={t('entry.searchPlaceholder')}
        class="h-7 flex-1 border-0 bg-transparent px-0 text-xs"
        // `Input` 的 token 颜色类不可靠（值有效但文字不显示），显式给文字样式。
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
          class="h-6 w-6"
          onPress={() => setKeyword('')}
        />
      </If>
    </View>
  )

  return (
    <View class="border-b border-border bg-card">
      <View class="h-10 flex-row items-center gap-1.5 px-2.5">
        <If when={props.compact()}>
          <IconButton
            icon="menu"
            label={t('nav.categories')}
            onPress={() => props.onOpenCategories?.()}
          />
          <Text class="flex-1 text-sm font-semibold text-foreground" style={{ numberOfLines: 1 }}>
            {bucketTitle()}
          </Text>
          <IconButton
            icon="plus"
            label={t('entry.add')}
            testID="add-entry"
            onPress={() =>
              entryEditor.set({
                id: null,
                categoryId: currentCategoryId(),
              })
            }
          />
          <IconButton
            icon="settings"
            label={t('nav.settings')}
            onPress={() => settingsOpen.set(true)}
          />
        </If>

        <If when={!props.compact()}>
          <View class="flex-row items-center gap-1.5">
            <View class="h-7 w-7 items-center justify-center rounded-lg bg-primary">
              <Icon name="shield" size={14} color={token('primary-foreground')} />
            </View>
            <Text class="text-sm font-semibold tracking-tight text-foreground">
              {t('app.name')}
            </Text>
            <Text class="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {`v${version}`}
            </Text>
          </View>

          <View class="mx-3 flex-1 flex-row items-center justify-center">
            <View class="w-full max-w-[440px]">{search}</View>
          </View>

          <View class="flex-row items-center gap-1">
            <ActionButton
              label={t('entry.add')}
              icon="plus"
              variant="primary"
              testID="add-entry"
              onPress={() =>
                entryEditor.set({
                  id: null,
                  categoryId: currentCategoryId(),
                })
              }
            />
            <IconButton icon="key" label={t('nav.presets')} onPress={() => presetsOpen.set(true)} />
            <IconButton
              icon="settings"
              label={t('nav.settings')}
              onPress={() => settingsOpen.set(true)}
            />
            <IconButton icon="lock" label={t('header.lock')} onPress={() => void lockVault()} />
          </View>
        </If>
      </View>

      <If when={props.compact()}>
        <View class="flex-row items-center gap-1.5 px-2.5 pb-2">
          {search}
          <IconButton icon="key" label={t('nav.presets')} onPress={() => presetsOpen.set(true)} />
          <IconButton icon="lock" label={t('header.lock')} onPress={() => void lockVault()} />
        </View>
      </If>
    </View>
  )
}
