// 窗口控制：最小化 / 最大化切换 / 关闭 / 拖拽 / 还原。
// 仅在 Tauri 运行时有效；浏览器预览环境下调用静默失败，不抛错阻断界面。
import { isTauri } from './ipc'

async function currentWindow() {
  if (!isTauri()) return null
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow()
}

/** 由标题栏 mousedown 触发：启动一次系统级窗口拖拽（必须在鼠标按下事件内同步调用）。 */
export async function startWindowDrag(): Promise<void> {
  const win = await currentWindow()
  await win?.startDragging()
}

export async function minimizeWindow(): Promise<void> {
  const win = await currentWindow()
  await win?.minimize()
}

export async function maximizeWindow(): Promise<void> {
  const win = await currentWindow()
  await win?.maximize()
}

export async function unmaximizeWindow(): Promise<void> {
  const win = await currentWindow()
  await win?.unmaximize()
}

/** 还原：从最大化则取消最大化；从最小化则恢复窗口。 */
export async function restoreWindow(): Promise<void> {
  const win = await currentWindow()
  if (!win) return
  if (await win.isMaximized()) {
    await win.unmaximize()
  } else if (await win.isMinimized()) {
    await win.unminimize()
  }
}

export async function closeWindow(): Promise<void> {
  const win = await currentWindow()
  await win?.close()
}

export async function isMaximized(): Promise<boolean> {
  const win = await currentWindow()
  return (await win?.isMaximized()) ?? false
}

export async function isMinimized(): Promise<boolean> {
  const win = await currentWindow()
  return (await win?.isMinimized()) ?? false
}

/** 订阅窗口尺寸变化，用于同步「最大化」按钮图标；返回取消订阅函数。 */
export async function onWindowResized(handler: () => void): Promise<() => void> {
  const win = await currentWindow()
  if (!win) return () => {}
  const unlisten = await win.onResized(() => handler())
  return () => void unlisten()
}
