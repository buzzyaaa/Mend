import { computed, platform, Text, View, windowSize } from 'nsh'
import { Dialog, ResizablePanel, ResizablePanelGroup } from 'nsh/base'
import { t } from 'nsh/i18n'

import { AppHeader } from '../components/AppHeader'
import { CategoryEditor } from '../components/CategoryEditor'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EntryDetail } from '../components/EntryDetail'
import { EntryEditor } from '../components/EntryEditor'
import { EntryList } from '../components/EntryList'
import { PresetsDialog } from '../components/PresetsDialog'
import { SettingsDialog } from '../components/SettingsDialog'
import { Sidebar } from '../components/Sidebar'
import { ToastHost } from '../components/ToastHost'
import { IconButton, MODAL_BACKDROP_CLASS, MODAL_CLASS, ModalFrame } from '../components/ui'
import { preferences, setColumnSizes } from '../lib/preferences'
import {
  categoriesSheetOpen,
  categoryEditor,
  entryEditor,
  selectedId,
  startAutoLock,
} from '../lib/state'

export function MainScreen() {
  startAutoLock()

  const compact = computed(
    () => platform.idiom === 'phone' || platform.idiom === 'pad' || windowSize().width < 900,
  )
  const sidebarWidth = () => preferences().columnSizes[0] ?? 240
  const listWidth = () => preferences().columnSizes[1] ?? 360

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
      <AppHeader compact={compact} onOpenCategories={() => categoriesSheetOpen.set(true)} />

      <If when={!compact()}>
        <ResizablePanelGroup
          axis="horizontal"
          class="flex-1 min-h-0"
          handleClass="w-px bg-border group-hover:bg-primary"
          handleThumbClass="h-5 w-[3px] rounded-full bg-muted-foreground opacity-0 group-hover:opacity-40"
          onResize={(event) => setColumnSizes(event.sizes)}
        >
          <ResizablePanel size={sidebarWidth()} minSize={180} maxSize={360} fixed>
            <Sidebar />
          </ResizablePanel>
          <ResizablePanel size={listWidth()} minSize={260} maxSize={640}>
            <View class="h-full min-h-0 bg-background">
              <EntryList />
            </View>
          </ResizablePanel>
          <ResizablePanel minSize={260}>
            <EntryDetail />
          </ResizablePanel>
        </ResizablePanelGroup>
      </If>

      <If when={compact()}>
        <View class="flex-1 min-h-0">
          <If when={selectedId() !== null}>
            <EntryDetail compact />
          </If>
          <If when={selectedId() === null}>
            <EntryList />
          </If>
        </View>
      </If>

      <If when={entryEditor()}>{(state) => <EntryEditor state={state()} />}</If>

      <If when={categoryEditor()}>{(state) => <CategoryEditor state={state()} />}</If>

      <SettingsDialog />
      <PresetsDialog />
      <ConfirmDialog />
      <ToastHost />

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
