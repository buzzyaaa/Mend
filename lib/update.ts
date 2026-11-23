import { appInfo, signal } from 'nsh'
import { t } from 'nsh/i18n'
import {
  checkForPackage,
  checkForUpdate,
  downloadPackage,
  downloadUpdate,
  installAndRestart,
  restartToPackage,
  type AppUpdate,
  type PackageUpdate,
} from 'nsh/updater'

import { formatBytes } from './format'
import * as native from './native'
import {
  clearPackageReadyInstall,
  clearPendingUpdate,
  markPackageReadyInstall,
  markPendingUpdate,
  markUpdateChecked,
  preferences,
} from './preferences'
import { activePage, toast, updatePromptOpen, updateTarget, type UpdateTarget } from './state'

export interface UpdateState {
  busy: boolean
  progress: number
  package: PackageUpdate | null
  app: AppUpdate | null
  error: string
}

export const updateBusy = signal(false)
export const updateProgress = signal(0)
export const updatePackage = signal<PackageUpdate | null>(null)
export const updateApp = signal<AppUpdate | null>(null)
export const updateError = signal('')
/** 手动检查完成且没有更新：设置页据此显示「已是最新版本」，而不只靠 toast。 */
export const updateUpToDate = signal(false)
/** 下载/安装阶段：确认弹窗关闭后，底部悬浮进度条用它显示状态。 */
export const updateRunning = signal(false)
export const updateStage = signal<'download' | 'install'>('download')
/** 数据目录里已有完整下载、校验通过的代码包（updates/next.nshpkg）：
 *  为 true 时安装不再重新下载，直接重启应用。 */
export const updatePackageReady = signal(false)

/** 下载失败自动重试的次数（每次都从头下载：运行时的更新器不支持断点续传，
 *  中断的半成品文件会被它删除；自动重试至少免去用户手动点重来）。 */
const DOWNLOAD_ATTEMPTS = 3
/** 进入安装阶段后允许的最长等待：`installAndRestart`/`restartToPackage`
 *  成功路径的 promise 永不 resolve（进程要退出），若安装或重启在系统层
 *  卡住，没有这个看门狗 UI 就永远停在「安装中」。 */
const INSTALL_WATCHDOG_MS = 45_000

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 问原生侧：数据目录里是否已有校验通过的代码包在等下次启动。
 *  失败（表未初始化、目录定位不到）一律按「没有」处理，不影响其它流程。 */
export function detectReadyPackage(): void {
  try {
    updatePackageReady.set(native.checkPackageReady())
  } catch {
    updatePackageReady.set(false)
  }
}

export function hasUpdate(): boolean {
  return updatePackage() !== null || updateApp() !== null
}

export function resetUpdateState(): void {
  updatePromptOpen.set(false)
  updateTarget.set(null)
  updateBusy.set(false)
  updateProgress.set(0)
  updatePackage.set(null)
  updateApp.set(null)
  updateError.set('')
  updateUpToDate.set(false)
  updateRunning.set(false)
  updateStage.set('download')
  updatePackageReady.set(false)
}

/** 离开设置页时清掉上次手动检查的结果，避免「已是最新版本」残留到下次进入；
 *  正在后台下载/安装时不能打断，也不动更新确认弹窗依赖的 package/app。 */
export function clearUpdateCheckResult(): void {
  if (updateRunning()) return
  updateUpToDate.set(false)
  updateError.set('')
}

export function openUpdatePrompt(target: UpdateTarget): void {
  if (updateBusy() || updateRunning()) return
  if (target === 'package' && !updatePackage()) return
  if (target === 'app' && !updateApp()) return
  updateTarget.set(target)
  updatePromptOpen.set(true)
}

export function closeUpdatePrompt(): void {
  updatePromptOpen.set(false)
  updateTarget.set(null)
}

/** Check for an OTA package first, then for a whole-app update. */
export async function checkForUpdates(): Promise<void> {
  if (updateBusy()) return
  // 离线模式：连一次请求都不发，也不显示「已是最新版本」这类误导结果。
  if (preferences().offline) {
    toast(t('update.offlineSkipped'), 'info')
    return
  }
  detectReadyPackage()
  updateBusy.set(true)
  updateError.set('')
  updateProgress.set(0)
  updatePackage.set(null)
  updateApp.set(null)
  updateUpToDate.set(false)
  try {
    const packageUpdate = await checkForPackage()
    if (packageUpdate) {
      updatePackage.set(packageUpdate)
    } else {
      const app = await checkForUpdate()
      updateApp.set(app)
      if (!app) {
        updateUpToDate.set(true)
        toast(t('update.upToDate'), 'info')
        // 确认已最新：待更新记录与「已装过旧包」的防循环标记都可以清了。
        clearPendingUpdate()
        clearPackageReadyInstall()
      }
    }
  } catch (error) {
    updateError.set(t('update.failed', { message: messageOf(error) }))
  } finally {
    updateBusy.set(false)
  }
}

/** 启动时静默检查更新：按偏好里的频率节流，发现新版本才弹更新确认弹窗。
 *  与设置页的「立即检查」不同——这里不弹「已是最新版本」，不打扰日常启动。
 *
 *  两条「把上次没走完的更新续上」的旁路，都会跳过频率节流：
 *  1. 数据目录里已有校验通过的代码包（上次下载完但没重启成功）——确认
 *     仍有新版本后直接弹安装弹窗，点确认即可安装，不用重新下载；
 *  2. 偏好里记着的待更新版本（上次下载完成但重启失败/被手动关闭）——
 *     只要该版本仍然可用就立即重新弹窗。 */
export async function checkForUpdatesOnStartup(): Promise<void> {
  // 开发/测试运行不检查：updater 在这类环境直接返回 null，且测试替身可能
  // 制造假更新弹窗干扰用例；生产包才真正请求。
  if (appInfo().development) return
  if (preferences().offline) return

  detectReadyPackage()
  const { updateCheckIntervalDays: days, lastUpdateCheckTs: last, pendingUpdateVersion: pending } =
    preferences()
  const resume = pending !== '' || (updatePackageReady() && preferences().packageReadyInstallTs === 0)
  // last === 0 表示从未检查过，必定检查一次；days === 0 表示每次启动都查。
  if (!resume && last > 0 && days > 0 && Date.now() - last < days * 86_400_000) return

  let target: UpdateTarget | null = null
  try {
    const pkg = await checkForPackage()
    if (pkg) {
      updatePackage.set(pkg)
      target = 'package'
    } else {
      const app = await checkForUpdate()
      if (app) {
        updateApp.set(app)
        target = 'app'
      }
    }
    // 只有真正完成了检查才记时间：网络失败时下次启动还可重试。
    markUpdateChecked()
    // 检查确认已最新：待更新记录与防循环标记都可以清了。
    if (!target) {
      clearPendingUpdate()
      clearPackageReadyInstall()
    }
  } catch {
    // 启动检查失败静默：不弹 toast、不阻断启动。
    return
  }
  if (target) openUpdatePrompt(target)
}

function progressOf(received: number, total?: number | null): number {
  if (!total) return 0
  return Math.max(0, Math.min(100, Math.round((received / total) * 100)))
}

/** 确认弹窗点「立即更新」：关掉弹窗和设置页，把下载/安装交给底部悬浮进度条。
 *
 *  代码包已在本地校验通过（updatePackageReady）时不重新下载，直接重启安装；
 *  下载失败自动重试；安装阶段有看门狗，重启卡住时给出明确报错而不是永远
 *  停在「安装中」。 */
export async function startUpdate(): Promise<void> {
  const target = updateTarget()
  if (!target || updateBusy() || updateRunning()) return
  // 更新包下载同样属于外部请求，离线模式下直接拒绝。
  if (preferences().offline) {
    toast(t('update.offlineSkipped'), 'info')
    return
  }
  const packageUpdate = target === 'package' ? updatePackage() : null
  const appUpdate = target === 'app' ? updateApp() : null
  if (!packageUpdate && !appUpdate) return
  // 已有校验通过的代码包：直接安装不重新下载。只走一次——装过之后版本
  // 仍未变（防循环标记非 0）说明启动器拒绝了那个包，这次回退为重新下载。
  const installReady =
    packageUpdate !== null && updatePackageReady() && preferences().packageReadyInstallTs === 0

  updateRunning.set(true)
  updateStage.set('download')
  updateBusy.set(true)
  updateError.set('')
  updateProgress.set(0)
  closeUpdatePrompt()
  activePage.set('entries')

  const onProgress = (event: { received: number; total?: number | null }) => {
    updateProgress.set(progressOf(event.received, event.total))
  }

  // 安装阶段看门狗：installAndRestart / restartToPackage 成功路径的 promise
  // 永不 resolve（进程退出），安装或重启被系统卡住时只能靠它把 UI 救回来。
  let watchdog: ReturnType<typeof setTimeout> | null = null
  const clearWatchdog = () => {
    if (watchdog) {
      clearTimeout(watchdog)
      watchdog = null
    }
  }

  try {
    if (installReady) {
      // 记下这次直接安装：若重启后版本没变（旧包被启动器拒绝），下次
      // 启动不再跳过下载，回退为正常重新下载。
      markPackageReadyInstall()
      updateProgress.set(100)
    } else {
      // 下载失败自动重试：运行时失败时会清掉半成品文件，每次重试从零开始。
      for (let attempt = 1; ; attempt++) {
        try {
          updateProgress.set(0)
          if (packageUpdate) {
            await downloadPackage(onProgress)
          } else if (appUpdate) {
            await downloadUpdate(onProgress)
          }
          break
        } catch (error) {
          if (attempt >= DOWNLOAD_ATTEMPTS) throw error
        }
      }
      // 下载已完成、接下来可能重启失败（卡住或用户手动关闭）：记下版本，
      // 下次启动跳过检查频率节流，立即重新弹窗把更新续上。
      markPendingUpdate(packageUpdate ? packageUpdate.version : (appUpdate as AppUpdate).version)
      updateProgress.set(100)
    }
    updateStage.set('install')
    watchdog = setTimeout(() => {
      if (!updateRunning()) return
      const message = t('update.installStuck')
      updateError.set(message)
      toast(message, 'error')
      updateRunning.set(false)
      updateBusy.set(false)
      updateStage.set('download')
    }, INSTALL_WATCHDOG_MS)
    if (packageUpdate) {
      await restartToPackage()
    } else if (appUpdate) {
      await installAndRestart()
    }
    // 成功路径不会走到这里：应用随重启退出，promise 永不 resolve。
  } catch (error) {
    const message = t('update.failed', { message: messageOf(error) })
    updateError.set(message)
    toast(message, 'error')
  } finally {
    clearWatchdog()
    updateRunning.set(false)
    updateStage.set('download')
    updateBusy.set(false)
  }
}

export function packageSizeLabel(value: PackageUpdate): string {
  return value.size ? formatBytes(value.size) : ''
}
