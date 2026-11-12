# 08 · 分阶段开发计划

阶段按"可验证闭环"切分；每个阶段结束都要能运行、可演示，并在本地 `local/DEVLOG.md` 记录决策与验证结果。

## 阶段 0 — 规划与工程准备（已完成）

**产出**：需求/选型/架构/数据模型/规格/备份/i18n/路线图文档（`docs/`）+ 接手入口 `AGENTS.md`。

**工具链检查清单（进入阶段 1 前逐项确认）**

- [x] Node `v22.23.2`、npm `10.9.8`。
- [x] Rust stable（`rustc`/`cargo`）可用；Windows 使用 GNU 目标 + MinGW-w64 作为 C 编译器与链接器（安装与取舍见 `09-env-setup.md`）。
- [x] git、gh CLI 可用（远程 `origin` 已配置）。
- [x] Tauri 2 运行时依赖：WebView2（随 Edge 运行时提供）。
- [ ] 编辑器插件（VS Code + Volar + rust-analyzer，建议项，不阻塞构建）。

**验收**：文档齐全；`AGENTS.md` 可引导新 Agent 独立接手；工具链命令在干净终端可跑通 `node -v` / `cargo --version` / `git --version` / `gh auth status`。

## 阶段 1 — 工程脚手架与界面骨架（已完成）

**目标**：跑通 Tauri + Vue 3 + TS + Vite + Tailwind + vue-i18n 空壳（当时使用 shadcn-vue，2026-11-11 起已全量迁移到 naive-ui，见 `02`）。

> 进度：前端与 Rust 侧均已完成，`npm run tauri dev` 端到端启动通过；仅 lint/format 配置未补（不阻塞后续阶段）。

- [x] 初始化前端工程（Vue + TS + Vite），配置目录结构（见 `03-architecture.md`）。
- [x] 接入 TailwindCSS、基础主题令牌（浅色/暗色变量预留）；早期 `cn()` 工具与 shadcn-vue 原语已随 naive-ui 迁移移除。
- [x] 接入 vue-i18n：`zh-CN`/`en` 词条骨架、语言切换入口（现为顶部标题栏右侧语言图标按钮，弹窗选择）、偏好持久化。
- [x] 路由与页面骨架：解锁页占位、主界面左右布局占位、设置弹窗占位。
- [x] Pinia store 骨架（vault / entry / preferences）。
- [x] 前端构建脚本：`dev`、`build`（vue-tsc + vite）、`typecheck`。
- [x] `src-tauri` 骨架编译通过：`cargo check`/`cargo build` 成功，`npm run tauri dev` 端到端启动（Vite :1420 + `mend.exe` + WebView，页面 200）。
- [x] lint/format 脚本与配置（ESLint 9 flat config + Prettier，`npm run lint` / `npm run format`，2026-11-11 补齐）。

**验收**：`npm run tauri dev` 启动窗口；左右布局与顶栏可见；中/英切换生效；typecheck 通过；提交 feat 提交并推送到 `origin`。（工具链见 `09-env-setup.md`。）

## 阶段 2 — 数据层、加密与主密码（已完成）

**目标**：库能创建/解锁/锁定，条目与分类加密落库。

> 进度：后端与解锁页已完成，`mend-core` 19 项单元测试通过（含"落盘无明文""错误主密码失败""锁定后 DEK 不可用""主密码不落盘"）；GUI 端到端手工验收结论见 `local/DEVLOG.md`。

- [x] Rust `db/`：SQLite 连接、迁移 v1（表结构见 `04`）、仓储层（代码在 `src-tauri/core/src/db.rs`）。
- [x] Rust `crypto/`：Argon2id 派生、DEK 生成与包裹、XChaCha20-Poly1305 加解密、OsRng、`zeroize`。
- [x] 核心逻辑抽成独立 crate `mend-core`（不依赖 Tauri/WebView），`cargo test` 可独立运行；主 crate 只保留命令层与会话状态。
- [x] 命令：`vault_setup / unlock / lock / status`；分类与条目 CRUD 命令。
- [x] 前端解锁页：首次设置主密码（强度提示、二次确认）、解锁、锁定回退；路由守卫保证未解锁不进入主界面。
- [x] 写路径：前端提交明文 → Rust 加密 → 事务落库；读路径：解锁后解密返回展示模型。

**验收**：首次启动设主密码；重开需解锁；直接打开 SQLite 文件检查不到账号/密码/邮箱/手机/备注明文；错误主密码解锁失败；锁定后会话密钥销毁。

## 阶段 3 — 主界面、分类列表与条目交互

**目标**：完成 MVP 主体交互（对照 `05-mvp-spec.md`）。

- [x] 左侧分类：全部/未分类/自定义，条目数，增删改；删除分类条目归未分类。
- [x] 右侧条目列表：卡片/行展示、搜索过滤、选中、收藏预留。
- [x] 条目弹窗：独立 Dialog 表单，字段含标题/账号/密码/邮箱/手机/网址/备注；回填编辑。
- [x] 字段复制：每字段复制按钮 + Toast。
- [x] 预设值：账号/邮箱/手机号预设维护（设置弹窗）与条目表单下拉选择，值密文存储。
- [x] Markdown 备注：弹窗内编辑/预览 Tabs，安全渲染（自研白名单渲染器，未引第三方库）；列表显示摘要。

**验收**：`05` 第 7 节验收要点 1、2、4、6 可演示；弹窗编辑保存后列表刷新；切换分类/搜索正确过滤。

## 阶段 4 — 强密码生成器

**目标**：本地生成可调强密码并随条目保存。

- [x] Rust `generator`：CSPRNG（`OsRng` + 拒绝采样），长度/字符类/排除易混字符/每类至少出现一个的规则（`src-tauri/core/src/generator.rs`）。
- [x] 前端生成器面板：条目表单密码字段旁"生成"，长度 6–64、字符类勾选、排除易混、重新生成、填入密码字段；结果不落库。
- [x] 与条目表单打通：生成 → 填入 → 保存时加密落库。

**验收**：不同选项生成符合规则的密码；可填入并保存；重复生成结果不同；生成过程无网络请求。

## 阶段 5 — 备份 / 恢复 / WebDAV 预留

**目标**：本地备份闭环；WebDAV 接口与配置预留，不实现联网。

- [x] 应用内加密导出 `.mendbak` / 导入恢复（完整性校验、临时位置校验后替换）：`mend-core/src/backup.rs` + `commands/backup.rs`，覆盖恢复且旧库自动留底。
- [x] 设置弹窗展示数据目录；文档说明手动拷贝库文件到 U 盘及恢复步骤（见 `06`）。
- [x] Rust `sync/` trait 与 `WebdavConfig` 结构落地（`mend-core/src/sync.rs`，`DisabledSync` 占位）；不发起真实请求。（设置弹窗的"未启用"占位后来随导航改版移除，见阶段 6）
- [x] 备份格式版本号与认证标签（魔数 `MENDBK01` + KDF 参数 + XChaCha20-Poly1305 认证密文），为未来版本兼容留口。

**验收**：导出备份 → 删除/清空 → 从备份恢复，条目与分类一致；手动拷贝库到另一目录/机器可恢复；代码中 WebDAV 仅有 trait/配置，无默认联网。

## 阶段 6 — 加固、打磨与打包（MVP 之后）

- [x] 空闲自动锁定（`useAutoLock`，设置弹窗 1/5/10/15/30/60 分钟或关闭，默认 15 分钟）。
- [x] 字段复制：每字段复制按钮 + Toast 反馈（复制后自动清空剪贴板已移除——桌面 WebView 下静默失败且属对用户的剪贴板干预，改为仅写入、不读取/清空；设置弹窗不再有该项）。
- [x] 深浅色主题：跟随系统 / 浅色 / 深色，`<html class="dark">` 切换 CSS 变量，偏好存 localStorage。
- [x] 回收站：删除写 `deleted_at` 进回收站，可恢复 / 彻底删除 / 清空；`entry_restore`、`entry_purge`、`entry_purge_all`。
- [x] 弱密码与重复密码提示：`src/lib/security.ts` 计算（少于 8 位或字符种类单一 = 弱；同一密码被多条共用 = 重复），列表卡片显示"弱/重"标记。
- [x] 排序（最近更新 / 名称 / 收藏优先）与收藏标记。
- [x] 备注全文检索：调用 `entry_list` 拉全量后在内存里按标题/账号/邮箱/手机/网址/备注匹配。
- [x] 标签（多标签，2026-11-11）：迁移 v2 新增 `entries.tags`（JSON 明文列）；表单逗号分隔输入，列表展开区以 chip 展示。
  - ⚠️ 回归（2026-11-12）：列表改 `NDataTable` 时丢失了 chip 的点击过滤（`store.toggleTagFilter` 已无调用方），待修复；见下方"待办补记"。
- [x] 修改主密码（2026-11-11）：`vault_change_password`；core 校验旧密码后用新 salt/KEK 重包裹同一 DEK，事务更新 `meta`，历史密文无需重加密。
- [x] ESLint + Prettier（2026-11-11）：flat config（eslint-plugin-vue + typescript-eslint），脚本 `npm run lint` / `npm run format`。
- [x] 导航与页面结构改造（2026-11-11 引入最左侧 `NavRail`；2026-11-12 改为顶部标题栏）：`NavRail` 已移除。语言切换、预设值、设置全部收进顶部标题栏右侧的图标按钮；主界面（`MainView`）保持左右两列（分类侧栏 + 条目列表）；未实现的 WebDAV 占位从设置弹窗移除。
- [x] 标题栏折叠与 Tooltip 挂载点（2026-11-11）：按钮 Tooltip 挂 `OVERLAY_TARGET`（约定见 `02`）。
- [x] 空状态与错误提示：各列表空状态、操作失败走 Toast；回收站空态单独文案。
- [x] Tauri 打包：`tauri.conf.json` 已配 NSIS（`installMode: currentUser`）+ 图标 + 版本 0.2.0；`npm run tauri build` 在可访问 GitHub release 的环境下产出 `target/release/bundle/nsis/Mend_0.2.0_x64-setup.exe`（约 1.8 MB），网络受限时退化为 release `mend.exe`（便携分发）。
- [x] README 使用说明（首次使用、回收站、备份/恢复、手动迁移、安全习惯）。
- [x] UI 框架统一（2026-11-11，用户要求）：卸载 radix-vue / shadcn-vue 生态与 `cn()` 工具；全部交互控件改 naive-ui；`NConfigProvider` + `darkTheme` + `themeOverrides` 让 Tailwind 与 naive-ui 共用一套 CSS 变量；浮层统一挂载点；`EntryList` / `Sidebar` / `SettingsDialog` / `UnlockView` 四个视图完成重构，深浅主题与中英文案同步生效（见 `02`）。
- [x] 预设页面与条目弹窗下拉的 GUI 逐项点击走查（2026-11-11，真实 Tauri 窗口逐项点击）：四类 Tab 的表格/空态/新增/内联编辑/删除确认与取消/表单类型随 Tab 联动；账号、邮箱、手机号、常用密码四类预设下拉回填的都是**值**而非 ID；生成器长度 16→24 可改、生成、重新生成、填入密码字段；浅色↔深色主题与中英文切换、浮层继承主题；`EntryList` / `Sidebar` / `SettingsDialog` / `UnlockView` 视觉一致性。走查数据已清理，偏好恢复为中文 + 跟随系统。
- [x] 移除 `PresetsDialog` 的 `NDataTable virtual-scroll`：预设数据量小，虚拟滚动反而触发 `ResizeObserver loop completed with undelivered notifications.`，改用普通 `max-height` 滚动。
- [x] 顶栏交互缺陷修复（2026-11-12，用户反馈 4 项）：
  1. **最小化 / 最大化 / 关闭按钮失效**——根因是 `src-tauri/capabilities/default.json` 只授权 `core:default`，而 `core:window:default` 不含动作类接口，IPC 被权限层拒绝且被前端 `.catch()` 静默吞掉；补齐 `core:window:allow-{minimize,unminimize,maximize,unmaximize,toggle-maximize,close,destroy,start-dragging}` 八条授权（约定见 `02` 第 2 节第 9 条）。
  2. **标题栏右键菜单「没有功能」**——菜单本身能弹出，但六个菜单项的动作全部落到窗口能力上，同样因缺 `core:window:allow-*` 授权被拒（前端 `.catch()` 静默吞错），表现为「菜单弹出来了、点哪项都没反应」；补授权后即通。
  3. **主页面 DataTable 内容空白**——`flex-height` 需要确定高度链，原父级未给高度导致表体 `flex-basis:0` 塌成 0 高；改为父级 `flex min-h-0 flex-1 flex-col` + 表格 `min-h-0 flex-1`。
  4. **设置 / 语言选择 / 预设值改为弹窗**——删除 `PresetsView` / `SettingsView` 两个路由页，迁为 `PresetsDialog` / `SettingsDialog` / `LanguageDialog`（开关在 `src/stores/ui.ts`），顶栏改为语言 / 预设值 / 设置 / 锁定四个图标按钮；路由只剩 `/main` 与 `/unlock`。同时修掉展开行从未生效的问题（`renderExpand` 必须挂在 `type: 'expand'` 的列上，不能当表格级 prop 传）。

**验收**：浅/深两套主题下控件颜色一致、浮层继承主题、无原生控件与硬编码文案；预设下拉选中的是值而不是 ID；生成器长度可改。（2026-11-11 GUI 走查逐项通过，结论见 `local/DEVLOG.md`。2026-11-12 的窗口控制与右键菜单真机行为待 `npm run tauri dev` 复验。）

## 待办补记（2026-11-12 盘点）

MVP（阶段 0–6）与 CI/自动更新已完成，下面是盘点出的尚未完成项，按建议批次排序；明细与证据见本地私有 `local/BACKLOG.md`。

**P0 · 安全与架构**（2026-11-12 批次已完成，随 0.3.1 发布）

- [x] 锁定/自动锁定时清空前端缓存的明文（`entry`/`preset` store 增加 `reset()`，`vault.lock()` 成功后调用；列表组件同步清显隐/展开状态与编辑弹窗）。
- [x] 错误码契约：`MendError` 序列化为 `{ code, message }`（`vault`/`db`/`crypto`/`not_found`/`locked`），前端 `src/lib/errorMessage.ts` 按 code 映射 `error.*` 词条；全部"库未解锁"守卫统一 `MendError::Locked`。
- [x] `db::migrate()` 事务化（单事务 + `column_exists` 探测可重入，半迁移库可自愈）。
- [x] `backup_import` 补 `state.is_unlocked()` 守卫（与导出口径一致）。
- [x] 设置 `app.security.csp`（同源脚本/资源 + naive-ui 样式注入 + IPC/更新端点；**待真机冒烟**）。

**功能回归与清理**

- [x] 恢复标签 chip 点击过滤（工具条显示当前过滤标签 + 可清除；回收站不提供）。
- [x] 条目表单的标签输入补字段标题。
- [x] 清理无引用 i18n 词条（24 个删除，2 个随标签功能复活；两份 locale 键集对称校验通过）。

**工程与 CI**

- [x] CI 补 `npm run lint`、`prettier --check`（硬门禁）与 `cargo fmt --check`、`cargo clippy`（软门禁，core 稳定后收紧）。
- [x] 前端单测（vitest）：`markdown.ts` XSS 用例 25 项 + `security.ts` 判定 11 项。
- [x] `vite build` 拆 chunk（vendor-naive-ui 400 kB / vendor-vue 203 kB / vendor-tauri 28 kB，主包警告消除）。
- [x] 补 `.vscode/extensions.json` 与 `launch.json`；补 `CHANGELOG.md`。
- [x] `entry_get` 处置：保留为预留命令，命令与前端封装均已标注。

**交付与文档**

- [x] 版本号三处同步 0.3.1（`scripts/release.ps1` 完成，**tag 与 push 待用户确认**）。
- [x] 文档漂移回写：`01`/`02`/`03`/`04`/`06`/`07`/`09` 已与实现一致。
- [ ] 替换占位图标（`src-tauri/icons/source.png` 为灰底白 M 占位图；需设计稿）。
- [ ] 真机验证：窗口控制与标题栏右键菜单、CSP 冒烟、自动更新端到端（装旧版 → 发新版 → 提示 → 安装 → 重启）、0.3.0 后的新 UI 走查。

## 后续路线（非 MVP，按需排期）

优先级（2026-11-11 用户指定，详见本地 `local/learnings/FEATURE_REQUESTS.md`）：

1. **CI / 自动更新**（已完成，2026-11-12）：见 `10-release-update.md`。CI 拆分为 `ci.yml`（Ubuntu 上 core 测试 + 前端类型检查/构建）与 `release.yml`（打 `v*` tag 时在 `windows-latest` 用 tauri-action 构建 NSIS 并发布 GitHub Release，含 `latest.json` 与签名）；软件侧接入 `tauri-plugin-updater`，设置弹窗可设检查频率（每周/每月/每年），启动按间隔自动检查并弹窗提醒，更新数据源经 `src/lib/update.ts` 的 `UpdateProvider` 抽象层收敛，便于未来替换为自建服务器。
2. 以下均为"很久之后"，无时间预期：
   - CSV / KDBX / Bitwarden JSON 导入导出。
   - TOTP 动态验证码。
   - 真实 WebDAV 同步（手动/定时/变更触发）、冲突合并与同步历史。
   - Windows Hello / 生物识别快速解锁。
   - 浏览器扩展与自动填充。

## 里程碑与推送约定

- 每个阶段一个里程碑标签；阶段完成打 `v0.x.0`。
- 功能分支 `feat/<阶段>-<内容>`，阶段验收通过合并 `main` 并推送 `origin`。
- 每阶段结束更新：`08-roadmap.md` 勾选状态、本地 `local/DEVLOG.md` 追加条目；若架构/契约变化，先改对应专题文档。
