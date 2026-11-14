# 09 · 开发环境与工具链

> 0.4.0 起项目使用 Native Shell（nsh），不再需要 Node 前端构建、Tauri CLI 或 WebView2。仓库根 `.cargo/config.toml` 已把 Cargo 构建脚本的 `TMP`/`TEMP` 固定到 `.cargo/tmp`，因此在仓库根目录直接 `nsh dev .` 即可开发；`scripts/dev-env.ps1` 变为可选的会话增强（仓库内 `CARGO_HOME` 缓存与 PATH 统一）。脚本只注入会话 PATH 与 `CARGO_HOME`，不修改系统环境变量；本文不写死个人绝对路径。

## 1. 工具链

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| Native Shell CLI | `nsh 0.5.0` | 创建/运行/测试/打包；Windows 发行包解压后保留 `bin/` 与 `runtime/` 完整目录 |
| Rust | stable（本机 1.99.1，host `x86_64-pc-windows-gnu`） | 构建 `core/` 与 `native/`；nsh 用 Cargo 编译混合应用的 Rust 部分 |
| C 工具链 | MinGW-w64 gcc 16.2.0（MSYS2）或 MSVC | `rusqlite` 的 `bundled` 需要编译 SQLite C 源码 |
| git / gh | 任意较新版本 | 版本控制与 GitHub CLI |
| Node / npm | 可选 | 仅用于 `npm run typecheck`（本地 TypeScript 检查）与 Prettier；nsh 自身不需要 Node |

nsh 安装：

```powershell
# Windows：安装到 %LOCALAPPDATA%\nsh，并加入用户 PATH
irm https://nsh.dev/install.ps1 | iex
```

```sh
# macOS / Linux
curl -fsSL https://nsh.dev/install.sh | sh
```

nsh 必须来自官方安装路径（Windows 为 `%LOCALAPPDATA%\nsh\bin`），不要把发行包解压到仓库内再放进 PATH。历史上有过仓库内 `.tools\nsh` 拷贝（已删除）：即使版本相同，`nsh dev` 也会以可执行文件自身位置定位 dev session 目录，仓库内路径必然报 `create development session directory: 拒绝访问。 (os error 5)`；详见 `docs/11-native-shell.md` 第 8 节。

## 2. 环境准备：裸跑或可选 dev-env

在仓库根目录直接运行即可：

```powershell
nsh dev .
```

Cargo 构建脚本的临时目录由仓库根 `.cargo/config.toml` 的 `[env]` 统一指定为 `.cargo/tmp`（`force = true` 覆盖系统 `TMP`/`TEMP`），所以不 dot-source 任何脚本也能完成 ring / rusqlite 等 C 依赖的编译。`.cargo/tmp/.gitkeep` 保证目录随仓库存在，其余内容被 `.gitignore` 忽略；该目录若被误删会报 `No such file or directory`，重建目录（或运行 `dev-env.ps1`）即可恢复；`.vscode/tasks.json` 也把同一组变量写进 `options.env`，VS Code 任务与终端行为一致。

需要仓库内 Cargo 缓存加速或统一 PATH 时，再执行（推荐，但非必需）：

```powershell
. .\scripts\dev-env.ps1
```

脚本把官方安装的 nsh（`%LOCALAPPDATA%\nsh\bin`，优先）、`.cargo\bin`、MSYS2 `mingw64\bin`、git、gh 加入当前会话 PATH，并清掉可能残留的仓库内 `.tools\nsh\bin` 条目；若调用方未显式指定 `CARGO_HOME`，则把它指向仓库内 `.tools\cargo-home`，复用已缓存的 crate 与该目录下的镜像 `config.toml`。`.vscode/tasks.json` 的 nsh/cargo 任务也会在 `options.env` 里显式设置同一个 `CARGO_HOME`。

常用命令：

```powershell
nsh dev .                    # 官方开发入口：本机桌面窗口 + dev server 热重载
nsh run . --target web       # 可选：其他运行时目标预览（web / tui 等）
nsh test .                   # headless：native cargo test + TSX UI 测试
nsh check .                  # 官方类型检查（TypeScript 7）
nsh build .                  # 生成 .nsh/out
nsh package . --target windows   # 产物 .nsh/out（含 release runner 构建，约 5min；无 Inno Setup 6 时无 setup.exe）

cargo test --manifest-path core\Cargo.toml
cargo check --manifest-path native\Cargo.toml
npm run typecheck            # 本地 TS 检查（与 nsh check 的 TS 部分等价）
npm run format               # Prettier
```

## 3. 关键取舍

- **GNU 工具链可用**：nsh 的 Windows 开发宿主由 Cargo 用当前工具链构建；本机 GNU 目标 + MinGW 已能完成混合应用构建、headless 测试与运行。官方文档以 MSVC 为标准路径；若切换 MSVC，需安装 VS Build Tools + Windows SDK，并安装对应的 Rust MSVC target。
- **Cargo 构建脚本的临时目录**：Windows 上 cc-rs（ring、rusqlite 等）在系统 `TEMP` 建临时文件偶被安全软件/受控目录拒绝，报 `Cannot create temporary file ... Permission denied`（gcc 退出码 3）。仓库根 `.cargo/config.toml` 用 `[env]` + `force = true` 把 `TMP`/`TEMP` 指到 `.cargo/tmp`，对所有从仓库根发起的 `nsh` / `cargo` 构建生效，不需要先 dot-source 脚本；`dev-env.ps1` 与 `.vscode/tasks.json` 仍设置同一目录作会话级兜底。已验证不影响 `nsh dev`、`nsh check`、`nsh package`。
- **dev session 的 `os error 5`**：根因是 PATH 里的 nsh 不是官方安装路径（仓库内拷贝会让 `nsh dev` 定位 dev session 目录失败）。用官方 nsh 后不再需要重定向 `LOCALAPPDATA`。`nsh test` 用 `MEND_DATA_DIR` 指定测试库位置，与真实数据目录隔离。
- **Cargo 缓存不落在用户目录**：`nsh dev` / `nsh check` / `nsh package` 会编译 nsh 生成的 `.nsh/rust` 工程，依赖数量远多于 `core`/`native`。若 `CARGO_HOME` 留在用户目录且缓存不全，就会触发下载，在受限环境里报 `failed to open ....crate / 拒绝访问 (os error 5)`。任务与 `dev-env.ps1` 均把 `CARGO_HOME` 固定到仓库内 `.tools\cargo-home`（含 rsproxy 镜像配置与完整依赖缓存），正常开发零下载。
- **rusqlite `bundled`**：首次编译 SQLite C 源码约 30–60s；`cargo check` 也会触发构建脚本，因此机器上必须有可用的 C 编译器。
- **测试数据隔离**：`nsh test` 的 headless 应用没有真实数据目录，测试前设置 `MEND_DATA_DIR` 指向临时目录，并在每次测试前清空。
- **不要在主 crate 上跑 `cargo test`**：已不存在 Tauri 主 crate；当前测试入口是 `core` 与 `native`。
- **图标**：应用图标在 `assets/icon.png`；分类图标是 emoji 映射（`lib/category-icons.ts`），不再依赖图标字体。

## 4. 已知遗留

- 旧版任务曾把 `LOCALAPPDATA`/`TMP`/`TEMP` 重定向到工作区来绕 `os error 5`；改用官方安装的 nsh 后 `LOCALAPPDATA` 不再需要重定向。现在 `TMP`/`TEMP` 由 `.cargo/config.toml`（构建脚本）与 `dev-env.ps1`/`.vscode/tasks.json`（会话）共同保证，`.vscode/tasks.json` 保留 `CARGO_HOME` 与 `RUSTC_STAGE`；`dev-env.ps1` 不再是每个会话的必做步骤。`npm run typecheck` 是 TypeScript 检查的备用入口（`nsh check .` 的 TS 部分与其等价）。
- 手机打包需要 Android SDK/NDK 或 Xcode；本仓库当前只在 Windows 上验证了桌面与 headless 测试。
- 发布链路（签名 OTA 包、`latest.json` 与 GitHub Release）已配置，但 Windows/Linux/macOS 三端产物与清单签名需在 CI 上完整验证一次；`workflow_dispatch` 仅作流水线自检，正式发版推 `v*` tag。
