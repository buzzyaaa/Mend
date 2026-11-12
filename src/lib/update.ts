// 更新服务抽象层。
//
// 设计目的：把"更新数据源"与界面/调度逻辑解耦，方便未来把 GitHub Releases 换成自建更新服务器。
//
// 当前实现：基于 Tauri 官方 updater 插件，数据源为 `tauri.conf.json` 中
//   `plugins.updater.endpoints` 指向的 GitHub Releases `latest.json`。
//
// 未来替换（两种粒度，按需选择）：
//   1. 仅换数据源地址（仍沿用 GitHub 的 latest.json 格式）：直接改 `tauri.conf.json` 的 `endpoints`，无需动代码。
//   2. 换成完全不同的更新协议（如自建服务器、内网分发）：实现一个新的 `UpdateProvider`
//      （用 fetch 拉取版本信息并下载安装包），只改本文件的 `getUpdateProvider()` 一行，
//      UI 与调度逻辑（useUpdateChecker）完全不用改。

import type { Update } from '@tauri-apps/plugin-updater'
import { isTauri } from './ipc'

/** 对 UI 暴露的更新信息（与具体数据源无关）。 */
export interface AppUpdate {
  /** 新版本号（SemVer，可能带或不带 `v` 前缀）。 */
  version: string
  /** 更新说明（可选）。 */
  notes?: string
  /** 发布时间（RFC 3339，可选）。 */
  date?: string
  /** 下载并安装；Windows 下安装时会先退出应用，安装完成后需重启。 */
  install: () => Promise<void>
}

/** 更新数据源抽象：检查更新 + 安装更新。 */
export interface UpdateProvider {
  /** 检查更新；无可用更新返回 null。 */
  check: () => Promise<AppUpdate | null>
}

// —— 当前实现：Tauri updater 插件（GitHub 数据源）——
class GithubUpdateProvider implements UpdateProvider {
  async check(): Promise<AppUpdate | null> {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update: Update | null = await check()
    if (!update) return null
    return {
      version: update.version,
      notes: update.body ?? undefined,
      date: update.date ?? undefined,
      install: async () => {
        const { relaunch } = await import('@tauri-apps/plugin-process')
        await update.downloadAndInstall()
        await relaunch()
      },
    }
  }
}

let provider: UpdateProvider | null = null

/** 获取当前更新数据源实现；未来替换数据源只改这里。 */
export function getUpdateProvider(): UpdateProvider {
  if (!provider) provider = new GithubUpdateProvider()
  return provider
}

/** 当前应用版本（来自 Tauri；浏览器预览环境下返回空串）。 */
export async function getAppVersion(): Promise<string> {
  if (!isTauri()) return ''
  const { getVersion } = await import('@tauri-apps/api/app')
  return getVersion()
}
