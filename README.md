# Mend

> **Mend the gaps of your memory.**

Mend 是一款本地离线、存盘加密的个人密码管理器，基于 **Native Shell（nsh 0.5.0）**：TSX 原生视图 + Rust 核心（SQLite / Argon2id / XChaCha20-Poly1305），不使用 WebView、HTML 或 CSS 页面。数据与加密全部在 Rust 侧完成，桌面与手机共用同一份自适应 UI。

## ✨ 功能特性

- 本地 SQLite 密码库：账号、密码、邮箱、手机号、备注、预设值等敏感字段在写入磁盘前完成加密。
- 条目管理：标题、用户名、密码、网址、Markdown 备注、标签、收藏。
- 分类（颜色 + emoji 图标）、归档、回收站、预设值。
- 强密码生成器、搜索、排序（最近更新 / 名称 / 收藏 / 手动）、复制到剪贴板、打开网址。
- 自动锁定、浅色 / 深色 / 跟随系统主题、中英文界面。
- 加密备份：`.mendbak` 导出与恢复。
- 应用更新与签名 OTA 更新（正式发布走 GitHub Releases）。
- 同一份代码自适应桌面 master-detail（侧栏 + 列表 + 详情）与手机单栏布局。

## ⚠️ Important / 重要提示

This software is provided "as is", without warranty of any kind. Back up your vault regularly. If you lose the master password, the data cannot be recovered.

本软件按现状提供，不附带任何形式的担保。请定期备份密码库；主密码丢失后数据无法恢复。

## 🧰 环境准备

开发前先安装 Native Shell CLI，再准备 Rust 工具链。

**1. 安装 nsh CLI（0.5.0）**

```powershell
# Windows
irm https://nsh.dev/install.ps1 | iex
```

```bash
# macOS / Linux
curl -fsSL https://nsh.dev/install.sh | sh
```

安装完成后用 `nsh --version` 确认可用。

**2. 安装 Rust 工具链**

通过 [rustup](https://rustup.rs) 安装 Rust。Windows 上 MinGW-w64 或 MSVC 均可（与所选 Rust target 匹配即可）；`rusqlite` 以 bundled 方式编译 SQLite，需要一个可用的 C 编译器。

**3. 进入仓库根目录，即可开始开发。**

## 🚀 快速开发

在仓库根目录执行：

```powershell
nsh dev
```

`nsh dev` 使用官方原生宿主并带 TSX 热重载；首次运行会自动编译 Rust 模块，之后改动即改即生效。

仓库根的 `.cargo/config.toml` 已把 Cargo 构建脚本的临时目录固定到仓库内 `.cargo/tmp`，因此 Windows 上 cc-rs 的临时目录报错（`Cannot create temporary file ... Permission denied`）不会再挡住 `nsh dev`，**无需任何额外初始化**。该目录由 `.cargo/tmp/.gitkeep` 随仓库分发；若被误删（报 `No such file or directory`），执行 `New-Item -ItemType Directory -Force .cargo/tmp` 或运行下面的 `dev-env.ps1` 即可恢复。

需要更快的构建或统一的会话 PATH 时，可选执行（不安装、不修改系统设置）：

```powershell
. .\scripts\dev-env.ps1   # 把 CARGO_HOME 指到仓库内缓存，并让官方 nsh 的 PATH 优先
```

`nsh run .` 不再是主开发入口，仅在需要 `--target web` / `--target tui` 预览时使用。

## ✅ 检查与测试

```powershell
nsh check .        # 官方类型检查
npm run typecheck  # 等价的 TypeScript 检查（备用）

nsh test .         # native cargo test + TSX headless 测试
cargo test --manifest-path core\Cargo.toml   # 加密 / SQLite / 备份等核心测试
```

## 📦 构建与打包

```powershell
nsh build .                    # 输出到 .nsh/out
nsh package . --target windows # 产物：Mend/Mend.exe、Mend.zip、Mend-<版本>-windows-x86_64.zip、Mend.iss
```

安装了 Inno Setup 6 时，`nsh package` 还会额外产出 `setup.exe` 安装包（未安装则只写 `Mend.iss`，属正常）。整个打包不需要签名密钥。发布正式版：打 `v*` tag 后由 `.github/workflows/release.yml` 自动构建并发布 GitHub Release。

`package.json` 同时提供等价的 npm scripts：`dev` / `build` / `package` / `test` / `check` / `typecheck`。

**VS Code**：仓库内置 `.vscode/tasks.json`，任务覆盖开发、检查、测试、打包与格式化等常用流程，从 `Terminal → Run Task` 选择即可。

## 📁 项目结构

- `App.tsx`：应用入口（boot → setup / unlock → main）。
- `screens/`：UnlockScreen、MainScreen 等界面。
- `components/`：原生 UI 组件（列表、详情、编辑器、设置等）。
- `lib/`：native 封装、状态、错误、格式化、偏好。
- `native/`：nsh 原生模块（`mend/native`），封装 core 与文件操作。
- `core/`：`mend-core`，无 GUI 的 Rust 核心（SQLite + Argon2id + XChaCha20-Poly1305）。
- `locales/`：中英文文案（`en.json`、`zh-CN.json`）。

另有 `nsh.json`（应用元数据与 `rust: native` 声明）、`theme.json`（设计令牌）与 `assets/`。

## 💾 数据与备份

- 数据目录：Windows 为 `%APPDATA%\com.mend.app`（macOS 为 `~/Library/Application Support/com.mend.app`，Linux 为 `$XDG_DATA_HOME/com.mend.app`），可在应用内「设置」中查看。
- 密码库为单文件 `mend.db`；敏感字段在 Rust 侧加密后才写入 SQLite。
- 备份为 `mend-backup-*.mendbak` 加密文件：导出写入数据目录，恢复通过系统文件选择器读取。
- 与旧 Tauri 版本完全兼容：应用 id、库名、schema、加密参数与备份格式均未改变，旧库和旧备份可直接打开，无需迁移。

## 📚 文档索引

- [`AGENTS.md`](./AGENTS.md)：给后续 Agent / 开发者的规则与硬性约束。
- [`docs/11-native-shell.md`](./docs/11-native-shell.md)：0.4.0 重构后的当前架构事实来源。
- `docs/01`–`10`：历史设计记录；其中 Tauri / Vue / WebView 段落已不适用，以 `docs/11` 与 `AGENTS.md` 为准。

## 📄 License

[MIT](./LICENSE)
