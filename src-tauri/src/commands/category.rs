//! 分类命令：列表、新增、重命名、删除。
//! 删除分类时其下条目归"未分类"（见 `docs/04-data-model-encryption.md` §3）。

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::commands::vault::open_db;
use crate::db;
use crate::error::{MendError, MendResult};
use crate::session::VaultState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub sort_order: i64,
    pub entry_count: i64,
}

impl From<db::CategoryRow> for Category {
    fn from(row: db::CategoryRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            color: row.color,
            icon: row.icon,
            sort_order: row.sort_order,
            entry_count: row.entry_count,
        }
    }
}

#[tauri::command]
pub fn category_list(app: AppHandle, state: State<'_, VaultState>) -> MendResult<Vec<Category>> {
    require_unlocked(&state)?;
    let conn = open_db(&app)?;
    Ok(db::list_categories(&conn)?.into_iter().map(Into::into).collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryInput {
    pub name: String,
}

#[tauri::command]
pub fn category_create(
    app: AppHandle,
    state: State<'_, VaultState>,
    input: CategoryInput,
) -> MendResult<Category> {
    require_unlocked(&state)?;
    let name = validate_name(&input.name)?;
    let conn = open_db(&app)?;
    let id = uuid::Uuid::new_v4().to_string();
    db::create_category(&conn, &id, &name)?;
    let row = db::list_categories(&conn)?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| MendError::NotFound("新建分类".into()))?;
    Ok(row.into())
}

#[tauri::command]
pub fn category_rename(
    app: AppHandle,
    state: State<'_, VaultState>,
    id: String,
    input: CategoryInput,
) -> MendResult<()> {
    require_unlocked(&state)?;
    let name = validate_name(&input.name)?;
    let conn = open_db(&app)?;
    db::rename_category(&conn, &id, &name)
}

#[tauri::command]
pub fn category_delete(app: AppHandle, state: State<'_, VaultState>, id: String) -> MendResult<()> {
    require_unlocked(&state)?;
    let conn = open_db(&app)?;
    db::delete_category(&conn, &id)
}

fn validate_name(raw: &str) -> MendResult<String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(MendError::Vault("分类名不能为空".into()));
    }
    if name.chars().count() > 40 {
        return Err(MendError::Vault("分类名过长（上限 40 字）".into()));
    }
    Ok(name.to_string())
}

fn require_unlocked(state: &State<'_, VaultState>) -> MendResult<()> {
    if state.is_unlocked() {
        Ok(())
    } else {
        Err(MendError::Vault("库未解锁".into()))
    }
}
