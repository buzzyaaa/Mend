import { Overlay, Text, token, View } from 'nsh'

import { updateRunning } from '../lib/update'
import { dismissToast, toasts } from '../lib/state'
import { Icon } from './Icon'

/** 提示条层。
 *
 *  必须渲染进「当前最上面那一层」：主界面的 Overlay 抬不到 `Dialog` 之上
 *  （桌面端 Dialog 是独立原生窗口层），所以 `ModalFrame` 里也有一份，
 *  弹窗打开时主界面那份隐藏（见 `lib/state.ts` 的 `modalOpen`）。
 *
 *  `pointerEvents: 'box-none'`：这条全宽底部区域不吃点击，只有提示条自己吃。
 */
export function ToastHost() {
  return (
    <Overlay
      style={{
        left: 0,
        right: 0,
        bottom: updateRunning() ? 72 : 18,
        alignItems: 'center',
        pointerEvents: 'box-none',
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
