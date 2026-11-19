//! 标签定义（名称 + 颜色）：标签是库内独立维护的实体，条目只引用其名称。
//!
//! 标签名与颜色都是明文元信息（语义同分类名，见 `docs/04` §2.3 / §2.6）：
//! 名称用于列表筛选与胶囊显示，颜色只决定胶囊配色。

use crate::error::{MendError, MendResult};

/// 单个标签名的长度上限，与 `entries::validate_tags` 保持一致。
pub const TAG_NAME_MAX: usize = 32;

/// 标签默认色板（`#RRGGBB`）。新建标签未指定颜色、迁移旧标签时按此顺序取色；
/// 顺序变化会改变**已落库**标签的颜色吗？不会——落库颜色是独立列，
/// 这里只在「没有颜色可写」时提供默认值。
pub const TAG_COLORS: [&str; 10] = [
    "#2563EB", // blue
    "#16A34A", // green
    "#CA8A04", // amber
    "#DC2626", // red
    "#7C3AED", // violet
    "#0D9488", // teal
    "#EA580C", // orange
    "#DB2777", // pink
    "#0284C7", // sky
    "#71717A", // zinc
];

/// 按序号取默认色：序号来自「当前标签数量 / 迁移顺序」，保证同一批标签配色不重复。
pub fn default_color(index: usize) -> String {
    TAG_COLORS[index % TAG_COLORS.len()].to_string()
}

/// 标签名：trim 后必填，上限 32 字；名字里不允许出现逗号（旧的逗号分隔输入已移除，
/// 逗号会让「标签名」看起来像多个标签）。
pub fn validate_name(name: &str) -> MendResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(MendError::Vault("标签名称不能为空".into()));
    }
    if name.chars().count() > TAG_NAME_MAX {
        return Err(MendError::Vault(format!(
            "标签名称过长（上限 {TAG_NAME_MAX} 字）"
        )));
    }
    if name.contains(',') || name.contains('，') {
        return Err(MendError::Vault("标签名称不能包含逗号".into()));
    }
    Ok(name.to_string())
}

/// 颜色：只接受 `#RRGGBB`（大小写不敏感，统一存大写）；空值回退到默认色板。
pub fn validate_color(color: Option<&str>, fallback_index: usize) -> MendResult<String> {
    match color.map(str::trim) {
        None | Some("") => Ok(default_color(fallback_index)),
        Some(value) => {
            let body = value.strip_prefix('#').unwrap_or("");
            if value.len() == 7 && body.len() == 6 && body.chars().all(|c| c.is_ascii_hexdigit()) {
                Ok(value.to_ascii_uppercase())
            } else {
                Err(MendError::Vault("颜色格式应为 #RRGGBB".into()))
            }
        }
    }
}

/// 历史标签名归一：去 `#` 前缀（旧 UI 允许 `#work`），trim；空名返回 `None`。
pub fn normalize_legacy_name(raw: &str) -> Option<String> {
    let name = raw.trim().trim_start_matches('#').trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_validation() {
        assert_eq!(validate_name("  工作 ").unwrap(), "工作");
        assert!(validate_name("   ").is_err());
        assert!(validate_name("工作,生活").is_err());
        assert!(validate_name(&"a".repeat(TAG_NAME_MAX + 1)).is_err());
    }

    #[test]
    fn color_validation() {
        assert_eq!(validate_color(Some("#a1b2c3"), 0).unwrap(), "#A1B2C3");
        // 空值 / 未提供：按序号取默认色。
        assert_eq!(validate_color(None, 0).unwrap(), TAG_COLORS[0]);
        assert_eq!(validate_color(Some("  "), 1).unwrap(), TAG_COLORS[1]);
        for bad in ["red", "#12345", "#1234567", "123456", "#GGGGGG"] {
            assert!(validate_color(Some(bad), 0).is_err(), "应拒绝: {bad}");
        }
    }

    #[test]
    fn legacy_names_are_normalized() {
        assert_eq!(normalize_legacy_name(" #work ").as_deref(), Some("work"));
        assert_eq!(normalize_legacy_name("#").as_deref(), None);
        assert_eq!(normalize_legacy_name("  ").as_deref(), None);
    }
}
