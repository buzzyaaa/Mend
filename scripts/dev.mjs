#!/usr/bin/env node
/**
 * 干净的开发入口：`npm run dev` → 本脚本。
 *
 * 为什么需要它：`nsh dev .` 会沿用上一次的开发会话（端口记录在
 * %LOCALAPPDATA%\nsh\dev-sessions）并「接管」旧会话。只要上次的宿主进程还活着
 * （或者还开着旧的打包版 Mend.exe），新起的开发窗口就可能仍然显示旧代码，
 * 表现就是「改了没生效，要清缓存才行」。
 *
 * 启动前做三件事（都幂等，可反复执行）：
 *   1. 结束本仓库内的旧进程：target/debug/nsh-app-*-windows-host.exe（旧开发宿主）
 *      以及 .nsh/out/Mend/Mend.exe（旧的打包版窗口，永远是过期构建）；
 *   2. 结束残留的 nsh 开发服务器（开发会话端口 8790-8799）；
 *   3. 清空 %LOCALAPPDATA%\nsh\dev-sessions 里的端口锁与会话记录。
 * 然后前台启动 `nsh dev .`，参数原样透传（例如 `npm run dev -- --release`）。
 *
 * 用法：
 *   npm run dev              干净启动
 *   npm run dev:raw          不清理，直接 `nsh dev .`
 *   node scripts/dev.mjs --dry-run   只打印会清理哪些进程/文件
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const raw = args.includes('--raw')
const passthrough = args.filter((arg) => arg !== '--dry-run' && arg !== '--raw')

function log(message) {
  console.log(`[dev] ${message}`)
}

function powershell(script) {
  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', windowsHide: true },
  )
  for (const line of (result.stdout ?? '').split(/\r?\n/)) {
    if (line.trim()) log(line.trim())
  }
}

function stopMatching(filter, label) {
  // filter 是一段 PowerShell 管道筛选，拿到进程对象后统一打印 + 结束
  const kill = dryRun ? '' : 'Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue'
  powershell(
    `${filter} | ForEach-Object { ` +
      `Write-Output ("${label} " + $_.ProcessName + " (" + $_.Id + ") " + $_.Path); ${kill} }`,
  )
}

function cleanStaleProcesses() {
  if (process.platform !== 'win32') return
  const repo = root.replace(/'/g, "''")
  // 本仓库内的旧开发宿主（target/debug/nsh-app-*-windows-host.exe）与旧打包版（Mend.exe）。
  // 只按进程名挑，避免误杀 cargo/rustc/gcc 的构建子进程。
  stopMatching(
    `Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith('${repo}', [StringComparison]::OrdinalIgnoreCase) -and ($_.ProcessName -eq 'Mend' -or $_.ProcessName -like 'nsh-app-*') }`,
    'stop',
  )
  // 残留的 nsh 开发服务器
  stopMatching('Get-Process -Name nsh -ErrorAction SilentlyContinue', 'stop nsh dev server')
}

function cleanDevSessions() {
  const base = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
  const dir = join(base, 'nsh', 'dev-sessions')
  if (!existsSync(dir)) return
  const names = readdirSync(dir)
  if (dryRun) {
    if (names.length > 0)
      log(`would clear ${names.length} dev-session file(s): ${names.join(', ')}`)
    return
  }
  for (const name of names) rmSync(join(dir, name), { recursive: true, force: true })
  if (names.length > 0) log(`cleared ${names.length} dev-session file(s)`)
}

if (!raw) {
  cleanStaleProcesses()
  cleanDevSessions()
}

if (dryRun) {
  log('dry run: not starting nsh dev')
  process.exit(0)
}

log('starting nsh dev .')
const child = spawn('nsh', ['dev', '.', ...passthrough], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
