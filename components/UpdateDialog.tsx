import { Scroll, Text, token, View, windowSize } from 'nsh'
import { Dialog, TextView } from 'nsh/base'
import { t } from 'nsh/i18n'

import { closeUpdatePrompt, startUpdate, updateApp, updatePackage } from '../lib/update'
import { updatePromptOpen, updateTarget } from '../lib/state'

import { Icon } from './Icon'
import { ActionButton, IconButton, MODAL_BACKDROP_CLASS, MODAL_CLASS, ModalFrame } from './ui'

/** 更新确认弹窗：固定高度，Changelog 区域独立滚动，底部两个操作按钮。 */
export function UpdateDialog() {
  const isPackage = () => updateTarget() === 'package'
  const notes = () => (isPackage() ? updatePackage()?.notes : updateApp()?.notes)?.trim() ?? ''
  const version = () =>
    isPackage() ? (updatePackage()?.version ?? '') : (updateApp()?.version ?? '')
  const title = () =>
    isPackage()
      ? t('update.promptPackageTitle', { version: version() })
      : t('update.promptTitle', { version: version() })
  const height = () => Math.min(420, Math.max(320, windowSize().height - 120))

  return (
    <Dialog
      open={updatePromptOpen()}
      class={MODAL_CLASS}
      backdropClass={MODAL_BACKDROP_CLASS}
      closeOnBackdropPress={false}
      onCancel={closeUpdatePrompt}
      onOpenChange={(event) => {
        if (!event.open) closeUpdatePrompt()
      }}
      accessibilityLabel={title()}
      style={{ width: 520, maxWidth: '92%', height: height() }}
    >
      <ModalFrame
        class="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        maxHeight={height()}
      >
        <View class="flex-row items-start gap-3 border-b border-border px-5 py-3">
          <View class="h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <Icon name="download" size={15} color={token('primary-foreground')} />
          </View>
          <View class="flex-1 gap-0.5">
            <Text class="text-sm font-semibold text-foreground">{title()}</Text>
            <Text class="text-[11px] text-muted-foreground">{t('update.notesTitle')}</Text>
          </View>
          <IconButton
            icon="close"
            label={t('common.close')}
            testID="update-prompt-close"
            onPress={closeUpdatePrompt}
          />
        </View>

        <Scroll class="min-h-0 flex-1" style={{ height: height() - 148 }} contentClass="p-4">
          <View class="rounded-lg border border-border bg-background p-3">
            <If when={notes()}>
              {(value) => (
                <TextView
                  markdown={value()}
                  selectable
                  links="open"
                  class="text-xs text-foreground"
                  classes={{
                    heading1: 'text-sm font-semibold',
                    heading2: 'text-xs font-semibold',
                    heading3: 'text-xs font-semibold',
                    code: 'font-mono bg-muted',
                    link: 'text-primary underline',
                  }}
                />
              )}
            </If>
            <If when={!notes()}>
              <Text class="text-xs text-muted-foreground">{t('update.noNotes')}</Text>
            </If>
          </View>
        </Scroll>

        <View class="flex-row items-center gap-2 border-t border-border px-5 py-3">
          <View class="flex-1" />
          <ActionButton label={t('common.cancel')} onPress={closeUpdatePrompt} />
          <ActionButton
            label={t('update.updateNow')}
            icon="download"
            variant="primary"
            testID="update-prompt-confirm"
            onPress={() => void startUpdate()}
          />
        </View>
      </ModalFrame>
    </Dialog>
  )
}
