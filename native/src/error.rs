//! Error transport from Rust to TSX.
//!
//! The nsh module bridge rejects with a string, so we encode the stable
//! `code` before a `|` and keep the human-readable message after it. The UI
//! maps the code to an i18n key and never shows the raw message unless the
//! code is unknown (same contract as the old Tauri command layer).

use mend_core::error::MendError;

/// Encode a domain error as `code|message`.
pub fn domain(err: MendError) -> String {
    format!("{}|{}", err.code(), err)
}

/// Encode an ad-hoc error with a stable code.
pub fn coded(code: &str, message: impl Into<String>) -> String {
    format!("{code}|{}", message.into())
}
