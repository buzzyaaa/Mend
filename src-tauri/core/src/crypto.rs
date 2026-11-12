//! 加密原语：Argon2id 密钥派生、DEK 包裹、字段级认证加密。
//!
//! 契约见 `docs/04-data-model-encryption.md`：
//! - 主密码从不落盘，仅用于派生 KEK；
//! - KEK 仅内存存在，用于包裹/解包随机 DEK；
//! - 每个敏感字段用 XChaCha20-Poly1305 独立 nonce 加密，AAD 绑定条目 id 与字段名。

use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use rand::rngs::OsRng;
use rand::RngCore;
use zeroize::Zeroizing;

use crate::error::{MendError, MendResult};

pub const SALT_LEN: usize = 16;
pub const DEK_LEN: usize = 32;
pub const NONCE_LEN: usize = 24;

/// Argon2id 参数：首次建库时生成并写入 `meta` 表，后续解锁沿用。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KdfParams {
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

impl Default for KdfParams {
    /// 64 MiB / 3 次 / 4 并行：桌面端解锁耗时约百毫秒级，兼顾抗暴力破解。
    fn default() -> Self {
        Self {
            memory_kib: 64 * 1024,
            iterations: 3,
            parallelism: 4,
        }
    }
}

impl KdfParams {
    /// 序列化为 `meta` 表的存储形式：`m=65536,t=3,p=4`。
    pub fn to_meta_value(&self) -> String {
        format!(
            "m={},t={},p={}",
            self.memory_kib, self.iterations, self.parallelism
        )
    }

    pub fn from_meta_value(value: &str) -> MendResult<Self> {
        let mut memory_kib = None;
        let mut iterations = None;
        let mut parallelism = None;
        for part in value.split(',') {
            let mut kv = part.split('=');
            let key = kv.next().map(str::trim).unwrap_or_default();
            let val = kv.next().map(str::trim).unwrap_or_default();
            let parsed: u32 = val
                .parse()
                .map_err(|_| MendError::Crypto("KDF 参数已损坏".into()))?;
            match key {
                "m" => memory_kib = Some(parsed),
                "t" => iterations = Some(parsed),
                "p" => parallelism = Some(parsed),
                _ => {}
            }
        }
        Ok(Self {
            memory_kib: memory_kib.ok_or_else(|| MendError::Crypto("KDF 参数缺少 m".into()))?,
            iterations: iterations.ok_or_else(|| MendError::Crypto("KDF 参数缺少 t".into()))?,
            parallelism: parallelism.ok_or_else(|| MendError::Crypto("KDF 参数缺少 p".into()))?,
        })
    }
}

pub fn random_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    salt
}

pub fn random_dek() -> Zeroizing<[u8; DEK_LEN]> {
    let mut dek = Zeroizing::new([0u8; DEK_LEN]);
    OsRng.fill_bytes(dek.as_mut());
    dek
}

/// 由主密码派生 KEK。返回值由调用方在 Drop 时清零（Zeroizing）。
pub fn derive_kek(
    master_password: &str,
    salt: &[u8],
    params: KdfParams,
) -> MendResult<Zeroizing<[u8; DEK_LEN]>> {
    let argon_params = Params::new(
        params.memory_kib,
        params.iterations,
        params.parallelism,
        Some(DEK_LEN),
    )
    .map_err(|err| MendError::Crypto(format!("Argon2 参数非法: {err}")))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon_params);

    let mut kek = Zeroizing::new([0u8; DEK_LEN]);
    argon
        .hash_password_into(master_password.as_bytes(), salt, kek.as_mut())
        .map_err(|err| MendError::Crypto(format!("密钥派生失败: {err}")))?;
    Ok(kek)
}

/// 用 KEK 包裹 DEK，落盘形式为 base64(nonce || ciphertext || tag)。
pub fn wrap_dek(kek: &[u8; DEK_LEN], dek: &[u8; DEK_LEN]) -> MendResult<String> {
    let cipher = XChaCha20Poly1305::new(Key::from_slice(kek));
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);

    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: dek,
                aad: b"mend:dek",
            },
        )
        .map_err(|_| MendError::Crypto("DEK 包裹失败".into()))?;

    let mut packed = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    packed.extend_from_slice(&nonce);
    packed.extend_from_slice(&ciphertext);
    Ok(B64.encode(packed))
}

/// 解包 DEK；主密码错误或数据被篡改时认证失败。
pub fn unwrap_dek(kek: &[u8; DEK_LEN], wrapped_b64: &str) -> MendResult<Zeroizing<[u8; DEK_LEN]>> {
    let raw = B64
        .decode(wrapped_b64.trim())
        .map_err(|_| MendError::Crypto("DEK 数据格式非法".into()))?;
    if raw.len() <= NONCE_LEN {
        return Err(MendError::Crypto("DEK 数据长度非法".into()));
    }
    let (nonce, ciphertext) = raw.split_at(NONCE_LEN);

    let cipher = XChaCha20Poly1305::new(Key::from_slice(kek));
    let plaintext = cipher
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: b"mend:dek",
            },
        )
        .map_err(|_| MendError::Crypto("主密码错误或库文件已损坏".into()))?;

    if plaintext.len() != DEK_LEN {
        return Err(MendError::Crypto("DEK 长度非法".into()));
    }
    let mut dek = Zeroizing::new([0u8; DEK_LEN]);
    dek.copy_from_slice(&plaintext);
    Ok(dek)
}

/// 字段级加密：AAD 绑定条目 id 与字段名，防止密文被搬运到其他条目/字段。
pub fn encrypt_field(dek: &[u8; DEK_LEN], aad: &str, plaintext: &str) -> MendResult<String> {
    let cipher = XChaCha20Poly1305::new(Key::from_slice(dek));
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);

    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext.as_bytes(),
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| MendError::Crypto("字段加密失败".into()))?;

    let mut packed = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    packed.extend_from_slice(&nonce);
    packed.extend_from_slice(&ciphertext);
    Ok(B64.encode(packed))
}

pub fn decrypt_field(dek: &[u8; DEK_LEN], aad: &str, ciphertext_b64: &str) -> MendResult<String> {
    let raw = B64
        .decode(ciphertext_b64.trim())
        .map_err(|_| MendError::Crypto("字段密文格式非法".into()))?;
    if raw.len() <= NONCE_LEN {
        return Err(MendError::Crypto("字段密文长度非法".into()));
    }
    let (nonce, ciphertext) = raw.split_at(NONCE_LEN);

    let cipher = XChaCha20Poly1305::new(Key::from_slice(dek));
    let plaintext = cipher
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| MendError::Crypto("字段解密失败（数据被篡改或密钥不匹配）".into()))?;

    String::from_utf8(plaintext).map_err(|_| MendError::Crypto("字段明文编码非法".into()))
}

/// 生成字段 AAD：`<entry_id>:<field>`。
pub fn field_aad(entry_id: &str, field: &str) -> String {
    format!("{entry_id}:{field}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_kek() -> [u8; DEK_LEN] {
        // 测试用固定密钥，避免 Argon2 拖慢单测
        let mut kek = [0u8; DEK_LEN];
        for (i, b) in kek.iter_mut().enumerate() {
            *b = i as u8;
        }
        kek
    }

    #[test]
    fn dek_wrap_roundtrip() {
        let kek = test_kek();
        let dek = random_dek();
        let wrapped = wrap_dek(&kek, &dek).unwrap();
        let unwrapped = unwrap_dek(&kek, &wrapped).unwrap();
        assert_eq!(unwrapped.as_ref(), dek.as_ref());
    }

    #[test]
    fn dek_unwrap_fails_with_wrong_kek() {
        let kek = test_kek();
        let dek = random_dek();
        let wrapped = wrap_dek(&kek, &dek).unwrap();
        let mut wrong = kek;
        wrong[0] ^= 0xff;
        assert!(unwrap_dek(&wrong, &wrapped).is_err());
    }

    #[test]
    fn field_roundtrip_and_aad_binding() {
        let dek = *random_dek();
        let aad = field_aad("entry-1", "password");
        let cipher_text = encrypt_field(&dek, &aad, "p@ssw0rd-明文").unwrap();
        assert!(!cipher_text.contains("p@ssw0rd"));
        let plain = decrypt_field(&dek, &aad, &cipher_text).unwrap();
        assert_eq!(plain, "p@ssw0rd-明文");

        // 换 AAD（搬运到别的条目）应解密失败
        let other_aad = field_aad("entry-2", "password");
        assert!(decrypt_field(&dek, &other_aad, &cipher_text).is_err());
    }

    #[test]
    fn kdf_params_meta_roundtrip() {
        let params = KdfParams::default();
        let meta = params.to_meta_value();
        assert_eq!(KdfParams::from_meta_value(&meta).unwrap(), params);
        assert!(KdfParams::from_meta_value("m=1,t=2").is_err());
    }

    #[test]
    fn derive_kek_is_deterministic_per_salt() {
        let params = KdfParams {
            memory_kib: 8 * 1024,
            iterations: 1,
            parallelism: 1,
        };
        let salt = random_salt();
        let a = derive_kek("master-pass", &salt, params).unwrap();
        let b = derive_kek("master-pass", &salt, params).unwrap();
        assert_eq!(a.as_ref(), b.as_ref());

        let other_salt = random_salt();
        let c = derive_kek("master-pass", &other_salt, params).unwrap();
        assert_ne!(a.as_ref(), c.as_ref());
    }
}
