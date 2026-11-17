import { appInfo, effect, mount, Text, token, View } from 'nsh'
import { currentWindow, isAvailable } from 'nsh/desktop'
import { t } from 'nsh/i18n'

import { Icon } from './components/Icon'
import { ToastHost } from './components/ToastHost'
import { ActionButton, FadeIn, Spinner } from './components/ui'
import { MainScreen } from './screens/MainScreen'
import { UnlockScreen } from './screens/UnlockScreen'
import {
  boot,
  bootReady,
  bootRetrying,
  fatalDetail,
  fatalError,
  modalOpen,
  retryBoot,
  status,
} from './lib/state'

function Splash() {
  return (
    <View class="flex-1 items-center justify-center gap-3 bg-background">
      <View class="h-10 w-10 items-center justify-center rounded-xl bg-primary">
        <Icon name="shield" size={20} color={token('primary-foreground')} />
      </View>
      <Text class="text-xs text-muted-foreground">{t('common.loading')}</Text>
      <Spinner />
    </View>
  )
}

function Fatal() {
  // nsh 组件只运行一次，只有写在 JSX 里的 signal 读取才是绑定：
  // 不能在函数体里 `const retrying = bootRetrying()`（会永远停在挂载时的值），
  // 否则重试中按钮既不禁用也不显示「重试中…」，重试失败后的 detail 也不会刷新。
  return (
    <View class="flex-1 items-center justify-center bg-background p-5">
      <View class="w-full max-w-[460px] gap-3 rounded-xl border border-border bg-card p-5 shadow-lg">
        <View class="flex-row items-center gap-2">
          <Icon name="alert-triangle" size={16} color={token('destructive')} />
          <Text class="text-sm font-semibold text-foreground">{t('error.title')}</Text>
        </View>
        <Text class="text-xs text-muted-foreground">{fatalError()}</Text>
        {/* 原始 code|message：一眼区分 locked / db / io / crypto，不参与 i18n 映射 */}
        <If when={fatalDetail()}>
          {(detail) => <Text class="text-[11px] text-muted-foreground">{detail()}</Text>}
        </If>
        <ActionButton
          label={bootRetrying() ? t('common.retrying') : t('common.retry')}
          icon="refresh"
          variant="primary"
          disabled={bootRetrying()}
          onPress={() => void retryBoot()}
        />
      </View>
    </View>
  )
}

let bootRequested = false

function App() {
  // nsh 使用系统标题栏，原生层会画出应用图标与默认的系统窗口按钮；
  // 这里只把标题文字从静态 nsh.json 值更新为带实际版本号的「Mend vX.Y.Z」。
  // currentWindow() 必须在渲染期间取得，桌面 API 不可用时保持静态标题。
  const mainWindow = isAvailable ? currentWindow() : null
  effect(() => {
    mainWindow?.set({
      title: `${appInfo().name ?? 'Mend'} v${appInfo().version ?? '0.4.6'}`,
    })
  })

  effect(() => {
    if (bootRequested) return
    bootRequested = true
    void boot()
  })

  return (
    <View class="flex-1 bg-background">
      <If when={!bootReady()}>
        <Splash />
      </If>
      <If when={bootReady() && fatalError()}>
        <Fatal />
      </If>
      <If when={bootReady() && !fatalError()}>
        <View class="flex-1">
          {/* 三个页面各自淡入：解锁 → 主界面不再硬切。 */}
          <If when={!status().initialized}>
            <FadeIn>
              <UnlockScreen mode="setup" />
            </FadeIn>
          </If>
          <If when={status().initialized && !status().unlocked}>
            <FadeIn>
              <UnlockScreen mode="unlock" />
            </FadeIn>
          </If>
          <If when={status().initialized && status().unlocked}>
            <FadeIn>
              <MainScreen />
            </FadeIn>
          </If>
        </View>
      </If>

      {/* 提示条放在最外层（解锁页也能提示）。弹窗打开时改由弹窗内的那份显示：
          nsh 的 Dialog 是独立原生窗口层，这里的 Overlay 盖不住它的遮罩。 */}
      <If when={!modalOpen()}>
        <ToastHost />
      </If>
    </View>
  )
}

mount(App)
