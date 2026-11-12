//! 金库生命周期命令：状态查询、首次建库、解锁、锁定。
//!
//! 建库/解锁的密钥编排在 `mend_core::vault`，本层只做路径解析与会话状态装载。
//! 密钥契约见 `docs/04-data-model-encryption.md`：主密码不落盘，DEK 由 KEK 包裹后存 `meta`。

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::db::{self, Connection};
use crate::error::{MendError, MendResult};
use crate::session::{Session, VaultState};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub initialized: bool,
    pub unlocked: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockResult {
    pub unlocked: bool,
}

pub(crate) fn db_path(app: &AppHandle) -> MendResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| MendError::Vault(format!("无法定位应用数据目录: {err}")))?;
    Ok(db::db_file_path(&dir))
}

pub(crate) fn open_db(app: &AppHandle) -> MendResult<Connection> {
    db::open_and_migrate(&db_path(app)?)
}

/// 查询初始化与解锁状态：启动时据此决定走设置主密码页、解锁页还是主界面。
#[tauri::command]
pub fn vault_status(app: AppHandle, state: State<'_, VaultState>) -> MendResult<VaultStatus> {
    let initialized = match open_db(&app) {
        Ok(conn) => db::is_initialized(&conn)?,
        Err(_) => false,
    };
    Ok(VaultStatus {
        initialized,
        unlocked: state.is_unlocked(),
    })
}

/// 首次建库：成功后 DEK 直接进入会话，无需再输一次主密码。
#[tauri::command]
pub fn vault_setup(
    app: AppHandle,
    state: State<'_, VaultState>,
    master_password: String,
) -> MendResult<UnlockResult> {
    let conn = open_db(&app)?;
    let keys = mend_core::vault::setup(&conn, &master_password)?;
    state.set_session(Session {
        dek: keys.dek,
        kdf: keys.kdf,
    })?;
    Ok(UnlockResult { unlocked: true })
}

/// 解锁：认证失败即主密码错误，密钥材料不进入会话。
#[tauri::command]
pub fn vault_unlock(
    app: AppHandle,
    state: State<'_, VaultState>,
    master_password: String,
) -> MendResult<UnlockResult> {
    let conn = open_db(&app)?;
    let keys = mend_core::vault::unlock(&conn, &master_password)?;
    state.set_session(Session {
        dek: keys.dek,
        kdf: keys.kdf,
    })?;
    Ok(UnlockResult { unlocked: true })
}

/// 锁定：销毁会话密钥，回到解锁页。
#[tauri::command]
pub fn vault_lock(state: State<'_, VaultState>) -> MendResult<()> {
    state.lock()
}

/// 修改主密码：仅解锁态可用；core 校验旧密码并事务内重包裹 DEK，会话 DEK 保持不变。
#[tauri::command]
pub fn vault_change_password(
    app: AppHandle,
    state: State<'_, VaultState>,
    old_password: String,
    new_password: String,
) -> MendResult<()> {
    if !state.is_unlocked() {
        return Err(MendError::Locked);
    }
    let conn = open_db(&app)?;
    mend_core::vault::change_password(&conn, &old_password, &new_password)?;
    Ok(())
}
