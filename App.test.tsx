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
  // headless 默认是 phone idiom：不指定 desktop platform 的话，1100 宽也走
  // 单页滚动（无设置内导航），桌面子导航就没有回归覆盖。
  const app = await open('./App.tsx', { platform: 'windows' })
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
  // 快速导航只剩四个分区，「关于」已并入更新卡，导航项不得残留。
  expect(app.shows('id:settings-nav-appearance')).toBe(true)
  expect(app.shows('id:settings-nav-security')).toBe(true)
  expect(app.shows('id:settings-nav-vault')).toBe(true)
  expect(app.shows('id:settings-nav-update')).toBe(true)
  expect(app.shows('id:settings-nav-about')).toBe(false)
  // 回归：点靠尾部的「数据库文件」时滚动被夹到触底，高亮必须收敛到点击意图，
  // 不能被触底判定抢成最后分区（程序化滚动锁 + 意图收敛）。
  // 用「未选中色」做基准，浅/深色主题都成立。
  const inactiveColor = app.spanStyle('id:settings-nav-vault >> text:Database file').color
  await app.press('id:settings-nav-vault')
  await app.wait(800)
  expect(app.spanStyle('id:settings-nav-vault >> text:Database file').color).not.toBe(inactiveColor)
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
  // 原生会话是进程级的：不锁的话下一个用例 boot 直接进主界面，拿不到解锁页。
  await app.press('label:Lock')
  await app.waitFor('label:Master password')
})

// 标签快速填写：编辑弹窗在输入框下方列出全库已有标签，点击加入输入框、
// 再点移除；逗号分隔的自由输入不受影响。
test('entry editor lists existing tags for one-tap fill', async () => {
  const app = await open('./App.tsx', { platform: 'windows' })
  await app.setViewport(1100, 780)
  await app.waitFor('label:Master password')
  await app.type('label:Master password', 'test-password-1234')
  if (app.shows('label:Confirm master password')) {
    await app.type('label:Confirm master password', 'test-password-1234')
    await app.press('Create and enter')
  } else {
    await app.press('text:Unlock')
  }
  await app.waitFor('text:Passwords')

  // 先建一条带标签的条目，让库里存在「已有标签」。
  await app.press('id:add-entry')
  await app.waitFor('text:New entry')
  await app.type('label:Title', 'Tagged')
  await app.type('label:Tags', 'work, finance')
  await app.press('text:Save')
  await app.waitFor('text:Tagged')

  // 再开新增弹窗：标签区列出已有标签胶囊，点击即写入输入框。
  await app.press('id:add-entry')
  await app.waitFor('text:New entry')
  await app.waitFor('label:work')
  expect(app.shows('label:finance')).toBe(true)
  expect(app.texts()).toContain('Existing tags: tap to add, tap again to remove')
  await app.press('label:work')
  expect(app.value('label:Tags')).toBe('work')
  await app.press('label:finance')
  expect(app.value('label:Tags')).toBe('work, finance')
  // 再点一次移除；全部移除后表单不脏，取消可直接关闭。
  await app.press('label:work')
  expect(app.value('label:Tags')).toBe('finance')
  await app.press('label:finance')
  expect(app.value('label:Tags')).toBe('')
  await app.press('text:Cancel')
  expect(app.shows('text:New entry')).toBe(false)

  await app.press('label:Lock')
  await app.waitFor('label:Master password')
})

// 手机设置页：单页滚动，无快速导航（子导航/hub 都不存在），四个分区同屏可达；
// 更新卡融合版本与客户端身份，检查按钮在频率下方。
test('phone settings is a single scroll page without quick nav', async () => {
  const app = await open('./App.tsx')
  await app.waitFor('label:Master password')
  await app.type('label:Master password', 'test-password-1234')
  // 同一次运行里前一个用例可能已建库（进程级会话 + 共享 MEND_DATA_DIR）：
  // 单独跑本用例时是首启建库，整文件跑时是解锁既有库。
  if (app.shows('label:Confirm master password')) {
    await app.type('label:Confirm master password', 'test-password-1234')
    await app.press('Create and enter')
  } else {
    await app.press('text:Unlock')
  }
  await app.waitFor('text:Passwords')

  await app.press('id:nav-settings')
  await app.waitFor('text:Appearance & behavior')
  expect(app.shows('id:settings-nav-update')).toBe(false)
  expect(app.shows('id:settings-hub-update')).toBe(false)
  expect(app.texts()).toContain('Database file')
  expect(app.texts()).toContain('Update')
  expect(app.shows('id:settings-check-update')).toBe(true)
  expect(app.texts()).toContain('Desktop app')
})
