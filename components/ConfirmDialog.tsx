import { Text, View } from 'nsh'
import { t } from 'nsh/i18n'
import { Dialog } from 'nsh/base'

import { confirm } from '../lib/state'
import { ActionButton } from './ui'

export function ConfirmDialog() {
  return (
    <If when={confirm()}>
      {(state) => (
        <Dialog
          open={true}
          role={state().destructive ? 'alertdialog' : 'dialog'}
          animation="fade"
          closeOnBackdropPress={false}
          onCancel={() => confirm.set(null)}
          accessibilityLabel={state().title}
          accessibilityDescription={state().message}
          style={{ width: 420, maxWidth: '90%' }}
        >
          <View class="gap-4 rounded-xl border border-border bg-card p-5 shadow-xl">
            <View class="gap-1.5">
              <Text class="text-base font-semibold text-foreground">{state().title}</Text>
              <Text class="text-sm text-muted-foreground">{state().message}</Text>
            </View>
            <View class="flex-row justify-end gap-2">
              <ActionButton
                label={t('common.cancel')}
                variant="ghost"
                onPress={() => confirm.set(null)}
              />
              <ActionButton
                label={state().confirmLabel}
                variant={state().destructive ? 'danger' : 'primary'}
                onPress={() => {
                  const action = state().onConfirm
                  confirm.set(null)
                  void action()
                }}
              />
            </View>
          </View>
        </Dialog>
      )}
    </If>
  )
}
