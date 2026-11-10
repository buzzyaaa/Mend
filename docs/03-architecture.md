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
│   ├── router/
│   ├── stores/               # Pinia：vault、ui、preferences
│   ├── views/                # UnlockView、MainView、SettingsView
│   ├── components/
│   │   ├── ui/               # 基础通用组件（ToastHost 等，纯 Tailwind）
│   │   ├── layout/           # Sidebar、TopBar、EntryList
│   │   └── entry/            # EntryDialog：条目表单 + Markdown 备注编辑/预览
│   ├── composables/          # useClipboard、useToast、useAutoLock
│   ├── lib/                  # ipc 封装、markdown 安全渲染、cn 工具
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

命名：`<domain>_<action>`，入参/出参均为 serde 结构体；统一错误类型 `MendError`，前端映射为可提示的消息。

| 命令 | 入参 | 出参 | 说明 |
| --- | --- | --- | --- |
| `vault_setup` | `{ masterPassword }` | `{ unlocked: bool }` | 首次启动建库、派生 KEK 并包裹 DEK（已实现） |
| `vault_unlock` | `{ masterPassword }` | `{ unlocked: bool }` | 校验密钥、装载会话 DEK 到内存（已实现） |
| `vault_lock` | — | — | 销毁会话密钥、清空敏感内存（已实现） |
| `vault_status` | — | `{ initialized, unlocked }` | 启动时判断走解锁页还是主界面（已实现） |
| `category_list` | — | `Vec<Category>` | 分类列表（含 entryCount 聚合，已实现） |
| `category_create` | `{ input: { name } }` | `Category` | 已实现 |
| `category_rename` | `{ id, input: { name } }` | — | 已实现 |
| `category_delete` | `{ id }` | — | 删除时条目移入"未分类"（已实现） |
| `entry_list` | `{ categoryId?, keyword? }` | `Vec<EntryView>` | 解锁态返回解密后的展示模型（已实现） |
| `entry_get` | `{ id }` | `EntryView` | 单条详情（已实现） |
| `entry_create` | `{ input: EntryInput }` | `EntryView` | 敏感字段后端加密后落库（已实现） |
| `entry_update` | `{ id, input: EntryInput }` | `EntryView` | 已实现 |
| `entry_delete` | `{ id }` | — | 软删除：写 `deleted_at` 进回收站（已实现） |
| `entry_trash_list` | — | `Vec<EntryView>` | 回收站列表（解密返回，含 `deletedAt`，已实现） |
| `entry_restore` | `{ id }` | — | 从回收站恢复（已实现） |
| `entry_purge` | `{ id }` | — | 彻底删除，仅接受回收站条目（已实现） |
| `entry_purge_all` | — | `number` | 清空回收站，返回删除条数（已实现） |
| `preset_list` | — | `Vec<PresetView>` | 账号/邮箱/手机号预设值，解锁态解密返回（已实现） |
| `preset_create` | `{ input: PresetInput }` | `PresetView` | 值加密落库，排序号自动取 max+1（已实现） |
| `preset_update` | `{ id, input: PresetInput }` | `PresetView` | 保留原排序号与创建时间（已实现） |
| `preset_delete` | `{ id }` | — | 已实现 |
| `generator_generate` | `{ options: GeneratorOptions }` | `String` | 纯本地 CSPRNG，结果不入库（已实现） |
| `app_paths` | — | `{ dataDir, dbPath }` | 设置页展示数据目录，便于手动拷贝库文件（已实现） |
| `backup_export` | `{ path, masterPassword }` | `{ path, bytes }` | 导出加密 `.mendbak`（整库密文，已实现） |
| `backup_import` | `{ path, masterPassword }` | `{ entries, categories, previousBackup }` | 校验临时文件后覆盖替换并锁定会话（已实现） |
| `sync_webdav_test`（预留） | `WebdavConfig` | `{ ok }` | 阶段 5 仅定义接口，默认未启用联网 |

### 3.1 前后端类型对齐

- 前端 `src/types/` 定义与 Rust 结构体一一对应的 TS 接口；`src/lib/ipc.ts` 封装 `invoke` 并做错误归一。
- 变更命令契约时，同步更新本表与 `04-data-model-encryption.md`。

## 4. 状态管理（Pinia）

- `useVaultStore`：初始化/解锁/锁定状态、当前会话是否解锁。
- `useEntryStore`：分类列表、条目列表、当前选中条目、搜索关键字、当前分类过滤。
- `usePreferencesStore`：语言、主题、生成器默认选项（持久化到本地非敏感设置表）。
- 敏感明文只在组件需要时持有，复制/展示后按策略释放；不把整条明文密码写进全局持久化存储。

## 5. 窗口约定

- 主窗口：左右布局（见 `05-mvp-spec.md`）。
- 条目/备注编辑：MVP 优先用 **主窗口内 Dialog 弹窗**（独立浮层、可关闭）；若后续需要真正的独立系统窗口，再用 Tauri `WebviewWindow` 新开，接口与组件保持可替换。
- 语言切换入口：左上角软件名右侧（见 `07-i18n.md`）。

## 6. 环境与命令备忘

- 工具链默认不在系统 PATH：每个新 PowerShell 会话先在仓库根目录执行 `.\scripts\dev-env.ps1`（脚本按 `%USERPROFILE%` 推导路径，仅注入会话 PATH，不改系统环境变量）。
- 版本、安装取舍与已知遗留见 `09-env-setup.md`。
- 开发：`npm run tauri dev`（Vite + Rust 二进制 + WebView）；前端单独调试：`npm run dev`；类型检查：`npm run typecheck`；构建：`npm run build` / `npm run tauri build`。
- VS Code：`.vscode/tasks.json` 已把上述命令配成中文任务（`运行任务` 或 `Ctrl+Shift+B` 唤起），每条都先执行 `scripts/dev-env.ps1` 再跑目标命令，无需手动准备 PATH。
