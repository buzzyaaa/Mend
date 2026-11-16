import { appInfo, signal, Text, token, View } from 'nsh'
import { HoverCard, Menu, MenuItem } from 'nsh/base'
import { t } from 'nsh/i18n'

import { Icon } from '../components/Icon'
import { ActionButton, Badge, Field, PasswordField } from '../components/ui'
import { errorText } from '../lib/errors'
import { passwordStrength } from '../lib/format'
import { LANGUAGES, preferences, setLanguage } from '../lib/preferences'
import {
  authBusy,
  pickExistingVaultFile,
  pickNewVaultFile,
  setupVault,
  status,
  unlockVault,
  useDefaultVaultFile,
} from '../lib/state'

/** 解锁页只显示库文件名（完整路径在设置里），路径分隔符跨平台都处理。 */
function databaseName(): string {
  const path = status().dbPath
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut >= 0 ? path.slice(cut + 1) : path || '…'
}

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

  /** 语言入口：鼠标指上去就弹出菜单（可扩展多语言，不再需要底部那一排按钮）。
   *  触发器用普通 View 而不是 `IconButton`：后者自带 tooltip，悬停时会和
   *  这个浮层抢着弹，看起来像两个东西。触屏上按压同样能打开（HoverCard 负责）。 */
  const languageTrigger = (
    <View
      class="h-7 w-7 items-center justify-center rounded-md hover:bg-accent"
      role="button"
      accessibilityLabel={t('header.language')}
    >
      <Icon name="globe" size={16} color={token('muted-foreground')} />
    </View>
  )

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
            <HoverCard
              openDelay={120}
              closeDelay={200}
              placement="bottom"
              align="end"
              offset={6}
              popupClass="w-40 rounded-lg border border-border bg-card p-1 shadow-lg"
              trigger={languageTrigger}
            >
              <View class="gap-0.5">
                <Each of={LANGUAGES}>
                  {(item) => {
                    const language = item()
                    const active = () => preferences().language === language.value
                    return (
                      <View
                        class={
                          'h-7 flex-row items-center justify-between gap-2 rounded px-2 ' +
                          (active() ? 'bg-accent' : 'hover:bg-accent')
                        }
                        onPress={() => switchLanguage(language.value)}
                        role="button"
                        accessibilityLabel={language.label}
                      >
                        <Text class="text-xs text-foreground">{language.label}</Text>
                        {active() ? (
                          <Icon name="check" size={12} color={token('foreground')} />
                        ) : null}
                      </View>
                    )
                  }}
                </Each>
              </View>
            </HoverCard>
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
            label={
              busy()
                ? t(isSetup() ? 'unlock.creating' : 'unlock.unlocking')
                : isSetup()
                  ? t('unlock.create')
                  : t('unlock.unlock')
            }
            variant="primary"
            icon={isSetup() ? 'shield' : 'unlock'}
            disabled={busy()}
            onPress={() => void submit()}
            class="w-full"
          />
        </View>

        <View class="gap-2">
          {/* 数据库文件：解锁前也得能换库。换一座库＝换一个文件，所以这里给的是
              「文件」而不是「账户」。文件名只显示 basename，完整路径在设置里。 */}
          <View class="items-center">
            <Menu
              placement="top"
              align="center"
              offset={4}
              popupClass="rounded-lg border border-border bg-popover p-1 shadow-lg"
              trigger={
                <View
                  class="h-7 flex-row items-center gap-1.5 rounded-md px-2 hover:bg-accent"
                  role="button"
                  accessibilityLabel={t('vault.sectionTitle')}
                >
                  <Icon name="database" size={12} color={token('muted-foreground')} />
                  <Text
                    class="max-w-[260px] text-[11px] text-muted-foreground"
                    style={{ numberOfLines: 1 }}
                  >
                    {databaseName()}
                  </Text>
                  <Icon name="chevron-down" size={11} color={token('muted-foreground')} />
                </View>
              }
            >
              <MenuItem
                class="h-7 min-w-[180px] flex-row items-center rounded px-2 hover:bg-accent"
                accessibilityLabel={t('vault.switch')}
                onSelect={() => void pickExistingVaultFile()}
              >
                <Text class="text-xs text-popover-foreground">{t('vault.switch')}</Text>
              </MenuItem>
              <MenuItem
                class="h-7 min-w-[180px] flex-row items-center rounded px-2 hover:bg-accent"
                accessibilityLabel={t('vault.create')}
                onSelect={() => void pickNewVaultFile()}
              >
                <Text class="text-xs text-popover-foreground">{t('vault.create')}</Text>
              </MenuItem>
              <MenuItem
                class="h-7 min-w-[180px] flex-row items-center rounded px-2 hover:bg-accent"
                accessibilityLabel={t('vault.useDefault')}
                onSelect={() => void useDefaultVaultFile()}
              >
                <Text class="text-xs text-popover-foreground">{t('vault.useDefault')}</Text>
              </MenuItem>
            </Menu>
          </View>
          <Text class="text-center text-[11px] text-muted-foreground">
            {`v${appInfo().version ?? '0.4.0'} · ${t('unlock.cannotRecover')}`}
          </Text>
        </View>
      </View>
    </View>
  )
}
