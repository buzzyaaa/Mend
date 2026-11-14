---
name: mend-dev
description: "Mend 项目（本地离线、存盘加密的个人密码管理器；Native Shell 0.5.0 + TSX 原生视图 + Rust core/native）的开发总入口。在本仓库内做任何开发任务时默认先用本 Skill：改代码、加功能、改架构、写/改文档、跑测试、构建、打包、提交、UI 设计或评审、排查构建失败。它汇总硬性约束、目录落点、命令与验证口径、隐私红线，并规定何时配合使用 self-improving / impeccable / awesome-design-md 三个 skill。"
---

# Mend 开发总入口

Mend 是本地离线、存盘加密的个人密码管理器，当前技术栈是 **Native Shell（nsh 0.5.0）+ TSX 原生视图 + Rust**。接手或继续开发时先按本 Skill 走，不要凭旧 Tauri / Vue 时代的印象改架构。

## 1. 开工前三件事

1. 读仓库根 `AGENTS.md`，再读 `docs/11-native-shell.md`（当前架构与验证口径的唯一事实来源）；按 `docs/README.md` 的索引读本次改动相关的专题。`docs/01`–`10` 是历史设计记录，Tauri / Vue / WebView / naive-ui 段落已不适用。
2. 读本地私有 `local/DEVLOG.md` **顶部条目**（最新在上），确认上一轮做到哪、遗留什么。该目录已被 `.gitignore` 忽略，**不进仓库、不推送**。
3. 确认环境：在仓库根目录直接运行 `nsh dev .` 即可。`scripts/dev-env.ps1` 是可选的会话增强（仓库内 `CARGO_HOME` 缓存与 PATH 统一），需要时再 dot-source；nsh 必须解析到官方安装路径（Windows 为 `%LOCALAPPDATA%\nsh\bin`）。

## 2. 硬性约束（违反即返工）

1. **落盘即加密**：账号、密码、邮箱、手机号、备注、预设值等敏感字段必须在 Rust 侧加密后才写 SQLite；库文件里不允许出现这些字段的明文。
2. **前端不直连数据库**：TSX 只通过 `mend/native` 的类型化接口读写（统一经 `lib/native.ts`），不接触 SQLite 连接或原始密钥。
3. **密钥不落盘**：主密码不存储；KEK 仅内存；DEK 由 KEK 包裹后存 `meta`；锁定/退出时清零会话密钥。
4. **离线优先**：默认零网络请求；备份只写本地密文；WebDAV 仍是未实现的预留。
5. **i18n 先行**：所有界面文案走 `locales/en.json` 与 `locales/zh-CN.json`，组件里不硬编码中英文。
6. **同步原生导出**：除 `revealDataDir` 外，`Vault` 导出保持同步，保证 signal 写入发生在引擎线程；不要改回自定义 `async fn` 再在 TSX `await` 后写 signal（会触发 `no reactive runtime`）。
7. **只写 TSX 原生视图**：UI 使用 nsh 的 `View` / `Text` / `Scroll` / `List` / `Input` / `Dialog` / `TextView` 等原生组件；不存在 WebView、HTML、CSS 页面或前端打包器，不要引入浏览器 DOM API。
8. **公开仓库只放规则**：`docs/`、`AGENTS.md`、`skills/` 只收录规则、约定与验收标准；开发日志、调研、参考项目分析、失败过程一律放 `local/`。
9. **不公开个人与本机信息**：真实姓名、个人账号、邮箱、手机号、住址、内网地址、绝对路径、SSH 信息、受限网络情况、临时关掉安全校验的做法都不得出现在代码、注释、文档、配置、提交信息中。提交前自查 `git status` 与 `git diff`。

## 3. 代码落点

| 层 | 位置 | 放什么 |
| --- | --- | --- |
| 入口与装配 | `App.tsx` | boot → setup / unlock / main 的挂载；不写业务规则 |
| 界面 | `components/`、`screens/` | nsh 原生视图组件（`UnlockScreen`、`MainScreen`、列表、详情、编辑器、设置、统一控件 `components/ui.tsx`） |
| UI 状态与封装 | `lib/` | `native.ts`（唯一 native 封装）、`state.ts`（signals/动作）、`errors.ts`、`format.ts`、`preferences.ts`、`types.ts`、`update.ts` |
| 原生模块 | `native/src/` | `api.rs`（`#[module] Vault` 导出）、`dto.rs`、`service.rs`（进程级 SQLite + 会话 DEK）、`error.rs`；只做 DTO、路径、文件/备份编排与模块导出 |
| 核心逻辑 | `core/`（crate `mend-core`，不依赖 nsh/GUI） | crypto、SQLite 仓储、条目/预设/备份编排、金库生命周期、生成器 |
| 词条 | `locales/` | `en.json`、`zh-CN.json`（rust-i18n v1 格式） |
| 元数据 | `nsh.json`、`theme.json`、`tsconfig.json` | 应用元数据与 `rust: native`、设计令牌、TS 配置（继承 `.nsh/tsconfig.json`） |

新增业务逻辑默认落 `mend-core`；`native` 只做参数搬运、状态守卫、错误映射；TSX 只做展示与交互。原生 DTO 以 `.nsh/types/mend/native.d.ts` 为准，UI 侧类型从 `mend/native` re-export，避免漂移。

## 4. 命令与验证口径

详见 `references/commands.md`。最短路径：

```powershell
nsh dev .                    # 官方开发入口：本机原生宿主 + TSX 热重载
nsh check .                  # 官方类型检查（native cargo check + TypeScript 7）
nsh test .                   # headless：native cargo test + TSX UI 测试
cargo test --manifest-path core\Cargo.toml   # 核心逻辑测试
npm run typecheck            # TypeScript 备用门禁
```

- `nsh dev .` 会按端口自动接管旧会话，不需要杀进程或手动清理 dev-sessions 目录；`nsh run . --target web` 只用于 web / tui 等其他目标预览，不是主开发入口。
- 测试前设置 `MEND_DATA_DIR=${workspaceFolder}\.tmp\test-data` 并清空，避免碰到真实库；`.vscode/tasks.json` 已内置该逻辑。
- 构建 / 打包输出在 `.nsh/out`；`nsh package . --target windows` 产出 `Mend/`（含 `Mend.exe`）、`Mend.zip`、带版本的更新压缩包与 `Mend.iss`，装有 Inno Setup 6 时另有 `setup.exe`。
- 不要在主 crate 上跑 `cargo test`：当前没有 Tauri 主 crate，测试入口是 `core` 与 `native`。

## 5. 改动的工作流

1. **定位**：读相关 `docs/` 专题 + 现有实现，确认改动落在 core / native / lib / 界面哪一层。
2. **先文档后代码**：契约、数据模型、原生模块接口有变化，先改 `docs/11` 或对应专题文档，再改代码。
3. **实现**：`core` → `native`（DTO + 导出）→ `lib/native.ts` 与 `lib/types.ts` → 界面；文案同步进两份 locale。
4. **验证**：至少 `nsh check .` + `nsh test .`；只改 core 时跑 `cargo test --manifest-path core\Cargo.toml`；界面改动补 headless UI 测试或说明为何没有。
5. **回写**：更新 `docs/11` 中受影响的状态/命令/风险段落（不要再往 `docs/08` 勾旧路线图）。
6. **记录**：`local/DEVLOG.md` 顶部追加条目。
7. **提交**：按 `AGENTS.md` 第 3、4 节自查，Conventional Commits；是否 commit/push 以用户指令为准。

## 6. 隐私与公开面自查（每次提交前）

- `git status` 里不应出现 `local/`、数据库文件、备份文件、日志、导出产物、`.nsh/out`、`.tmp/`。
- `git diff` 里不应出现绝对路径、个人账号、邮箱、开发期测试口令、内网地址。
- 文档里不写“本机怎么怎么样”；环境相关的临时做法只进 `local/`。

## 7. 开发日志格式（写进 `local/DEVLOG.md` 顶部）

```markdown
## YYYY-MM-DD — <一句话标题>
- 改动：做了什么 / 涉及哪些文件
- 决策：关键取舍与原因
- 验证：命令、测试结果、手动步骤
- 遗留：未完成项或已知风险
```

## 8. 关联 Skill 的使用规则

`skills/` 下另有三个通用 skill，按相对路径读取：

### self-improving —— 记录“这次学到的东西”

路径：`../self-improving/SKILL.md`。遇到以下情况，先读它再继续：

- 命令/构建/打包失败，且原因值得记（不是“重启一下就好”那种）；
- 用户纠正了你的假设或约定（“不对，应该是……”）；
- 发现更省事的重复流程；
- 用户提出当前不具备的能力，需要登记为待办。

落盘位置改为本项目私有目录：`local/learnings/`（`LEARNINGS.md` / `ERRORS.md` / `FEATURE_REQUESTS.md`），**不得**写进仓库。绝不记录密码、密钥、私有路径、账号信息。只有用户明确要求时，才把学习成果升级为 `docs/` 规则。

### impeccable —— 任何界面设计、评审、打磨

路径：`../impeccable/SKILL.md`。触发：新增/重做页面与组件、空态、设置弹窗、表单、主题与配色、间距与层级、UX 文案、可访问性、界面性能、响应式、“看起来太平/太吵”的调整。

Mend 属于 **product register**（用户在执行任务，设计服务于任务），先读 `../impeccable/reference/product.md`；`../impeccable/reference/{brand,craft}.md` 供建站式页面或端到端 craft 流程参考。上游 25 个文件已随仓库完整安装，命令表里点名的 reference 都能直接读。

执行要点（与 Mend 当前实现对齐）：

- 颜色与圆角来自 `theme.json` 的 `cssVars`（浅/深两套），TSX 里用 `token('primary')` 或对应的 Tailwind 语义类（`bg-card`、`text-muted-foreground`、`border-border`…），不写死 `#hex`、不新造色板；深浅两套都要过对比度。
- 交互控件优先复用 `components/ui.tsx` 的 `ActionButton` / `IconButton` / `TextField` / `SelectField` / `SwitchField` / `Chip` / `Badge` / `EmptyState`；需要新控件时先补这里，不要在页面里复制一份样式。
- 组件必须齐状态：default / hover / focus / active / disabled；列表要有空态、加载态、错误态；可用状态在 class 里表达（`hover:`、`active:`、`disabled:opacity-*`），与现有代码保持一致。
- 图标使用 `assets/icons/*.svg` 经 `components/Icon.tsx` 的 `<Image tintColor>` 着色；不引入图标库、不把 emoji 当图标（分类图标是用户数据，例外）。
- 布局保持现有节奏：桌面 master-detail（侧栏 + 列表 + 详情），手机单栏（详情页 + 分类 Sheet）；窗口宽度 < 900 或 `platform.idiom` 为 `phone`/`pad` 时切单栏，底部安全区用 `env(safe-area-inset-*)`。
- 绝对禁令：侧边彩色条、渐变文字、装饰性毛玻璃、大数字 hero 指标、同尺寸卡片阵列、动辄用弹窗；硬编码颜色或只做一套主题。

### awesome-design-md —— 需要某个品牌的设计语言参考时

路径：`../awesome-design-md/SKILL.md`。触发：用户点名某个产品的视觉风格（如“像 Linear 那种”）、要给项目落一份设计基线条目 `DESIGN.md`、或需要对标某品牌 token/排版。

语料库（上游 84 份 `design-md/<slug>/DESIGN.md`）已随仓库安装，索引见 `../awesome-design-md/CATALOG.txt`（slug、名称、一句话描述），按需只读选中的一份，不要整库加载。引用上游内容只作设计参考，不复制其 logo、字体授权与商标表述。

### nsh / nsh-design-guides —— 上游官方技能快照

`../nsh/` 与 `../nsh-design-guides/` 是 nsh 官方技能与设计指南的快照（未跟踪、由上游维护），可用于查 nsh 组件与设计指南。它们可能比 Mend 使用的 nsh 0.5.0 新：与本项目 `.nsh/types`、`docs/11` 或 `AGENTS.md` 冲突时，以本项目为准。

组合顺序：选语言（awesome-design-md）→ 落基线（Mend `DESIGN.md`）→ 评审与打磨（impeccable）→ 记录教训（self-improving）。

## 9. 交付前自检清单

- [ ] `nsh check .` 与 `nsh test .` 通过；只改 core 时核心测试通过；新增行为有测试或说明为何没有
- [ ] 新文案两份 locale 都加了，无硬编码中文/英文
- [ ] 落盘字段确认已加密；锁定时会话密钥清零；TSX 未直接接触 SQLite
- [ ] 原生导出仍为同步（除 `revealDataDir`），没有引入 `async fn` + `await` 后写 signal
- [ ] `docs/11` 与 `AGENTS.md` 与实现一致
- [ ] `local/DEVLOG.md` 已追加，且不在 `git status` 里
- [ ] `git diff` 无隐私内容；提交信息为 Conventional Commits
