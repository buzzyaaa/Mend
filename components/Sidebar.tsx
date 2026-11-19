import { PanResponder, Scroll, signal, Text, token, View } from 'nsh'
import { Menu, MenuItem, MenuSeparator } from 'nsh/base'
import { t } from 'nsh/i18n'

import { categoryEmoji } from '../lib/category-icons'
import {
  bucket,
  categories,
  categoryEditor,
  confirm,
  removeCategory,
  reorderCategories,
  selectBucket,
} from '../lib/state'
import type { Category } from '../lib/types'
import { Icon, type IconName } from './Icon'
import { ActionButton, IconButton } from './ui'

const BUCKETS: { id: string; label: string; icon: IconName }[] = [
  { id: 'all', label: 'nav.all', icon: 'folder' },
  { id: 'favorites', label: 'nav.starred', icon: 'star' },
  { id: 'archive', label: 'nav.archive', icon: 'archive' },
  { id: 'trash', label: 'nav.trash', icon: 'trash' },
]

/** 分类行高 h-9（36）＋ gap-0.5（2），拖动 dy 除以它得到跨了几行。 */
const CATEGORY_ROW_STEP = 38

function BucketRow(props: { id: string; label: string; icon: IconName; onNavigate?: () => void }) {
  const active = () => bucket() === props.id
  return (
    <View
      class={
        'h-9 flex-row items-center gap-2.5 rounded-lg px-2.5 ' +
        (active() ? 'bg-accent ' : 'hover:bg-secondary ')
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
        color={active() ? token('primary') : token('muted-foreground')}
      />
      <Text
        class={'flex-1 text-[13px] ' + (active() ? 'font-medium text-primary' : 'text-foreground')}
      >
        {t(props.label)}
      </Text>
    </View>
  )
}

function CategoryRow(props: {
  category: Category
  index: number
  dragging: boolean
  menuOpen: boolean
  onMenuOpen: () => void
  onMenuClose: () => void
  onNavigate?: () => void
  onDragStart: (id: string) => void
  onDragPreview: (from: number, steps: number) => void
  onDragCommit: () => void
  onDragCancel: () => void
  onDragEnd: () => void
}) {
  const active = () => bucket() === props.category.id
  // 仅在悬停时把数量换成 ···，菜单本身必须由点击触发，避免指针经过时误弹。
  const moreHovered = signal(false)
  const showMore = () => moreHovered() || props.menuOpen

  const startIndex = { value: 0 }
  const moved = { value: false }
  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      startIndex.value = props.index
      moved.value = false
    },
    onPanResponderMove: (_event, state) => {
      if (!moved.value && Math.abs(state.dy) < 4) return
      if (!moved.value) {
        moved.value = true
        props.onMenuClose()
        props.onDragStart(props.category.id)
      }
      props.onDragPreview(startIndex.value, Math.round(state.dy / CATEGORY_ROW_STEP))
    },
    onPanResponderRelease: () => {
      if (moved.value) props.onDragCommit()
      props.onDragEnd()
    },
    onPanResponderTerminate: () => {
      props.onDragCancel()
      props.onDragEnd()
    },
  })
  return (
    <View
      {...responder.panHandlers}
      class={
        'group h-9 flex-row items-center gap-2 rounded-lg px-2 ' +
        (active() ? 'bg-accent ' : 'hover:bg-secondary ') +
        (props.dragging ? 'opacity-70 ring-1 ring-primary ' : '')
      }
      style={{ cursor: 'grab' }}
      onPress={() => {
        // 拖拽结束时浏览器/原生层仍可能补一个 press，不能顺手切走当前分组。
        if (moved.value) return
        selectBucket(props.category.id)
        props.onNavigate?.()
      }}
      role="button"
      accessibilityLabel={props.category.name}
      testID={`category-${props.category.id}`}
    >
      <View class="w-3 items-center justify-center opacity-0 group-hover:opacity-100">
        <Icon name="menu" size={12} color={token('muted-foreground')} />
      </View>
      <View
        class="h-6 w-6 items-center justify-center rounded-md"
        style={{
          backgroundColor: props.category.color ? `${props.category.color}22` : token('muted'),
        }}
      >
        <Text class="text-[12px]">{categoryEmoji(props.category.icon)}</Text>
      </View>
      <Text
        class={'flex-1 text-[13px] ' + (active() ? 'font-medium text-primary' : 'text-foreground')}
        style={{ numberOfLines: 1 }}
      >
        {props.category.name}
      </Text>
      {/* 数量固定在最右；悬停原位变成 ···，点击 ··· 才弹出 nsh Menu。 */}
      <View
        class="h-6 w-6 flex-row items-center justify-center"
        testID={`category-count-slot-${props.category.name}`}
        onMouseEnter={() => moreHovered.set(true)}
        onMouseLeave={() => moreHovered.set(false)}
      >
        <View
          class={showMore() ? 'hidden' : 'flex'}
          testID={`category-count-${props.category.name}`}
        >
          <Text class="text-[11px] text-muted-foreground">{String(props.category.entryCount)}</Text>
        </View>
        <Menu
          open={props.menuOpen}
          onOpenChange={(event) => {
            if (event.open) props.onMenuOpen()
            else props.onMenuClose()
          }}
          placement="bottom"
          align="end"
          offset={6}
          margin={8}
          popupClass="min-w-[152px] rounded-lg border border-border bg-popover p-1.5 shadow-lg"
          trigger={
            <View
              class={
                (showMore() ? 'flex' : 'hidden') +
                ' h-6 w-6 flex-row items-center justify-center rounded-md hover:bg-accent'
              }
              role="button"
              accessibilityLabel={`${t('common.actions')} ${props.category.name}`}
              testID={`category-menu-${props.category.name}`}
            >
              <Icon name="more-horizontal" size={14} color={token('muted-foreground')} />
            </View>
          }
        >
          <MenuItem
            class="h-8 min-w-[152px] flex-row items-center rounded-md px-2.5 hover:bg-accent focus:bg-accent"
            accessibilityLabel={t('common.edit')}
            testID={`category-edit-${props.category.name}`}
            onSelect={() => categoryEditor.set({ id: props.category.id })}
          >
            <Text class="text-xs text-popover-foreground">{t('common.edit')}</Text>
          </MenuItem>
          <MenuSeparator class="my-1 h-px bg-border" />
          <MenuItem
            class="h-8 min-w-[152px] flex-row items-center rounded-md px-2.5 hover:bg-accent focus:bg-accent"
            accessibilityLabel={t('sidebar.delete')}
            testID={`category-delete-${props.category.name}`}
            onSelect={() =>
              confirm.set({
                title: t('sidebar.delete'),
                message: t('sidebar.deleteConfirm'),
                confirmLabel: t('common.delete'),
                destructive: true,
                onConfirm: () => void removeCategory(props.category.id),
              })
            }
          >
            <Text class="text-xs text-destructive">{t('sidebar.delete')}</Text>
          </MenuItem>
        </Menu>
      </View>
    </View>
  )
}

export function Sidebar(props: { onNavigate?: () => void; compact?: boolean }) {
  // 拖动中的预览顺序；null 表示直接用库里的顺序（categories() 已按 sort_order 排好）。
  const dragOrder = signal<string[] | null>(null)
  const draggingId = signal<string | null>(null)
  const openMenuId = signal<string | null>(null)

  function shownCategories(): Category[] {
    const order = dragOrder()
    const list = categories()
    if (!order) return list
    const byId = new Map(list.map((item) => [item.id, item]))
    const ordered = order
      .map((id) => byId.get(id))
      .filter((item): item is Category => item !== undefined)
    // 拖动期间若库里多了分类，追加在末尾，不让任何一行凭空消失。
    for (const item of list) {
      if (!ordered.some((shown) => shown.id === item.id)) ordered.push(item)
    }
    return ordered
  }

  function previewOrder(from: number, steps: number) {
    const list = categories()
    if (list.length < 2) return
    const base = list.map((item) => item.id)
    const to = Math.max(0, Math.min(base.length - 1, from + steps))
    if (to === from) {
      dragOrder.set(base)
      return
    }
    const next = [...base]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    dragOrder.set(next)
  }

  async function commitOrder() {
    const ids = dragOrder()
    if (!ids) return
    const current = categories().map((item) => item.id)
    if (ids.every((id, index) => id === current[index])) {
      dragOrder.set(null)
      return
    }
    // 等 refreshCategories 完成后再撤预览，避免顺序先弹回去再跳到新位置。
    await reorderCategories(ids)
    dragOrder.set(null)
  }

  return (
    <View class="h-full w-full bg-card">
      <Scroll class="flex-1" contentClass="gap-1 p-3">
        {/* 分类管理标题 + 新增分类 */}
        <View class="flex-row items-center justify-between px-1 pb-1 pt-1">
          <Text class="text-sm font-semibold text-foreground">{t('nav.categoryManage')}</Text>
          <IconButton
            icon="plus"
            label={t('nav.addCategory')}
            size={15}
            class="h-6 w-6 rounded-md bg-secondary"
            onPress={() => categoryEditor.set({ id: null })}
          />
        </View>

        {/* 系统分类 */}
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

        {/* 我的分组 */}
        <View class="flex-row items-center justify-between px-1 pb-1 pt-4">
          <Text class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('nav.myGroups')}
          </Text>
        </View>

        <If when={categories().length === 0}>
          <Text class="px-2.5 py-1 text-xs text-muted-foreground">{t('sidebar.placeholder')}</Text>
        </If>
        <View class="flex-1 gap-0.5">
          <Each of={shownCategories()} key={(item) => item.id}>
            {(item, index) => (
              <CategoryRow
                category={item()}
                index={index()}
                dragging={draggingId() === item().id}
                menuOpen={openMenuId() === item().id}
                onMenuOpen={() => openMenuId.set(item().id)}
                onMenuClose={() => openMenuId.set(null)}
                onNavigate={props.onNavigate}
                onDragStart={(id) => draggingId.set(id)}
                onDragPreview={previewOrder}
                onDragCommit={() => void commitOrder()}
                onDragCancel={() => dragOrder.set(null)}
                onDragEnd={() => draggingId.set(null)}
              />
            )}
          </Each>
        </View>

        {/* 新建分组 */}
        <ActionButton
          label={t('nav.newGroup')}
          icon="plus"
          variant="secondary"
          class="mt-2 w-full border-dashed"
          onPress={() => categoryEditor.set({ id: null })}
        />
      </Scroll>
    </View>
  )
}
