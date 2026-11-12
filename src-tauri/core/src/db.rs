//! SQLite 连接、schema 迁移 v1 与仓储函数。
//!
//! 表结构与字段落盘形态见 `docs/04-data-model-encryption.md` §2：
//! 标题/分类/时间等元信息明文，账号/密码/邮箱/手机号/备注一律存密文列。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, OptionalExtension};

/// 向外暴露连接类型，避免上层再单独依赖 rusqlite。
pub use rusqlite::Connection;

use crate::error::{MendError, MendResult};

pub const SCHEMA_VERSION: i64 = 2;
pub const DB_FILE_NAME: &str = "mend.db";

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
    // 单文件库：不用 WAL，便于整库拷贝备份（见 docs/06）
    conn.pragma_update(None, "journal_mode", "DELETE")
        .map_err(db_err)?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(db_err)?;
    migrate(&conn)?;
    Ok(conn)
}

/// 在**单个事务**内完成建表 → v2 迁移 → 版本号写入：中途崩溃/掉电不会留下
/// "列已加、版本未升"的半迁移状态（旧实现三段分开执行，坏库会导致下次启动永久失败）。
/// 可重入：`CREATE TABLE IF NOT EXISTS` 幂等；v2 迁移前先探测 `tags` 列是否已存在，
/// 即使历史版本崩溃留下了"列存在但版本仍为 1"的库，也能安全补齐版本号。
pub fn migrate(conn: &Connection) -> MendResult<()> {
    // unchecked_transaction：借用 &Connection 即可开启，便于在事务内复用仓储函数
    // （meta_get/meta_set 接收 &Connection，&Transaction 自动解引用传递）。
    let tx = conn.unchecked_transaction().map_err(db_err)?;
    tx.execute_batch(SCHEMA_V1).map_err(db_err)?;
    let current: i64 = meta_get(&tx, "schema_version")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    if current < 2 && !column_exists(&tx, "entries", "tags")? {
        tx.execute_batch(MIGRATION_V2).map_err(db_err)?;
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
                      WHERE e.category_id = c.id AND e.deleted_at IS NULL) AS entry_count
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

pub fn create_category(conn: &Connection, id: &str, name: &str) -> MendResult<()> {
    let ts = now_ms();
    let next_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories",
            [],
            |row| row.get(0),
        )
        .map_err(db_err)?;
    conn.execute(
        "INSERT INTO categories(id, name, sort_order, created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?4)",
        params![id, name, next_order, ts],
    )
    .map_err(db_err)?;
    Ok(())
}

pub fn rename_category(conn: &Connection, id: &str, name: &str) -> MendResult<()> {
    let changed = conn
        .execute(
            "UPDATE categories SET name = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, name, now_ms()],
        )
        .map_err(db_err)?;
    if changed == 0 {
        return Err(MendError::NotFound(format!("分类 {id}")));
    }
    Ok(())
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
    pub created_at: i64,
    pub updated_at: i64,
    /// 回收站时间戳：`None` = 正常条目，`Some(ms)` = 已软删除。
    pub deleted_at: Option<i64>,
}

pub fn insert_entry(conn: &Connection, row: &EntryRowEnc) -> MendResult<()> {
    let tags_json = tags_to_json(&row.tags)?;
    conn.execute(
        "INSERT INTO entries(id, category_id, title, url,
                             username_enc, password_enc, email_enc, phone_enc, notes_enc,
                             favorite, tags, created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
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

fn tags_to_json(tags: &[String]) -> MendResult<String> {
    serde_json::to_string(tags).map_err(|err| MendError::Db(format!("标签序列化失败: {err}")))
}

fn tags_from_json(raw: &str) -> MendResult<Vec<String>> {
    serde_json::from_str(raw).map_err(|err| MendError::Db(format!("标签数据损坏: {err}")))
}

pub fn get_entry(conn: &Connection, id: &str) -> MendResult<Option<EntryRowEnc>> {
    conn.query_row(
        "SELECT id, category_id, title, url, username_enc, password_enc, email_enc,
                phone_enc, notes_enc, favorite, tags, created_at, updated_at, deleted_at
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
                    phone_enc, notes_enc, favorite, tags, created_at, updated_at, deleted_at
               FROM entries
              WHERE deleted_at IS NULL
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
                    phone_enc, notes_enc, favorite, tags, created_at, updated_at, deleted_at
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

/// 软删除：只打 `deleted_at`，密文原样保留，可在回收站恢复。
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

fn map_entry_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<EntryRowEnc> {
    Ok(EntryRowEnc {
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
    })
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
            Some("2")
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
            Some("2")
        );
        assert!(column_exists(&conn, "entries", "tags").unwrap());
    }

    /// 事务化迁移在文件库上可安全重入：多次启动（每次 open_and_migrate 都跑一遍）
    /// 不报错、不重复 ALTER，版本号始终保持 2。
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
            Some("2")
        );
        assert!(column_exists(&conn, "entries", "tags").unwrap());
    }

    /// v1 旧库（无 tags 列）升级到 v2：加列成功且旧数据带默认空标签。
    #[test]
    fn v1_database_upgrades_to_v2_with_default_tags() {
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
            Some("2")
        );
        let rows = list_entries(&conn, None, None).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].tags.is_empty(), "旧条目升级后应为空标签");
    }

    #[test]
    fn deleting_category_keeps_entries_uncategorized() {
        let conn = mem_db();
        create_category(&conn, "cat-1", "工作").unwrap();
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
                created_at: 1,
                updated_at: 1,
                deleted_at: None,
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
        create_category(&conn, "cat-1", "工作").unwrap();
        insert_entry(&conn, &sample_row("e1", Some("cat-1"))).unwrap();
        assert_eq!(list_categories(&conn).unwrap()[0].entry_count, 1);
        assert_eq!(list_entries(&conn, Some("cat-1"), None).unwrap().len(), 1);
        assert!(list_entries(&conn, Some("cat-2"), None).unwrap().is_empty());
        assert_eq!(list_entries(&conn, None, Some("邮")).unwrap().len(), 1);
        assert!(list_entries(&conn, None, Some("不存在"))
            .unwrap()
            .is_empty());
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
            created_at: 1,
            updated_at: 1,
            deleted_at: None,
        }
    }
}
