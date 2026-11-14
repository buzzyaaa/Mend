import { expect, open, test } from 'nsh/test'

const PREFERENCES_KEY = 'mend.preferences.v1'

// 回归：开发期曾为可视化验证把 Vault.init 硬编码到仓库内临时目录且忘记还原，
// 结果发布版会去读写开发机路径，headless 测试也会复用上次遗留的库。
// initVault 只能把宿主的 process.dataDir 交给原生层；headless 下它为空，
// 由 resolve_data_dir 回落到 MEND_DATA_DIR 隔离目录。
test('does not hardcode a development data directory on boot', async () => {
  let passed: unknown = 'not-called'
  const empty = { initialized: false, unlocked: false, dataDir: '', dbPath: '' }
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

// 偏好持久化（修复前 `loadPreferences()` 全仓库没有调用方，设置里改的语言/主题/
// 自动锁定在重启后丢失）：启动时 boot() 必须在 initVault 之前读回 Storage。
// 测试默认系统语言是 en-US，种下 zh-CN 后首屏就是中文，才能证明偏好真的被应用。
test('applies saved language preference on boot', async () => {
  const app = await open('./App.tsx', {
    storage: {
      [PREFERENCES_KEY]: JSON.stringify({
        language: 'zh-CN',
        theme: 'dark',
        autoLockMinutes: 60,
        updateCheckIntervalDays: 30,
        lastUpdateCheckTs: 0,
      }),
    },
  })
  // 全新空库：首次设置主密码页；中文说明语言在首屏已生效。
  await app.waitFor('label:主密码')
  expect(app.texts()).toContain('创建并进入')
})

// 存储内容损坏（截断的 JSON）或字段非法时只能回退默认偏好，不能把启动推进 Fatal。
test('falls back to default preferences when the stored value is corrupt', async () => {
  const app = await open('./App.tsx', {
    storage: { [PREFERENCES_KEY]: '{"language": "zh-CN"' },
  })
  await app.waitFor('label:Master password')
  expect(app.shows('text:出了点问题')).toBe(false)
})

// 启动瞬时 db 忙错误：boot() 自动重试 2 次后仍失败才进 Fatal；Fatal 显示原始
// `code|message` 诊断，且占用消失后页内「重试」能恢复，不会卡死在 Fatal 页。
// 用模块替身制造 `db|database is locked`，不碰真实库。
test('retries transient db lock, then recovers from the fatal page', async () => {
  let failing = true
  const uninitialized = { initialized: false, unlocked: false, dataDir: '', dbPath: '' }
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
  await app.waitFor('label:Master password')
  await app.type('label:Master password', 'test-password-1234')
  await app.type('label:Confirm master password', 'test-password-1234')
  await app.press('Create and enter')
  await app.waitFor('text:Passwords')

  await app.press('id:add-entry')
  await app.waitFor('text:New entry')
  await app.type('label:Title', 'GitHub')
  await app.type('label:Username', 'octocat')
  await app.type('label:Password', 's3cret')
  await app.press('text:Save')
  await app.waitFor('text:octocat')

  await app.press('label:Settings')
  await app.waitFor('text:Appearance & behavior')
  await app.press('id:settings-close')
  await app.press('label:Presets')
  await app.waitFor('text:Presets')
  await app.press('id:presets-close')

  await app.press('label:Lock')
  await app.waitFor('label:Master password')
  await app.type('label:Master password', 'test-password-1234')
  await app.press('text:Unlock')
  await app.waitFor('text:Passwords')
  expect(app.texts()).toContain('GitHub')
})
