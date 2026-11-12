---
name: mend-dev
description: "Mend 项目（本地离线加密密码管理器，Tauri 2 + Vue 3 + TypeScript + SQLite）的开发总入口。在本仓库内做任何开发任务时默认先用本 Skill：改代码、加功能、改架构、写/改文档、跑测试、打包、提交、UI 设计或评审、排查构建失败。它汇总硬性约束、目录落点、命令与验证口径、隐私红线，并规定何时配合使用 self-improving / impeccable / awesome-design-md 三个 skill。"
---

# Mend 开发总入口

Mend 是本地离线、存盘加密的个人密码管理器。接手或继续开发时，先按本 Skill 走，不要凭印象改架构。

## 1. 开工前三件事

1. 读仓库根 `AGENTS.md`（规则）与 `docs/README.md`（文档索引），按索引读与本次改动相关的专题文档。
2. 读本地私有 `local/DEVLOG.md` **顶部条目**（最新在上），确认上一轮做到哪、遗留什么。该目录已被 `.gitignore` 忽略，**不进仓库、不推送**。
3. 确认环境：每个新的 PowerShell 会话先在仓库根执行 `scripts/dev-env.ps1`，把 cargo / MinGW / git / gh 加进会话 PATH。

## 2. 硬性约束（违反即返工）

1. **落盘即加密**：账号、密码、邮箱、手机号、备注等敏感字段必须在 Rust 侧加密后才写 SQLite；库文件里不允许出现这些字段的明文。
2. **前端不直连数据库**：所有读写走 Tauri Command，前端只用 `src/lib/ipc.ts` 的类型化封装。
3. **密钥不落盘**：主密码不存储；会话 DEK 只驻留内存，锁定/退出清零。
4. **离线优先**：默认零网络请求；WebDAV 只上传密文，且是可选增强。
5. **i18n 先行**：界面文案一律走 `src/locales/{zh-CN,en}.json`，组件里不硬编码中英文。
6. **改动回写文档**：架构、数据模型、IPC 约定变化时，先改对应 `docs/` 文档，再在 `local/DEVLOG.md` 追加条目（格式见第 7 节）。
7. **公开仓库只放规则**：`docs/`、`AGENTS.md`、`skills/` 只收录规则、约定与验收标准；开发日志、调研、参考项目分析、失败过程一律放 `local/`。
8. **不公开个人与本机信息**：真实姓名、个人账号、邮箱、手机号、住址、内网地址、绝对路径、SSH 信息、受限网络情况、临时关掉安全校验的做法都不得出现在代码、注释、文档、配置、提交信息中。提交前自查 `git status` 与 `git diff`。

## 3. 代码落点

| 层 | 位置 | 放什么 |
| --- | --- | --- |
| 核心逻辑 | `src-tauri/core/`（crate `mend-core`，不依赖 Tauri/WebView） | 加密、SQLite 仓储、条目/预设/备份编排、金库生命周期、生成器、同步 trait |
| IPC 命令层 | `src-tauri/src/commands/` | 只做参数搬运、状态守卫、错误映射；不写业务规则 |
| 应用装配 | `src-tauri/src/lib.rs` | 插件注册、`generate_handler!` 注册命令、`manage` 状态 |
| 前端 | `src/`（`views/`、`components/`、`stores/`、`lib/`、`composables/`） | 界面、状态、IPC 封装、主题覆盖（`lib/theme.ts`）、纯函数工具（如 `markdown.ts`、`security.ts`） |

新增业务逻辑默认落 `mend-core`；命令层与前端只做传递与展示。

## 4. 命令与验证口径

详见 `references/commands.md`。最短路径：

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/core/Cargo.toml   # 唯一可跑测试的地方
npm run typecheck
npm run build
npm run tauri dev
npm run tauri build                                     # 产物 src-tauri/target/release/mend.exe
```

**禁止在 `src-tauri` 主 crate 上跑 `cargo test`**：测试二进制链接 WebView 依赖，本机会以 `STATUS_ENTRYPOINT_NOT_FOUND` 崩溃（应用本身正常）。新逻辑要可测，就写进 `mend-core` 并在 `core/tests/flow.rs` 补链路测试。

## 5. 改动的工作流

1. **定位**：读相关 `docs/` 专题 + 现有实现，确认改动到底落在哪一层。
2. **先文档后代码**：契约/数据模型/IPC 有变化，先改文档再改代码。
3. **实现**：后端 `mend-core` → 命令注册 → 前端类型与 IPC → 界面（文案同步进两份 locale）。
4. **验证**：按第 4 节四条命令跑通；行为型改动补/改测试；界面改动至少 typecheck + build。
5. **回写**：更新 `docs/08-roadmap.md` 勾选状态与 `AGENTS.md` 状态行（如果阶段/能力有变化）。
6. **记录**：`local/DEVLOG.md` 顶部追加条目。
7. **提交**：按 `AGENTS.md` 第 7、8 条自查，Conventional Commits，推 `origin`。

## 6. 隐私与公开面自查（每次提交前）

- `git status` 里不应出现 `local/`、数据库文件、备份文件、日志、导出产物。
- `git diff` 里不应出现绝对路径、个人账号、邮箱、开发期测试口令、内网地址。
- 文档里不写"本机怎么怎么样"；环境相关的临时做法只进 `local/`。

## 7. 开发日志格式（写进 `local/DEVLOG.md` 顶部）

```markdown
## YYYY-MM-DD — <一句话标题>
- 改动：做了什么 / 涉及哪些文件
- 决策：关键取舍与原因
- 验证：命令、测试结果、手动步骤
- 遗留：未完成项或已知风险
```

## 8. 关联 Skill 的使用规则

三个 skill 与本仓库同处 `skills/` 目录，按相对路径读取，触发条件如下。

### self-improving —— 记录"这次学到的东西"

路径：`../self-improving/SKILL.md`。遇到以下情况，先读它再继续：

- 命令/构建/打包失败，且原因值得记（不是"重启一下就好"那种）；
- 用户纠正了你的假设或约定（"不对，应该是……"）；
- 发现更省事的重复流程；
- 用户提出当前不具备的能力，需要登记为待办。

落盘位置改为本项目私有目录：`local/learnings/`（`LEARNINGS.md` / `ERRORS.md` / `FEATURE_REQUESTS.md`），**不得**写进仓库。绝不记录密码、密钥、私有路径、账号信息。只有用户明确要求时，才把学习成果升级为 `docs/` 规则。

### impeccable —— 任何界面设计、评审、打磨

路径：`../impeccable/SKILL.md`。触发：新增/重做页面与组件、空态、设置弹窗、表单、主题与配色、间距与层级、动效、UX 文案、可访问性、界面性能、响应式、"看起来太平/太吵"的调整。

Mend 属于 **product register**（用户在执行任务，设计服务于任务），先读 `../impeccable/reference/product.md`；`../impeccable/reference/{brand,craft}.md` 供建站式页面或端到端 craft 流程参考。上游 25 个文件（`command` 对应 reference、`reference/*.md`、`scripts/*.mjs`）已随仓库完整安装，命令表里点名的 reference 都能直接读。

执行要点（与 Mend 现状对齐）：

- 颜色用现有 CSS 变量（`:root` / `.dark` 两套 HSL），不新增硬编码色值；深浅两套都要过对比度。
- 组件必须齐 `default / hover / focus / active / disabled / loading / error` 状态；列表要有空态、加载态、错误态。
- 动效只表达状态，150–250ms，ease-out，不用 bounce/elastic，尊重 `prefers-reduced-motion`。
- 绝对禁令：侧边彩色条、渐变文字、装饰性毛玻璃、大数字 hero 指标、同尺寸卡片阵列、动辄用弹窗。
- **组件库已定为 naive-ui**（见 `docs/02`）：按钮、输入、下拉、表格、弹窗、确认、消息、菜单一律用 naive-ui 组件，不写原生 `<button>` / `<input>` / `<select>` / `window.confirm`；Tailwind 只做布局与尺寸。不引入第二套组件库或图标库，图标只用已装的 `lucide-vue-next`；`cn()` 已随 shadcn 生态移除，不再使用。
- 新组件的颜色必须来自 `main.css` 的 CSS 变量（naive-ui 侧由 `src/lib/theme.ts` 的 `themeOverrides` 注入）；需要 teleport 的浮层挂到 `OVERLAY_TARGET`，否则深浅主题会失效。

### awesome-design-md —— 需要某个品牌的设计语言参考时

路径：`../awesome-design-md/SKILL.md`。触发：用户点名某个产品的视觉风格（如"像 Linear 那种"）、要给项目落一份设计基线条目 `DESIGN.md`、或需要对标某品牌 token/排版。

语料库（上游 84 份 `design-md/<slug>/DESIGN.md`）已随仓库安装，索引见 `../awesome-design-md/CATALOG.txt`（slug、名称、一句话描述），按需只读选中的一份，不要整库加载。引用上游内容只作设计参考，不复制其 logo、字体授权与商标表述。

组合顺序：选语言（awesome-design-md）→ 落基线（Mend `DESIGN.md`）→ 评审与打磨（impeccable）→ 记录教训（self-improving）。

## 9. 交付前自检清单

- [ ] 四条验证命令全绿；新增行为有测试或说明为何没有
- [ ] 新文案两份 locale 都加了，无硬编码中文/英文
- [ ] 落盘字段确认已加密；锁定时会话密钥清零
- [ ] `docs/` 与 `AGENTS.md` 与实现一致，`docs/08` 勾选已更新
- [ ] `local/DEVLOG.md` 已追加，且不在 `git status` 里
- [ ] `git diff` 无隐私内容；提交信息为 Conventional Commits
