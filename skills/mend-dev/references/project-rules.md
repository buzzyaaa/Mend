# 项目规则摘要

本文件是 `AGENTS.md` 的精简版，冲突时以仓库根 `AGENTS.md` 与 `docs/11-native-shell.md` 为准。

## 必读文档顺序

| 顺序 | 文档 | 作用 |
| --- | --- | --- |
| 1 | `AGENTS.md` | 硬性约束、工作约定、隐私红线 |
| 2 | `docs/README.md` | 文档索引与阅读路径 |
| 3 | `docs/11-native-shell.md` | **当前架构（0.4.0）**：nsh 混合应用、TSX/Rust 分层、数据兼容、验证命令 |
| 4 | `docs/04-data-model-encryption.md` | 表结构、字段加密格式、密钥派生（仍有效） |
| 5 | `docs/05-mvp-spec.md` | 功能规格与字段/业务规则（布局段落已被原生 UI 取代） |
| 6 | `docs/06-backup-webdav.md` | 备份/恢复格式与 WebDAV 预留 |
| 7 | `docs/07-i18n.md` | 中英切换与词条约定（实现已换成 nsh/i18n） |
| 8 | `docs/09-env-setup.md` | 工具链、nsh 安装、可选 dev-env |
| 9 | `docs/10-release-update.md` | `nsh package` / `nsh publish`、更新清单、CI 发布流程 |

`docs/01`、`02`、`03`、`08` 含 Tauri / Vue / Vite / WebView 时代内容，作为历史记录保留（`05`/`06`/`07` 的字段与业务规则仍有效，布局与实现段落以 `docs/11` 为准）；当前事实以 `docs/11` 为准。不要为了“让旧文档看起来一致”去改它们，活文档（`AGENTS.md`、`docs/11`、`README.md`、skills、工作流）才需要同步。

## 硬性约束

1. 落盘即加密：敏感字段写库前必须在 Rust 侧加密，库文件无明文。
2. 前端不直连数据库：TSX 只经 `mend/native`（统一封装在 `lib/native.ts`）读写。
3. 密钥不落盘：主密码不存储，KEK/DEK 仅内存，锁定即清零。
4. 离线优先：默认零网络请求；备份只写本地密文；WebDAV 是未实现的预留。
5. i18n 先行：文案走 `locales/en.json` 与 `locales/zh-CN.json`，组件内不硬编码。
6. 同步原生导出：除 `revealDataDir` 外的 `Vault` 导出必须同步，signal 写入留在引擎线程。
7. 只写 TSX 原生视图：无 WebView / HTML / CSS 页面 / 前端打包器 / 浏览器 DOM API。
8. 改动回写文档：架构/契约变化先改 `docs/11`，再记 `local/DEVLOG.md`。
9. 公开仓库只放规则：过程性材料（日志、调研、参考分析）只进 `local/`。
10. 不公开个人与本机信息：姓名、账号、邮箱、手机、地址、内网、绝对路径、SSH、受限网络细节都不许出现在仓库内容与提交信息里。

## 工作约定

- 分支：`main` 保护，功能 `feat/xxx`，修复 `fix/xxx`。
- 提交信息：Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:` / `refactor:`）；是否 commit/push 以用户指令为准。
- 类型：TSX 严格 TypeScript；原生 DTO 以 `.nsh/types/mend/native.d.ts` 为准，UI 侧类型从 `mend/native` re-export。
- Rust：`core` 不依赖 nsh/GUI；`native` 只做 DTO、路径、文件/备份编排与模块导出；业务规则优先留在 `core`。
- 日志：禁止打印密码、密钥、备注明文；安全事件只记录元信息。
- 版本号需同步：`nsh.json`、`package.json`、`core/Cargo.toml`（以及发布 tag）。

## 目录结构（高层）

```text
docs/            规则与设计文档（公开）
skills/          开发用 Skill（本目录）
scripts/         环境脚本（选用的 dev-env.ps1）
App.tsx          入口：boot → setup / unlock / main
components/      原生 UI 组件（列表、详情、编辑器、设置、统一控件 ui.tsx）
screens/         UnlockScreen、MainScreen
lib/             native 封装、signals、错误映射、格式化、偏好
locales/         en.json、zh-CN.json
native/          nsh 原生模块 mend/native（api / dto / service / error）
core/            mend-core：加密 + SQLite + 备份（无 GUI）
assets/          图标（SVG）与应用图标
nsh.json         应用元数据、窗口、capabilities、rust: native
theme.json       浅/深两套设计令牌
local/           本地私有：DEVLOG、调研、学习记录（已忽略，不推送）
```

## 数据契约

- 应用 id：`com.mend.app`；库文件：`mend.db`；schema v4。
- 加密：Argon2id 派生 KEK，DEK 由 KEK 包裹存 `meta`；字段用 XChaCha20-Poly1305 + AAD。
- 备份：`mend-backup-*.mendbak`。
- 旧 Tauri 版本的库与备份可直接打开，不需要迁移向导；改动这些格式等于破坏兼容性，必须先改 `docs/04` 并说明迁移方案。
