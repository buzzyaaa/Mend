//! 应用内加密备份（`.mendbak`）：格式 = 魔数 + 版本 + 盐 + KDF 参数 + nonce + 认证密文。
//!
//! 备份内容为整份 SQLite 库文件的密文；密钥由"导出时输入的主密码 + 库内 KDF 参数"派生，
//! 因此换机器后可用同一主密码恢复。格式定义见 `docs/06-backup-webdav.md` §3。

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::rngs::OsRng;
use rand::RngCore;

use crate::crypto::{derive_kek, KdfParams, DEK_LEN, NONCE_LEN, SALT_LEN};
use crate::error::{MendError, MendResult};

/// 魔数（含版本 01），后续版本递增末尾数字。
pub const MAGIC: &[u8; 8] = b"MENDBK01";
const AAD: &[u8] = b"mend:backup:v1";
const HEADER_LEN: usize = 8 + SALT_LEN + 12 + NONCE_LEN;

pub fn is_backup(blob: &[u8]) -> bool {
    blob.len() > HEADER_LEN && &blob[0..8] == MAGIC
}

/// 用已派生的 KEK 加密整库快照，返回 `.mendbak` 字节。
pub fn export(
    db_bytes: &[u8],
    kek: &[u8; DEK_LEN],
    salt: &[u8; SALT_LEN],
    kdf: KdfParams,
) -> MendResult<Vec<u8>> {
    let cipher = XChaCha20Poly1305::new(chacha20poly1305::Key::from_slice(kek));
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);

    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: db_bytes,
                aad: AAD,
            },
        )
        .map_err(|_| MendError::Crypto("备份加密失败".into()))?;

    let mut out = Vec::with_capacity(HEADER_LEN + ciphertext.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(salt);
    out.extend_from_slice(&kdf.memory_kib.to_le_bytes());
    out.extend_from_slice(&kdf.iterations.to_le_bytes());
    out.extend_from_slice(&kdf.parallelism.to_le_bytes());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// 解析头部并按主密码解密，返回原始库文件字节；任何篡改或密码错误都会失败。
pub fn import(blob: &[u8], master_password: &str) -> MendResult<Vec<u8>> {
    if !is_backup(blob) {
        return Err(MendError::Vault("不是有效的 Mend 备份文件".into()));
    }
    if master_password.is_empty() {
        return Err(MendError::Vault("主密码不能为空".into()));
    }

    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&blob[8..8 + SALT_LEN]);

    let read_u32 = |offset: usize| -> u32 {
        u32::from_le_bytes([blob[offset], blob[offset + 1], blob[offset + 2], blob[offset + 3]])
    };
    let kdf = KdfParams {
        memory_kib: read_u32(8 + SALT_LEN),
        iterations: read_u32(8 + SALT_LEN + 4),
        parallelism: read_u32(8 + SALT_LEN + 8),
    };

    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&blob[8 + SALT_LEN + 12..HEADER_LEN]);

    let kek = derive_kek(master_password, &salt, kdf)?;
    let cipher = XChaCha20Poly1305::new(chacha20poly1305::Key::from_slice(&*kek));
    let plaintext = cipher
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &blob[HEADER_LEN..],
                aad: AAD,
            },
        )
        .map_err(|_| MendError::Vault("备份解密失败：主密码错误或文件已损坏".into()))?;

    Ok(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 测试用小参数，避免每个用例几十毫秒级的 Argon2 开销。
    fn fast_kdf() -> KdfParams {
        KdfParams {
            memory_kib: 1024,
            iterations: 1,
            parallelism: 1,
        }
    }

    const PW: &str = "123456";

    fn make_blob(payload: &[u8]) -> Vec<u8> {
        let salt = [7u8; SALT_LEN];
        let kek = derive_kek(PW, &salt, fast_kdf()).expect("派生");
        export(payload, &*kek, &salt, fast_kdf()).expect("导出")
    }

    #[test]
    fn roundtrip_restores_exact_bytes() {
        let payload = b"SQLite format 3\0fake-db-bytes";
        let blob = make_blob(payload);
        assert!(is_backup(&blob));
        let restored = import(&blob, PW).expect("导入");
        assert_eq!(restored, payload);
        // 密文里不应出现原文
        assert!(!blob.windows(payload.len()).any(|w| w == payload));
    }

    #[test]
    fn wrong_password_is_rejected() {
        let blob = make_blob(b"payload");
        assert!(import(&blob, "wrong-pass").is_err());
    }

    #[test]
    fn tampered_backup_is_rejected() {
        let mut blob = make_blob(b"payload");
        let last = blob.len() - 1;
        blob[last] ^= 0x01;
        assert!(import(&blob, PW).is_err());
    }

    #[test]
    fn non_backup_file_is_rejected() {
        assert!(import(b"not a mend backup at all", PW).is_err());
    }
}
