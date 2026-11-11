# 02 · 技术栈定型与 UI 框架决策

> 本文只记录**当前生效**的选型与约定。早期 shadcn-vue / Element Plus 的对比评估已作废（2026-11-11 起统一迁移到 naive-ui），过程性材料不写入公开文档。

## 1. 当前核心技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 桌面壳 | Tauri 2.x | Rust 后端 + WebView 渲染，离线优先 |
| 前端框架 | Vue 3（`<script setup>` + Composition API） | 严格 TypeScript |
| 构建 | Vite 6 | `npm run build` = `vue-tsc --noEmit` + `vite build` |
| UI 组件库 | **naive-ui 2.x** | 所有交互控件（按钮、输入、选择、表格、标签、弹窗、确认、消息、菜单、布局）统一使用 |
| 布局样式 | TailwindCSS 3 | **只用于布局与尺寸**（flex/grid/gap/padding/截断等），不用于造控件、不用于写死颜色 |
| 视觉令牌 | `src/assets/main.css` 的 CSS 变量 | `:root` / `.dark` 两套 HSL；Tailwind 与 naive-ui 共用同一套变量，是唯一色彩来源 |
| 主题装配 | `src/lib/theme.ts` + `src/App.vue` | `NConfigProvider` 按 `preferences.isDark` 切 `darkTheme`，`themeOverrides` 把 naive-ui 变量指向 CSS 变量 |
| 图标 | `lucide-vue-next` | 唯一图标来源，按需引入单个图标，不使用 emoji 当图标 |
| 状态管理 | Pinia | vault / entry / preset / preferences |
| 路由 | Vue Router | `/unlock` 独立；`/main` `/presets` `/settings` 共用 `AppShell` |
| 国际化 | vue-i18n | `src/locales/{zh-CN,en}.json`；naive-ui 内置文案由 `NConfigProvider` 的 `locale` / `dateLocale` 同步 |
| Markdown | 自研白名单渲染器 `src/lib/markdown.ts` | 先转义再生成固定标签，只放行 http/https 链接；无第三方 Markdown 依赖 |
| 数据库 | SQLite（Rust 侧 `rusqlite`） | 字段级加密，见 `04` |
| 加密 | Rust 侧 Argon2id + XChaCha20-Poly1305 | 见 `04` |

## 2. UI 统一约定（不可违背）

1. **单一组件词汇**：按钮 `NButton`、输入 `NInput` / `NInputNumber`、下拉 `NSelect`、表格 `NDataTable`、标签 `NTag`、弹窗 `NModal`、确认 `useDialog`、反馈 `useToast`（`NMessageProvider`）、菜单 `NMenu`、布局 `NLayout` / `NLayoutSider` / `NCard`。不得再写原生 `<button>` / `<input>` / `<select>` / `<textarea>` / `window.confirm` / `window.alert` 充当界面控件。
2. **单一色彩来源**：颜色、圆角、字号、语义色（success/warning/error/info）一律来自 CSS 变量；组件里不写 `#hex`、不写 `text-red-500` 之类的字面色。危险态用 `type="error"` / `NAlert`，不用自定义色。
3. **主题联动**：`.dark` 与 naive-ui `darkTheme` 由同一个 `preferences.isDark` 驱动，深浅两套都要过对比度；新增组件不得只做浅色。
4. **浮层挂载点**：需要 teleport 的浮层统一挂到 `OVERLAY_TARGET`（`#mend-overlays`），确保继承 `NConfigProvider` 的主题变量。`NMessageProvider` / `NDialogProvider` 已在 `App.vue` 装配，`NModal` 必须显式传 `:to`。
5. **状态齐全**：交互组件覆盖 default / hover / focus / active / disabled / loading / error；列表必须有空态，危险操作必须二次确认并写清后果。
6. **i18n 先行**：所有界面文案（含 aria-label、tooltip、确认弹窗文案）走词条，中英两份同步，组件里不硬编码中英文。
7. **不引入第二套组件库 / 图标库**：radix-vue、shadcn-vue 及其配套工具（`class-variance-authority` / `clsx` / `tailwind-merge` / `cn()`）已全部移除，不再恢复。
8. **导航栏折叠全栏一致**：`NavRail` 的 `collapsed` 同时作用于品牌文字、上方 `NMenu` 与左下角操作按钮；展开态一律「图标 + 文字」且左对齐，折叠态一律只剩图标（Tooltip 补说明），不允许局部常驻文字或常驻图标。

## 3. 组件落点

| 位置 | 使用的 naive-ui 能力 |
| --- | --- |
| `src/App.vue` | `NConfigProvider` + `NGlobalStyle` + `NMessageProvider` + `NDialogProvider` |
| `src/components/layout/AppShell.vue` / `NavRail.vue` | `NLayout` / `NLayoutSider` / `NMenu` / `NTooltip` / `NButton` |
| `src/components/layout/Sidebar.vue` | `NButton` / `NIcon` / `NModal` / `NInput` / `useDialog` |
| `src/components/layout/EntryList.vue` | `NInput` / `NSelect` / `NCard` / `NEmpty` / `NTag` / `NTooltip` / `useDialog` |
| `src/components/entry/EntryDialog.vue` | `NModal` + `NCard` / `NSelect` / `NInputNumber` / `NCheckbox` / `NTabs` |
| `src/views/PresetsView.vue` | `NTabs` / `NDataTable`（普通滚动）/ `NTag` / `useDialog` |
| `src/views/SettingsView.vue` | `NCard` / `NSelect` / `NInput` / `NAlert` / `useDialog` |
| `src/views/UnlockView.vue` | `NCard` / `NInput` / `NTag` / `NAlert` |

## 4. 当前前端依赖

`vue`、`vue-router`、`pinia`、`vue-i18n`、`naive-ui`、`lucide-vue-next`、`@tauri-apps/plugin-dialog`。
开发期：`tailwindcss` / `postcss` / `autoprefixer`、`vite`、`typescript` / `vue-tsc`、`eslint` / `prettier`。
Tailwind 只作为布局工具保留；`src/lib/utils.ts`（`cn()`）与 `src/components/ui/ToastHost.vue` 已删除。

## 5. 验收口径

- `npm run typecheck`、`npm run lint`、`npm run build` 全绿。
- 浅色 / 深色两套主题下逐页走查：控件颜色一致、浮层（消息、确认、弹窗）继承主题、无原生控件残留、无硬编码中文或色值。
- 中英切换后所有控件文案（含 naive-ui 内置文案）同步刷新。
