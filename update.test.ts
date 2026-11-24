import { expect, test } from 'nsh/test'

import { isShellOutdated } from './lib/update'

// OTA 只换代码包不换外壳。代码包 build 高于外壳 build 时必须判为「外壳落后」，
// 让检查更新改推整包——否则依赖新原生层的能力（开机自启）会一直不可用。
test('shell is outdated only when a running package is newer than the shell', () => {
  // 真实场景：0.6.2 外壳（构建 31）+ 0.6.3 代码包（构建 32）。
  expect(isShellOutdated(32, 31)).toBe(true)

  // 外壳与代码包构建一致 / 外壳更新：都不算落后。
  expect(isShellOutdated(32, 32)).toBe(false)
  expect(isShellOutdated(32, 33)).toBe(false)

  // 没有 OTA 代码包（原生安装的应用）：无从比较，不判落后。
  expect(isShellOutdated(null, 31)).toBe(false)
  expect(isShellOutdated(undefined, 31)).toBe(false)
})
