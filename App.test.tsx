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

  // 粘贴导入入口在宽屏工具栏：它曾被误加进只在窄屏渲染的 AppHeader，桌面端完全看不到。
  expect(app.shows('label:Paste import')).toBe(true)

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
  // 详情弹窗已整体删除：卡片态与列表态都没有它的关闭按钮/弹层标签。
  expect(app.shows('id:detail-close')).toBe(false)
  expect(app.shows('label:View details')).toBe(false)
  await app.press('id:view-list')
  await app.waitFor('id:table-header-name')
  expect(app.shows('id:detail-close')).toBe(false)
  expect(app.shows('label:View details')).toBe(false)

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

// 多选底部工具栏：批量删除必须先二次确认，取消不动数据，确认后条目消失且退出多选态。
test('batch delete selected entries requires confirmation', async () => {
  const app = await open('./App.tsx', { platform: 'windows' })
  await app.setViewport(1100, 780)
  await app.waitFor('label:Master password')
  if (app.shows('label:Confirm master password')) {
    await app.type('label:Master password', 'test-password-1234')
    await app.type('label:Confirm master password', 'test-password-1234')
    await app.press('Create and enter')
  } else {
    await app.type('label:Master password', 'test-password-1234')
    await app.press('text:Unlock')
  }
  await app.waitFor('text:Passwords')

  // 单独建一条用于删除，避免影响后续用例依赖的 GitHub 条目。
  await app.press('id:add-entry')
  await app.waitFor('text:New entry')
  await app.type('label:Title', 'Batch Delete Target')
  await app.press('text:Save')
  await app.waitFor('text:Batch Delete Target')

  // 未勾选时没有批量操作；勾选后按钮文案由 i18n 提供。
  expect(app.shows('id:delete-selected')).toBe(false)
  await app.press('label:Batch Delete Target')
  await app.waitFor('id:delete-selected')
  expect(app.texts()).toContain('1 selected')
  expect(app.texts()).toContain('Clear selection')
  // 批量删除是危险动作：文字用 destructive 红，与「取消选择」的常规前景色区分。
  expect(app.spanStyle('id:delete-selected >> text:Delete selected').color).not.toBe(
    app.spanStyle('id:clear-selection >> text:Clear selection').color,
  )

  // 取消路径：条目仍在，多选态保持。
  await app.press('id:delete-selected')
  await app.wait(100)
  expect(app.texts().join(' ')).toContain('Delete the selected 1 entries')
  await app.press('id:confirm-cancel')
  await app.wait(100)
  expect(app.texts()).toContain('Batch Delete Target')
  expect(app.shows('id:delete-selected')).toBe(true)

  // 确认路径：条目移除、选择清空，工具栏回到普通状态。
  await app.press('id:delete-selected')
  await app.waitFor('id:confirm-ok')
  await app.press('id:confirm-ok')
  await app.wait(200)
  expect(app.texts()).not.toContain('Batch Delete Target')
  expect(app.shows('id:delete-selected')).toBe(false)
  expect(app.shows('label:Clear selection')).toBe(false)
  expect(app.texts()).toContain('Deleted 1 entries')

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

  // 再次新建条目：标签用官方 Combobox 多选，弹层能在编辑 Dialog 里浮出并连续勾选。
  await app.press('id:add-entry')
  await app.waitFor('text:New entry')
  await app.waitFor('id:entry-tags-combobox')
  // 输入即打开并筛选，连续选两项；这条路径与真实鼠标操作一致。
  await app.type('id:entry-tags-input', 'w')
  await app.waitFor('text:work')
  await app.press('text:work')
  await app.clear('id:entry-tags-input')
  await app.type('id:entry-tags-input', 'f')
  await app.waitFor('text:finance')
  await app.press('text:finance')
  await app.clear('id:entry-tags-input')
  // 选中的两个标签以胶囊形式留在组合框这一行，而不是另起一段。
  expect(app.shows('id:entry-tags-combobox >> label:work')).toBe(true)
  expect(app.shows('id:entry-tags-combobox >> label:finance')).toBe(true)
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

// 列表里的标签胶囊不再继承「打开网址」：点一次直接激活左上角标签筛选，
// 再点一次取消；这一步同时证明筛选读的是胶囊上的标签而不是整行。
test('clicking a tag pill in the list toggles the tag filter', async () => {
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

  try {
    // 用例共用一个库：标签名与条目名用独立前缀，避免撞上前面用例的数据。
    await app.press('label:Tags >> nth=0')
    await app.waitFor('label:Tag name')
    await app.type('label:Tag name', 'quickfilter')
    await app.press('label:Add tag')
    await app.press('id:tags-close')

    await app.press('id:add-entry')
    await app.waitFor('text:New entry')
    await app.type('label:Title', 'Filter Target')
    await app.type('label:URL', 'https://example.com')
    await app.type('id:entry-tags-input', 'quickfilter')
    await app.waitFor('text:quickfilter')
    // 同名候选有两处可点：取第二个（组合框弹层里的候选项）。
    await app.press('text:quickfilter >> nth=1')
    expect(app.shows('id:entry-tags-combobox >> label:quickfilter')).toBe(true)
    await app.press('text:Save')
    await app.waitFor('text:Filter Target')

    await app.press('id:add-entry')
    await app.waitFor('text:New entry')
    await app.type('label:Title', 'Plain Entry')
    await app.press('text:Save')
    await app.waitFor('text:Plain Entry')

    // 点列表里的胶囊：左上角筛选入口带计数，未命中的条目被筛掉。
    await app.press('label:Filter by tags: quickfilter')
    await app.waitFor('label:Filter by tags (1)')
    expect(app.shows('text:Filter Target')).toBe(true)
    expect(app.shows('text:Plain Entry')).toBe(false)

    // 再点一次同一胶囊取消筛选，列表恢复。
    await app.press('label:Filter by tags: quickfilter')
    await app.waitFor('text:Plain Entry')
    expect(app.shows('label:Filter by tags (1)')).toBe(false)
  } finally {
    // 失败也要锁定：后续用例共用数据目录，留着解锁态会让它们卡在首屏。
    await app.press('label:Lock').catch(() => {})
    await app.waitFor('label:Master password').catch(() => {})
  }
})

// 表格在单元格上盖了事件转发层，右键菜单必须挂在 DataTable 自己的 onContextMenu 上。
// 菜单勾选状态来自条目当场持有的标签，点选后立即写回并刷新行内胶囊。
test('right-clicking a title cell toggles tags in the system menu', async () => {
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

  try {
    await app.press('label:Tags >> nth=0')
    await app.waitFor('label:Tag name')
    await app.type('label:Tag name', 'ctxmenutag')
    await app.press('label:Add tag')
    await app.press('id:tags-close')

    await app.press('id:add-entry')
    await app.waitFor('text:New entry')
    await app.type('label:Title', 'Menu Target')
    await app.type('id:entry-tags-input', 'ctxmenutag')
    await app.waitFor('text:ctxmenutag')
    await app.press('text:ctxmenutag >> nth=1')
    await app.press('text:Save')
    await app.waitFor('text:Menu Target')
    expect(app.shows('label:Filter by tags: ctxmenutag')).toBe(true)

    await app.rightClick('text:Menu Target')
    const open = app.menu()
    expect(open?.find((item) => item.label === 'ctxmenutag')?.checked).toBe(true)
    await app.chooseMenuItem('ctxmenutag')
    expect(app.shows('label:Filter by tags: ctxmenutag')).toBe(false)

    await app.rightClick('text:Menu Target')
    const reopened = app.menu()
    expect(reopened?.find((item) => item.label === 'ctxmenutag')?.checked).toBe(false)
    await app.chooseMenuItem('ctxmenutag')
    expect(app.shows('label:Filter by tags: ctxmenutag')).toBe(true)
  } finally {
    await app.closeMenu().catch(() => {})
    await app.press('label:Lock').catch(() => {})
    await app.waitFor('label:Master password').catch(() => {})
  }
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

  // 操作列那排动作（编辑/复制整条/星标/删除）同样走共享 IconButton，悬停反馈要能到达。
  await app.hover('label:Copy full entry')
  await app.wait(500)
  expect(app.texts()).toContain('Copy full entry')
  await app.hover('id:add-entry')
  await app.wait(500)
  expect(app.texts()).not.toContain('Copy full entry')

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

// 导航栏底部一组含锁定/离线/切换库/设置；离线开关必须二次确认，
// 主题改成卡片选择（三张卡都可点），两者都通过 testID 稳定定位。
test('bottom rail has offline shortcut with confirmation, and theme uses cards', async () => {
  let openedUrl: string | null = null
  const app = await open('./App.tsx', {
    platform: 'windows',
    modules: {
      nsh: {
        openUrl: (url: string) => {
          openedUrl = url
          return { opened: true }
        },
      },
    },
  })
  await app.setViewport(1100, 780)
  await app.waitFor('label:Master password')
  if (app.shows('label:Confirm master password')) {
    await app.type('label:Master password', 'test-password-1234')
    await app.type('label:Confirm master password', 'test-password-1234')
    await app.press('Create and enter')
  } else {
    await app.type('label:Master password', 'test-password-1234')
    await app.press('text:Unlock')
  }
  await app.waitFor('text:Passwords')

  expect(app.shows('id:nav-lock')).toBe(true)
  expect(app.shows('id:nav-offline')).toBe(true)
  // 开启离线模式必须先弹二次确认，且说明里点明图标与更新两类请求。
  await app.press('id:nav-offline')
  await app.waitFor('text:Turn on anyway')
  expect(app.texts().join(' ')).toContain('site icons')
  await app.press('text:Turn on anyway')
  await app.wait(150)

  await app.press('id:nav-settings')
  await app.waitFor('text:Appearance & behavior')
  for (const theme of ['light', 'dark', 'system']) {
    expect(app.shows(`id:settings-theme-${theme}`)).toBe(true)
  }
  await app.press('id:settings-theme-dark')
  await app.wait(150)
  // 安全分区的离线开关与导航栏快捷按钮是同一个偏好，文案必须一致出现。
  expect(app.texts()).toContain('Offline mode')
  await app.press('id:nav-offline')
  await app.wait(150)

  // 「关于」卡在更新分区末尾：两个整卡入口显示完整网址，点卡片本体就交给浏览器。
  expect(app.shows('id:about-link-github')).toBe(true)
  expect(app.shows('id:about-link-cnb')).toBe(true)
  const allText = app.texts()
  expect(allText).toContain('https://github.com/buzzyaaa/Mend')
  expect(allText).toContain('https://cnb.cool/smybxg/Mend')
  expect(allText.filter((text) => text === 'Open now').length).toBeGreaterThanOrEqual(2)
  // 「关于」卡底部展示开源免责声明（走 i18n，英文界面下为英文）。
  expect(allText).toContain('Disclaimer')
  expect(allText.some((text) => text.startsWith('No software can guarantee'))).toBe(true)
  await app.press('id:about-link-cnb')
  await app.wait(100)
  expect(openedUrl).toBe('https://cnb.cool/smybxg/Mend')

  await app.press('id:nav-lock')
  await app.waitFor('label:Master password')
})

// 左下「切换数据库」按钮：菜单列出偏好里的最近库（只显示文件名），并附
// 打开其他/新建/使用默认三个入口；点当前库不动、假路径不在这里实际切换
// （切换链路由 applyVaultFile 的既有测试覆盖）。
test('switch database menu lists recent vaults and quick actions', async () => {
  const app = await open(
    './App.tsx',
    preferencesModule(
      JSON.stringify({
        recentVaults: ['C:/Vaults/Work.menddb', 'D:/Backup/Old-vault.menddb'],
      }),
    ),
  )
  await app.waitFor('label:Master password')
  if (app.shows('label:Confirm master password')) {
    await app.type('label:Master password', 'test-password-1234')
    await app.type('label:Confirm master password', 'test-password-1234')
    await app.press('Create and enter')
  } else {
    await app.type('label:Master password', 'test-password-1234')
    await app.press('text:Unlock')
  }
  await app.waitFor('text:Passwords')

  expect(app.shows('id:nav-switch')).toBe(true)
  await app.press('id:nav-switch')
  await app.waitFor('id:nav-switch-recent-0')
  expect(app.texts()).toContain('Work.menddb')
  expect(app.texts()).toContain('Old-vault.menddb')
  expect(app.shows('id:nav-switch-other')).toBe(true)
  expect(app.shows('id:nav-switch-new')).toBe(true)
  expect(app.shows('id:nav-switch-default')).toBe(true)
  // 点当前库（列表首项）不切库，菜单收起后仍在主界面。
  await app.press('id:nav-switch-recent-0')
  await app.wait(150)
  expect(app.texts()).toContain('Passwords')
})

// 关闭行为开关：设置里手动切换「关闭时缩到托盘」时，必须同时把 trayChoiceMade
// 置 true（之后关闭不再询问），并把 closeMinimizeToTray 写进偏好。手机端无系统托盘，
// 但偏好字段仍可切换（桌面托盘逻辑在 isAvailable=false 下不安装）。
test('closing-to-tray switch persists choice and suppresses future prompts', async () => {
  let saved = ''
  const app = await open('./App.tsx', {
    modules: {
      'mend/native': {
        'Vault.loadPreferences': () => '',
        'Vault.savePreferences': (json: string) => {
          saved = json
        },
        'Vault.autoStartEnabled': () => false,
      },
    },
  })
  // 全量运行与前面的用例共享进程级会话：可能已解锁直接进主界面；单跑时
  // 是首次建库页。等任一种就绪再继续，避免 waitFor 单一页面超时。
  await app.waitUntil(() => app.shows('text:Passwords') || app.shows('label:Master password'))
  if (!app.shows('text:Passwords')) {
    await app.type('label:Master password', 'test-password-1234')
    if (app.shows('label:Confirm master password')) {
      await app.type('label:Confirm master password', 'test-password-1234')
      await app.press('Create and enter')
    } else {
      await app.press('text:Unlock')
    }
    await app.waitFor('text:Passwords')
  }

  await app.press('id:nav-settings')
  await app.waitFor('text:Appearance & behavior')
  expect(app.shows('id:settings-close-minimize-to-tray')).toBe(true)
  await app.press('id:settings-close-minimize-to-tray')
  await app.wait(120)
  const prefs = JSON.parse(saved)
  expect(prefs.closeMinimizeToTray).toBe(true)
  expect(prefs.trayChoiceMade).toBe(true)
})

// 界面缩放：预置的 layoutScale 必须能在启动时被读取并应用，且不影响应用正常启动。
// 注意只用 nsh 0.5.1 就支持的 test API（CI 锁 0.5.1）——app.layout() 是 0.7
// 才加的，不能用。缩放的几何正确性由应用内逻辑视口计算保证，这里验证偏好
// 被读取（保存的缩放值不被覆盖回默认值）+ 缩放容器挂载 + 界面可用。
test('applies saved layout scale to the root viewport on boot', async () => {
  let saved = ''
  const app = await open('./App.tsx', {
    modules: {
      'mend/native': {
        'Vault.loadPreferences': () => JSON.stringify({ layoutScale: 1.25 }),
        'Vault.savePreferences': (json: string) => {
          saved = json
        },
        'Vault.autoStartEnabled': () => false,
      },
    },
  })
  await app.setViewport(1100, 780)
  // 缩放容器在解锁页/主界面都在，无需等某个页面；全量跑时进程会话可能已解锁。
  await app.waitFor('id:ui-scale-root')
  await app.waitUntil(() => app.shows('text:Passwords') || app.shows('label:Master password'))
  expect(app.shows('id:ui-scale-root')).toBe(true)
  // 启动过程若回写偏好，缩放值不该丢（1.25 原样保留，而非回落默认 1）。
  if (saved) {
    expect(
      JSON.parse(saved).layoutScale === undefined || JSON.parse(saved).layoutScale === 1.25,
    ).toBe(true)
  }
})

// 设置-外观的界面大小滑块：小/默认/大刻度可见，拖动即时写回偏好并把根容器
// 的逻辑宽度按新缩放重算（不重启、不确认）。
test('appearance display-size slider applies and persists on drag', async () => {
  let saved = ''
  const app = await open('./App.tsx', {
    platform: 'windows',
    modules: {
      'mend/native': {
        'Vault.loadPreferences': () => '',
        'Vault.savePreferences': (json: string) => {
          saved = json
        },
        'Vault.autoStartEnabled': () => false,
      },
    },
  })
  await app.setViewport(1100, 780)
  // 全量跑与前面的用例共享进程级会话，可能已解锁直接进主界面；等任一种就绪。
  await app.waitUntil(() => app.shows('text:Passwords') || app.shows('label:Master password'))
  if (!app.shows('text:Passwords')) {
    if (app.shows('label:Confirm master password')) {
      await app.type('label:Master password', 'test-password-1234')
      await app.type('label:Confirm master password', 'test-password-1234')
      await app.press('Create and enter')
    } else {
      await app.type('label:Master password', 'test-password-1234')
      await app.press('text:Unlock')
    }
    await app.waitFor('text:Passwords')
  }

  await app.press('label:Settings')
  await app.waitFor('text:Appearance & behavior')
  expect(app.shows('id:settings-layout-scale')).toBe(true)
  expect(app.texts()).toContain('Display size')
  expect(app.texts()).toContain('Small')
  expect(app.texts()).toContain('Default')
  expect(app.texts()).toContain('Large')

  // 滑块默认 1；向右拖动拇指应增大缩放并即时写回偏好（不重启、不确认）。
  // Slider 的 testID 挂在不可交互的根 view，可拖的是带无障碍标签的拇指。
  await app.drag('label:Display size', { x: 120 })
  await app.wait(150)
  const scale = JSON.parse(saved).layoutScale as number
  expect(scale).toBeGreaterThan(1)
  // 缩放容器仍在（拖动触发整树重建后没丢失），界面继续可用。
  expect(app.shows('id:ui-scale-root')).toBe(true)
  expect(app.shows('text:Appearance & behavior')).toBe(true)
})
