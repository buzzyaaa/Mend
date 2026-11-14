# 命令与构建备忘

## 环境准备

在仓库根目录直接运行 `nsh dev .` 即可。Cargo 构建脚本的临时目录由仓库根 `.cargo/config.toml` 的 `[env]`（`force = true`）固定到 `.tmp/build`，不 dot-source 任何脚本也能编译 ring / rusqlite 等 C 依赖。

需要仓库内 Cargo 缓存或统一 PATH 时再执行（可选）：

```powershell
. .\scripts\dev-env.ps1
```

它把官方安装的 nsh（`%LOCALAPPDATA%\nsh\bin`，优先）、cargo、MinGW、git、gh 加入当前会话 PATH，并把 `CARGO_HOME` 指向仓库内 `.tools\cargo-home`。nsh 必须来自官方安装路径：仓库内 `.tools\nsh` 拷贝已删除，不要恢复。工具链与安装方式见 `docs/09-env-setup.md`。

## 常用命令

| 目的 | 命令 |
| --- | --- |
| 开发（主入口） | `nsh dev .`（本机原生宿主 + TSX 热重载） |
| 其他运行时预览 | `nsh run . --target web`（可选，不是主开发入口） |
| 官方类型检查 | `nsh check .` |
| TypeScript 备用检查 | `npm run typecheck` |
| native + TSX 测试 | `nsh test .` |
| 核心逻辑测试 | `cargo test --manifest-path core/Cargo.toml` |
| 单个核心测试 | `cargo test --manifest-path core/Cargo.toml <test_name>` |
| native 编译检查 | `cargo check --manifest-path native/Cargo.toml` |
| 构建 | `nsh build .`（输出 `.nsh/out`） |
| Windows 打包 | `nsh package . --target windows`（输出 `.nsh/out`） |
| 格式化 | `npx prettier --write .` 或 VS Code 的「格式化」任务 |

`package.json` 提供等价 scripts：`dev` / `build` / `package` / `test` / `check` / `typecheck` / `format`。VS Code 的 `.vscode/tasks.json` 已内置同一套中文任务（开发、Web 预览、检查、测试、打包、格式化、清理、一键验证），任务自带 `PATH` / `CARGO_HOME` / `RUSTC_STAGE` / `TMP` / `TEMP`，不需要先开终端初始化。

## 已知坑

- **`nsh dev` 报 `create development session directory: 拒绝访问。 (os error 5)`**：PATH 里的 nsh 不是官方安装路径。用官方 `%LOCALAPPDATA%\nsh\bin` 即可；不要杀 `nsh-app-*` 进程、不要删 `%LOCALAPPDATA%\nsh\dev-sessions`、不要重定向 `LOCALAPPDATA`。`nsh dev` 会按端口自动接管旧会话。
- **cc-rs 报 `Cannot create temporary file ... Permission denied`**：构建脚本临时目录不可写。仓库 `.cargo/config.toml` 已把 `TMP`/`TEMP` 指向 `.tmp/build`；若手动删过该目录，恢复 `.tmp/build/.gitkeep` 或让 `dev-env.ps1` 重建。
- **`failed to open ....crate / 拒绝访问 (os error 5)`**：`CARGO_HOME` 留在用户目录且缓存不全，编译 `.nsh/rust` 时触发下载。用 `.tools\cargo-home`（VS Code 任务与 `dev-env.ps1` 都会设置）。
- **proc-macro2 的 `os error 145`**：Windows 上 build script 探测清理失败。任务与 `dev-env.ps1` 设置 `RUSTC_STAGE=1` 跳过探测。
- **测试碰到真实库**：`nsh test .` 前设置 `MEND_DATA_DIR` 指向 `.tmp/test-data` 并清空；VS Code 的测试任务已内置。真实库在 `%APPDATA%\com.mend.app`，不要手动删。
- **不要在主 crate 上跑 `cargo test`**：当前没有 Tauri 主 crate；测试入口是 `core` 与 `native`。
- **版本号同步**：`nsh.json`、`package.json`、`core/Cargo.toml` 三处要一致，否则产物版本信息不一致。
- **打包不需要签名密钥**：`nsh package . --target windows` 只产未签名的 Windows 运行目录 / `Mend.exe` / `Mend.zip` / `Mend.iss`；装有 Inno Setup 6 时另有 `setup.exe`。签名 OTA 包是发布流程（`docs/10-release-update.md`）的事。

## 数据位置

- 真实库：`%APPDATA%\com.mend.app\mend.db`（macOS / Linux 对应平台数据目录），可在应用「设置」中查看。
- 测试库：`%MEND_DATA_DIR%`，仓库内约定为 `.tmp/test-data`，每次测试前清空。
- 库文件、`.mendbak` 备份、`.nsh/out`、`.tmp/`、日志一律不进仓库。

## 改动后的最小验证

1. `nsh check .`（TSX 与 native 编译检查）
2. `nsh test .`（native cargo test + TSX headless；测试数据隔离）
3. 只改 `core/` 时：`cargo test --manifest-path core\Cargo.toml`
4. 涉及打包配置时：`nsh package . --target windows`，确认 `.nsh/out` 产物

界面行为无法用截图自动验收；优先给关键路径补 `App.test.tsx` 之类的 headless 测试，不要为验收去抢用户鼠标。
