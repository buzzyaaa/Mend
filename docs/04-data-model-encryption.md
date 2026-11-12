# 04 · 数据模型与加密方案

## 1. 加密总体思路

采用 **应用层字段加密**：SQLite 存结构化行，敏感字段以密文形式落库；非敏感的索引/分类元信息可明文存储以支持列表与筛选。

```
主密码（从不落盘）
   │  Argon2id 派生（salt 存 meta 表）
   ▼
KEK（密钥加密密钥，仅内存）
   │  加密包裹 DEK（数据加密密钥，256-bit 随机生成）
   ▼
master_key.enc（落库：KEK 包裹后的 DEK）
   │  DEK 仅在解锁后驻留内存
   ▼
每条敏感字段：XChaCha20-Poly1305（独立 nonce + AAD 绑定条目 id）
   ▼
SQLite 密文列
```

### 1.1 算法选型

| 用途 | 算法 | 备注 |
| --- | --- | --- |
| 密钥派生 | Argon2id | 参数（memory/time/parallelism）首次生成时写入 meta，按 OWASP 指引取可在本机流畅解锁的强度；参数可后续升级 |
| 对称加密 | XChaCha20-Poly1305 | 大 nonce，免单独管理 nonce 复用；认证标签防篡改 |
| 随机数 | OsRng（CSPRNG） | DEK、nonce、生成器密码均来自 CSPRNG |
| 密钥包裹 | XChaCha20-Poly1305 加密 DEK | 解包时校验认证标签，主密码错误即解密失败 |
| 内存安全 | `zeroize` | DEK/派生密钥/明文缓冲区在 Drop 时清零；锁定即销毁会话密钥 |

> 备选：若后续希望整库透明加密，可评估 SQLCipher；MVP 不引入，避免额外原生依赖与构建复杂度。

### 1.2 单字段密文格式

```
base64( nonce[24B] || ciphertext || tag[16B] )
```

- 每条记录、每个敏感字段独立随机 nonce；相同明文在不同条目下密文不同。
- AAD 绑定条目 `id`（或字段类型），防止密文在条目间被搬运替换。
- 解密失败（篡改/密钥错误）返回认证错误，不回退到明文。

## 2. SQLite 表结构（初始迁移 v1）

### 2.1 `meta` — 库元信息与非敏感设置

| 列 | 类型 | 说明 |
| --- | --- | --- |
| key | TEXT PK | 如 `kdf_params`、`dek_wrapped`、`salt`、`language`、`theme`、`version` |
| value | TEXT | 非敏感配置明文；`dek_wrapped` 为密文 |

存放：KDF 参数、Argon2 salt、包裹后的 DEK、界面偏好（语言/主题/生成器默认项）、schema 版本。

### 2.2 `categories` — 分类

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK (uuid) | |
| name | TEXT | 分类名（自用场景可明文，便于侧栏显示） |
| color | TEXT | 标签色标识（可选，`#RRGGBB`，大小写不敏感，统一存大写；空 = 无背景） |
| icon | TEXT | 图标标识（可选，Material 图标名，上限 64 字；空 = 前端回退默认文件夹） |
| sort_order | INTEGER | 排序 |
| created_at | INTEGER | 时间戳（ms） |
| updated_at | INTEGER | |

> `color` / `icon` 由命令层校验（`validate_category_color` / `validate_category_icon`）后写入：颜色仅接受 `#RRGGBB`，图标名上限 64 字。图标名到组件的解析由前端 `@vicons/material` 显式注册表负责，未命中或空值回退默认文件夹图标；列表与侧栏以 10% 透明度填充 `color` 作为分类底色。

### 2.3 `entries` — 密码条目

| 列 | 类型 | 落盘形态 | 说明 |
| --- | --- | --- | --- |
| id | TEXT PK (uuid) | 明文 | |
| category_id | TEXT FK | 明文 | 可空 = 未分类 |
| title | TEXT | 明文 | 条目标题（列表展示，便于检索） |
| url | TEXT | 明文/可选加密 | 网址；MVP 可明文，后续按需加密 |
| username_enc | TEXT | 密文 | 账号 |
| password_enc | TEXT | 密文 | 密码 |
| email_enc | TEXT | 密文 | 邮箱 |
| phone_enc | TEXT | 密文 | 手机号 |
| notes_enc | TEXT | 密文 | Markdown 备注全文 |
| favorite | INTEGER | 明文 | 收藏标记 0/1 |
| tags | TEXT | 明文 | JSON 数组的标签名列表（如 `["工作","金融"]`），语义与分类名同级：自用场景可明文 |
| sort_order | INTEGER | 明文 | 手动排序号（迁移 v3 新增，默认 0）：同桶内升序；0 = 未手动排序，「手动排序」模式下按 `updated_at` 倒序兜底 |
| created_at | INTEGER | 明文 | |
| updated_at | INTEGER | 明文 | |
| deleted_at | INTEGER | 明文 | 软删除时间戳，空 = 未删除（已启用：删除进回收站，可恢复/彻底清除） |
| archived | INTEGER | 明文 | 归档标记（迁移 v4 新增，默认 0）：`1` = 已归档；归档是软状态，**与 `deleted_at` 正交**——归档条目不出现在主列表、不进入回收站，可通过「取消归档」恢复（见 §3） |

> 说明：标题/分类/时间等明文元信息仅用于列表渲染与筛选；任何身份敏感字段（账号、密码、邮箱、手机号、备注）一律密文。

> 手动排序：`sort_order` 是条目在所属桶（分类 / 未分类 / 全部）内的显示顺序，由「手动排序」模式拖拽后经 `entry_reorder` 整批写回（`0..n-1`，单事务，**按 `category_id` 分桶**，见 §3）；新建条目取同桶 `MAX(sort_order)+1` 落在末尾。`EntryView` 返回该列，前端 `refresh()` 时据此重建各桶顺序，使拖拽结果跨刷新 / 重启仍然生效（`src/lib/manualOrder.ts`）。

> 归档：`archived` 是条目在「归档桶」内的软状态，与 `deleted_at` 完全正交——`archived = 1` 的条目不出现在 `entry_list`（只出现在 `entry_archive_list`），也不可删除（不会进入回收站）；取消归档后回到主列表。前端通过 `entry.archive` / `entry.unarchive` 切换，均需二次确认。归档条目固定按 `updated_at` 倒序展示，星标置顶逻辑不生效。

### 2.4 `presets` — 字段预设值

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| field_type | TEXT | `username` / `email` / `phone` / `password`（密码预设即"常用密码"候选） |
| label | TEXT | 下拉显示名，如"工作邮箱" |
| value_enc | TEXT | 密文存储预设值 |
| sort_order | INTEGER | |
| created_at | INTEGER | |

## 3. 关键业务规则

- **首次启动**：生成随机 DEK；用主密码经 Argon2id 派生 KEK，包裹 DEK 落 `meta`；写 schema 版本与默认偏好。
- **解锁**：读取 salt 与 KDF 参数 → 派生 KEK → 解包 DEK；认证失败即主密码错误。解锁后 DEK 存内存会话，命令层据此加解密。
- **新增/编辑条目**：前端提交明文 `EntryInput` → Rust 侧逐字段加密 → 事务写入；返回解密后的展示模型供界面刷新。
- **删除**：`entry_delete` 只写 `deleted_at`（软删除，进回收站）；`entry_restore` 清空该列；`entry_purge` / `entry_purge_all` 才做物理删除，且仅允许删除回收站里的条目。分类删除仍走"条目归未分类"。
- **归档**：`entry_archive` 把 `archived` 置 1（软状态，与 `deleted_at` 正交），条目从主列表移入归档桶；归档条目不可删除（`delete_entry` 带 `archived = 0` 守卫），也不会进入回收站；`entry_unarchive` 把 `archived` 置 0 恢复。归档列表按 `updated_at` 倒序，前端星标置顶逻辑对归档桶不生效。
- **标签**：条目可挂多个标签，存 `entries.tags`（JSON 数组，明文）；标签由前端在内存中过滤（与备注检索同口径）。写入时 trim、去空、去重，上限 16 个、单个最长 32 字。
- **手动排序**：条目按所属桶维护 `entries.sort_order`（同桶 `0..n-1`）。前端「手动排序」模式拖拽结束后调 `entry_reorder` 整批写回（单事务原子，**按 `category_id` 分组**：只重排传入的可见条目所占的位置，未传入的同桶条目留在原位，随后整桶紧凑赋 `0..n-1`，避免跨分类互相覆盖或出现重复 / 空洞）；新建条目取同桶 `MAX(sort_order)+1` 落在末尾。`EntryView` 返回 `sortOrder`，前端 `refresh()` 时据此重建各桶手动序（`src/lib/manualOrder.ts`），拖拽顺序因此跨刷新 / 重启保留。排序下拉另有最近更新 / 名称 / 星标优先，均不落库。`sort_order` 为明文元信息，不含敏感数据。
- **修改主密码**：校验旧密码（派生旧 KEK 解包 DEK，认证失败即旧密码错误）→ 生成新 salt、派生新 KEK → 用新 KEK 重新包裹**同一个 DEK** → 在一个事务内更新 `meta` 的 `salt`/`kdf_params`/`dek_wrapped`。DEK 不变，历史密文无需重加密；事务保证中途崩溃不会出现"salt 与包裹密钥不一致"的坏库。
- **分类删除**：其下条目 `category_id` 置空（未分类），不级联删条目。
- **迁移**：schema 版本号存 `meta`，启动时按版本顺序执行迁移（当前 `SCHEMA_VERSION = 4`）；**整个迁移过程（建表 → 逐版本升级 → 写版本号）在单个事务内执行**（`unchecked_transaction` + 末尾 commit），中途崩溃不会留下"列已加、版本未升"的半迁移坏库。每个迁移可重入：建表语句幂等，v2 加 `tags`、v3 加 `sort_order`、v4 加 `archived` 前都先探测目标列是否已存在，历史遗留的半迁移状态也能安全补齐版本号。

## 4. 安全边界（明确承认）

- 主密码丢失 → DEK 无法解包 → 数据不可恢复，属有意设计。
- 解锁态下，明文短暂存在于 WebView 内存与 Rust 会话；本机高权限恶意程序的内存 Dump 不在防护范围内。
- 剪贴板只做写入：复制后不读取、不自动清空（曾计划超时清空，实测桌面 WebView 下静默失败且属于对用户剪贴板的干预，已决定移除，见 `05` §2.2）。
- 日志、报错、备份文件名中不得出现密码/备注/密钥明文。

## 5. 待校准参数（实现时确定并记录到本地 `local/DEVLOG.md`）

- Argon2id 的 memory / iterations / parallelism（在解锁流畅度与抗暴力破解间取平衡）。
- 字段加密是否对 `url` 也加密。

> `entries.tags` 已于迁移 v2 落地；`entries.sort_order` 已于迁移 v3 落地；`entries.archived` 已于迁移 v4 落地（见 §2.3、§3）。
