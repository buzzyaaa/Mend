import { expect, open, test } from 'nsh/test'

const EMPTY_STATUS = { initialized: false, unlocked: false, dataDir: '', dbPath: '' }

/** 只替换偏好读写：`Vault.init/status` 保持真实实现，启动流程与生产一致。 */
function preferencesModule(raw: string) {
  return {
    modules: {
      'mend/native': {
        'Vault.loadPreferences': () => raw,
        'Vault.savePreferences': () => {},
      },
    },
  }
}

// 回归：开发期曾为可视化验证把 Vault.init 硬编码到仓库内临时目录且忘记还原，
// 结果发布版会去读写开发机路径，headless 测试也会复用上次遗留的库。
// initVault 只能把宿主的 process.dataDir 交给原生层；headless 下它为空，
// 由 resolve_data_dir 回落到 MEND_DATA_DIR 隔离目录。
test('does not hardcode a development data directory on boot', async () => {
  let passed: unknown = 'not-called'
  const empty = EMPTY_STATUS
  const app = await open('./App.tsx', {
    modules: {
      'mend/native': {
        'Vault.init': (dir: string | null) => {
          passed = dir
          return empty
        },
        'Vault.status': () => empty,
      },
    },
  })
  await app.waitFor('label:Master password')
  expect(passed).toBe(null)
})

// 偏好持久化：boot() 在 `Vault.init` 之后从数据目录读回偏好（原生 `Vault.loadPreferences`，
// 不再用 nsh Storage —— 它写的 `%APPDATA%\storage.json` 在低权限进程下写不进去）。
// 测试默认系统语言是 en-US，种下 zh-CN 后首屏就是中文，才能证明偏好真的被应用。
test('applies saved language preference on boot', async () => {
  const app = await open(
    './App.tsx',
    preferencesModule(
      JSON.stringify({
        language: 'zh-CN',
        theme: 'system',
        autoLockMinutes: 60,
        updateCheckIntervalDays: 30,
        lastUpdateCheckTs: 0,
      }),
    ),
  )
  // 全新空库：首次设置主密码页；中文说明语言在首屏已生效。
  await app.waitFor('label:主密码')
  expect(app.texts()).toContain('创建并进入')
})

// 偏好内容损坏（截断的 JSON）或字段非法时只能回退默认偏好，不能把启动推进 Fatal。
test('falls back to default preferences when the stored value is corrupt', async () => {
  const app = await open('./App.tsx', preferencesModule('{"language": "zh-CN"'))
  await app.waitFor('label:Master password')
  expect(app.shows('text:出了点问题')).toBe(false)
})

// 启动瞬时 db 忙错误：boot() 自动重试 2 次后仍失败才进 Fatal；Fatal 显示原始
// `code|message` 诊断，且占用消失后页内「重试」能恢复，不会卡死在 Fatal 页。
// 用模块替身制造 `db|database is locked`，不碰真实库。
test('retries transient db lock, then recovers from the fatal page', async () => {
  let failing = true
  const uninitialized = EMPTY_STATUS
  const app = await open('./App.tsx', {
    modules: {
      'mend/native': {
        'Vault.init': () => {
          if (!failing) return uninitialized
          throw new Error('db|database is locked')
        },
        'Vault.status': () => uninitialized,
      },
    },
  })

  // 自动重试用尽（2 次 × 300ms）后停在 Fatal 页，并带出原始诊断细节。
  await app.waitFor('label:Try again')
  expect(app.texts()).toContain('Something went wrong')
  expect(app.texts()).toContain('db|database is locked')

  // 占用消失后，页内重试应重新 boot 并进入首次设置主密码页。
  failing = false
  await app.press('label:Try again')
  await app.waitFor('label:Master password')
  expect(app.shows('label:Try again')).toBe(false)
})

test('sets up a vault, creates an entry, and locks', async () => {
  const app = await open('./App.tsx')
  // 桌面窗口尺寸。headless 默认视口只有 390 宽，列表区会被压到每列 36 的
  // 下限宽度，标题列窄到放不下图标之外的字，`texts()` 里就查不到条目标题。
  await app.setViewport(1100, 780)
  await app.waitFor('label:Master password')
  await app.type('label:Master password', 'test-password-1234')
  await app.type('label:Confirm master password', 'test-password-1234')
  await app.press('Create and enter')
  await app.waitFor('text:Passwords')

  // 列宽拖动把手只挂在「相邻两列之间」：选择列右侧没有把手，最后一列（备注）
  // 右侧也没有——那段是操作列，不能拖窄，也不参与分宽度。
  expect(app.shows('id:resize-check')).toBe(false)
  expect(app.shows('id:resize-notes')).toBe(false)
  expect(app.shows('id:resize-tags')).toBe(true)

  await app.press('id:add-entry')
  await app.waitFor('text:New entry')
  await app.type('label:Title', 'GitHub')
  await app.type('label:Username', 'octocat')
  await app.type('label:Password', 's3cret')
  await app.press('text:Save')
  await app.waitFor('text:octocat')

  await app.press('label:Settings')
  await app.waitFor('text:Appearance & behavior')
  // 设置页已页面化：靠左侧导航的「列表」返回，不再有弹窗时代的关闭按钮。
  await app.press('id:nav-entries')
  // 「预设值」在顶栏和列表工具栏各有一个入口（宽窗口下两个都在），取第一个即可，
  // 它们打开的是同一个弹窗。
  await app.press('label:Presets >> nth=0')
  await app.waitFor('text:Presets')
  await app.press('id:presets-close')

  await app.press('label:Lock')
  await app.waitFor('label:Master password')
  await app.type('label:Master password', 'test-password-1234')
  await app.press('text:Unlock')
  await app.waitFor('text:Passwords')
  expect(app.texts()).toContain('GitHub')
})
