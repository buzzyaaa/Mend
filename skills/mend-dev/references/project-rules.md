# 项目规则摘要

本文件是 `AGENTS.md` 的精简版，冲突时以仓库根 `AGENTS.md` 与 `docs/` 为准。

## 必读文档顺序

| 顺序 | 文档 | 作用 |
| --- | --- | --- |
| 1 | `docs/README.md` | 索引与阅读路径 |
| 2 | `docs/01-requirements.md` | 需求、范围边界、MVP 对照 |
| 3 | `docs/02-tech-decision-ui.md` | 技术栈定型与 UI 方案结论 |
| 4 | `docs/03-architecture.md` | 分层架构、目录结构、IPC 约定 |
| 5 | `docs/04-data-model-encryption.md` | 表结构、字段加密、密钥派生 |
| 6 | `docs/05-mvp-spec.md` | 功能规格与交互细节 |
| 7 | `docs/06-backup-webdav.md` | 备份/恢复与 WebDAV 预留 |
| 8 | `docs/07-i18n.md` | 中英切换与词条约定 |
| 9 | `docs/08-roadmap.md` | 分阶段计划与验收标准 |
| 10 | `docs/09-env-setup.md` | 工具链安装与命令备忘 |

## 八条硬性约束

1. 落盘即加密：敏感字段写库前必须在 Rust 侧加密，库文件无明文。
2. 前端不直连数据库：读写一律经 Tauri Command。
3. 密钥不落盘：主密码不存储，会话密钥仅内存，锁定即清零。
4. 离线优先：默认零网络请求；WebDAV 可选且只传密文。
5. i18n 先行：文案走词条，组件内不硬编码。
6. 改动回写文档：架构/契约变化先改 `docs/`，再记 `local/DEVLOG.md`。
7. 公开仓库只放规则：过程性材料（日志、调研、参考分析）只进 `local/`。
8. 不公开个人与本机信息：姓名、账号、邮箱、手机、地址、内网、绝对路径、SSH、受限网络细节都不许出现在仓库内容与提交信息里。

## 工作约定

- 分支：`main` 保护，功能 `feat/xxx`，修复 `fix/xxx`。
- 提交信息：Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:` / `refactor:`）。
- 类型：前端严格 TypeScript；Rust 对外命令入参/出参都要有明确结构体与错误类型。
- 日志：禁止打印密码、密钥、备注明文；安全事件只记不含敏感数据的元信息。
- 主密码策略：最短 4 位（`MIN_PASSWORD_LEN`），前端同值校验；测试口令只写在 `local/`。

## 目录结构（高层）

```
docs/            规则与设计文档（公开）
skills/          开发用 Skill（本目录）
scripts/         环境脚本
src/             前端（views / components / stores / composables / lib / locales / types）
src-tauri/       主 crate（commands 命令层 + lib.rs 装配）
src-tauri/core/  核心 crate（不依赖 Tauri，可独立测试）
local/           本地私有：DEVLOG、调研、学习记录、临时产物（已忽略，不推送）
```
