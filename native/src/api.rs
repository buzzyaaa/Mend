//! The `mend/native` module exported to TSX.
//!
//! Every method is a thin, documented wrapper around `service`, which keeps
//! the bridge free of domain logic.

use nsh_core::prelude::*;

use crate::dto::{
    AppPaths, Category, CategoryInput, EntryInput, EntrySummary, EntryView, ExportResult,
    GeneratorOptions, ImportResult, ListFilter, Preset, PresetInput, Settings, VaultStatus,
};
use crate::service;

/// The local encrypted vault.
#[module]
pub struct Vault;

#[module]
impl Vault {
    /// Open the database in the app's data directory (or `dataDir`), run
    /// migrations, and report its state. Safe to call more than once.
    pub fn init(data_dir: Option<String>) -> Result<VaultStatus, String> {
        service::init(data_dir)
    }

    /// Current initialized/unlocked state and the database paths.
    pub fn status() -> Result<VaultStatus, String> {
        service::status()
    }

    /// Create the vault with `masterPassword` (minimum 4 characters) and
    /// leave it unlocked.
    pub fn setup(master_password: String) -> Result<VaultStatus, String> {
        service::setup(master_password)
    }

    /// Unlock the vault with `masterPassword`.
    pub fn unlock(master_password: String) -> Result<VaultStatus, String> {
        service::unlock(master_password)
    }

    /// Drop the session key from memory.
    pub fn lock() -> Result<(), String> {
        service::lock()
    }

    /// Re-wrap the data key with a new master password. The session stays
    /// unlocked and existing ciphertext is not rewritten.
    pub fn change_password(old_password: String, new_password: String) -> Result<(), String> {
        service::change_password(old_password, new_password)
    }

    /// List entries for a bucket (`all`, `favorites`, `uncategorized`,
    /// `archive`, `trash`, `category`), optionally filtered by keyword/tag.
    /// Secret fields are decrypted only when a keyword is used.
    pub fn list_entries(filter: ListFilter) -> Result<Vec<EntrySummary>, String> {
        service::list_entries(filter)
    }

    /// Read and decrypt one entry (including archived entries).
    pub fn get_entry(id: String) -> Result<EntryView, String> {
        service::get_entry(id)
    }

    /// Create an entry; returns the decrypted row.
    pub fn create_entry(input: EntryInput) -> Result<EntryView, String> {
        service::create_entry(input)
    }

    /// Update an entry; returns the decrypted row.
    pub fn update_entry(id: String, input: EntryInput) -> Result<EntryView, String> {
        service::update_entry(id, input)
    }

    /// Star or unstar an entry.
    pub fn set_favorite(id: String, favorite: bool) -> Result<EntrySummary, String> {
        service::set_favorite(id, favorite)
    }

    /// Move an entry to the trash (soft delete).
    pub fn delete_entry(id: String) -> Result<(), String> {
        service::delete_entry(id)
    }

    /// Restore an entry from the trash.
    pub fn restore_entry(id: String) -> Result<(), String> {
        service::restore_entry(id)
    }

    /// Permanently delete one trashed entry.
    pub fn purge_entry(id: String) -> Result<(), String> {
        service::purge_entry(id)
    }

    /// Permanently delete every trashed entry; returns how many.
    pub fn purge_all_trash() -> Result<u64, String> {
        service::purge_all_trash()
    }

    /// Archive an entry.
    pub fn archive_entry(id: String) -> Result<(), String> {
        service::archive_entry(id)
    }

    /// Move an archived entry back to the main list.
    pub fn unarchive_entry(id: String) -> Result<(), String> {
        service::unarchive_entry(id)
    }

    /// Persist a manual order for the given visible ids (per category).
    pub fn reorder_entries(ids: Vec<String>) -> Result<(), String> {
        service::reorder_entries(ids)
    }

    /// List categories with live entry counts.
    pub fn list_categories() -> Result<Vec<Category>, String> {
        service::list_categories()
    }

    /// Create a category.
    pub fn create_category(input: CategoryInput) -> Result<Category, String> {
        service::create_category(input)
    }

    /// Rename a category and/or change its color and icon.
    pub fn update_category(id: String, input: CategoryInput) -> Result<Category, String> {
        service::update_category(id, input)
    }

    /// Delete a category; its entries move to Uncategorized.
    pub fn delete_category(id: String) -> Result<(), String> {
        service::delete_category(id)
    }

    /// List reusable field values (decrypted).
    pub fn list_presets() -> Result<Vec<Preset>, String> {
        service::list_presets()
    }

    /// Create a preset.
    pub fn create_preset(input: PresetInput) -> Result<Preset, String> {
        service::create_preset(input)
    }

    /// Update a preset.
    pub fn update_preset(id: String, input: PresetInput) -> Result<Preset, String> {
        service::update_preset(id, input)
    }

    /// Delete a preset.
    pub fn delete_preset(id: String) -> Result<(), String> {
        service::delete_preset(id)
    }

    /// Generate a password from the local CSPRNG. Nothing is persisted.
    pub fn generate_password(options: GeneratorOptions) -> Result<String, String> {
        service::generate_password(options)
    }

    /// Read the non-sensitive UI settings.
    pub fn get_settings() -> Result<Settings, String> {
        service::get_settings()
    }

    /// Write the non-sensitive UI settings.
    pub fn save_settings(settings: Settings) -> Result<Settings, String> {
        service::save_settings(settings)
    }

    /// The data directory and database path shown in settings.
    pub fn app_paths() -> Result<AppPaths, String> {
        service::app_paths()
    }

    /// Export an encrypted `.mendbak`; without `path` it is written into the
    /// app data directory. The UI shows the resulting path.
    pub fn export_backup(
        path: Option<String>,
        file_name: Option<String>,
        master_password: String,
    ) -> Result<ExportResult, String> {
        service::export_backup(path, file_name, master_password)
    }

    /// Restore a `.mendbak` from a local path (desktop).
    pub fn import_backup(path: String, master_password: String) -> Result<ImportResult, String> {
        service::import_backup(path, master_password)
    }

    /// Restore a `.mendbak` from base64 bytes (works on every platform,
    /// including the mobile file picker).
    pub fn import_backup_base64(
        data_base64: String,
        master_password: String,
    ) -> Result<ImportResult, String> {
        service::import_backup_base64(data_base64, master_password)
    }

    /// Show the database's data directory in the system file manager
    /// (desktop only).
    pub async fn reveal_data_dir() -> Result<(), String> {
        service::reveal_data_dir().await
    }
}
