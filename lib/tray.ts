/** 系统托盘与关闭按钮行为。
 *
 *  nsh 用系统标题栏，关闭按钮默认直接关窗口。这里把主窗口的 `closeOnPress`
 *  关掉，改为应用自己决定：
 *  - 第一次关闭：弹一次询问（确定＝缩到托盘，取消＝退出），并把选择记进偏好；
 *  - 之后关闭：按偏好静默执行，不再询问，只能在设置里手动改。
 *
 *  托盘图标从启动起常驻，只有退出应用才移除。左键点或菜单「打开主面板」
 *  回密码列表页并 show + focus 窗口；右键菜单固定三项。手机端无桌面 API，
 *  全部逻辑自动降级为直接退出。
 */
import { effect } from 'nsh'
import {
  Application,
  Tray,
  Window,
  isAvailable,
  type MenuItem,
  type WindowRef,
} from 'nsh/desktop'
import { t } from 'nsh/i18n'

import appIcon from '../assets/icon.png'

import { activePage, confirm } from './state'
import { preferences, setCloseMinimizeToTray } from './preferences'

let installed = false
let quitting = false

/** 托盘菜单：打开主面板 / 设置 / 退出 Mend。左键点击等同「打开主面板」。 */
function trayMenu(): MenuItem[] {
  return [
    { label: t('tray.open'), onSelect: () => openMainWindow() },
    { label: t('tray.settings'), onSelect: () => openSettings() },
    { type: 'separator' },
    { label: t('tray.quit'), onSelect: () => quitApp() },
  ]
}

/** 打开主面板：回到启动后的首页（密码列表页），显示并聚焦窗口。
 *  锁定时 App 仍显示解锁页，activePage 的变化不影响它；解锁后自然落在密码列表页。 */
export function openMainWindow(): void {
  activePage.set('entries')
  if (!isAvailable) return
  const win = Window.get('main')
  win?.show()
  win?.focus()
}

/** 从托盘进设置页：先切页再显示窗口，避免用户先看到条目页再跳。 */
function openSettings(): void {
  activePage.set('settings')
  if (!isAvailable) return
  const win = Window.get('main')
  win?.show()
  win?.focus()
}

/** 彻底退出：先撤托盘图标，再走应用级退出（Application.quit 不受 closeOnPress 拦截）。 */
export function quitApp(): void {
  if (quitting) return
  quitting = true
  if (isAvailable) Tray.set(null)
  Application.quit()
}

/** 缩到托盘：隐藏窗口，托盘图标保持常驻。 */
function minimizeToTray(win: WindowRef): void {
  win.hide()
}

/** 首次关闭的询问。取消与 Esc 都走 onCancel（=记录「不缩托盘」并退出）。 */
function askCloseOnce(win: WindowRef): void {
  confirm.set({
    title: t('tray.closeTitle'),
    message: t('tray.closeMessage'),
    confirmLabel: t('tray.minimize'),
    cancelLabel: t('tray.quit'),
    destructive: false,
    onConfirm: () => {
      setCloseMinimizeToTray(true)
      minimizeToTray(win)
    },
    onCancel: () => {
      setCloseMinimizeToTray(false)
      quitApp()
    },
  })
}

/** 在 App 渲染期调用一次：拦截主窗口关闭，按偏好决定缩托盘还是退出。
 *  必须在渲染期取得 `currentWindow()`，之后闭包持有这个引用。 */
export function installTrayHandlers(mainWindow: WindowRef | null): void {
  if (!isAvailable || !mainWindow || installed) return
  installed = true

  mainWindow.set({ closeOnPress: false })
  mainWindow.on('closePress', () => {
    const prefs = preferences()
    if (!prefs.trayChoiceMade) {
      askCloseOnce(mainWindow)
    } else if (prefs.closeMinimizeToTray) {
      minimizeToTray(mainWindow)
    } else {
      quitApp()
    }
  })
}

/** 在 App 渲染期调用一次：托盘图标常驻，菜单文案跟随语言。 */
export function installTrayEffect(): void {
  if (!isAvailable) return
  effect(() => {
    // 读一次语言偏好作为依赖：切语言时菜单文案随之刷新。
    preferences().language
    Tray.set({
      icon: appIcon,
      tooltip: t('app.name'),
      menu: trayMenu(),
      onClick: () => openMainWindow(),
    })
  })
}

/** headless / 无桌面环境下（如 nsh test），复位安装标志避免测试间串扰。 */
export function resetTrayForTest(): void {
  installed = false
  quitting = false
  if (isAvailable) Tray.set(null)
}
