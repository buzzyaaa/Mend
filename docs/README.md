# Mend 文档索引

本目录是项目的“单一事实来源”。接手开发前先读根目录 [`../AGENTS.md`](../AGENTS.md)，再按顺序阅读。

## 文档清单

| 文档 | 内容 |
| --- | --- |
| [11-native-shell.md](./11-native-shell.md) | **当前架构（0.4.0）**：Native Shell 混合应用、TSX/Rust 分层、数据兼容、UI 决策、验证与已知风险 |
| [01-requirements.md](./01-requirements.md) | 需求拆解、范围边界、MVP 与后续功能对照（技术栈段落已被 0.4.0 取代） |
| [02-tech-decision-ui.md](./02-tech-decision-ui.md) | 历史 UI 选型记录（naive-ui / Tauri 时代，已过时） |
| [03-architecture.md](./03-architecture.md) | 历史分层与目录结构（Tauri 时代，已过时；当前见 `11`） |
| [04-data-model-encryption.md](./04-data-model-encryption.md) | SQLite 表结构、字段加密格式、密钥派生与内存安全（仍有效） |
| [05-mvp-spec.md](./05-mvp-spec.md) | MVP 功能规格（布局/标题栏段落已被原生 UI 取代，字段与业务规则仍有效） |
| [06-backup-webdav.md](./06-backup-webdav.md) | 手动拷贝备份/恢复、加密导出导入、WebDAV 预留（导出位置改为应用数据目录，见 `11`） |
| [07-i18n.md](./07-i18n.md) | 中英文切换（实现已换成 nsh/i18n + rust-i18n 词条格式） |
| [08-roadmap.md](./08-roadmap.md) | 分阶段计划与验收（0.4.0 状态见 `11` 与本地 DEVLOG） |
| [09-env-setup.md](./09-env-setup.md) | 工具链、环境准备（裸跑 / 可选 dev-env）、nsh 安装与平台依赖 |
| [10-release-update.md](./10-release-update.md) | 发布与更新（已改为 `nsh package`；自动更新待配置） |

> `../local/DEVLOG.md` 为本地私有开发日志，不入库。

## 阅读路径建议

- **新接手 Agent**：`AGENTS.md` → `11` → `01` → `04` → `08`。
- **做 UI**：`11` → `05`（字段与交互）→ `07`。
- **做数据/加密/备份**：`04` → `06` → `11`。
- **评估进度**：`local/DEVLOG.md` 顶部与 `11` 的“当前状态”。
