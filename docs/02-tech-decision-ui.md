# 02 · 技术栈定型与 UI 框架评估

## 1. 已确定的核心技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 桌面壳 | **Tauri 2.x** | 轻量、Rust 后端、WebView 渲染；跨 Windows/macOS/Linux |
| 前端框架 | **Vue 3**（`<script setup>` + Composition API） | 与项目既定技术栈一致 |
| 语言 | **TypeScript**（严格模式） | 前后端接口类型对齐 |
| 构建 | **Vite 5/6** | Tauri 官方前端构建方案 |
| 样式 | **TailwindCSS** | 原子化样式，主题/暗色模式基础 |
| 数据库 | **SQLite**（Rust 侧 `rusqlite`） | 嵌入式单文件，便于整库拷贝备份 |
| 状态管理 | **Pinia** | Vue 官方推荐，与 Composition API / `<script setup>` 天然契合 |
| 路由 | **Vue Router** | 主界面 / 解锁页 / 设置页 |
| 国际化 | **vue-i18n** | 见 `07-i18n.md` |
| Markdown | **markdown-it**（渲染）+ **highlight.js**（可选代码高亮）；编辑器用 textarea + 工具栏，或轻量 Markdown 编辑器组件 | 备注编辑与预览 |
| 加密 | **Rust 侧**：Argon2id 派生密钥 + XChaCha20-Poly1305 认证加密 | 见 `04-data-model-encryption.md` |

> 说明：SQLite 本身不做整库透明加密（MVP 采用应用层字段加密，见 `04`）；如后续需要整库加密，可再评估 SQLCipher。

## 2. UI 框架评估：Shadcn/UI vs Element Plus

> 注意：官方 shadcn/ui 是 React 版本；Vue 生态对应的实现是 **shadcn-vue**（基于 Radix Vue 原语 + TailwindCSS，组件源码拷贝进项目、可直接改）。本项目栈是 Vue，因此对比对象为 **shadcn-vue** 与 **Element Plus**。

### 2.1 对比维度

| 维度 | shadcn-vue（Radix Vue + Tailwind） | Element Plus |
| --- | --- | --- |
| 视觉美观度 | 现代、克制、留白精致，贴近 Linear / Vercel 类桌面工具审美；样式完全由 Tailwind 主题令牌控制，易做出统一高级感 | 默认偏中后台企业风，组件密度高；要达到"精致美观"需要覆盖大量默认样式与主题变量 |
| 与 Tailwind 契合度 | 原生契合，组件类名即 Tailwind，主题色/暗色模式直接走 CSS 变量 | 自带一套样式体系，与 Tailwind 并存时容易出现样式优先级冲突，需要额外归一化 |
| 定制自由度 | 组件源码在项目内，可任意改结构与样式；不受组件库升级绑架 | 通过主题变量 + 覆盖样式定制，深层结构改动受限 |
| 组件交付方式 | 拷贝组件到 `src/components/ui/`，按需引入，不打包一整个黑盒库 | 全量/按需引入，封装度高 |
| 开发速度 | 基础组件需自行拼装（对话框、下拉、表单、Tooltip 等），初期略慢 | 组件开箱即用（Dialog/Select/Form/Message/MessageBox 齐全），起步快 |
| 生态与成熟度 | shadcn-vue 生态年轻于 React 版，个别复杂组件可能缺；Radix Vue 可访问性较好 | Vue 3 生态最成熟的组件库之一，文档与案例丰富，踩坑资料多 |
| 包体积 | 按需拷贝，体积可控 | 组件较多，全量体积偏大（可按需引入缓解） |
| 暗色模式 | Tailwind CSS 变量方案，落地直接 | 自带暗色变量，但与自有主题叠加需调试 |
| 可访问性 | Radix Vue 提供键盘/焦点/ARIA 原语 | 组件自带一定 a11y 支持 |

### 2.2 结论：**采用 shadcn-vue**

理由：

1. **美观是硬需求**：shadcn-vue + Tailwind 的视觉上限和统一度更高，符合个人密码工具想要的精致桌面感；Element Plus 默认中后台观感需要较多返工。
2. **技术栈天然对齐**：本项目已确定 TailwindCSS，shadcn-vue 是 Tailwind 原生方案，不存在两套样式体系打架。
3. **可定制与长期维护**：组件源码在仓内，后续改字段卡片、备注弹窗、预设下拉、生成器面板都不受库版本限制。

### 2.3 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| shadcn-vue 个别组件缺失或 API 不稳 | 优先选用 Dialog、Select、DropdownMenu、Tooltip、Input、Button、Tabs、Switch、Badge、ScrollArea 等成熟原语；缺的组件用 Radix Vue 自行封装并记录在本地 `local/DEVLOG.md` |
| 初期拼装慢于 Element Plus | MVP 只引入实际用到的组件；表单/弹窗模式在阶段 1 沉淀成项目内通用封装，后续复用 |
| 团队若更熟悉 Element Plus | 保留回退可能：样式层用 Tailwind 令牌隔离，业务组件不直接依赖某库的深层 API；若阶段 1 评估 shadcn-vue 阻塞严重，可切换 Element Plus，但需先更新本文档决策 |

### 2.4 推荐引入的首批组件（阶段 1/3）

`Button`、`Input`、`Textarea`、`Dialog`（备注/条目独立弹窗）、`Select`（分类、预设字段、密码字符集）、`DropdownMenu`（行内更多操作/复制菜单）、`Tooltip`（复制按钮提示）、`Tabs`（备注 编辑/预览）、`Switch`（生成器选项）、`Badge`（分类标签）、`ScrollArea`（侧栏与列表滚动）、`Separator`、`Toast`（操作反馈）。

## 3. 关键依赖建议（阶段 1 落地时复核版本）

- 前端：`vue`、`vue-router`、`pinia`、`vue-i18n`、`tailwindcss`、`radix-vue`（shadcn-vue 的底层原语）、`markdown-it`、`@vueuse/core`（剪贴板、空闲监听等）。
- 图标：`lucide-vue-next`（ISC，按需 tree-shake 引入单个图标组件）。仅在导航栏等确实需要图标的少量位置使用；其余装饰仍用纯 Tailwind / 简单 SVG，不额外引入第二套图标库。
- Rust：`tauri`（2.x）、`rusqlite`（bundled）、`argon2`、`chacha20poly1305`、`hkdf`、`rand`（OsRng）、`serde`/`serde_json`、`thiserror`、`zeroize`。
