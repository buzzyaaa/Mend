import { appInfo, cleanup, computed, effect, platform, Scroll, signal, Text, token, View, windowSize } from 'nsh'
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
  updateUpToDate,
} from '../lib/update'
import {
  authBusy,
  changeMasterPassword,
  confirm,
  copyText,
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
  setUpdateCheckIntervalDays,
} from '../lib/preferences'
import * as native from '../lib/native'

import {
  ActionButton,
  Badge,
  CardHeader,
  Field,
  IconButton,
  PasswordField,
  SelectField,
  SettingsCard,
  SwitchField,
  WarningBanner,
} from './ui'
import { Icon, type IconName } from './Icon'

const AUTO_LOCK_OPTIONS = [0, 1, 5, 10, 15, 30, 60]
const UPDATE_INTERVAL_OPTIONS = [0, 7, 30, 365]

/** 设置页分区表：子导航与内容锚点都由此生成。
 *  以后加分区只需在这里追加一项，并在 Scroll 里放一个带 anchor 的 View。 */
const SECTIONS = [
  { key: 'appearance', titleKey: 'settings.appearance', icon: 'palette' },
  { key: 'security', titleKey: 'settings.security', icon: 'shield' },
  { key: 'vault', titleKey: 'vault.sectionTitle', icon: 'database' },
  { key: 'update', titleKey: 'update.title', icon: 'refresh' },
] as const satisfies ReadonlyArray<{ key: string; titleKey: string; icon: IconName }>
type SectionKey = (typeof SECTIONS)[number]['key']

/** 布局断点（按窗口可用宽度，而非屏幕分辨率）：
 *  - < 600：手机，单页滚动 + 全宽控件，应用导航在底部（MainScreen）。
 *  - 600–999：窄窗口/小平板，同样单页滚动，不设快速导航。
 *  - ≥ 1000：完整子导航（图标 + 文案）+ 锚点滚动。
 *  - ≥ 1100：外观卡显示装饰画（字段统一纵向，不再双列）。
 *  - ≥ 2560：4K，内容限宽居中，不再横向扩张。 */
const PHONE_MAX = 600
const FULL_NAV_MIN = 1000
const TWO_COL_MIN = 1100
const FOUR_K_MIN = 2560

/** 设置页所有下拉/输入框/主操作按钮的统一宽度（手机全宽）。 */
const CONTROL_WIDTH_CLASS = 'w-[240px]'

/** 设置页：占据主内容区，由应用导航进入/离开。
 *  ≥1000 是「子导航 + 锚点滚动内容」；更窄的窗口与移动端单页滚动，无快速导航。 */
export function SettingsPage() {
  const oldPassword = signal('')
  const newPassword = signal('')
  const confirmPassword = signal('')
  const passwordError = signal('')
  const passwordBusy = signal(false)

  const phone = computed(() => platform.idiom === 'phone' || windowSize().width < PHONE_MAX)
  // 快速导航只留在宽桌面：小屏与移动端单页滚动，不再有任何设置内导航。
  const fullNav = computed(() => platform.idiom !== 'phone' && windowSize().width >= FULL_NAV_MIN)
  const showArt = computed(() => !phone() && windowSize().width >= TWO_COL_MIN)
  const controlClass = computed(() => (phone() ? 'w-full' : CONTROL_WIDTH_CLASS))

  // 锚点滚动状态：滚动容器 ref + 各分区顶部偏移 + 当前可见分区。
  let scrollRef: ScrollRef | null = null
  const anchors: Partial<Record<SectionKey, ViewRef>> = {}
  const anchorTops = signal<Partial<Record<SectionKey, number>>>({})
  const activeSection = signal<SectionKey>('appearance')
  // 点击导航触发程序化滚动期间，暂时不让 onScroll 抢走高亮。
  const programmaticScroll = { value: false }
  let scrollTarget: SectionKey | null = null
  let scrollUnlockTimer: ReturnType<typeof setTimeout> | null = null
  // 点导航后 600ms 内离开设置页时，别让兜底定时器再写已销毁 owner 的 signal。
  cleanup(() => {
    if (scrollUnlockTimer !== null) clearTimeout(scrollUnlockTimer)
  })

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
    if (programmaticScroll.value) return
    syncActiveSection(e.offset.y, viewportHeight, e.contentSize.height)
  }

  /** 依锚点偏移判定当前分区；判定线放在视口中部，反映「当前正看着哪个分区」。
   *  触顶/触底时首尾分区可能不足半屏、判定线够不到，直接高亮对应端点。
   *  触底判定只在真能滚动时成立：内容不足一屏的高视口下任何滚动事件都会满足触底条件。 */
  function syncActiveSection(offsetY: number, height: number, contentHeight: number) {
    const first = SECTIONS[0].key
    const last = SECTIONS[SECTIONS.length - 1].key
    if (offsetY <= 8) {
      if (activeSection() !== first) activeSection.set(first)
      return
    }
    if (contentHeight > height + 8 && offsetY + height >= contentHeight - 8) {
      if (activeSection() !== last) activeSection.set(last)
      return
    }
    let current: SectionKey = SECTIONS[0].key
    const mid = offsetY + height * 0.5
    for (const section of SECTIONS) {
      const top = anchorTops()[section.key]
      if (top !== undefined && top <= mid) current = section.key
    }
    if (current !== activeSection()) activeSection.set(current)
  }

  /** 导航点击是「意图」：目标分区靠尾部时滚动会被夹到触底，几何判定（触底/中线）
   *  与意图不符。程序化滚动期间完全不做判定，结束后直接收敛到目标分区；
   *  用定时器兜底解锁，onScrollEnd 缺失或早到都不会让高亮同步挂起或抢跑。 */
  function beginProgrammaticScroll(key: SectionKey) {
    programmaticScroll.value = true
    scrollTarget = key
    activeSection.set(key)
    if (scrollUnlockTimer !== null) clearTimeout(scrollUnlockTimer)
    scrollUnlockTimer = setTimeout(() => {
      scrollUnlockTimer = null
      programmaticScroll.value = false
      if (scrollTarget) activeSection.set(scrollTarget)
      scrollTarget = null
    }, 600)
  }

  function scrollToSection(key: SectionKey) {
    beginProgrammaticScroll(key)
    const top = anchorTops()[key]
    if (top !== undefined && scrollRef) {
      scrollRef.scrollTo({ y: Math.max(0, top - 16), animated: true })
    } else {
      anchors[key]?.reveal({ vertical: 'start', animated: true })
    }
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
    if (!newPassword() || newPassword().length < 4) {
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

  const navRow = (section: (typeof SECTIONS)[number]) => {
    const active = () => activeSection() === section.key
    return (
      <View
        testID={`settings-nav-${section.key}`}
        class={
          'flex-row items-center gap-2 rounded-lg px-2.5 py-2 ' +
          (active() ? 'bg-primary/10' : 'hover:bg-accent active:opacity-70')
        }
        role="button"
        onPress={() => scrollToSection(section.key)}
        accessibilityLabel={t(section.titleKey)}
      >
        <Icon
          name={section.icon}
          size={15}
          color={token(active() ? 'primary' : 'muted-foreground')}
        />
        <Text
          testID={`settings-nav-text-${section.key}`}
          class={'text-xs ' + (active() ? 'font-medium text-primary' : 'text-muted-foreground')}
        >
          {t(section.titleKey)}
        </Text>
      </View>
    )
  }

  return (
    <View
      class={
        'min-h-0 flex-1 bg-background ' + (phone() ? 'flex-col' : 'flex-row')
      }
    >
      {/* 设置子导航：只负责设置页内跳转，应用级跳转在最左 NavRail。 */}
      <If when={fullNav()}>
        <View
          class={
            'shrink-0 gap-1 border-r border-border bg-card px-3 py-5 ' +
            (windowSize().width >= FOUR_K_MIN ? 'w-[220px]' : 'w-[200px]')
          }
        >
          <Text class="mb-2 px-2 text-sm font-semibold text-foreground">{t('nav.settings')}</Text>
          <Each of={SECTIONS} key={(section) => section.key}>
            {(section) => navRow(section())}
          </Each>
        </View>
      </If>

      {/* 内容区：全断点单页滚动；≥1000 时左侧子导航负责锚点跳转。 */}
        <View class="min-w-0 flex-1 min-h-0">
          <Scroll
            ref={(ref) => {
              scrollRef = ref
            }}
            class="flex-1"
            contentClass={
              'gap-4 w-full mx-auto pb-16 ' +
              (phone() ? 'px-4 pt-4 ' : 'px-6 pt-6 ') +
              (windowSize().width >= FOUR_K_MIN ? 'max-w-[1600px]' : 'max-w-[980px]')
            }
            // 手机窄视口下内容容器自动宽会溢出右缘：宽度显式取窗口宽，
            // 内边距仍由 contentClass 负责。
            contentStyle={phone() ? { width: windowSize().width } : undefined}
            onScroll={onScroll}
          >
            {/* 外观与行为：标题进卡片，主题/语言纵向排列。 */}
            <View
              ref={anchorRef('appearance')}
              onLayout={(e) => onAnchorLayout('appearance', e)}
              class="gap-4"
            >
              <SettingsCard class="relative overflow-hidden">
                {/* 装饰画绝对定位作卡片背景，不参与布局，避免撑大标题与字段间距。 */}
                <If when={showArt()}>
                  <View class="pointer-events-none absolute right-5 top-5">
                    <HeroArt />
                  </View>
                </If>
                <CardHeader
                  icon="palette"
                  title={t('settings.appearance')}
                  hint={t('settings.pageHint')}
                />
                <View class="gap-4">
                  <Field
                    label={t('settings.theme')}
                    hint={t('settings.themeHint')}
                    icon="sun"
                    class={controlClass()}
                  >
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
                      class="w-full"
                    />
                  </Field>
                  <Field
                    label={t('settings.language')}
                    hint={t('settings.languageHint')}
                    icon="globe"
                    class={controlClass()}
                  >
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
                      class="w-full"
                    />
                  </Field>
                </View>
              </SettingsCard>
            </View>

            {/* 安全：自动锁定 → 免主密码解锁（完整风险提示）→ 修改主密码。 */}
            <View
              ref={anchorRef('security')}
              onLayout={(e) => onAnchorLayout('security', e)}
              class="gap-4"
            >
              <SettingsCard>
                <CardHeader
                  icon="shield"
                  title={t('settings.security')}
                  hint={t('settings.autoLockHint')}
                />
                <Field label={t('settings.autoLock')} class={controlClass()}>
                  <SelectField
                    items={AUTO_LOCK_OPTIONS.map((minutes) => ({
                      value: String(minutes),
                      title:
                        minutes === 0 ? t('settings.off') : t('settings.minutes', { n: minutes }),
                    }))}
                    value={String(preferences().autoLockMinutes)}
                    onChange={(value) => {
                      if (value !== null) setAutoLockMinutes(Number(value))
                    }}
                    class="w-full"
                  />
                </Field>
                <SwitchField
                  checked={deviceUnlockOn()}
                  onChange={toggleDeviceUnlock}
                  label={t('settings.deviceUnlock')}
                  hint={t('settings.deviceUnlockHint')}
                  leading
                />
                <WarningBanner text={t('settings.deviceUnlockWarning')} />
              </SettingsCard>

              <SettingsCard>
                <CardHeader
                  icon="lock"
                  title={t('settings.changePassword')}
                  hint={t('settings.changePasswordHint')}
                />
                <View class="gap-3">
                  <Field label={t('settings.oldPassword')} class={controlClass()}>
                    <PasswordField
                      value={oldPassword()}
                      onChange={oldPassword.set}
                      placeholder={t('settings.oldPassword')}
                      reveal={false}
                      autoComplete="current-password"
                      accessibilityLabel={t('settings.oldPassword')}
                    />
                  </Field>
                  <Field label={t('settings.newPassword')} class={controlClass()}>
                    <PasswordField
                      value={newPassword()}
                      onChange={newPassword.set}
                      placeholder={t('settings.newPassword')}
                      reveal={false}
                      autoComplete="new-password"
                      accessibilityLabel={t('settings.newPassword')}
                    />
                  </Field>
                  <Field label={t('settings.confirmPassword')} class={controlClass()}>
                    <PasswordField
                      value={confirmPassword()}
                      onChange={confirmPassword.set}
                      placeholder={t('settings.confirmPassword')}
                      reveal={false}
                      autoComplete="new-password"
                      accessibilityLabel={t('settings.confirmPassword')}
                    />
                  </Field>
                  <ActionButton
                    label={passwordBusy() ? t('common.loading') : t('common.save')}
                    icon="check"
                    variant="primary"
                    disabled={passwordBusy()}
                    class={controlClass()}
                    testID="settings-save-password"
                    onPress={() => void changePassword()}
                  />
                </View>
                <If when={passwordError()}>
                  <Text class="text-xs text-destructive">{passwordError()}</Text>
                </If>
              </SettingsCard>
            </View>

            {/* 库文件自选：文件本身就是完整的保险库，切换后应用重新走启动流程。 */}
            <View ref={anchorRef('vault')} onLayout={(e) => onAnchorLayout('vault', e)} class="gap-4">
              <SettingsCard>
                <CardHeader icon="database" title={t('vault.sectionTitle')} hint={t('vault.hint')} />
                <View class="flex-row items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                  <View class="h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Icon name="database" size={15} color={token('primary')} />
                  </View>
                  <View class="flex-1 gap-0.5">
                    <Text class="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t('vault.current')}
                    </Text>
                    <Text class="text-xs text-foreground" style={{ numberOfLines: 2 }}>
                      {status().dbPath || '…'}
                    </Text>
                  </View>
                  <IconButton
                    icon="copy"
                    label={t('vault.copyPath')}
                    testID="settings-copy-path"
                    disabled={!status().dbPath}
                    onPress={() => void copyText(status().dbPath)}
                  />
                </View>
                <View class={phone() ? 'gap-2' : 'flex-row flex-wrap gap-2'}>
                  <ActionButton
                    label={t('vault.reveal')}
                    icon="eye"
                    class={phone() ? 'w-full' : ''}
                    onPress={() => void reveal()}
                  />
                  <ActionButton
                    label={t('vault.switch')}
                    icon="folder"
                    class={phone() ? 'w-full' : ''}
                    disabled={authBusy()}
                    onPress={() => void pickExistingVaultFile()}
                  />
                  <ActionButton
                    label={t('vault.create')}
                    icon="plus"
                    class={phone() ? 'w-full' : ''}
                    disabled={authBusy()}
                    onPress={() => void pickNewVaultFile()}
                  />
                  <ActionButton
                    label={t('vault.useDefault')}
                    icon="restore"
                    class={phone() ? 'w-full' : ''}
                    disabled={authBusy()}
                    onPress={() => void useDefaultVaultFile()}
                  />
                </View>
              </SettingsCard>
            </View>

            {/* 更新：版本信息 + 检查频率 + 手动检查与结果状态。 */}
            <View ref={anchorRef('update')} onLayout={(e) => onAnchorLayout('update', e)} class="gap-4">
              <SettingsCard>
                <CardHeader icon="refresh" title={t('update.title')} hint={t('update.hint')} />
                {/* 检查频率居左，检查按钮在其正下方，宽度与全页控件统一。 */}
                <Field
                  label={t('update.checkInterval')}
                  hint={t('update.checkIntervalHint')}
                  class={controlClass()}
                >
                  <SelectField
                    items={UPDATE_INTERVAL_OPTIONS.map((days) => ({
                      value: String(days),
                      title:
                        days === 0
                          ? t('update.intervalEveryLaunch')
                          : days === 7
                            ? t('update.intervalWeek')
                            : days === 30
                              ? t('update.intervalMonth')
                              : t('update.intervalYear'),
                    }))}
                    value={String(preferences().updateCheckIntervalDays)}
                    onChange={(value) => {
                      if (value !== null) setUpdateCheckIntervalDays(Number(value))
                    }}
                    class="w-full"
                  />
                </Field>
                <ActionButton
                  label={updateBusy() ? t('common.loading') : t('update.checkNow')}
                  icon="refresh"
                  class={controlClass()}
                  testID="settings-check-update"
                  disabled={updateBusy()}
                  onPress={() => void checkForUpdates()}
                />

                <If when={updateUpToDate() && !updateBusy()}>
                  <View class="flex-row items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5">
                    <Icon name="check" size={14} color={token('success')} />
                    <Text class="text-xs font-medium text-success">{t('update.upToDate')}</Text>
                  </View>
                </If>

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
                  <View class="flex-row items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
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

                {/* 控制区（频率/检查/结果）与身份区之间的浅灰分割线。 */}
                <View class="h-px w-full bg-border" />

                {/* 应用标识 + 版本：无边框无底色，放在检查结果横幅下方；
                    Badge 紧随 Mend 名称，版本与构建合并成一行。 */}
                <View class="flex-row flex-wrap items-center gap-3">
                  <View class="h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary">
                    <Icon name="shield" size={20} color={token('primary-foreground')} />
                  </View>
                  <View class="gap-0.5">
                    <View class="flex-row items-center gap-2">
                      <Text class="text-sm font-semibold text-foreground">
                        {appInfo().name ?? 'Mend'}
                      </Text>
                      <Badge label={t('settings.clientKind')} />
                    </View>
                    <Text class="text-xs text-muted-foreground">
                      {t('update.shellInfo', {
                        version: appInfo().version ?? '',
                        build: appInfo().build ?? 0,
                      })}
                    </Text>
                  </View>
                </View>
              </SettingsCard>
            </View>
          </Scroll>
        </View>
    </View>
  )
}

/** 页头装饰：两扇叠放的「窗口」+ 调色盘徽章，全部用主题 token 绘制，
 *  浅/深色自动适配，不引入位图资源。 */
function HeroArt() {
  return (
    <View class="pointer-events-none relative h-[84px] w-[210px] shrink-0">
      <View class="absolute left-0 top-4 h-[62px] w-[150px] gap-1.5 rounded-lg border border-border bg-card p-2.5 shadow-sm">
        <View class="flex-row gap-1">
          <View class="h-1.5 w-1.5 rounded-full bg-border" />
          <View class="h-1.5 w-1.5 rounded-full bg-border" />
          <View class="h-1.5 w-1.5 rounded-full bg-border" />
        </View>
        <View class="h-1.5 w-24 rounded-full bg-muted" />
        <View class="h-1.5 w-16 rounded-full bg-muted" />
        <View class="h-1.5 w-20 rounded-full bg-muted" />
      </View>
      <View class="absolute left-[52px] top-0 h-[62px] w-[150px] gap-1.5 rounded-lg border border-primary/25 bg-secondary p-2.5 shadow-md">
        <View class="flex-row gap-1">
          <View class="h-1.5 w-1.5 rounded-full bg-primary/40" />
          <View class="h-1.5 w-1.5 rounded-full bg-primary/40" />
          <View class="h-1.5 w-1.5 rounded-full bg-primary/40" />
        </View>
        <View class="h-1.5 w-24 rounded-full bg-primary/20" />
        <View class="h-1.5 w-16 rounded-full bg-primary/20" />
        <View class="h-1.5 w-20 rounded-full bg-primary/20" />
      </View>
      <View class="absolute bottom-0 right-0 h-10 w-10 items-center justify-center rounded-full bg-primary shadow-md">
        <Icon name="palette" size={18} color={token('primary-foreground')} />
      </View>
    </View>
  )
}