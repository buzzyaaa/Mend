use serde::Serialize;

/// 统一错误类型。命令层把错误转换为可序列化形式返回前端，
/// 前端按错误码映射 i18n 词条（见 docs/07-i18n.md §5）。
#[derive(Debug, thiserror::Error)]
pub enum MendError {
    #[error("vault error: {0}")]
    Vault(String),

    #[error("database error: {0}")]
    Db(String),

    #[error("crypto error: {0}")]
    Crypto(String),

    #[error("not found: {0}")]
    NotFound(String),
}

impl Serialize for MendError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<MendError> for String {
    fn from(err: MendError) -> Self {
        err.to_string()
    }
}

#[allow(dead_code)]
pub type MendResult<T> = Result<T, MendError>;
