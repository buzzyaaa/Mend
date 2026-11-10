//! 密码生成器命令：纯计算，不读写数据库、不持有会话密钥。

use crate::error::MendResult;
use crate::generator::{generate, GeneratorOptions};

#[tauri::command]
pub fn generator_generate(options: GeneratorOptions) -> MendResult<String> {
    generate(&options)
}
