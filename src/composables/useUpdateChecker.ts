// 自动更新调度：按用户设定的间隔（每周/每月/每年）在启动时检查 GitHub 是否有新版本，
// 有则弹窗提醒；同时提供手动"立即检查"。数据获取与安装走 `src/lib/update.ts` 的抽象层。

import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDialog } from 'naive-ui'
import { usePreferencesStore } from '@/stores/preferences'
import { useToast } from '@/composables/useToast'
import { getUpdateProvider, type AppUpdate } from '@/lib/update'
import { isTauri } from '@/lib/ipc'

const DAY_MS = 24 * 60 * 60 * 1000

export function useUpdateChecker() {
  const { t } = useI18n()
  const preferences = usePreferencesStore()
  const toast = useToast()
  const dialog = useDialog()

  /** 是否到了该检查的时间（按用户设定的间隔）。 */
  const checking = ref(false)

  function isDue(): boolean {
    return Date.now() - preferences.lastUpdateCheckTs >= preferences.updateCheckIntervalDays * DAY_MS
  }

  /**
   * 检查更新。
   * @param manual 是否手动触发（手动时无论是否到期都查，且结果用 Toast 反馈）
   */
  async function runCheck(manual = false): Promise<void> {
    if (!isTauri()) return
    if (!manual && !isDue()) return

    checking.value = true
    try {
      const update = await getUpdateProvider().check()
      // 不论有无更新都刷新"上次检查时间"，避免频繁打扰用户
      preferences.setLastUpdateCheckTs(Date.now())
      if (!update) {
        if (manual) toast.success(t('update.upToDate'))
        return
      }
      showUpdateDialog(update)
    } catch (err) {
      // 自动检查失败静默处理；手动失败给明确反馈
      if (manual) {
        toast.error(t('update.checkFailed', { message: err instanceof Error ? err.message : String(err) }))
      }
    } finally {
      checking.value = false
    }
  }

  function showUpdateDialog(update: AppUpdate) {
    dialog.info({
      title: t('update.availableTitle', { version: update.version }),
      content: update.notes?.trim()
        ? t('update.availableBody', { notes: update.notes.trim() })
        : t('update.availableBodyPlain'),
      positiveText: t('update.updateNow'),
      negativeText: t('update.later'),
      onPositiveClick: async () => {
        try {
          await update.install()
          // 安装后会自动退出并重启，不会执行到这里
        } catch (err) {
          toast.error(t('update.installFailed', { message: err instanceof Error ? err.message : String(err) }))
        }
      },
    })
  }

  return { checking, isDue, runCheck }
}
