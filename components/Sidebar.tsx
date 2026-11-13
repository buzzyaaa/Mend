import { Text, token, View } from 'nsh'
import { t } from 'nsh/i18n'

import { categoryEmoji } from '../lib/category-icons'
import {
  bucket,
  categories,
  categoryEditor,
  confirm,
  removeCategory,
  selectBucket,
} from '../lib/state'
import type { Category } from '../lib/types'
import { Icon, type IconName } from './Icon'
import { IconButton } from './ui'

const BUCKETS: { id: string; label: string; icon: IconName }[] = [
  { id: 'all', label: 'nav.all', icon: 'list' },
  { id: 'favorites', label: 'nav.starred', icon: 'star' },
  { id: 'archive', label: 'nav.archive', icon: 'archive' },
  { id: 'uncategorized', label: 'nav.uncategorized', icon: 'folder' },
  { id: 'trash', label: 'nav.trash', icon: 'trash' },
]

function BucketRow(props: { id: string; label: string; icon: IconName; onNavigate?: () => void }) {
  const active = () => bucket() === props.id
  return (
    <View
      class={
        'h-9 flex-row items-center gap-2.5 rounded-md px-2.5 ' +
        (active()
          ? 'bg-accent text-foreground '
          : 'text-muted-foreground hover:bg-accent hover:text-foreground ')
      }
      onPress={() => {
        selectBucket(props.id)
        props.onNavigate?.()
      }}
      role="button"
      accessibilityLabel={t(props.label)}
    >
      <Icon
        name={props.id === 'favorites' && active() ? 'star-filled' : props.icon}
        size={16}
        color={active() ? token('foreground') : token('muted-foreground')}
      />
      <Text
        class={
          'flex-1 text-sm ' + (active() ? 'font-medium text-foreground' : 'text-muted-foreground')
        }
      >
        {t(props.label)}
      </Text>
    </View>
  )
}

function CategoryRow(props: { category: Category; onNavigate?: () => void }) {
  const active = () => bucket() === props.category.id
  return (
    <View
      class={
        'group h-9 flex-row items-center gap-2 rounded-md px-2 ' +
        (active() ? 'bg-accent ' : 'hover:bg-accent ')
      }
      onPress={() => {
        selectBucket(props.category.id)
        props.onNavigate?.()
      }}
      role="button"
      accessibilityLabel={props.category.name}
    >
      <View
        class="h-6 w-6 items-center justify-center rounded-md"
        style={{
          backgroundColor: props.category.color ? `${props.category.color}22` : token('muted'),
        }}
      >
        <Text class="text-[13px]">{categoryEmoji(props.category.icon)}</Text>
      </View>
      <Text
        class={
          'flex-1 text-sm ' + (active() ? 'font-medium text-foreground' : 'text-muted-foreground')
        }
        style={{ numberOfLines: 1 }}
      >
        {props.category.name}
      </Text>
      <Text class="text-[11px] text-muted-foreground">{String(props.category.entryCount)}</Text>
      <View class="flex-row items-center gap-0.5">
        <IconButton
          icon="edit"
          label={t('sidebar.rename')}
          size={14}
          class="h-6 w-6"
          onPress={() => categoryEditor.set({ id: props.category.id })}
        />
        <IconButton
          icon="trash"
          label={t('sidebar.delete')}
          size={14}
          class="h-6 w-6"
          onPress={() =>
            confirm.set({
              title: t('sidebar.delete'),
              message: t('sidebar.deleteConfirm'),
              confirmLabel: t('common.delete'),
              destructive: true,
              onConfirm: () => void removeCategory(props.category.id),
            })
          }
        />
      </View>
    </View>
  )
}

export function Sidebar(props: { onNavigate?: () => void; compact?: boolean }) {
  return (
    <View class={'h-full bg-card ' + (props.compact ? 'w-full' : 'w-60 border-r border-border')}>
      <View class="flex-1 gap-1 p-2.5">
        <View class="px-1.5 pb-1 pt-1">
          <Text class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('nav.categories')}
          </Text>
        </View>
        <Each of={BUCKETS} key={(item) => item.id}>
          {(item) => (
            <BucketRow
              id={item().id}
              label={item().label}
              icon={item().icon}
              onNavigate={props.onNavigate}
            />
          )}
        </Each>

        <If when={categories().length === 0}>
          <Text class="px-2.5 py-1 text-xs text-muted-foreground">{t('sidebar.placeholder')}</Text>
        </If>
        <View class="flex-1 gap-0.5">
          <Each of={categories()} key={(item) => item.id}>
            {(item) => <CategoryRow category={item()} onNavigate={props.onNavigate} />}
          </Each>
        </View>

        <View
          class="h-9 flex-row items-center gap-2 rounded-md px-2.5 text-muted-foreground hover:bg-accent"
          onPress={() => categoryEditor.set({ id: null })}
          role="button"
        >
          <Icon name="plus" size={15} color={token('muted-foreground')} />
          <Text class="text-sm text-muted-foreground">{t('nav.addCategory')}</Text>
        </View>
      </View>
    </View>
  )
}
