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
| color | TEXT | 标签色标识（可选） |
| icon | TEXT | 图标标识（可选） |
| sort_order | INTEGER | 排序 |
| created_at | INTEGER | 时间戳（ms） |
| updated_at | INTEGER | |

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
| created_at | INTEGER | 明文 | |
| updated_at | INTEGER | 明文 | |
| deleted_at | INTEGER | 明文 | 软删除时间戳，空 = 未删除（已启用：删除进回收站，可恢复/彻底清除） |

> 说明：标题/分类/时间等明文元信息仅用于列表渲染与筛选；任何身份敏感字段（账号、密码、邮箱、手机号、备注）一律密文。

### 2.4 `presets` — 字段预设值

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| field_type | TEXT | `username` / `email` / `phone`（密码不做预设，走生成器） |
| label | TEXT | 下拉显示名，如"工作邮箱" |
| value_enc | TEXT | 密文存储预设值 |
| sort_order | INTEGER | |
| created_at | INTEGER | |

## 3. 关键业务规则

- **首次启动**：生成随机 DEK；用主密码经 Argon2id 派生 KEK，包裹 DEK 落 `meta`；写 schema 版本与默认偏好。
- **解锁**：读取 salt 与 KDF 参数 → 派生 KEK → 解包 DEK；认证失败即主密码错误。解锁后 DEK 存内存会话，命令层据此加解密。
- **新增/编辑条目**：前端提交明文 `EntryInput` → Rust 侧逐字段加密 → 事务写入；返回解密后的展示模型供界面刷新。
- **删除**：`entry_delete` 只写 `deleted_at`（软删除，进回收站）；`entry_restore` 清空该列；`entry_purge` / `entry_purge_all` 才做物理删除，且仅允许删除回收站里的条目。分类删除仍走"条目归未分类"。
- **分类删除**：其下条目 `category_id` 置空（未分类），不级联删条目。
- **迁移**：schema 版本号存 `meta`，启动时按版本顺序执行迁移；每个迁移可重入。

## 4. 安全边界（明确承认）

- 主密码丢失 → DEK 无法解包 → 数据不可恢复，属有意设计。
- 解锁态下，明文短暂存在于 WebView 内存与 Rust 会话；本机高权限恶意程序的内存 Dump 不在防护范围内。
- 剪贴板复制行为后续可加超时自动清空；MVP 先保证一键复制，超时清理列入路线。
- 日志、报错、备份文件名中不得出现密码/备注/密钥明文。

## 5. 待校准参数（实现时确定并记录到本地 `local/DEVLOG.md`）

- Argon2id 的 memory / iterations / parallelism（在解锁流畅度与抗暴力破解间取平衡）。
- 字段加密是否对 `url` 也加密。
- 是否在 `entries` 增加 `tags` 多标签字段，MVP 暂不做。
