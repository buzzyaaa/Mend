import { appInfo, effect, Scroll, signal, Text, token, View, windowSize } from 'nsh'
import type { Bounds, ScrollEvent, ScrollRef, ViewRef } from 'nsh'
import { t } from 'nsh/i18n'

import { errorText } from '../lib/errors'
import {
  checkForUpdates,
  openUpdatePrompt,
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
  PasswordField,
  SectionTitle,
  SelectField,
  SwitchField,
} from './ui'
import { Icon } from './Icon'

const AUTO_LOCK_OPTIONS = [0, 1, 5, 10, 15, 30, 60]

/** 设置页分区表：左侧快速导航与各分区锚点都由此生成。
 *  以后加分区只需在这里追加一项，并在 Scroll 里放一个带 anchor 的 View。 */
const SECTIONS = [
  { key: 'appearance', titleKey: 'settings.appearance' },
  { key: 'security', titleKey: 'settings.security' },
  { key: 'vault', titleKey: 'vault.sectionTitle' },
  { key: 'update', titleKey: 'update.title' },
  { key: 'about', titleKey: 'settings.about' },
] as const
type SectionKey = (typeof SECTIONS)[number]['key']

/** 宽屏才显示页内快速导航，窄屏把空间全部留给设置内容。
 *  桌面窄屏阈值是 900，这里取 1000：留出导航宽度后内容区仍够用。 */
const WIDE_NAV_MIN_WIDTH = 1000

/** 设置页：占据主内容区，由左侧图标栏进入/离开，不再是弹窗。 */
export function SettingsPage() {
  const oldPassword = signal('')
  const newPassword = signal('')
  const confirmPassword = signal('')
  const passwordError = signal('')
  const passwordBusy = signal(false)

  // 快速导航状态：滚动容器 ref + 各分区顶部偏移 + 当前可见分区。
  let scrollRef: ScrollRef | null = null
  const anchors: Partial<Record<SectionKey, ViewRef>> = {}
  const anchorTops = signal<Partial<Record<SectionKey, number>>>({})
  const activeSection = signal<SectionKey>('appearance')
  const wideNav = () => windowSize().width >= WIDE_NAV_MIN_WIDTH
  // 点击导航触发程序化滚动期间，暂时不让 onScroll 抢走高亮。
  const programmaticScroll = { value: false }

  function anchorRef(key: SectionKey) {
    return (ref: ViewRef | null) => {
      if (ref) anchors[key] = ref
    }
  }

  function onAnchorLayout(key: SectionKey, e: { bounds: Bounds }) {
    anchorTops.set({ ...anchorTops(), [key]: e.bounds.origin.y })
  }

  let viewportHeight = 720

  function onScroll(e: ScrollEvent) {
    viewportHeight = e.size.height
    // 程序化滚动中跳过：动画经过的中间分区不应抢走高亮。
    if (programmaticScroll.value) return
    syncActiveSection(e.offset.y, viewportHeight)
  }

  /** 依锚点偏移判定当前分区；判定线放在视口中部，反映「当前正看着哪个分区」。 */
  function syncActiveSection(offsetY: number, viewportHeight: number) {
    const line = offsetY + viewportHeight * 0.5
    let current: SectionKey = SECTIONS[0].key
    for (const section of SECTIONS) {
      const top = anchorTops()[section.key]
      if (top !== undefined && top <= line) current = section.key
    }
    if (current !== activeSection()) activeSection.set(current)
  }

  function scrollToSection(key: SectionKey) {
    programmaticScroll.value = true
    activeSection.set(key)
    const top = anchorTops()[key]
    // 偏移来自各分区 View 的 onLayout（相对滚动内容顶部），滚到「分区顶 - 16」。
    // 内容不足一屏时会被容器自动夹到可滚动上限，属正常。
    if (top !== undefined && scrollRef) {
      scrollRef.scrollTo({ y: Math.max(0, top - 16), animated: true })
    } else {
      anchors[key]?.reveal({ vertical: 'start', animated: true })
    }
  }

  function onScrollEnd() {
    // 只解锁：高亮保持点击时设定的分区，不让结束回调把它改回去。
    // 之后用户手动滚动会经 onScroll 正常更新高亮。
    programmaticScroll.value = false
  }

  effect(() => {
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
    <View class="flex-1 min-h-0 flex-row bg-card">
      <If when={wideNav()}>
        <View class="w-40 shrink-0 gap-1 border-r border-border bg-card px-3 py-5">
          <Text class="mb-2 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('nav.settings')}
          </Text>
          <Each of={SECTIONS} key={(section) => section.key}>
            {(section) => {
              const active = () => activeSection() === section().key
              return (
                <View
                  testID={`settings-nav-${section().key}`}
                  class={'rounded-md px-2.5 py-2 ' + (active() ? 'bg-primary/10' : 'hover:bg-accent')}
                  role="button"
                  onPress={() => scrollToSection(section().key)}
                  accessibilityLabel={t(section().titleKey)}
                >
                  <Text
                    testID={`settings-nav-text-${section().key}`}
                    class={'text-xs ' + (active() ? 'font-medium text-primary' : 'text-muted-foreground')}
                  >
                    {t(section().titleKey)}
                  </Text>
                </View>
              )
            }}
          </Each>
        </View>
      </If>

      <View class="flex-1 min-h-0">
        <Scroll
          ref={(ref) => {
            scrollRef = ref
          }}
          class="flex-1"
          contentClass="gap-4 px-4 pt-4 pb-24 w-full max-w-[900px] mx-auto"
          onScroll={onScroll}
          onScrollEnd={onScrollEnd}
        >
          <View
            ref={anchorRef('appearance')}
            onLayout={(e) => onAnchorLayout('appearance', e)}
            class="gap-3"
          >
            <SectionTitle title={t('settings.appearance')} />
            <View class="gap-3">
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
                  class="w-64"
                />
              </Field>
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
                  class="w-64"
                />
              </Field>
            </View>
          </View>

          <Divider />

          <View
            ref={anchorRef('security')}
            onLayout={(e) => onAnchorLayout('security', e)}
            class="gap-3"
          >
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
              <Text class="text-xs font-medium text-foreground">{t('settings.changePassword')}</Text>
              <Text class="text-xs text-muted-foreground">{t('settings.changePasswordHint')}</Text>
              <View class="gap-2.5">
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
          <View ref={anchorRef('vault')} onLayout={(e) => onAnchorLayout('vault', e)} class="gap-3">
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
              <ActionButton label={t('vault.reveal')} icon="eye" onPress={() => void reveal()} />
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
                disabled={authBusy()}
                onPress={() => void useDefaultVaultFile()}
              />
            </View>
          </View>

          <Divider />

          <View ref={anchorRef('update')} onLayout={(e) => onAnchorLayout('update', e)} class="gap-3">
            <SectionTitle title={t('update.title')} hint={t('update.hint')} />
            <View class="flex-row items-center justify-between gap-2">
              <Text class="text-xs text-muted-foreground">
                {t('update.shellInfo', {
                  version: appInfo().version ?? '0.4.8',
                  build: appInfo().build ?? 0,
                })}
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

          <View ref={anchorRef('about')} onLayout={(e) => onAnchorLayout('about', e)} class="gap-2">
            <SectionTitle title={t('settings.about')} />
            <View class="flex-row items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
              <View class="gap-0.5">
                <Text class="text-xs font-medium text-foreground">{t('settings.version')}</Text>
                <Text class="text-xs text-muted-foreground">{appInfo().version ?? '0.4.0'}</Text>
              </View>
              <Text class="text-xs text-muted-foreground">{t('settings.clientKind')}</Text>
            </View>
          </View>
        </Scroll>
      </View>
    </View>
  )
}
