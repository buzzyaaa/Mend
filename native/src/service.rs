//! The vault service behind the TSX UI.
//!
//! One process-wide SQLite connection and one in-memory session DEK. Every
//! call is serialized by a mutex; expensive work (Argon2, whole-database
//! reads/writes) runs on the nsh blocking thread pool through `blocking`, so
//! the engine thread keeps drawing while a key is derived. Only the cheap part
//! (reading `meta`, writing what was prepared) touches the connection on the
//! engine thread. The domain rules and the on-disk formats live in `mend-core`
//! unchanged.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, OnceLock},
};

use base64::{Engine, engine::general_purpose::STANDARD as B64};
use mend_core::{
    db,
    db::{Connection, EntryRowEnc},
    entries, generator, presets,
    session::Session,
    vault,
};
use nsh_core::{
    file_dialog::{FileFilter, OpenDialog, SaveDialog},
    prelude::{blocking, data_dir, open_path, pick_paths, pick_save_path, reveal_path},
};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

use crate::icons;
use crate::dto::{
    Category, CategoryInput, EntryInput, EntrySummary, EntryView, GeneratorOptions,
    IconFetchReport, ListFilter, Preset, PresetInput, Settings, Tag, TagInput, VaultStatus,
};
use crate::error::{coded, domain};

const SETTING_LANGUAGE: &str = "ui.language";
const SETTING_THEME: &str = "ui.theme";
const SETTING_AUTO_LOCK: &str = "ui.auto_lock_minutes";
const SETTING_UPDATE_DAYS: &str = "ui.update_check_interval_days";
const SETTING_LAST_UPDATE: &str = "ui.last_update_check_ts";
const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";

/// 免主密码解锁的密钥文件名前缀（实际文件名带库路径哈希，见 `device_key_path`）。
const DEVICE_KEY_FILE: &str = "device-unlock.key";
/// UI 偏好（语言/主题/自动锁定/列宽），非敏感，解锁前就要读。
const PREFERENCES_FILE: &str = "preferences.json";
/// 指向「当前使用的库文件」的指针（非敏感，只存一个绝对路径）。
///
/// 用户可以把库文件放到任意位置（自己的 U 盘、同步盘、任意目录）并随时切换。
/// 应用本身总得有个固定的地方记住选了哪个文件，这就是那个锚点；删除它即
/// 回到数据目录里的默认 `mend.db`。
const LOCATION_FILE: &str = "vault-location.json";

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

/// Make sure the data directory and the database file can actually be written
/// to before SQLite is asked to open them.
///
/// SQLite reports a read-only directory / read-only file as
/// `attempt to write a readonly database` or `unable to open database file`,
/// which hides the real cause. This happens on Windows when the app runs with
/// a lower mandatory integrity level than its data directory (for example an
/// executable unpacked into a folder carrying a `Low Mandatory Level` label):
/// the process may read the vault but Windows denies every write to the
/// medium-integrity `%APPDATA%` folder. Probing up front turns that into a
/// dedicated `db_readonly` error with an actionable message and the path.
fn ensure_writable_data_dir(dir: &Path, db_path: &Path) -> Result<(), String> {
    let probe = dir.join(format!(".mend-write-probe-{}", Uuid::new_v4()));
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
    {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
        }
        Err(err) => {
            return Err(coded(
                "db_readonly",
                format!("数据目录不可写 ({err}): {}", dir.display()),
            ));
        }
    }

    // An existing vault must be writable too (a read-only file attribute or a
    // restrictive ACL is otherwise only discovered during the first write).
    if db_path.exists() {
        if let Err(err) = fs::OpenOptions::new().read(true).write(true).open(db_path) {
            return Err(coded(
                "db_readonly",
                format!("数据库文件不可写 ({err}): {}", db_path.display()),
            ));
        }
    }
    Ok(())
}

/// 依次尝试的数据目录列表。第一个是 nsh 提供 / 配置的目录（Windows 上通常是
/// `%APPDATA%\\com.mend.app`）；其余是逐步“兜底”的位置。每个目录在使用前都会
/// 用 `prepare_dir` 实际探测是否可写，因此当前进程写不了某个目录（例如
/// `%APPDATA%` 带着限制性 ACL，或 `nsh dev` 宿主以 Low 完整性级别运行、无法写
/// 入任何 Medium 级别的用户目录）时会被直接跳过，而不是让整个启动失败。
///
/// 兜底顺序（dev 场景下最关键的是 `LocalLow`，它是 Low 完整性进程唯一能稳定
/// 写入的位置）：
///   1. nsh 数据目录（发布版可写，直接用）
///   2. `MEND_DEV_DATA_DIR`（可选，显式指定时优先，便于测试/调试用隔离库）
///   3. `LocalLow\\com.mend.app` —— Low 完整性 dev 宿主的可写目录
///   4. `%LOCALAPPDATA%\\com.mend.app`
///   5. `%USERPROFILE%\\.mend`
///   6. `%TEMP%\\com.mend.app`
fn candidate_data_dirs(primary: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = vec![primary.to_path_buf()];
    let mut push = |candidate: Option<PathBuf>| {
        if let Some(candidate) = candidate {
            if !dirs.iter().any(|existing| existing == &candidate) {
                dirs.push(candidate);
            }
        }
    };
    // 可选的开发者数据目录：显式指定时**优先于** Low 完整性兜底目录，
    // 这样测试/调试用 `MEND_DEV_DATA_DIR` 就能拿到一个干净隔离的库。
    if let Some(value) = std::env::var_os("MEND_DEV_DATA_DIR").filter(|value| !value.is_empty()) {
        push(Some(PathBuf::from(value)));
    }
    // Low 完整性 dev 宿主的兜底：Windows 为低完整性进程预留的可写目录。
    push(local_low_dir());
    if let Some(value) = std::env::var_os("LOCALAPPDATA").filter(|value| !value.is_empty()) {
        push(Some(Path::new(&value).join("com.mend.app")));
    }
    if let Some(value) = std::env::var_os("USERPROFILE").filter(|value| !value.is_empty()) {
        push(Some(Path::new(&value).join(".mend")));
    }
    if let Some(value) = std::env::var_os("TEMP").filter(|value| !value.is_empty()) {
        push(Some(Path::new(&value).join("com.mend.app")));
    }
    dirs
}

/// 确保 `dir` 存在且真正可写，然后再交给 SQLite 打开。`prepare_dir` 比裸
/// `create_dir_all` 更稳：对于“已存在但当前进程无法重新创建”的目录，错误由内部
/// 的写探针（而非 `create_dir_all`）报出，从而让候选链能继续往下试。
fn prepare_dir(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        if let Err(err) = fs::create_dir_all(dir) {
            return Err(format!("无法创建目录 ({err}): {}", dir.display()));
        }
    }
    ensure_writable_data_dir(dir, &db::db_file_path(dir))
}

/// 尽力把 `src` 里已有的保险库复制到 `dst`：当配置的数据目录不可写、我们回退到
/// 另一个位置时调用，避免用户丢失已有条目。复制失败一律忽略——新目录照样能打开，
/// 必要时用户可以用 `.mendbak` 备份恢复。
fn migrate_vault(src: &Path, dst: &Path) {
    let src_db = src.join("mend.db");
    if !src_db.exists() {
        return;
    }
    let dst_db = dst.join("mend.db");
    if dst_db.exists() {
        return;
    }
    let _ = fs::copy(&src_db, &dst_db);
    if let Ok(entries) = fs::read_dir(src) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) == Some("mendbak") {
                let dst_file = dst.join(entry.file_name());
                if !dst_file.exists() {
                    let _ = fs::copy(&path, &dst_file);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 库文件位置：用户可以在设置或解锁页自选一个 .menddb 文件
// ---------------------------------------------------------------------------
//
// 设计取舍：**库文件本身就是完整的保险库**——主密码校验所需的 salt / Argon2
// 参数 / 被包裹的 DEK 全在库文件里，所以「记住主密码」这件事不需要额外的
// 账户体系。用户要做的只是选中一个文件，应用把绝对路径写进数据目录的
// `vault-location.json`，之后所有读写都走这个文件；用户可以自己拷贝它、
// 换台机器带着走，或者同时维护多个库（工作 / 个人）随时切换。
//
// 切换 = 关掉当前连接 + 清会话密钥（等价于锁定）+ 用新路径重新打开。
// 新文件不存在时它就是一座空库，UI 会走「首次设置主密码」的流程。

fn location_path(data_dir: &Path) -> PathBuf {
    data_dir.join(LOCATION_FILE)
}

/// 读取用户选定的库文件路径；没有选过（或文件损坏）时为 `None`。
fn read_located_vault(data_dir: &Path) -> Option<PathBuf> {
    let raw = fs::read_to_string(location_path(data_dir)).ok()?;
    let value: serde_json::Value = serde_json::from_str(raw.trim()).ok()?;
    let path = value.get("path")?.as_str()?.trim().to_string();
    if path.is_empty() {
        return None;
    }
    Some(PathBuf::from(path))
}

fn write_located_vault(data_dir: &Path, path: &Path) -> Result<(), String> {
    let body = serde_json::json!({
        "v": 1,
        "path": path.display().to_string(),
    });
    let text = serde_json::to_string_pretty(&body)
        .map_err(|err| coded("vault", format!("序列化库文件位置失败: {err}")))?;
    let target = location_path(data_dir);
    write_private_file(&target, text.as_bytes())
        .map_err(|_| coded("vault", format!("保存库文件位置失败: {}", target.display())))
}

fn clear_located_vault(data_dir: &Path) -> Result<(), String> {
    let target = location_path(data_dir);
    match fs::remove_file(&target) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(coded(
            "vault",
            format!("清除库文件位置失败 ({err}): {}", target.display()),
        )),
    }
}

/// 一个目录（以及可选的既有文件）当前是否真的能写。
///
/// 目录存在 ≠ 能写：Windows 上以低完整性级别运行的进程连「我的文档」「桌面」
/// 都会被拒绝（ACCESS_DENIED），而 `fs::write` 的错误信息又很难读懂。先真写
/// 一个探针文件，能给出确定的结论，也让 UI 可以在导出时体面地退回数据目录。
fn probe_writable(dir: &Path, existing_file: Option<&Path>) -> Result<(), String> {
    if !dir.is_dir() {
        return Err(coded(
            "export_dir",
            format!("目录不存在: {}", dir.display()),
        ));
    }
    let probe = dir.join(format!(".mend-write-probe-{}", Uuid::new_v4()));
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
    {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
        }
        Err(err) => {
            return Err(coded(
                "export_dir",
                format!("目录不可写 ({err}): {}", dir.display()),
            ));
        }
    }
    if let Some(file) = existing_file.filter(|file| file.exists()) {
        if let Err(err) = fs::OpenOptions::new().read(true).write(true).open(file) {
            return Err(coded(
                "export_dir",
                format!("文件不可写 ({err}): {}", file.display()),
            ));
        }
    }
    Ok(())
}

/// 文件开头是否像 SQLite 库。空文件放行（SQLite 会把它初始化成一座库）；
/// 用户误选了图片或 `.mendbak` 备份时，早点给出明确提示，而不是让 SQLite
/// 抛一句 `file is not a database`。
fn looks_like_sqlite(path: &Path) -> Result<bool, String> {
    use std::io::Read;
    let mut file = fs::File::open(path)
        .map_err(|err| coded("vault", format!("读取 {} 失败: {err}", path.display())))?;
    let mut head = vec![0u8; SQLITE_MAGIC.len()];
    let read = file
        .read(&mut head)
        .map_err(|err| coded("vault", format!("读取 {} 失败: {err}", path.display())))?;
    head.truncate(read);
    Ok(head.is_empty() || head == SQLITE_MAGIC)
}

fn ensure_conn(backend: &mut Backend) -> Result<(), String> {
    if backend.conn.is_none() {
        // busy_timeout 由 db::open_and_migrate 在任何读写之前统一设置
        //（覆盖 open / pragma / migrate 全程），这里不再重复设置。
        // 备份导入的临时连接（validate_backup_file）走同一个入口，同样有忙等待。
        let conn = db::open_and_migrate(&backend.db_path).map_err(|err| {
            let message = err.to_string();
            if message.contains("readonly") || message.contains("unable to open database file") {
                // Keep the OS-level detail but use a code the UI can explain.
                coded(
                    "db_readonly",
                    format!("{message} @ {}", backend.db_path.display()),
                )
            } else {
                domain(err)
            }
        })?;
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

/// Windows 上为「低完整性级别」进程（典型如 `nsh dev` 宿主）预留的可写目录
/// `LocalLow` 下的应用目录。`nsh dev` 宿主通常跑在 Low 完整性级别，无法写入
/// Medium 级别的 `%APPDATA%`/`%LOCALAPPDATA%`/`%USERPROFILE%`/`%TEMP%`，但
/// `LocalLow` 就是为此而存在的可写位置——因此它是 dev 模式下最可靠的兜底候选。
fn local_low_dir() -> Option<PathBuf> {
    let userprofile = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)?;
    Some(
        userprofile
            .join("AppData")
            .join("LocalLow")
            .join("com.mend.app"),
    )
}

// ---------------------------------------------------------------------------
// Small file helpers
// ---------------------------------------------------------------------------

/// 只在 Unix 上收窄权限：Windows 上文件继承所在目录的 ACL，
/// 与该目录里的 `mend.db` 同级同权，改不了更多。
fn write_private_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    fs::write(path, bytes)
        .map_err(|err| coded("vault", format!("写入 {} 失败: {err}", path.display())))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// 用系统文件管理器打开一个目录。
///
/// 不用 nsh 的 `reveal_path`（`SHOpenFolderAndSelectItems`）作为首选：
/// 进程的完整性级别与 Explorer 不一致时它返回 `access denied`，而且它要经
/// nsh 的文件请求通道，那条链路在部分环境里还会把 `storage.json` 的写入
/// 错误暴露出来（用户实际遇到的就是这条）。自己起进程最简单也最稳。
#[cfg(target_os = "windows")]
fn spawn_opener(dir: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    /// 不弹控制台窗口。
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("explorer.exe")
        .arg(dir)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[cfg(target_os = "macos")]
fn spawn_opener(dir: &Path) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn spawn_opener(dir: &Path) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[cfg(not(any(target_os = "windows", unix)))]
fn spawn_opener(_dir: &Path) -> Result<(), String> {
    Err("当前平台没有文件管理器".into())
}

/// 打开文件管理器并**选中**该文件（Windows 的 `/select,`）。
#[cfg(target_os = "windows")]
fn spawn_revealer(file: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    /// 不弹控制台窗口。
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("explorer.exe")
        .arg(format!("/select,{}", file.display()))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[cfg(not(target_os = "windows"))]
fn spawn_revealer(file: &Path) -> Result<(), String> {
    match file.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => spawn_opener(dir),
        _ => Err("无法定位文件所在目录".into()),
    }
}

/// 后台任务失败（panic / 运行时关闭）时的统一错误。
fn join_error(err: impl std::fmt::Display) -> String {
    coded("internal", format!("后台任务失败: {err}"))
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

pub fn init_sync(data_dir: Option<String>) -> Result<VaultStatus, String> {
    let primary = resolve_data_dir(data_dir)?;
    let candidates = candidate_data_dirs(&primary);

    // 依次探测候选目录，使用第一个真正可写的；配置目录不可写时回退并把已有
    // 保险库迁移过去。全部不可写才给出带每个候选失败明细的诊断信息。
    let mut failures: Vec<String> = Vec::new();
    for candidate in &candidates {
        match prepare_dir(candidate) {
            Ok(()) => {
                // 用户自选的库文件优先：它的位置与数据目录无关，所以先读指针。
                // 指针指向的文件所在目录必须可写（可能是被拔掉的移动硬盘或只读
                // 目录），不可写就带着路径报错，而不是静默换回默认库。
                let located = read_located_vault(candidate);
                let db_path = match &located {
                    Some(path) => {
                        if let Some(parent) =
                            path.parent().filter(|dir| !dir.as_os_str().is_empty())
                        {
                            if let Err(err) = probe_writable(parent, Some(path)) {
                                return Err(rewrap_probe_error(err, "库文件"));
                            }
                        }
                        path.clone()
                    }
                    None => {
                        if candidate != &primary {
                            migrate_vault(&primary, candidate);
                        }
                        db::db_file_path(candidate)
                    }
                };
                let mut backend = backend()?;
                if backend.db_path != db_path {
                    backend.conn = None;
                    backend.session = None;
                }
                backend.data_dir = candidate.clone();
                backend.db_path = db_path;
                // 老版本的单文件密钥 → 按库命名的密钥（只影响升级后的第一次启动）。
                migrate_legacy_device_key(&backend);
                ensure_conn(&mut backend)?;
                return status_of(&backend);
            }
            Err(err) => failures.push(format!("· {} → {}", candidate.display(), err)),
        }
    }

    Err(coded(
        "db_readonly",
        format!(
            "所有候选数据目录均不可写，无法启动：\n{}\n\n可设置环境变量 MEND_DATA_DIR 或 MEND_DEV_DATA_DIR 指向一个可写目录后重试。",
            failures.join("\n")
        ),
    ))
}

/// `probe_writable` 用的是导出场景的错误码（`export_dir`）。库文件场景下它
/// 意味着「库文件不可用」，换成 `db_readonly` 才能命中 UI 已有的操作指引文案。
fn rewrap_probe_error(err: String, what: &str) -> String {
    let message = err
        .split_once('|')
        .map(|(_, message)| message.to_string())
        .unwrap_or(err);
    coded("db_readonly", format!("{what}不可用: {message}"))
}

pub fn status_sync() -> Result<VaultStatus, String> {
    let backend = backend()?;
    status_of(&backend)
}

#[cfg(test)]
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

#[cfg(test)]
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

// ---------------------------------------------------------------------------
// 切换库文件 / 选择库文件
// ---------------------------------------------------------------------------

/// 切换到 `path` 指向的库文件；`None` 表示回到数据目录里的默认 `mend.db`。
///
/// 切换会关闭当前连接并清掉会话密钥（等价于锁定），然后用新文件重新建连接。
/// 所有校验都在动状态之前完成；`ensure_conn` 万一失败会把指针回滚，避免应用
/// 停在「记住了一个打不开的库」这种状态。
pub fn switch_vault_sync(path: Option<String>) -> Result<VaultStatus, String> {
    // 数据库文件的校验与位置写入不碰连接，先在锁外算清楚（少占一次锁）。
    let mut backend = backend()?;
    if backend.data_dir.as_os_str().is_empty() {
        return Err(coded("vault", "数据目录尚未就绪，请重启应用"));
    }
    let data_dir = backend.data_dir.clone();
    let previous = read_located_vault(&data_dir);

    let target = match path.as_deref().map(str::trim).filter(|raw| !raw.is_empty()) {
        Some(raw) => {
            let path = PathBuf::from(raw);
            if path.is_dir() {
                return Err(coded(
                    "vault",
                    format!("这是一个文件夹，请选择数据库文件: {}", path.display()),
                ));
            }
            let parent = path
                .parent()
                .filter(|dir| !dir.as_os_str().is_empty())
                .ok_or_else(|| coded("vault", format!("路径不合法: {}", path.display())))?
                .to_path_buf();
            if !parent.is_dir() {
                return Err(coded("vault", format!("目录不存在: {}", parent.display())));
            }
            if path.exists() && !looks_like_sqlite(&path)? {
                return Err(coded(
                    "vault_not_db",
                    format!("这个文件不是 Mend 数据库: {}", path.display()),
                ));
            }
            probe_writable(&parent, Some(&path))
                .map_err(|err| rewrap_probe_error(err, "库文件所在目录"))?;
            write_located_vault(&data_dir, &path)?;
            Some(path)
        }
        None => {
            clear_located_vault(&data_dir)?;
            None
        }
    };

    let db_path = target.unwrap_or_else(|| db::db_file_path(&data_dir));
    if backend.db_path != db_path {
        backend.conn = None;
        backend.session = None;
        backend.db_path = db_path;
    }
    match ensure_conn(&mut backend) {
        Ok(()) => status_of(&backend),
        Err(err) => {
            // 回滚到切换前的指针与路径，让用户还能回到原来那座库。
            if let Some(path) = previous.as_deref() {
                let _ = write_located_vault(&data_dir, path);
            } else {
                let _ = clear_located_vault(&data_dir);
            }
            backend.conn = None;
            backend.session = None;
            backend.db_path = previous.unwrap_or_else(|| db::db_file_path(&data_dir));
            let _ = ensure_conn(&mut backend);
            Err(err)
        }
    }
}

/// 用系统「打开文件」对话框选一个已有库文件；取消时 `None`。
pub async fn pick_vault_file(
    title: String,
    button_label: String,
    start_dir: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = OpenDialog::files().multiple(false).filter(FileFilter::new(
        "Mend 数据库",
        ["menddb", "db", "sqlite", "sqlite3"],
    ));
    if !button_label.trim().is_empty() {
        dialog = dialog.button_label(button_label);
    }
    if !title.trim().is_empty() {
        dialog = dialog.title(title);
    }
    if let Some(dir) = start_dir.filter(|dir| Path::new(dir).is_dir()) {
        dialog = dialog.directory(dir);
    }
    match pick_paths(dialog).await {
        Ok(Some(paths)) => Ok(paths
            .into_iter()
            .next()
            .map(|path| path.display().to_string())),
        Ok(None) => Ok(None),
        Err(err) => Err(coded("vault", format!("打开文件选择窗口失败: {err}"))),
    }
}

/// 用系统「保存文件」对话框指定一个新库文件的位置；取消时 `None`。
///
/// 只返回路径，不创建文件——真正的建库发生在用户设好主密码之后
/// （`setup`），避免留下一个空文件让人误解成「已经有库了」。
pub async fn pick_new_vault_file(
    title: String,
    button_label: String,
    start_dir: Option<String>,
    file_name: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = SaveDialog::new().filter(FileFilter::new("Mend 数据库", ["menddb"]));
    if let Some(name) = file_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        dialog = dialog.file_name(name);
    }
    if !button_label.trim().is_empty() {
        dialog = dialog.button_label(button_label);
    }
    if !title.trim().is_empty() {
        dialog = dialog.title(title);
    }
    if let Some(dir) = start_dir.filter(|dir| Path::new(dir).is_dir()) {
        dialog = dialog.directory(dir);
    }
    match pick_save_path(dialog).await {
        Ok(Some(path)) => Ok(Some(path.display().to_string())),
        Ok(None) => Ok(None),
        Err(err) => Err(coded("vault", format!("打开保存窗口失败: {err}"))),
    }
}

// --- 异步变体：把 Argon2 派生挪到运行时阻塞线程池 -----------------------
//
// 同步导出会让引擎线程在派生期间完全无法绘制（debug 构建下 64 MiB/t3 的
// Argon2id 实测约 1.5 秒），用户看到的就是「点了解锁没反应，一秒后突然跳
// 主界面」。这里只把**纯 CPU** 的部分（`vault::prepare_*` / `challenge.solve`）
// 放进 `blocking`，读写连接与写 signal 仍留在引擎线程。

pub async fn setup_async(master_password: String) -> Result<VaultStatus, String> {
    {
        let mut backend = backend()?;
        ensure_conn(&mut backend)?;
        if backend.session.is_some() {
            return status_of(&backend);
        }
    }
    let prepared = blocking(move || vault::prepare_setup(&master_password).map_err(domain))
        .await
        .map_err(join_error)??;
    let mut backend = backend()?;
    if backend.session.is_some() {
        return status_of(&backend);
    }
    let conn = require_conn(&backend)?;
    let keys = vault::apply_setup(conn, prepared).map_err(domain)?;
    backend.session = Some(Session {
        dek: keys.dek,
        kdf: keys.kdf,
    });
    status_of(&backend)
}

pub async fn unlock_async(master_password: String) -> Result<VaultStatus, String> {
    let challenge = {
        let mut backend = backend()?;
        ensure_conn(&mut backend)?;
        if backend.session.is_some() {
            return status_of(&backend);
        }
        let conn = require_conn(&backend)?;
        vault::challenge(conn).map_err(domain)?
    };
    let keys = blocking(move || challenge.solve(&master_password).map_err(domain))
        .await
        .map_err(join_error)??;
    let mut backend = backend()?;
    backend.session = Some(Session {
        dek: keys.dek,
        kdf: keys.kdf,
    });
    status_of(&backend)
}

pub async fn change_password_async(
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    let challenge = {
        let mut backend = backend()?;
        ensure_unlocked(&mut backend)?;
        let conn = require_conn(&backend)?;
        vault::challenge(conn).map_err(domain)?
    };
    let prepared = blocking(move || {
        vault::prepare_rewrap(&challenge, &old_password, &new_password).map_err(domain)
    })
    .await
    .map_err(join_error)??;
    let mut backend = backend()?;
    ensure_unlocked(&mut backend)?;
    let conn = require_conn(&backend)?;
    let keys = vault::apply_rewrap(conn, prepared).map_err(domain)?;
    if let Some(session) = backend.session.as_mut() {
        session.kdf = keys.kdf;
    }
    refresh_device_key(&backend)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// 免主密码解锁（device key）
// ---------------------------------------------------------------------------
//
// 打开这个开关时，把当前会话的 DEK 写进数据目录的 `device-unlock.key`，
// 启动时直接用它建会话，不再向用户要主密码。
//
// 代价必须说清楚：这个文件就是明文密钥，能读数据目录的人就能读库——
// 安全性等于「这台机器的系统账户」。主密码本身仍然有效，随时可以关掉开关
// （删文件）恢复成必须输密码。
//
// 文件里同时记下库的 salt：恢复备份会把库换成另一套密钥，salt 不匹配时
// 这个文件就作废，避免用旧 DEK 打开新库导致所有字段解密失败。

/// 每个库文件一个密钥文件：`device-unlock-<path hash>.key`。
///
/// 两座库来回切换时，各自的免密码解锁互不覆盖；把库文件拷到别处（或换台机器）
/// 也拿不到这把钥匙，仍然要输主密码——"这台机器"才是信任边界。
fn device_key_path(backend: &Backend) -> PathBuf {
    let key = fnv1a64(&backend.db_path.display().to_string().to_lowercase());
    backend
        .data_dir
        .join(format!("device-unlock-{key:016x}.key"))
}

/// FNV-1a：稳定、无依赖，只用来给文件名做区分（撞车了还有 salt 校验兜底）。
fn fnv1a64(text: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// 早期版本只有一个不带后缀的 `device-unlock.key`。首次启动时把它挪到
/// 「按库命名」的新文件名上，免得升级后免密码解锁悄悄失效。
fn migrate_legacy_device_key(backend: &Backend) {
    let legacy = backend.data_dir.join(DEVICE_KEY_FILE);
    if !legacy.exists() {
        return;
    }
    let target = device_key_path(backend);
    if target.exists() {
        return;
    }
    let _ = fs::rename(&legacy, &target);
}

fn device_key_body(salt: &[u8], dek: &[u8]) -> String {
    format!(
        "{{\"v\":1,\"salt\":\"{}\",\"dek\":\"{}\"}}",
        B64.encode(salt),
        B64.encode(dek)
    )
}

fn parse_device_key(raw: &str) -> Result<(Vec<u8>, String), String> {
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|_| coded("device_key", "免密码解锁密钥文件已损坏，请在设置里重新开启"))?;
    let salt = value
        .get("salt")
        .and_then(|item| item.as_str())
        .and_then(|item| B64.decode(item).ok())
        .ok_or_else(|| coded("device_key", "免密码解锁密钥文件已损坏，请在设置里重新开启"))?;
    let dek = value
        .get("dek")
        .and_then(|item| item.as_str())
        .ok_or_else(|| coded("device_key", "免密码解锁密钥文件已损坏，请在设置里重新开启"))?
        .to_string();
    Ok((salt, dek))
}

pub fn device_unlock_enabled_sync() -> Result<bool, String> {
    let backend = backend()?;
    if backend.data_dir.as_os_str().is_empty() {
        return Ok(false);
    }
    Ok(device_key_path(&backend).exists())
}

pub fn enable_device_unlock_sync() -> Result<bool, String> {
    let backend = backend()?;
    let session = require_session(&backend)?;
    if backend.data_dir.as_os_str().is_empty() {
        return Err(coded("vault", "数据目录尚未就绪"));
    }
    let conn = require_conn(&backend)?;
    let (salt, _) = vault::read_salt_and_kdf(conn).map_err(domain)?;
    // 用完即清零（文件里是明文密钥，内存里不留第二份）。
    let body = Zeroizing::new(device_key_body(&salt, &*session.dek));
    let path = device_key_path(&backend);
    write_private_file(&path, body.as_bytes())?;
    Ok(true)
}

pub fn disable_device_unlock_sync() -> Result<bool, String> {
    let backend = backend()?;
    if backend.data_dir.as_os_str().is_empty() {
        return Ok(false);
    }
    let path = device_key_path(&backend);
    match fs::remove_file(&path) {
        Ok(()) => Ok(false),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(coded(
            "vault",
            format!("删除 {} 失败: {err}", path.display()),
        )),
    }
}

/// 改主密码会换 salt：免密码解锁的密钥文件里记着旧 salt，必须跟着刷新，
/// 否则下次启动会被判成「密钥已失效」。文件不存在时什么也不做。
fn refresh_device_key(backend: &Backend) -> Result<(), String> {
    let path = device_key_path(backend);
    if !path.exists() {
        return Ok(());
    }
    let session = require_session(backend)?;
    let conn = require_conn(backend)?;
    let (salt, _) = vault::read_salt_and_kdf(conn).map_err(domain)?;
    let body = Zeroizing::new(device_key_body(&salt, &*session.dek));
    write_private_file(&path, body.as_bytes())
}

pub fn unlock_with_device_key_sync() -> Result<VaultStatus, String> {
    let mut backend = backend()?;
    ensure_conn(&mut backend)?;
    if backend.session.is_some() {
        return status_of(&backend);
    }
    let path = device_key_path(&backend);
    let raw = fs::read_to_string(&path).map_err(|_| coded("vault", "未开启免主密码解锁"))?;
    let (stored_salt, stored_dek) = parse_device_key(&raw)?;

    let conn = require_conn(&backend)?;
    let (current_salt, _) = vault::read_salt_and_kdf(conn).map_err(domain)?;
    if stored_salt != current_salt {
        // 库被换掉了（恢复备份），旧 DEK 已与新库不匹配：直接作废，让用户
        // 用主密码解锁一次，而不是带着错密钥把整库读成「解密失败」。
        let _ = fs::remove_file(&path);
        return Err(coded(
            "device_key",
            "免主密码解锁密钥已失效（库已被替换），请用主密码解锁后在设置里重新开启",
        ));
    }

    let mut bytes = B64
        .decode(stored_dek.trim())
        .map_err(|_| coded("device_key", "免密码解锁密钥文件已损坏，请在设置里重新开启"))?;
    if bytes.len() != mend_core::crypto::DEK_LEN {
        bytes.zeroize();
        return Err(coded(
            "device_key",
            "免密码解锁密钥文件已损坏，请在设置里重新开启",
        ));
    }
    let mut dek = Zeroizing::new([0u8; mend_core::crypto::DEK_LEN]);
    dek.copy_from_slice(&bytes);
    bytes.zeroize();

    let keys = vault::session_from_dek(conn, dek).map_err(domain)?;
    backend.session = Some(Session {
        dek: keys.dek,
        kdf: keys.kdf,
    });
    status_of(&backend)
}

// ---------------------------------------------------------------------------
// 应用更新（只读检查；下载/校验/安装全部由 nsh 运行时的 updater 完成）
// ---------------------------------------------------------------------------

/// 运行时更新器的暂存目录名与「下载完成并通过校验」的代码包文件名
/// （`nsh-core` 的 updater 模块）：`downloadPackage` 校验通过后把
/// `next.nshpkg.part` 重命名为 `next.nshpkg`，应用的启动器在下次启动时
/// 运行它，`restartToPackage` 则立即重启进这个包。两个名字必须与运行时
/// 保持一致，这里只读不改。
const UPDATES_DIR: &str = "updates";
const NEXT_PACKAGE_FILE: &str = "next.nshpkg";

/// 是否已经有一个完整下载、校验通过的代码包躺在数据目录里等下次启动。
///
/// 基准目录用 nsh 提供的应用数据目录（与运行时更新器写入的
/// `sys.data_dir` 同源），而不是保险库的兜底目录链：更新器只认它自己
/// 解析出的目录，这里若用别的目录就会漏报。`init` 已把该目录写进
/// `Backend.data_dir`（TSX 侧传的就是 `process.dataDir`），所以这里只读
/// 字段、不调 ambient `data_dir()`——它是 ambient 服务，同步导出在引擎
/// 线程上调用会 panic（no reactive runtime），实测打包版启动即炸。
/// 文件不存在（还没下载完、用户手动关闭时校验未完成、或启动器已应用并
/// 清理）一律返回 `false`。
pub fn check_package_ready() -> Result<bool, String> {
    let backend = backend()?;
    if backend.data_dir.as_os_str().is_empty() {
        return Ok(false);
    }
    Ok(backend
        .data_dir
        .join(UPDATES_DIR)
        .join(NEXT_PACKAGE_FILE)
        .is_file())
}

// ---------------------------------------------------------------------------
// UI 偏好（非敏感；解锁前就要读，因此不进数据库）
// ---------------------------------------------------------------------------

pub fn load_preferences_sync() -> Result<String, String> {
    let backend = backend()?;
    if backend.data_dir.as_os_str().is_empty() {
        return Ok(String::new());
    }
    let path = backend.data_dir.join(PREFERENCES_FILE);
    match fs::read_to_string(&path) {
        Ok(text) => Ok(text),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(coded(
            "vault",
            format!("读取偏好失败 ({err}): {}", path.display()),
        )),
    }
}

pub fn save_preferences_sync(json: String) -> Result<(), String> {
    let backend = backend()?;
    if backend.data_dir.as_os_str().is_empty() {
        return Ok(());
    }
    let path = backend.data_dir.join(PREFERENCES_FILE);
    fs::write(&path, json.as_bytes())
        .map_err(|err| coded("vault", format!("保存偏好失败 ({err}): {}", path.display())))
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

fn reorder_categories_sync(ids: Vec<String>) -> Result<(), String> {
    let backend = backend()?;
    require_session(&backend)?;
    db::reorder_categories(require_conn(&backend)?, &ids).map_err(domain)
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

fn reorder_presets_sync(field_type: String, ids: Vec<String>) -> Result<(), String> {
    let backend = backend()?;
    require_session(&backend)?;
    db::reorder_presets(require_conn(&backend)?, &field_type, &ids).map_err(domain)
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

fn tag_of(row: db::TagRow) -> Tag {
    Tag {
        id: row.id,
        name: row.name,
        color: row.color,
        sort_order: row.sort_order,
    }
}

/// 标签名校验失败统一变成 `tag_invalid`；前端只按 code 取本地化文案。
fn validate_tag_name(name: &str) -> Result<String, String> {
    mend_core::tags::validate_name(name).map_err(|err| coded("tag_invalid", err.to_string()))
}

fn validate_tag_color(color: &Option<String>, fallback_index: usize) -> Result<String, String> {
    mend_core::tags::validate_color(color.as_deref(), fallback_index)
        .map_err(|err| coded("tag_color_invalid", err.to_string()))
}

/// 同库内标签名称唯一（大小写不敏感）；`except_id` 为编辑时的自身 id。
fn ensure_tag_name_free(
    rows: &[db::TagRow],
    name: &str,
    except_id: Option<&str>,
) -> Result<(), String> {
    let lower = name.to_lowercase();
    if rows
        .iter()
        .any(|row| Some(row.id.as_str()) != except_id && row.name.to_lowercase() == lower)
    {
        return Err(coded("tag_duplicate", "标签名称已存在"));
    }
    Ok(())
}

fn list_tags_sync() -> Result<Vec<Tag>, String> {
    let backend = backend()?;
    require_session(&backend)?;
    let rows = db::list_tag_defs(require_conn(&backend)?).map_err(domain)?;
    Ok(rows.into_iter().map(tag_of).collect())
}

fn create_tag_sync(input: TagInput) -> Result<Tag, String> {
    let backend = backend()?;
    require_session(&backend)?;
    let conn = require_conn(&backend)?;
    let name = validate_tag_name(&input.name)?;
    let rows = db::list_tag_defs(conn).map_err(domain)?;
    ensure_tag_name_free(&rows, &name, None)?;
    let color = validate_tag_color(&input.color, rows.len())?;
    let sort_order = db::next_tag_sort(conn).map_err(domain)?;
    let row = db::TagRow {
        id: Uuid::new_v4().to_string(),
        name,
        color,
        sort_order,
        created_at: db::now_ms(),
    };
    db::insert_tag_def(conn, &row).map_err(domain)?;
    Ok(tag_of(row))
}

fn update_tag_sync(id: String, input: TagInput) -> Result<Tag, String> {
    let backend = backend()?;
    require_session(&backend)?;
    let conn = require_conn(&backend)?;
    let name = validate_tag_name(&input.name)?;
    let rows = db::list_tag_defs(conn).map_err(domain)?;
    let existing = rows
        .iter()
        .find(|row| row.id == id)
        .ok_or_else(|| coded("not_found", format!("标签 {id}")))?;
    ensure_tag_name_free(&rows, &name, Some(&id))?;
    let color = validate_tag_color(&input.color, existing.sort_order.max(0) as usize)?;
    let sort_order = existing.sort_order;
    db::rename_tag_def(conn, &id, &name, &color).map_err(domain)?;
    Ok(Tag {
        id,
        name,
        color,
        sort_order,
    })
}

fn delete_tag_sync(id: String) -> Result<(), String> {
    let backend = backend()?;
    require_session(&backend)?;
    db::delete_tag_def(require_conn(&backend)?, &id).map_err(domain)
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
// Site icons (favicon cache)
// ---------------------------------------------------------------------------
//
// 图标只在**解锁后**、且用户开启「网站图标」时才抓（开关在 TSX 的偏好里，
// 这里不做判断）：UI 在列表稳定一段时间后调用 `fetch_site_icons`，一批几个
// 站点，抓到的字节写进库里的 `site_icons` 表。所有请求都直达条目自己的站点，
// 绝不经过第三方图标服务。

/// 图标有效期：站点换了图标，最多 90 天后会重新抓一次。
const ICON_TTL_MS: i64 = 90 * 24 * 60 * 60 * 1000;
/// 抓失败后的第一次重试间隔，之后按 2^n 退避。
const ICON_RETRY_MS: i64 = 24 * 60 * 60 * 1000;
/// 退避封顶：连续失败再多，也至少每个月再试一次。
const ICON_RETRY_MAX_MS: i64 = 30 * 24 * 60 * 60 * 1000;
/// 一批最多抓几个站点：让每批都在一两秒内完成，抓取始终让位于界面。
const ICON_BATCH_MAX: u32 = 20;

fn icon_retry_delay(fail_count: i64) -> i64 {
    let exponent = (fail_count - 1).clamp(0, 10) as u32;
    ICON_RETRY_MS
        .saturating_mul(1i64 << exponent)
        .min(ICON_RETRY_MAX_MS)
}

/// 下一批该抓的站点：`entries.url` 里出现过、缓存缺失/过期、且不在失败退避
/// 窗口内的主机。只读 `url` 一列，不含回收站条目。
fn pending_icon_sites(conn: &Connection, limit: usize) -> Result<Vec<icons::Site>, String> {
    let now = db::now_ms();
    let mut states: HashMap<String, db::SiteIconState> = HashMap::new();
    for state in db::site_icon_states(conn).map_err(domain)? {
        states.insert(state.host.clone(), state);
    }
    let mut seen: HashSet<String> = HashSet::new();
    let mut pending = Vec::new();
    for url in db::list_entry_urls(conn).map_err(domain)? {
        let Some(site) = icons::parse_site(&url) else {
            continue;
        };
        if !seen.insert(site.key.clone()) {
            continue;
        }
        let due = match states.get(&site.key) {
            None => true,
            Some(state) if state.has_icon => now.saturating_sub(state.fetched_at) >= ICON_TTL_MS,
            Some(state) => {
                now.saturating_sub(state.fetched_at) >= icon_retry_delay(state.fail_count)
            }
        };
        if due {
            pending.push(site);
        }
        if pending.len() >= limit {
            break;
        }
    }
    Ok(pending)
}

fn pending_icon_count(conn: &Connection) -> Result<u32, String> {
    Ok(pending_icon_sites(conn, usize::MAX)?.len() as u32)
}

/// 一个条目网址对应的缓存图标，编码成 `data:` URI；没有缓存时返回空串。
/// 返回空串而不是错误：图标缺失是常态，界面自己回退到内置图标。
fn site_icon_sync(url: String) -> Result<String, String> {
    let Some(site) = icons::parse_site(&url) else {
        return Ok(String::new());
    };
    let backend = backend()?;
    // 锁定时不读：图标只服务于列表，没有别的用途。
    if backend.session.is_none() {
        return Ok(String::new());
    }
    let conn = require_conn(&backend)?;
    let Some(row) = db::get_site_icon(conn, &site.key).map_err(domain)? else {
        return Ok(String::new());
    };
    Ok(format!("data:{};base64,{}", row.mime, B64.encode(row.bytes)))
}

/// 抓取并缓存最多 `limit` 个待抓站点。网络与解码都在 nsh 的阻塞线程池里跑，
/// 期间不占数据库锁；写库回到引擎线程，和别的原生调用同一套串行。
async fn fetch_site_icons_async(limit: u32) -> Result<IconFetchReport, String> {
    let batch = {
        let backend = backend()?;
        let _session = require_session(&backend)?;
        let conn = require_conn(&backend)?;
        let limit = limit.clamp(1, ICON_BATCH_MAX) as usize;
        pending_icon_sites(conn, limit)?
    };
    if batch.is_empty() {
        return Ok(IconFetchReport {
            fetched: 0,
            remaining: 0,
        });
    }

    let results = blocking(move || {
        let mut out = Vec::with_capacity(batch.len());
        for (index, site) in batch.into_iter().enumerate() {
            // 限速：站点之间留 250ms，避免一次解锁就把几十个站点打出去。
            if index > 0 {
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
            let icon = icons::fetch(&site);
            out.push((site.key, icon));
        }
        out
    })
    .await
    .map_err(join_error)?;

    let mut fetched = 0u32;
    let remaining = {
        let backend = backend()?;
        let _session = require_session(&backend)?;
        let conn = require_conn(&backend)?;
        let now = db::now_ms();
        for (host, icon) in results {
            match icon {
                Some((mime, bytes)) => {
                    db::put_site_icon(conn, &host, &mime, &bytes, now).map_err(domain)?;
                    fetched += 1;
                }
                None => {
                    db::mark_site_icon_failed(conn, &host, now).map_err(domain)?;
                }
            }
        }
        // 老版本曾把 `fa` 这类裸词当主机名，失败后留下带退避计数的缓存行。
        // 抓取时顺手剔除；清理失败不影响本次结果，下次还会再试。
        let _ = db::prune_site_icons(conn, |host| icons::parse_site(host).is_some());
        pending_icon_count(conn)?
    };
    Ok(IconFetchReport { fetched, remaining })
}

fn clear_site_icons_sync() -> Result<u64, String> {
    let backend = backend()?;
    let _session = require_session(&backend)?;
    let conn = require_conn(&backend)?;
    db::clear_site_icons(conn).map_err(domain)
}

// ---------------------------------------------------------------------------
// Exported module functions
// ---------------------------------------------------------------------------

pub async fn init(data_dir: Option<String>) -> Result<VaultStatus, String> {
    // 系统代理 → 环境变量：必须在任何 fetch（检查更新）之前，见 system_proxy 模块注释。
    crate::system_proxy::apply();
    let resolved = resolve_data_dir(data_dir)?;
    init_sync(Some(resolved.display().to_string()))
}

pub fn status() -> Result<VaultStatus, String> {
    status_sync()
}

pub async fn setup(master_password: String) -> Result<VaultStatus, String> {
    setup_async(master_password).await
}

pub async fn unlock(master_password: String) -> Result<VaultStatus, String> {
    unlock_async(master_password).await
}

pub fn lock() -> Result<(), String> {
    lock_sync()
}

pub async fn change_password(old_password: String, new_password: String) -> Result<(), String> {
    change_password_async(old_password, new_password).await
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

pub fn reorder_categories(ids: Vec<String>) -> Result<(), String> {
    reorder_categories_sync(ids)
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

pub fn reorder_presets(field_type: String, ids: Vec<String>) -> Result<(), String> {
    reorder_presets_sync(field_type, ids)
}

pub fn list_tags() -> Result<Vec<Tag>, String> {
    list_tags_sync()
}

pub fn create_tag(input: TagInput) -> Result<Tag, String> {
    create_tag_sync(input)
}

pub fn update_tag(id: String, input: TagInput) -> Result<Tag, String> {
    update_tag_sync(id, input)
}

pub fn delete_tag(id: String) -> Result<(), String> {
    delete_tag_sync(id)
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

/// 一个条目网址的缓存图标（`data:` URI，没有缓存时为空串）。
pub fn site_icon(url: String) -> Result<String, String> {
    site_icon_sync(url)
}

/// 抓取并缓存下一批站点图标；返回本批抓成几个、还剩几个待抓。
pub async fn fetch_site_icons(limit: u32) -> Result<IconFetchReport, String> {
    fetch_site_icons_async(limit).await
}

/// 清空图标缓存，返回删掉的行数。
pub fn clear_site_icons() -> Result<u64, String> {
    clear_site_icons_sync()
}

/// Switch to another vault file (`None` = the default one in the data
/// directory). Validates the file, records its path, reopens the connection,
/// and leaves the vault locked.
pub fn switch_vault(path: Option<String>) -> Result<VaultStatus, String> {
    switch_vault_sync(path)
}

/// 在系统文件管理器里定位**当前库文件**（桌面端的「在文件夹中显示」）。
///
/// 库本身就是完整数据，用户「备份」的实际动作就是把这个文件拷走，所以入口
/// 直接选中文件，而不是打开某个目录再让人自己找。首选自己起系统文件管理器：
/// nsh 的 `reveal_path`（`SHOpenFolderAndSelectItems`）在进程与 Explorer 完整性
/// 级别不一致时会返回 access denied，还会把 nsh 自己写 `storage.json` 的错误
/// 一起带上来。失败时才退回 nsh 的 `reveal_path` / `open_path`。
pub async fn reveal_vault_file() -> Result<(), String> {
    let file = {
        let backend = backend()?;
        backend.db_path.clone()
    };
    let dir = file
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .ok_or_else(|| coded("vault", "库文件位置尚未就绪"))?;
    if !dir.exists() {
        // 还没建库：把即将出现的位置建出来并打开，比报错有用。
        fs::create_dir_all(&dir).map_err(|err| {
            coded(
                "vault",
                format!("创建数据目录失败 ({err}): {}", dir.display()),
            )
        })?;
    }
    if spawn_revealer(&file).is_ok() {
        return Ok(());
    }
    if reveal_path(file.clone()).await.is_ok() {
        return Ok(());
    }
    if spawn_opener(&dir).is_ok() {
        return Ok(());
    }
    open_path(dir)
        .await
        .map_err(|err| coded("vault", format!("打开库文件所在目录失败: {err}")))
}

/// Whether the vault can be opened without asking for the master password.
pub fn device_unlock_enabled() -> Result<bool, String> {
    device_unlock_enabled_sync()
}

/// Turn the password-less unlock on: store the current session key next to the
/// database. The vault must be unlocked (the key comes from the session, so the
/// master password is never asked for twice).
pub fn enable_device_unlock() -> Result<bool, String> {
    enable_device_unlock_sync()
}

/// Turn it off again: delete the key file.
pub fn disable_device_unlock() -> Result<bool, String> {
    disable_device_unlock_sync()
}

/// Open the vault with the stored device key (no master password).
pub fn unlock_with_device_key() -> Result<VaultStatus, String> {
    unlock_with_device_key_sync()
}

/// Non-sensitive UI preferences as JSON (`""` when nothing was saved yet).
///
/// Prefer this over nsh's `Storage`: `Storage` writes `storage.json` into
/// `%APPDATA%\com.mend.app`, which an app the system started with lower
/// privileges than that folder can never write (the write only reaches the log).
pub async fn load_preferences() -> Result<String, String> {
    load_preferences_sync()
}

pub fn save_preferences(json: String) -> Result<(), String> {
    save_preferences_sync(json)
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
    fn write_probe_accepts_writable_dir_and_flags_unwritable_one() {
        let dir = std::env::temp_dir().join(format!("mend-native-probe-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();

        assert!(ensure_writable_data_dir(&dir, &dir.join("mend.db")).is_ok());
        assert!(!fs::read_dir(&dir).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".mend-write-probe-")
        }));

        // A path that is not a writable directory must surface the dedicated
        // code, never a raw SQLite "readonly database" message.
        let blocker = dir.join("not-a-directory");
        fs::write(&blocker, b"x").unwrap();
        let err = ensure_writable_data_dir(&blocker, &blocker.join("mend.db")).unwrap_err();
        assert!(err.starts_with("db_readonly|"), "{err}");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn adapter_flow_end_to_end() {
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

        // 免主密码解锁：开启后锁定仍能打开，关掉立刻失效。
        assert!(!device_unlock_enabled_sync().unwrap());
        enable_device_unlock_sync().unwrap();
        assert!(device_unlock_enabled_sync().unwrap());
        lock_sync().unwrap();
        assert!(unlock_with_device_key_sync().unwrap().unlocked);
        disable_device_unlock_sync().unwrap();
        assert!(!device_unlock_enabled_sync().unwrap());
        lock_sync().unwrap();
        assert!(
            unlock_with_device_key_sync().is_err(),
            "关闭后不得免密码解锁"
        );

        // 偏好文件：默认空串，写入后可读回。
        assert_eq!(load_preferences_sync().unwrap(), "");
        save_preferences_sync("{\"language\":\"zh-CN\"}".into()).unwrap();
        assert_eq!(load_preferences_sync().unwrap(), "{\"language\":\"zh-CN\"}");

        // --- 库文件位置：自选文件、切换、拒绝非库文件、切回默认 ---
        // 下面要验证「切回默认库数据还在」：先解锁留一条条目。
        unlock_sync(password.into()).unwrap();
        create_entry_sync(input("Before switch", Some(category.id.clone()))).unwrap();

        let second = dir.join("second.menddb");
        let switched = switch_vault_sync(Some(second.display().to_string())).unwrap();
        assert!(!switched.initialized, "新文件应是一座空库");
        assert!(!switched.unlocked, "切换后必须锁定");
        assert_eq!(switched.db_path, second.display().to_string());
        assert_eq!(
            read_located_vault(&dir).unwrap().display().to_string(),
            second.display().to_string()
        );

        // 新库与旧库的数据互不干扰。
        setup_sync(password.into()).unwrap();
        assert!(
            list_entries_sync(ListFilter {
                bucket: "all".into(),
                category_id: None,
                keyword: None,
                tag: None,
            })
            .unwrap()
            .is_empty()
        );

        // 误选非数据库文件必须被挡住，且不改动当前库。
        let bogus = dir.join("not-a-vault.menddb");
        fs::write(&bogus, b"\x89PNG\r\n\x1a\nnot a database").unwrap();
        let err = switch_vault_sync(Some(bogus.display().to_string())).unwrap_err();
        assert!(err.starts_with("vault_not_db|"), "{err}");
        assert_eq!(status_sync().unwrap().db_path, second.display().to_string());

        // 切回默认库：原数据还在，只是需要重新解锁。
        let back = switch_vault_sync(None).unwrap();
        assert!(back.initialized);
        assert!(!back.unlocked);
        assert_eq!(back.db_path, db::db_file_path(&dir).display().to_string());
        assert!(read_located_vault(&dir).is_none(), "恢复默认应删掉位置指针");
        unlock_sync(password.into()).unwrap();
        assert_eq!(
            list_entries_sync(ListFilter {
                bucket: "all".into(),
                category_id: None,
                keyword: None,
                tag: None,
            })
            .unwrap()
            .len(),
            1
        );

        // 免密码解锁的密钥按库区分：在默认库上开启后，切到第二座库应当仍是
        //「未开启」，切回来则原钥匙还在（否则来回切库会把方便功能反复作废）。
        enable_device_unlock_sync().unwrap();
        assert!(device_unlock_enabled_sync().unwrap());
        switch_vault_sync(Some(second.display().to_string())).unwrap();
        assert!(
            !device_unlock_enabled_sync().unwrap(),
            "第二座库没有开过免密码解锁"
        );
        switch_vault_sync(None).unwrap();
        assert!(
            device_unlock_enabled_sync().unwrap(),
            "切回默认库后原钥匙仍应存在"
        );
        disable_device_unlock_sync().unwrap();

        let _ = fs::remove_dir_all(&dir);
    }
}
