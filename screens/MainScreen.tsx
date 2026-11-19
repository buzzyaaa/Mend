import { computed, effect, platform, Text, View, windowSize } from 'nsh'
import { Dialog, ResizablePanel, ResizablePanelGroup } from 'nsh/base'
import { t } from 'nsh/i18n'

import { AppHeader } from '../components/AppHeader'
import { CategoryEditor } from '../components/CategoryEditor'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EntryDetail } from '../components/EntryDetail'
import { EntryEditor } from '../components/EntryEditor'
import { EntryList } from '../components/EntryList'
import { NavRail } from '../components/NavRail'
import { NotesDialog } from '../components/NotesDialog'
import { PresetsDialog } from '../components/PresetsDialog'
import { SettingsPage } from '../components/SettingsDialog'
import { Sidebar } from '../components/Sidebar'
import { TagsDialog } from '../components/TagsDialog'
import { UpdateDialog } from '../components/UpdateDialog'
import { UpdateProgressHost } from '../components/UpdateProgressHost'
import { IconButton, MODAL_BACKDROP_CLASS, MODAL_CLASS, ModalFrame } from '../components/ui'
import { preferences, setColumnSizes } from '../lib/preferences'
import { startSiteIconFetch } from '../lib/site-icons-cache'
import { checkForUpdatesOnStartup, clearUpdateCheckResult } from '../lib/update'
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

let startupUpdateCheckRequested = false

export function MainScreen() {
  startAutoLock()

  // 进入主界面后检查一次新版本：静默检查，有更新才弹窗。
  // 模块级 flag 防止锁屏/解锁重挂载导致的重复检查。
  effect(() => {
    if (startupUpdateCheckRequested) return
    startupUpdateCheckRequested = true
    void checkForUpdatesOnStartup()
  })

  // 站点图标：解锁后等列表静下来，再一批批补齐列表行首的真实 favicon。
  // 开关关掉时内部直接返回，不会发任何请求。
  effect(() => {
    startSiteIconFetch()
  })

  // 手动检查更新的结果只属于设置页：离开时清掉，下次进入不残留旧横幅。
  effect(() => {
    if (activePage() !== 'settings') clearUpdateCheckResult()
  })

  const compact = computed(
    () => platform.idiom === 'phone' || platform.idiom === 'pad' || windowSize().width < 900,
  )
  // 应用快速导航：< 600 放底部，其余宽度保持最左侧竖栏（设置页改版要求
  // 600–899 的窄窗口也保留图标栏）；密码列表的单列断点仍是 900。
  const bottomRail = computed(() => platform.idiom === 'phone' || windowSize().width < 600)
  const sidebarWidth = () => preferences().columnSizes[0] ?? 240

  const content = (
    <View class="flex-1 min-h-0">
      {/* 桌面三列：第三列自带工具栏（搜索/筛选/新建），不再需要独立标题栏。
          窄屏单列：分类入口收进 AppHeader 的菜单按钮。设置页自带头部，
          不再叠加列表页的 AppHeader。 */}
      <If when={compact() && activePage() !== 'settings'}>
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
      {/* 宽屏：最左侧纵向图标栏；其余区域是标题栏 + 页面内容。 */}
      <If when={!bottomRail()}>
        <View class="flex-1 min-h-0 flex-row">
          <NavRail />
          {content}
        </View>
      </If>

      {/* 手机：同样的三个动作横放在底部，内容区占满剩余高度。 */}
      <If when={bottomRail()}>
        <View class="flex-1 min-h-0">{content}</View>
        <NavRail compact />
      </If>

      <If when={entryEditor()}>{(state) => <EntryEditor state={state()} />}</If>

      <If when={categoryEditor()}>{(state) => <CategoryEditor state={state()} />}</If>

      <UpdateDialog />
      <PresetsDialog />
      <TagsDialog />
      <NotesDialog />
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
