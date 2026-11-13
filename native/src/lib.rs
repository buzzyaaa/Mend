//! Mend's native side: SQLite storage, Argon2id / XChaCha20-Poly1305 and the
//! encrypted backup container. The UI is TSX; this crate is exposed to it as
//! the `mend/native` module.
//!
//! The on-disk database, ciphertext and `.mendbak` format are unchanged from
//! the previous Tauri build, so an existing vault opens as-is.

mod api;
mod dto;
mod error;
mod service;

use nsh_core::prelude::*;

/// What `App.tsx` imports from `mend/native`.
#[native_module("mend/native")]
fn native(registry: &mut Registry) {
    registry.module::<api::Vault>();
}
