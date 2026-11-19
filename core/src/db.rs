//! SQLite 连接、schema 迁移 v1 与仓储函数。
//!
//! 表结构与字段落盘形态见 `docs/04-data-model-encryption.md` §2：
//! 标题/分类/时间等元信息明文，账号/密码/邮箱/手机号/备注一律存密文列。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{params, OptionalExtension, Transaction, TransactionBehavior};

/// 向外暴露连接类型，避免上层再单独依赖 rusqlite。
pub use rusqlite::Connection;

use crate::error::{MendError, MendResult};
use crate::tags;

pub const SCHEMA_VERSION: i64 = 6;
pub const DB_FILE_NAME: &str = "mend.db";

/// SQLite 忙等待上限。必须在 `Connection::open` 之后、任何读写之前设置：
/// open / pragma journal_mode / migrate 阶段如果库文件正被其他进程短暂持有
/// （第二个应用实例、杀毒扫描、备份工具等），没有忙等待会立刻以 SQLite
/// busy/locked 失败 → MendError::Db → 启动 Fatal「数据读写失败」。
///
/// 注意：忙回调只覆盖「直接申请锁」的路径。事务内**先读后写**时，SQLite 为了
/// 避免死锁会在读锁升级写锁处直接返回 SQLITE_BUSY、不调用忙回调。所以写事务
/// （如 `migrate`）必须用 `BEGIN IMMEDIATE` 先拿写锁，见下方 `migrate`。
pub const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT,
    icon       TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
    id           TEXT PRIMARY KEY,
    category_id  TEXT REFERENCES categories(id) ON DELETE SET NULL,
    title        TEXT NOT NULL,
    url          TEXT,
    username_enc TEXT NOT NULL,
    password_enc TEXT NOT NULL,
    email_enc    TEXT NOT NULL,
    phone_enc    TEXT NOT NULL,
    notes_enc    TEXT NOT NULL,
    favorite     INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER
);

CREATE TABLE IF NOT EXISTS presets (
    id         TEXT PRIMARY KEY,
    field_type TEXT NOT NULL,
    label      TEXT NOT NULL,
    value_enc  TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entries_category ON entries(category_id);
CREATE INDEX IF NOT EXISTS idx_entries_deleted ON entries(deleted_at);
"#;

/// v1 → v2：条目多标签（JSON 数组，明文，见 docs/04 §2.3）。
const MIGRATION_V2: &str = "ALTER TABLE entries ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';";

/// v2 → v3：条目手动排序号。默认 0 表示「未手动排序」，前端手动排序模式下
/// 按 `sort_order` 升序；0 值条目回退到 `updated_at` 倒序（见 docs/04 §2.3 / §3）。
const MIGRATION_V3: &str = "ALTER TABLE entries ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;";

/// v3 → v4：条目归档标记（软状态，与 `deleted_at` 正交）。
/// `archived = 1` 的条目不出现在主列表、也不进回收站，可通过「取消归档」恢复；
/// 归档不写 `archived_at`，归档列表按 `updated_at` 倒序展示（见 docs/04 §2.3 / §3）。
const MIGRATION_V4: &str = "ALTER TABLE entries ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;";

/// v4 → v5：站点图标缓存（条目列表行首的小图标）。
///
/// 图标本身是从条目自己的站点抓回来的公开图片，不是密钥材料；但「这台机器
/// 上有哪些站点账号」本身就敏感，所以缓存必须跟库文件同处一地、随库一起拷
/// 走，而不是散在数据目录里的一组明文图片文件。`mime`/`bytes` 为空的行表示
/// 「抓过、没抓到」，`fail_count` 记连续失败次数，用来退避重试（见 docs/04）。
const MIGRATION_V5: &str = r#"
CREATE TABLE IF NOT EXISTS site_icons (
    host       TEXT PRIMARY KEY,
    mime       TEXT,
    bytes      BLOB,
    fetched_at INTEGER NOT NULL,
    fail_count INTEGER NOT NULL DEFAULT 0
);
"#;

/// v5 → v6：标签定义表（名称 + 颜色）。
///
/// 标签从「条目上的自由文本」升级为库内独立维护的实体：条目仍只存标签名
/// （`entries.tags` JSON），名称→颜色的映射集中在这张表。迁移时把旧库里
/// 出现过的标签名回填成定义（按首次出现顺序取默认色板），条目侧的旧名字
/// （含 `#` 前缀、大小写变体）同步归一，保证升级后所有标签都能在维护弹窗里
/// 看到、也都能在条目里选中。名称唯一索引不区分大小写，避免 `work` / `Work`
/// 两个几乎一样的标签同时存在。
const MIGRATION_V6: &str = r#"
CREATE TABLE IF NOT EXISTS tag_defs (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_defs_name ON tag_defs(name COLLATE NOCASE);
"#;

pub fn db_file_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(DB_FILE_NAME)
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn db_err(err: rusqlite::Error) -> MendError {
    MendError::Db(err.to_string())
}

/// 打开（必要时创建）数据库文件，并保证 schema 已迁移到最新版本。
pub fn open_and_migrate(path: &Path) -> MendResult<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| MendError::Db(format!("创建数据目录失败: {err}")))?;
    }
    let conn = Connection::open(path).map_err(db_err)?;
    // 忙等待必须先于一切读写：pragma journal_mode 与 migrate（建表 / 写
    // schema_version）都可能撞上别的连接持有的写锁，见 BUSY_TIMEOUT 文档。
    conn.busy_timeout(BUSY_TIMEOUT).map_err(db_err)?;
    // 单文件库：不用 WAL，便于整库拷贝备份（见 docs/06）
    conn.pragma_update(None, "journal_mode", "DELETE")
        .map_err(db_err)?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(db_err)?;
    migrate(&conn)?;
    Ok(conn)
}

/// 在**单个事务**内完成建表 → v2 迁移 → v3 迁移 → v4 迁移 → 版本号写入：中途崩溃/掉电不会留下
/// "列已加、版本未升"的半迁移状态（旧实现三段分开执行，坏库会导致下次启动永久失败）。
/// 可重入：`CREATE TABLE IF NOT EXISTS` 幂等；各版本迁移前先探测目标列是否已存在，
/// 即使历史版本崩溃留下了"列存在但版本未升"的库，也能安全补齐版本号。
///
/// 用 `BEGIN IMMEDIATE`（而非默认的 DEFERRED）：迁移整体是写事务，先拿写锁能让
/// `BUSY_TIMEOUT` 真正作用于 BEGIN。DEFERRED 事务里先 `meta_get` 读、再 `meta_set`
/// 写，若此刻别的进程持有写锁，SQLite 在"读→写升级"处会**绕过忙回调**直接返回
/// SQLITE_BUSY（防死锁），忙等待形同虚设——这正是启动 Fatal 的另一半根因。
pub fn migrate(conn: &Connection) -> MendResult<()> {
    // unchecked_transaction 的语义（借用 &Connection 开启事务），只是换成 IMMEDIATE
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate).map_err(db_err)?;
    tx.execute_batch(SCHEMA_V1).map_err(db_err)?;
    let current: i64 = meta_get(&tx, "schema_version")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    if current < 2 && !column_exists(&tx, "entries", "tags")? {
        tx.execute_batch(MIGRATION_V2).map_err(db_err)?;
    }
    if current < 3 && !column_exists(&tx, "entries", "sort_order")? {
        tx.execute_batch(MIGRATION_V3).map_err(db_err)?;
    }
    if current < 4 && !column_exists(&tx, "entries", "archived")? {
        tx.execute_batch(MIGRATION_V4).map_err(db_err)?;
    }
    // v5 只有一张新建的表：`CREATE TABLE IF NOT EXISTS` 幂等，半迁移状态也能补上。
    if current < 5 {
        tx.execute_batch(MIGRATION_V5).map_err(db_err)?;
    }
    // v6：建标签定义表，并把旧条目里的标签名回填成定义（幂等，可重入）。
    if current < 6 {
        tx.execute_batch(MIGRATION_V6).map_err(db_err)?;
        backfill_tag_defs(&tx)?;
    }
    meta_set(&tx, "schema_version", &SCHEMA_VERSION.to_string())?;
    tx.commit().map_err(db_err)?;
    Ok(())
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> MendResult<bool> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
            params![table, column],
            |row| row.get(0),
        )
        .map_err(db_err)?;
    Ok(count > 0)
}

/// v6 迁移：把 `entries.tags` 里出现过的旧标签名变成 `tag_defs` 行，
/// 并把条目侧的写法归一（去 `#`、大小写统一为首次出现的拼写、去重）。
///
/// 只处理「表为空 / 版本未升」的库：名称唯一索引 + `INSERT OR IGNORE` 让重复
/// 回填变成空操作，因此半迁移状态重跑也安全。
fn backfill_tag_defs(tx: &Transaction<'_>) -> MendResult<()> {
    let rows: Vec<(String, String)> = {
        let mut stmt = tx
            .prepare("SELECT id, tags FROM entries")
            .map_err(db_err)?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(db_err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db_err)?;
        rows
    };

    let ts = now_ms();
    let mut canonical: Vec<String> = Vec::new();
    let mut by_key: HashMap<String, String> = HashMap::new();
    let mut rewritten: Vec<(String, Vec<String>)> = Vec::new();

    // 半迁移重入时以已有定义为准：条目侧统一到已存的拼写，不另造第二套大小写。
    {
        let mut stmt = tx
            .prepare("SELECT name FROM tag_defs ORDER BY sort_order, id")
            .map_err(db_err)?;
        let names = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(db_err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db_err)?;
        for name in names {
            let key = name.to_lowercase();
            if by_key.contains_key(&key) {
                continue;
            }
            by_key.insert(key, name.clone());
            canonical.push(name);
        }
    }

    for (id, raw) in rows {
        let old_tags = tags_from_json(&raw)?;
        let mut next: Vec<String> = Vec::new();
        let mut seen: Vec<String> = Vec::new();
        for raw_tag in &old_tags {
            let Some(name) = tags::normalize_legacy_name(raw_tag) else {
                continue;
            };
            let key = name.to_lowercase();
            if seen.iter().any(|item| item == &key) {
                continue;
            }
            let chosen = match by_key.get(&key) {
                Some(existing) => existing.clone(),
                None => {
                    by_key.insert(key.clone(), name.clone());
                    canonical.push(name.clone());
                    name
                }
            };
            seen.push(key);
            next.push(chosen);
        }
        if next != old_tags {
            rewritten.push((id, next));
        }
    }

    for (index, name) in canonical.iter().enumerate() {
        tx.execute(
            "INSERT OR IGNORE INTO tag_defs(id, name, color, sort_order, created_at, updated_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?5)",
            params![
                format!("tag-{ts}-{index}"),
                name,
                tags::default_color(index),
                index as i64,
                ts
            ],
        )
        .map_err(db_err)?;
    }

    for (id, next) in rewritten {
        tx.execute(
            "UPDATE entries SET tags = ?2 WHERE id = ?1",
            params![id, tags_to_json(&next)?],
        )
        .map_err(db_err)?;
    }
    Ok(())
}

// ---------- meta ----------

pub fn meta_get(conn: &Connection, key: &str) -> MendResult<Option<String>> {
    conn.query_row(
        "SELECT value FROM meta WHERE key = ?1",
        params![key],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(db_err)
}

pub fn meta_set(conn: &Connection, key: &str, value: &str) -> MendResult<()> {
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(db_err)?;
    Ok(())
}

pub fn is_initialized(conn: &Connection) -> MendResult<bool> {
    Ok(meta_get(conn, "dek_wrapped")?.is_some())
}

// ---------- categories ----------

#[derive(Debug, Clone)]
pub struct CategoryRow {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub sort_order: i64,
    pub entry_count: i64,
}

pub fn list_categories(conn: &Connection) -> MendResult<Vec<CategoryRow>> {
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.name, c.color, c.icon, c.sort_order,
                    (SELECT COUNT(*) FROM entries e
                      WHERE e.category_id = c.id AND e.deleted_at IS NULL AND e.archived = 0) AS entry_count
               FROM categories c
              ORDER BY c.sort_order ASC, c.created_at ASC",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(CategoryRow {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                icon: row.get(3)?,
                sort_order: row.get(4)?,
                entry_count: row.get(5)?,
            })
        })
        .map_err(db_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_err)?;
    Ok(rows)
}

pub fn create_category(
    conn: &Connection,
    id: &str,
    name: &str,
    color: Option<&str>,
    icon: Option<&str>,
) -> MendResult<()> {
    let ts = now_ms();
    let next_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories",
            [],
            |row| row.get(0),
        )
        .map_err(db_err)?;
    conn.execute(
        "INSERT INTO categories(id, name, color, icon, sort_order, created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, name, color, icon, next_order, ts],
    )
    .map_err(db_err)?;
    Ok(())
}

pub fn rename_category(
    conn: &Connection,
    id: &str,
    name: &str,
    color: Option<&str>,
    icon: Option<&str>,
) -> MendResult<()> {
    let changed = conn
        .execute(
            "UPDATE categories SET name = ?2, color = ?3, icon = ?4, updated_at = ?5
             WHERE id = ?1",
            params![id, name, color, icon, now_ms()],
        )
        .map_err(db_err)?;
    if changed == 0 {
        return Err(MendError::NotFound(format!("分类 {id}")));
    }
    Ok(())
}

/// 分类颜色校验：仅接受 `#RRGGBB`（大小写不敏感），统一存大写；空值表示无色。
/// 实现等价于正则 `^#[0-9A-Fa-f]{6}$`，不引入 regex 依赖（等价手写判定）。
pub fn validate_category_color(color: &Option<String>) -> MendResult<Option<String>> {
    match color.as_deref().map(str::trim) {
        None | Some("") => Ok(None),
        Some(value) => {
            let body = value.strip_prefix('#').unwrap_or("");
            if value.len() == 7 && body.len() == 6 && body.chars().all(|c| c.is_ascii_hexdigit()) {
                Ok(Some(value.to_ascii_uppercase()))
            } else {
                Err(MendError::Vault("分类颜色格式应为 #RRGGBB".into()))
            }
        }
    }
}

/// 分类图标校验：存图标名字符串，上限 64 字；空值表示无图标（前端回退默认文件夹）。
pub fn validate_category_icon(icon: &Option<String>) -> MendResult<Option<String>> {
    match icon.as_deref().map(str::trim) {
        None | Some("") => Ok(None),
        Some(value) => {
            if value.chars().count() > 64 {
                return Err(MendError::Vault("分类图标名过长（上限 64 字）".into()));
            }
            Ok(Some(value.to_string()))
        }
    }
}

/// 删除分类：其下条目归入"未分类"（category_id 置空），不级联删除条目。
pub fn delete_category(conn: &Connection, id: &str) -> MendResult<()> {
    let tx = conn.unchecked_transaction().map_err(db_err)?;
    tx.execute(
        "UPDATE entries SET category_id = NULL WHERE category_id = ?1",
        params![id],
    )
    .map_err(db_err)?;
    let changed = tx
        .execute("DELETE FROM categories WHERE id = ?1", params![id])
        .map_err(db_err)?;
    tx.commit().map_err(db_err)?;
    if changed == 0 {
        return Err(MendError::NotFound(format!("分类 {id}")));
    }
    Ok(())
}

/// 按 UI 提交的顺序重排全部分类：只写 `sort_order`，名称/颜色/图标原样不动。
/// `ids` 是完整有序列表，逐条赋 `0..n-1`；不存在的 id 静默跳过、不占号。
/// 显式 `BEGIN IMMEDIATE` 先拿写锁，避免事务内读→写升级触发 SQLITE_BUSY。
pub fn reorder_categories(conn: &Connection, ids: &[String]) -> MendResult<()> {
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate).map_err(db_err)?;
    let mut order = 0i64;
    for id in ids {
        let changed = tx
            .execute(
                "UPDATE categories SET sort_order = ?2 WHERE id = ?1",
                params![id, order],
            )
            .map_err(db_err)?;
        if changed > 0 {
            order += 1;
        }
    }
    tx.commit().map_err(db_err)?;
    Ok(())
}

// ---------- entries ----------

/// 落盘形态的条目：敏感字段均为密文。
#[derive(Debug, Clone)]
pub struct EntryRowEnc {
    pub id: String,
    pub category_id: Option<String>,
    pub title: String,
    pub url: Option<String>,
    pub username_enc: String,
    pub password_enc: String,
    pub email_enc: String,
    pub phone_enc: String,
    pub notes_enc: String,
    pub favorite: bool,
    /// 明文标签列表（JSON 落 `tags` 列，语义同分类名，见 docs/04 §2.3）。
    pub tags: Vec<String>,
    /// 手动排序号：同桶内升序，0 = 未手动排序（手动排序模式下回退 updated_at）。
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
    /// 回收站时间戳：`None` = 正常条目，`Some(ms)` = 已软删除。
    pub deleted_at: Option<i64>,
    /// 归档标记（迁移 v4 新增）：`true` = 已归档，不出现在主列表、也不进回收站。
    pub archived: bool,
}

pub fn insert_entry(conn: &Connection, row: &EntryRowEnc) -> MendResult<()> {
    let tags_json = tags_to_json(&row.tags)?;
    conn.execute(
        "INSERT INTO entries(id, category_id, title, url,
                             username_enc, password_enc, email_enc, phone_enc, notes_enc,
                             favorite, tags, sort_order, archived, created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            row.id,
            row.category_id,
            row.title,
            row.url,
            row.username_enc,
            row.password_enc,
            row.email_enc,
            row.phone_enc,
            row.notes_enc,
            row.favorite as i64,
            tags_json,
            row.sort_order,
            row.archived as i64,
            row.created_at,
            row.updated_at,
        ],
    )
    .map_err(db_err)?;
    Ok(())
}

pub fn update_entry(conn: &Connection, row: &EntryRowEnc) -> MendResult<()> {
    let tags_json = tags_to_json(&row.tags)?;
    let changed = conn
        .execute(
            "UPDATE entries
                SET category_id = ?2, title = ?3, url = ?4,
                    username_enc = ?5, password_enc = ?6, email_enc = ?7,
                    phone_enc = ?8, notes_enc = ?9, favorite = ?10, tags = ?11, updated_at = ?12
              WHERE id = ?1 AND deleted_at IS NULL",
            params![
                row.id,
                row.category_id,
                row.title,
                row.url,
                row.username_enc,
                row.password_enc,
                row.email_enc,
                row.phone_enc,
                row.notes_enc,
                row.favorite as i64,
                tags_json,
                row.updated_at,
            ],
        )
        .map_err(db_err)?;
    if changed == 0 {
        return Err(MendError::NotFound(format!("条目 {}", row.id)));
    }
    Ok(())
}

/// 同桶内下一个手动排序号（分类桶按 `category_id`，`None` 桶为未分类）。
/// 新建条目取该桶 `MAX(sort_order) + 1`，保证插入后落在手动序末尾。
pub fn next_entry_sort_order(conn: &Connection, category_id: Option<&str>) -> MendResult<i64> {
    let max: Option<i64> = conn
        .query_row(
            "SELECT MAX(sort_order) FROM entries
              WHERE category_id IS ?1 AND deleted_at IS NULL AND archived = 0",
            params![category_id],
            |row| row.get(0),
        )
        .map_err(db_err)?;
    Ok(max.unwrap_or(0) + 1)
}

/// 批量写入手动排序号：整批在单个事务内完成。
///
/// 排序号只在条目所属桶（分类 / 未分类）内有意义，因此这里**按 `category_id` 分组**，
/// 每个桶独立赋 `0..n-1`：既避免「全部」桶拖拽时把多个分类串成一条全局序列，
/// 也避免分类 A 重排时覆盖分类 B 的排序号（`next_entry_sort_order` 同样按分类取
/// `MAX+1`，两者口径一致）。
///
/// 前端传入的是当前视图里**可见**的条目 id（可能被关键字 / 标签筛选成子集）。
/// 对每个桶先取该桶全部条目按现有 `sort_order` 排序，再把可见条目按给定顺序填回
/// 它们原来占据的位置，未可见条目留在原位——既尊重可见拖拽结果，又保证同桶内
/// 排序号仍是完整且不重复的 `0..n-1`（不会出现重复 / 空洞）。
///
/// 只更新未删除未归档条目；不存在的 id 静默跳过；空数组为合法空操作。
pub fn reorder_entries(conn: &Connection, ids: &[String]) -> MendResult<()> {
    // 事务内先按 id 读 category_id、再写 sort_order：与 migrate 同理，DEFERRED 会在
    // 「读锁升级写锁」处绕过忙回调直接返回 SQLITE_BUSY，故显式用 BEGIN IMMEDIATE。
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate).map_err(db_err)?;

    // 1) 按 category_id 分组，保持传入顺序。
    let mut groups: Vec<(Option<String>, Vec<String>)> = Vec::new();
    for id in ids {
        let category_id: Option<String> = tx
            .query_row(
                "SELECT category_id FROM entries
                   WHERE id = ?1 AND deleted_at IS NULL AND archived = 0",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_err)?;
        let Some(category_id) = category_id else {
            continue;
        };
        let key = Some(category_id.clone());
        match groups.iter_mut().find(|(existing, _)| *existing == key) {
            Some((_, list)) => list.push(id.clone()),
            None => groups.push((key, vec![id.clone()])),
        }
    }

    // 2) 每个桶：可见条目按给定顺序填回原位，未可见条目留在原位，整体赋 0..n-1。
    for (category_id, provided) in groups {
        let full: Vec<String> = {
            let mut stmt = tx
                .prepare(
                    "SELECT id FROM entries
                       WHERE category_id IS ?1 AND deleted_at IS NULL AND archived = 0
                       ORDER BY sort_order ASC, updated_at ASC, id ASC",
                )
                .map_err(db_err)?;
            let rows = stmt
                .query_map(params![category_id], |row| row.get::<_, String>(0))
                .map_err(db_err)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(db_err)?
        };

        let provided_set: std::collections::HashSet<&str> =
            provided.iter().map(|id| id.as_str()).collect();
        // 可见条目当前占据的下标，按现有顺序。
        let slots: Vec<usize> = full
            .iter()
            .enumerate()
            .filter(|(_, id)| provided_set.contains(id.as_str()))
            .map(|(index, _)| index)
            .collect();

        let mut new_order = full.clone();
        let mut placed = vec![false; provided.len()];
        for (position, slot) in slots.iter().enumerate() {
            if position < provided.len() {
                new_order[*slot] = provided[position].clone();
                placed[position] = true;
            }
        }
        // 传入集合里若出现该桶当前不存在的 id（正常不会），追加到末尾。
        for (index, id) in provided.iter().enumerate() {
            if !placed[index] {
                new_order.push(id.clone());
            }
        }

        for (index, id) in new_order.iter().enumerate() {
            tx.execute(
                "UPDATE entries SET sort_order = ?2
                   WHERE id = ?1 AND deleted_at IS NULL AND archived = 0",
                params![id, index as i64],
            )
            .map_err(db_err)?;
        }
    }

    tx.commit().map_err(db_err)?;
    Ok(())
}

fn tags_to_json(tags: &[String]) -> MendResult<String> {
    serde_json::to_string(tags).map_err(|err| MendError::Db(format!("标签序列化失败: {err}")))
}

fn tags_from_json(raw: &str) -> MendResult<Vec<String>> {
    serde_json::from_str(raw).map_err(|err| MendError::Db(format!("标签数据损坏: {err}")))
}

pub fn get_entry(conn: &Connection, id: &str) -> MendResult<Option<EntryRowEnc>> {
    conn.query_row(
        "SELECT id, category_id, title, url, username_enc, password_enc, email_enc,
                phone_enc, notes_enc, favorite, tags, created_at, updated_at, deleted_at,
                sort_order, archived
           FROM entries WHERE id = ?1 AND deleted_at IS NULL AND archived = 0",
        params![id],
        map_entry_row,
    )
    .optional()
    .map_err(db_err)
}

/// 读取未删除的条目，**包含已归档条目**；供归档详情/取消归档使用。
/// 回收站条目仍不返回（与 `get_entry` 的软删除守卫一致）。
pub fn get_entry_any(conn: &Connection, id: &str) -> MendResult<Option<EntryRowEnc>> {
    conn.query_row(
        "SELECT id, category_id, title, url, username_enc, password_enc, email_enc,
                phone_enc, notes_enc, favorite, tags, created_at, updated_at, deleted_at,
                sort_order, archived
           FROM entries WHERE id = ?1 AND deleted_at IS NULL",
        params![id],
        map_entry_row,
    )
    .optional()
    .map_err(db_err)
}

/// 列表：按分类与标题关键字过滤（敏感字段为密文，无法在 SQL 层检索）。
pub fn list_entries(
    conn: &Connection,
    category_id: Option<&str>,
    keyword: Option<&str>,
) -> MendResult<Vec<EntryRowEnc>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, category_id, title, url, username_enc, password_enc, email_enc,
                    phone_enc, notes_enc, favorite, tags, created_at, updated_at, deleted_at,
                    sort_order, archived
               FROM entries
              WHERE deleted_at IS NULL AND archived = 0
                AND (?1 IS NULL OR category_id = ?1)
                AND (?2 IS NULL OR title LIKE '%' || ?2 || '%')
              ORDER BY updated_at DESC",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map(params![category_id, keyword], map_entry_row)
        .map_err(db_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_err)?;
    Ok(rows)
}

/// 回收站列表：只返回已软删除的条目，按删除时间倒序（最近删的在最前）。
pub fn list_trashed_entries(conn: &Connection) -> MendResult<Vec<EntryRowEnc>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, category_id, title, url, username_enc, password_enc, email_enc,
                    phone_enc, notes_enc, favorite, tags, created_at, updated_at, deleted_at,
                    sort_order, archived
               FROM entries
              WHERE deleted_at IS NOT NULL
              ORDER BY deleted_at DESC",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], map_entry_row)
        .map_err(db_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_err)?;
    Ok(rows)
}

/// 归档列表：只返回已归档且未删除的条目，按最近更新倒序。
pub fn list_archived_entries(conn: &Connection) -> MendResult<Vec<EntryRowEnc>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, category_id, title, url, username_enc, password_enc, email_enc,
                    phone_enc, notes_enc, favorite, tags, created_at, updated_at, deleted_at,
                    sort_order, archived
               FROM entries
              WHERE archived = 1 AND deleted_at IS NULL
              ORDER BY updated_at DESC",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], map_entry_row)
        .map_err(db_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_err)?;
    Ok(rows)
}

/// 软删除：只打 `deleted_at`，密文原样保留，可在回收站恢复。
/// 允许删除任意未删除条目，包括已归档条目；归档条目软删后进入回收站，
/// 恢复（`deleted_at` 置 NULL）后仍保持归档态，归档与回收站是互相正交的软状态。
pub fn delete_entry(conn: &Connection, id: &str) -> MendResult<()> {
    let changed = conn
        .execute(
            "UPDATE entries SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
            params![id, now_ms()],
        )
        .map_err(db_err)?;
    if changed == 0 {
        return Err(MendError::NotFound(format!("条目 {id}")));
    }
    Ok(())
}

/// 从回收站恢复：清掉 `deleted_at`。
pub fn restore_entry(conn: &Connection, id: &str) -> MendResult<()> {
    let changed = conn
        .execute(
            "UPDATE entries SET deleted_at = NULL WHERE id = ?1 AND deleted_at IS NOT NULL",
            params![id],
        )
        .map_err(db_err)?;
    if changed == 0 {
        return Err(MendError::NotFound(format!("回收站条目 {id}")));
    }
    Ok(())
}

/// 归档：把 `archived` 置 1（与 `deleted_at` 正交的软状态）。
/// 只作用于未删除且当前未归档的条目；归档后不出现在主列表、也不进回收站。
pub fn archive_entry(conn: &Connection, id: &str) -> MendResult<()> {
    let changed = conn
        .execute(
            "UPDATE entries SET archived = 1 WHERE id = ?1 AND archived = 0 AND deleted_at IS NULL",
            params![id],
        )
        .map_err(db_err)?;
    if changed == 0 {
        return Err(MendError::NotFound(format!("条目 {id}")));
    }
    Ok(())
}

/// 取消归档：把 `archived` 置 0。只作用于已归档且未删除的条目。
pub fn unarchive_entry(conn: &Connection, id: &str) -> MendResult<()> {
    let changed = conn
        .execute(
            "UPDATE entries SET archived = 0 WHERE id = ?1 AND archived = 1 AND deleted_at IS NULL",
            params![id],
        )
        .map_err(db_err)?;
    if changed == 0 {
        return Err(MendError::NotFound(format!("归档条目 {id}")));
    }
    Ok(())
}

/// 彻底清除：物理删除，只允许删除回收站里的条目，避免误删正常数据。
pub fn purge_entry(conn: &Connection, id: &str) -> MendResult<()> {
    let changed = conn
        .execute(
            "DELETE FROM entries WHERE id = ?1 AND deleted_at IS NOT NULL",
            params![id],
        )
        .map_err(db_err)?;
    if changed == 0 {
        return Err(MendError::NotFound(format!("回收站条目 {id}")));
    }
    Ok(())
}

/// 清空回收站。
pub fn purge_all_trashed(conn: &Connection) -> MendResult<usize> {
    let changed = conn
        .execute("DELETE FROM entries WHERE deleted_at IS NOT NULL", [])
        .map_err(db_err)?;
    Ok(changed)
}

// ---------- presets ----------

/// 落盘形态的预设值：`value_enc` 为密文。
#[derive(Debug, Clone)]
pub struct PresetRowEnc {
    pub id: String,
    pub field_type: String,
    pub label: String,
    pub value_enc: String,
    pub sort_order: i64,
    pub created_at: i64,
}

pub fn list_presets(conn: &Connection) -> MendResult<Vec<PresetRowEnc>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, field_type, label, value_enc, sort_order, created_at
               FROM presets
              ORDER BY field_type ASC, sort_order ASC, created_at ASC",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(PresetRowEnc {
                id: row.get(0)?,
                field_type: row.get(1)?,
                label: row.get(2)?,
                value_enc: row.get(3)?,
                sort_order: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(db_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_err)?;
    Ok(rows)
}

pub fn insert_preset(conn: &Connection, row: &PresetRowEnc) -> MendResult<()> {
    conn.execute(
        "INSERT INTO presets(id, field_type, label, value_enc, sort_order, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            row.id,
            row.field_type,
            row.label,
            row.value_enc,
            row.sort_order,
            row.created_at
        ],
    )
    .map_err(db_err)?;
    Ok(())
}

pub fn update_preset(conn: &Connection, row: &PresetRowEnc) -> MendResult<()> {
    let changed = conn
        .execute(
            "UPDATE presets SET field_type = ?2, label = ?3, value_enc = ?4, sort_order = ?5
              WHERE id = ?1",
            params![
                row.id,
                row.field_type,
                row.label,
                row.value_enc,
                row.sort_order
            ],
        )
        .map_err(db_err)?;
    if changed == 0 {
        return Err(MendError::NotFound(format!("预设 {}", row.id)));
    }
    Ok(())
}

pub fn delete_preset(conn: &Connection, id: &str) -> MendResult<()> {
    let changed = conn
        .execute("DELETE FROM presets WHERE id = ?1", params![id])
        .map_err(db_err)?;
    if changed == 0 {
        return Err(MendError::NotFound(format!("预设 {id}")));
    }
    Ok(())
}

/// 新建预设时取当前最大排序号 + 1，保证下拉里顺序稳定。
pub fn next_preset_sort(conn: &Connection) -> MendResult<i64> {
    let max: Option<i64> = conn
        .query_row("SELECT MAX(sort_order) FROM presets", [], |row| row.get(0))
        .map_err(db_err)?;
    Ok(max.unwrap_or(0) + 1)
}

/// 按 UI 提交的顺序重排某一类型的预设：只写 `sort_order`，密文与其他列原样不动
/// （AAD 绑定 `id:value`，任何重加密都会改变密文）。`ids` 是该类型的完整有序列表，
/// 逐条赋 `0..n-1`；不属于该类型或不存在的 id 被 UPDATE 静默跳过，空列表是合法空操作。
/// 显式 `BEGIN IMMEDIATE` 先拿写锁，避免事务内读→写升级触发 SQLITE_BUSY。
pub fn reorder_presets(conn: &Connection, field_type: &str, ids: &[String]) -> MendResult<()> {
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate).map_err(db_err)?;
    let mut order = 0i64;
    for id in ids {
        // 只有真正命中的行才占用排序号：混入的其他类型 id 既跳过更新、也不占号，
        // 保证目标类型始终是紧凑的 0..n-1。
        let changed = tx
            .execute(
                "UPDATE presets SET sort_order = ?2 WHERE id = ?1 AND field_type = ?3",
                params![id, order, field_type],
            )
            .map_err(db_err)?;
        if changed > 0 {
            order += 1;
        }
    }
    tx.commit().map_err(db_err)?;
    Ok(())
}

// ---------- tag definitions (v6) ----------

/// 落盘形态的标签定义：名称与颜色都是明文元信息（语义同分类名）。
#[derive(Debug, Clone)]
pub struct TagRow {
    pub id: String,
    pub name: String,
    pub color: String,
    pub sort_order: i64,
    pub created_at: i64,
}

pub fn list_tag_defs(conn: &Connection) -> MendResult<Vec<TagRow>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, color, sort_order, created_at
               FROM tag_defs
              ORDER BY sort_order ASC, created_at ASC",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(TagRow {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                sort_order: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(db_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_err)?;
    Ok(rows)
}

/// 新建标签定义：`sort_order` 由调用方取 `next_tag_sort`（追加到列表末尾）。
pub fn insert_tag_def(conn: &Connection, row: &TagRow) -> MendResult<()> {
    conn.execute(
        "INSERT INTO tag_defs(id, name, color, sort_order, created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?5)",
        params![row.id, row.name, row.color, row.sort_order, row.created_at],
    )
    .map_err(db_err)?;
    Ok(())
}

pub fn next_tag_sort(conn: &Connection) -> MendResult<i64> {
    let max: Option<i64> = conn
        .query_row("SELECT MAX(sort_order) FROM tag_defs", [], |row| row.get(0))
        .map_err(db_err)?;
    Ok(max.unwrap_or(0) + 1)
}

/// 编辑标签：改名时同步把**所有条目**（含回收站/归档）上的同名标签换成新名字。
/// 名称唯一索引（NOCASE）在冲突时返回 SQLite 约束错误，调用方应先用
/// `list_tag_defs` 做一次可读的重复校验。
///
/// 事务内先读后写：显式 `BEGIN IMMEDIATE`，避免读锁升级写锁时绕过忙回调。
pub fn rename_tag_def(
    conn: &Connection,
    id: &str,
    name: &str,
    color: &str,
) -> MendResult<()> {
    let old_name: Option<String> = conn
        .query_row(
            "SELECT name FROM tag_defs WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_err)?;
    let Some(old_name) = old_name else {
        return Err(MendError::NotFound(format!("标签 {id}")));
    };

    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate).map_err(db_err)?;
    if old_name != name {
        rewrite_entry_tags(&tx, Some(&old_name), name)?;
    }
    let changed = tx
        .execute(
            "UPDATE tag_defs SET name = ?2, color = ?3, updated_at = ?4 WHERE id = ?1",
            params![id, name, color, now_ms()],
        )
        .map_err(db_err)?;
    tx.commit().map_err(db_err)?;
    if changed == 0 {
        return Err(MendError::NotFound(format!("标签 {id}")));
    }
    Ok(())
}

/// 删除标签定义，并从所有条目上摘掉这个标签（条目不删）。
pub fn delete_tag_def(conn: &Connection, id: &str) -> MendResult<()> {
    let name: Option<String> = conn
        .query_row(
            "SELECT name FROM tag_defs WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_err)?;
    let Some(name) = name else {
        return Err(MendError::NotFound(format!("标签 {id}")));
    };

    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate).map_err(db_err)?;
    rewrite_entry_tags(&tx, Some(&name), "")?;
    let changed = tx
        .execute("DELETE FROM tag_defs WHERE id = ?1", params![id])
        .map_err(db_err)?;
    tx.commit().map_err(db_err)?;
    if changed == 0 {
        return Err(MendError::NotFound(format!("标签 {id}")));
    }
    Ok(())
}

/// 把所有条目的标签从 `from` 改成 `to`（`to` 为空表示摘掉）；只写真正含该标签的行。
fn rewrite_entry_tags(tx: &Transaction<'_>, from: Option<&str>, to: &str) -> MendResult<()> {
    let Some(from) = from else {
        return Ok(());
    };
    let rows: Vec<(String, String)> = {
        let mut stmt = tx
            .prepare("SELECT id, tags FROM entries")
            .map_err(db_err)?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(db_err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db_err)?;
        rows
    };
    for (id, raw) in rows {
        let tags = tags_from_json(&raw)?;
        if !tags.iter().any(|tag| tag == from) {
            continue;
        }
        let mut next: Vec<String> = Vec::with_capacity(tags.len());
        for tag in tags {
            if tag == from {
                let target = to.trim();
                if !target.is_empty() && !next.iter().any(|item| item == target) {
                    next.push(target.to_string());
                }
            } else if !next.iter().any(|item| item == &tag) {
                next.push(tag);
            }
        }
        tx.execute(
            "UPDATE entries SET tags = ?2 WHERE id = ?1",
            params![id, tags_to_json(&next)?],
        )
        .map_err(db_err)?;
    }
    Ok(())
}

fn map_entry_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<EntryRowEnc> {    Ok(EntryRowEnc {
        id: row.get(0)?,
        category_id: row.get(1)?,
        title: row.get(2)?,
        url: row.get(3)?,
        username_enc: row.get(4)?,
        password_enc: row.get(5)?,
        email_enc: row.get(6)?,
        phone_enc: row.get(7)?,
        notes_enc: row.get(8)?,
        favorite: row.get::<_, i64>(9)? != 0,
        tags: row.get::<_, String>(10).and_then(|raw| {
            tags_from_json(&raw).map_err(|err| {
                rusqlite::Error::FromSqlConversionFailure(
                    10,
                    rusqlite::types::Type::Text,
                    Box::new(err),
                )
            })
        })?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        deleted_at: row.get(13)?,
        sort_order: row.get(14)?,
        archived: row.get::<_, i64>(15)? != 0,
    })
}

// ---------- site icons (v5) ----------

#[derive(Debug, Clone, PartialEq)]
pub struct SiteIconRow {
    pub host: String,
    pub mime: String,
    pub bytes: Vec<u8>,
    pub fetched_at: i64,
}

/// 缓存状态快照，供抓取队列判断「这个站点接下来该不该再试」。
#[derive(Debug, Clone, PartialEq)]
pub struct SiteIconState {
    pub host: String,
    pub fetched_at: i64,
    pub fail_count: i64,
    /// `false` 表示只留下了一次失败记录，没有可用图标。
    pub has_icon: bool,
}

/// 已缓存的站点图标；没有缓存、或只留下失败记录时返回 `None`。
pub fn get_site_icon(conn: &Connection, host: &str) -> MendResult<Option<SiteIconRow>> {
    conn.query_row(
        "SELECT host, mime, bytes, fetched_at
           FROM site_icons
          WHERE host = ?1 AND bytes IS NOT NULL AND mime IS NOT NULL",
        params![host],
        |row| {
            Ok(SiteIconRow {
                host: row.get(0)?,
                mime: row.get(1)?,
                bytes: row.get(2)?,
                fetched_at: row.get(3)?,
            })
        },
    )
    .optional()
    .map_err(db_err)
}

/// 写入/覆盖一个站点图标，并把失败计数清零。
pub fn put_site_icon(
    conn: &Connection,
    host: &str,
    mime: &str,
    bytes: &[u8],
    fetched_at: i64,
) -> MendResult<()> {
    conn.execute(
        "INSERT INTO site_icons(host, mime, bytes, fetched_at, fail_count)
         VALUES(?1, ?2, ?3, ?4, 0)
         ON CONFLICT(host) DO UPDATE SET
             mime = excluded.mime,
             bytes = excluded.bytes,
             fetched_at = excluded.fetched_at,
             fail_count = 0",
        params![host, mime, bytes, fetched_at],
    )
    .map_err(db_err)?;
    Ok(())
}

/// 记一次「抓过但没抓到」：保留失败次数与时间，让下一次重试按指数退避延后。
pub fn mark_site_icon_failed(conn: &Connection, host: &str, attempted_at: i64) -> MendResult<()> {
    conn.execute(
        "INSERT INTO site_icons(host, mime, bytes, fetched_at, fail_count)
         VALUES(?1, NULL, NULL, ?2, 1)
         ON CONFLICT(host) DO UPDATE SET
             mime = NULL,
             bytes = NULL,
             fetched_at = excluded.fetched_at,
             fail_count = site_icons.fail_count + 1",
        params![host, attempted_at],
    )
    .map_err(db_err)?;
    Ok(())
}

/// 全部缓存行的状态（成功与失败都在内），一次查询供队列筛选。
pub fn site_icon_states(conn: &Connection) -> MendResult<Vec<SiteIconState>> {
    let mut stmt = conn
        .prepare("SELECT host, fetched_at, fail_count, bytes IS NOT NULL FROM site_icons")
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SiteIconState {
                host: row.get(0)?,
                fetched_at: row.get(1)?,
                fail_count: row.get(2)?,
                has_icon: row.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(db_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_err)?;
    Ok(rows)
}

/// 条目里出现过的全部网址（只读 `url` 一列；含归档，不含回收站）。
/// 站点图标的抓取队列完全由它派生：没有网址的条目不会产生任何请求。
pub fn list_entry_urls(conn: &Connection) -> MendResult<Vec<String>> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT url FROM entries
              WHERE url IS NOT NULL AND deleted_at IS NULL",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(db_err)?;
    let urls = rows.collect::<Result<Vec<_>, _>>().map_err(db_err)?;
    Ok(urls)
}

/// 清空图标缓存，返回删掉的行数。
pub fn clear_site_icons(conn: &Connection) -> MendResult<u64> {
    let removed = conn
        .execute("DELETE FROM site_icons", [])
        .map_err(db_err)?;
    Ok(removed as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn schema_migration_is_idempotent() {
        let conn = mem_db();
        migrate(&conn).unwrap();
        assert_eq!(
            meta_get(&conn, "schema_version").unwrap().as_deref(),
            Some("6")
        );
        assert!(!is_initialized(&conn).unwrap());
        assert!(list_entries(&conn, None, None).unwrap().is_empty());
    }

    /// 可重入：模拟"列已加、版本未升"的半迁移库（旧实现崩溃后的坏状态），
    /// migrate 不得再次 ALTER（否则 duplicate column 报错、永久失败），而是补齐版本号。
    #[test]
    fn migrate_recovers_half_applied_v2_state() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_V1).unwrap();
        conn.execute_batch(MIGRATION_V2).unwrap(); // 列加了
        meta_set(&conn, "schema_version", "1").unwrap(); // 但版本没升（模拟崩溃点）

        migrate(&conn).unwrap();
        assert_eq!(
            meta_get(&conn, "schema_version").unwrap().as_deref(),
            Some("6")
        );
        assert!(column_exists(&conn, "entries", "tags").unwrap());
        assert!(column_exists(&conn, "entries", "sort_order").unwrap());
    }

    /// 事务化迁移在文件库上可安全重入：多次启动（每次 open_and_migrate 都跑一遍）
    /// 不报错、不重复 ALTER，版本号始终保持 3。
    #[test]
    fn migrate_runs_in_single_transaction() {
        let conn = Connection::open_in_memory().unwrap();
        // 全新库：migrate 成功前不应有任何已提交痕迹；成功后一次性到位
        migrate(&conn).unwrap();
        // 重入（模拟启动时再次执行）仍保持幂等
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        assert_eq!(
            meta_get(&conn, "schema_version").unwrap().as_deref(),
            Some("6")
        );
        assert!(column_exists(&conn, "entries", "tags").unwrap());
        assert!(column_exists(&conn, "entries", "sort_order").unwrap());
    }

    /// 忙等待必须在 open / pragma / migrate 阶段就生效：另一个连接用
    /// `BEGIN IMMEDIATE` 独占写锁 ~150ms 后提交，期间的 `open_and_migrate`
    /// 应等待锁释放后成功，而不是立刻报 database is locked（修复前的行为，
    /// 表现为启动 Fatal「数据读写失败」且重试也立刻复现）。
    #[test]
    fn open_and_migrate_waits_for_transient_write_lock() {
        let dir = std::env::temp_dir().join(format!("mend-core-db-busy-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(DB_FILE_NAME);

        // 先建一个已迁移完成的库；后续 open_and_migrate 仍会重跑 migrate
        //（其中 meta_set 写 schema_version 需要写锁）。
        {
            let conn = open_and_migrate(&path).unwrap();
            meta_set(&conn, "boot", "ok").unwrap();
        } // 在此关闭，释放文件句柄

        // 锁持有线程：BEGIN IMMEDIATE 独占写锁，150ms 后提交。
        let (lock_held, held_rx) = std::sync::mpsc::channel();
        let lock_path = path.clone();
        let holder = std::thread::spawn(move || {
            let conn = Connection::open(&lock_path).unwrap();
            conn.execute_batch("BEGIN IMMEDIATE").unwrap();
            lock_held.send(()).unwrap();
            std::thread::sleep(Duration::from_millis(150));
            conn.execute_batch("COMMIT").unwrap();
        });
        held_rx.recv().unwrap(); // 写锁已被持有，才开始第二个连接的打开

        let started = std::time::Instant::now();
        let conn = open_and_migrate(&path).unwrap();
        let waited = started.elapsed();
        holder.join().unwrap();

        assert!(
            waited >= Duration::from_millis(100),
            "open_and_migrate 应等待瞬时写锁释放，实际耗时 {waited:?}"
        );
        // 锁释放后第二个连接可正常读写，且看到了建库阶段写入的数据
        meta_set(&conn, "after", "lock").unwrap();
        assert_eq!(meta_get(&conn, "boot").unwrap().as_deref(), Some("ok"));

        let _ = fs::remove_dir_all(&dir);
    }

    /// v1 旧库（无 tags / sort_order 列）升级到 v3：加列成功，旧数据带默认空标签与排序号 0。
    #[test]
    fn v1_database_upgrades_to_v3_with_default_tags() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_V1).unwrap();
        conn.execute(
            "INSERT INTO entries(id, title, username_enc, password_enc, email_enc, phone_enc,
                                 notes_enc, favorite, created_at, updated_at)
             VALUES('e1', 't', 'u', 'p', 'm', 'ph', 'n', 0, 1, 1)",
            [],
        )
        .unwrap();
        meta_set(&conn, "schema_version", "1").unwrap();

        migrate(&conn).unwrap();
        assert_eq!(
            meta_get(&conn, "schema_version").unwrap().as_deref(),
            Some("6")
        );
        let rows = list_entries(&conn, None, None).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].tags.is_empty(), "旧条目升级后应为空标签");
        assert_eq!(rows[0].sort_order, 0, "旧条目升级后排序号应为默认 0");
    }

    /// v2 半迁移库（tags / sort_order 已加、版本仍为 2）升级到 v3：不重复 ALTER，
    /// 只把版本号补齐到 3。
    #[test]
    fn migrate_recovers_half_applied_v3_state() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_V1).unwrap();
        conn.execute_batch(MIGRATION_V2).unwrap();
        conn.execute_batch(MIGRATION_V3).unwrap(); // sort_order 已加
        meta_set(&conn, "schema_version", "2").unwrap(); // 但版本没升（模拟崩溃点）

        migrate(&conn).unwrap();
        assert_eq!(
            meta_get(&conn, "schema_version").unwrap().as_deref(),
            Some("6")
        );
        assert!(column_exists(&conn, "entries", "sort_order").unwrap());
    }

    /// sort_order 落库往返：新建条目取桶内 max+1，reorder 式批量 UPDATE 后
    /// 读回的排序稳定且持久（重复查询不漂移，空数组重排为幂等空操作）。
    #[test]
    fn entry_sort_order_roundtrip_and_reorder_persists() {
        let conn = mem_db();
        create_category(&conn, "cat-1", "工作", None, None).unwrap();
        for id in ["a", "b", "c"] {
            let mut row = sample_row(id, Some("cat-1"));
            row.sort_order = next_entry_sort_order(&conn, Some("cat-1")).unwrap();
            insert_entry(&conn, &row).unwrap();
        }

        // 新条目排序号逐条递增（桶内 max+1）
        let orders: Vec<i64> = ["a", "b", "c"]
            .iter()
            .map(|id| get_entry(&conn, id).unwrap().unwrap().sort_order)
            .collect();
        assert_eq!(orders, vec![1, 2, 3]);

        // 模拟拖拽：按 c → a → b 重排，事务内逐条写入 0..n-1
        reorder_entries(&conn, &["c".to_string(), "a".to_string(), "b".to_string()]).unwrap();
        let after: Vec<i64> = ["a", "b", "c"]
            .iter()
            .map(|id| get_entry(&conn, id).unwrap().unwrap().sort_order)
            .collect();
        assert_eq!(after, vec![1, 2, 0], "c 应为 0、a 为 1、b 为 2");

        // 稳定：重复查询结果一致（落库往返）
        let again: Vec<i64> = ["a", "b", "c"]
            .iter()
            .map(|id| get_entry(&conn, id).unwrap().unwrap().sort_order)
            .collect();
        assert_eq!(again, after);

        // 幂等：空数组重排不影响既有顺序
        reorder_entries(&conn, &[]).unwrap();
        assert_eq!(get_entry(&conn, "c").unwrap().unwrap().sort_order, 0);
    }

    /// 拖拽落库按 `category_id` 分桶：一次调用里混入多个分类的 id 时，
    /// 每个分类各自得到连续的 `0..n-1`，互不覆盖（旧实现会把所有 id 串成
    /// 一条全局序列，导致跨分类排序号互相踩踏）。
    #[test]
    fn reorder_entries_scopes_sort_order_per_category() {
        let conn = mem_db();
        create_category(&conn, "cat-1", "工作", None, None).unwrap();
        create_category(&conn, "cat-2", "金融", None, None).unwrap();

        let row_for = |id: &str, category: &str| {
            let mut row = sample_row(id, Some(category));
            row.sort_order = next_entry_sort_order(&conn, Some(category)).unwrap();
            row
        };
        // cat-1: a=1, b=2；cat-2: c=1, d=2
        insert_entry(&conn, &row_for("a", "cat-1")).unwrap();
        insert_entry(&conn, &row_for("b", "cat-1")).unwrap();
        insert_entry(&conn, &row_for("c", "cat-2")).unwrap();
        insert_entry(&conn, &row_for("d", "cat-2")).unwrap();

        // 跨分类混排：a 与 c 分别回到各自分类的顶部。
        reorder_entries(&conn, &["a".to_string(), "c".to_string()]).unwrap();

        assert_eq!(get_entry(&conn, "a").unwrap().unwrap().sort_order, 0);
        assert_eq!(get_entry(&conn, "c").unwrap().unwrap().sort_order, 0);
        // 各自分类内部紧凑重排：b/d 只在自己桶里顺延，不会被另一个分类的 id 覆盖。
        assert_eq!(get_entry(&conn, "b").unwrap().unwrap().sort_order, 1);
        assert_eq!(get_entry(&conn, "d").unwrap().unwrap().sort_order, 1);

        assert_eq!(ordered_ids(&conn, Some("cat-1")), vec!["a", "b"]);
        assert_eq!(ordered_ids(&conn, Some("cat-2")), vec!["c", "d"]);
    }

    /// 前端只提交当前可见桶的 id（关键字 / 标签筛选后可能只是子集）：
    /// 未出现在 `ids` 里的同桶条目留在原相对位置，落库后同桶排序号依旧完整不重复。
    #[test]
    fn reorder_entries_preserves_hidden_entries_in_bucket() {
        let conn = mem_db();
        create_category(&conn, "cat-1", "工作", None, None).unwrap();
        let row_for = |id: &str| {
            let mut row = sample_row(id, Some("cat-1"));
            row.sort_order = next_entry_sort_order(&conn, Some("cat-1")).unwrap();
            row
        };
        insert_entry(&conn, &row_for("a")).unwrap();
        insert_entry(&conn, &row_for("b")).unwrap();
        insert_entry(&conn, &row_for("c")).unwrap();
        // 初始 a=1, b=2, c=3

        // 模拟筛选后只提交 [c, a]（b 不可见）。
        reorder_entries(&conn, &["c".to_string(), "a".to_string()]).unwrap();

        // b 未参与重排：仍留在 a 与 c 之间的相对位置；整桶排序号紧凑不重复。
        assert_eq!(ordered_ids(&conn, Some("cat-1")), vec!["c", "b", "a"]);
        let orders: Vec<i64> = ["a", "b", "c"]
            .iter()
            .map(|id| get_entry(&conn, id).unwrap().unwrap().sort_order)
            .collect();
        assert_eq!(orders, vec![2, 1, 0]);
    }

    /// 预设重排只改 sort_order：按传入顺序紧凑赋值，且严格限制在指定 field_type 内，
    /// 另一类型的排序号与密文列不受影响。
    #[test]
    fn reorder_presets_scopes_sort_order_per_type_and_keeps_ciphertext() {
        let conn = mem_db();
        let preset_row = |id: &str, field_type: &str, sort_order: i64| PresetRowEnc {
            id: id.into(),
            field_type: field_type.into(),
            label: format!("label-{id}"),
            value_enc: format!("enc-{id}"),
            sort_order,
            created_at: 1,
        };
        // username: a=1, b=2, c=3；email: x=1（另一类型，不该被碰到）
        insert_preset(&conn, &preset_row("a", "username", 1)).unwrap();
        insert_preset(&conn, &preset_row("b", "username", 2)).unwrap();
        insert_preset(&conn, &preset_row("c", "username", 3)).unwrap();
        insert_preset(&conn, &preset_row("x", "email", 1)).unwrap();

        // 把 username 重排为 c → a → b；混入 email 的 x 应被 WHERE 过滤掉。
        reorder_presets(
            &conn,
            "username",
            &[
                "c".to_string(),
                "a".to_string(),
                "x".to_string(),
                "b".to_string(),
            ],
        )
        .unwrap();

        let list = list_presets(&conn).unwrap();
        let get = |id: &str| list.iter().find(|row| row.id == id).unwrap();
        assert_eq!(get("c").sort_order, 0);
        assert_eq!(get("a").sort_order, 1);
        assert_eq!(get("b").sort_order, 2);
        // 另一类型原样不动（sort_order 与密文均未变）。
        assert_eq!(get("x").sort_order, 1);
        assert_eq!(get("x").value_enc, "enc-x");
        assert_eq!(get("a").value_enc, "enc-a");
        // 空列表合法空操作。
        reorder_presets(&conn, "username", &[]).unwrap();
        assert_eq!(
            list_presets(&conn)
                .unwrap()
                .iter()
                .find(|row| row.id == "c")
                .unwrap()
                .sort_order,
            0
        );
    }

    #[test]
    fn deleting_category_keeps_entries_uncategorized() {
        let conn = mem_db();
        create_category(&conn, "cat-1", "工作", None, None).unwrap();
        insert_entry(
            &conn,
            &EntryRowEnc {
                id: "e1".into(),
                category_id: Some("cat-1".into()),
                title: "邮箱".into(),
                url: None,
                username_enc: "c".into(),
                password_enc: "c".into(),
                email_enc: "c".into(),
                phone_enc: "c".into(),
                notes_enc: "c".into(),
                favorite: false,
                tags: vec![],
                sort_order: 0,
                created_at: 1,
                updated_at: 1,
                deleted_at: None,
                archived: false,
            },
        )
        .unwrap();

        delete_category(&conn, "cat-1").unwrap();
        let entry = get_entry(&conn, "e1").unwrap().unwrap();
        assert!(entry.category_id.is_none());
        assert!(list_categories(&conn).unwrap().is_empty());
    }

    #[test]
    fn entry_belongs_to_category_and_counts() {
        let conn = mem_db();
        create_category(&conn, "cat-1", "工作", None, None).unwrap();
        insert_entry(&conn, &sample_row("e1", Some("cat-1"))).unwrap();
        assert_eq!(list_categories(&conn).unwrap()[0].entry_count, 1);
        assert_eq!(list_entries(&conn, Some("cat-1"), None).unwrap().len(), 1);
        assert!(list_entries(&conn, Some("cat-2"), None).unwrap().is_empty());
        assert_eq!(list_entries(&conn, None, Some("邮")).unwrap().len(), 1);
        assert!(list_entries(&conn, None, Some("不存在"))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn category_color_validation() {
        // 合法：#RRGGBB 大小写不敏感，统一存大写
        assert_eq!(
            validate_category_color(&Some("#a1b2c3".into()))
                .unwrap()
                .as_deref(),
            Some("#A1B2C3")
        );
        assert_eq!(
            validate_category_color(&Some("#ffffff".into()))
                .unwrap()
                .as_deref(),
            Some("#FFFFFF")
        );
        // 空值 / 空白串：无色
        assert_eq!(validate_category_color(&None).unwrap(), None);
        assert_eq!(validate_category_color(&Some("   ".into())).unwrap(), None);
        // 非法格式
        for bad in [
            "red", "#12345", "#1234567", "#GGGGGG", "123456", "#a1b2c", "#a1b2c3d",
        ] {
            assert!(
                validate_category_color(&Some(bad.into())).is_err(),
                "应拒绝: {bad}"
            );
        }
    }

    #[test]
    fn category_icon_validation() {
        assert_eq!(
            validate_category_icon(&Some("work".into()))
                .unwrap()
                .as_deref(),
            Some("work")
        );
        assert_eq!(validate_category_icon(&None).unwrap(), None);
        assert_eq!(validate_category_icon(&Some("".into())).unwrap(), None);
        assert!(validate_category_icon(&Some("a".repeat(65))).is_err());
    }

    #[test]
    fn category_color_and_icon_roundtrip() {
        let conn = mem_db();
        // 走命令层同款校验（颜色统一转大写）
        let color = validate_category_color(&Some("#a1b2c3".into())).unwrap();
        create_category(&conn, "cat-1", "工作", color.as_deref(), Some("work")).unwrap();
        let row = list_categories(&conn).unwrap()[0].clone();
        assert_eq!(row.color.as_deref(), Some("#A1B2C3"));
        assert_eq!(row.icon.as_deref(), Some("work"));

        // 重命名时同步更新 color/icon（None 表示清除）
        rename_category(&conn, "cat-1", "生活", None, Some("home")).unwrap();
        let row = list_categories(&conn).unwrap()[0].clone();
        assert_eq!(row.name, "生活");
        assert_eq!(row.color, None);
        assert_eq!(row.icon.as_deref(), Some("home"));
    }

    #[test]
    fn reorder_categories_persists_order_and_keeps_metadata() {
        let conn = mem_db();
        let color = validate_category_color(&Some("#a1b2c3".into())).unwrap();
        create_category(&conn, "cat-1", "工作", color.as_deref(), Some("work")).unwrap();
        create_category(&conn, "cat-2", "生活", None, Some("home")).unwrap();
        create_category(&conn, "cat-3", "购物", None, Some("cart")).unwrap();

        let ids = vec![
            "cat-3".to_string(),
            "cat-1".to_string(),
            "cat-2".to_string(),
        ];
        reorder_categories(&conn, &ids).unwrap();
        let rows = list_categories(&conn).unwrap();
        assert_eq!(
            rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
            vec!["cat-3", "cat-1", "cat-2"]
        );
        assert_eq!(
            rows.iter().map(|row| row.sort_order).collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
        assert_eq!(rows[1].name, "工作");
        assert_eq!(rows[1].color.as_deref(), Some("#A1B2C3"));
        assert_eq!(rows[1].icon.as_deref(), Some("work"));

        // 混入不存在的 id 不应占号；空列表是合法空操作。
        reorder_categories(&conn, &["missing".to_string(), "cat-2".to_string()]).unwrap();
        let rows = list_categories(&conn).unwrap();
        assert_eq!(rows[0].id, "cat-2");
        assert_eq!(rows[0].sort_order, 0);
        reorder_categories(&conn, &[]).unwrap();
    }

    /// v4 迁移幂等：全新库多次迁移版本保持 4，`archived` 列存在且新建条目默认未归档。
    #[test]
    fn schema_migration_v4_is_idempotent() {
        let conn = mem_db();
        migrate(&conn).unwrap();
        assert_eq!(
            meta_get(&conn, "schema_version").unwrap().as_deref(),
            Some("6")
        );
        assert!(column_exists(&conn, "entries", "archived").unwrap());
        insert_entry(&conn, &sample_row("e1", None)).unwrap();
        assert!(!get_entry(&conn, "e1").unwrap().unwrap().archived);
    }

    /// 可重入：模拟"archived 列已加、版本未升"的半迁移 v4 库，migrate 只补齐版本号，
    /// 不重复 ALTER（否则 duplicate column 报错、永久失败）。
    #[test]
    fn migrate_recovers_half_applied_v4_state() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_V1).unwrap();
        conn.execute_batch(MIGRATION_V2).unwrap();
        conn.execute_batch(MIGRATION_V3).unwrap();
        conn.execute_batch(MIGRATION_V4).unwrap(); // 列已加
        meta_set(&conn, "schema_version", "3").unwrap(); // 但版本没升（模拟崩溃点）

        migrate(&conn).unwrap();
        assert_eq!(
            meta_get(&conn, "schema_version").unwrap().as_deref(),
            Some("6")
        );
        assert!(column_exists(&conn, "entries", "archived").unwrap());
    }

    /// v1 旧库（无 tags / sort_order / archived）升级到 v4：加列成功，存量条目默认未归档。
    #[test]
    fn v1_database_upgrades_to_v4_with_default_archived() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_V1).unwrap();
        conn.execute(
            "INSERT INTO entries(id, title, username_enc, password_enc, email_enc, phone_enc,
                                 notes_enc, favorite, created_at, updated_at)
             VALUES('e1', 't', 'u', 'p', 'm', 'ph', 'n', 0, 1, 1)",
            [],
        )
        .unwrap();
        meta_set(&conn, "schema_version", "1").unwrap();

        migrate(&conn).unwrap();
        assert_eq!(
            meta_get(&conn, "schema_version").unwrap().as_deref(),
            Some("6")
        );
        let rows = list_entries(&conn, None, None).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(!rows[0].archived, "旧条目升级后应为未归档");
    }

    /// 归档往返与隔离：归档后不出现在主列表、只出现在归档列表；归档条目可软删除
    /// （软删后进回收站，恢复后仍保持归档态）；重复归档被守卫拒绝；取消归档后回到主列表。
    #[test]
    fn archive_unarchive_roundtrip_and_isolation() {
        let conn = mem_db();
        insert_entry(&conn, &sample_row("e1", None)).unwrap();
        insert_entry(&conn, &sample_row("e2", None)).unwrap();
        assert_eq!(list_entries(&conn, None, None).unwrap().len(), 2);

        archive_entry(&conn, "e1").unwrap();
        assert_eq!(list_entries(&conn, None, None).unwrap().len(), 1);
        assert_eq!(list_entries(&conn, None, None).unwrap()[0].id, "e2");

        let archived = list_archived_entries(&conn).unwrap();
        assert_eq!(archived.len(), 1);
        assert_eq!(archived[0].id, "e1");
        assert!(archived[0].archived);

        // 归档条目可软删除：软删后进入回收站，归档列表清空
        delete_entry(&conn, "e1").unwrap();
        let trashed = list_trashed_entries(&conn).unwrap();
        assert_eq!(trashed.len(), 1);
        assert_eq!(trashed[0].id, "e1");
        assert!(trashed[0].deleted_at.is_some());
        assert!(list_archived_entries(&conn).unwrap().is_empty());

        // 恢复后回到归档态，不回到主列表
        restore_entry(&conn, "e1").unwrap();
        assert!(list_trashed_entries(&conn).unwrap().is_empty());
        let archived = list_archived_entries(&conn).unwrap();
        assert_eq!(archived.len(), 1);
        assert_eq!(archived[0].id, "e1");
        assert_eq!(list_entries(&conn, None, None).unwrap().len(), 1);

        // 重复归档被 `archived = 0` 守卫拒绝
        assert!(archive_entry(&conn, "e1").is_err());

        unarchive_entry(&conn, "e1").unwrap();
        assert_eq!(list_entries(&conn, None, None).unwrap().len(), 2);
        assert!(list_archived_entries(&conn).unwrap().is_empty());
        assert!(!get_entry(&conn, "e1").unwrap().unwrap().archived);
    }

    /// 按 `sort_order` 升序返回某分类（或未分类桶）的条目 id，用于断言手动序。
    fn ordered_ids(conn: &Connection, category: Option<&str>) -> Vec<String> {
        let mut rows = list_entries(conn, category, None).unwrap();
        rows.sort_by_key(|row| row.sort_order);
        rows.into_iter().map(|row| row.id).collect()
    }

    fn sample_row(id: &str, category: Option<&str>) -> EntryRowEnc {
        EntryRowEnc {
            id: id.into(),
            category_id: category.map(str::to_string),
            title: "公司邮箱".into(),
            url: Some("https://mail.example.com".into()),
            username_enc: "enc-user".into(),
            password_enc: "enc-pass".into(),
            email_enc: "enc-mail".into(),
            phone_enc: "enc-phone".into(),
            notes_enc: "enc-notes".into(),
            favorite: false,
            tags: vec![],
            sort_order: 0,
            created_at: 1,
            updated_at: 1,
            deleted_at: None,
            archived: false,
        }
    }

    #[test]
    fn site_icons_round_trip_and_failures() {
        let conn = mem_db();
        migrate(&conn).unwrap();
        assert_eq!(SCHEMA_VERSION, 6);

        // 没有缓存时读不到东西。
        assert!(get_site_icon(&conn, "mail.example.com").unwrap().is_none());

        put_site_icon(&conn, "mail.example.com", "image/png", b"png-bytes", 10).unwrap();
        let row = get_site_icon(&conn, "mail.example.com").unwrap().unwrap();
        assert_eq!(row.mime, "image/png");
        assert_eq!(row.bytes, b"png-bytes");

        // 失败记录覆盖掉旧图标，并累计次数（抓不到时宁可回退内置图标）。
        mark_site_icon_failed(&conn, "mail.example.com", 20).unwrap();
        assert!(get_site_icon(&conn, "mail.example.com").unwrap().is_none());
        mark_site_icon_failed(&conn, "mail.example.com", 30).unwrap();
        let states = site_icon_states(&conn).unwrap();
        let state = states
            .iter()
            .find(|state| state.host == "mail.example.com")
            .unwrap();
        assert!(!state.has_icon);
        assert_eq!(state.fail_count, 2);
        assert_eq!(state.fetched_at, 30);

        // 再次抓到时计数归零，队列不会再把它当失败目标。
        put_site_icon(&conn, "mail.example.com", "image/png", b"fresh", 40).unwrap();
        let states = site_icon_states(&conn).unwrap();
        let state = states
            .iter()
            .find(|state| state.host == "mail.example.com")
            .unwrap();
        assert!(state.has_icon);
        assert_eq!(state.fail_count, 0);

        assert_eq!(clear_site_icons(&conn).unwrap(), 1);
        assert!(site_icon_states(&conn).unwrap().is_empty());
    }

    #[test]
    fn entry_urls_skip_trash_and_blanks() {
        let conn = mem_db();
        migrate(&conn).unwrap();
        let mut row = sample_row("e1", None);
        insert_entry(&conn, &row).unwrap();
        row.id = "e2".into();
        row.deleted_at = Some(2);
        insert_entry(&conn, &row).unwrap();
        row.id = "e3".into();
        row.deleted_at = None;
        row.url = None;
        insert_entry(&conn, &row).unwrap();

        let urls = list_entry_urls(&conn).unwrap();
        assert_eq!(urls, vec!["https://mail.example.com".to_string()]);
    }

    /// 标签定义的增改删：改名同步改写条目上的标签名，删除则从所有条目上摘掉，
    /// 且跨归档 / 回收站条目一起生效（标签是纯元信息，不随条目状态隔离）。
    #[test]
    fn tag_defs_rename_and_delete_rewrite_entries() {
        let conn = mem_db();
        let mut e1 = sample_row("e1", None);
        e1.tags = vec!["工作".into(), "金融".into()];
        insert_entry(&conn, &e1).unwrap();
        let mut e2 = sample_row("e2", None);
        e2.tags = vec!["工作".into()];
        e2.archived = true;
        insert_entry(&conn, &e2).unwrap();
        let mut e3 = sample_row("e3", None);
        e3.tags = vec!["工作".into()];
        insert_entry(&conn, &e3).unwrap();
        delete_entry(&conn, "e3").unwrap();

        insert_tag_def(
            &conn,
            &TagRow {
                id: "t1".into(),
                name: "工作".into(),
                color: "#2563EB".into(),
                sort_order: 1,
                created_at: 1,
            },
        )
        .unwrap();
        insert_tag_def(
            &conn,
            &TagRow {
                id: "t2".into(),
                name: "金融".into(),
                color: "#16A34A".into(),
                sort_order: 2,
                created_at: 1,
            },
        )
        .unwrap();
        assert_eq!(list_tag_defs(&conn).unwrap().len(), 2);

        // 改名：所有条目上的「工作」都变成「办公」。
        rename_tag_def(&conn, "t1", "办公", "#0D9488").unwrap();
        let defs = list_tag_defs(&conn).unwrap();
        let renamed = defs.iter().find(|row| row.id == "t1").unwrap();
        assert_eq!(renamed.name, "办公");
        assert_eq!(renamed.color, "#0D9488");
        // get_entry_any 能读到归档条目；回收站条目走 list_trashed_entries。
        let archived = get_entry_any(&conn, "e2").unwrap().unwrap();
        assert_eq!(archived.tags, vec!["办公".to_string()]);
        let trashed = list_trashed_entries(&conn).unwrap();
        assert_eq!(trashed[0].tags, vec!["办公".to_string()]);
        assert_eq!(
            get_entry(&conn, "e1").unwrap().unwrap().tags,
            vec!["办公".to_string(), "金融".to_string()]
        );

        // 删除：条目上的标签被摘掉，定义消失，条目本身还在。
        delete_tag_def(&conn, "t2").unwrap();
        assert_eq!(list_tag_defs(&conn).unwrap().len(), 1);
        assert_eq!(
            get_entry(&conn, "e1").unwrap().unwrap().tags,
            vec!["办公".to_string()]
        );
        assert!(delete_tag_def(&conn, "t2").is_err(), "重复删除应报未找到");
    }

    /// v6 迁移回填：旧库里的标签（含 `#` 前缀、大小写重复）变成标签定义，
    /// 条目侧写法归一（去 `#`、保留首次出现的拼写、去重）。
    #[test]
    fn migration_backfills_legacy_tags() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_V1).unwrap();
        conn.execute_batch(MIGRATION_V2).unwrap();
        conn.execute_batch(MIGRATION_V3).unwrap();
        conn.execute_batch(MIGRATION_V4).unwrap();
        conn.execute_batch(MIGRATION_V5).unwrap();
        conn.execute(
            "INSERT INTO entries(id, title, username_enc, password_enc, email_enc, phone_enc,
                                 notes_enc, favorite, tags, created_at, updated_at)
             VALUES('e1', 't', 'u', 'p', 'm', 'ph', 'n', 0, '[\"#工作\",\"Work\",\"work\",\"金融\",\"#工作\"]', 1, 1)",
            [],
        )
        .unwrap();
        meta_set(&conn, "schema_version", "5").unwrap();

        migrate(&conn).unwrap();
        assert_eq!(
            meta_get(&conn, "schema_version").unwrap().as_deref(),
            Some("6")
        );
        let defs = list_tag_defs(&conn).unwrap();
        assert_eq!(
            defs.iter().map(|row| row.name.as_str()).collect::<Vec<_>>(),
            vec!["工作", "Work", "金融"],
            "按首次出现顺序回填，大小写重复只保留第一次拼写"
        );
        assert_eq!(
            get_entry(&conn, "e1").unwrap().unwrap().tags,
            vec!["工作".to_string(), "Work".to_string(), "金融".to_string()]
        );
        // 回填幂等：再次迁移不新增定义。
        migrate(&conn).unwrap();
        assert_eq!(list_tag_defs(&conn).unwrap().len(), 3);
    }
}
