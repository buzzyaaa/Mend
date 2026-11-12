# 09 · 开发环境与工具链

> 记录本项目使用的工具链版本、会话初始化方式与关键取舍。每个新会话先在仓库根目录执行 `scripts/dev-env.ps1`，再跑任何构建命令。
> 脚本按 `%USERPROFILE%` 推导路径，仅注入当前会话 PATH，不修改系统环境变量；路径不在本文档写死。

## 1. 工具链版本与安装位置

| 组件 | 版本 | 默认位置 | 说明 |
| --- | --- | --- | --- |
| Node / npm | `v22.23.2` / `10.9.8` | 系统 PATH | 前端构建与 Tauri CLI |
| Rust | `rustc`/`cargo` 1.99.1，host `x86_64-pc-windows-gnu` | `%USERPROFILE%\.cargo`、`%USERPROFILE%\.rustup` | 不在系统 PATH |
| MinGW-w64 | gcc 16.2.0（MSYS2 发行） | `%USERPROFILE%\tools\msys64\mingw64` | C 编译器 + 链接器 + 头文件/CRT |
| MSYS2 | — | `%USERPROFILE%\tools\msys64` | pacman 包管理；镜像源首选清华 tuna |
| git | 2.55.0 | Git for Windows 默认安装位置（`Program Files\Git\cmd`） | 不在新会话 PATH |
| gh CLI | — | GitHub CLI 默认安装位置（`Program Files\GitHub CLI`） | 不在新会话 PATH |
| WebView2 | 随 Edge 运行时 | 系统 | Tauri WebView 宿主 |

## 2. 每个新会话的初始化

在仓库根目录执行：

```powershell
.\scripts\dev-env.ps1
```

脚本把 `.cargo\bin`、`msys64\mingw64\bin`、git、gh 加入当前会话 PATH。

常用命令：

```powershell
npm run dev        # 仅前端浏览器预览（Vite :1420）
npm run typecheck  # vue-tsc 类型检查
npm run build      # 类型检查 + 生产构建到 dist/
npm run tauri dev  # Tauri 桌面开发（Vite + Rust 二进制 + WebView）
cargo check        # Rust 类型/编译检查（--manifest-path src-tauri\Cargo.toml）
cargo build        # Rust debug 构建
```

## 3. 关键取舍与注意事项

- **选 GNU 工具链而非 MSVC**：GNU 路线不需要管理员权限，也不需要 VS Build Tools / Windows SDK，可全部装在用户目录；代价是链接器与 C 编译链要自行维护（本项目用 MinGW-w64）。
- **Rust 自带的 self-contained gcc 只能作链接器、不能编译 C**（见工具链内的 `GCC-WARNING.txt`）；编译 SQLite 等 C 源码必须依赖独立安装的 MinGW-w64（gcc + binutils + 头文件 + CRT + winpthreads）。
- **Cargo 镜像**：`%USERPROFILE%\.cargo\config.toml` 配 rsproxy sparse 源加速 crates.io，并设 `git-fetch-with-cli = true`。
- **MSYS2 镜像**：`msys64\etc\pacman.d\mirrorlist.mingw` / `mirrorlist.msys` 首选清华 tuna，官方源兜底。
- **rusqlite 已启用**（阶段 2）：`src-tauri/core/Cargo.toml` 中 `rusqlite` 用 `bundled` 特性，由 MinGW gcc 编译 SQLite C 源码，首次编译约 30–40s。
- **测试命令**：核心逻辑在独立 crate `mend-core`，跑 `cargo test --manifest-path src-tauri\core\Cargo.toml`。主 crate `mend` 的 `cargo test` 在本机会因测试二进制链接 WebView 依赖而以 `STATUS_ENTRYPOINT_NOT_FOUND` 崩溃（应用本身运行正常），这是已知环境问题，不要在主 crate 上跑测试。
- **图标**：`src-tauri/icons/` 由 `npx tauri icon source.png` 生成；当前为占位图标，正式打包前替换设计稿。

## 4. 已知遗留

- ESLint / Prettier 已配置（2026-11-11）：flat config（`eslint.config.js`，eslint-plugin-vue + typescript-eslint）+ `.prettierrc.json`，脚本 `npm run lint` / `npm run format`。
- 主 crate 的 `cargo test` 不可用（见 §3），单元测试统一放在 `mend-core`。
- Rust 工具链与 MSYS2 未做开机持久 PATH，依赖 `dev-env.ps1` 会话级初始化。
- debug 构建产物 `mend.exe` 约 284MB（未优化 + 调试信息），属正常；release 构建会显著缩小。
