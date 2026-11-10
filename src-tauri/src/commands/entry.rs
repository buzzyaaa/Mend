//! 条目命令：只做参数搬运与状态守卫，加解密编排在 `mend-core` 的 entries 模块。
//! 契约见 `docs/03-architecture.md` §3 与 `docs/04-data-model-encryption.md` §3。

use tauri::{AppHandle, State};

use crate::commands::vault::open_db;
use crate::db;
use crate::entries::{decrypt_row, encrypt_input, EntryInput, EntryView};
use crate::error::{MendError, MendResult};
use crate::session::VaultState;

#[tauri::command]
pub fn entry_list(
    app: AppHandle,
    state: State<'_, VaultState>,
    category_id: Option<String>,
    keyword: Option<String>,
) -> MendResult<Vec<EntryView>> {
    let conn = open_db(&app)?;
    let keyword = keyword
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty());
    let rows = db::list_entries(&conn, category_id.as_deref(), keyword.as_deref())?;
    state.with_dek(|dek| {
        rows.iter()
            .map(|row| decrypt_row(dek, row))
            .collect::<MendResult<Vec<_>>>()
    })
}

#[tauri::command]
pub fn entry_get(
    app: AppHandle,
    state: State<'_, VaultState>,
    id: String,
) -> MendResult<EntryView> {
    let conn = open_db(&app)?;
    let row = db::get_entry(&conn, &id)?
        .ok_or_else(|| MendError::NotFound(format!("条目 {id}")))?;
    state.with_dek(|dek| decrypt_row(dek, &row))
}

#[tauri::command]
pub fn entry_create(
    app: AppHandle,
    state: State<'_, VaultState>,
    input: EntryInput,
) -> MendResult<EntryView> {
    let id = uuid::Uuid::new_v4().to_string();
    let mut row = state.with_dek(|dek| encrypt_input(dek, &id, &input, 0, 0))?;
    let now = db::now_ms();
    row.created_at = now;
    row.updated_at = now;
    let conn = open_db(&app)?;
    db::insert_entry(&conn, &row)?;
    state.with_dek(|dek| decrypt_row(dek, &row))
}

#[tauri::command]
pub fn entry_update(
    app: AppHandle,
    state: State<'_, VaultState>,
    id: String,
    input: EntryInput,
) -> MendResult<EntryView> {
    let conn = open_db(&app)?;
    let existing = db::get_entry(&conn, &id)?
        .ok_or_else(|| MendError::NotFound(format!("条目 {id}")))?;
    let now = db::now_ms();
    let row = state.with_dek(|dek| encrypt_input(dek, &id, &input, existing.created_at, now))?;
    db::update_entry(&conn, &row)?;
    state.with_dek(|dek| decrypt_row(dek, &row))
}

#[tauri::command]
pub fn entry_delete(app: AppHandle, state: State<'_, VaultState>, id: String) -> MendResult<()> {
    if !state.is_unlocked() {
        return Err(MendError::Vault("库未解锁".into()));
    }
    let conn = open_db(&app)?;
    db::delete_entry(&conn, &id)
}

/// 回收站列表：解锁态解密返回，含删除时间。
#[tauri::command]
pub fn entry_trash_list(
    app: AppHandle,
    state: State<'_, VaultState>,
) -> MendResult<Vec<EntryView>> {
    let conn = open_db(&app)?;
    let rows = db::list_trashed_entries(&conn)?;
    state.with_dek(|dek| {
        rows.iter()
            .map(|row| decrypt_row(dek, row))
            .collect::<MendResult<Vec<_>>>()
    })
}

#[tauri::command]
pub fn entry_restore(app: AppHandle, state: State<'_, VaultState>, id: String) -> MendResult<()> {
    if !state.is_unlocked() {
        return Err(MendError::Vault("库未解锁".into()));
    }
    let conn = open_db(&app)?;
    db::restore_entry(&conn, &id)
}

#[tauri::command]
pub fn entry_purge(app: AppHandle, state: State<'_, VaultState>, id: String) -> MendResult<()> {
    if !state.is_unlocked() {
        return Err(MendError::Vault("库未解锁".into()));
    }
    let conn = open_db(&app)?;
    db::purge_entry(&conn, &id)
}

#[tauri::command]
pub fn entry_purge_all(app: AppHandle, state: State<'_, VaultState>) -> MendResult<usize> {
    if !state.is_unlocked() {
        return Err(MendError::Vault("库未解锁".into()));
    }
    let conn = open_db(&app)?;
    db::purge_all_trashed(&conn)
}
