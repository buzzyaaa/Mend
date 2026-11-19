//! 站点图标（favicon）：从**条目自己的网站**抓一张小图标，归一化成可直接
//! 渲染的字节。
//!
//! 只有这里会替 UI 发请求 —— TSX 侧永远不联网，`nsh.json` 也不开
//! `capabilities.network`，于是「这台机器访问过哪些站点」只有一个出口，并且
//! 复用 `system_proxy` 注入的系统代理。绝不使用第三方图标服务：那等于把整
//! 份站点清单交给一家公司，对密码管理器是实质泄露。
//!
//! 取舍：抓不到、超过体积上限、或是无法解码的格式，一律返回 `None` —— 上层
//! 回退到内置品牌图标或分类图标，界面永远不会因为图标缺失而变空。

use std::time::Duration;

const MAX_HTML_BYTES: u64 = 512 * 1024;
const MAX_ICON_BYTES: u64 = 96 * 1024;
/// ICO 转 PNG 时的最长边：列表里只显示 20pt，再大只是浪费内存。
const MAX_ICON_SIDE: u32 = 96;
const TIMEOUT: Duration = Duration::from_secs(6);
const USER_AGENT: &str = concat!("Mend/", env!("CARGO_PKG_VERSION"));

/// 一个条目网址里与图标有关的部分。
pub struct Site {
    /// `http` / `https`；用户没写协议时按 `https` 试。
    pub scheme: &'static str,
    /// 带端口的 authority（拼请求 URL 用）。
    pub authority: String,
    /// 缓存键：小写主机名，去掉默认端口。
    pub key: String,
}

impl Site {
    fn origin(&self) -> String {
        format!("{}://{}", self.scheme, self.authority)
    }
}

/// 从用户填的网址里取出站点。裸域名、带路径/查询、带 `www` 都接受；
/// 非 http(s)（`mailto:` 之类）与明显非法的输入返回 `None`。
pub fn parse_site(url: &str) -> Option<Site> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    let (scheme, rest) = if let Some(rest) = lower.strip_prefix("https://") {
        ("https", rest)
    } else if let Some(rest) = lower.strip_prefix("http://") {
        ("http", rest)
    } else if lower.contains("://") {
        return None;
    } else {
        ("https", &lower[..])
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if authority.is_empty() || authority.len() > 253 || !valid_authority(authority) {
        return None;
    }
    let key = strip_default_port(authority)
        .trim_end_matches('.')
        .to_string();
    if key.is_empty() || key.len() > 253 || !key.chars().all(is_host_char) {
        return None;
    }
    Some(Site {
        scheme,
        authority: authority.to_string(),
        key,
    })
}

/// 只接受「主机」或「主机:数字端口」或 `[IPv6]`。带 `@` 的 userinfo 与
/// `mailto:` / `javascript:` 这类「伪协议」由此被挡在门外 —— 它们不是站点。
fn valid_authority(authority: &str) -> bool {
    if authority.contains('@') {
        return false;
    }
    if authority.starts_with('[') {
        let Some(end) = authority.find(']') else {
            return false;
        };
        let rest = &authority[end + 1..];
        return rest.is_empty()
            || rest
                .strip_prefix(':')
                .is_some_and(|port| !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()));
    }
    match authority.split_once(':') {
        None => true,
        Some((host, port)) => {
            !host.is_empty() && !port.is_empty() && port.chars().all(|c| c.is_ascii_digit())
        }
    }
}

fn strip_default_port(authority: &str) -> &str {
    if let Some(host) = authority.strip_suffix(":443") {
        return host;
    }
    if let Some(host) = authority.strip_suffix(":80") {
        return host;
    }
    authority
}

/// 主机名允许的字符：字母数字、`-`、`.`、`_`（内网域名）、`:`（端口）、方括号（IPv6）。
fn is_host_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | ':' | '[' | ']' | '_')
}

fn agent() -> ureq::Agent {
    let mut builder = ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .max_redirects(8)
        // 404 / 403 也当普通响应读，自己判断状态，错误路径统一走 `None`。
        .http_status_as_error(false);
    if let Some(proxy) = ureq::Proxy::try_from_env() {
        builder = builder.proxy(Some(proxy));
    }
    builder.build().into()
}

/// `GET` 一个 URL，返回 `(状态码, Content-Type, 体积受限的正文)`。
fn get(agent: &ureq::Agent, url: &str, accept: &str, limit: u64) -> Option<(u16, Option<String>, Vec<u8>)> {
    let mut response = agent
        .get(url)
        .header("User-Agent", USER_AGENT)
        .header("Accept", accept)
        .call()
        .ok()?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_ascii_lowercase());
    let body = response
        .body_mut()
        .with_config()
        .limit(limit)
        .read_to_vec()
        .ok()?;
    Some((status, content_type, body))
}

/// 抓一个站点的图标：先读首页里声明的 `<link rel="icon">` 一族，再退回
/// `/favicon.ico`。成功时返回 `(MIME, 字节)`。
pub fn fetch(site: &Site) -> Option<(String, Vec<u8>)> {
    let agent = agent();
    let origin = site.origin();
    let fallback = format!("{origin}/favicon.ico");

    let mut candidates = Vec::new();
    if let Some((200, _, body)) = get(
        &agent,
        &format!("{origin}/"),
        "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        MAX_HTML_BYTES,
    ) {
        let html = String::from_utf8_lossy(&body);
        candidates = icon_links(&html, site)
            .into_iter()
            .map(|(_, url)| url)
            .collect();
    }
    candidates.push(fallback);

    for url in candidates {
        let Some((200, _, body)) = get(
            &agent,
            &url,
            "image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/*;q=0.8,*/*;q=0.5",
            MAX_ICON_BYTES,
        ) else {
            continue;
        };
        let Some((mime, bytes)) = normalize(&body) else {
            continue;
        };
        if bytes.len() <= MAX_ICON_BYTES as usize {
            return Some((mime, bytes));
        }
    }
    None
}

/// 把服务器给的字节归一化成 nsh 能直接渲染的格式。
/// 常见格式原样保留（不重新编码，避免 palette PNG 越转越大），ICO 转 PNG。
fn normalize(bytes: &[u8]) -> Option<(String, Vec<u8>)> {
    if bytes.is_empty() {
        return None;
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(("image/png".into(), bytes.to_vec()));
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some(("image/jpeg".into(), bytes.to_vec()));
    }
    if bytes.starts_with(b"GIF8") {
        return Some(("image/gif".into(), bytes.to_vec()));
    }
    if bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some(("image/webp".into(), bytes.to_vec()));
    }
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(1024)]).to_ascii_lowercase();
    if head.trim_start().starts_with('<') && head.contains("<svg") {
        return Some(("image/svg+xml".into(), bytes.to_vec()));
    }
    if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        let png = ico_to_png(bytes)?;
        return Some(("image/png".into(), png));
    }
    None
}

/// ICO → PNG（缩到 `MAX_ICON_SIDE` 以内）。ICO 是三平台最不统一的格式，
/// 转一次 PNG 之后 Windows / macOS / Linux 渲染完全一致。
fn ico_to_png(bytes: &[u8]) -> Option<Vec<u8>> {
    use std::io::Cursor;

    let image = image::load_from_memory(bytes).ok()?;
    let image = image.thumbnail(MAX_ICON_SIDE, MAX_ICON_SIDE);
    let mut out = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
        .ok()?;
    Some(out)
}

/// 从首页 HTML 里挑出图标候选，按「更像一张真图标」的程度排序。
fn icon_links(html: &str, site: &Site) -> Vec<(u32, String)> {
    let lower = html.to_ascii_lowercase();
    let mut out = Vec::new();
    let mut cursor = 0;
    while let Some(offset) = lower[cursor..].find("<link") {
        let start = cursor + offset;
        let Some(end_offset) = lower[start..].find('>') else {
            break;
        };
        let end = start + end_offset;
        let tag = &html[start..=end];
        cursor = end + 1;

        let attrs = parse_attrs(tag);
        let Some(rel) = attrs
            .iter()
            .find(|(name, _)| name == "rel")
            .map(|(_, value)| value.to_ascii_lowercase())
        else {
            continue;
        };
        if !rel.contains("icon") {
            continue;
        }
        let Some(href) = attrs
            .iter()
            .find(|(name, _)| name == "href")
            .map(|(_, value)| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let Some(url) = resolve_url(&href, site) else {
            continue;
        };

        let mut score = 1u32;
        if rel.contains("apple-touch-icon") {
            score += 40;
        }
        // mask-icon 是单色遮罩，当彩色图标用会很难看。
        if rel.contains("mask-icon") {
            score = score.saturating_sub(20);
        }
        if url.ends_with(".svg") {
            // SVG 在 Windows 上需要额外解码，作为最后手段。
            score = score.saturating_sub(10);
        }
        if let Some((_, sizes)) = attrs.iter().find(|(name, _)| name == "sizes") {
            if let Some(side) = size_of(sizes) {
                score += side.min(256);
            }
        }
        out.push((score, url));
    }
    out.sort_by(|a, b| b.0.cmp(&a.0));
    out
}

/// `sizes="32x32 64x64"` → 64（取最大边长）。
fn size_of(sizes: &str) -> Option<u32> {
    sizes
        .split_whitespace()
        .filter_map(|token| token.split(['x', 'X']).next()?.parse::<u32>().ok())
        .max()
}

/// 把 `<link>` 的 href 解析成绝对 http(s) URL；只放行 http/https。
fn resolve_url(href: &str, site: &Site) -> Option<String> {
    let lower = href.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return Some(href.to_string());
    }
    if href.starts_with("//") {
        return Some(format!("{}:{href}", site.scheme));
    }
    if href.starts_with('/') {
        return Some(format!("{}{href}", site.origin()));
    }
    // 相对路径：只认同目录下的普通文件名，其他协议/怪路径一律忽略。
    if lower.contains(':') || href.starts_with('#') {
        return None;
    }
    Some(format!("{}/{href}", site.origin()))
}

/// 解析一个标签里的属性（`name`、`name="value"`、`name='value'` 都支持）。
fn parse_attrs(tag: &str) -> Vec<(String, String)> {
    let bytes = tag.as_bytes();
    let mut index = 0;
    let mut out = Vec::new();
    // 跳过 `<link`
    while index < bytes.len() && !bytes[index].is_ascii_whitespace() {
        index += 1;
    }
    while index < bytes.len() {
        while index < bytes.len() && (bytes[index].is_ascii_whitespace() || bytes[index] == b'/') {
            index += 1;
        }
        if index >= bytes.len() || bytes[index] == b'>' {
            break;
        }
        let name_start = index;
        while index < bytes.len()
            && (bytes[index].is_ascii_alphanumeric()
                || matches!(bytes[index], b'-' | b'_' | b':' | b'@' | b'.'))
        {
            index += 1;
        }
        let name = tag[name_start..index].to_ascii_lowercase();
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        let mut value = String::new();
        if index < bytes.len() && bytes[index] == b'=' {
            index += 1;
            while index < bytes.len() && bytes[index].is_ascii_whitespace() {
                index += 1;
            }
            if index < bytes.len() && (bytes[index] == b'"' || bytes[index] == b'\'') {
                let quote = bytes[index];
                index += 1;
                let value_start = index;
                while index < bytes.len() && bytes[index] != quote {
                    index += 1;
                }
                value = tag[value_start..index].to_string();
                if index < bytes.len() {
                    index += 1;
                }
            } else {
                let value_start = index;
                while index < bytes.len()
                    && !bytes[index].is_ascii_whitespace()
                    && bytes[index] != b'>'
                {
                    index += 1;
                }
                value = tag[value_start..index].to_string();
            }
        }
        if !name.is_empty() {
            out.push((name, value));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bare_and_full_urls() {
        let bare = parse_site("baidu.com").unwrap();
        assert_eq!(bare.key, "baidu.com");
        assert_eq!(bare.scheme, "https");

        let full = parse_site("  https://MAIL.163.com/login?x=1  ").unwrap();
        assert_eq!(full.key, "mail.163.com");
        assert_eq!(full.origin(), "https://mail.163.com");

        let plain = parse_site("http://intranet.local:8080/").unwrap();
        assert_eq!(plain.key, "intranet.local:8080");
        assert_eq!(plain.scheme, "http");

        let default_port = parse_site("https://example.com:443/x").unwrap();
        assert_eq!(default_port.key, "example.com");

        assert!(parse_site("").is_none());
        assert!(parse_site("mailto:me@example.com").is_none());
        assert!(parse_site("javascript:alert(1)").is_none());
        assert!(parse_site("https://").is_none());
        assert!(parse_site("https://host:notaport/x").is_none());
    }

    #[test]
    fn picks_the_largest_declared_icon() {
        let site = parse_site("https://mail.163.com").unwrap();
        let html = r#"<html><head>
            <link rel="shortcut icon" href="https://mail.163.com/favicon.ico"/>
            <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
            <link rel="mask-icon" href="/mask.svg">
            <link rel="stylesheet" href="/style.css">
        </head></html>"#;
        let links = icon_links(html, &site);
        assert_eq!(links[0].1, "https://mail.163.com/apple-touch-icon.png");
        assert!(links.iter().any(|(_, url)| url.ends_with("/favicon.ico")));
        assert!(!links.iter().any(|(_, url)| url.ends_with("/style.css")));
    }

    #[test]
    fn resolves_relative_hrefs() {
        let site = parse_site("https://example.com").unwrap();
        assert_eq!(
            resolve_url("//cdn.example.com/i.png", &site).unwrap(),
            "https://cdn.example.com/i.png"
        );
        assert_eq!(
            resolve_url("/icon.png", &site).unwrap(),
            "https://example.com/icon.png"
        );
        assert_eq!(
            resolve_url("icon.png", &site).unwrap(),
            "https://example.com/icon.png"
        );
        assert!(resolve_url("data:image/png;base64,AAAA", &site).is_none());
    }

    #[test]
    #[ignore = "network smoke test: run manually"]
    fn smoke_fetch_real_sites() {
        for host in ["mail.163.com", "www.baidu.com", "github.com"] {
            let site = parse_site(host).unwrap();
            let icon = fetch(&site);
            eprintln!(
                "{host} -> {:?}",
                icon.as_ref().map(|(mime, bytes)| (mime.clone(), bytes.len()))
            );
        }
    }

    #[test]
    fn sniffs_common_formats() {
        assert_eq!(
            normalize(b"\x89PNG\r\n\x1a\nrest").unwrap().0,
            "image/png"
        );
        assert_eq!(
            normalize(b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")
                .unwrap()
                .0,
            "image/svg+xml"
        );
        assert!(normalize(b"not an image").is_none());
        assert!(normalize(b"").is_none());
    }
}
