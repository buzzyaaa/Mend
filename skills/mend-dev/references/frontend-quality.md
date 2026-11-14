# Mend 前端（TSX 原生视图）质量口径

Mend 是 product register（用户在执行任务，界面服务于任务）。本文件是 Mend 自己的视觉与交互基线，配合 `impeccable` 的共享设计法则使用；两者冲突时以本文件的硬性约束为准。

## 技术基线

- **TSX 原生视图**：用 nsh 的 `View` / `Text` / `Scroll` / `List` / `Input` / `Dialog` / `Sheet` / `TextView` / `Image` 等组件；项目里没有 HTML、CSS 文件、WebView 或前端打包器，不要引入浏览器 DOM API（`document`、`window.confirm`、`localStorage` 等）。
- **样式**：`class` 里写 Tailwind 语义类（`flex-row`、`items-center`、`gap-2`、`rounded-md`、`bg-card`、`text-muted-foreground`、`border-border`、`hover:bg-accent`、`disabled:opacity-45`…），与 `components/ui.tsx` 的现有写法保持一致。不要写 `<style>`、外链 CSS 或内联 `color` 字面量（传给 `Icon` 的 `token(...)` 除外）。
- **颜色与圆角**：唯一来源是 `theme.json` 的 `cssVars.light` / `cssVars.dark`；需要拿颜色值给原生 prop 时用 `token('primary')`、`token('muted-foreground')`。不新造色板、不写死 `#hex`，深浅两套都要成立。
- **图标**：`assets/icons/*.svg` 经 `components/Icon.tsx` 的 `<Image tintColor>` 绘制，新增图标要同时补 `IconName` 映射与 SVG 资源；不引入第二套图标库，不把 emoji 当 UI 图标（分类图标是用户数据，例外）。

## 文案与 i18n

- 所有界面文案进 `locales/en.json` 与 `locales/zh-CN.json`，键名成组（`nav.*` / `entry.*` / `trash.*` / `settings.*` / `backup.*` / `toast.*`…）。
- TSX 里用 `t('group.key')`（来自 `nsh/i18n`）；带参数用 `t('trash.purgedMany', { count })`。
- 中文用陈述句、动词开头；不写“请点击此处”这类社交辞令。
- 错误提示给“发生了什么 + 下一步”，经 `lib/errors.ts` 按 `code|message` 映射，不暴露内部路径或密钥信息。
- 标点：中文用全角，英文用半角；不用长破折号。

## 组件状态清单

每个交互组件都要考虑：default / hover / focus / active / disabled，以及数据层的 empty / loading / error。

- 按钮：复用 `ActionButton`（`primary` / `secondary` / `ghost` / `danger`）与 `IconButton`；状态用 class 表达（`hover:opacity-90`、`active:opacity-75`、`disabled:opacity-45`），不手写第二套按钮。
- 输入：复用 `TextField`；错误态给边框 + 辅助文案，不只靠颜色区分。
- 列表：空态用 `EmptyState` 给“为什么空 + 怎么开始”（例如“暂无条目，点击新增条目创建第一条”），而不是“暂无数据”。
- 异步操作：提交中禁用按钮并保持宽度，失败回滚 UI 并 toast；`authBusy` / `loadingEntries` / `detailBusy` 这类 signal 已存在，优先复用。
- 可测试性：交互元素给 `accessibilityLabel`（测试选择器 `label:`）或 `testID`（`id:`），关键路径补 `App.test.tsx` 式 headless 测试。

## 布局与密度

- 桌面：master-detail（侧栏 + 列表 + 详情）；手机：单栏（详情页 + 分类 Sheet）。`platform.idiom` 为 `phone`/`pad` 或窗口宽度 < 900 时切单栏；底部安全区用 `env(safe-area-inset-*)`。窗口最小尺寸见 `nsh.json`。
- 间距沿用现有节奏（4/8/12/16/20），不要每处都 16px；分组靠近、区块拉开。
- 卡片不是默认答案：条目本身就是一条信息，不要卡片套卡片。
- 列表/详情行高稳定，长文本截断（`truncate` / `line-clamp-*` 或对应类），不撑破布局；窗口变窄时优先保操作入口，再收次要信息。

## 绝对禁令

- 硬编码颜色、只做浅色/深色其中一套、引入 CSS 文件或 WebView。
- 侧边彩色条（`border-left/right > 1px` 当强调）、渐变文字（`background-clip: text`）、装饰性毛玻璃。
- 大数字 hero 指标、同尺寸卡片阵列、动辄开弹窗（能内联/渐进替代先用内联）。
- 用 emoji 当图标或装饰（用户数据里的分类 emoji 除外）。
- 绕过 `lib/native.ts` 直接调 `Vault` 或接触数据库/密钥。

## 安全相关展示

- 密码默认隐藏（`masked`），显示需显式点击；复制按钮与显示按钮分开。
- 回收站内不提供复制与编辑入口；归档条目按只读口径展示。
- 备份、恢复、清空回收站等不可逆动作必须二次确认，并在文案里写清后果。
- 锁定/自动锁定后不残留解密内容；界面不展示 KEK/DEK 或原始错误堆栈。
