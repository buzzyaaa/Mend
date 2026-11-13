> **0.4.0 重构提示**：本文是 Tauri / Vue / WebView 时代的历史设计记录；当前实现、命令与数据兼容说明见 [`11-native-shell.md`](./11-native-shell.md) 与根目录 `AGENTS.md`。

# 03 · 架构与工程结构

## 1. 分层架构

```
┌─────────────────────────────────────────────────────────┐
│ 前端 Vue 3 + TS（WebView）                                 │
│  views / components / stores(Pinia) / composables / i18n  │
│  只做展示、交互、表单校验；不持有数据库连接、不接触原始密钥  │
└───────────────▲─────────────────────────────────────────┘
                │ Tauri IPC（invoke，类型化请求/响应，serde）
┌───────────────┴─────────────────────────────────────────┐
│ Rust 后端（src-tauri，主 crate `mend`）                     │
│  commands/  ：IPC 命令层（参数校验、权限/会话检查、错误转换）│
│  vault/     ：解锁会话状态（DEK 仅驻留内存，锁定即清零）     │
├─────────────────────────────────────────────────────────┤
│ 核心逻辑（src-tauri/core，独立 crate `mend-core`）          │
│  crypto/    ：密钥派生、AEAD 加解密、安全随机、内存清零      │
│  db/        ：SQLite 连接、迁移、仓储（repository）          │
│  entries/   ：条目加解密编排（写前逐字段加密、读后解密）      │
│  error/     ：统一错误类型 MendError                        │
│  backup/    ：备份加密导出/导入校验（`.mendbak` 容器）          │
│  sync/      ：WebDAV 接口预留（trait + 配置，阶段 5 不联网）│
└───────────────▲─────────────────────────────────────────┘
                │ rusqlite
┌───────────────┴─────────────────────────────────────────┐
│ SQLite 单文件（应用层字段加密）                              │
└─────────────────────────────────────────────────────────┘
```

原则：

- **前端不直连数据库**，所有数据经 Rust Command；前端拿到的是解密后的展示模型（解锁态）或密文（锁定态不返回敏感字段）。
- **加密与仓储在 Rust 侧**：前端无法绕过加密直接写库。
- **核心逻辑与 GUI 解耦**：`mend-core` 不依赖 Tauri/WebView，单元测试在无 GUI 环境下可直接运行（主 crate 的测试二进制会链接 WebView 依赖，见 `09-env-setup.md` 已知遗留）。
- **领域逻辑下沉**：分类删除时条目归属、预设值校验、生成器规则等放在 Rust `vault/`，前端只做交互。

## 2. 建议目录结构（阶段 1 初始化时落地）

```
Mend/
├── AGENTS.md
├── README.md
├── docs/                     # 本文档目录
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts        # 或 Tailwind v4 CSS 变量配置
├── index.html
├── src/                      # 前端
│   ├── main.ts
│   ├── App.vue
│   ├── router/               # 路由：AppShell 下挂 main，unlock 独立；设置/预设值/语言为弹窗，不占路由
│   ├── stores/               # Pinia：vault、entry、preset、ui（顶栏弹窗开关）、preferences
│   ├── views/                # UnlockView、MainView
│   ├── components/
│   │   ├── layout/           # TitleBar（标题栏）、AppShell（外壳）、Sidebar、EntryList
│   │   ├── entry/            # EntryDialog：条目表单 + Markdown 备注编辑/预览
│   │   ├── settings/         # SettingsDialog：设置弹窗
│   │   ├── presets/          # PresetsDialog：预设值弹窗
│   │   └── language/         # LanguageDialog：语言选择弹窗
│   ├── composables/          # useClipboard、useToast、useAutoLock、useUpdateChecker
│   ├── lib/                  # ipc 封装、window 窗口控制、titlebarMenu 右键菜单、markdown 安全渲染、theme 主题覆盖
│   ├── assets/               # main.css：浅/深两套 CSS 变量（唯一色彩来源）
│   ├── locales/              # zh-CN.json、en.json
│   └── types/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/default.json  # 权限：core:default + dialog:default（备份文件选择）
│   ├── core/                 # 独立 crate mend-core：不依赖 GUI，可独立跑测试
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── crypto.rs     # Argon2id 派生、XChaCha20-Poly1305 包裹/字段加解密
│   │       ├── db.rs         # 连接、schema 迁移、仓储函数
│   │       ├── entries.rs    # 条目加解密编排 + 落盘无明文测试
│   │       ├── vault.rs      # 建库 / 解锁（密钥编排）
│   │       ├── session.rs    # VaultState 会话状态（锁定即丢弃 DEK）
│   │       └── error.rs      # MendError
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       ├── commands/         # vault.rs、category.rs、entry.rs（其余待实现）
│       ├── backup/           # 待实现
│       └── sync/             # 待实现
└── .gitignore
```

## 3. IPC 命令约定（阶段 2 起逐步实现）

命名：`<domain>_<action>`，入参/出参均为 serde 结构体；统一错误类型 `MendError`。

**错误返回契约**：命令失败时 IPC  rejects 一个结构化对象 `{ "code": "...", "message": "..." }`（`MendError` 的 `Serialize` 实现）。`code` 是稳定的 snake_case 码——`vault` / `db` / `crypto` / `not_found` / `locked`——前端按码映射 i18n 词条（见 `07-i18n.md` §5）；`message` 为中文兜底文案，仅供日志/未知码降级展示，**不得**对其做子串匹配。`locked` 专用于会话守卫（库未解锁），前端应据此跳回解锁页而非弹错误提示。

| 命令 | 入参 | 出参 | 说明 |
| --- | --- | --- | --- |
| `vault_setup` | `{ masterPassword }` | `{ unlocked: bool }` | 首次启动建库、派生 KEK 并包裹 DEK（已实现） |
| `vault_unlock` | `{ masterPassword }` | `{ unlocked: bool }` | 校验密钥、装载会话 DEK 到内存（已实现） |
| `vault_lock` | — | — | 销毁会话密钥、清空敏感内存（已实现） |
| `vault_change_password` | `{ oldPassword, newPassword }` | — | 校验旧密码后用新 KEK 重包裹同一 DEK，事务更新 meta（已实现） |
| `vault_status` | — | `{ initialized, unlocked }` | 启动时判断走解锁页还是主界面（已实现） |
| `category_list` | — | `Vec<Category>` | 分类列表（含 entryCount 聚合，已实现） |
| `category_create` | `{ input: CategoryInput }` | `Category` | `CategoryInput = { name, color?, icon? }`；`color` 仅接受 `#RRGGBB`（大小写不敏感，统一存大写），`icon` 为图标名（上限 64 字），两者可空（已实现） |
| `category_rename` | `{ id, input: CategoryInput }` | — | 重命名时同步覆盖 `color` / `icon`（已实现） |
| `category_delete` | `{ id }` | — | 删除时条目移入"未分类"（已实现） |
| `entry_list` | `{ categoryId?, keyword? }` | `Vec<EntryView>` | 解锁态返回解密后的展示模型；**默认过滤 `archived = 0`**，归档条目走 `entry_archive_list`（已实现） |
| `entry_get` | `{ id }` | `EntryView` | 单条详情（已实现；**预留**，前端暂未调用，列表走 `entry_list`） |
| `entry_create` | `{ input: EntryInput }` | `EntryView` | 敏感字段后端加密后落库；`EntryInput`/`EntryView` 含 `tags: string[]`（已实现） |
| `entry_update` | `{ id, input: EntryInput }` | `EntryView` | 已实现 |
| `entry_delete` | `{ id }` | — | 软删除：写 `deleted_at` 进回收站；`archived = 1` 的条目被拒绝删除（已实现） |
| `entry_archive_list` | — | `Vec<EntryView>` | 归档列表：只返回 `archived = 1 AND deleted_at IS NULL` 的条目（解密返回，含 `archived: true`，已实现） |
| `entry_archive` | `{ id }` | — | 归档：`archived` 置 1（软状态，与 `deleted_at` 正交；不进回收站，可取消归档，已实现） |
| `entry_unarchive` | `{ id }` | — | 取消归档：`archived` 置 0（已实现） |
| `entry_trash_list` | — | `Vec<EntryView>` | 回收站列表（解密返回，含 `deletedAt`，已实现） |
| `entry_restore` | `{ id }` | — | 从回收站恢复（已实现） |
| `entry_purge` | `{ id }` | — | 彻底删除，仅接受回收站条目（已实现） |
| `entry_purge_all` | — | `number` | 清空回收站，返回删除条数（已实现） |
| `entry_reorder` | `{ ids: string[] }` | — | 拖拽排序：**按 `category_id` 分组**写回 `entries.sort_order`（单事务原子，只更新未删除未归档条目；可见子集按给定顺序填回原位，同桶紧凑 `0..n-1`，避免跨分类覆盖或重复 / 空洞）；前端在「手动排序」模式下拖拽结束后调用（已实现） |
| `preset_list` | — | `Vec<PresetView>` | 账号/邮箱/手机号预设值，解锁态解密返回（已实现） |
| `preset_create` | `{ input: PresetInput }` | `PresetView` | 值加密落库，排序号自动取 max+1（已实现） |
| `preset_update` | `{ id, input: PresetInput }` | `PresetView` | 保留原排序号与创建时间（已实现） |
| `preset_delete` | `{ id }` | — | 已实现 |
| `generator_generate` | `{ options: GeneratorOptions }` | `String` | 纯本地 CSPRNG，结果不入库（已实现） |
| `app_paths` | — | `{ dataDir, dbPath }` | 设置弹窗展示数据目录，便于手动拷贝库文件（已实现） |
| `backup_export` | `{ path, masterPassword }` | `{ path, bytes }` | 导出加密 `.mendbak`（整库密文，已实现） |
| `backup_import` | `{ path, masterPassword }` | `{ entries, categories, previousBackup }` | 校验临时文件后覆盖替换并锁定会话（已实现） |
| `sync_webdav_test`（预留，**未注册**） | `WebdavConfig` | — | 仅 `mend-core` 定义 trait（`DisabledSync` 调用一律报"WebDAV 同步尚未启用"），无 IPC 命令、默认未启用联网 |

Locked 迁移说明：全部"库未解锁"守卫（`vault` / `category` / `entry` / `preset` / `backup` 命令与 `mend-core` 的 `session.rs`）统一使用 `MendError::Locked`（码 `locked`），前端可据此跳转解锁页。

### 3.1 前后端类型对齐

- 前端 `src/types/` 定义与 Rust 结构体一一对应的 TS 接口；`src/lib/ipc.ts` 封装 `invoke` 并做错误归一。
- 变更命令契约时，同步更新本表与 `04-data-model-encryption.md`。

## 4. 状态管理（Pinia）

- `useVaultStore`：初始化/解锁/锁定状态、当前会话是否解锁。
- `useEntryStore`：分类列表、条目列表、当前选中条目、搜索关键字、当前分类过滤。
- `usePreferencesStore`：语言、主题、生成器默认选项（持久化到本地非敏感设置表）。
- 敏感明文只在组件需要时持有，复制/展示后按策略释放；不把整条明文密码写进全局持久化存储。

## 5. 窗口约定

- 主窗口：顶部自定义标题栏（`TitleBar.vue`）+ 下方左右布局（`Sidebar` + `EntryList`，见 `05-mvp-spec.md`）。路由只有 `/main`（解锁后唯一页面）与 `/unlock`；设置、预设值、语言选择都是标题栏触发的弹窗，共用 `components/layout/AppShell.vue` 外壳之外挂在 `App.vue` 的 Provider 内部。
- 条目/备注编辑：MVP 优先用 **主窗口内 Dialog 弹窗**（独立浮层、可关闭）；若后续需要真正的独立系统窗口，再用 Tauri `WebviewWindow` 新开，接口与组件保持可替换。
- 语言切换入口：标题栏的语言图标，点击弹出语言选择窗口（见 `07-i18n.md`）。

## 6. 环境与命令备忘

- 工具链默认不在系统 PATH：每个新 PowerShell 会话先在仓库根目录执行 `.\scripts\dev-env.ps1`（脚本按 `%USERPROFILE%` 推导路径，仅注入会话 PATH，不改系统环境变量）。
- 版本、安装取舍与已知遗留见 `09-env-setup.md`。
- 开发：`npm run tauri dev`（Vite + Rust 二进制 + WebView）；前端单独调试：`npm run dev`；类型检查：`npm run typecheck`；构建：`npm run build` / `npm run tauri build`。
- VS Code：`.vscode/tasks.json` 已把上述命令配成中文任务（`运行任务` 或 `Ctrl+Shift+B` 唤起），每条都先执行 `scripts/dev-env.ps1` 再跑目标命令，无需手动准备 PATH。

## 7. 内容安全策略（CSP）

`src-tauri/tauri.conf.json` 的 `app.security.csp` 取值：

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost https://github.com
```

逐项理由（本项目离线优先，策略从紧，仅开必要口子）：

| 指令 | 取值 | 理由 |
| --- | --- | --- |
| `default-src` / `script-src` | `'self'` | 无外部脚本；打包后的前端资源全部同源。保持最严格的脚本来源限制，兜住 XSS→IPC 调用链 |
| `style-src` | `'self' 'unsafe-inline'` | naive-ui 运行时注入 `<style>` 标签与内联 style 属性，去掉 `'unsafe-inline'` 组件样式会整体失效；这是当前框架约束下的已知让步 |
| `img-src` / `font-src` | `'self' data:` | 图标/字体内联（data URI）场景需要 `data:`；不引用任何外部图片与字体 |
| `connect-src` | `'self' ipc: http://ipc.localhost https://github.com` | Tauri IPC 在 Windows WebView2 走 `http://ipc.localhost`（`ipc:` 为其余平台的 scheme 兜底）；`https://github.com` 仅供 updater 检查 `latest.json`（见 `10-release-update.md`） |

> **注意**：该策略尚未经真机验证，需 `npm run tauri dev` 冒烟确认；若界面样式异常（naive-ui 弹层/图标丢失）或 IPC 报 CSP 违规，优先检查本项取值并按 WebView 控制台报错收紧/放行对应指令。
