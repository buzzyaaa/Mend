use serde::Serialize;

/// 统一错误类型。命令层把错误序列化为结构化对象 `{ code, message }` 返回前端，
/// 前端按 `code` 映射 i18n 词条（见 docs/07-i18n.md §5），`message` 仅作兜底展示。
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

    /// 会话守卫：库未解锁。区别于一般 Vault 错误，前端按 `locked` 码
    /// 统一跳回解锁页，而不是弹提示。
    #[error("vault locked")]
    Locked,
}

impl MendError {
    /// 稳定的 snake_case 错误码，作为前后端契约（docs/03 §3、docs/07 §5），
    /// 只增不改：新增错误场景优先复用既有码，确需新码时同步文档与前端词条。
    pub fn code(&self) -> &'static str {
        match self {
            MendError::Vault(_) => "vault",
            MendError::Db(_) => "db",
            MendError::Crypto(_) => "crypto",
            MendError::NotFound(_) => "not_found",
            MendError::Locked => "locked",
        }
    }

    /// 面向用户的中文消息（兜底展示用）；分支逻辑一律走 `code()`。
    fn user_message(&self) -> String {
        match self {
            MendError::Vault(msg)
            | MendError::Db(msg)
            | MendError::Crypto(msg)
            | MendError::NotFound(msg) => msg.clone(),
            MendError::Locked => "库未解锁".to_string(),
        }
    }
}

/// 序列化为 `{ "code": "...", "message": "..." }` 对象。
/// 前端不得再对 message 做中文子串匹配（违反 docs/07 §5）。
impl Serialize for MendError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("MendError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.user_message())?;
        state.end()
    }
}

impl From<MendError> for String {
    fn from(err: MendError) -> Self {
        err.to_string()
    }
}

#[allow(dead_code)]
pub type MendResult<T> = Result<T, MendError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_to_structured_code_and_message() {
        let json = serde_json::to_string(&MendError::Locked).unwrap();
        assert!(json.contains("\"code\":\"locked\""), "{json}");
        assert!(json.contains("\"message\":\"库未解锁\""), "{json}");

        let value = serde_json::to_value(MendError::Vault("主密码错误".into())).unwrap();
        assert_eq!(value["code"], "vault");
        assert_eq!(value["message"], "主密码错误");
    }

    #[test]
    fn error_codes_are_stable() {
        let cases = [
            (MendError::Vault("x".into()), "vault"),
            (MendError::Db("x".into()), "db"),
            (MendError::Crypto("x".into()), "crypto"),
            (MendError::NotFound("x".into()), "not_found"),
            (MendError::Locked, "locked"),
        ];
        for (err, expected) in cases {
            assert_eq!(err.code(), expected);
            let value = serde_json::to_value(&err).unwrap();
            assert_eq!(value["code"], expected);
            assert!(value["message"].is_string(), "message 必须存在以便兜底展示");
        }
    }

    #[test]
    fn into_string_conversion_still_available() {
        let s: String = MendError::NotFound("条目 e1".into()).into();
        assert!(s.contains("not found"));
    }
}
