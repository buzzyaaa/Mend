//! The `mend/native` module exported to TSX.
//!
//! Every method is a thin, documented wrapper around `service`, which keeps
//! the bridge free of domain logic.

use nsh_core::prelude::*;

use crate::dto::{
    Category, CategoryInput, EntryInput, EntrySummary, EntryView, GeneratorOptions,
    IconFetchReport, ListFilter, Preset, PresetInput, Settings, Tag, TagInput, VaultStatus,
};
use crate::service;

/// The local encrypted vault.
#[module]
pub struct Vault;

#[module]
impl Vault {
    /// Open the database in the app's data directory (or `dataDir`), run
    /// migrations, and report its state. Safe to call more than once.
    pub async fn init(data_dir: Option<String>) -> Result<VaultStatus, String> {
        service::init(data_dir).await
    }

    /// Current initialized/unlocked state and the database paths.
    pub fn status() -> Result<VaultStatus, String> {
        service::status()
    }

    /// Create the vault with `masterPassword` (minimum 4 characters) and
    /// leave it unlocked. The key derivation runs off the UI thread.
    pub async fn setup(master_password: String) -> Result<VaultStatus, String> {
        service::setup(master_password).await
    }

    /// Unlock the vault with `masterPassword`. The key derivation runs off
    /// the UI thread, so the window keeps drawing while it happens.
    pub async fn unlock(master_password: String) -> Result<VaultStatus, String> {
        service::unlock(master_password).await
    }

    /// Drop the session key from memory.
    pub fn lock() -> Result<(), String> {
        service::lock()
    }

    /// Re-wrap the data key with a new master password. The session stays
    /// unlocked and existing ciphertext is not rewritten.
    pub async fn change_password(old_password: String, new_password: String) -> Result<(), String> {
        service::change_password(old_password, new_password).await
    }

    /// Whether the vault can be opened without the master password.
    pub fn device_unlock_enabled() -> Result<bool, String> {
        service::device_unlock_enabled()
    }

    /// Store the session key next to the database so the vault opens without
    /// the master password. Requires an unlocked vault.
    pub fn enable_device_unlock() -> Result<bool, String> {
        service::enable_device_unlock()
    }

    /// Delete the stored key: the master password is required again.
    pub fn disable_device_unlock() -> Result<bool, String> {
        service::disable_device_unlock()
    }

    /// Open the vault with the stored key (no master password).
    pub fn unlock_with_device_key() -> Result<VaultStatus, String> {
        service::unlock_with_device_key()
    }

    /// Non-sensitive UI preferences as a JSON string, `""` when unset.
    pub async fn load_preferences() -> Result<String, String> {
        service::load_preferences().await
    }

    /// Persist the UI preferences (non-sensitive).
    pub fn save_preferences(json: String) -> Result<(), String> {
        service::save_preferences(json)
    }

    /// Whether a fully downloaded, verified code package (`updates/next.nshpkg`
    /// in the app data directory) is waiting for the next start. Lets the UI
    /// offer to install it right away instead of downloading it again.
    pub fn check_package_ready() -> Result<bool, String> {
        service::check_package_ready()
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

    /// Persist the sidebar's manual category order (only sort_order is written).
    pub fn reorder_categories(ids: Vec<String>) -> Result<(), String> {
        service::reorder_categories(ids)
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

    /// Persist a manual order for presets of one field type.
    pub fn reorder_presets(field_type: String, ids: Vec<String>) -> Result<(), String> {
        service::reorder_presets(field_type, ids)
    }

    /// List tag definitions (name + color).
    pub fn list_tags() -> Result<Vec<Tag>, String> {
        service::list_tags()
    }

    /// Create a tag definition.
    pub fn create_tag(input: TagInput) -> Result<Tag, String> {
        service::create_tag(input)
    }

    /// Rename a tag and/or change its color. Entries carrying the old name are
    /// rewritten to the new one.
    pub fn update_tag(id: String, input: TagInput) -> Result<Tag, String> {
        service::update_tag(id, input)
    }

    /// Delete a tag and strip it from every entry.
    pub fn delete_tag(id: String) -> Result<(), String> {
        service::delete_tag(id)
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

    /// The cached site icon of an entry URL as a `data:` URI; `""` when there
    /// is none (or the vault is locked). Never hits the network.
    pub fn site_icon(url: String) -> Result<String, String> {
        service::site_icon(url)
    }

    /// Fetch and cache icons for up to `limit` sites whose cache is missing or
    /// stale. Runs on the blocking pool; call it only after the vault is
    /// unlocked and the list has settled.
    pub async fn fetch_site_icons(limit: u32) -> Result<IconFetchReport, String> {
        service::fetch_site_icons(limit).await
    }

    /// Drop the whole icon cache; returns how many rows were removed.
    pub fn clear_site_icons() -> Result<u64, String> {
        service::clear_site_icons()
    }

    /// Use another vault file, or the default one in the data directory when
    /// `path` is `null`. Validates that the file is a SQLite database (or does
    /// not exist yet), records its location, reopens it, and leaves the vault
    /// locked. The UI reloads afterwards.
    pub fn switch_vault(path: Option<String>) -> Result<VaultStatus, String> {
        service::switch_vault(path)
    }

    /// Ask the user for an existing vault file with the system dialog;
    /// `null` when cancelled.
    pub async fn pick_vault_file(
        title: String,
        button_label: String,
        start_dir: Option<String>,
    ) -> Result<Option<String>, String> {
        service::pick_vault_file(title, button_label, start_dir).await
    }

    /// Ask the user where a new vault file should live (save dialog);
    /// `null` when cancelled. The file itself is created by `setup`.
    pub async fn pick_new_vault_file(
        title: String,
        button_label: String,
        start_dir: Option<String>,
        file_name: Option<String>,
    ) -> Result<Option<String>, String> {
        service::pick_new_vault_file(title, button_label, start_dir, file_name).await
    }

    /// Show the **current vault file** in the system file manager, with the
    /// file selected (desktop only). Copying that file elsewhere is the
    /// backup story: it holds every entry plus the master password material.
    pub async fn reveal_vault_file() -> Result<(), String> {
        service::reveal_vault_file().await
    }
}
