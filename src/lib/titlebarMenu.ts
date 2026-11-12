// 标题栏右键菜单：复刻 Windows 标题栏菜单（还原 / 移动 / 大小 / 最小化 / 最大化 / 关闭）。
// 仅在 Tauri 运行时弹出；浏览器预览下静默跳过（无原生菜单概念）。
//
// 依赖两处 Tauri 能力：
// 1. 菜单本身的创建与 popup 走 `core:menu:default`（已在 core:default 内）；
// 2. 每个菜单项的动作最终都落到窗口能力上，因此需要 capabilities/default.json 里显式授权的
//    core:window:allow-{minimize,maximize,unmaximize,close,...}——core:window:default 只含读取类
//    接口、不含动作类。缺授权时菜单本身能弹出，但点任何一项都没反应（前端 .catch() 会静默吞掉错误）。
//
// 每次右键都重新构建菜单：菜单是瞬时浮层，重建 8 个对象的代价可以忽略，
// 换来的是语言切换后文案一定最新（缓存会让菜单停留在旧 locale）。
// 注：@tauri-apps/api 的 Resource 没有 finalizer，JS 侧 GC 不会主动销毁 Rust 侧资源，
// 因此这里不涉及生命周期抢救。
// 此处不在组件 setup 内，因此直接用 i18n 全局实例取文案。
import { Menu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu'
import { LogicalPosition } from '@tauri-apps/api/dpi'
import { i18n } from '@/i18n'
import { isTauri } from './ipc'
import {
  closeWindow,
  isMaximized,
  maximizeWindow,
  minimizeWindow,
  restoreWindow,
  startWindowDrag,
  unmaximizeWindow,
} from './window'

async function buildMenu(max: boolean): Promise<Menu> {
  const t = i18n.global.t
  const run = (fn: () => Promise<void>) => () => void fn().catch(() => {})

  const [restore, move, size, sep1, minimize, maximize, sep2, close] = await Promise.all([
    MenuItem.new({ text: t('winMenu.restore'), action: run(restoreWindow) }),
    MenuItem.new({ text: t('winMenu.move'), action: run(startWindowDrag) }),
    MenuItem.new({ text: t('winMenu.size'), action: run(startWindowDrag) }),
    PredefinedMenuItem.new({ item: 'Separator' }),
    MenuItem.new({ text: t('winMenu.minimize'), action: run(minimizeWindow) }),
    MenuItem.new({
      text: max ? t('winMenu.restoreDown') : t('winMenu.maximize'),
      action: run(max ? unmaximizeWindow : maximizeWindow),
    }),
    PredefinedMenuItem.new({ item: 'Separator' }),
    MenuItem.new({ text: t('winMenu.close'), action: run(closeWindow) }),
  ])

  return Menu.new({ items: [restore, move, size, sep1, minimize, maximize, sep2, close] })
}

/** 在 (x, y) 处弹出标题栏右键菜单。非 Tauri 环境直接返回。 */
export async function showWindowMenu(x: number, y: number): Promise<void> {
  if (!isTauri()) return
  try {
    const max = await isMaximized()
    const menu = await buildMenu(max)
    await menu.popup(new LogicalPosition(x, y))
  } catch {
    // 菜单构建/弹出失败不影响主界面（调用方是 void 触发的全局监听）
  }
}
