//! 预设值（账号 / 邮箱 / 手机号）：值在落盘前加密，读回时在解锁态解密。
//! 表结构与契约见 `docs/04-data-model-encryption.md` §2.4，界面见 `docs/05-mvp-spec.md` §2.1。

use serde::{Deserialize, Serialize};

use crate::crypto::{decrypt_field, encrypt_field, field_aad, DEK_LEN};
use crate::db::PresetRowEnc;
use crate::error::{MendError, MendResult};

/// 允许做预设的字段类型；密码预设只用于"常用密码"候选，落盘同样加密。
pub const FIELD_TYPES: [&str; 4] = ["username", "email", "phone", "password"];

const LABEL_MAX: usize = 40;
const VALUE_MAX: usize = 512;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetInput {
    pub field_type: String,
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetView {
    pub id: String,
    pub field_type: String,
    pub label: String,
    pub value: String,
    pub sort_order: i64,
}

fn validate(input: &PresetInput) -> MendResult<(String, String, String)> {
    if !FIELD_TYPES.contains(&input.field_type.as_str()) {
        return Err(MendError::Vault(format!(
            "不支持的预设类型：{}",
            input.field_type
        )));
    }
    let label = input.label.trim();
    if label.is_empty() {
        return Err(MendError::Vault("预设名称不能为空".into()));
    }
    if label.chars().count() > LABEL_MAX {
        return Err(MendError::Vault(format!("预设名称过长（上限 {LABEL_MAX} 字）")));
    }
    let value = input.value.trim();
    if value.is_empty() {
        return Err(MendError::Vault("预设值不能为空".into()));
    }
    if value.chars().count() > VALUE_MAX {
        return Err(MendError::Vault("预设值过长".into()));
    }
    Ok((
        input.field_type.clone(),
        label.to_string(),
        value.to_string(),
    ))
}

/// 明文入参 → 密文行；AAD 绑定 `id:value`，换行/挪库都会解密失败。
pub fn encrypt_input(
    dek: &[u8; DEK_LEN],
    id: &str,
    input: &PresetInput,
    sort_order: i64,
    created_at: i64,
) -> MendResult<PresetRowEnc> {
    let (field_type, label, value) = validate(input)?;
    Ok(PresetRowEnc {
        id: id.to_string(),
        field_type,
        label,
        value_enc: encrypt_field(dek, &field_aad(id, "value"), &value)?,
        sort_order,
        created_at,
    })
}

pub fn decrypt_row(dek: &[u8; DEK_LEN], row: &PresetRowEnc) -> MendResult<PresetView> {
    Ok(PresetView {
        id: row.id.clone(),
        field_type: row.field_type.clone(),
        label: row.label.clone(),
        value: decrypt_field(dek, &field_aad(&row.id, "value"), &row.value_enc)?,
        sort_order: row.sort_order,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::DEK_LEN;

    const DEK: [u8; DEK_LEN] = [9u8; DEK_LEN];

    fn input() -> PresetInput {
        PresetInput {
            field_type: "email".into(),
            label: "工作邮箱".into(),
            value: "alice@example.com".into(),
        }
    }

    #[test]
    fn preset_roundtrip() {
        let row = encrypt_input(&DEK, "p1", &input(), 1, 1).expect("加密");
        assert_ne!(row.value_enc, "alice@example.com");
        let view = decrypt_row(&DEK, &row).expect("解密");
        assert_eq!(view.value, "alice@example.com");
        assert_eq!(view.field_type, "email");
        assert_eq!(view.label, "工作邮箱");
    }

    #[test]
    fn preset_accepts_password_type() {
        let mut pw = input();
        pw.field_type = "password".into();
        pw.label = "常用密码".into();
        pw.value = "CorrectHorseBatteryStaple".into();
        let row = encrypt_input(&DEK, "p5", &pw, 1, 1).expect("密码预设允许");
        assert_ne!(row.value_enc, "CorrectHorseBatteryStaple");
        let view = decrypt_row(&DEK, &row).expect("解密");
        assert_eq!(view.field_type, "password");
        assert_eq!(view.value, "CorrectHorseBatteryStaple");
    }

    #[test]
    fn preset_rejects_bad_input() {
        let mut bad = input();
        bad.field_type = "creditcard".into();
        assert!(encrypt_input(&DEK, "p2", &bad, 1, 1).is_err(), "未知类型拒绝");

        let mut bad = input();
        bad.label = "  ".into();
        assert!(encrypt_input(&DEK, "p3", &bad, 1, 1).is_err());

        let mut bad = input();
        bad.value = String::new();
        assert!(encrypt_input(&DEK, "p4", &bad, 1, 1).is_err());
    }
}
