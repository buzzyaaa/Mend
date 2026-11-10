//! 强密码生成：本地 CSPRNG（`OsRng`），无网络、无持久化。
//! 规则见 `docs/05-mvp-spec.md` §4；生成结果只返回给调用方，是否保存取决于用户。

use rand::rngs::OsRng;
use rand::RngCore;
use serde::Deserialize;

use crate::error::{MendError, MendResult};

pub const MIN_LENGTH: usize = 6;
pub const MAX_LENGTH: usize = 64;
pub const DEFAULT_LENGTH: usize = 16;

const UPPERCASE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
const DIGITS: &[u8] = b"0123456789";
const SYMBOLS: &[u8] = b"!@#$%^&*()-_=+[]{};:,.<>?/";
/// 易混字符：0 O o 1 l I |
const AMBIGUOUS: &[u8] = b"0Oo1lI|";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorOptions {
    pub length: usize,
    #[serde(default = "default_true")]
    pub uppercase: bool,
    #[serde(default = "default_true")]
    pub lowercase: bool,
    #[serde(default = "default_true")]
    pub digits: bool,
    #[serde(default = "default_true")]
    pub symbols: bool,
    #[serde(default)]
    pub exclude_ambiguous: bool,
}

fn default_true() -> bool {
    true
}

impl Default for GeneratorOptions {
    fn default() -> Self {
        Self {
            length: DEFAULT_LENGTH,
            uppercase: true,
            lowercase: true,
            digits: true,
            symbols: true,
            exclude_ambiguous: false,
        }
    }
}

/// 拒绝采样取 `[0, n)` 的下标，保证分布无偏。
fn pick_index(rng: &mut OsRng, n: usize) -> usize {
    let bound = n as u32;
    let limit = u32::MAX - (u32::MAX % bound);
    loop {
        let v = rng.next_u32();
        if v < limit {
            return (v % bound) as usize;
        }
    }
}

fn pick(rng: &mut OsRng, pool: &[u8]) -> u8 {
    pool[pick_index(rng, pool.len())]
}

fn clean(pool: &[u8], exclude_ambiguous: bool) -> Vec<u8> {
    if !exclude_ambiguous {
        return pool.to_vec();
    }
    pool.iter()
        .copied()
        .filter(|b| !AMBIGUOUS.contains(b))
        .collect()
}

pub fn generate(options: &GeneratorOptions) -> MendResult<String> {
    if !(MIN_LENGTH..=MAX_LENGTH).contains(&options.length) {
        return Err(MendError::Vault(format!(
            "长度需在 {MIN_LENGTH}–{MAX_LENGTH} 之间"
        )));
    }

    let mut classes: Vec<Vec<u8>> = Vec::new();
    if options.uppercase {
        classes.push(clean(UPPERCASE, options.exclude_ambiguous));
    }
    if options.lowercase {
        classes.push(clean(LOWERCASE, options.exclude_ambiguous));
    }
    if options.digits {
        classes.push(clean(DIGITS, options.exclude_ambiguous));
    }
    if options.symbols {
        classes.push(clean(SYMBOLS, options.exclude_ambiguous));
    }
    classes.retain(|c| !c.is_empty());

    if classes.is_empty() {
        return Err(MendError::Vault("至少选择一类字符".into()));
    }
    if options.length < classes.len() {
        return Err(MendError::Vault("长度不足以容纳所选的每一类字符".into()));
    }

    let mut rng = OsRng;
    let all: Vec<u8> = classes.iter().flatten().copied().collect();
    let mut out = Vec::with_capacity(options.length);

    // 先每类各取一个，保证勾选的字符类都出现
    for class in &classes {
        out.push(pick(&mut rng, class));
    }
    // 其余位从合并字符池取
    while out.len() < options.length {
        out.push(pick(&mut rng, &all));
    }

    // Fisher–Yates 洗牌，避免"每类首位"这种固定位置
    for i in (1..out.len()).rev() {
        let j = pick_index(&mut rng, i + 1);
        out.swap(i, j);
    }

    let s = String::from_utf8(out).map_err(|_| MendError::Vault("生成结果异常".into()))?;
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn respects_length_and_classes() {
        let opts = GeneratorOptions {
            length: 20,
            uppercase: true,
            lowercase: true,
            digits: true,
            symbols: true,
            exclude_ambiguous: false,
        };
        let pwd = generate(&opts).expect("生成");
        assert_eq!(pwd.chars().count(), 20);
        assert!(pwd.chars().any(|c| c.is_ascii_uppercase()));
        assert!(pwd.chars().any(|c| c.is_ascii_lowercase()));
        assert!(pwd.chars().any(|c| c.is_ascii_digit()));
        assert!(pwd.chars().any(|c| !c.is_ascii_alphanumeric()));
    }

    #[test]
    fn excludes_ambiguous_characters() {
        let opts = GeneratorOptions {
            length: 32,
            uppercase: true,
            lowercase: true,
            digits: true,
            symbols: false,
            exclude_ambiguous: true,
        };
        for _ in 0..5 {
            let pwd = generate(&opts).expect("生成");
            assert!(
                !pwd.chars().any(|c| AMBIGUOUS.contains(&(c as u8))),
                "不应出现易混字符：{pwd}"
            );
        }
    }

    #[test]
    fn two_generations_differ() {
        let opts = GeneratorOptions::default();
        assert_ne!(generate(&opts).unwrap(), generate(&opts).unwrap());
    }

    #[test]
    fn rejects_bad_options() {
        let mut opts = GeneratorOptions::default();
        opts.length = 4;
        assert!(generate(&opts).is_err());

        let mut opts = GeneratorOptions::default();
        opts.uppercase = false;
        opts.lowercase = false;
        opts.digits = false;
        opts.symbols = false;
        assert!(generate(&opts).is_err(), "全不选应报错");
    }
}
