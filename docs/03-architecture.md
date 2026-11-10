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
│ Rust 后端（src-tauri）                                     │
│  commands/  ：IPC 命令层（参数校验、权限/会话检查、错误转换）│
│  crypto/    ：密钥派生、AEAD 加解密、安全随机、内存清零      │
│  vault/     ：条目/分类/预设值领域模型与业务规则             │
│  db/        ：SQLite 连接、迁移、仓储（repository）          │
│  backup/    ：备份导出/导入、文件拷贝校验                    │
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
│   │   ├── ui/               # shadcn-vue 拷贝进来的基础组件
│   │   ├── layout/          # Sidebar、TopBar、EntryList、EntryCard
│   │   └── notes/            # Markdown 编辑/预览/弹窗
│   ├── composables/          # useClipboard、useI18n、useGenerator…
│   ├── lib/                  # IPC 封装、类型、工具
│   ├── locales/              # zh-CN.json、en.json
│   └── types/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   └── src/
│       ├── main.rs
│       ├── error.rs
│       ├── commands/         # vault.rs、category.rs、entry.rs、preset.rs、generator.rs、backup.rs、sync.rs
│       ├── crypto/
│       ├── vault/
│       ├── db/
│       ├── backup/
│       └── sync/
└── .gitignore
```

## 3. IPC 命令约定（阶段 2 起逐步实现）

命名：`<domain>_<action>`，入参/出参均为 serde 结构体；统一错误类型 `MendError`，前端映射为可提示的消息。

| 命令 | 入参 | 出参 | 说明 |
| --- | --- | --- | --- |
| `vault_setup` | `{ master_password }` | `{ ok }` | 首次启动创建库、派生并包裹 DEK |
| `vault_unlock` | `{ master_password }` | `{ unlocked: bool }` | 校验密钥、装载会话 DEK 到内存 |
| `vault_lock` | — | `{ ok }` | 销毁会话密钥、清空敏感内存 |
| `vault_status` | — | `{ initialized, unlocked }` | 启动时判断走解锁页还是主界面 |
| `category_list` | — | `Vec<Category>` | 分类列表（含条目数，可由后端聚合） |
| `category_create/update/delete` | 结构体 | `Category` | 删除时条目移入"未分类" |
| `entry_list` | `{ category_id?, keyword? }` | `Vec<EntryView>` | 解锁态返回解密后的展示模型 |
| `entry_get` | `{ id }` | `EntryView` | 单条详情（弹窗编辑时取） |
| `entry_create/update/delete` | `EntryInput` | `EntryView` | 敏感字段后端加密后落库 |
| `preset_list` | `{ field_type }` | `Vec<Preset>` | 账号/邮箱/手机号预设值 |
| `preset_create/update/delete` | 结构体 | `Preset` |
| `generator_generate` | `GeneratorOptions` | `{ password }` | 纯本地 CSPRNG，不入库 |
| `backup_export` | `{ target_path }` | `{ path }` | 导出加密备份文件 |
| `backup_import` | `{ source_path, master_password? }` | `{ ok, count }` | 校验后恢复 |
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
