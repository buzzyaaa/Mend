mod commands;
mod error;

/// 应用入口：注册 Tauri 命令与窗口配置。
/// 阶段 2 起在此挂载数据库、加密会话与备份/同步模块。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::vault_status])
        .run(tauri::generate_context!())
        .expect("failed to run Mend")
}
