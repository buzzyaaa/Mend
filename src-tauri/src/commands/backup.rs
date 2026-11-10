//! 备份与恢复命令：导出加密 `.mendbak`、从备份恢复整库、展示数据目录。
//!
//! 口径见 `docs/06-backup-webdav.md`：
//! - 导出 = 整库快照 + 主密码派生密钥加密，文件名不含敏感信息；
//! - 导入 = 先解密到临时文件并校验（能打开、meta 可读、主密码可解包 DEK），
//!   通过后再把现有库改名留底，最后替换，失败不覆盖现有库。

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::backup;
use crate::commands::vault::{db_path, open_db};
use crate::db;
use crate::error::{MendError, MendResult};
use crate::session::VaultState;
use crate::vault;

const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub data_dir: String,
    pub db_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub entries: usize,
    pub categories: usize,
    /// 被替换的旧库留底文件名（同目录），便于回滚。
    pub previous_backup: Option<String>,
}

fn data_dir(app: &AppHandle) -> MendResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|err| MendError::Vault(format!("无法定位应用数据目录: {err}")))
}

/// 展示数据目录：设置页据此告诉用户库文件在哪，便于手动拷贝。
#[tauri::command]
pub fn app_paths(app: AppHandle) -> MendResult<AppPaths> {
    let dir = data_dir(&app)?;
    Ok(AppPaths {
        data_dir: dir.display().to_string(),
        db_path: db::db_file_path(&dir).display().to_string(),
    })
}

/// 导出加密备份。`master_password` 用于派生备份密钥并校验与当前会话一致。
#[tauri::command]
pub fn backup_export(
    app: AppHandle,
    state: State<'_, VaultState>,
    path: String,
    master_password: String,
) -> MendResult<ExportResult> {
    if !state.is_unlocked() {
        return Err(MendError::Vault("库未解锁".into()));
    }

    let conn = open_db(&app)?;
    let (kek, dek, salt, kdf) = vault::derive_kek_and_unwrap(&conn, &master_password)?;
    let same_dek = state.with_dek(|session| Ok(*session == *dek))?;
    if !same_dek {
        return Err(MendError::Vault("主密码与当前库不匹配".into()));
    }

    let source = db_path(&app)?;
    let db_bytes = fs::read(&source)
        .map_err(|err| MendError::Vault(format!("读取库文件失败: {err}")))?;

    let blob = backup::export(&db_bytes, &kek, &salt, kdf)?;

    let target = PathBuf::from(path.trim());
    if target.as_os_str().is_empty() {
        return Err(MendError::Vault("请填写备份文件路径".into()));
    }
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|err| MendError::Vault(format!("创建备份目录失败: {err}")))?;
        }
    }
    fs::write(&target, &blob).map_err(|err| MendError::Vault(format!("写入备份失败: {err}")))?;

    Ok(ExportResult {
        path: target.display().to_string(),
        bytes: blob.len() as u64,
    })
}

/// 从 `.mendbak` 恢复。成功后必定锁定会话，前端需跳回解锁页用原主密码解锁。
#[tauri::command]
pub fn backup_import(
    app: AppHandle,
    state: State<'_, VaultState>,
    path: String,
    master_password: String,
) -> MendResult<ImportResult> {
    let source = PathBuf::from(path.trim());
    let blob = fs::read(&source)
        .map_err(|err| MendError::Vault(format!("读取备份文件失败: {err}")))?;
    if !backup::is_backup(&blob) {
        return Err(MendError::Vault("不是有效的 Mend 备份文件".into()));
    }

    // 解密到临时文件，全部校验通过后才动现有库
    let payload = backup::import(&blob, &master_password)?;
    if payload.len() < SQLITE_MAGIC.len() || &payload[..SQLITE_MAGIC.len()] != SQLITE_MAGIC {
        return Err(MendError::Vault("备份内容不是有效的数据库文件".into()));
    }

    let dir = data_dir(&app)?;
    let temp = dir.join(format!("mend-import-{}.db", uuid::Uuid::new_v4()));
    if let Err(err) = fs::write(&temp, &payload) {
        let _ = fs::remove_file(&temp);
        return Err(MendError::Vault(format!("写入临时文件失败: {err}")));
    }

    let checked = validate_backup(&temp, &master_password);
    let counts = match checked {
        Ok(counts) => counts,
        Err(err) => {
            let _ = fs::remove_file(&temp);
            return Err(err);
        }
    };

    let target = db_path(&app)?;
    state.lock()?;

    let previous_backup = if target.exists() {
        let stamp = db::now_ms();
        let backup_name = format!("{}.bak-{}", db::DB_FILE_NAME, stamp);
        let backup_path = dir.join(&backup_name);
        if let Err(err) = fs::rename(&target, &backup_path) {
            let _ = fs::remove_file(&temp);
            return Err(MendError::Vault(format!("替换前留底失败: {err}")));
        }
        Some(backup_name)
    } else {
        None
    };

    if let Err(err) = fs::rename(&temp, &target) {
        // 回滚：把留底的旧库放回去，避免把用户留在"没有库"的状态
        if let Some(name) = &previous_backup {
            let _ = fs::rename(dir.join(name), &target);
        }
        let _ = fs::remove_file(&temp);
        return Err(MendError::Vault(format!("替换库文件失败: {err}")));
    }

    Ok(ImportResult {
        entries: counts.0,
        categories: counts.1,
        previous_backup,
    })
}

/// 校验临时库：能打开、已初始化、主密码可解包 DEK，并统计条目/分类数。
fn validate_backup(path: &Path, master_password: &str) -> MendResult<(usize, usize)> {
    let conn = db::open_and_migrate(path)?;
    if !db::is_initialized(&conn)? {
        return Err(MendError::Vault("备份中的库尚未初始化".into()));
    }
    vault::unlock(&conn, master_password)?;

    let entries = db::list_entries(&conn, None, None)?.len();
    let categories = db::list_categories(&conn)?.len();
    Ok((entries, categories))
}
