//! Mend 核心逻辑：加密原语、SQLite 仓储与统一错误类型。
//!
//! 不依赖 Tauri / WebView，可在无 GUI 环境下直接 `cargo test`。
//! 契约见 `docs/04-data-model-encryption.md` 与 `docs/03-architecture.md`。

pub mod crypto;
pub mod db;
pub mod entries;
pub mod error;
pub mod generator;
pub mod presets;
pub mod session;
pub mod vault;
