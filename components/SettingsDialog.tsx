import { appInfo, effect, signal, Text, token, View, windowSize } from 'nsh'
import { Dialog } from 'nsh/base'
import { Scroll } from 'nsh'
import { t } from 'nsh/i18n'

import { errorText } from '../lib/errors'
import {
  checkForUpdates,
  currentShell,
  openUpdatePrompt,
  resetUpdateCheckState,
  updateApp,
  updateBusy,
  updateError,
  updatePackage,
} from '../lib/update'
import {
  authBusy,
  changeMasterPassword,
  confirm,
  deviceUnlockOn,
  pickExistingVaultFile,
  pickNewVaultFile,
  setDeviceUnlock,
  settingsOpen,
  showError,
  status,
  useDefaultVaultFile,
} from '../lib/state'
import {
  LANGUAGES,
  preferences,
  setAutoLockMinutes,
  setLanguage,
  setTheme,
} from '../lib/preferences'
import * as native from '../lib/native'

import {
  ActionButton,
  Divider,
  Field,
  IconButton,
  PasswordField,
  SectionTitle,
  SelectField,
  SwitchField,
  TextField,
  MODAL_BACKDROP_CLASS,
  MODAL_CLASS,
  ModalFrame,
} from './ui'
import { Icon } from './Icon'

const AUTO_LOCK_OPTIONS = [0, 1, 5, 10, 15, 30, 60]

export function SettingsDialog() {
  const oldPassword = signal('')
  const newPassword = signal('')
  const confirmPassword = signal('')
  const passwordError = signal('')
  const passwordBusy = signal(false)

  const shell = signal<ReturnType<typeof currentShell> | null>(null)

  function closeSettings() {
    oldPassword.set('')
    newPassword.set('')
    confirmPassword.set('')
    passwordError.set('')
    resetUpdateCheckState()
    shell.set(null)
    settingsOpen.set(false)
  }

  effect(() => {
    if (!settingsOpen()) return
    try {
      shell.set(currentShell())
    } catch {
      shell.set(null)
    }
    try {
      deviceUnlockOn.set(native.deviceUnlockEnabled())
    } catch {
      deviceUnlockOn.set(false)
    }
  })

  /** 免主密码解锁是「降低安全性换方便」的开关：开之前必须显式确认。 */
  function toggleDeviceUnlock(next: boolean) {
    if (!next) {
      void setDeviceUnlock(false)
      return
    }
    confirm.set({
      title: t('settings.deviceUnlock'),
      message: t('settings.deviceUnlockConfirm'),
      confirmLabel: t('settings.deviceUnlockEnable'),
      destructive: true,
      onConfirm: async () => {
        await setDeviceUnlock(true)
      },
    })
  }

  async function changePassword() {
    if (passwordBusy()) return
    passwordError.set('')
    if (!newPassword()) {
      passwordError.set(t('settings.passwordTooShort'))
      return
    }
    if (newPassword().length < 4) {
      passwordError.set(t('settings.passwordTooShort'))
      return
    }
    if (newPassword() !== confirmPassword()) {
      passwordError.set(t('settings.passwordMismatch'))
      return
    }
    passwordBusy.set(true)
    try {
      await changeMasterPassword(oldPassword(), newPassword())
      oldPassword.set('')
      newPassword.set('')
      confirmPassword.set('')
    } catch (cause) {
      passwordError.set(errorText(cause))
    } finally {
      passwordBusy.set(false)
    }
  }

  /** 库文件就是完整数据：直接选中它，用户拷走即可备份。 */
  async function reveal() {
    try {
      await native.revealVaultFile()
    } catch (cause) {
      showError(cause)
    }
  }

  return (
    <Dialog
      open={settingsOpen()}
      closeOnBackdropPress={false}
      onOpenChange={(event) => {
        if (!event.open) closeSettings()
      }}
      onCancel={closeSettings}
      accessibilityLabel={t('nav.settings')}
      class={MODAL_CLASS}
      backdropClass={MODAL_BACKDROP_CLASS}
      style={{ width: 760, maxWidth: '94%' }}
    >
      <ModalFrame
        class="overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        maxHeight={Math.max(360, windowSize().height - 72)}
      >
        <View class="flex-row items-start gap-3 border-b border-border px-5 py-3">
          <View class="flex-1 gap-0.5">
            <Text class="text-sm font-semibold text-foreground">{t('nav.settings')}</Text>
            <Text class="text-xs text-muted-foreground">{t('settings.appearanceHint')}</Text>
          </View>
          <IconButton
            icon="close"
            label={t('common.close')}
            testID="settings-close"
            onPress={closeSettings}
          />
        </View>

        <Scroll
          style={{ maxHeight: Math.max(300, windowSize().height - 140) }}
          contentClass="gap-4 p-4"
        >
          <View class="gap-3">
            <SectionTitle title={t('settings.appearance')} />
            <View class="flex-row gap-3">
              <View class="flex-1">
                <Field label={t('settings.theme')}>
                  <SelectField
                    items={[
                      { value: 'system', title: t('settings.themeSystem') },
                      { value: 'light', title: t('settings.themeLight') },
                      { value: 'dark', title: t('settings.themeDark') },
                    ]}
                    value={preferences().theme}
                    onChange={(value) => {
                      if (value) setTheme(value as import('../lib/types').ThemeMode)
                    }}
                  />
                </Field>
              </View>
              <View class="flex-1">
                <Field label={t('settings.language')}>
                  <SelectField
                    items={[
                      { value: '', title: t('settings.languageSystem') },
                      ...LANGUAGES.map((language) => ({
                        value: language.value,
                        title: language.label,
                      })),
                    ]}
                    value={preferences().language ?? ''}
                    onChange={(value) => setLanguage(value ? value : null)}
                  />
                </Field>
              </View>
            </View>
          </View>

          <Divider />

          <View class="gap-3">
            <SectionTitle title={t('settings.security')} hint={t('settings.autoLockHint')} />
            <Field label={t('settings.autoLock')}>
              <SelectField
                items={AUTO_LOCK_OPTIONS.map((minutes) => ({
                  value: String(minutes),
                  title: minutes === 0 ? t('settings.off') : t('settings.minutes', { n: minutes }),
                }))}
                value={String(preferences().autoLockMinutes)}
                onChange={(value) => {
                  if (value !== null) setAutoLockMinutes(Number(value))
                }}
                class="w-48"
              />
            </Field>

            {/* 免主密码解锁：自用场景常见诉求，但确实降低了安全性，所以
                默认关闭、开启前弹确认、常驻一行风险提示。 */}
            <View class="gap-1.5 rounded-lg border border-border bg-muted/30 p-3">
              <SwitchField
                checked={deviceUnlockOn()}
                onChange={toggleDeviceUnlock}
                label={t('settings.deviceUnlock')}
                hint={t('settings.deviceUnlockHint')}
              />
              <Text class="text-[11px] text-warning">{t('settings.deviceUnlockWarning')}</Text>
            </View>

            <View class="gap-2 rounded-lg border border-border bg-muted/30 p-3">
              <Text class="text-xs font-medium text-foreground">
                {t('settings.changePassword')}
              </Text>
              <Text class="text-xs text-muted-foreground">{t('settings.changePasswordHint')}</Text>
              <View class="flex-row flex-wrap gap-2">
                <View class="flex-1">
                  <Field label={t('settings.oldPassword')}>
                    <PasswordField
                      value={oldPassword()}
                      onChange={oldPassword.set}
                      placeholder={t('settings.oldPassword')}
                      reveal={false}
                      autoComplete="current-password"
                      accessibilityLabel={t('settings.oldPassword')}
                    />
                  </Field>
                </View>
                <View class="flex-1">
                  <Field label={t('settings.newPassword')}>
                    <PasswordField
                      value={newPassword()}
                      onChange={newPassword.set}
                      placeholder={t('settings.newPassword')}
                      reveal={false}
                      autoComplete="new-password"
                      accessibilityLabel={t('settings.newPassword')}
                    />
                  </Field>
                </View>
                <View class="flex-1">
                  <Field label={t('settings.confirmPassword')}>
                    <PasswordField
                      value={confirmPassword()}
                      onChange={confirmPassword.set}
                      placeholder={t('settings.confirmPassword')}
                      reveal={false}
                      autoComplete="new-password"
                      accessibilityLabel={t('settings.confirmPassword')}
                    />
                  </Field>
                </View>
              </View>
              <If when={passwordError()}>
                <Text class="text-xs text-destructive">{passwordError()}</Text>
              </If>
              <View class="flex-row justify-end">
                <ActionButton
                  label={t('common.save')}
                  icon="check"
                  variant="primary"
                  disabled={passwordBusy()}
                  onPress={() => void changePassword()}
                />
              </View>
            </View>
          </View>

          <Divider />

          {/* 库文件自选：文件本身就是完整的保险库（主密码的 salt/参数/被包裹的
              DEK 都在里面），所以「换一座库」＝换一个文件。切换后应用会重新走
              一遍启动流程（等于刷新页面）。 */}
          <View class="gap-3">
            <SectionTitle title={t('vault.sectionTitle')} hint={t('vault.hint')} />
            <View class="gap-1.5 rounded-lg border border-border bg-muted/30 p-3">
              <View class="flex-row items-center gap-1.5">
                <Icon name="database" size={13} color={token('muted-foreground')} />
                <Text class="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t('vault.current')}
                </Text>
              </View>
              <Text class="text-xs text-foreground" style={{ numberOfLines: 2 }}>
                {status().dbPath || '…'}
              </Text>
            </View>
            <View class="flex-row flex-wrap gap-2">
              <ActionButton
                label={t('vault.reveal')}
                icon="eye"
                variant="ghost"
                onPress={() => void reveal()}
              />
              <ActionButton
                label={t('vault.switch')}
                icon="folder"
                disabled={authBusy()}
                onPress={() => void pickExistingVaultFile()}
              />
              <ActionButton
                label={t('vault.create')}
                icon="plus"
                disabled={authBusy()}
                onPress={() => void pickNewVaultFile()}
              />
              <ActionButton
                label={t('vault.useDefault')}
                icon="restore"
                variant="ghost"
                disabled={authBusy()}
                onPress={() => void useDefaultVaultFile()}
              />
            </View>
          </View>

          <Divider />

          <View class="gap-3">
            <SectionTitle title={t('update.title')} hint={t('update.hint')} />
            <View class="flex-row items-center justify-between gap-2">
              <Text class="text-xs text-muted-foreground">
                {shell()
                  ? t('update.shellInfo', {
                      version: shell()?.version ?? '—',
                      build: shell()?.build ?? 0,
                      runtime: shell()?.nshVersion ?? '—',
                    })
                  : '…'}
              </Text>
              <ActionButton
                label={updateBusy() ? t('common.loading') : t('update.checkNow')}
                icon="refresh"
                disabled={updateBusy()}
                onPress={() => void checkForUpdates()}
              />
            </View>

            <If when={updatePackage()}>
              <View class="flex-row items-center gap-3 rounded-lg border border-success/30 bg-success/10 p-3">
                <Icon name="download" size={15} color={token('success')} />
                <View class="flex-1 gap-0.5">
                  <Text class="text-xs font-medium text-success">{t('update.packageFound')}</Text>
                  <Text class="text-[11px] text-muted-foreground">
                    {t('update.packageVersion', {
                      version: updatePackage()?.version ?? '',
                      build: updatePackage()?.build ?? 0,
                    })}
                  </Text>
                </View>
                <ActionButton
                  label={t('update.updateNow')}
                  icon="download"
                  variant="primary"
                  disabled={updateBusy()}
                  onPress={() => openUpdatePrompt('package')}
                />
              </View>
            </If>

            <If when={!updatePackage() && updateApp()}>
              <View class="flex-row items-center gap-3 rounded-lg border border-border bg-card p-3">
                <Icon name="download" size={15} color={token('foreground')} />
                <View class="flex-1 gap-0.5">
                  <Text class="text-xs font-medium text-foreground">
                    {t('update.appAvailable', { version: updateApp()?.version ?? '' })}
                  </Text>
                  <Text class="text-[11px] text-muted-foreground">{t('update.notesTitle')}</Text>
                </View>
                <ActionButton
                  label={t('update.updateNow')}
                  icon="download"
                  variant="primary"
                  disabled={updateBusy() || !updateApp()?.canInstall}
                  onPress={() => openUpdatePrompt('app')}
                />
              </View>
            </If>

            <If when={updateError()}>
              <Text class="text-xs text-destructive">{updateError()}</Text>
            </If>
          </View>

          <Divider />

          <View class="gap-2">
            <SectionTitle title={t('settings.about')} />
            <View class="flex-row items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
              <View class="gap-0.5">
                <Text class="text-xs font-medium text-foreground">{t('settings.version')}</Text>
                <Text class="text-xs text-muted-foreground">{appInfo().version ?? '0.4.0'}</Text>
              </View>
              <Text class="text-xs text-muted-foreground">Native Shell</Text>
            </View>
          </View>

          <View class="flex-row justify-end pb-1">
            <ActionButton label={t('common.close')} variant="secondary" onPress={closeSettings} />
          </View>
        </Scroll>
      </ModalFrame>
    </Dialog>
  )
}
