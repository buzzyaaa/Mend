//! 条目写入/读取的加解密编排：写路径逐字段加密后落库，读路径在解锁态解密成展示模型。
//!
//! 放在 core 而非命令层，是为了无 GUI 依赖即可测试"落盘无明文"这条硬约束。

use serde::{Deserialize, Serialize};

use crate::crypto::{decrypt_field, encrypt_field, field_aad, DEK_LEN};
use crate::db::EntryRowEnc;
use crate::error::{MendError, MendResult};

/// 前端提交的明文条目（仅内存与 IPC 传输，不落盘）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryInput {
    pub category_id: Option<String>,
    pub title: String,
    pub url: Option<String>,
    pub username: String,
    pub password: String,
    pub email: String,
    pub phone: String,
    pub notes: String,
    #[serde(default)]
    pub favorite: bool,
    /// 明文标签（IPC 传输与落库均为明文，语义同分类名）。
    #[serde(default)]
    pub tags: Vec<String>,
}

/// 解密后的展示模型（仅解锁态返回给前端）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryView {
    pub id: String,
    pub category_id: Option<String>,
    pub title: String,
    pub url: Option<String>,
    pub username: String,
    pub password: String,
    pub email: String,
    pub phone: String,
    pub notes: String,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    /// 回收站时间戳：正常条目为 null，回收站里为删除时间。
    pub deleted_at: Option<i64>,
    /// 归档标记：主列表恒为 false，归档列表恒为 true（与回收站正交）。
    pub archived: bool,
}

fn validate_title(input: &EntryInput) -> MendResult<String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(MendError::Vault("标题不能为空".into()));
    }
    if title.chars().count() > 120 {
        return Err(MendError::Vault("标题过长（上限 120 字）".into()));
    }
    Ok(title.to_string())
}

/// 标签上限：条目最多 16 个，单个最长 32 字（契约见 docs/04 §3）。
const MAX_TAGS: usize = 16;
const MAX_TAG_LEN: usize = 32;

fn validate_tags(input: &EntryInput) -> MendResult<Vec<String>> {
    let mut tags: Vec<String> = Vec::new();
    for raw in &input.tags {
        let tag = raw.trim().to_string();
        if tag.is_empty() || tags.iter().any(|t| t == &tag) {
            continue;
        }
        if tag.chars().count() > MAX_TAG_LEN {
            return Err(MendError::Vault(format!(
                "单个标签过长（上限 {MAX_TAG_LEN} 字）"
            )));
        }
        tags.push(tag);
    }
    if tags.len() > MAX_TAGS {
        return Err(MendError::Vault(format!("标签过多（上限 {MAX_TAGS} 个）")));
    }
    Ok(tags)
}

/// 明文入参 → 密文行。AAD 绑定 `entry_id:field`，故 id 必须先确定。
pub fn encrypt_input(
    dek: &[u8; DEK_LEN],
    id: &str,
    input: &EntryInput,
    created_at: i64,
    updated_at: i64,
) -> MendResult<EntryRowEnc> {
    let title = validate_title(input)?;
    Ok(EntryRowEnc {
        id: id.to_string(),
        category_id: input.category_id.clone(),
        title,
        url: input.url.clone().filter(|u| !u.trim().is_empty()),
        username_enc: encrypt_field(dek, &field_aad(id, "username"), &input.username)?,
        password_enc: encrypt_field(dek, &field_aad(id, "password"), &input.password)?,
        email_enc: encrypt_field(dek, &field_aad(id, "email"), &input.email)?,
        phone_enc: encrypt_field(dek, &field_aad(id, "phone"), &input.phone)?,
        notes_enc: encrypt_field(dek, &field_aad(id, "notes"), &input.notes)?,
        favorite: input.favorite,
        tags: validate_tags(input)?,
        // 手动排序号不在明文入参里：新建条目由命令层按桶内 max+1 赋值（见 db.rs）。
        sort_order: 0,
        created_at,
        updated_at,
        deleted_at: None,
        // 新建条目一律未归档（archived 由「归档 / 取消归档」命令单独维护）。
        archived: false,
    })
}

/// 密文行 → 展示模型。
pub fn decrypt_row(dek: &[u8; DEK_LEN], row: &EntryRowEnc) -> MendResult<EntryView> {
    Ok(EntryView {
        id: row.id.clone(),
        category_id: row.category_id.clone(),
        title: row.title.clone(),
        url: row.url.clone(),
        username: decrypt_field(dek, &field_aad(&row.id, "username"), &row.username_enc)?,
        password: decrypt_field(dek, &field_aad(&row.id, "password"), &row.password_enc)?,
        email: decrypt_field(dek, &field_aad(&row.id, "email"), &row.email_enc)?,
        phone: decrypt_field(dek, &field_aad(&row.id, "phone"), &row.phone_enc)?,
        notes: decrypt_field(dek, &field_aad(&row.id, "notes"), &row.notes_enc)?,
        favorite: row.favorite,
        tags: row.tags.clone(),
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
        archived: row.archived,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::*;
    use crate::db;

    const DEK: [u8; DEK_LEN] = [7u8; DEK_LEN];

    fn temp_db(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mend-core-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("创建临时目录");
        dir.join(db::DB_FILE_NAME)
    }

    fn bytes_contains(haystack: &[u8], needle: &str) -> bool {
        let pattern = needle.as_bytes();
        haystack.windows(pattern.len()).any(|w| w == pattern)
    }

    fn sample_input() -> EntryInput {
        EntryInput {
            category_id: None,
            title: "工作邮箱".into(),
            url: Some("https://example.com".into()),
            username: "alice-明文".into(),
            password: "p@ssw0rd-明文".into(),
            email: "alice@example.com-明文".into(),
            phone: "13800138000-明文".into(),
            notes: "备注-明文".into(),
            favorite: false,
            tags: vec!["工作".into(), " 邮箱 ".into(), "工作".into()],
        }
    }

    /// 验收核心：库里存的是密文，原始文件字节里查不到任何敏感明文。
    #[test]
    fn encrypted_entry_has_no_plaintext_on_disk() {
        let path = temp_db("plaintext");
        let conn = db::open_and_migrate(&path).expect("建库");
        let input = sample_input();
        let row = encrypt_input(&DEK, "entry-1", &input, 1, 1).expect("加密");
        db::insert_entry(&conn, &row).expect("写库");
        drop(conn);

        let raw = fs::read(&path).expect("读库文件");

        // 反向对照：标题是明文列，应能在文件里找到（证明读到的确实是这份库）
        assert!(bytes_contains(&raw, "工作邮箱"), "标题应作为明文元信息存在");

        for secret in [
            "alice-明文",
            "p@ssw0rd-明文",
            "alice@example.com-明文",
            "13800138000-明文",
            "备注-明文",
        ] {
            assert!(
                !bytes_contains(&raw, secret),
                "数据库文件中不应出现明文：{secret}"
            );
        }

        let _ = fs::remove_dir_all(path.parent().expect("父目录"));
    }

    /// 同一 DEK 下写入再读回，敏感字段应完整还原。
    #[test]
    fn encrypt_then_decrypt_roundtrip() {
        let input = sample_input();
        let row = encrypt_input(&DEK, "entry-2", &input, 1, 2).expect("加密");
        let view = decrypt_row(&DEK, &row).expect("解密");
        assert_eq!(view.username, input.username);
        assert_eq!(view.password, input.password);
        assert_eq!(view.email, input.email);
        assert_eq!(view.phone, input.phone);
        assert_eq!(view.notes, input.notes);
        // 标签 normalize：trim、去空、去重后保留顺序。
        assert_eq!(view.tags, vec!["工作".to_string(), "邮箱".to_string()]);
        assert_eq!(view.created_at, 1);
        assert_eq!(view.updated_at, 2);
    }

    /// AAD 绑定条目 id：用另一条目 id 解密同一密文必须失败。
    #[test]
    fn decrypt_rejects_foreign_entry_id() {
        let input = sample_input();
        let row = encrypt_input(&DEK, "entry-3", &input, 0, 0).expect("加密");
        let mut moved = row.clone();
        moved.id = "entry-4".into();
        assert!(decrypt_row(&DEK, &moved).is_err());
    }

    /// 标题为空应被拒绝，且不产生任何落库行。
    #[test]
    fn empty_title_is_rejected() {
        let mut input = sample_input();
        input.title = "   ".into();
        assert!(encrypt_input(&DEK, "entry-5", &input, 0, 0).is_err());
        input.title = "正常标题".into();
        assert!(encrypt_input(&DEK, "entry-5", &input, 0, 0).is_ok());
    }
}
