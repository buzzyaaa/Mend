# 命令与构建备忘

## 环境准备

每个新终端先执行（否则 cargo / gcc / git 不在 PATH）：

```powershell
.\scripts\dev-env.ps1
```

工具链：Node 22+、npm 10+、Rust stable（Windows 用 GNU 目标 + MinGW-w64 gcc）、git、gh CLI。安装与取舍见 `docs/09-env-setup.md`。

## 常用命令

| 目的 | 命令 |
| --- | --- |
| 安装前端依赖 | `npm install` |
| 仅前端浏览器预览 | `npm run dev`（Vite，:1420） |
| 类型检查 | `npm run typecheck` |
| 前端构建 | `npm run build`（vue-tsc + vite，产物 `dist/`） |
| 后端编译检查 | `cargo check --manifest-path src-tauri/Cargo.toml` |
| 后端构建 | `cargo build --manifest-path src-tauri/Cargo.toml` |
| 核心逻辑测试 | `cargo test --manifest-path src-tauri/core/Cargo.toml` |
| 单个测试 | `cargo test --manifest-path src-tauri/core/Cargo.toml <test_name>` |
| 桌面开发 | `npm run tauri dev` |
| 打包 | `npm run tauri build`（产物 `src-tauri/target/release/<app>.exe`） |

VS Code 侧另有 `.vscode/tasks.json` 里的中文任务，可直接运行。

## 已知坑

- **不要在主 crate 跑 `cargo test`**：测试二进制链接 WebView 依赖，本机启动即 `STATUS_ENTRYPOINT_NOT_FOUND`。测试只写 `core/`。
- **CTest 之外的行为验证**：界面相关结论只能靠 typecheck/build + 后端链路测试背书；本机 GUI 自动化不可靠（多显示器缩放会让坐标点击漂移），不要为验收去抢用户鼠标。
- **打包下载超时**：`tauri build` 在 bundling 阶段要下载 NSIS 工具（`nsis-*.zip`、`nsis_tauri_utils.dll`）。若网络受限，编译产物 `target/release/*.exe` 仍可用；安装包留待能访问上游 release 的环境再生成，别改打包配置去"绕过"。
- **`tauri.conf.json` 的 version 与 `package.json`、`src-tauri/Cargo.toml` 要同步**，否则产物版本信息不一致。
- **对话框等插件**：新增 Tauri 插件时三处齐改——`src-tauri/Cargo.toml` 依赖、`src-tauri/src/lib.rs` 的 `.plugin(...)`、`src-tauri/capabilities/default.json` 权限，缺一个就是运行期报错。

## 数据库位置

库文件名为 `mend.db`，位于应用 identifier 对应的数据目录（设置弹窗会展示实际路径）。开发期重建库：关闭应用 → 备份并移走旧库 → 重新启动走首启流程。库文件、备份文件、日志一律不进仓库。
