# 09 · 开发环境与工具链

> 0.4.0 起项目使用 Native Shell（nsh），不再需要 Node 前端构建、Tauri CLI 或 WebView2。每个新 PowerShell 会话先在仓库根目录执行 `scripts/dev-env.ps1`，再运行任何构建命令。脚本只注入会话 PATH，不修改系统环境变量；本文不写死个人绝对路径。

## 1. 工具链

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| Native Shell CLI | `nsh 0.5.0` | 创建/运行/测试/打包；Windows 发行包解压后保留 `bin/` 与 `runtime/` 完整目录 |
| Rust | stable（本机 1.99.1，host `x86_64-pc-windows-gnu`） | 构建 `core/` 与 `native/`；nsh 用 Cargo 编译混合应用的 Rust 部分 |
| C 工具链 | MinGW-w64 gcc 16.2.0（MSYS2）或 MSVC | `rusqlite` 的 `bundled` 需要编译 SQLite C 源码 |
| git / gh | 任意较新版本 | 版本控制与 GitHub CLI |
| Node / npm | 可选 | 仅用于 `npm run typecheck`（本地 TypeScript 检查）与 Prettier；nsh 自身不需要 Node |

nsh 安装（二选一）：

```powershell
# 官方安装脚本（安装到 %LOCALAPPDATA%\nsh，并加入用户 PATH）
irm https://nsh.dev/install.ps1 | iex

# 或把发行包解压到仓库内 .tools\nsh（dev-env.ps1 会自动加入会话 PATH）
# https://github.com/longbridge/nsh/releases/latest/download/nsh-windows-x86_64.zip
```

## 2. 每个新会话

```powershell
. .\scripts\dev-env.ps1
```

脚本把 `.cargo\bin`、MSYS2 `mingw64\bin`、git、gh，以及仓库内 `.tools\nsh\bin`（存在时）加入当前会话 PATH。

常用命令：

```powershell
nsh run .                    # 本机桌面窗口 + 热更新
nsh test .                   # headless：native cargo test + TSX UI 测试
nsh check .                  # 官方类型检查（TypeScript 7）
nsh build .                  # 生成 .nsh/out/bundle.js 等
nsh package . --target windows

cargo test --manifest-path core\Cargo.toml
cargo check --manifest-path native\Cargo.toml
npm run typecheck            # 本地 TS 检查（nsh check 受临时目录权限限制时使用）
npm run format               # Prettier
```

## 3. 关键取舍

- **GNU 工具链可用**：nsh 的 Windows 开发宿主由 Cargo 用当前工具链构建；本机 GNU 目标 + MinGW 已能完成混合应用构建、headless 测试与运行。官方文档以 MSVC 为标准路径；若切换 MSVC，需安装 VS Build Tools + Windows SDK，并安装对应的 Rust MSVC target。
- **nsh 临时目录**：nsh 运行/检查时会在用户临时目录或本地应用数据目录创建会话目录。若受限环境报 `os error 5`，把 `TMP`/`TEMP` 与 `LOCALAPPDATA` 指向仓库内可写目录，并用 `MEND_DATA_DIR` 指定测试库位置；正式安装后的应用使用用户正常的数据目录。本仓库已在 Windows 上以此方式通过 `nsh check` / `nsh test` / `nsh package`。
- **rusqlite `bundled`**：首次编译 SQLite C 源码约 30–60s；`cargo check` 也会触发构建脚本，因此机器上必须有可用的 C 编译器。
- **测试数据隔离**：`nsh test` 的 headless 应用没有真实数据目录，测试前设置 `MEND_DATA_DIR` 指向临时目录，并在每次测试前清空。
- **不要在主 crate 上跑 `cargo test`**：已不存在 Tauri 主 crate；当前测试入口是 `core` 与 `native`。
- **图标**：应用图标在 `assets/icon.png`；分类图标是 emoji 映射（`lib/category-icons.ts`），不再依赖图标字体。

## 4. 已知遗留

- `nsh check` 在本机当前环境可能因下载/写入 TypeScript 7 的临时目录被拒绝而报 `os error 5`；`npm run typecheck` 等价可用。
- 手机打包需要 Android SDK/NDK 或 Xcode；本仓库当前只在 Windows 上验证了桌面与 headless 测试。
- 自动更新签名清单与发布密钥尚未配置，发布工作流只产出 zip/setup。
