# 11 · Native Shell 重构说明（0.4.0）

> 本文是 0.4.0 重构后的**当前架构事实来源**。旧的 `01`–`10` 文档保留为历史设计记录；其中涉及 Tauri / Vue / naïve-ui / Vite / WebView 的段落已不适用，以本文和根目录 `AGENTS.md` 为准。

## 1. 结论

Mend 已从 **Tauri 2 + Vue 3 + WebView** 重构为 **Native Shell（nsh 0.5.0）**：

- UI 全部是 **TSX 原生视图**（`View` / `Text` / `Scroll` / `List` / `Input` / `Dialog` / `TextView` 等），不再有 WebView、HTML、CSS 页面或前端打包器。
- 数据与加密仍在 **Rust**：SQLite、Argon2id、XChaCha20-Poly1305、备份容器、密码生成器沿用原来的 `mend-core`。
- 两者通过 nsh 的 **混合应用**机制连接：`nsh.json` 的 `"rust": "native"`，TSX 从 `mend/native` 导入 `Vault` 模块。
- 仅有一份响应式 UI 代码，桌面与手机共用；布局按窗口宽度 / `platform.idiom` 自适应。

## 2. 目录

```text
Mend/
├── App.tsx                 # 入口：boot → setup / unlock / main
├── App.test.tsx            # nsh test：建库、建条目、锁定、解锁
├── nsh.json                # 应用元数据、窗口、capabilities、rust: native
├── theme.json              # shadcn 风格设计令牌（浅色/深色）
├── tsconfig.json           # 继承 .nsh/tsconfig.json
├── assets/                 # 图标、应用图标
├── components/             # 原生 UI 组件（Icon、EntryList、EntryDetail、编辑器、设置…）
├── screens/                # UnlockScreen、MainScreen
├── lib/                    # native 封装、状态、错误、格式化、偏好
├── locales/                # rust-i18n v1 格式：en.json、zh-CN.json
├── core/                   # mend-core：SQLite + 加密 + 备份（无 GUI）
├── native/                 # nsh 原生模块：mend/native，封装 core 与文件操作
├── docs/                   # 设计文档
└── local/                  # 本地私有：DEVLOG、调研（不入库）
```

## 3. 分层

```text
TSX UI（components / screens / lib）
   │  Vault.init / unlock / listEntries / createEntry / exportBackup …
   ▼
native（Rust，mend-native）
   │  进程级 SQLite 连接 + 内存 DEK；同步导出，避免跨线程响应式写入
   ▼
core（Rust，mend-core，GUI 无关）
   │  crypto / db / entries / presets / generator / backup / session
   ▼
SQLite 单文件（应用层字段加密）
```

原则：

1. **前端不直连数据库**；所有读写经过 `mend/native`。
2. **落盘即加密**：账号、密码、邮箱、手机号、备注、预设值在 Rust 侧 AEAD 加密后写库。
3. **密钥不落盘**：主密码仅用于 Argon2id 派生 KEK；DEK 仅内存，锁定即清零。
4. **旧库/旧备份兼容**：数据库文件名、schema v4、Argon2 参数、XChaCha20 AAD、`.mendbak` 格式均未改变。
5. **i18n 先行**：所有界面文案走 `locales/`，组件不硬编码中英文。

## 4. 数据目录与兼容性

- 应用 id 保持 `com.mend.app`。
- nsh 的 `process.dataDir` / `nsh_core::element::data_dir()` 在 Windows 给出 `%APPDATA%\com.mend.app`，与旧 Tauri `app_data_dir` 一致；macOS 为 `~/Library/Application Support/com.mend.app`，Linux 为 `$XDG_DATA_HOME/com.mend.app`。
- 数据库仍为 `mend.db`，直接打开旧库；无需迁移向导。
- 备份仍为 `mend-backup-*.mendbak`，旧备份可直接恢复。
- 手机端由宿主提供 `process.dataDir`；若平台不提供目录，`Vault.init` 返回明确错误而不是静默新建库。

## 5. 原生模块约定

`native/src/api.rs` 中的 `#[module] impl Vault` 导出给 TSX；`native/src/service.rs` 保存进程级 `Mutex<Backend>`。

- 除 `revealDataDir`（需要 nsh 的异步文件管理器）外，**所有导出都是同步函数**。
  - 原因：nsh 自定义模块的 `async fn` 在 tokio 线程完成，TSX 的 `await` 续体可能不在引擎线程；在那里写 signal 不会更新 UI，甚至触发 `no reactive runtime`。同步函数让所有 signal 写入留在引擎线程。
  - 代价：Argon2 解锁/改密约百毫秒级、备份导入导出毫秒到百毫秒级会短暂占用 UI 线程；个人库规模下可接受。列表查询不做全量解密（只有搜索时才解密匹配字段）。
- 错误以字符串 `code|message` 返回；TSX `lib/errors.ts` 按 `code` 映射 i18n，未知 code 才显示原始 message。
- 原生模块公开 DTO 在 `native/src/dto.rs`；nsh 自动生成 `.nsh/types/mend/native.d.ts`。

## 6. UI 与交互决策

| 旧实现 | 新实现 | 说明 |
| --- | --- | --- |
| 自定义 40px 标题栏 + Tauri 窗口控制 | **系统标题栏** + 应用内 Header | 原生窗口拖动/最小化/最大化/关闭由系统提供 |
| 左侧 240px 侧栏 + 11 列表格 | **桌面 master-detail**：侧栏 + 列表 + 详情；手机单栏 | 列表只显示摘要，详情按需解密 |
| 行内展开字段 | 右侧详情面板（手机为独立详情页） | 减少一次渲染的字段数量 |
| SortableJS 拖拽排序 | 行菜单「上移 / 下移」+ 手动排序 | 无 DOM/DnD；排序语义仍是按分类分桶 |
| 自研 Markdown 渲染 | nsh `TextView`（原生 Markdown） | 不再处理 HTML/白名单 |
| naïve-ui 组件 | nsh `View`/`Text`/`Input`/`Dialog`/`Select`/`Sheet` + Tailwind 类 | 全部自绘，适配浅/深色 |
| Material 分类图标 | emoji + 颜色点 | 旧 Material 图标名保留在 DB，仅显示时映射 |
| localStorage 偏好 | nsh `Storage`（非敏感） | 解锁前也能应用语言/主题 |
| 原生保存对话框 | 导出到应用数据目录，并显示路径 | 手机没有保存对话框；桌面用户可从数据目录取走文件 |
| Tauri updater | 暂不启用 | 需要新的 nsh 签名清单与发布密钥；UI 保留版本信息 |
| 弱密码/重复密码标记 | 暂未恢复 | 需要额外的原生安全报告接口；核心加密逻辑未受影响 |

移动端：`platform.idiom` 为 `phone`/`pad` 或窗口宽度 < 900 时使用单栏布局；分类通过顶部菜单打开的 Sheet；底部安全区用 `env(safe-area-inset-*)`。桌面端为侧栏 + 350px 列表 + 详情。

## 7. 功能对照

已保留：建库/解锁/锁定/改主密码、条目 CRUD、分类 CRUD（名称/颜色/emoji 图标）、标签、搜索、排序（最近更新/名称/收藏/手动）、收藏、归档、回收站（恢复/彻底删除/清空）、预设值、强密码生成器、Markdown 备注、复制到剪贴板、打开网址、自动锁定、浅色/深色/跟随系统、中英文切换、加密备份导出/恢复、数据目录展示。

暂缓/简化：更新检查、弱密码/重复密码安全标记、拖拽排序、移动端备份“另存为”、WebDAV、TOTP、CSV/KDBX 导入导出（仍是非目标）。

## 8. 开发与验证命令

```powershell
. .\scripts\dev-env.ps1     # 加入 cargo / MinGW / nsh(.tools) 到 PATH，并固定 CARGO_HOME

nsh run .                   # 本机桌面窗口
nsh test .                  # headless：cargo test（native）+ TSX UI 测试
nsh build .                 # 生成 .nsh/out
nsh package . --target windows

cargo test --manifest-path core\Cargo.toml
npm run typecheck           # 本地 TypeScript 检查（nsh check 在本机受临时目录权限限制时使用）
```

`nsh check` 是官方类型检查入口。若受限环境报 `os error 5`（nsh 写临时目录/本地应用数据目录被拒绝），可把 `LOCALAPPDATA` 与 `TMP`/`TEMP` 指向仓库内可写目录后重试；也可以用 `npm run typecheck` 做等价的 TypeScript 检查。此外 `CARGO_HOME` 必须指向仓库内 `.tools\cargo-home`：`.nsh/rust` 的依赖远多于 `core`/`native`，缓存不全时会触发下载，容易在用户目录撞上 `failed to open ....crate / 拒绝访问`。本仓库已在 Windows 上验证 `nsh check .`、`nsh test .`、`nsh build .` 与 `nsh package . --target windows` 均可通过。

## 9. 已知风险

- **手机 SQLite 数据目录**：依赖宿主 `process.dataDir`；Android/iOS 打包前需在真机验证。
- **同步原生调用**：解锁/改密/备份瞬间会阻塞 UI；如未来库规模显著增大，可改为 `resource` + 原生异步任务，并确保 signal 写回引擎线程。
- **备份导出位置**：当前固定写应用数据目录，不再弹出桌面保存对话框；恢复通过系统文件选择器读取。
- **更新链路**：已按 nsh 配置应用更新（GitHub Release 压缩包）与 OTA（签名 `.nshpkg`），共用 `nsh.json` 的 `"updater"` 与 `latest.json`。发布密钥/清单密钥存为 Actions secrets，私钥不入库；根密钥离线保管。详见 `10-release-update.md`。
- **旧文档**：`01`–`10` 中 Tauri/Vue 段落为历史记录，阅读时以本文件 + `AGENTS.md` 为准。
