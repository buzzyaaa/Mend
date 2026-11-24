//! 开机自启：把当前可执行文件登记到各平台的「当前用户」登录项。
//!
//! - Windows：`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
//! - macOS：`~/Library/LaunchAgents/com.mend.app.plist`
//! - Linux：`${XDG_CONFIG_HOME:-~/.config}/autostart/com.mend.app.desktop`
//!
//! 只写当前用户级别的位置，不碰系统目录、不需要管理员权限。所有写操作
//! 都是同步且极短（一次注册表键写 / 一个小文件写），按项目约定保持同步导出。

use std::path::PathBuf;

const RUN_VALUE_NAME: &str = "Mend";
const LAUNCH_LABEL: &str = "com.mend.app";

fn current_exe() -> Result<PathBuf, String> {
    std::env::current_exe()
        .map_err(|err| crate::error::coded("autostart", format!("无法定位应用可执行文件 ({err})")))
}

/// 启动时用来校准 UI 偏好：真正决定开机是否自启的是原生注册项，不是偏好文件。
/// 用户也可能从系统设置里直接删掉登录项，所以以这里为准。
pub fn enabled() -> Result<bool, String> {
    #[cfg(windows)]
    return windows_enabled();
    #[cfg(target_os = "macos")]
    return macos_enabled();
    #[cfg(target_os = "linux")]
    return linux_enabled();
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    return Ok(false);
}

/// `enabled=true` 写入登录项，`false` 删除。成功时返回 `enabled`，
/// 供 UI 直接写回偏好（以原生实际状态为准）。
pub fn set(enabled: bool) -> Result<bool, String> {
    #[cfg(windows)]
    windows_set(enabled)?;
    #[cfg(target_os = "macos")]
    macos_set(enabled)?;
    #[cfg(target_os = "linux")]
    linux_set(enabled)?;
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    let _ = enabled;
    Ok(enabled)
}

// ---- Windows -------------------------------------------------------------

#[cfg(windows)]
fn windows_enabled() -> Result<bool, String> {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ, REG_SZ,
    };
    let subkey: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Run"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let name: Vec<u16> = RUN_VALUE_NAME.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let mut hkey: HKEY = std::ptr::null_mut();
        if RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_READ, &mut hkey) != 0 {
            return Ok(false);
        }
        let mut kind = 0u32;
        let mut len = 0u32;
        let code = RegQueryValueExW(
            hkey,
            name.as_ptr(),
            std::ptr::null(),
            &mut kind,
            std::ptr::null_mut(),
            &mut len,
        );
        RegCloseKey(hkey);
        Ok(code == 0 && kind == REG_SZ && len > 0)
    }
}

#[cfg(windows)]
fn windows_set(enabled: bool) -> Result<(), String> {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_WRITE, REG_SZ,
    };
    let subkey: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Run"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let name: Vec<u16> = RUN_VALUE_NAME.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let mut hkey: HKEY = std::ptr::null_mut();
        let code = RegCreateKeyExW(
            HKEY_CURRENT_USER,
            subkey.as_ptr(),
            0,
            std::ptr::null(),
            0,
            KEY_WRITE,
            std::ptr::null(),
            &mut hkey,
            std::ptr::null_mut(),
        );
        if code != 0 {
            return Err(crate::error::coded(
                "autostart",
                format!("打开开机启动注册项失败 ({code})"),
            ));
        }
        let result = if enabled {
            let exe = current_exe()?;
            // 路径带空格时必须加引号，否则 Windows 会把它截断。
            let path = exe.to_string_lossy();
            let command = if path.starts_with('"') {
                path.into_owned()
            } else {
                format!("\"{path}\"")
            };
            let wide: Vec<u16> = command.encode_utf16().chain(std::iter::once(0)).collect();
            let bytes: Vec<u8> = wide.iter().flat_map(|unit| unit.to_le_bytes()).collect();
            RegSetValueExW(
                hkey,
                name.as_ptr(),
                0,
                REG_SZ,
                bytes.as_ptr(),
                bytes.len() as u32,
            )
        } else {
            RegDeleteValueW(hkey, name.as_ptr())
        };
        RegCloseKey(hkey);
        // 删除一个不存在的键返回 2（ERROR_FILE_NOT_FOUND），对「关闭」来说是成功。
        if result != 0 && !(result == 2 && !enabled) {
            return Err(crate::error::coded(
                "autostart",
                format!("更新开机启动注册项失败 ({result})"),
            ));
        }
    }
    Ok(())
}

// ---- macOS ---------------------------------------------------------------

#[cfg(target_os = "macos")]
fn launch_agent_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .map_err(|_| crate::error::coded("autostart", "无法读取 HOME，不能定位登录项目录"))?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{LAUNCH_LABEL}.plist")))
}

#[cfg(target_os = "macos")]
fn macos_enabled() -> Result<bool, String> {
    Ok(launch_agent_path()?.exists())
}

#[cfg(target_os = "macos")]
fn macos_set(enabled: bool) -> Result<(), String> {
    let path = launch_agent_path()?;
    if enabled {
        let exe = current_exe()?;
        let xml = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
             <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
             <plist version=\"1.0\"><dict>\n\
             <key>Label</key><string>{label}</string>\n\
             <key>ProgramArguments</key><array><string>{exe}</string></array>\n\
             <key>RunAtLoad</key><true/>\n\
             </dict></plist>\n",
            label = LAUNCH_LABEL,
            exe = escape_xml(&exe.to_string_lossy()),
        );
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| {
                crate::error::coded("autostart", format!("创建登录项目录失败 ({err})"))
            })?;
        }
        std::fs::write(&path, xml)
            .map_err(|err| crate::error::coded("autostart", format!("写入登录项失败 ({err})")))?;
        // 写 plist 已保证下次登录生效；load 只为本次会话立即生效，失败不阻断。
        let _ = std::process::Command::new("launchctl")
            .args(["load", "-w"])
            .arg(&path)
            .status();
    } else {
        if path.exists() {
            let _ = std::process::Command::new("launchctl")
                .args(["unload", "-w"])
                .arg(&path)
                .status();
            std::fs::remove_file(&path).map_err(|err| {
                crate::error::coded("autostart", format!("删除登录项失败 ({err})"))
            })?;
        }
    }
    Ok(())
}

// ---- Linux ---------------------------------------------------------------

#[cfg(target_os = "linux")]
fn autostart_path() -> Result<PathBuf, String> {
    let base = match std::env::var("XDG_CONFIG_HOME") {
        Ok(dir) if !dir.trim().is_empty() => PathBuf::from(dir),
        _ => {
            let home = std::env::var("HOME").map_err(|_| {
                crate::error::coded("autostart", "无法读取 HOME，不能定位自动启动目录")
            })?;
            PathBuf::from(home).join(".config")
        }
    };
    Ok(base.join("autostart").join(format!("{LAUNCH_LABEL}.desktop")))
}

#[cfg(target_os = "linux")]
fn linux_enabled() -> Result<bool, String> {
    Ok(autostart_path()?.exists())
}

#[cfg(target_os = "linux")]
fn linux_set(enabled: bool) -> Result<(), String> {
    let path = autostart_path()?;
    if enabled {
        let exe = current_exe()?;
        let content = format!(
            "[Desktop Entry]\nType=Application\nName=Mend\nComment=Mend password manager\nExec={exe}\nNoDisplay=true\nX-GNOME-Autostart-enabled=true\n",
            exe = escape_desktop(&exe.to_string_lossy()),
        );
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| {
                crate::error::coded("autostart", format!("创建自动启动目录失败 ({err})"))
            })?;
        }
        std::fs::write(&path, content)
            .map_err(|err| crate::error::coded("autostart", format!("写入自动启动项失败 ({err})")))?;
    } else if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|err| crate::error::coded("autostart", format!("删除自动启动项失败 ({err})")))?;
    }
    Ok(())
}

// ---- 转义辅助 ------------------------------------------------------------

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(target_os = "linux")]
fn escape_desktop(value: &str) -> String {
    // .desktop 的 Exec 值里需要转义的是空格、反斜杠与双引号。
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace(' ', "\\ ")
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "linux")]
    #[test]
    fn desktop_exec_escapes_spaces() {
        assert_eq!(super::escape_desktop("/opt/My App/Mend"), "/opt/My\\ App/Mend");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn plist_escapes_ampersand() {
        assert_eq!(super::escape_xml("a&b"), "a&amp;b");
    }
}
