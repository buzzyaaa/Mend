# AGENTS.md — 给后续接手的 Agent / 开发者

> 其他 Agent 接手本项目时，**先读 `skills/mend-dev/SKILL.md`**（开发总入口：约束、落点、命令、验证口径、隐私红线、关联 Skill 用法），再读本文件，之后按 `docs/README.md` 的索引阅读对应文档。
> 决策、架构、数据模型、加密方案、接口约定等设计/规则文档沉淀在 `docs/`（提交到 GitHub）；开发日志在本地私有目录 `local/DEVLOG.md`（已被 `.gitignore` 忽略，**不推送到 GitHub**）。不要凭印象改架构，改动后必须回写对应 `docs/` 文档，并在 `local/DEVLOG.md` 追加日志。

## 1. 项目一句话定位

**Mend**：本地离线、存盘加密的个人密码管理器（Tauri 2 + Vue 3 + TypeScript + naive-ui + TailwindCSS（仅布局）+ SQLite）。
所有数据默认只保存在本机；UI 解锁后可明文查看（自用场景），但数据库落盘的敏感字段必须加密。

## 2. 当前状态（截至最近一次更新）

- 阶段：**阶段 1–6 已完成**（阶段 6：空闲自动锁定、深浅色主题、回收站、弱密码/重复密码标记、排序、备注全文检索、原生文件选择对话框、README 与版本号 0.3.0）。后续增强（2026-11-11）：条目多标签（迁移 v2 `entries.tags`）、修改主密码（`vault_change_password`，重包裹 DEK 不重加密历史密文）、ESLint/Prettier（`npm run lint`/`format`）、导航结构改造（去掉顶部栏，改最左侧 `lucide-vue-next` 图标导航栏 `AppShell` + `NavRail`；预设值独立成 `/presets` 页面）；移除复制后自动清空剪贴板（WebView 静默失败且干预用户剪贴板，复制改为仅写入）。打包配置已就绪（NSIS，`installMode: currentUser`），`npm run tauri build` 产出 `src-tauri/target/release/mend.exe` 与 `bundle/nsis/Mend_0.3.0_x64-setup.exe`；安装包阶段需要访问 GitHub release 下载 NSIS 工具，网络受限时只产出 release exe（便携分发）。前端通过 `npm run build`；Rust 侧 `cargo check`/`cargo build` 通过，`npm run tauri dev` 已端到端启动。核心逻辑（加密、SQLite 仓储、条目/预设加解密编排、金库生命周期、密码生成、备份容器、回收站）在独立 crate `src-tauri/core`（包名 `mend-core`），测试可独立运行。
- 后端结构：主 crate `mend` 只保留 IPC 命令层（`commands/`）与会话状态（`vault/`）；`mend-core` 不依赖 Tauri/WebView。新增业务逻辑优先落在 `mend-core`，命令层只做参数搬运与状态守卫。
- 主密码策略：最短 4 位（`mend-core` 的 `MIN_PASSWORD_LEN`，前端同值校验）。开发期允许弱口令便于本地调试，具体测试口令只在本地 `local/` 记录，不写入仓库。
- 测试：`cargo test --manifest-path src-tauri\core\Cargo.toml`（单元测试 + `tests/flow.rs` 数据链路测试）。**不要在 `src-tauri` 主 crate 上跑 `cargo test`**——测试二进制链接 WebView 依赖，本机会以 `STATUS_ENTRYPOINT_NOT_FOUND` 崩溃（应用本身正常）。
- 仓库现状：前端 `src/`、`src-tauri/`（含 `core/`）、`scripts/dev-env.ps1`、`docs/`、`skills/`（开发 Skill 统一存放：`mend-dev` 为总入口，`self-improving` / `impeccable` / `awesome-design-md` 为配套，来源与许可见 `skills/NOTICE.md`）；`node_modules/`、`dist/`、`target/`、`local/` 已忽略。
- 工具链：Node 22.23.2 / npm 10.9.8；Rust 1.99.1（GNU 目标）；MinGW-w64 gcc 16.2.0；git 2.55；gh CLI。安装位置、初始化与取舍见 `docs/09-env-setup.md`。
- **每个新 PowerShell 会话先执行 `.\scripts\dev-env.ps1`**，把 cargo/MinGW/git/gh 加入会话 PATH（默认不在系统 PATH）。
- UI 框架已统一为 **naive-ui**（2026-11-11）：radix-vue / shadcn-vue 生态与 `cn()` 工具全部移除；`App.vue` 用 `NConfigProvider` + `darkTheme` + `themeOverrides` 让 Tailwind 与 naive-ui 共用一套 CSS 变量，浮层统一挂 `OVERLAY_TARGET`；`AppShell` / `NavRail` / `EntryDialog` / `PresetsView` 与 `EntryList` / `Sidebar` / `SettingsView` / `UnlockView` 全部使用 naive-ui 控件。规则细节见 `docs/02-tech-decision-ui.md` 与 `skills/mend-dev/references/frontend-quality.md`。
- 占位图标仍在使用；阶段 1 的其他遗留（ESLint/Prettier、rusqlite）已补齐。
- 自动发布与自动更新（2026-11-12，见 `docs/10-release-update.md`）：CI 拆分为 `ci.yml`（Ubuntu 上 core 测试 + 前端类型检查/构建）与 `release.yml`（打 `v*` tag 时在 `windows-latest` 用 tauri-action 构建并发布 GitHub Release，含 `latest.json` 与签名）；软件侧接入 `tauri-plugin-updater`，设置页可设检查频率（每周/每月/每年），启动按间隔自动检查并弹窗提醒，更新数据源经 `src/lib/update.ts` 的 `UpdateProvider` 抽象层收敛，便于未来替换为自建服务器。发布版本号需在三处（`tauri.conf.json` / `Cargo.toml` / `package.json`）同步。
- 最新进度与未完成项以本地私有 `local/DEVLOG.md` 顶部条目为准（该目录不入库、不推送）。

## 3. 必读文档（按顺序）

| 顺序 | 文档 | 作用 |
| --- | --- | --- |
| 1 | `docs/README.md` | 文档索引与阅读路径 |
| 2 | `docs/01-requirements.md` | 需求清单、范围边界、MVP 与后续路线对照 |
| 3 | `docs/02-tech-decision-ui.md` | 技术栈定型 + Shadcn/UI 与 Element Plus 评估结论 |
| 4 | `docs/03-architecture.md` | 分层架构、目录结构、前后端 IPC 约定 |
| 5 | `docs/04-data-model-encryption.md` | 数据库表结构、字段加密方案、密钥派生 |
| 6 | `docs/05-mvp-spec.md` | MVP 功能规格：左右布局、分类、列表、Markdown 备注、弹窗编辑、预设字段、复制、强密码生成 |
| 7 | `docs/06-backup-webdav.md` | 本地备份/拷贝/恢复方案 + WebDAV 接入预留设计 |
| 8 | `docs/07-i18n.md` | 中英文切换方案与目录约定 |
| 9 | `docs/08-roadmap.md` | 分阶段开发计划、里程碑、验收标准 |
| 10 | `docs/10-release-update.md` | 自动发布（release.yml）+ 自动更新（Tauri updater、检查频率、数据源抽象层、发版步骤） |
| — | `local/DEVLOG.md` | 开发日志（本地私有，被 `.gitignore` 忽略，不推送；每次实质性改动后追加） |

## 4. 硬性约束（不可违背）

1. **落盘即加密**：账号、密码、邮箱、手机号、备注等敏感字段，在写入 SQLite 前必须在 Rust 侧加密；数据库文件里不允许出现这些字段的明文。
2. **前端不直连数据库**：所有读写经 Tauri Command（Rust 侧）完成；前端只通过类型化的 IPC 接口拿数据。
3. **密钥不落盘**：主密码本身不存储；会话密钥仅驻留内存，锁定/退出时清零。
4. **离线优先**：默认零网络请求；WebDAV 是可选增强，且只上传密文。
5. **i18n 先行**：所有界面文案走 i18n 词条，不在组件里硬编码中/英文字符串。
6. **改动回写文档**：架构、数据模型、接口、约定发生变化时，先改对应 `docs/` 文档，再在本地 `local/DEVLOG.md` 追加条目。
7. **公开仓库只放规则**：`docs/` 与 `AGENTS.md` 只收录开发规则、设计约定与验收标准；开发日志、技术调研、参考项目分析等过程性材料一律放本地私有 `local/`（已被 `.gitignore` 忽略），不写入公开文档、不入库、不推送。
8. **不公开个人与本机信息**：代码、注释、文档、配置、提交信息中不得出现真实姓名、个人账号、邮箱、手机号、住址/城市、内网地址、绝对路径、SSH 密钥或公钥指纹、网络受限情况、关掉安全校验的临时做法等；这类内容只能写进本地 `local/`。每次提交前自查 `git status` 与 `git diff`，只提交与项目相关的内容；提交身份使用 GitHub noreply 邮箱。

## 5. 工作约定

- 分支：`main` 保护；功能开发走 `feat/xxx`，修复走 `fix/xxx`。
- 提交信息：Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:` …）。
- 类型：前端严格 TypeScript；Rust 侧对外命令的入参/出参都要有明确结构体与错误类型。
- 日志：禁止在日志中打印密码、密钥、备注明文；安全事件可记录不含敏感数据的元信息。

## 6. 如何更新开发日志

每次完成一个可验证的小里程碑后，在本地私有 `local/DEVLOG.md` 顶部（最新在上）追加：

```
## YYYY-MM-DD — <一句话标题>
- 改动：做了什么 / 涉及哪些文件
- 决策：关键取舍与原因
- 验证：如何验证（命令、手动步骤、测试结果）
- 遗留：未完成项或已知风险
```
