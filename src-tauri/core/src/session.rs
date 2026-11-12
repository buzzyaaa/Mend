//! 进程内会话状态：解锁后 DEK 只驻留内存，锁定即丢弃并清零。
//!
//! 见 `docs/04-data-model-encryption.md` §1、`docs/03-architecture.md` §3。
//! 放在 core 里是为了能在无 GUI 环境下测试"锁定后密钥不可再用"。

use std::sync::Mutex;

use zeroize::Zeroizing;

use crate::crypto::{KdfParams, DEK_LEN};
use crate::error::{MendError, MendResult};

pub struct Session {
    pub dek: Zeroizing<[u8; DEK_LEN]>,
    #[allow(dead_code)]
    pub kdf: KdfParams,
}

#[derive(Default)]
pub struct VaultState {
    session: Mutex<Option<Session>>,
}

impl VaultState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_unlocked(&self) -> bool {
        self.session
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    pub fn set_session(&self, session: Session) -> MendResult<()> {
        let mut guard = self
            .session
            .lock()
            .map_err(|_| MendError::Vault("会话状态锁已损坏".into()))?;
        *guard = Some(session);
        Ok(())
    }

    /// 销毁会话密钥：替换为 None 后，旧 Session 立即 Drop，`Zeroizing` 负责清零。
    pub fn lock(&self) -> MendResult<()> {
        let mut guard = self
            .session
            .lock()
            .map_err(|_| MendError::Vault("会话状态锁已损坏".into()))?;
        *guard = None;
        Ok(())
    }

    /// 在解锁态下执行需要 DEK 的操作；DEK 只在闭包内短暂使用。
    pub fn with_dek<R>(&self, f: impl FnOnce(&[u8; DEK_LEN]) -> MendResult<R>) -> MendResult<R> {
        let guard = self
            .session
            .lock()
            .map_err(|_| MendError::Vault("会话状态锁已损坏".into()))?;
        match guard.as_ref() {
            Some(session) => f(&session.dek),
            None => Err(MendError::Locked),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> Session {
        Session {
            dek: Zeroizing::new([9u8; DEK_LEN]),
            kdf: KdfParams::default(),
        }
    }

    #[test]
    fn locked_state_rejects_dek_access() {
        let state = VaultState::new();
        assert!(!state.is_unlocked());
        assert!(state.with_dek(|_| Ok(())).is_err(), "未解锁时不得访问 DEK");
    }

    #[test]
    fn lock_destroys_session() {
        let state = VaultState::new();
        state.set_session(session()).expect("装载会话");
        assert!(state.is_unlocked());
        assert_eq!(
            state.with_dek(|dek| Ok(*dek)).expect("读取 DEK"),
            [9u8; DEK_LEN]
        );

        state.lock().expect("锁定");
        assert!(!state.is_unlocked(), "锁定后不应再处于解锁态");
        assert!(state.with_dek(|_| Ok(())).is_err(), "锁定后 DEK 必须不可用");
    }
}
