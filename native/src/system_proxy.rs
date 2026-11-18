//! Windows「系统代理」（WinINET 注册表）→ 进程环境变量。
//!
//! nsh 的 fetch / 更新器走 ureq，代理只认 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`
//! 环境变量，不读 WinINET；代理软件只开「系统代理」模式时，检查更新会直连 GitHub
//! 超时。启动时把注册表设置翻译成环境变量补上，系统代理模式即可生效。
//!
//! 约定：已存在的环境变量优先（用户显式配置不被覆盖）；只在 `Vault.init` 首行、
//! 任何 fetch 之前调用一次。PAC（`AutoConfigURL`）与纯 SOCKS 代理不支持
//! （ureq 未启用 socks feature）。

/// 把 WinINET 的 `ProxyEnable` / `ProxyServer` / `ProxyOverride` 翻译成待写入的
/// 环境变量；是否覆盖已有变量由调用方决定。
pub fn env_from_settings(enabled: bool, server: &str, overrides: &str) -> Vec<(String, String)> {
    let server = server.trim();
    if !enabled || server.is_empty() {
        return Vec::new();
    }
    let mut out: Vec<(String, String)> = Vec::new();
    let mut push = |name: &str, addr: &str| {
        let addr = addr.trim();
        if addr.is_empty() {
            return;
        }
        // WinINET 存的是裸 host:port；代理本身说 HTTP（CONNECT），故补 http://。
        let url = if addr.contains("://") {
            addr.to_string()
        } else {
            format!("http://{addr}")
        };
        out.push((name.to_string(), url));
    };
    if server.contains('=') {
        // 分协议形式：http=host:port;https=host:port;socks=…（socks 忽略）。
        for part in server.split(';') {
            let Some((proto, addr)) = part.split_once('=') else {
                continue;
            };
            match proto.trim().to_ascii_lowercase().as_str() {
                "http" => push("HTTP_PROXY", addr),
                "https" => push("HTTPS_PROXY", addr),
                _ => {}
            }
        }
    } else {
        // 单一形式：所有协议共用一个代理。
        push("HTTP_PROXY", server);
        push("HTTPS_PROXY", server);
    }
    let overrides = overrides.trim();
    if !out.is_empty() && !overrides.is_empty() {
        out.push(("NO_PROXY".to_string(), overrides.replace(';', ",")));
    }
    out
}

/// 读系统代理并补写缺失的环境变量；非 Windows 为空操作。
pub fn apply() {
    #[cfg(windows)]
    {
        let Some((enabled, server, overrides)) = read_wininet() else {
            return;
        };
        for (name, value) in env_from_settings(enabled, &server, &overrides) {
            if std::env::var_os(&name).is_some() {
                continue;
            }
            // SAFETY: 仅在 Vault.init 首行调用，此刻引擎尚未发起任何 fetch
            // （ureq 在首次 fetch 建 agent 时才读这些变量），无并发读写。
            unsafe { std::env::set_var(&name, &value) };
        }
    }
}

#[cfg(windows)]
fn read_wininet() -> Option<(bool, String, String)> {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ, REG_DWORD,
        REG_SZ,
    };

    unsafe fn query(hkey: HKEY, name: &str, want: u32) -> Vec<u8> {
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        let mut kind = 0u32;
        let mut len = 0u32;
        if RegQueryValueExW(
            hkey,
            wide.as_ptr(),
            std::ptr::null(),
            &mut kind,
            std::ptr::null_mut(),
            &mut len,
        ) != 0
            || kind != want
            || len == 0
        {
            return Vec::new();
        }
        let mut buf = vec![0u8; len as usize];
        if RegQueryValueExW(
            hkey,
            wide.as_ptr(),
            std::ptr::null(),
            &mut kind,
            buf.as_mut_ptr(),
            &mut len,
        ) != 0
        {
            return Vec::new();
        }
        buf.truncate(len as usize);
        buf
    }

    unsafe fn sz(hkey: HKEY, name: &str) -> String {
        let buf = query(hkey, name, REG_SZ);
        let units: Vec<u16> = buf
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&units)
            .trim_end_matches('\0')
            .to_string()
    }

    unsafe {
        let subkey: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut hkey: HKEY = std::ptr::null_mut();
        if RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_READ, &mut hkey) != 0 {
            return None;
        }
        let enable = query(hkey, "ProxyEnable", REG_DWORD);
        let enabled = enable.len() == 4 && u32::from_le_bytes([enable[0], enable[1], enable[2], enable[3]]) == 1;
        let server = sz(hkey, "ProxyServer");
        let overrides = sz(hkey, "ProxyOverride");
        RegCloseKey(hkey);
        Some((enabled, server, overrides))
    }
}

#[cfg(test)]
mod tests {
    use super::env_from_settings;

    #[test]
    fn disabled_or_empty_yields_nothing() {
        assert!(env_from_settings(false, "127.0.0.1:7890", "").is_empty());
        assert!(env_from_settings(true, "   ", "").is_empty());
    }

    #[test]
    fn single_address_covers_http_and_https() {
        let out = env_from_settings(true, "127.0.0.1:7890", "");
        assert_eq!(
            out,
            vec![
                ("HTTP_PROXY".into(), "http://127.0.0.1:7890".into()),
                ("HTTPS_PROXY".into(), "http://127.0.0.1:7890".into()),
            ]
        );
    }

    #[test]
    fn per_protocol_form_ignores_socks_and_keeps_scheme() {
        let out = env_from_settings(
            true,
            "http=127.0.0.1:7890;https=http://127.0.0.1:7891;socks=127.0.0.1:7892",
            "",
        );
        assert_eq!(
            out,
            vec![
                ("HTTP_PROXY".into(), "http://127.0.0.1:7890".into()),
                ("HTTPS_PROXY".into(), "http://127.0.0.1:7891".into()),
            ]
        );
    }

    #[test]
    fn socks_only_yields_nothing() {
        assert!(env_from_settings(true, "socks=127.0.0.1:7892", "<local>").is_empty());
    }

    #[test]
    fn override_list_becomes_no_proxy_commas() {
        let out = env_from_settings(true, "127.0.0.1:7890", "localhost;127.*;<local>");
        assert_eq!(out.len(), 3);
        assert_eq!(out[2], ("NO_PROXY".into(), "localhost,127.*,<local>".into()));
    }
}