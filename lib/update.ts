import { appInfo, signal } from 'nsh'
import { t } from 'nsh/i18n'
import {
  checkForPackage,
  checkForUpdate,
  downloadPackage,
  downloadUpdate,
  installAndRestart,
  restartToPackage,
  shellInfo,
  type AppUpdate,
  type PackageUpdate,
} from 'nsh/updater'

import { formatBytes } from './format'
import { markUpdateChecked, preferences } from './preferences'
import { settingsOpen, toast, updatePromptOpen, updateTarget, type UpdateTarget } from './state'

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
/** 下载/安装阶段：确认弹窗关闭后，底部悬浮进度条用它显示状态。 */
export const updateRunning = signal(false)
export const updateStage = signal<'download' | 'install'>('download')

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function currentShell(): ReturnType<typeof shellInfo> {
  return shellInfo()
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
  updateRunning.set(false)
  updateStage.set('download')
}

/** 设置页关掉时清空上次检查结果，但正在后台下载/安装时不能打断。 */
export function resetUpdateCheckState(): void {
  if (updateRunning()) return
  resetUpdateState()
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
  updateBusy.set(true)
  updateError.set('')
  updateProgress.set(0)
  updatePackage.set(null)
  updateApp.set(null)
  try {
    const packageUpdate = await checkForPackage()
    if (packageUpdate) {
      updatePackage.set(packageUpdate)
    } else {
      const app = await checkForUpdate()
      updateApp.set(app)
      if (!app) {
        toast(t('update.upToDate'), 'info')
      }
    }
  } catch (error) {
    updateError.set(t('update.failed', { message: messageOf(error) }))
  } finally {
    updateBusy.set(false)
  }
}

/** 启动时静默检查更新：按偏好里的频率节流，发现新版本才弹更新确认弹窗。
 *  与设置页的「立即检查」不同——这里不弹「已是最新版本」，不打扰日常启动。 */
export async function checkForUpdatesOnStartup(): Promise<void> {
  // 开发/测试运行不检查：updater 在这类环境直接返回 null，且测试替身可能
  // 制造假更新弹窗干扰用例；生产包才真正请求。
  if (appInfo().development) return

  const { updateCheckIntervalDays: days, lastUpdateCheckTs: last } = preferences()
  // last === 0 表示从未检查过，必定检查一次；days === 0 表示每次启动都查。
  if (last > 0 && days > 0 && Date.now() - last < days * 86_400_000) return

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

/** 确认弹窗点「立即更新」：关掉弹窗和设置页，把下载/安装交给底部悬浮进度条。 */
export async function startUpdate(): Promise<void> {
  const target = updateTarget()
  if (!target || updateBusy() || updateRunning()) return
  const packageUpdate = target === 'package' ? updatePackage() : null
  const appUpdate = target === 'app' ? updateApp() : null
  if (!packageUpdate && !appUpdate) return

  updateRunning.set(true)
  updateStage.set('download')
  updateBusy.set(true)
  updateError.set('')
  updateProgress.set(0)
  closeUpdatePrompt()
  settingsOpen.set(false)

  const onProgress = (event: { received: number; total?: number | null }) => {
    updateProgress.set(progressOf(event.received, event.total))
  }

  try {
    if (packageUpdate) {
      await downloadPackage(onProgress)
    } else if (appUpdate) {
      await downloadUpdate(onProgress)
    }
    updateProgress.set(100)
    updateStage.set('install')
    if (packageUpdate) {
      await restartToPackage()
    } else if (appUpdate) {
      await installAndRestart()
    }
  } catch (error) {
    const message = t('update.failed', { message: messageOf(error) })
    updateError.set(message)
    toast(message, 'error')
  } finally {
    updateRunning.set(false)
    updateStage.set('download')
    updateBusy.set(false)
  }
}

export function packageSizeLabel(value: PackageUpdate): string {
  return value.size ? formatBytes(value.size) : ''
}
