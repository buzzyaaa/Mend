import { effect, mount, Text, token, View } from 'nsh'
import { t } from 'nsh/i18n'

import { Icon } from './components/Icon'
import { ActionButton, Spinner } from './components/ui'
import { MainScreen } from './screens/MainScreen'
import { UnlockScreen } from './screens/UnlockScreen'
import { boot, bootReady, fatalError, retryBoot, status } from './lib/state'

function Splash() {
  return (
    <View class="flex-1 items-center justify-center gap-3 bg-background">
      <View class="h-12 w-12 items-center justify-center rounded-xl bg-primary">
        <Icon name="shield" size={24} color={token('primary-foreground')} />
      </View>
      <Text class="text-sm text-muted-foreground">{t('common.loading')}</Text>
      <Spinner />
    </View>
  )
}

function Fatal() {
  return (
    <View class="flex-1 items-center justify-center bg-background p-6">
      <View class="w-full max-w-[460px] gap-4 rounded-xl border border-border bg-card p-6 shadow-lg">
        <View class="flex-row items-center gap-2">
          <Icon name="alert-triangle" size={18} color={token('destructive')} />
          <Text class="text-base font-semibold text-foreground">{t('error.title')}</Text>
        </View>
        <Text class="text-sm text-muted-foreground">{fatalError()}</Text>
        <ActionButton
          label={t('common.retry')}
          icon="refresh"
          variant="primary"
          onPress={() => void retryBoot()}
        />
      </View>
    </View>
  )
}

let bootRequested = false

function App() {
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
          <If when={!status().initialized}>
            <UnlockScreen mode="setup" />
          </If>
          <If when={status().initialized && !status().unlocked}>
            <UnlockScreen mode="unlock" />
          </If>
          <If when={status().initialized && status().unlocked}>
            <MainScreen />
          </If>
        </View>
      </If>
    </View>
  )
}

mount(App)
