import { computed, platform, Text, View, windowSize } from 'nsh'
import { Dialog, ResizablePanel, ResizablePanelGroup } from 'nsh/base'
import { t } from 'nsh/i18n'

import { AppHeader } from '../components/AppHeader'
import { CategoryEditor } from '../components/CategoryEditor'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EntryDetail } from '../components/EntryDetail'
import { EntryEditor } from '../components/EntryEditor'
import { EntryList } from '../components/EntryList'
import { NavRail } from '../components/NavRail'
import { PresetsDialog } from '../components/PresetsDialog'
import { SettingsPage } from '../components/SettingsDialog'
import { Sidebar } from '../components/Sidebar'
import { UpdateDialog } from '../components/UpdateDialog'
import { UpdateProgressHost } from '../components/UpdateProgressHost'
import { IconButton, MODAL_BACKDROP_CLASS, MODAL_CLASS, ModalFrame } from '../components/ui'
import { preferences, setColumnSizes } from '../lib/preferences'
import {
  activePage,
  categoriesSheetOpen,
  categoryEditor,
  closeDetail,
  detailOpen,
  entryEditor,
  selected,
  startAutoLock,
} from '../lib/state'

export function MainScreen() {
  startAutoLock()

  const compact = computed(
    () => platform.idiom === 'phone' || platform.idiom === 'pad' || windowSize().width < 900,
  )
  const sidebarWidth = () => preferences().columnSizes[0] ?? 240

  const content = (
    <View class="flex-1 min-h-0">
      {/* 桌面三列：第三列自带工具栏（搜索/筛选/新建），不再需要独立标题栏。
          窄屏单列：分类入口收进 AppHeader 的菜单按钮。 */}
      <If when={compact()}>
        <AppHeader compact={compact} onOpenCategories={() => categoriesSheetOpen.set(true)} />
      </If>

      <If when={activePage() === 'settings'}>
        <SettingsPage />
      </If>

      <If when={activePage() === 'entries'}>
        <If when={!compact()}>
          <ResizablePanelGroup
            axis="horizontal"
            class="flex-1 min-h-0"
            handleClass="w-px bg-border group-hover:bg-primary"
            handleThumbClass="h-5 w-[3px] rounded-full bg-muted-foreground opacity-0 group-hover:opacity-40"
            onResize={(event) => setColumnSizes(event.sizes)}
          >
            <ResizablePanel size={sidebarWidth()} minSize={200} maxSize={340} fixed>
              <Sidebar />
            </ResizablePanel>
            <ResizablePanel minSize={560}>
              <View class="h-full min-h-0 bg-background">
                <EntryList />
              </View>
            </ResizablePanel>
          </ResizablePanelGroup>
        </If>

        <If when={compact()}>
          <View class="flex-1 min-h-0">
            <EntryList />
          </View>
        </If>
      </If>
    </View>
  )

  return (
    <View
      class="flex-1 bg-background"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      {/* 桌面端：最左侧纵向图标栏；其余区域是标题栏 + 页面内容。 */}
      <If when={!compact()}>
        <View class="flex-1 min-h-0 flex-row">
          <NavRail />
          {content}
        </View>
      </If>

      {/* 窄屏：同样的三个动作横放在底部，内容区占满剩余高度。 */}
      <If when={compact()}>
        <View class="flex-1 min-h-0">{content}</View>
        <NavRail compact />
      </If>

      <If when={entryEditor()}>{(state) => <EntryEditor state={state()} />}</If>

      <If when={categoryEditor()}>{(state) => <CategoryEditor state={state()} />}</If>

      <UpdateDialog />
      <PresetsDialog />
      <ConfirmDialog />
      <UpdateProgressHost />

      {/* 列表里的「查看详情」按钮统一打开弹窗；右侧详情栏已移除。 */}
      <Dialog
        open={detailOpen() && selected() !== null}
        class={MODAL_CLASS}
        backdropClass={MODAL_BACKDROP_CLASS}
        closeOnBackdropPress
        onCancel={closeDetail}
        onOpenChange={(event) => {
          if (!event.open) closeDetail()
        }}
        accessibilityLabel={t('entry.details')}
        style={{ width: 720, maxWidth: '94%' }}
      >
        <ModalFrame
          class="overflow-hidden rounded-xl border border-border bg-card shadow-xl"
          maxHeight={Math.max(360, windowSize().height - 72)}
        >
          <View class="flex-row items-center justify-between border-b border-border px-3 py-2">
            <Text class="flex-1 text-sm font-semibold text-foreground" style={{ numberOfLines: 1 }}>
              {selected()?.title ?? t('entry.details')}
            </Text>
            <IconButton
              icon="close"
              label={t('common.close')}
              testID="detail-close"
              onPress={closeDetail}
            />
          </View>
          <EntryDetail compact />
        </ModalFrame>
      </Dialog>

      <Dialog
        open={categoriesSheetOpen()}
        class={MODAL_CLASS}
        backdropClass={MODAL_BACKDROP_CLASS}
        closeOnBackdropPress
        onCancel={() => categoriesSheetOpen.set(false)}
        onOpenChange={(event) => {
          if (!event.open) categoriesSheetOpen.set(false)
        }}
        accessibilityLabel={t('nav.categories')}
        style={{ width: 340, maxWidth: '90%', height: '80%' }}
      >
        <ModalFrame class="h-full overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          <View class="flex-row items-center justify-between border-b border-border px-2.5 py-2">
            <Text class="text-sm font-semibold text-foreground">{t('nav.categories')}</Text>
            <IconButton
              icon="close"
              label={t('common.close')}
              onPress={() => categoriesSheetOpen.set(false)}
            />
          </View>
          <Sidebar compact onNavigate={() => categoriesSheetOpen.set(false)} />
        </ModalFrame>
      </Dialog>
    </View>
  )
}
