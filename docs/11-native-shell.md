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
- **写权限自检**：`Vault.init` 在打开 SQLite 之前先探测数据目录与已存在库文件的写权限；不可写时返回 `db_readonly|...`（消息含路径），UI 按 `lib/errors.ts` 映射为中英文操作指引，不把 SQLite 底层的 `readonly` / `cannot open` 错误直接抛给用户。
- **不静默换库**：数据目录不可写时只报错，不回退到别的位置新建库。密码管理器静默换库会让人误判为数据丢失，比启动失败更危险。
- **验收口径**：首次启动（无库）、已有库启动、锁定/解锁、条目写入都必须在**真实应用数据目录**下验证；`MEND_DATA_DIR` 隔离的测试库只覆盖逻辑，不能替代真实目录的写权限验证。

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
# 可选：仅在需要仓库内 CARGO_HOME 缓存或统一 PATH 时执行（裸跑也完全可以）
. .\scripts\dev-env.ps1

nsh dev .                   # 官方开发入口：本机原生宿主 + dev server 热重载（桌面窗口）
nsh run . --target web      # 可选：其他运行时目标预览（web / tui 等）；日常开发用 nsh dev
nsh test .                  # headless：cargo test（native）+ TSX UI 测试
nsh check .                 # 官方类型检查（native cargo check + TypeScript 7）
nsh build .                 # 生成 .nsh/out
nsh package . --target windows

cargo test --manifest-path core\Cargo.toml
npm run typecheck           # 本地 TypeScript 检查（与 nsh check 的 TS 部分等价的备用入口）
```

nsh 安装：Windows 用 `irm https://nsh.dev/install.ps1 | iex`，macOS/Linux 用 `curl -fsSL https://nsh.dev/install.sh | sh`，安装到用户目录下的官方路径（Windows 为 `%LOCALAPPDATA%\nsh\bin`）。

裸跑即可：仓库根 `.cargo/config.toml` 用 `[env]` + `force = true` 把 Cargo 构建脚本的 `TMP`/`TEMP` 固定到仓库内 `.cargo/tmp`，所以不 dot-source `dev-env.ps1` 也能直接 `nsh dev .`。`.cargo/tmp/.gitkeep` 保证目录随仓库存在，其余内容被 `.gitignore` 忽略。这是 Windows 上 cc-rs（ring、rusqlite 等）临时目录被拒的通用修复，对 `nsh dev` / `nsh check` / `nsh test` / `nsh package` 都生效。`dev-env.ps1` 因此变为可选：它仍负责会话级 PATH（官方 nsh 优先、清掉 `.tools\nsh\bin` 残留）与仓库内 `.tools\cargo-home` 缓存/镜像加速，避免在用户目录重新下载 crate。`.vscode/tasks.json` 的 `options.env` 提供同一组变量（PATH、`CARGO_HOME`、`RUSTC_STAGE`、`TMP`/`TEMP`），任务本身不再 dot-source 脚本。

教训：**nsh 必须来自官方安装路径，不要把仓库内的 nsh 拷贝放进 PATH**。即使字节相同、版本相同，`nsh dev` 也以可执行文件自身位置定位 dev session 目录：仓库内路径会报 `create development session directory: 拒绝访问。 (os error 5)` 并必然失败；官方路径 + 相同环境则一切正常。`scripts/dev-env.ps1` 与 `.vscode/tasks.json` 因此只注入官方路径，仓库内的 `.tools\nsh` 拷贝已删除，不要再恢复。`nsh dev` 会按端口自动接管旧会话，开发任务里不需要杀进程或手动清理 dev-sessions 目录。

`nsh check` 是官方类型检查入口。Windows 上已验证的构建修复由两部分提供，不再需要重定向 `LOCALAPPDATA`：仓库 `.cargo/config.toml` 覆盖 Cargo 构建脚本的 `TMP`/`TEMP`；`scripts/dev-env.ps1` 与 `.vscode/tasks.json` 的 `options.env` 负责会话级 `CARGO_HOME`、`RUSTC_STAGE` 与 PATH。`CARGO_HOME` 固定到仓库内 `.tools\cargo-home`（`.nsh/rust` 的依赖远多于 `core`/`native`，缓存不全时会触发下载，容易在用户目录撞上 `failed to open ....crate / 拒绝访问`）；`RUSTC_STAGE=1`（跳过 proc-macro2 的 Windows probe，避免 `os error 145`）。测试时用 `MEND_DATA_DIR` 把测试库指到临时目录，与真实数据目录隔离。

本仓库已在 Windows 上验证裸跑 `nsh dev .`、`nsh check .` 与 `nsh package . --target windows` 通过（`nsh test .` / `nsh build .` 是提交前与发版前的必跑项）。实测：`nsh check .` 约 66s；`nsh package . --target windows` 约 5min（release runner 构建约 4m56s，打包 3.4s），产物 `.nsh/out/Mend/Mend.exe`、`.nsh/out/Mend.zip`、`.nsh/out/Mend-0.4.0-windows-x86_64.zip`、`.nsh/out/Mend.iss`；未安装 Inno Setup 6 时不生成 `setup.exe`，也不需要签名密钥。

## 9. 已知风险

- **手机 SQLite 数据目录**：依赖宿主 `process.dataDir`；Android/iOS 打包前需在真机验证。
- **进程权限低于数据目录**：桌面端若应用进程被系统赋予的写入权限低于数据目录，会出现「旧库能读、写不了；新库也建不出来」，SQLite 只报 `attempt to write a readonly database` / `unable to open database file`。写权限自检会把它转成 `db_readonly` 并附上路径；修复方向是让应用以正常权限运行、或修正数据目录的权限，而不是重建数据库。
- **同步原生调用**：解锁/改密/备份瞬间会阻塞 UI；如未来库规模显著增大，可改为 `resource` + 原生异步任务，并确保 signal 写回引擎线程。
- **备份导出位置**：当前固定写应用数据目录，不再弹出桌面保存对话框；恢复通过系统文件选择器读取。
- **更新链路**：已按 nsh 配置应用更新（GitHub Release 压缩包）与 OTA（签名 `.nshpkg`），共用 `nsh.json` 的 `"updater"` 与 `latest.json`。发布密钥/清单密钥存为 Actions secrets，私钥不入库；根密钥离线保管。详见 `10-release-update.md`。
- **旧文档**：`01`–`10` 中 Tauri/Vue 段落为历史记录，阅读时以本文件 + `AGENTS.md` 为准。
