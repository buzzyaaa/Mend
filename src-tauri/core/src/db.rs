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

pub const SCHEMA_VERSION: i64 = 1;
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
        fs::create_dir_all(parent).map_err(|err| MendError::Db(format!("创建数据目录失败: {err}")))?;
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

pub fn migrate(conn: &Connection) -> MendResult<()> {
    conn.execute_batch(SCHEMA_V1).map_err(db_err)?;
    meta_set(conn, "schema_version", &SCHEMA_VERSION.to_string())
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
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn insert_entry(conn: &Connection, row: &EntryRowEnc) -> MendResult<()> {
    conn.execute(
        "INSERT INTO entries(id, category_id, title, url,
                             username_enc, password_enc, email_enc, phone_enc, notes_enc,
                             favorite, created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
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
            row.created_at,
            row.updated_at,
        ],
    )
    .map_err(db_err)?;
    Ok(())
}

pub fn update_entry(conn: &Connection, row: &EntryRowEnc) -> MendResult<()> {
    let changed = conn
        .execute(
            "UPDATE entries
                SET category_id = ?2, title = ?3, url = ?4,
                    username_enc = ?5, password_enc = ?6, email_enc = ?7,
                    phone_enc = ?8, notes_enc = ?9, favorite = ?10, updated_at = ?11
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
                row.updated_at,
            ],
        )
        .map_err(db_err)?;
    if changed == 0 {
        return Err(MendError::NotFound(format!("条目 {}", row.id)));
    }
    Ok(())
}

pub fn get_entry(conn: &Connection, id: &str) -> MendResult<Option<EntryRowEnc>> {
    conn.query_row(
        "SELECT id, category_id, title, url, username_enc, password_enc, email_enc,
                phone_enc, notes_enc, favorite, created_at, updated_at
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
                    phone_enc, notes_enc, favorite, created_at, updated_at
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

/// MVP 物理删除；`deleted_at` 为后续回收站预留。
pub fn delete_entry(conn: &Connection, id: &str) -> MendResult<()> {
    let changed = conn
        .execute("DELETE FROM entries WHERE id = ?1", params![id])
        .map_err(db_err)?;
    if changed == 0 {
        return Err(MendError::NotFound(format!("条目 {id}")));
    }
    Ok(())
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
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
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
            Some("1")
        );
        assert!(!is_initialized(&conn).unwrap());
        assert!(list_entries(&conn, None, None).unwrap().is_empty());
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
                created_at: 1,
                updated_at: 1,
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
        assert!(list_entries(&conn, None, Some("不存在")).unwrap().is_empty());
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
            created_at: 1,
            updated_at: 1,
        }
    }
}
