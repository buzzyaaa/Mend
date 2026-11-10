use serde::Serialize;

/// 金库状态，与前端 `VaultStatus` 类型对齐（docs/03-architecture.md §3）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub initialized: bool,
    pub unlocked: bool,
}

/// 查询金库初始化与解锁状态。
/// 阶段 2 接入真实数据库与会话密钥；当前为骨架占位返回。
#[tauri::command]
pub fn vault_status() -> VaultStatus {
    VaultStatus {
        initialized: false,
        unlocked: false,
    }
}

// 后续命令按领域拆分到独立文件：
// category.rs / entry.rs / preset.rs / generator.rs / backup.rs / sync.rs
// 命令契约见 docs/03-architecture.md §3 与 docs/04-data-model-encryption.md。
