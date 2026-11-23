# AGENTS.md — 给后续接手的 Agent / 开发者

> 先读 `docs/11-native-shell.md`（0.4.0 重构后的当前架构与验证口径），再读本文件。`docs/01`–`10` 是历史设计记录，其中 Tauri/Vue/Vite/WebView 段落已被 0.4.0 取代。
> 决策、架构、数据模型与接口约定写进 `docs/`（提交到 GitHub）；开发日志、调研与个人/本机信息写进本地私有 `local/`（`.gitignore` 忽略，不推送）。架构或数据契约变化时回写对应 `docs/`，并在 `local/DEVLOG.md` 追加条目。

## 1. 项目定位

**Mend**：本地离线、存盘加密的个人密码管理器。

- 运行时：**Native Shell（nsh 0.5.0）**
- UI：**TSX 原生视图**（无 WebView / HTML / CSS 页面 / 前端打包器）
- 核心：**Rust**（`core/` = `mend-core`，SQLite + Argon2id + XChaCha20-Poly1305）
- 桥接：**混合应用**，`nsh.json` 的 `"rust": "native"`，TSX 从 `mend/native` 导入 `Vault`
- 平台：Windows / macOS / Linux 桌面优先，手机（iOS/Android）使用同一份自适应布局；Web 不是产品目标

## 2. 当前状态（0.4.0）

- 旧 Tauri 2 + Vue 3 代码已移除；`src/`、`src-tauri/`、Vite/Tailwind 配置不再存在。
- 数据兼容：应用 id 仍为 `com.mend.app`，库文件 `mend.db`、schema v6、Argon2 参数、XChaCha20 AAD 全部保持；旧库直接可用（`.mendbak` 容器仍在 core 里，但 UI 已不再提供导出/恢复）。
- 已保留：建库/解锁/锁定/改主密码、条目 CRUD、分类 CRUD、**标签维护**（名称+颜色，独立弹窗，条目侧只能选）、搜索、排序、收藏、归档、回收站、预设值、强密码生成器、Markdown 备注、复制、打开网址、自动锁定、深浅色主题、中英文、**数据库文件自选**（打开/新建/恢复默认 + 在文件夹中显示；库文件自带主密码，拷走即备份，不做加密快照导出）。
- 主要 UI 结构：桌面侧栏 + 列表/卡片 + 行内操作（无详情面板/弹窗）；手机单栏（列表/卡片 + 分类 Sheet）。系统标题栏；应用内 Header 放搜索/新增/预设/标签/设置/锁定（预设值与标签入口都是图标+文字）。
- 测试：`nsh test .`（native cargo test + TSX headless）；`cargo test --manifest-path core\Cargo.toml`；`npm run typecheck`。
- 发布：`.github/workflows/release.yml` 打 `v*` tag 时构建 Windows/Linux/macOS 包、签名 OTA 包、生成签名 `latest.json` 并发布 GitHub Release；应用更新与 OTA 共用 `nsh.json` 的 `"updater"`，详见 `docs/10-release-update.md`。
- 启动诊断（0.4.1）：`Vault.init` 前置探测数据目录/库文件写权限，不可写返回 `db_readonly`（含路径），Fatal 页显示实际数据库路径；不静默换库。详见 `docs/11-native-shell.md` §4。

## 3. 硬性约束

1. **落盘即加密**：账号、密码、邮箱、手机号、备注、预设值在写入 SQLite 前必须在 Rust 侧加密；数据库文件中不得出现这些字段的明文。
2. **前端不直连数据库**：TSX 只通过 `mend/native` 的类型化接口读写；不接触 SQLite 连接或原始密钥。
3. **密钥不落盘**：主密码不存储；KEK 仅内存；DEK 由 KEK 包裹后存 `meta`；锁定/退出时清零会话密钥。
4. **离线优先**：业务数据零外发。只有两处会联网，且都能在设置里关掉——更新检查（GitHub）与站点图标抓取（只请求条目自己填写的站点，**禁止**经过 Google s2 / DuckDuckGo 这类第三方图标服务，那会把整份站点清单交给别人）。库文件本地单文件、整库加密；WebDAV 仍是未实现的预留。
5. **i18n 先行**：所有界面文案走 `locales/`，组件不硬编码中/英文字符串。
6. **原生导出的同步/异步分界**：默认同步（引擎线程执行，signal 写入天然在引擎线程）；只有「昂贵 CPU（Argon2id）或阻塞 I/O（文件对话框、备份读写）」才用 `async fn`，且昂贵段走 `nsh_core::prelude::blocking`。两条红线：
   - **同步导出里不能调 ambient 服务**（`data_dir()` 等），否则 panic `no reactive runtime`；所以 `init` 是 `async`，其余同步函数只读 `Backend.data_dir` 字段。
   - **`async fn` 里不能写 signal**：`async fn` 在 tokio 线程完成，续体不在引擎线程。约定「异步函数只返回数据，调用方的 `await` 续体（回到引擎线程）写 signal」，即 `status.set(await native.unlock(...))`。
   7. **公开仓库只放规则**：`docs/` 与 `AGENTS.md` 只收录开发规则、设计约定、验收标准；开发日志、调研与个人/本机信息只放 `local/`。
8. **不公开个人与本机信息**：代码、注释、文档、配置、提交信息中不得出现真实姓名、个人账号、邮箱、手机号、住址/城市、内网地址、绝对路径、SSH 材料、网络受限情况等；提交身份使用 GitHub noreply 邮箱。
9. **应用图标全局统一**：应用图标唯一源是 `assets/icon.png`（1024×1024 PNG），`nsh.json` 的 `"icon"` 指向它；窗口左上角标题栏、任务栏、系统托盘、安装包、exe 内嵌、macOS dock 等所有系统级显示位置都由它派生，禁止为某个位置单独维护另一套图。更换图标只替换这一张源文件，再重新 build/package 让派生产物（如 `.nsh/windows/icon.ico`）自动重生，不要手工维护 `.nsh/` 下的产物。`assets/icons/*.svg`（按钮/菜单线性图标）与 `assets/site-icons/*.svg`（网站品牌图标）是另一套 UI 视觉体系，不受应用图标变更影响，不要混淆。换图标后必须逐处核对：左上角、任务栏、托盘、安装包/exe，确保全部一致。

## 4. 工作约定

- 分支：`main` 保护；功能 `feat/xxx`，修复 `fix/xxx`。
- 提交：Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:` …）。
- TSX：严格 TypeScript；原生 DTO 以 `.nsh/types/mend/native.d.ts` 为准，UI 侧类型从 `mend/native` re-export，避免漂移。
- Rust：`core` 不依赖 nsh/GUI；`native` 只做 DTO、路径、文件/备份编排与模块导出；业务规则优先留在 `core`。
- 日志：禁止打印密码、密钥、备注明文；安全事件只记录元信息。
- 版本号需同步：`nsh.json`、`package.json`、`core/Cargo.toml`（以及发布 tag）。

## 5. 每个新 PowerShell 会话（可选）

在仓库根目录直接 `nsh dev .` 即可。仓库根的 `.cargo/config.toml` 已用 `[env]`（`force = true`）把 Cargo 构建脚本的 `TMP`/`TEMP` 指到 `.cargo/tmp`，所以 Windows 上 cc-rs 的临时目录被拒问题不再要求先初始化会话。

需要以下增强时再执行（推荐，但非每个会话必做）：

```powershell
. .\scripts\dev-env.ps1
```

- 把 `CARGO_HOME` 指向仓库内 `.tools\cargo-home`（含完整 crate 缓存与镜像配置），避免编译 `.nsh/rust` 时去用户目录重新下载依赖而触发 `os error 5`，并加速构建；
- 统一当前会话 PATH：官方安装的 nsh（`%LOCALAPPDATA%\nsh\bin`）排在最前并清掉仓库内 `.tools\nsh\bin` 残留，再加入 cargo、MinGW、git、gh。

nsh 必须来自官方安装路径：仓库内拷贝放进 PATH 会让 `nsh dev` 创建 dev session 目录时必然报 `os error 5`（详见 `docs/11-native-shell.md` 第 8 节）。开发入口是 `npm run dev`（= `scripts/dev.mjs`，先清理旧宿主/旧 dev 会话再 `nsh dev .`；`npm run dev:raw` 才是裸 `nsh dev .`）；`nsh run` 仅用于 web/tui 等其他目标预览。不修改系统环境变量。nsh 安装方式见 `docs/09-env-setup.md`。

排查「改了代码但界面没变」时先确认三件事：**桌面上开的是不是旧打包版 `Mend.exe`**（读死 bundle）、是不是旧开发宿主窗口没关（`%LOCALAPPDATA%\nsh\dev-sessions` 里还留着端口记录）、以及 `.nsh/out/bundle.nshc` 是否为旧产物。`npm run dev -- --dry-run` 可先看会清理哪些进程。

## 6. 如何更新开发日志

完成一个可验证的小里程碑后，在 `local/DEVLOG.md` 顶部（最新在上）追加：

```markdown
## YYYY-MM-DD — <一句话标题>
- 改动：做了什么 / 涉及哪些文件
- 决策：关键取舍与原因
- 验证：命令、手动步骤、测试结果
- 遗留：未完成项或已知风险
```
