# 11 · Native Shell 重构说明（0.4.0）

> 本文是 0.4.0 重构后的**当前架构事实来源**。旧的 `01`–`10` 文档保留为历史设计记录；其中涉及 Tauri / Vue / naïve-ui / Vite / WebView 的段落已不适用，以本文和根目录 `AGENTS.md` 为准。

## 1. 结论

Mend 已从 **Tauri 2 + Vue 3 + WebView** 重构为 **Native Shell（nsh 0.5.0）**：

- UI 全部是 **TSX 原生视图**（`View` / `Text` / `Scroll` / `List` / `Input` / `Dialog` / `TextView` 等），不再有 WebView、HTML、CSS 页面或前端打包器。
- 数据与加密仍在 **Rust**：SQLite、Argon2id、XChaCha20-Poly1305、密码生成器沿用原来的 `mend-core`（其 `.mendbak` 备份容器保留但暂无 UI 入口）。
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
├── components/             # 原生 UI 组件（Icon、EntryList、EntryCardList、编辑器、设置…）
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
   │  Vault.init / unlock / listEntries / createEntry / switchVault …
   ▼
native（Rust，mend-native）
   │  进程级 SQLite 连接 + 内存 DEK；CRUD 同步、昂贵派生走 blocking
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
- 旧 `.mendbak` 备份不再有 UI 入口；库文件格式（schema v4）未变，旧数据直接可用。
- 手机端由宿主提供 `process.dataDir`；若平台不提供目录，`Vault.init` 返回明确错误而不是静默新建库。
- **写权限自检**：`Vault.init` 在打开 SQLite 之前先探测数据目录与已存在库文件的写权限；不可写时返回 `db_readonly|...`（消息含路径），UI 按 `lib/errors.ts` 映射为中英文操作指引，不把 SQLite 底层的 `readonly` / `cannot open` 错误直接抛给用户。
- **不静默换库**：数据目录不可写时只报错，不回退到别的位置新建库。密码管理器静默换库会让人误判为数据丢失，比启动失败更危险。
- **验收口径**：首次启动（无库）、已有库启动、锁定/解锁、条目写入都必须在**真实应用数据目录**下验证；`MEND_DATA_DIR` 隔离的测试库只覆盖逻辑，不能替代真实目录的写权限验证。

### 4.1 库文件位置（用户自选）

库文件本身就是完整的保险库：主密码的 `salt` / Argon2 参数 / 被 KEK 包裹的 DEK 全在文件里，所以"换一座库"＝换一个文件，不需要账户体系，也不需要同步服务。

- **位置指针**：数据目录下的 `vault-location.json`（`{"v":1,"path":"<绝对路径>"}`，非敏感）。它是"当前用哪个库文件"的唯一锚点；文件不存在即使用数据目录里的默认 `mend.db`。删除它 = 恢复默认位置。
- **切换语义**（`Vault.switchVault`）：校验目标（存在则必须是 SQLite 头；空文件放行，SQLite 会初始化它）→ 探测所在目录可写 → 写指针 → 关闭旧连接、清会话密钥（等于锁定）→ 用新文件重开连接。`ensure_conn` 失败会把指针与路径一起回滚，避免停在"记住了一个打不开的库"。
- **不做自动迁移**：切到别的文件不会搬数据，也不会删除原库。用户随时切回来即可。
- **UI**：设置 → 数据库文件（当前路径 + 在文件夹中显示/打开/新建/恢复默认），解锁页底部同款入口（解锁前也要能换库）。切换后前端重新走一遍 `boot()`（等价刷新页面），并关闭所有弹窗——弹窗是独立原生窗口层，不会随主界面重建消失。
- **免密码解锁与库绑定**：密钥文件按库区分（`device-unlock-<库路径哈希>.key`，存在数据目录而不是库文件旁边，拷走库不会顺手带走自动解锁），里面记着库的 `salt`；换库后 salt 不匹配会自动作废该文件，退回输主密码。
- **备份 = 拷贝库文件**：不做加密快照导出/恢复（对应的 UI 已移除）。库文件本身就是完整、受主密码保护的数据，用户把它拷到 U 盘/同步盘即可；恢复就是把别的文件切回来。`native.reveal_vault_file` 在系统文件管理器里**选中当前库文件**（Windows `explorer /select,`），让"拷走它"这一步不用自己找。`mend-core` 的 `backup` 模块（`.mendbak` 容器）仍然保留并有测试，只是暂时没有 UI 入口。

### 4.2 受限权限（Low 完整性）下的库文件位置

`nsh dev` 宿主等场景下进程以**低完整性级别**运行，只能写 `%LOCALAPPDATA%`…/`LocalLow`（`AppData\LocalLow\com.mend.app`），用户随手选的"桌面""文档"会被 `ACCESS_DENIED` 拒绝。因此：

- 数据目录有一串兜底候选（见 `candidate_data_dirs`），按"真写一个探针文件"逐个验证。
- 选库文件时同样先探针（`probe_writable`）：所在目录/文件不可写时返回 `export_dir` 码（文案 `vault.dirUnwritable`），直接告诉用户换一个文件夹，而不是先把指针改过去再在打开时炸掉。
- 打包版（正常完整性）不受此限，可以把库文件放在任意用户目录。

## 5. 原生模块约定

`native/src/api.rs` 中的 `#[module] impl Vault` 导出给 TSX；`native/src/service.rs` 保存进程级 `Mutex<Backend>`。

- **同步 vs 异步的分界线是「有没有昂贵 CPU / 阻塞 I/O」**，不是「能不能 async」。
**最近使用的数据库**：左下 NavRail 的「切换」按钮（`nav-switch`）弹出 `Menu`，列出 `preferences().recentVaults` 里的库文件（只显示文件名，完整路径在 tooltip，当前库打勾），点选直接调 `switchToVaultFile(path)` → 现有 `applyVaultFile()` 切换流程（清内存、重跑 `boot()`，无需重启）；菜单另附「打开其他 / 新建 / 使用默认位置」入口。最近列表存在全局数据目录的 `preferences.json`（`recentVaults` 字段，去重、最多 8 个），由 `rememberVault()` 在启动与切库成功后维护——因为偏好文件不在库文件里，切库不会丢失这份历史。手机紧凑布局复用同一触发器，菜单向上弹出。

  - 同步函数（绝大多数 CRUD、`status`、偏好读写、device key 开关）：nsh 在引擎线程内直接执行，所有 signal 写入都留在引擎线程，不存在续体线程问题。
  - `async fn`（`init` / `setup` / `unlock` / `change_password` / 库文件选择 / `reveal_vault_file`）：用于把 Argon2id、文件对话框、文件管理器调用挪出引擎线程。
  - **引擎线程不能调 ambient 服务**：`nsh_core::element::data_dir()` 在同步导出函数里调用会 panic（`no reactive runtime: signals are used on the engine thread, while components run`）。因此 `init` 必须是 `async`（`resolve_data_dir` 才敢调 `data_dir()`），之后所有同步函数只读 `Backend.data_dir` 这个普通字段。
  - **异步函数里不要碰 signal**：`async fn` 在 tokio 线程完成，TSX 的 `await` 续体不在引擎线程，写 signal 会不更新 UI 甚至 panic。约定是「异步函数只返回数据，由调用方（引擎线程的 await 续体）写 signal」——nsh 的 `await` 续体会回到引擎线程，所以 `status.set(await native.unlock(...))` 这种写法是安全的。
  - 昂贵 CPU 段拆到 `nsh_core::prelude::blocking`（= `tokio::task::spawn_blocking`）：`core` 侧因此拆成 `prepare_*`（纯计算，`Send`）/ `apply_*`（写库）两半，`native` 负责「引擎线程读 challenge → blocking 派生 → 引擎线程写 session」。debug 构建下 Argon2id（64 MiB / t=3 / p=4）单次约 1.5s，release 约 0.15s；现在这段时间界面不冻结，按钮显示「解锁中…」。
- 错误以字符串 `code|message` 返回；TSX `lib/errors.ts` 按 `code` 映射 i18n，未知 code 才显示原始 message。
- 原生模块公开 DTO 在 `native/src/dto.rs`；nsh 自动生成 `.nsh/types/mend/native.d.ts`。

### 5.1 站点图标（favicon 缓存）

列表行首图标走**三级回退**：库里缓存的真实 favicon（`site_icon(url)` 返回 `data:` URI）→ 内置品牌 SVG（`lib/site-icons.ts`，离线即时）→ 分类 emoji。

- **网络出口只有一处**：`Vault.fetchSiteIcons(limit)` 在 `nsh_core::prelude::blocking` 里用 ureq 抓取，直达条目自己填写的站点；`nsh.json` 不开 `capabilities.network`，TSX 从不发请求。请求复用 `system_proxy::apply()` 注入的系统代理。
- **禁止第三方图标服务**：Google s2 / DuckDuckGo icon 之类的接口会把整份站点清单交给一家公司，对密码管理器是实质泄露。
- **抓取策略**：先读首页 `<link rel="icon|apple-touch-icon">`（按 sizes 排序，优先 PNG），再退回 `/favicon.ico`；只接受 PNG/JPEG/GIF/WebP/SVG（ICO 用 `image` crate 转 PNG，因为 Linux 无法直接渲染 ICO），单张 ≤96KB，`MAX_ICON_SIDE=96`。
- **入口校验**：入队与读缓存前都先过 `icons::parse_site`——只认点号分隔的域名、IPv4/IPv6 字面量与 `localhost`；裸词（`fa`、`intranet`）这类误输入直接跳过，不发请求也不留失败记录。老版本遗留的非法行在抓取时由 `db::prune_site_icons` 顺手剔除。
- **缓存与退避**：结果写进同一个库文件的 `site_icons` 表（schema v5，随库拷走，不落明文图片文件）。成功 90 天过期重抓；失败按 `24h × 2^n`（封顶 30 天）退避，避免每次解锁都重试。
- **触发时机**：TSX 在解锁进入主界面后等 3s 起跑（`lib/site-icons-cache.ts`），每批 4 个站点、批间隔 1.2s、站点间 250ms；新增/编辑条目会重新排队。设置里关掉「网站图标」= 零请求，列表立刻回退到内置图标。

### 5.2 离线模式（总开关）

`preferences.json` 的 `offline` 字段是应用级总开关，默认 `false`；偏好读入时缺省或类型错误一律回落默认值（只需新增键，老偏好文件免迁移）。设置-安全的 Switch 与导航栏锁定按钮下方的快捷按钮共用 `lib/state.ts` 的 `toggleOfflineMode`，开启前必须二次确认并说明会停掉哪些请求。开启后两个网络出口都直接短路，**一次请求都不发**：站点图标批次（`site-icons-cache.ts` 的 `startSiteIconFetch`/`step`/`runBatch`，并清掉已排队批次）与更新检查/下载（`lib/update.ts` 的 `checkForUpdates`/`checkForUpdatesOnStartup`/`startUpdate`）。已缓存的 favicon 与内置品牌图标照常显示；关闭离线模式会恢复图标抓取，但仍受「网站图标」开关与解锁状态约束。

### 5.3 系统托盘与关闭行为

主窗口用系统标题栏，关闭按钮由应用自己接管（`lib/tray.ts`）：`closePress` 回调按偏好决定缩到托盘还是退出。

- **关闭拦截的关键：创建期就要 `closeOnPress:false`**。`nsh.json` 的 `window` 段直接写死 `"closeOnPress": false`，让窗口创建时就生效；**不能只靠运行时 `Window.set`**——渲染期的一次性 `set` 在「旧外壳 + OTA 包」环境会被丢弃（标题也踩过同款坑），一旦 `closeOnPress` 退回 `true`，点关闭按钮会直接销毁窗口退出，`closePress` 回调根本没机会跑，表现就是「开关开了却没缩托盘、图标也没了」。`installTrayHandlers` 里仍保留运行时 `set`，并用读取 `bootReady()` 的 effect 在 boot 后再设一次作兜底。
- **首次询问**：偏好 `trayChoiceMade=false` **且** `closeMinimizeToTray=false` 时才弹一次确认（确定＝缩托盘 / 取消＝退出），两个分支都写入 `closeMinimizeToTray` 并把 `trayChoiceMade` 置 `true`；之后关闭只读开关，不再询问。以开关为准的分支顺序避免老偏好文件出现「开关开但没选过」时误弹窗。确认框挂在 `App` 顶层（不在 `MainScreen`），否则解锁页关闭时弹不出来。`ConfirmState` 因此新增 `cancelLabel` / `onCancel`——Esc 与点取消都要走同一分支。
- **托盘图标**：应用启动即常驻（`installTrayEffect` 在渲染期 `Tray.set`，菜单文案随语言偏好刷新，effect 读 `bootReady()` 在 boot 后再设一次；`Tray.set` 用 try/catch 兜住旧外壳缺 API），只有退出应用才 `Tray.set(null)` 移除——窗口恢复或缩托盘都不影响图标。左键点击或菜单「打开主面板」＝ 先切 `activePage='entries'`（启动后的首页＝密码列表页，即使缩托盘前停在设置页也回到列表），再 `show + focus`；右键固定三项：`tray.open` / `tray.settings`（先切 `activePage='settings'` 再显示窗口）/ `tray.quit`（`Application.quit()`，先撤图标）。图标唯一源仍是 `assets/icon.png`（§8.1），不为托盘另存一张。
- **偏好字段**：`closeMinimizeToTray`（默认 false）、`trayChoiceMade`（默认 false）、`autoStart`（默认 false）都走 preferences.json 的纯 JSON 透传，新增键老文件免迁移。
- **手机 / headless**：无 `nsh/desktop` 时（`isAvailable=false`）全部降级——关闭按钮保持系统默认行为，托盘逻辑不安装，不引入桌面依赖。

### 5.4 开机自启

偏好 `autoStart` 只是 UI 镜像，**真正的状态是系统登录项**：`boot()` 里用 `native.autoStartEnabled()` 校准（用户可能绕开 UI 直接改了系统设置），切换开关走 `native.setAutoStart(enabled)`，原生写入成功后才更新偏好。退出时先 `Tray.set(null)` 再 `Application.quit()`，不留残留图标；`Application.quit()` 不受 `closeOnPress` 拦截。

nsh 没有开机自启 API，由 `native/src/autostart.rs` 自己实现，只写**当前用户**级位置、不需要管理员权限：

| 平台 | 位置 |
| --- | --- |
| Windows | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`，值名 `Mend`，数据为带引号的 exe 绝对路径（复用已有 `windows-sys` 依赖，未引入新 crate） |
| macOS | `~/Library/LaunchAgents/com.mend.app.plist`（`RunAtLoad=true`），并顺带 `launchctl load/unload` 让本次会话立即生效 |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/autostart/com.mend.app.desktop` |

读取注册项 / 写文件都是同步且不碰 nsh 的 ambient 服务，按 §5 的分界保持同步导出。设置页的开关只在 `platform.desktop` 时显示。

## 6. UI 与交互决策

| 旧实现 | 新实现 | 说明 |
| --- | --- | --- |
| 自定义 40px 标题栏 + Tauri 窗口控制 | **系统标题栏** + 应用内 Header | 原生窗口拖动/最小化/最大化/关闭由系统提供 |
| 左侧 240px 侧栏 + 11 列表格 | **桌面侧栏 + 列表 + 行内操作**；手机单栏 | 列表直接显示字段，不再有详情面板/弹窗 |
| 行内展开字段 | 列表/卡片内直接展示，行内图标完成编辑/复制/收藏/归档/删除 | 去掉详情弹窗，少一次点击 |
| SortableJS 拖拽排序 | 条目用行内按钮「上移 / 下移」；侧栏「我的分组」用鼠标拖动排序 | 无 DOM/DnD：条目排序语义仍按分类分桶，分类顺序写 `categories.sort_order` |
| 自研 Markdown 渲染 | nsh `TextView`（原生 Markdown） | 不再处理 HTML/白名单 |
| naïve-ui 组件 | nsh `View`/`Text`/`Input`/`Dialog`/`Select`/`Sheet` + Tailwind 类 | 全部自绘，适配浅/深色 |
| Material 分类图标 | emoji + 颜色点 | 旧 Material 图标名保留在 DB，仅显示时映射 |
| 条目图标只用分类 emoji | 三级回退：库里缓存的真实 favicon → 内置品牌 SVG → 分类 emoji | 116 个离线品牌 glyph（`assets/site-icons/`，Simple Icons / MDI）+ 联网抓回的站点图标（schema v5 `site_icons`，见 §5.1）；分类色做底色 |
| localStorage 偏好 | 数据目录下的 `preferences.json`（`loadPreferences`/`savePreferences`） | 解锁前也能应用语言/主题；**不再用 nsh `Storage`**——它会往 `%APPDATA%` 写 `storage.json`，进程权限不足时报「拒绝访问」 |
| 加密快照导出/恢复（`.mendbak`） | 移除：库文件本身就是完整数据，提供「在文件夹中显示」让人直接拷走 | 少一套「导出→选目录→再导入」的仪式；受限权限下也不再需要解释「为什么导不进桌面」（§4.2） |
| Tauri updater | 暂不启用 | 需要新的 nsh 签名清单与发布密钥；UI 保留版本信息 |
| 弱密码/重复密码标记 | 暂未恢复 | 需要额外的原生安全报告接口；核心加密逻辑未受影响 |

列表布局（0.5.0 起）：标签写在标题下方，与标题共用 name 列并整体垂直居中（无标题时标签本身居中）；账号/密码、邮箱/手机号各纵向两行、共用一格，行内按「账号：xxx / 密码：•••• / 邮箱：xxx / 手机：xxx」呈现（前缀只显示，复制按钮只写原始字段值）；编辑、复制整条、星标、归档、删除、取消归档/恢复、彻底删除、上移/下移全部改成行内图标按钮，不再有「更多」弹出菜单。列偏好随之从 `username`/`password`/`email`/`phone`/`notes` 五列迁移为 `credentials`/`contact`/`notes` 三列：旧可见列任一为真则整格保留；列宽偏好已整体废除（不可拖、不持久化），旧偏好文件里的宽度字段读取时直接忽略。单元格文字超出列宽一律省略号截断，悬停由 `ui.tsx` 的 `fullTextTip` 气泡显示完整内容（宽 320pt 封顶、最多 8 行）；处于掩码状态的密码不进气泡，悬停也不泄露。复制按钮永远写完整原值，与显示截断无关。备注格不做垂直居中：`h-full items-start` 从左上角起排，最多两行、多余省略（卡片视图仍是单行预览）。操作列在 160pt 内摊开全部行内按钮，表格态用 20pt 密集按钮（图标 12pt）保证手动排序的 7 个按钮也放得下。

主列表用 `nsh/base` 的 `DataTable` 渲染：选择列（32pt）与标题列固定左侧、操作列（160pt）固定右侧，分类列恒定 120pt（只在「全部」视图出现）。**列宽不可拖动、不持久化**：显式 `resizableColumns={false}`（该 prop 默认 **true**，删掉不等于关闭），固定列 `minWidth = maxWidth = 恒定宽度`；其余列（标题 + 已开启的账号密码 / 邮箱手机 / 备注）按 `onLayout` 拿到的表格实宽平分剩余空间，除不尽的余数逐列 +1pt 补齐，窗口缩放时整表跟着重新平分。平分列有 40pt 下限，极窄窗口下表格转为横向滚动而不是把列压成 0。列宽按**内框宽**（`onLayout` 外框宽 − 左右各 1pt 边框）平分：按外框算会多出 2pt，让 DataTable 画出一条几乎铺满、拖不动的横向滚动条；只有列宽总和真正超过内框宽（触发 40pt 下限）时才显示 `horizontalScrollbar`，正常宽度下那条无用滚动条不再出现。列配置菜单只保留「显示哪些列」（触发器 testID `column-config`，菜单项 `column-toggle-<key>`）；工具栏的「重置」图标与菜单里的「重置列宽」入口、`tableLayoutVersion` 信号都已删除。工具栏第二个图标在「列表视图 / 卡片视图」间切换，卡片视图是虚拟化的 `List` + 响应式列数（1~4 列），卡片内容与表格逐项一致。滚动条统一用 `Scrollbar`：启动时 `Scrollbar.setTheme` 设一次全局细胶囊外观，DataTable 走内置条，卡片视图用独立 `<Scrollbar scroll={listRef}>`。大数据兼容靠两层：`entries` 仍是一次取全量的非敏感摘要，敏感字段按 `PAGE_SIZE=200` 分批解密；DataTable 的 `rowCount` 是全表、`data` 只持有已解密窗口，`onVisibleRowsChange` 提前补密，`onLoadMore` 兜底；卡片 `List` 同样虚拟化和触底加载。单元格一律通过 accessor 读 signal，避免 DataTable 回收槽位后显示旧行快照。分类列右缘另有一条自绘浅灰竖线（testID `category-edge`，1px `bg-border`），与固定区边缘线同款：DataTable 只给固定区画边缘线，分类列不是固定列，故由 `EntryDataTable` 按累计列宽 −1pt 定位自绘；范围对齐原生那条线的可见段（表头不透明会盖住它，自绘线同样从表头下缘画到表底、含空白区）。出现横向滚动（列宽总和 > 表格实宽）时不画——拿不到像素级 scroll 偏移，画了会跟错列；分类视图整列不存在时也不画。另有一个 DataTable 上游限制的 workaround：自定义表头槽位按**列序号**复用且中间删列时不重渲染（表头会停留旧列），故整表包在 `<Each of={[列键签名]}>` 里——列集合变化（进/出分类视图、列配置开关）时整表重建，仅列宽变化（窗口缩放）不重建。

**按钮悬停与光标统一约定**：全应用图标按钮只用 `components/ui.tsx` 的共享 `IconButton`（列表行内动作曾是 `EntryCells` 私有 RowAction，已删除并入）。`Button` 的 props（ComponentHostProps）不含 onMouseEnter/Leave，故 IconButton 外层包一层 View 承接 mouseenter/mouseleave（含子视图）驱动悬停图标提亮；悬停底色走 View 的 `hover:` 类（默认 `hover:bg-primary/15` + `hover:ring-1 hover:ring-primary/30`，语义 `tone` 用 `hover:bg-destructive/20 hover:ring-destructive/30` / `hover:bg-warning/20 hover:ring-warning/30`，选中态 `hover:bg-primary/25`）——不用 `accent` 是因为它 `#e8efff` 与页面背景 `#f4f6ff`/卡片 `#fff` 几乎同色、浅色主题下 hover 看不出来；底色加描边才能在白底/淡底上都一眼可见，`transition` 补间；小手光标挂外层 View 的 `cursor-pointer`，内层 Button 也显式带一份（双保险）——Windows host 的光标解析沿父链向上取（`nsh-platform-windows` `input.rs` `cursor()`），禁用态 `cursor-not-allowed`。内层 Button 保留按压反馈（`active:opacity-70`）、tooltip 与 testID。文字按钮（ActionButton）、SelectField 触发器与菜单项、Chip、SwitchField 与工具栏显示密码开关、行选择框、备注格同套约定：可按表面 `cursor-pointer` + 悬停底色/边框反馈，禁用 `cursor-not-allowed`。新增按钮直接复用这些原语，不在业务组件里自绘 hover 或光标。headless 的 SpanStyle 只有文本属性，断言不了底色/光标；回归靠「悬停行内图标按钮 → tooltip 出现」证明 hover 到达，光标与底色用独立探针窗口 + GetCursorInfo/PrintWindow 实测。

**DataTable 自定义 cell 内的按钮光标**：nsh-base 的 DataTable 在表体上方盖了一层 hit layer（`view.rs` `hit_layer()`，scroll 套 scroll，带 Press/MouseMove handler），把点击/悬停转发给自定义 cell 里的按钮——这也是 hover 底色与 tooltip 能生效的原因。但 Windows 光标解析（`nsh-platform-windows` `input.rs` `cursor()`）走独立的 `pick()`，命中的是最上层的 hit layer view 而非下面 cell 里的按钮；hit layer 自身无 cursor、表体 body 又是 `pointer-events: none`，按钮上的 `cursor-pointer` 在光标链上永远看不到，表现为行内图标按钮 hover 有底色、光标却是默认箭头（普通 View 里的按钮如顶栏「预设值」不受影响）。nsh 没有 per-cell cursor 转发 API，解决办法是给该表的 `classes.root` 加 `cursor-pointer`：root 是 hit layer 的祖先，光标沿父链上溯到它取到手型（行本体已不响应点击，但整表手型仍保留作行内按钮的光标 workaround；卡片视图只有行内按钮/备注/网址标题是手型，卡片本体不响应点击）。中间层 scroll/frame 均无默认 cursor，不会抢先命中。限制：整张表（含文字格）都是手型，无法只精确命中操作列按钮——这是 nsh hit layer 架构的固有限制。

列表底部多选条在勾选后出现「已选 N 项 / 复制整条记录 / 批量删除 / 取消选择」：批量删除先弹危险色二次确认（普通/归档视图说明可在回收站恢复；回收站视图为彻底删除、不可恢复），确认后逐条调用原生单条删除接口并刷新，取消与确认都清空选择；「取消选择」按钮只清选择、不动数据。

行内图标走**预着色变体**：Windows 上 `<Image>` 的 `tintColor` 每次绘制都要过一遍 D2D 颜色矩阵特效，列宽连续变化时上百个行内图标逐帧重绘曾是卡顿主因（当时实测平均帧间隔 ~16ms、p95 ~37ms）。因此把主题色直接烘进 SVG 的 `currentColor`：`scripts/gen-tinted-icons.mjs` 读 `theme.json` 的浅/深主题 token 与 `lib/site-icons.ts` 的品牌色（含 `brandTint` 提亮规则），生成 `assets/icons-tinted/{name}-{rrggbb}.svg`、`assets/site-icons-tinted/{file}-{rrggbb}.svg` 和索引表 `components/tinted-icons.ts`（键 `name|rrggbb`）。`Icon` 与 `EntryIcon` 命中烘焙变体时直接画缓存位图、不再传 `tintColor`；未收录的颜色仍回退 tintColor，外观不变。主题色、行内图标集合或品牌图标变化后重跑 `node scripts/gen-tinted-icons.mjs`，产物提交进仓库，不要手改生成文件。

条目编辑里的标签选择用 nsh 0.5.1 的 `Combobox`：已选标签作为 `prefix` 胶囊留在字段内，输入框负责搜索与打开列表，行末是清空按钮和箭头；桌面弹层浮在字段下方、触屏为底部 sheet，选中行用 `group-selected:` 显示勾选。0.4.11 时因 `Select` 弹层在 `Dialog` 内弹不出而退回「胶囊行 + 自绘菜单」，升级后实测 Windows 真平台弹层正常，故换回官方组件；仍只从标签维护集合里选，不提供自由新建。

分类编辑与标签编辑共用 `ui.tsx` 的 `ColorPickerControl`（色域 + 色相滑杆 + hex 输入，8 位带 alpha 的值统一截成 `#RRGGBB`）；分类额外保留「无颜色」按钮，清除后写 `NULL`。侧栏「我的分组」用 `PanResponder` 做鼠标拖动排序：拖动中实时重排预览，松手调用 `Vault.reorderCategories` 把完整 id 顺序写进 `categories.sort_order`；拖动结束后补发的 press 被吞掉，不会误切当前分组。分组行末默认显示条目数；鼠标进入数字所在的 24pt 槽位只原位切换为「···」，**不自动弹菜单**；点击「···」才通过受控 nsh `Menu` 弹出「编辑 / 删除」，移开指针不会收起已打开的菜单，再点一次（或点其他位置/拖拽排序）才关掉；打开其他分组的菜单会立刻关掉旧菜单。删除项用 `text-destructive` 危险色并保留确认弹窗。

移动端：`platform.idiom` 为 `phone`/`pad` 或窗口宽度 < 900 时主布局用单栏（无独立侧栏）；分类通过顶部菜单打开的 Sheet；底部安全区用 `env(safe-area-inset-*)`。应用快速导航（NavRail）在窗口宽度 < 600（含 phone idiom）时横放底部，其余宽度保持最左竖栏；列表视图按固定列 + 其余列平分排布（极窄时横向滚动），卡片视图按窗口宽 1~4 列自适应。

设置页是独立页面（非弹窗）：< 1000（含 phone idiom）单页滚动展示全部分区卡片，不设设置内快速导航，控件全宽；≥ 1000 左侧四分类子导航（200px，≥ 2560 220px）+ 锚点滚动内容；内容 max-width 980px 居中，≥ 2560 1600px。页内所有下拉/输入框/主操作按钮统一宽度（240px，手机全宽）；字段统一纵向：主题/语言竖排，「外观与行为」标题作为 CardHeader 进主题/语言卡（≥1100 装饰画绝对定位右上角作卡片背景，不参与布局、不撑大标题与字段间距）；安全卡顺序为自动锁定 → 免主密码解锁 → 风险提示（开关紧贴文案左侧，说明文字另起一行与开关左缘对齐，SwitchField `leading`）；改主密码表单纵向。更新卡承载检查频率（最左，检查按钮在其正下方）；应用标识/版本信息（原「关于」卡融合而来，不再单独设卡）无边框无底色，置于检查结果横幅下方：桌面客户端 Badge 紧随 Mend 名称，版本与构建合并为「版本 x（构建 n）」一行；更新卡下方保留独立「关于」卡，GitHub 源码与 CNB 镜像两张链接卡整卡点击调系统浏览器打开，不新增设置子导航。滚动高亮 = 视口中线 + 触顶/触底端点（触底仅在真能滚动时成立）；导航点击按「意图」收敛——程序化滚动期间不做几何判定、定时兜底解锁，避免目标分区靠尾部时滚动被夹到触底而抢错高亮。窄视口下 Scroll 内容宽度显式归属（手机 contentStyle 取窗口宽），不依赖内容容器自适应。

## 7. 功能对照

已保留：建库/解锁/锁定/改主密码、条目 CRUD、分类 CRUD（名称/颜色/emoji 图标）、标签、搜索、排序（最近更新/名称/收藏/手动）、收藏、归档、回收站（恢复/彻底删除/清空）、预设值、强密码生成器、Markdown 备注、复制到剪贴板、打开网址、自动锁定、浅色/深色/跟随系统、中英文切换、库文件自选与「在文件夹中显示」、关闭时缩到系统托盘（首次询问一次）/ 托盘右键菜单、开机自启（§5.3 / §5.4）。

暂缓/简化：更新检查、弱密码/重复密码安全标记、移动端备份“另存为”、WebDAV、TOTP、CSV/KDBX 导入导出（仍是非目标）。

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

### 8.1 应用图标：唯一源与派生产物

应用图标只有一份源：`assets/icon.png`（1024×1024 PNG），由 `nsh.json` 的 `"icon"` 引用。窗口左上角标题栏、任务栏、系统托盘、安装包、exe 内嵌、macOS dock 等所有系统级图标都从它派生，禁止为单个位置另维护一套图。换图标只替换这张源文件，再跑 `nsh build` / `nsh package` 让 `.nsh/windows/icon.ico` 等派生产物自动重生，不要手工改 `.nsh/` 下的产物。`assets/icons/*.svg`（按钮/菜单线性图标）与 `assets/site-icons/*.svg`（网站品牌图标）属于另一套 UI 图标体系，与应用图标无关，不要混淆。换完图标逐处核对：左上角、任务栏、托盘、安装包/exe，确保全部一致。

## 9. 已知风险

- **手机 SQLite 数据目录**：依赖宿主 `process.dataDir`；Android/iOS 打包前需在真机验证。
- **进程权限低于数据目录**：桌面端若应用进程被系统赋予的写入权限低于数据目录，会出现「旧库能读、写不了；新库也建不出来」，SQLite 只报 `attempt to write a readonly database` / `unable to open database file`。写权限自检会把它转成 `db_readonly` 并附上路径；修复方向是让应用以正常权限运行、或修正数据目录的权限，而不是重建数据库。
- **同步原生调用**：偏好读写、条目 CRUD 仍在引擎线程同步执行；库规模显著增大时需要重新评估（改为 `blocking` + 异步返回）。
- **免主密码解锁**：开启后数据目录里多一个 `device-unlock.key`（内含 base64 的 DEK 与库 salt），安全性等价于「这台机器的系统账户」——能读该目录的人就能读库。UI 里是显式开关 + 常驻风险提示 + 开启前的高危确认；改主密码会刷新该文件，恢复备份会作废它（salt 不匹配时自动删除并禁用），下次启动退回输主密码。
- **toast 层级**：`Dialog` 在桌面端是独立原生窗口层，主界面的 `Overlay` 结构上盖不住它。因此 `ModalFrame` 内部挂了一份 `ToastHost`（`Overlay` 会升级到所在 Dialog 的根视图），弹窗打开时再隐藏根层那份（`state.modalOpen`），否则同一句提示会重复出现。
- **更新链路**：已按 nsh 配置应用更新（GitHub Release 压缩包）与 OTA（签名 `.nshpkg`），共用 `nsh.json` 的 `"updater"` 与 `latest.json`。发布密钥/清单密钥存为 Actions secrets，私钥不入库；根密钥离线保管。详见 `10-release-update.md`。
- **旧文档**：`01`–`10` 中 Tauri/Vue 段落为历史记录，阅读时以本文件 + `AGENTS.md` 为准。
