import { computed, platform, Text, View, windowSize } from 'nsh'
import { Dialog } from 'nsh/base'
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
import { IconButton } from '../components/ui'
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
        <View class="flex-1 min-h-0 flex-row">
          <Sidebar />
          <View class="flex-1 min-h-0">
            <View class="flex-1 min-h-0 flex-row">
              <View class="min-h-0 border-r border-border bg-background" style={{ width: 360 }}>
                <EntryList />
              </View>
              <EntryDetail />
            </View>
          </View>
        </View>
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
        closeOnBackdropPress
        onCancel={() => categoriesSheetOpen.set(false)}
        onOpenChange={(event) => {
          if (!event.open) categoriesSheetOpen.set(false)
        }}
        accessibilityLabel={t('nav.categories')}
        style={{ width: 340, maxWidth: '90%', height: '80%' }}
      >
        <View class="h-full overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          <View class="flex-row items-center justify-between border-b border-border px-3 py-2">
            <Text class="text-sm font-semibold text-foreground">{t('nav.categories')}</Text>
            <IconButton
              icon="close"
              label={t('common.close')}
              onPress={() => categoriesSheetOpen.set(false)}
            />
          </View>
          <Sidebar compact onNavigate={() => categoriesSheetOpen.set(false)} />
        </View>
      </Dialog>
    </View>
  )
}
