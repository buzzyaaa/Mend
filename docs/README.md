# Mend 文档索引

本目录是项目的"单一事实来源"。接手开发前先读根目录 [`../AGENTS.md`](../AGENTS.md)，再按下列顺序阅读。

## 文档清单

| 文档 | 内容 |
| --- | --- |
| [01-requirements.md](./01-requirements.md) | 需求拆解、范围边界、MVP 与后续功能对照、非目标 |
| [02-tech-decision-ui.md](./02-tech-decision-ui.md) | 技术栈定型；当前 UI 框架决策（naive-ui）、主题装配与组件约定 |
| [03-architecture.md](./03-architecture.md) | 分层架构、目录结构、Tauri IPC 命令约定、状态管理 |
| [04-data-model-encryption.md](./04-data-model-encryption.md) | SQLite 表结构、字段加密格式、密钥派生与内存安全 |
| [05-mvp-spec.md](./05-mvp-spec.md) | MVP 功能规格：布局、分类、列表、Markdown 备注弹窗、预设字段、复制、密码生成器 |
| [06-backup-webdav.md](./06-backup-webdav.md) | 手动拷贝备份/恢复、加密导出导入、WebDAV 同步预留接口 |
| [07-i18n.md](./07-i18n.md) | 中英文切换方案、词条目录、组件接入约定 |
| [08-roadmap.md](./08-roadmap.md) | 分阶段开发计划、里程碑、验收标准、工具链检查清单 |
| [09-env-setup.md](./09-env-setup.md) | 工具链版本、会话初始化脚本、安装取舍与已知遗留 |

> 以下不在本目录、为本地私有（被 `.gitignore` 忽略，不推送到 GitHub）：`../local/DEVLOG.md`（开发日志）。
>
> 本目录与根目录 `AGENTS.md` 只收录开发规则与设计约定；过程性材料（开发日志、技术调研）一律放本地 `local/`，不入库。

## 阅读路径建议

- **新接手 Agent**：`AGENTS.md` → `01` → `02` → `03` → `08`，先建立全局认知，再按任务读对应专题文档。
- **做前端界面**：`02` → `05` → `07` → `03`。
- **做数据/加密/备份**：`04` → `06` → `03`。
- **评估进度**：看本地私有 `../local/DEVLOG.md` 顶部最新条目与 `08-roadmap.md` 的里程碑状态（日志不在远程仓库）。
