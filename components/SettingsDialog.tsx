import { appInfo, effect, signal, Text, View, windowSize } from 'nsh'
import { Dialog, Progress } from 'nsh/base'
import { Scroll } from 'nsh'
import { t } from 'nsh/i18n'

import { errorText } from '../lib/errors'
import {
  applyAppUpdate,
  applyPackage,
  checkForUpdates,
  currentShell,
  resetUpdateState,
  updateApp,
  updateBusy,
  updateError,
  updatePackage,
  updateProgress,
} from '../lib/update'
import {
  changeMasterPassword,
  confirm,
  exportBackup,
  importBackup,
  pickBackupFile,
  settingsOpen,
  showError,
} from '../lib/state'
import { preferences, setAutoLockMinutes, setLanguage, setTheme } from '../lib/preferences'
import * as native from '../lib/native'
import type { AppPaths } from '../lib/types'

import {
  ActionButton,
  Divider,
  Field,
  IconButton,
  SectionTitle,
  SelectField,
  TextField,
} from './ui'

const AUTO_LOCK_OPTIONS = [0, 1, 5, 10, 15, 30, 60]

export function SettingsDialog() {
  const paths = signal<AppPaths | null>(null)
  const oldPassword = signal('')
  const newPassword = signal('')
  const confirmPassword = signal('')
  const passwordError = signal('')
  const passwordBusy = signal(false)

  const backupPassword = signal('')
  const backupError = signal('')
  const backupBusy = signal(false)

  const shell = signal<ReturnType<typeof currentShell> | null>(null)

  function closeSettings() {
    oldPassword.set('')
    newPassword.set('')
    confirmPassword.set('')
    passwordError.set('')
    backupPassword.set('')
    backupError.set('')
    resetUpdateState()
    shell.set(null)
    settingsOpen.set(false)
  }

  effect(() => {
    if (!settingsOpen()) return
    try {
      paths.set(native.appPaths())
      shell.set(currentShell())
    } catch {
      paths.set(null)
      shell.set(null)
    }
  })

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

  async function doExport() {
    if (backupBusy()) return
    backupError.set('')
    if (!backupPassword()) {
      backupError.set(t('backup.passwordPlaceholder'))
      return
    }
    backupBusy.set(true)
    try {
      const ok = await exportBackup(backupPassword())
      if (ok) {
        backupPassword.set('')
        const current = paths()
        if (current) paths.set({ ...current })
      }
    } finally {
      backupBusy.set(false)
    }
  }

  async function doImport() {
    if (backupBusy()) return
    backupError.set('')
    if (!backupPassword()) {
      backupError.set(t('backup.passwordPlaceholder'))
      return
    }
    const file = await pickBackupFile()
    if (!file) return
    confirm.set({
      title: t('backup.import'),
      message: t('backup.importConfirm'),
      confirmLabel: t('backup.importAction'),
      destructive: true,
      onConfirm: async () => {
        backupBusy.set(true)
        try {
          const result = await importBackup(file, backupPassword())
          if (result) {
            backupPassword.set('')
            closeSettings()
          }
        } finally {
          backupBusy.set(false)
        }
      },
    })
  }

  async function reveal() {
    try {
      await native.revealDataDir()
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
      style={{ width: 760, maxWidth: '94%' }}
    >
      <View
        class="overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        style={{ maxHeight: Math.max(360, windowSize().height - 72) }}
      >
        <View class="flex-row items-start gap-3 border-b border-border px-5 py-4">
          <View class="flex-1 gap-0.5">
            <Text class="text-lg font-semibold text-foreground">{t('nav.settings')}</Text>
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
          contentClass="gap-5 p-5"
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
                      { value: 'zh-CN', title: '简体中文' },
                      { value: 'en', title: 'English' },
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

            <View class="gap-2 rounded-lg border border-border bg-muted/30 p-3">
              <Text class="text-sm font-medium text-foreground">
                {t('settings.changePassword')}
              </Text>
              <Text class="text-xs text-muted-foreground">{t('settings.changePasswordHint')}</Text>
              <View class="flex-row flex-wrap gap-2">
                <View class="flex-1">
                  <Field label={t('settings.oldPassword')}>
                    <TextField
                      value={oldPassword()}
                      onChange={oldPassword.set}
                      masked
                      autoComplete="current-password"
                      accessibilityLabel={t('settings.oldPassword')}
                    />
                  </Field>
                </View>
                <View class="flex-1">
                  <Field label={t('settings.newPassword')}>
                    <TextField
                      value={newPassword()}
                      onChange={newPassword.set}
                      masked
                      autoComplete="new-password"
                      accessibilityLabel={t('settings.newPassword')}
                    />
                  </Field>
                </View>
                <View class="flex-1">
                  <Field label={t('settings.confirmPassword')}>
                    <TextField
                      value={confirmPassword()}
                      onChange={confirmPassword.set}
                      masked
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

          <View class="gap-3">
            <SectionTitle title={t('backup.title')} hint={t('backup.hint')} />
            <Field label={t('backup.passwordPlaceholder')}>
              <TextField
                value={backupPassword()}
                onChange={backupPassword.set}
                masked
                autoComplete="current-password"
                accessibilityLabel={t('backup.passwordPlaceholder')}
                placeholder={t('backup.passwordPlaceholder')}
              />
            </Field>
            <Text class="text-[11px] text-muted-foreground">{t('backup.exportHint')}</Text>
            <If when={backupError()}>
              <Text class="text-xs text-destructive">{backupError()}</Text>
            </If>
            <View class="flex-row flex-wrap gap-2">
              <ActionButton
                label={t('backup.exportAction')}
                icon="download"
                variant="primary"
                disabled={backupBusy()}
                onPress={() => void doExport()}
              />
              <ActionButton
                label={t('backup.importAction')}
                icon="upload"
                disabled={backupBusy()}
                onPress={() => void doImport()}
              />
              <ActionButton
                label={t('backup.revealData')}
                icon="folder"
                variant="ghost"
                onPress={() => void reveal()}
              />
            </View>
            <View class="gap-1 rounded-md border border-border bg-muted/30 px-3 py-2">
              <Text class="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t('backup.dataDir')}
              </Text>
              <Text class="text-xs text-foreground" style={{ numberOfLines: 2 }}>
                {paths()?.dataDir ?? '…'}
              </Text>
              <Text class="text-[10px] text-muted-foreground">{paths()?.dbPath ?? ''}</Text>
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
                label={t('update.checkNow')}
                icon="refresh"
                disabled={updateBusy()}
                onPress={() => void checkForUpdates()}
              />
            </View>

            <If when={updateBusy()}>
              <View class="flex-row items-center gap-2">
                <Progress
                  value={updateProgress()}
                  class="flex-1"
                  trackClass="h-1.5 w-full rounded-full bg-muted"
                  indicatorClass="h-1.5 rounded-full bg-primary"
                />
                <Text class="w-20 text-right text-[11px] text-muted-foreground">
                  {`${updateProgress()}%`}
                </Text>
              </View>
            </If>

            <If when={updatePackage()}>
              <View class="rounded-lg border border-success/30 bg-success/10 p-3">
                <Text class="text-sm font-medium text-success">{t('update.packageFound')}</Text>
                <Text class="mt-1 text-xs text-foreground">
                  {t('update.packageVersion', {
                    version: updatePackage()?.version ?? '',
                    build: updatePackage()?.build ?? 0,
                  })}
                </Text>
                {updatePackage()?.notes ? (
                  <Text class="mt-1  text-xs text-muted-foreground">{updatePackage()?.notes}</Text>
                ) : null}
                <View class="mt-2 flex-row justify-end">
                  <ActionButton
                    label={t('update.packageInstall')}
                    icon="download"
                    variant="primary"
                    disabled={updateBusy()}
                    onPress={() => void applyPackage()}
                  />
                </View>
              </View>
            </If>

            <If when={!updatePackage() && updateApp()}>
              <View class="rounded-lg border border-border bg-card p-3">
                <Text class="text-sm font-medium text-foreground">
                  {t('update.appAvailable', { version: updateApp()?.version ?? '' })}
                </Text>
                {updateApp()?.notes ? (
                  <Text class="mt-1  text-xs text-muted-foreground">{updateApp()?.notes}</Text>
                ) : null}
                <View class="mt-2 flex-row justify-end">
                  <ActionButton
                    label={t('update.updateNow')}
                    icon="download"
                    variant="primary"
                    disabled={updateBusy() || !updateApp()?.canInstall}
                    onPress={() => void applyAppUpdate()}
                  />
                </View>
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
                <Text class="text-xs text-muted-foreground">
                  {`${appInfo().version ?? '0.4.0'} (${appInfo().build ?? 1})`}
                </Text>
              </View>
              <Text class="text-xs text-muted-foreground">Native Shell</Text>
            </View>
          </View>

          <View class="flex-row justify-end pb-1">
            <ActionButton label={t('common.close')} variant="secondary" onPress={closeSettings} />
          </View>
        </Scroll>
      </View>
    </Dialog>
  )
}
