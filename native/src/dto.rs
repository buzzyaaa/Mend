//! Data transferred between the TSX UI and the native vault module.
//!
//! These types are the only surface the UI sees: no key material, no SQL rows,
//! no ciphertext. All camelCase conversion is done by the nsh bridge.

use nsh_core::prelude::JsObject;

/// Whether the vault exists and is currently unlocked.
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct VaultStatus {
    /// A wrapped DEK exists in the database.
    pub initialized: bool,
    /// A session key is held in memory.
    pub unlocked: bool,
    /// Directory that holds `mend.db`.
    pub data_dir: String,
    /// Full path of the SQLite database.
    pub db_path: String,
}

/// One entry as shown in a list: no secret fields.
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct EntrySummary {
    /// Entry id.
    pub id: String,
    /// Owning category, `null` for uncategorized.
    pub category_id: Option<String>,
    /// Title (plaintext by design).
    pub title: String,
    /// Website (plaintext by design).
    pub url: Option<String>,
    /// Starred.
    pub favorite: bool,
    /// Plaintext tags.
    pub tags: Vec<String>,
    /// Created at, milliseconds since the Unix epoch.
    pub created_at: i64,
    /// Updated at, milliseconds since the Unix epoch.
    pub updated_at: i64,
    /// Deleted at, milliseconds since the Unix epoch; `null` when not trashed.
    pub deleted_at: Option<i64>,
    /// Archived (orthogonal to the trash).
    pub archived: bool,
    /// Manual order inside the entry's bucket.
    pub sort_order: i64,
}

/// A fully decrypted entry, only returned while unlocked.
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct EntryView {
    /// Entry id.
    pub id: String,
    /// Owning category, `null` for uncategorized.
    pub category_id: Option<String>,
    /// Title.
    pub title: String,
    /// Website.
    pub url: Option<String>,
    /// Account name.
    pub username: String,
    /// Password.
    pub password: String,
    /// Email address.
    pub email: String,
    /// Phone number.
    pub phone: String,
    /// Markdown notes.
    pub notes: String,
    /// Starred.
    pub favorite: bool,
    /// Tags.
    pub tags: Vec<String>,
    /// Created at, milliseconds since the Unix epoch.
    pub created_at: i64,
    /// Updated at, milliseconds since the Unix epoch.
    pub updated_at: i64,
    /// Deleted at, milliseconds since the Unix epoch; `null` when not trashed.
    pub deleted_at: Option<i64>,
    /// Archived.
    pub archived: bool,
    /// Manual order inside the entry's bucket.
    pub sort_order: i64,
}

/// Plaintext entry input from the editor.
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct EntryInput {
    /// Owning category, `null` for uncategorized.
    pub category_id: Option<String>,
    /// Title; the only required field.
    pub title: String,
    /// Website.
    pub url: Option<String>,
    /// Account name.
    pub username: String,
    /// Password.
    pub password: String,
    /// Email address.
    pub email: String,
    /// Phone number.
    pub phone: String,
    /// Markdown notes.
    pub notes: String,
    /// Starred.
    pub favorite: bool,
    /// Tags.
    pub tags: Vec<String>,
}

/// Filter for `list_entries`.
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct ListFilter {
    /// `all`, `favorites`, `uncategorized`, `archive`, `trash`, or `category`.
    pub bucket: String,
    /// Category id when `bucket` is `category`.
    pub category_id: Option<String>,
    /// Case-insensitive search over title/account/email/phone/URL/notes.
    pub keyword: Option<String>,
    /// Tag that must be present.
    pub tag: Option<String>,
}

/// A category and its live entry count.
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct Category {
    /// Category id.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Optional `#RRGGBB`.
    pub color: Option<String>,
    /// Optional icon name (stored as text; the UI maps it to an emoji).
    pub icon: Option<String>,
    /// Sidebar order.
    pub sort_order: i64,
    /// Entries in this category (not archived, not trashed).
    pub entry_count: i64,
}

/// Category input from the editor.
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct CategoryInput {
    /// Display name.
    pub name: String,
    /// Optional `#RRGGBB`.
    pub color: Option<String>,
    /// Optional icon name.
    pub icon: Option<String>,
}

/// A reusable field value.
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct Preset {
    /// Preset id.
    pub id: String,
    /// `username`, `email`, `phone` or `password`.
    pub field_type: String,
    /// Display label.
    pub label: String,
    /// Plaintext value, only returned while unlocked.
    pub value: String,
    /// Order inside its type.
    pub sort_order: i64,
}

/// Preset input from the editor.
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct PresetInput {
    /// `username`, `email`, `phone` or `password`.
    pub field_type: String,
    /// Display label.
    pub label: String,
    /// Plaintext value.
    pub value: String,
}

/// Password generator options.
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct GeneratorOptions {
    /// Length, 6–64.
    pub length: i64,
    /// Include `A-Z`.
    pub uppercase: bool,
    /// Include `a-z`.
    pub lowercase: bool,
    /// Include `0-9`.
    pub digits: bool,
    /// Include symbols.
    pub symbols: bool,
    /// Exclude `0 O o 1 l I |`.
    pub exclude_ambiguous: bool,
}

/// Paths shown in settings.
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct AppPaths {
    /// Data directory.
    pub data_dir: String,
    /// Database file.
    pub db_path: String,
}

/// Result of an encrypted backup export.
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct ExportResult {
    /// Where the backup was written.
    pub path: String,
    /// File size in bytes.
    pub bytes: u64,
}

/// Result of a backup restore.
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct ImportResult {
    /// Entries in the restored database.
    pub entries: u64,
    /// Categories in the restored database.
    pub categories: u64,
    /// Name of the previous database kept next to `mend.db`, if any.
    pub previous_backup: Option<String>,
}

/// Non-sensitive UI settings stored in the database.
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct Settings {
    /// `en`, `zh-CN`, or `null` to follow the system.
    pub language: Option<String>,
    /// `system`, `light` or `dark`.
    pub theme: String,
    /// Idle minutes before locking (0 = never).
    pub auto_lock_minutes: i64,
    /// Days between automatic update checks (0 = never).
    pub update_check_interval_days: i64,
    /// Last successful update check, milliseconds since the Unix epoch.
    pub last_update_check_ts: i64,
}
