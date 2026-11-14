import { Overlay, Text, token, View } from 'nsh'

import { dismissToast, toasts } from '../lib/state'
import { Icon } from './Icon'

export function ToastHost() {
  return (
    <Overlay
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 18,
        alignItems: 'center',
      }}
    >
      <View class="items-center gap-2">
        <Each of={toasts()} key={(item) => item.id}>
          {(item) => {
            const current = item()
            const error = current.kind === 'error'
            return (
              <View
                class={
                  'max-w-[420px] flex-row items-center gap-2 rounded-lg px-3 py-2 shadow-lg ' +
                  (error
                    ? 'bg-destructive'
                    : current.kind === 'info'
                      ? 'border border-border bg-card'
                      : 'bg-primary')
                }
                onPress={() => dismissToast(current.id)}
                role="alert"
              >
                <Icon
                  name={error ? 'alert-triangle' : current.kind === 'info' ? 'info' : 'check'}
                  size={14}
                  color={
                    error
                      ? '#ffffff'
                      : current.kind === 'info'
                        ? token('foreground')
                        : token('primary-foreground')
                  }
                />
                <Text
                  class={
                    error
                      ? 'text-xs text-white'
                      : current.kind === 'info'
                        ? 'text-xs text-foreground'
                        : 'text-xs text-primary-foreground'
                  }
                >
                  {current.message}
                </Text>
              </View>
            )
          }}
        </Each>
      </View>
    </Overlay>
  )
}
