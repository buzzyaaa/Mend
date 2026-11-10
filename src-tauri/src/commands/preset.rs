//! 预设值命令：值在 Rust 侧加密落库，读回时解密；未解锁一律拒绝。
//! 契约见 `docs/03-architecture.md` §3 与 `docs/04-data-model-encryption.md` §2.4。

use tauri::{AppHandle, State};

use crate::commands::vault::open_db;
use crate::db;
use crate::error::{MendError, MendResult};
use crate::presets::{decrypt_row, encrypt_input, PresetInput, PresetView};
use crate::session::VaultState;

#[tauri::command]
pub fn preset_list(app: AppHandle, state: State<'_, VaultState>) -> MendResult<Vec<PresetView>> {
    let conn = open_db(&app)?;
    let rows = db::list_presets(&conn)?;
    state.with_dek(|dek| {
        rows.iter()
            .map(|row| decrypt_row(dek, row))
            .collect::<MendResult<Vec<_>>>()
    })
}

#[tauri::command]
pub fn preset_create(
    app: AppHandle,
    state: State<'_, VaultState>,
    input: PresetInput,
) -> MendResult<PresetView> {
    let id = uuid::Uuid::new_v4().to_string();
    let conn = open_db(&app)?;
    let sort_order = db::next_preset_sort(&conn)?;
    let row = state.with_dek(|dek| encrypt_input(dek, &id, &input, sort_order, db::now_ms()))?;
    db::insert_preset(&conn, &row)?;
    state.with_dek(|dek| decrypt_row(dek, &row))
}

#[tauri::command]
pub fn preset_update(
    app: AppHandle,
    state: State<'_, VaultState>,
    id: String,
    input: PresetInput,
) -> MendResult<PresetView> {
    let conn = open_db(&app)?;
    let existing = db::list_presets(&conn)?
        .into_iter()
        .find(|row| row.id == id)
        .ok_or_else(|| MendError::NotFound(format!("预设 {id}")))?;
    let row = state.with_dek(|dek| {
        encrypt_input(dek, &id, &input, existing.sort_order, existing.created_at)
    })?;
    db::update_preset(&conn, &row)?;
    state.with_dek(|dek| decrypt_row(dek, &row))
}

#[tauri::command]
pub fn preset_delete(app: AppHandle, state: State<'_, VaultState>, id: String) -> MendResult<()> {
    if !state.is_unlocked() {
        return Err(MendError::Vault("库未解锁".into()));
    }
    let conn = open_db(&app)?;
    db::delete_preset(&conn, &id)
}
