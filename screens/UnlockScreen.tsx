import { appInfo, signal, Text, token, View } from 'nsh'
import { t } from 'nsh/i18n'

import { Icon } from '../components/Icon'
import { ActionButton, Badge, Field, IconButton, PasswordField, TextField } from '../components/ui'
import { errorText } from '../lib/errors'
import { passwordStrength } from '../lib/format'
import { preferences, setLanguage } from '../lib/preferences'
import { authBusy, setupVault, unlockVault } from '../lib/state'

export function UnlockScreen(props: { mode: 'setup' | 'unlock' }) {
  const password = signal('')
  const confirmation = signal('')
  const error = signal('')
  const busy = authBusy

  const isSetup = () => props.mode === 'setup'
  const strength = () => passwordStrength(password())

  async function submit() {
    if (busy()) return
    error.set('')
    const value = password()
    if (!value) {
      error.set(t('unlock.errors.empty'))
      return
    }
    if (isSetup()) {
      if (value.length < 4) {
        error.set(t('unlock.errors.tooShort'))
        return
      }
      if (value !== confirmation()) {
        error.set(t('unlock.errors.mismatch'))
        return
      }
    }
    busy.set(true)
    try {
      if (isSetup()) {
        await setupVault(value)
      } else {
        await unlockVault(value)
      }
      password.set('')
      confirmation.set('')
    } catch (cause) {
      password.set('')
      if (isSetup()) confirmation.set('')
      error.set(errorText(cause, isSetup() ? 'setup' : 'unlock'))
    } finally {
      busy.set(false)
    }
  }

  function switchLanguage(locale: string) {
    setLanguage(locale)
  }

  return (
    <View class="flex-1 items-center justify-center bg-background p-4">
      <View
        class="w-full max-w-[430px] gap-4 rounded-2xl border border-border bg-card p-5 shadow-lg"
        style={{ alignSelf: 'center' }}
      >
        <View class="flex-row items-start justify-between">
          <View class="flex-row items-center gap-3">
            <View class="h-10 w-10 items-center justify-center rounded-xl bg-primary">
              <Icon name="shield" size={20} color={token('primary-foreground')} />
            </View>
            <View class="gap-0.5">
              <Text class="text-sm font-semibold tracking-tight text-foreground">
                {t('app.name')}
              </Text>
              <Text class="text-xs text-muted-foreground">{t('unlock.subtitle')}</Text>
            </View>
          </View>
          <View class="flex-row items-center gap-1">
            <IconButton
              icon="globe"
              label={t('header.language')}
              onPress={() => switchLanguage(preferences().language === 'zh-CN' ? 'en' : 'zh-CN')}
            />
          </View>
        </View>

        <View class="gap-1">
          <Text class="text-base font-semibold tracking-tight text-foreground">
            {isSetup() ? t('unlock.setupSubtitle') : t('unlock.password')}
          </Text>
          {isSetup() ? (
            <Text class="text-xs text-muted-foreground">{t('unlock.cannotRecover')}</Text>
          ) : null}
        </View>

        <View class="gap-3">
          <Field label={t('unlock.password')}>
            <PasswordField
              value={password()}
              onChange={(value) => {
                password.set(value)
                error.set('')
              }}
              placeholder={t('unlock.passwordPlaceholder')}
              autoFocus
              autoComplete={isSetup() ? 'new-password' : 'current-password'}
              onSubmit={() => void submit()}
              accessibilityLabel={t('unlock.password')}
            />
          </Field>

          {isSetup() ? (
            <>
              <Field label={t('unlock.confirm')}>
                <PasswordField
                  value={confirmation()}
                  onChange={(value) => {
                    confirmation.set(value)
                    error.set('')
                  }}
                  placeholder={t('unlock.confirmPasswordPlaceholder')}
                  autoComplete="new-password"
                  onSubmit={() => void submit()}
                  accessibilityLabel={t('unlock.confirm')}
                />
              </Field>
              {password() ? (
                <View class="flex-row items-center gap-2">
                  <Text class="text-xs text-muted-foreground">{t('unlock.strengthLabel')}</Text>
                  <Badge
                    label={t(`unlock.strength.${strength().level}`)}
                    tone={
                      strength().level === 'strong'
                        ? 'success'
                        : strength().level === 'medium'
                          ? 'warning'
                          : 'danger'
                    }
                  />
                </View>
              ) : null}
            </>
          ) : null}

          {error() ? (
            <View class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
              <Text class="text-xs text-destructive">{error()}</Text>
            </View>
          ) : null}

          <ActionButton
            label={isSetup() ? t('unlock.create') : t('unlock.unlock')}
            variant="primary"
            icon={isSetup() ? 'shield' : 'unlock'}
            disabled={busy()}
            onPress={() => void submit()}
            class="w-full"
          />
        </View>

        <View class="gap-2">
          <View class="flex-row items-center justify-center gap-3">
            <View
              class={
                preferences().language === 'zh-CN'
                  ? 'rounded-md bg-accent px-2.5 py-1'
                  : 'rounded-md px-2.5 py-1 hover:bg-accent'
              }
              onPress={() => switchLanguage('zh-CN')}
              role="button"
            >
              <Text class="text-xs text-foreground">简体中文</Text>
            </View>
            <View
              class={
                preferences().language === 'en'
                  ? 'rounded-md bg-accent px-2.5 py-1'
                  : 'rounded-md px-2.5 py-1 hover:bg-accent'
              }
              onPress={() => switchLanguage('en')}
              role="button"
            >
              <Text class="text-xs text-foreground">English</Text>
            </View>
          </View>
          <Text class="text-center text-[11px] text-muted-foreground">
            {`v${appInfo().version ?? '0.4.0'} · ${t('unlock.cannotRecover')}`}
          </Text>
        </View>
      </View>
    </View>
  )
}
