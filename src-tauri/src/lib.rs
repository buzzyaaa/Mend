mod commands;

pub use mend_core::{backup, crypto, db, entries, error, generator, presets, session, sync, vault};

/// 应用入口：注册命令与会话状态。
/// 会话密钥只存在于 `VaultState` 内存中，锁定即销毁；数据库读写全部经命令层。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(session::VaultState::new())
        .invoke_handler(tauri::generate_handler![
            commands::vault_status,
            commands::vault_setup,
            commands::vault_unlock,
            commands::vault_lock,
            commands::category_list,
            commands::category_create,
            commands::category_rename,
            commands::category_delete,
            commands::entry_list,
            commands::entry_get,
            commands::entry_create,
            commands::entry_update,
            commands::entry_delete,
            commands::preset_list,
            commands::preset_create,
            commands::preset_update,
            commands::preset_delete,
            commands::generator_generate,
            commands::app_paths,
            commands::backup_export,
            commands::backup_import,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Mend")
}
