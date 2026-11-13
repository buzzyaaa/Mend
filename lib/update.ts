import { signal } from 'nsh'
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
import { toast } from './state'

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
  updateBusy.set(false)
  updateProgress.set(0)
  updatePackage.set(null)
  updateApp.set(null)
  updateError.set('')
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

function progressOf(received: number, total?: number | null): number {
  if (!total) return 0
  return Math.max(0, Math.min(100, Math.round((received / total) * 100)))
}

export async function applyPackage(): Promise<void> {
  const current = updatePackage()
  if (!current || updateBusy()) return
  updateBusy.set(true)
  updateError.set('')
  updateProgress.set(0)
  try {
    await downloadPackage((event) => updateProgress.set(progressOf(event.received, event.total)))
    toast(t('update.restarting'), 'info')
    await restartToPackage()
  } catch (error) {
    updateError.set(t('update.failed', { message: messageOf(error) }))
  } finally {
    updateBusy.set(false)
  }
}

export async function applyAppUpdate(): Promise<void> {
  const current = updateApp()
  if (!current || updateBusy()) return
  updateBusy.set(true)
  updateError.set('')
  updateProgress.set(0)
  try {
    await downloadUpdate((event) => updateProgress.set(progressOf(event.received, event.total)))
    toast(t('update.restarting'), 'info')
    await installAndRestart()
  } catch (error) {
    updateError.set(t('update.failed', { message: messageOf(error) }))
  } finally {
    updateBusy.set(false)
  }
}

export function packageSizeLabel(value: PackageUpdate): string {
  return value.size ? formatBytes(value.size) : ''
}
