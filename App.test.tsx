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
  // 桌面窗口尺寸；列表现在由 DataTable 自适应横向滚动，仍按桌面宽度回归。
  await app.setViewport(1100, 780)
  await app.waitFor('label:Master password')
  await app.type('label:Master password', 'test-password-1234')
  await app.type('label:Confirm master password', 'test-password-1234')
  await app.press('Create and enter')
  await app.waitFor('text:Passwords')

  // 列表由 nsh DataTable 承载：列宽不可拖（固定列 + 其余平分）。
  // 把手的真实 testID 是 `resize:<key>`（冒号），写成连字符会永远查不到、假通过。
  expect(app.shows('id:resize:check')).toBe(false)
  expect(app.shows('id:resize:notes')).toBe(false)
  expect(app.shows('id:table-header-name')).toBe(true)
  expect(app.texts()).toContain('Username / Password')

  await app.press('id:add-entry')
  await app.waitFor('text:New entry')
  await app.type('label:Title', 'GitHub')
  await app.type('label:Username', 'octocat')
  await app.type('label:Password', 's3cret')
  await app.press('text:Save')
  await app.waitFor('text:octocat')
  // 操作按钮全部摊在行内：原来「更多」菜单的触发器（Actions）不再存在。
  expect(app.shows('label:Actions')).toBe(false)
  expect(app.shows('label:Copy full entry')).toBe(true)
  // 行内「账号：octocat」的前缀只用于显示：复制必须只写原值，不带标签。
  await app.press('label:Copy username')
  await app.wait(100)
  expect(app.clipboard()).toBe('octocat')

  // 工具栏第二个图标切到卡片视图：同一条数据仍可读，DataTable 表头卸载；切回后表头恢复。
  await app.press('id:view-card')
  await app.waitFor('text:octocat')
  expect(app.shows('id:table-header-name')).toBe(false)
  expect(app.shows('id:category-edge')).toBe(false)
  await app.press('id:view-list')
  await app.waitFor('id:table-header-name')

  // 列宽拖动已整体取消：任何列都不再有把手，工具栏也没有「重置列宽」入口。
  expect(app.shows('label:Reset')).toBe(false)
  expect(app.shows('id:reset-table-layout')).toBe(false)
  for (const key of ['name', 'category', 'credentials', 'contact', 'notes', 'actions']) {
    expect(app.shows(`id:resize:${key}`)).toBe(false)
  }
  // 「全部」视图里分类列右缘有一条自绘浅灰竖线，与固定列左缘线同款。
  expect(app.shows('id:category-edge')).toBe(true)
  // 列配置菜单只保留「显示哪些列」，不再夹带重置列宽的菜单项。
  await app.press('id:column-config')
  await app.waitFor('id:column-toggle-notes')
  expect(app.shows('label:Reset column widths')).toBe(false)
  await app.press('id:column-toggle-notes')
  await app.wait(100)
  expect(app.shows('id:table-header-notes')).toBe(false)
  await app.press('id:column-toggle-notes')
  await app.waitFor('id:table-header-notes')
  await app.press('id:column-config')
  await app.wait(100)

  // 固定列（分类 120 / 操作 160）之外的列平分剩余宽度，窗口缩放后整表重新平分。
  await app.setViewport(1500, 780)
  await app.waitFor('id:table-header-name')
  expect(app.texts()).toContain('Username / Password')
  await app.setViewport(900, 780)
  await app.waitFor('id:table-header-name')
  expect(app.shows('id:table-header-actions')).toBe(true)
  expect(app.texts()).toContain('octocat')
  await app.setViewport(1100, 780)
  await app.waitFor('id:table-header-name')

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

// 标签改为库内独立维护（与预设值同级）：名称 + 颜色在右上角「标签」弹窗里
// 新建/编辑/删除；条目编辑里只能从列表点选，标签列表为空时是灰色不可选提示，
// 不再有逗号分隔的自由输入。
test('tags are maintained in a dialog and only selectable on entries', async () => {
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

  // 还没有任何标签：编辑条目时标签区是灰色提示，没有可点的胶囊、也没有输入框。
  await app.press('id:add-entry')
  await app.waitFor('text:New entry')
  expect(app.texts()).toContain(
    'No tags available yet: create one in the “Tags” dialog at the top right first',
  )
  expect(app.shows('label:work')).toBe(false)
  await app.press('text:Cancel')

  // 右上角「标签」入口：新建两个标签（名称 + ColorPicker 默认色），列表里立刻出现。
  await app.press('label:Tags >> nth=0')
  await app.waitFor('label:Tag name')
  await app.waitFor('label:Hex value')
  await app.type('label:Tag name', 'work')
  await app.press('label:Add tag')
  await app.waitFor('label:work')
  await app.type('label:Tag name', 'finance')
  await app.press('label:Add tag')
  await app.waitFor('label:finance')
  await app.press('id:tags-close')

  // 再次新建条目：标签改成和「标签筛选」一致的下拉多选，点开菜单连续勾选。
  await app.press('id:add-entry')
  await app.waitFor('text:New entry')
  await app.waitFor('id:entry-tags-trigger')
  await app.press('id:entry-tags-trigger')
  await app.waitFor('label:work')
  await app.press('label:work')
  await app.press('label:finance')
  await app.press('id:entry-tags-trigger')
  await app.type('label:Title', 'Tagged')
  await app.press('text:Save')
  await app.waitFor('text:Tagged')
  expect(app.texts()).toContain('work')
  expect(app.texts()).toContain('finance')

  // 标签维护弹窗里改颜色：点编辑图标展开行内编辑器，ColorPicker 的色值输入框必须能渲染。
  await app.press('label:Tags >> nth=0')
  await app.waitFor('label:Tag name')
  await app.press('label:Edit tag >> nth=0')
  await app.waitFor('label:Hex value')
  await app.press('label:Cancel')
  await app.press('id:tags-close')

  // 分类编辑复用同一个 ColorPicker：新增分类弹窗里也能看到 Hex value 输入框。
  await app.press('label:New group')
  await app.waitFor('label:Hex value')
  await app.press('text:Cancel')

  await app.press('label:Lock')
  await app.waitFor('label:Master password')
})

// 侧栏「我的分组」支持鼠标拖动排序：拖完写 sort_order，锁定/解锁后仍是新顺序。
test('sidebar categories can be reordered by dragging', async () => {
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

  async function addCategory(name: string) {
    await app.press('label:New group')
    await app.waitFor('label:Category name')
    await app.type('label:Category name', name)
    await app.press('text:Save')
    await app.waitFor(`label:${name}`)
  }
  await addCategory('Alpha')
  expect(app.shows('id:category-count-slot-Alpha')).toBe(true)
  expect(app.shows('id:category-count-Alpha')).toBe(true)
  expect(app.shows('id:category-menu-Alpha')).toBe(false)

  // 指针放到最右数字上：数量原位换成 ···，但菜单不自动弹出。
  await app.hover('id:category-count-slot-Alpha')
  expect(app.shows('id:category-count-Alpha')).toBe(false)
  expect(app.shows('id:category-menu-Alpha')).toBe(true)
  expect(app.shows('id:category-edit-Alpha')).toBe(false)

  // 点击 ··· 才弹出 nsh Menu；删除项用危险色。
  await app.press('id:category-menu-Alpha')
  await app.waitFor('id:category-edit-Alpha')
  expect(app.texts()).toContain('Delete')
  expect(app.spanStyle('text:Delete').color).not.toBe(app.spanStyle('text:Edit').color)

  // 鼠标移开只还原 ··· 的悬停态，不会收起已打开的菜单；再次点击才关闭。
  await app.hover('label:Alpha')
  await app.wait(150)
  expect(app.shows('id:category-edit-Alpha')).toBe(true)
  await app.press('id:category-menu-Alpha')
  await app.wait(150)
  expect(app.shows('id:category-edit-Alpha')).toBe(false)
  expect(app.shows('id:category-count-Alpha')).toBe(true)

  await app.hover('id:category-count-slot-Alpha')
  await app.press('id:category-menu-Alpha')
  await app.waitFor('id:category-edit-Alpha')
  await app.press('id:category-edit-Alpha')
  await app.waitFor('label:Category name')
  await app.press('text:Cancel')

  await addCategory('Beta')
  expect(app.texts().indexOf('Alpha')).toBeLessThan(app.texts().indexOf('Beta'))

  // 进入分类视图后分类列整列消失，右缘浅灰线也不该再画；回到「全部」恢复。
  await app.press('label:Alpha')
  await app.waitFor('id:table-header-name')
  expect(app.shows('id:table-header-category')).toBe(false)
  expect(app.shows('id:category-edge')).toBe(false)
  await app.press('label:All')
  await app.waitFor('id:table-header-category')
  expect(app.shows('id:category-edge')).toBe(true)

  await app.drag('label:Alpha', { x: 0, y: 45 })
  await app.wait(400)
  expect(app.texts().indexOf('Beta')).toBeLessThan(app.texts().indexOf('Alpha'))

  // 重新解锁后顺序仍来自库的 sort_order，不是只在界面上挪了一下。
  await app.press('label:Lock')
  await app.waitFor('label:Master password')
  await app.type('label:Master password', 'test-password-1234')
  await app.press('text:Unlock')
  await app.waitFor('text:Passwords')
  expect(app.texts().indexOf('Beta')).toBeLessThan(app.texts().indexOf('Alpha'))
  // 和其他用例一样退出到解锁页，避免进程级会话把下一个用例直接送进主界面。
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
  // 和其他用例一样退出到解锁页，避免进程级会话把下一个用例直接送进主界面。
  await app.press('id:nav-lock')
  await app.waitFor('label:Master password')
})

// 列宽均分后单元格必然截断：省略号裁掉的内容靠悬停气泡读全，复制永远写完整原值；
// 掩码状态的密码不进气泡（悬停也不泄露）。
test('truncated cells reveal full text on hover and copy full values', async () => {
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

  const username = 'very.long.account.name.for.truncation@example.com'
  const notes =
    'Recovery codes live offline; rotate the authenticator after switching devices and keep the old session for thirty days.'
  await app.press('id:add-entry')
  await app.waitFor('text:New entry')
  await app.type('label:Title', 'Truncation')
  await app.type('label:Username', username)
  await app.type('label:Password', 'p@ss-long-value-123')
  await app.type('label:Notes', notes)
  await app.press('text:Save')
  await app.waitFor('text:Truncation')
  // 只留这一行，避免同库旧条目的同名按钮干扰选择器。
  await app.type('label:Search username, password, email, phone, notes...', 'Truncation')
  await app.wait(150)

  expect(app.shows('id:full-text-tip')).toBe(false)
  await app.hover(`text:${username}`)
  await app.wait(500)
  expect(app.shows('id:full-text-tip')).toBe(true)
  await app.hover('id:add-entry')
  await app.wait(500)
  expect(app.shows('id:full-text-tip')).toBe(false)

  await app.hover(`text:${notes}`)
  await app.wait(500)
  expect(app.shows('id:full-text-tip')).toBe(true)
  await app.hover('id:add-entry')
  await app.wait(500)
  expect(app.shows('id:full-text-tip')).toBe(false)

  // 行内图标按钮的悬停态要能到达（共享 IconButton 的外层 View 承接 mouseenter）：
  // 悬停后 tooltip 文案出现，移开后消失。
  expect(app.texts()).not.toContain('Copy username')
  await app.hover('label:Copy username')
  await app.wait(500)
  expect(app.texts()).toContain('Copy username')
  await app.hover('id:add-entry')
  await app.wait(500)
  expect(app.texts()).not.toContain('Copy username')

  // 掩码密码：先关掉全局「显示密码」，气泡里不得出现明文，也不该为掩码圆点弹「完整内容」。
  await app.press('label:Show passwords')
  await app.wait(150)
  expect(app.texts()).not.toContain('p@ss-long-value-123')
  if (app.shows('text:••••••••')) {
    await app.hover('text:••••••••')
    await app.wait(500)
    expect(app.shows('id:full-text-tip')).toBe(false)
  }

  await app.press('label:Copy username')
  await app.wait(100)
  expect(app.clipboard()).toBe(username)

  await app.press('label:Lock')
  await app.waitFor('label:Master password')
})
