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
- 数据兼容：应用 id 仍为 `com.mend.app`，库文件 `mend.db`、schema v4、Argon2 参数、XChaCha20 AAD、`.mendbak` 格式全部保持；旧库和旧备份可直接打开。
- 已保留：建库/解锁/锁定/改主密码、条目 CRUD、分类 CRUD、标签、搜索、排序、收藏、归档、回收站、预设值、强密码生成器、Markdown 备注、复制、打开网址、自动锁定、深浅色主题、中英文、加密备份导出/恢复、数据目录展示。
- 主要 UI 结构：桌面 master-detail（侧栏 + 列表 + 详情）；手机单栏（详情页 + 分类 Sheet）。系统标题栏；应用内 Header 放搜索/新增/预设/设置/锁定。
- 测试：`nsh test .`（native cargo test + TSX headless）；`cargo test --manifest-path core\Cargo.toml`；`npm run typecheck`。
- 发布：`.github/workflows/release.yml` 打 `v*` tag 时构建 Windows/Linux/macOS 包、签名 OTA 包、生成签名 `latest.json` 并发布 GitHub Release；应用更新与 OTA 共用 `nsh.json` 的 `"updater"`，详见 `docs/10-release-update.md`。

## 3. 硬性约束

1. **落盘即加密**：账号、密码、邮箱、手机号、备注、预设值在写入 SQLite 前必须在 Rust 侧加密；数据库文件中不得出现这些字段的明文。
2. **前端不直连数据库**：TSX 只通过 `mend/native` 的类型化接口读写；不接触 SQLite 连接或原始密钥。
3. **密钥不落盘**：主密码不存储；KEK 仅内存；DEK 由 KEK 包裹后存 `meta`；锁定/退出时清零会话密钥。
4. **离线优先**：默认零网络请求；备份只写本地密文；WebDAV 仍是未实现的预留。
5. **i18n 先行**：所有界面文案走 `locales/`，组件不硬编码中/英文字符串。
6. **同步原生导出**：除 `revealDataDir` 外，`Vault` 导出保持同步，以保证 signal 写入发生在引擎线程；不要改回自定义 `async fn` 后再在 TSX `await` 后写 signal（会触发 `no reactive runtime`）。
7. **公开仓库只放规则**：`docs/` 与 `AGENTS.md` 只收录开发规则、设计约定、验收标准；开发日志、调研与个人/本机信息只放 `local/`。
8. **不公开个人与本机信息**：代码、注释、文档、配置、提交信息中不得出现真实姓名、个人账号、邮箱、手机号、住址/城市、内网地址、绝对路径、SSH 材料、网络受限情况等；提交身份使用 GitHub noreply 邮箱。

## 4. 工作约定

- 分支：`main` 保护；功能 `feat/xxx`，修复 `fix/xxx`。
- 提交：Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:` …）。
- TSX：严格 TypeScript；原生 DTO 以 `.nsh/types/mend/native.d.ts` 为准，UI 侧类型从 `mend/native` re-export，避免漂移。
- Rust：`core` 不依赖 nsh/GUI；`native` 只做 DTO、路径、文件/备份编排与模块导出；业务规则优先留在 `core`。
- 日志：禁止打印密码、密钥、备注明文；安全事件只记录元信息。
- 版本号需同步：`nsh.json`、`package.json`、`core/Cargo.toml`（以及发布 tag）。

## 5. 每个新 PowerShell 会话

```powershell
. .\scripts\dev-env.ps1
```

它把 cargo、MinGW、git、gh 以及仓库内 `.tools\nsh\bin`（若存在）加入当前会话 PATH；未指定 `CARGO_HOME` 时把它指向仓库内 `.tools\cargo-home`（含完整 crate 缓存与镜像配置），避免 nsh 编译 `.nsh/rust` 时去用户目录重新下载依赖而触发 `os error 5`。不修改系统环境变量。nsh 安装方式见 `docs/09-env-setup.md`。

## 6. 如何更新开发日志

完成一个可验证的小里程碑后，在 `local/DEVLOG.md` 顶部（最新在上）追加：

```markdown
## YYYY-MM-DD — <一句话标题>
- 改动：做了什么 / 涉及哪些文件
- 决策：关键取舍与原因
- 验证：命令、手动步骤、测试结果
- 遗留：未完成项或已知风险
```
