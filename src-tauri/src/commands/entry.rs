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

/// 归档列表：解锁态解密返回已归档条目（与回收站列表口径一致，单独返回）。
#[tauri::command]
pub fn entry_archive_list(
    app: AppHandle,
    state: State<'_, VaultState>,
) -> MendResult<Vec<EntryView>> {
    let conn = open_db(&app)?;
    let rows = db::list_archived_entries(&conn)?;
    state.with_dek(|dek| {
        rows.iter()
            .map(|row| decrypt_row(dek, row))
            .collect::<MendResult<Vec<_>>>()
    })
}

/// 归档条目：解锁守卫，`archived` 置 1（与 `deleted_at` 正交，不进回收站）。
#[tauri::command]
pub fn entry_archive(app: AppHandle, state: State<'_, VaultState>, id: String) -> MendResult<()> {
    if !state.is_unlocked() {
        return Err(MendError::Locked);
    }
    let conn = open_db(&app)?;
    db::archive_entry(&conn, &id)
}

/// 取消归档：`archived` 置 0，条目回到主列表。
#[tauri::command]
pub fn entry_unarchive(app: AppHandle, state: State<'_, VaultState>, id: String) -> MendResult<()> {
    if !state.is_unlocked() {
        return Err(MendError::Locked);
    }
    let conn = open_db(&app)?;
    db::unarchive_entry(&conn, &id)
}

/// 预留：单条详情查询，当前前端列表走 entry_list。
#[tauri::command]
pub fn entry_get(
    app: AppHandle,
    state: State<'_, VaultState>,
    id: String,
) -> MendResult<EntryView> {
    let conn = open_db(&app)?;
    let row =
        db::get_entry(&conn, &id)?.ok_or_else(|| MendError::NotFound(format!("条目 {id}")))?;
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
    // 新建条目排序号取同桶内 max+1：手动排序模式下新条目落在末尾（见 docs/04 §3）。
    row.sort_order = db::next_entry_sort_order(&conn, row.category_id.as_deref())?;
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
    let existing =
        db::get_entry(&conn, &id)?.ok_or_else(|| MendError::NotFound(format!("条目 {id}")))?;
    let now = db::now_ms();
    let row = state.with_dek(|dek| encrypt_input(dek, &id, &input, existing.created_at, now))?;
    db::update_entry(&conn, &row)?;
    state.with_dek(|dek| decrypt_row(dek, &row))
}

#[tauri::command]
pub fn entry_delete(app: AppHandle, state: State<'_, VaultState>, id: String) -> MendResult<()> {
    if !state.is_unlocked() {
        return Err(MendError::Locked);
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
        return Err(MendError::Locked);
    }
    let conn = open_db(&app)?;
    db::restore_entry(&conn, &id)
}

#[tauri::command]
pub fn entry_purge(app: AppHandle, state: State<'_, VaultState>, id: String) -> MendResult<()> {
    if !state.is_unlocked() {
        return Err(MendError::Locked);
    }
    let conn = open_db(&app)?;
    db::purge_entry(&conn, &id)
}

#[tauri::command]
pub fn entry_purge_all(app: AppHandle, state: State<'_, VaultState>) -> MendResult<usize> {
    if !state.is_unlocked() {
        return Err(MendError::Locked);
    }
    let conn = open_db(&app)?;
    db::purge_all_trashed(&conn)
}

/// 拖拽排序：前端传入当前桶内按拖拽结果排列的 id 列表，
/// 后端按顺序写入 `sort_order = 0..n-1`（单事务，整批原子）。
/// 只更新未删除条目；条目不存在时静默跳过（前端 id 与桶一致，正常不会发生）。
#[tauri::command]
pub fn entry_reorder(
    app: AppHandle,
    state: State<'_, VaultState>,
    ids: Vec<String>,
) -> MendResult<()> {
    if !state.is_unlocked() {
        return Err(MendError::Locked);
    }
    let conn = open_db(&app)?;
    db::reorder_entries(&conn, &ids)
}
