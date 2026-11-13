//! The vault service behind the TSX UI.
//!
//! One process-wide SQLite connection and one in-memory session DEK. Every
//! call is serialized by a mutex; expensive work (Argon2, whole-database
//! reads/writes) runs on the nsh blocking thread pool through `blocking`.
//! The domain rules and the on-disk formats live in `mend-core` unchanged.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, OnceLock},
    time::Duration,
};

use base64::{Engine, engine::general_purpose::STANDARD as B64};
use mend_core::{
    backup, db,
    db::{Connection, EntryRowEnc},
    entries, generator, presets,
    session::Session,
    vault,
};
use nsh_core::prelude::{data_dir, reveal_path};
use uuid::Uuid;

use crate::dto::{
    AppPaths, Category, CategoryInput, EntryInput, EntrySummary, EntryView, ExportResult,
    GeneratorOptions, ImportResult, ListFilter, Preset, PresetInput, Settings, VaultStatus,
};
use crate::error::{coded, domain};

const SETTING_LANGUAGE: &str = "ui.language";
const SETTING_THEME: &str = "ui.theme";
const SETTING_AUTO_LOCK: &str = "ui.auto_lock_minutes";
const SETTING_UPDATE_DAYS: &str = "ui.update_check_interval_days";
const SETTING_LAST_UPDATE: &str = "ui.last_update_check_ts";
const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";

struct Backend {
    data_dir: PathBuf,
    db_path: PathBuf,
    conn: Option<Connection>,
    session: Option<Session>,
}

impl Default for Backend {
    fn default() -> Self {
        Self {
            data_dir: PathBuf::new(),
            db_path: PathBuf::new(),
            conn: None,
            session: None,
        }
    }
}

static BACKEND: OnceLock<Mutex<Backend>> = OnceLock::new();

fn backend() -> Result<MutexGuard<'static, Backend>, String> {
    BACKEND
        .get_or_init(|| Mutex::new(Backend::default()))
        .lock()
        .map_err(|_| coded("vault", "本地库状态锁已损坏，请重启应用"))
}

/// Resolve the app data directory. `nsh` gives `<data dir>/<app id>`, which on
/// Windows is `%APPDATA%\\com.mend.app` — the same directory the previous
/// Tauri build used, so an existing `mend.db` opens without migration.
fn resolve_data_dir(provided: Option<String>) -> Result<PathBuf, String> {
    if let Some(dir) = provided
        .as_deref()
        .map(str::trim)
        .filter(|dir| !dir.is_empty())
    {
        return Ok(PathBuf::from(dir));
    }
    if let Some(dir) = std::env::var_os("MEND_DATA_DIR").filter(|dir| !dir.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    if let Some(dir) = data_dir() {
        return Ok(dir);
    }
    Err(coded(
        "vault",
        "无法定位应用数据目录：当前平台没有为用户文件提供目录",
    ))
}

fn ensure_conn(backend: &mut Backend) -> Result<(), String> {
    if backend.conn.is_none() {
        let conn = db::open_and_migrate(&backend.db_path).map_err(domain)?;
        conn.busy_timeout(Duration::from_secs(5))
            .map_err(|err| coded("db", format!("设置 SQLite 忙等待失败: {err}")))?;
        backend.conn = Some(conn);
    }
    Ok(())
}

fn status_of(backend: &Backend) -> Result<VaultStatus, String> {
    let initialized = match backend.conn.as_ref() {
        Some(conn) => db::is_initialized(conn).map_err(domain)?,
        None => false,
    };
    Ok(VaultStatus {
        initialized,
        unlocked: backend.session.is_some(),
        data_dir: backend.data_dir.display().to_string(),
        db_path: backend.db_path.display().to_string(),
    })
}

fn require_session(backend: &Backend) -> Result<&Session, String> {
    backend
        .session
        .as_ref()
        .ok_or_else(|| coded("locked", "库未解锁"))
}

fn require_conn(backend: &Backend) -> Result<&Connection, String> {
    backend
        .conn
        .as_ref()
        .ok_or_else(|| coded("db", "本地库尚未打开"))
}

fn ensure_unlocked(backend: &mut Backend) -> Result<(), String> {
    ensure_conn(backend)?;
    if backend.session.is_none() {
        return Err(coded("locked", "库未解锁"));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

pub fn init_sync(data_dir: Option<String>) -> Result<VaultStatus, String> {
    let dir = resolve_data_dir(data_dir)?;
    fs::create_dir_all(&dir).map_err(|err| coded("vault", format!("创建数据目录失败: {err}")))?;
    let db_path = db::db_file_path(&dir);

    let mut backend = backend()?;
    let same = backend.db_path == db_path;
    if !same {
        backend.conn = None;
        backend.session = None;
    }
    backend.data_dir = dir;
    backend.db_path = db_path;
    ensure_conn(&mut backend)?;
    status_of(&backend)
}

pub fn status_sync() -> Result<VaultStatus, String> {
    let backend = backend()?;
    status_of(&backend)
}

fn setup_sync(master_password: String) -> Result<VaultStatus, String> {
    let mut backend = backend()?;
    ensure_conn(&mut backend)?;
    if backend.session.is_some() {
        return status_of(&backend);
    }
    let conn = require_conn(&backend)?;
    let keys = vault::setup(conn, &master_password).map_err(domain)?;
    backend.session = Some(Session {
        dek: keys.dek,
        kdf: keys.kdf,
    });
    status_of(&backend)
}

fn unlock_sync(master_password: String) -> Result<VaultStatus, String> {
    let mut backend = backend()?;
    ensure_conn(&mut backend)?;
    if backend.session.is_some() {
        return status_of(&backend);
    }
    let conn = require_conn(&backend)?;
    let keys = vault::unlock(conn, &master_password).map_err(domain)?;
    backend.session = Some(Session {
        dek: keys.dek,
        kdf: keys.kdf,
    });
    status_of(&backend)
}

fn lock_sync() -> Result<(), String> {
    let mut backend = backend()?;
    backend.session = None;
    Ok(())
}

fn change_password_sync(old_password: String, new_password: String) -> Result<(), String> {
    let mut backend = backend()?;
    ensure_unlocked(&mut backend)?;
    let conn = require_conn(&backend)?;
    let keys = vault::change_password(conn, &old_password, &new_password).map_err(domain)?;
    if let Some(session) = backend.session.as_mut() {
        session.kdf = keys.kdf;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

fn summary_of(row: &EntryRowEnc) -> EntrySummary {
    EntrySummary {
        id: row.id.clone(),
        category_id: row.category_id.clone(),
        title: row.title.clone(),
        url: row.url.clone(),
        favorite: row.favorite,
        tags: row.tags.clone(),
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
        archived: row.archived,
        sort_order: row.sort_order,
    }
}

fn list_entries_sync(filter: ListFilter) -> Result<Vec<EntrySummary>, String> {
    let backend = backend()?;
    let session = require_session(&backend)?;
    let conn = require_conn(&backend)?;
    let dek = &*session.dek;

    let keyword = filter
        .keyword
        .as_deref()
        .map(str::trim)
        .filter(|keyword| !keyword.is_empty())
        .map(str::to_lowercase);
    let tag = filter
        .tag
        .as_deref()
        .map(str::trim)
        .filter(|tag| !tag.is_empty());

    let mut rows = match filter.bucket.as_str() {
        "trash" => db::list_trashed_entries(conn).map_err(domain)?,
        "archive" => db::list_archived_entries(conn).map_err(domain)?,
        "favorites" => db::list_entries(conn, filter.category_id.as_deref(), None)
            .map_err(domain)?
            .into_iter()
            .filter(|row| row.favorite)
            .collect(),
        "uncategorized" => db::list_entries(conn, None, None)
            .map_err(domain)?
            .into_iter()
            .filter(|row| row.category_id.is_none())
            .collect(),
        "category" => {
            let Some(category_id) = filter.category_id.as_deref() else {
                return Err(coded("vault", "缺少分类 id"));
            };
            db::list_entries(conn, Some(category_id), None).map_err(domain)?
        }
        _ => db::list_entries(conn, None, None).map_err(domain)?,
    };

    if let Some(tag) = tag {
        rows.retain(|row| row.tags.iter().any(|value| value == tag));
    }

    if let Some(keyword) = keyword {
        let mut matched = Vec::with_capacity(rows.len());
        for row in rows {
            let view = entries::decrypt_row(dek, &row).map_err(domain)?;
            let haystack = format!(
                "{} {} {} {} {} {}",
                view.title,
                view.username,
                view.email,
                view.phone,
                view.url.as_deref().unwrap_or_default(),
                view.notes
            )
            .to_lowercase();
            if haystack.contains(&keyword) {
                matched.push(row);
            }
        }
        rows = matched;
    }

    let mut summaries: Vec<EntrySummary> = rows.iter().map(summary_of).collect();
    // The desktop UI applies its own locale-aware/manual order; this is the
    // stable default order for every bucket.
    summaries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(summaries)
}

fn get_entry_sync(id: String) -> Result<EntryView, String> {
    let backend = backend()?;
    let session = require_session(&backend)?;
    let conn = require_conn(&backend)?;
    let row = db::get_entry_any(conn, &id)
        .map_err(domain)?
        .ok_or_else(|| coded("not_found", format!("条目 {id}")))?;
    entries::decrypt_row(&session.dek, &row)
        .map(entry_view)
        .map_err(domain)
}

fn entry_view(view: entries::EntryView) -> EntryView {
    EntryView {
        id: view.id,
        category_id: view.category_id,
        title: view.title,
        url: view.url,
        username: view.username,
        password: view.password,
        email: view.email,
        phone: view.phone,
        notes: view.notes,
        favorite: view.favorite,
        tags: view.tags,
        created_at: view.created_at,
        updated_at: view.updated_at,
        deleted_at: view.deleted_at,
        archived: view.archived,
        sort_order: view.sort_order,
    }
}

fn entry_input(input: EntryInput) -> entries::EntryInput {
    entries::EntryInput {
        category_id: input.category_id,
        title: input.title,
        url: input.url,
        username: input.username,
        password: input.password,
        email: input.email,
        phone: input.phone,
        notes: input.notes,
        favorite: input.favorite,
        tags: input.tags,
    }
}

fn create_entry_sync(input: EntryInput) -> Result<EntryView, String> {
    let backend = backend()?;
    let session = require_session(&backend)?;
    let conn = require_conn(&backend)?;
    let dek = &*session.dek;
    let id = Uuid::new_v4().to_string();
    let now = db::now_ms();
    let mut row =
        entries::encrypt_input(dek, &id, &entry_input(input), now, now).map_err(domain)?;
    row.sort_order = db::next_entry_sort_order(conn, row.category_id.as_deref()).map_err(domain)?;
    db::insert_entry(conn, &row).map_err(domain)?;
    entries::decrypt_row(dek, &row)
        .map(entry_view)
        .map_err(domain)
}

fn update_entry_sync(id: String, input: EntryInput) -> Result<EntryView, String> {
    let backend = backend()?;
    let session = require_session(&backend)?;
    let conn = require_conn(&backend)?;
    let dek = &*session.dek;
    let existing = db::get_entry_any(conn, &id)
        .map_err(domain)?
        .ok_or_else(|| coded("not_found", format!("条目 {id}")))?;
    let now = db::now_ms();
    let mut row = entries::encrypt_input(dek, &id, &entry_input(input), existing.created_at, now)
        .map_err(domain)?;
    row.sort_order = existing.sort_order;
    row.archived = existing.archived;
    db::update_entry(conn, &row).map_err(domain)?;
    entries::decrypt_row(dek, &row)
        .map(entry_view)
        .map_err(domain)
}

fn set_favorite_sync(id: String, favorite: bool) -> Result<EntrySummary, String> {
    let backend = backend()?;
    require_session(&backend)?;
    let conn = require_conn(&backend)?;
    let mut row = db::get_entry_any(conn, &id)
        .map_err(domain)?
        .ok_or_else(|| coded("not_found", format!("条目 {id}")))?;
    row.favorite = favorite;
    row.updated_at = db::now_ms();
    db::update_entry(conn, &row).map_err(domain)?;
    Ok(summary_of(&row))
}

fn delete_entry_sync(id: String) -> Result<(), String> {
    let backend = backend()?;
    require_session(&backend)?;
    db::delete_entry(require_conn(&backend)?, &id).map_err(domain)
}

fn restore_entry_sync(id: String) -> Result<(), String> {
    let backend = backend()?;
    require_session(&backend)?;
    db::restore_entry(require_conn(&backend)?, &id).map_err(domain)
}

fn purge_entry_sync(id: String) -> Result<(), String> {
    let backend = backend()?;
    require_session(&backend)?;
    db::purge_entry(require_conn(&backend)?, &id).map_err(domain)
}

fn purge_all_trash_sync() -> Result<u64, String> {
    let backend = backend()?;
    require_session(&backend)?;
    let count = db::purge_all_trashed(require_conn(&backend)?).map_err(domain)?;
    Ok(count as u64)
}

fn archive_entry_sync(id: String) -> Result<(), String> {
    let backend = backend()?;
    require_session(&backend)?;
    db::archive_entry(require_conn(&backend)?, &id).map_err(domain)
}

fn unarchive_entry_sync(id: String) -> Result<(), String> {
    let backend = backend()?;
    require_session(&backend)?;
    db::unarchive_entry(require_conn(&backend)?, &id).map_err(domain)
}

fn reorder_entries_sync(ids: Vec<String>) -> Result<(), String> {
    let backend = backend()?;
    require_session(&backend)?;
    db::reorder_entries(require_conn(&backend)?, &ids).map_err(domain)
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

fn category_of(row: db::CategoryRow) -> Category {
    Category {
        id: row.id,
        name: row.name,
        color: row.color,
        icon: row.icon,
        sort_order: row.sort_order,
        entry_count: row.entry_count,
    }
}

fn validate_category_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(coded("vault", "分类名称不能为空"));
    }
    if name.chars().count() > 40 {
        return Err(coded("vault", "分类名称过长（上限 40 字）"));
    }
    Ok(name.to_string())
}

fn list_categories_sync() -> Result<Vec<Category>, String> {
    let backend = backend()?;
    require_session(&backend)?;
    let rows = db::list_categories(require_conn(&backend)?).map_err(domain)?;
    Ok(rows.into_iter().map(category_of).collect())
}

fn create_category_sync(input: CategoryInput) -> Result<Category, String> {
    let backend = backend()?;
    require_session(&backend)?;
    let conn = require_conn(&backend)?;
    let name = validate_category_name(&input.name)?;
    let color = db::validate_category_color(&input.color).map_err(domain)?;
    let icon = db::validate_category_icon(&input.icon).map_err(domain)?;
    let id = Uuid::new_v4().to_string();
    db::create_category(conn, &id, &name, color.as_deref(), icon.as_deref()).map_err(domain)?;
    let row = db::list_categories(conn)
        .map_err(domain)?
        .into_iter()
        .find(|row| row.id == id)
        .ok_or_else(|| coded("db", "新建分类后未能读回"))?;
    Ok(category_of(row))
}

fn update_category_sync(id: String, input: CategoryInput) -> Result<Category, String> {
    let backend = backend()?;
    require_session(&backend)?;
    let conn = require_conn(&backend)?;
    let name = validate_category_name(&input.name)?;
    let color = db::validate_category_color(&input.color).map_err(domain)?;
    let icon = db::validate_category_icon(&input.icon).map_err(domain)?;
    db::rename_category(conn, &id, &name, color.as_deref(), icon.as_deref()).map_err(domain)?;
    let row = db::list_categories(conn)
        .map_err(domain)?
        .into_iter()
        .find(|row| row.id == id)
        .ok_or_else(|| coded("not_found", format!("分类 {id}")))?;
    Ok(category_of(row))
}

fn delete_category_sync(id: String) -> Result<(), String> {
    let backend = backend()?;
    require_session(&backend)?;
    db::delete_category(require_conn(&backend)?, &id).map_err(domain)
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

fn preset_input(input: PresetInput) -> presets::PresetInput {
    presets::PresetInput {
        field_type: input.field_type,
        label: input.label,
        value: input.value,
    }
}

fn preset_view(row: presets::PresetView) -> Preset {
    Preset {
        id: row.id,
        field_type: row.field_type,
        label: row.label,
        value: row.value,
        sort_order: row.sort_order,
    }
}

fn list_presets_sync() -> Result<Vec<Preset>, String> {
    let backend = backend()?;
    let session = require_session(&backend)?;
    let rows = db::list_presets(require_conn(&backend)?).map_err(domain)?;
    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        out.push(preset_view(
            presets::decrypt_row(&session.dek, row).map_err(domain)?,
        ));
    }
    Ok(out)
}

fn create_preset_sync(input: PresetInput) -> Result<Preset, String> {
    let backend = backend()?;
    let session = require_session(&backend)?;
    let conn = require_conn(&backend)?;
    let id = Uuid::new_v4().to_string();
    let sort_order = db::next_preset_sort(conn).map_err(domain)?;
    let row = presets::encrypt_input(
        &session.dek,
        &id,
        &preset_input(input),
        sort_order,
        db::now_ms(),
    )
    .map_err(domain)?;
    db::insert_preset(conn, &row).map_err(domain)?;
    presets::decrypt_row(&session.dek, &row)
        .map(preset_view)
        .map_err(domain)
}

fn update_preset_sync(id: String, input: PresetInput) -> Result<Preset, String> {
    let backend = backend()?;
    let session = require_session(&backend)?;
    let conn = require_conn(&backend)?;
    let existing = db::list_presets(conn)
        .map_err(domain)?
        .into_iter()
        .find(|row| row.id == id)
        .ok_or_else(|| coded("not_found", format!("预设 {id}")))?;
    let row = presets::encrypt_input(
        &session.dek,
        &id,
        &preset_input(input),
        existing.sort_order,
        existing.created_at,
    )
    .map_err(domain)?;
    db::update_preset(conn, &row).map_err(domain)?;
    presets::decrypt_row(&session.dek, &row)
        .map(preset_view)
        .map_err(domain)
}

fn delete_preset_sync(id: String) -> Result<(), String> {
    let backend = backend()?;
    require_session(&backend)?;
    db::delete_preset(require_conn(&backend)?, &id).map_err(domain)
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

fn generate_password_sync(options: GeneratorOptions) -> Result<String, String> {
    if !(6..=64).contains(&options.length) {
        return Err(coded("vault", "长度需在 6–64 之间"));
    }
    let options = generator::GeneratorOptions {
        length: options.length as usize,
        uppercase: options.uppercase,
        lowercase: options.lowercase,
        digits: options.digits,
        symbols: options.symbols,
        exclude_ambiguous: options.exclude_ambiguous,
    };
    generator::generate(&options).map_err(domain)
}

// ---------------------------------------------------------------------------
// Settings (non-sensitive, stored in the `meta` table)
// ---------------------------------------------------------------------------

fn read_string(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    Ok(db::meta_get(conn, key)
        .map_err(domain)?
        .filter(|value| !value.trim().is_empty()))
}

fn read_i64(conn: &Connection, key: &str, fallback: i64) -> Result<i64, String> {
    Ok(read_string(conn, key)?
        .and_then(|value| value.parse().ok())
        .unwrap_or(fallback))
}

fn get_settings_sync() -> Result<Settings, String> {
    let backend = backend()?;
    require_session(&backend)?;
    let conn = require_conn(&backend)?;
    Ok(Settings {
        language: read_string(conn, SETTING_LANGUAGE)?,
        theme: read_string(conn, SETTING_THEME)?.unwrap_or_else(|| "system".into()),
        auto_lock_minutes: read_i64(conn, SETTING_AUTO_LOCK, 15)?,
        update_check_interval_days: read_i64(conn, SETTING_UPDATE_DAYS, 7)?,
        last_update_check_ts: read_i64(conn, SETTING_LAST_UPDATE, 0)?,
    })
}

fn save_settings_sync(settings: Settings) -> Result<Settings, String> {
    let backend = backend()?;
    require_session(&backend)?;
    let conn = require_conn(&backend)?;

    let theme = settings.theme.trim().to_string();
    if !matches!(theme.as_str(), "system" | "light" | "dark") {
        return Err(coded("vault", "主题只能是 system / light / dark"));
    }
    if ![0, 1, 5, 10, 15, 30, 60].contains(&settings.auto_lock_minutes) {
        return Err(coded("vault", "自动锁定时间不在允许范围内"));
    }
    if ![0, 7, 30, 365].contains(&settings.update_check_interval_days) {
        return Err(coded("vault", "更新检查间隔不在允许范围内"));
    }
    if settings.last_update_check_ts < 0 {
        return Err(coded("vault", "更新时间戳非法"));
    }
    let language = settings
        .language
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let tx = conn
        .unchecked_transaction()
        .map_err(|err| coded("db", err.to_string()))?;
    db::meta_set(&tx, SETTING_LANGUAGE, language.unwrap_or("")).map_err(domain)?;
    db::meta_set(&tx, SETTING_THEME, &theme).map_err(domain)?;
    db::meta_set(
        &tx,
        SETTING_AUTO_LOCK,
        &settings.auto_lock_minutes.to_string(),
    )
    .map_err(domain)?;
    db::meta_set(
        &tx,
        SETTING_UPDATE_DAYS,
        &settings.update_check_interval_days.to_string(),
    )
    .map_err(domain)?;
    db::meta_set(
        &tx,
        SETTING_LAST_UPDATE,
        &settings.last_update_check_ts.to_string(),
    )
    .map_err(domain)?;
    tx.commit().map_err(|err| coded("db", err.to_string()))?;

    Ok(Settings {
        language: language.map(str::to_string),
        theme,
        auto_lock_minutes: settings.auto_lock_minutes,
        update_check_interval_days: settings.update_check_interval_days,
        last_update_check_ts: settings.last_update_check_ts,
    })
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

fn app_paths_sync() -> Result<AppPaths, String> {
    let backend = backend()?;
    Ok(AppPaths {
        data_dir: backend.data_dir.display().to_string(),
        db_path: backend.db_path.display().to_string(),
    })
}

fn export_to_path(path: PathBuf, master_password: String) -> Result<ExportResult, String> {
    let backend = backend()?;
    let session = require_session(&backend)?;
    let conn = require_conn(&backend)?;
    let (kek, dek, salt, kdf) =
        vault::derive_kek_and_unwrap(conn, &master_password).map_err(domain)?;
    if *dek != *session.dek {
        return Err(coded("vault", "主密码与当前库不匹配"));
    }
    let db_bytes = fs::read(&backend.db_path)
        .map_err(|err| coded("vault", format!("读取库文件失败: {err}")))?;
    let blob = backup::export(&db_bytes, &kek, &salt, kdf).map_err(domain)?;
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|err| coded("vault", format!("创建备份目录失败: {err}")))?;
        }
    }
    fs::write(&path, &blob).map_err(|err| coded("vault", format!("写入备份失败: {err}")))?;
    Ok(ExportResult {
        path: path.display().to_string(),
        bytes: blob.len() as u64,
    })
}

fn default_backup_path(backend: &Backend, file_name: Option<String>) -> PathBuf {
    let name = file_name
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| format!("mend-backup-{}.mendbak", db::now_ms()));
    let name = if name.to_ascii_lowercase().ends_with(".mendbak") {
        name
    } else {
        format!("{name}.mendbak")
    };
    backend.data_dir.join(name)
}

fn validate_backup_file(path: &Path, master_password: &str) -> Result<(u64, u64), String> {
    let conn = db::open_and_migrate(path).map_err(domain)?;
    if !db::is_initialized(&conn).map_err(domain)? {
        return Err(coded("vault", "备份中的库尚未初始化"));
    }
    vault::unlock(&conn, master_password).map_err(domain)?;
    let entries = db::list_entries(&conn, None, None).map_err(domain)?.len() as u64;
    let categories = db::list_categories(&conn).map_err(domain)?.len() as u64;
    Ok((entries, categories))
}

fn import_blob_sync(blob: Vec<u8>, master_password: String) -> Result<ImportResult, String> {
    let mut backend = backend()?;
    ensure_unlocked(&mut backend)?;
    if !backup::is_backup(&blob) {
        return Err(coded("vault", "不是有效的 Mend 备份文件"));
    }

    let payload = backup::import(&blob, &master_password).map_err(domain)?;
    if payload.len() < SQLITE_MAGIC.len() || &payload[..SQLITE_MAGIC.len()] != SQLITE_MAGIC {
        return Err(coded("vault", "备份内容不是有效的数据库文件"));
    }

    let temp = backend
        .data_dir
        .join(format!("mend-import-{}.db", Uuid::new_v4()));
    if let Err(err) = fs::write(&temp, &payload) {
        let _ = fs::remove_file(&temp);
        return Err(coded("vault", format!("写入临时文件失败: {err}")));
    }
    let counts = match validate_backup_file(&temp, &master_password) {
        Ok(counts) => counts,
        Err(err) => {
            let _ = fs::remove_file(&temp);
            return Err(err);
        }
    };

    // The current connection must be closed before the file is replaced.
    backend.session = None;
    backend.conn = None;
    let target = backend.db_path.clone();
    let previous_backup = if target.exists() {
        let stamp = db::now_ms();
        let backup_name = format!("{}.bak-{stamp}", db::DB_FILE_NAME);
        let backup_path = backend.data_dir.join(&backup_name);
        if let Err(err) = fs::rename(&target, &backup_path) {
            let _ = fs::remove_file(&temp);
            return Err(coded("vault", format!("替换前留底失败: {err}")));
        }
        Some(backup_name)
    } else {
        None
    };

    if let Err(err) = fs::rename(&temp, &target) {
        if let Some(name) = &previous_backup {
            let _ = fs::rename(backend.data_dir.join(name), &target);
        }
        let _ = fs::remove_file(&temp);
        return Err(coded("vault", format!("替换库文件失败: {err}")));
    }

    Ok(ImportResult {
        entries: counts.0,
        categories: counts.1,
        previous_backup,
    })
}

// ---------------------------------------------------------------------------
// Exported module functions
// ---------------------------------------------------------------------------

pub fn init(data_dir: Option<String>) -> Result<VaultStatus, String> {
    let resolved = resolve_data_dir(data_dir)?;
    init_sync(Some(resolved.display().to_string()))
}

pub fn status() -> Result<VaultStatus, String> {
    status_sync()
}

pub fn setup(master_password: String) -> Result<VaultStatus, String> {
    setup_sync(master_password)
}

pub fn unlock(master_password: String) -> Result<VaultStatus, String> {
    unlock_sync(master_password)
}

pub fn lock() -> Result<(), String> {
    lock_sync()
}

pub fn change_password(old_password: String, new_password: String) -> Result<(), String> {
    change_password_sync(old_password, new_password)
}

pub fn list_entries(filter: ListFilter) -> Result<Vec<EntrySummary>, String> {
    list_entries_sync(filter)
}

pub fn get_entry(id: String) -> Result<EntryView, String> {
    get_entry_sync(id)
}

pub fn create_entry(input: EntryInput) -> Result<EntryView, String> {
    create_entry_sync(input)
}

pub fn update_entry(id: String, input: EntryInput) -> Result<EntryView, String> {
    update_entry_sync(id, input)
}

pub fn set_favorite(id: String, favorite: bool) -> Result<EntrySummary, String> {
    set_favorite_sync(id, favorite)
}

pub fn delete_entry(id: String) -> Result<(), String> {
    delete_entry_sync(id)
}

pub fn restore_entry(id: String) -> Result<(), String> {
    restore_entry_sync(id)
}

pub fn purge_entry(id: String) -> Result<(), String> {
    purge_entry_sync(id)
}

pub fn purge_all_trash() -> Result<u64, String> {
    purge_all_trash_sync()
}

pub fn archive_entry(id: String) -> Result<(), String> {
    archive_entry_sync(id)
}

pub fn unarchive_entry(id: String) -> Result<(), String> {
    unarchive_entry_sync(id)
}

pub fn reorder_entries(ids: Vec<String>) -> Result<(), String> {
    reorder_entries_sync(ids)
}

pub fn list_categories() -> Result<Vec<Category>, String> {
    list_categories_sync()
}

pub fn create_category(input: CategoryInput) -> Result<Category, String> {
    create_category_sync(input)
}

pub fn update_category(id: String, input: CategoryInput) -> Result<Category, String> {
    update_category_sync(id, input)
}

pub fn delete_category(id: String) -> Result<(), String> {
    delete_category_sync(id)
}

pub fn list_presets() -> Result<Vec<Preset>, String> {
    list_presets_sync()
}

pub fn create_preset(input: PresetInput) -> Result<Preset, String> {
    create_preset_sync(input)
}

pub fn update_preset(id: String, input: PresetInput) -> Result<Preset, String> {
    update_preset_sync(id, input)
}

pub fn delete_preset(id: String) -> Result<(), String> {
    delete_preset_sync(id)
}

pub fn generate_password(options: GeneratorOptions) -> Result<String, String> {
    generate_password_sync(options)
}

pub fn get_settings() -> Result<Settings, String> {
    get_settings_sync()
}

pub fn save_settings(settings: Settings) -> Result<Settings, String> {
    save_settings_sync(settings)
}

pub fn app_paths() -> Result<AppPaths, String> {
    app_paths_sync()
}

/// Export an encrypted backup. Without a path, the file is written into the
/// app data directory (the UI shows the path and can reveal the folder).
pub fn export_backup(
    path: Option<String>,
    file_name: Option<String>,
    master_password: String,
) -> Result<ExportResult, String> {
    let target = match path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        Some(path) => PathBuf::from(path),
        None => {
            let backend = backend()?;
            default_backup_path(&backend, file_name)
        }
    };
    export_to_path(target, master_password)
}

pub fn import_backup(path: String, master_password: String) -> Result<ImportResult, String> {
    let path = PathBuf::from(path.trim());
    let blob = fs::read(&path).map_err(|err| coded("vault", format!("读取备份文件失败: {err}")))?;
    import_blob_sync(blob, master_password)
}

pub fn import_backup_base64(
    data_base64: String,
    master_password: String,
) -> Result<ImportResult, String> {
    let blob = B64
        .decode(data_base64.trim())
        .map_err(|_| coded("vault", "备份数据格式非法"))?;
    import_blob_sync(blob, master_password)
}

pub async fn reveal_data_dir() -> Result<(), String> {
    let path = {
        let backend = backend()?;
        backend.data_dir.clone()
    };
    reveal_path(path)
        .await
        .map_err(|err| coded("vault", format!("打开数据目录失败: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dto::{CategoryInput, EntryInput, GeneratorOptions, ListFilter, PresetInput};

    fn input(title: &str, category: Option<String>) -> EntryInput {
        EntryInput {
            category_id: category,
            title: title.into(),
            url: Some("https://example.com".into()),
            username: "octocat".into(),
            password: "s3cret-value".into(),
            email: "octocat@example.com".into(),
            phone: "13800138000".into(),
            notes: "# hello".into(),
            favorite: false,
            tags: vec!["work".into()],
        }
    }

    #[test]
    fn adapter_flow_with_backup_and_restore() {
        let dir = std::env::temp_dir().join(format!("mend-native-test-{}", Uuid::new_v4()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let password = "adapter-password-1234";

        let status = init_sync(Some(dir.display().to_string())).unwrap();
        assert!(!status.initialized);
        setup_sync(password.into()).unwrap();

        let category = create_category_sync(CategoryInput {
            name: "Work".into(),
            color: Some("#2563EB".into()),
            icon: Some("briefcase".into()),
        })
        .unwrap();

        let entry = create_entry_sync(input("GitHub", Some(category.id.clone()))).unwrap();
        assert_eq!(entry.username, "octocat");

        let all = list_entries_sync(ListFilter {
            bucket: "all".into(),
            category_id: None,
            keyword: None,
            tag: None,
        })
        .unwrap();
        assert_eq!(all.len(), 1);

        let searched = list_entries_sync(ListFilter {
            bucket: "all".into(),
            category_id: None,
            keyword: Some("octocat".into()),
            tag: None,
        })
        .unwrap();
        assert_eq!(searched.len(), 1);

        let favorited = set_favorite_sync(entry.id.clone(), true).unwrap();
        assert!(favorited.favorite);

        archive_entry_sync(entry.id.clone()).unwrap();
        assert_eq!(
            list_entries_sync(ListFilter {
                bucket: "archive".into(),
                category_id: None,
                keyword: None,
                tag: None,
            })
            .unwrap()
            .len(),
            1
        );
        unarchive_entry_sync(entry.id.clone()).unwrap();

        delete_entry_sync(entry.id.clone()).unwrap();
        assert_eq!(
            list_entries_sync(ListFilter {
                bucket: "trash".into(),
                category_id: None,
                keyword: None,
                tag: None,
            })
            .unwrap()
            .len(),
            1
        );
        restore_entry_sync(entry.id.clone()).unwrap();
        delete_entry_sync(entry.id.clone()).unwrap();
        purge_entry_sync(entry.id.clone()).unwrap();

        let preset = create_preset_sync(PresetInput {
            field_type: "email".into(),
            label: "Work".into(),
            value: "octocat@example.com".into(),
        })
        .unwrap();
        assert_eq!(list_presets_sync().unwrap().len(), 1);
        update_preset_sync(
            preset.id.clone(),
            PresetInput {
                field_type: "email".into(),
                label: "Work 2".into(),
                value: "octocat+2@example.com".into(),
            },
        )
        .unwrap();
        delete_preset_sync(preset.id.clone()).unwrap();

        let generated = generate_password_sync(GeneratorOptions {
            length: 20,
            uppercase: true,
            lowercase: true,
            digits: true,
            symbols: true,
            exclude_ambiguous: false,
        })
        .unwrap();
        assert_eq!(generated.chars().count(), 20);

        // A second entry survives the backup round trip.
        let kept = create_entry_sync(input("Keep me", Some(category.id.clone()))).unwrap();
        let backup = dir.join("test.mendbak");
        export_to_path(backup.clone(), password.into()).unwrap();
        assert!(backup.exists());

        let blob = fs::read(&backup).unwrap();
        let restored = import_blob_sync(blob, password.into()).unwrap();
        assert_eq!(restored.entries, 1);
        unlock_sync(password.into()).unwrap();
        let after = list_entries_sync(ListFilter {
            bucket: "all".into(),
            category_id: None,
            keyword: None,
            tag: None,
        })
        .unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].id, kept.id);

        let _ = fs::remove_dir_all(&dir);
    }
}
