//! 金库生命周期（不含进程内会话状态）：首次建库、解锁校验。
//!
//! 主密码不落盘；DEK 由主密码派生的 KEK 包裹后存 `meta`。契约见
//! `docs/04-data-model-encryption.md` §1。放在 core 里便于无 GUI 测试。

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use zeroize::Zeroizing;

use crate::crypto::{self, KdfParams, DEK_LEN};
use crate::db::{self, Connection};
use crate::error::{MendError, MendResult};

const META_SALT: &str = "salt";
const META_KDF: &str = "kdf_params";
const META_DEK: &str = "dek_wrapped";

/// 主密码最短长度：自用工具，只挡住"1 位"这类误设，强度提示交给前端。
pub const MIN_PASSWORD_LEN: usize = 4;

/// 解锁后可用的密钥材料：DEK 与其派生参数。DEK 用 Zeroizing，离开作用域即清零。
pub struct VaultKeys {
    pub dek: Zeroizing<[u8; DEK_LEN]>,
    pub kdf: KdfParams,
}

impl VaultKeys {
    /// 便于测试比较，不在生产路径使用。
    pub fn dek_bytes(&self) -> [u8; DEK_LEN] {
        *self.dek
    }
}

/// 首次初始化：生成 salt 与 DEK，包裹后写 `meta`，返回会话可用的 DEK。
pub fn setup(conn: &Connection, master_password: &str) -> MendResult<VaultKeys> {
    if master_password.trim().is_empty() {
        return Err(MendError::Vault("主密码不能为空".into()));
    }
    if master_password.chars().count() < MIN_PASSWORD_LEN {
        return Err(MendError::Vault(format!(
            "主密码至少 {MIN_PASSWORD_LEN} 位"
        )));
    }
    if db::is_initialized(conn)? {
        return Err(MendError::Vault("库已初始化".into()));
    }

    let salt = crypto::random_salt();
    let params = KdfParams::default();
    let kek = crypto::derive_kek(master_password, &salt, params)?;
    let dek = crypto::random_dek();
    let wrapped = crypto::wrap_dek(&kek, &dek)?;

    db::meta_set(conn, META_SALT, &B64.encode(salt))?;
    db::meta_set(conn, META_KDF, &params.to_meta_value())?;
    db::meta_set(conn, META_DEK, &wrapped)?;

    // KEK 用完即弃（Zeroizing 负责清零）。
    drop(kek);

    Ok(VaultKeys { dek, kdf: params })
}

/// 解锁：读 salt/KDF 参数 → 派生 KEK → 解包 DEK；认证失败视为主密码错误。
pub fn unlock(conn: &Connection, master_password: &str) -> MendResult<VaultKeys> {
    if master_password.is_empty() {
        return Err(MendError::Vault("主密码不能为空".into()));
    }
    if !db::is_initialized(conn)? {
        return Err(MendError::Vault("库尚未初始化".into()));
    }

    let salt_b64 = db::meta_get(conn, META_SALT)?
        .ok_or_else(|| MendError::Db("缺少 salt".into()))?;
    let salt = B64
        .decode(salt_b64)
        .map_err(|_| MendError::Db("salt 数据损坏".into()))?;
    let params = db::meta_get(conn, META_KDF)?
        .ok_or_else(|| MendError::Db("缺少 KDF 参数".into()))
        .and_then(|value| KdfParams::from_meta_value(&value))?;
    let wrapped = db::meta_get(conn, META_DEK)?
        .ok_or_else(|| MendError::Db("缺少 DEK".into()))?;

    let kek = crypto::derive_kek(master_password, &salt, params)?;
    let dek = crypto::unwrap_dek(&kek, &wrapped)?;
    drop(kek);

    Ok(VaultKeys { dek, kdf: params })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::*;

    fn temp_db(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mend-core-vault-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("创建临时目录");
        dir.join(db::DB_FILE_NAME)
    }

    #[test]
    fn setup_then_unlock_with_same_password() {
        let path = temp_db("roundtrip");
        let conn = db::open_and_migrate(&path).expect("建库");

        let created = setup(&conn, "correct horse battery staple").expect("初始化");
        let opened = unlock(&conn, "correct horse battery staple").expect("解锁");

        assert_eq!(created.dek_bytes(), opened.dek_bytes(), "同一主密码应解出同一 DEK");
        assert!(db::is_initialized(&conn).expect("查询初始化状态"));

        let _ = fs::remove_dir_all(path.parent().expect("父目录"));
    }

    #[test]
    fn unlock_fails_with_wrong_password() {
        let path = temp_db("wrongpw");
        let conn = db::open_and_migrate(&path).expect("建库");
        setup(&conn, "right-password").expect("初始化");

        assert!(unlock(&conn, "wrong-password").is_err(), "错误主密码必须失败");

        let _ = fs::remove_dir_all(path.parent().expect("父目录"));
    }

    #[test]
    fn setup_is_rejected_when_already_initialized() {
        let path = temp_db("twice");
        let conn = db::open_and_migrate(&path).expect("建库");
        setup(&conn, "first").expect("初始化");
        assert!(setup(&conn, "second").is_err(), "已初始化后不得重复建库");

        let _ = fs::remove_dir_all(path.parent().expect("父目录"));
    }

    #[test]
    fn empty_password_is_rejected() {
        let path = temp_db("empty");
        let conn = db::open_and_migrate(&path).expect("建库");
        assert!(setup(&conn, "   ").is_err());

        let _ = fs::remove_dir_all(path.parent().expect("父目录"));
    }

    #[test]
    fn too_short_password_is_rejected() {
        let path = temp_db("short");
        let conn = db::open_and_migrate(&path).expect("建库");
        assert!(setup(&conn, "123").is_err(), "3 位应被拒绝");
        assert!(setup(&conn, "1234").is_ok(), "4 位应被接受");

        let _ = fs::remove_dir_all(path.parent().expect("父目录"));
    }

    /// 主密码与 DEK 都不应以明文形式出现在库文件中。
    #[test]
    fn key_material_is_not_written_in_plaintext() {
        let path = temp_db("nokey");
        let conn = db::open_and_migrate(&path).expect("建库");
        let password = "master-password-明文标记";
        setup(&conn, password).expect("初始化");
        drop(conn);

        let raw = fs::read(&path).expect("读库文件");
        assert!(
            !raw.windows(password.len()).any(|w| w == password.as_bytes()),
            "库文件中不应出现主密码明文"
        );

        let _ = fs::remove_dir_all(path.parent().expect("父目录"));
    }
}
