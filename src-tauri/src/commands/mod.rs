//! IPC 命令层：按领域拆分到 vault / category / entry。
//! 统一命名 `<domain>_<action>`，入参/出参与前端 `src/types/` 一一对应。

pub mod category;
pub mod entry;
pub mod vault;

pub use category::*;
pub use entry::*;
pub use vault::*;
