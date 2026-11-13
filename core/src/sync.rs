//! WebDAV 同步预留（阶段 5 只落结构与配置，**不发起任何网络请求**）。
//!
//! 后续接入时只需实现 [`VaultSync`]，上传对象始终是整库加密快照。设计见
//! `docs/06-backup-webdav.md` §4。

use serde::{Deserialize, Serialize};

use crate::error::{MendError, MendResult};

/// WebDAV 连接配置：`app_password` 只用于远端访问，且必须以密文形式存储
/// （落 `meta` 表时用 `crypto::encrypt_field`），与主密码用途分离。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebdavConfig {
    pub base_url: String,
    pub username: String,
    /// 已加密的密码字段（`meta` 表中存的就是这个值）；明文只在内存里短暂存在。
    pub app_password_encrypted: Option<String>,
    pub remote_path: String,
    /// MVP 恒为 false：设置页只显示"未启用"。
    pub enabled: bool,
}

impl WebdavConfig {
    /// 配置是否足以发起同步（阶段 5 恒为 false）。
    pub fn is_ready(&self) -> bool {
        self.enabled
            && !self.base_url.trim().is_empty()
            && !self.username.trim().is_empty()
            && self.app_password_encrypted.is_some()
            && !self.remote_path.trim().is_empty()
    }
}

/// 同步能力抽象：远端只存密文快照，下载后必须先校验再替换本地库。
pub trait VaultSync {
    fn test_connection(&self, config: &WebdavConfig) -> MendResult<()>;
    fn upload(&self, config: &WebdavConfig, snapshot: &[u8]) -> MendResult<()>;
    fn download(&self, config: &WebdavConfig) -> MendResult<Vec<u8>>;
}

/// 未实现的占位实现：任何调用都明确报错，避免误以为已联网。
pub struct DisabledSync;

impl VaultSync for DisabledSync {
    fn test_connection(&self, _config: &WebdavConfig) -> MendResult<()> {
        Err(MendError::Vault("WebDAV 同步尚未启用".into()))
    }

    fn upload(&self, _config: &WebdavConfig, _snapshot: &[u8]) -> MendResult<()> {
        Err(MendError::Vault("WebDAV 同步尚未启用".into()))
    }

    fn download(&self, _config: &WebdavConfig) -> MendResult<Vec<u8>> {
        Err(MendError::Vault("WebDAV 同步尚未启用".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_is_disabled_and_not_ready() {
        let config = WebdavConfig::default();
        assert!(!config.enabled);
        assert!(!config.is_ready());
    }

    #[test]
    fn disabled_sync_reports_not_enabled() {
        let sync = DisabledSync;
        assert!(sync.test_connection(&WebdavConfig::default()).is_err());
        assert!(sync.upload(&WebdavConfig::default(), b"x").is_err());
        assert!(sync.download(&WebdavConfig::default()).is_err());
    }
}
