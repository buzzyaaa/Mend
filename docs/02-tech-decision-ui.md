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
| 路由 | Vue Router | 只有 `/unlock`（独立，不带标题栏操作）与 `/main`（解锁后唯一页面）；设置 / 预设值 / 语言选择均为弹窗，不占路由 |
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
8. **顶栏集中导航与窗口控制，主布局左右两列**：左侧图标导航栏（`NavRail`）已移除。语言切换、预设值、设置三个功能全部收进顶部标题栏——各自是一个图标按钮，点击弹出窗口（`LanguageDialog` / `PresetsDialog` / `SettingsDialog`，开关状态在 `src/stores/ui.ts`），不再占用路由页；再往右是「锁定」按钮与窗口控制（最小化/最大化/关闭）。主界面（`MainView`）为左右两列：`Sidebar`（分类侧栏） + `EntryList`（密码列表 Data Table）。三个弹窗统一挂在 `App.vue` 的 `NMessageProvider` / `NDialogProvider` 内部，因此弹窗内可以直接使用 `useToast` / `useDialog`。
9. **标题栏拖拽 + 右键菜单 + 单色强调**：窗口 `decorations:false`（见 `src-tauri/tauri.conf.json`）。拖拽用 `header` 的 `@mousedown` → `getCurrentWindow().startDragging()`（交互元素加 `@mousedown.stop` 拦截避免误触）；三个窗口控制按钮调用 `src/lib/window.ts`（最大化↔还原图标切换、订阅 `onResized` 同步状态）。标题栏 `data-titlebar` 右键由全局 `contextmenu` 监听拦截，调 `src/lib/titlebarMenu.ts` 弹出 Windows 风格菜单（还原/移动/大小/最小化/最大化/关闭），其余区域右键全局抑制（保持桌面观感，Ctrl+C/V 仍可用）。
   **窗口控制与原生菜单需要 Tauri 能力授权**：`core:window:default` 只含读取类接口，`minimize` / `maximize` / `unmaximize` / `close` / `start-dragging` 等动作必须显式授权，否则 IPC 被权限层拒绝、按钮表现为"点了没反应"（前端 `.catch()` 会静默吞掉错误）。授权集中写在 `src-tauri/capabilities/default.json`，新增窗口动作时同步补一条 `core:window:allow-*`。右键菜单项的动作同样落到窗口能力上，所以菜单能弹出但项失效时，第一反应是查授权而不是查菜单构建。强调色统一为墨黑/近白单色（`main.css` 的 `--primary` / `--ring`），不再混用蓝/紫/黑；语义状态色（success/warning/error/info）仅用于标签与告警，不当作 UI 控件强调色。

## 3. 组件落点

| 位置 | 使用的 naive-ui 能力 |
| --- | --- |
| `src/App.vue` | `NConfigProvider` + `NGlobalStyle` + `NMessageProvider` + `NDialogProvider` + `TitleBar`；全局 `contextmenu` 监听（抑制默认右键菜单，标题栏弹出原生菜单）；挂载设置 / 预设值 / 语言三个弹窗 |
| `src/components/layout/TitleBar.vue` | 自定义标题栏：`@mousedown` 拖拽 + 窗口控制（`@tauri-apps/api/window`，`src/lib/window.ts`）+ 语言 / 预设值 / 设置 / 锁定四个图标按钮（弹窗开关走 `src/stores/ui.ts`） |
| `src/lib/titlebarMenu.ts` | 标题栏右键菜单：`@tauri-apps/api/menu` 构建 Windows 风格菜单并 `popup` 到光标处；每次右键重建，保证语言切换后文案最新 |
| `src/stores/ui.ts` | 顶栏弹窗开关状态（设置 / 预设值 / 语言），三个弹窗组件都挂在 `App.vue` |
| `src/components/layout/AppShell.vue` | 纯内容区（`RouterView`），不再含图标导航栏 |
| `src/components/layout/Sidebar.vue` | `NButton` / `NIcon` / `NModal` / `NInput` / `useDialog` |
| `src/components/layout/EntryList.vue` | `NDataTable`（密码列表：备注缩略 + 展开看完整 Markdown + 编辑按钮；展开走 `type: 'expand'` 列的 `renderExpand`）/ `NInput` / `NSelect` / `NEmpty` / `NTag` / `NPopconfirm` / `useDialog` |
| `src/components/entry/EntryDialog.vue` | `NModal` + `NCard` / `NSelect` / `NInputNumber` / `NCheckbox` / `NTabs` |
| `src/components/presets/PresetsDialog.vue` | 预设值弹窗（原 `src/views/PresetsView.vue`）：`NTabs` / `NDataTable`（普通滚动）/ `NTag` / `useDialog` |
| `src/components/settings/SettingsDialog.vue` | 设置弹窗（原 `src/views/SettingsView.vue`）：`NCard` / `NSelect` / `NInput` / `NAlert` / `useDialog` |
| `src/components/language/LanguageDialog.vue` | 语言选择弹窗：`NModal` + `NCard` + `NRadioGroup`，选中即切换并关闭 |
| `src/views/UnlockView.vue` | `NCard` / `NInput` / `NTag` / `NAlert` |

## 4. 当前前端依赖

`vue`、`vue-router`、`pinia`、`vue-i18n`、`naive-ui`、`lucide-vue-next`、`@tauri-apps/plugin-dialog`。
开发期：`tailwindcss` / `postcss` / `autoprefixer`、`vite`、`typescript` / `vue-tsc`、`eslint` / `prettier`。
Tailwind 只作为布局工具保留；`src/lib/utils.ts`（`cn()`）与 `src/components/ui/ToastHost.vue` 已删除。

## 5. 验收口径

- `npm run typecheck`、`npm run lint`、`npm run build` 全绿。
- 浅色 / 深色两套主题下逐页走查：控件颜色一致、浮层（消息、确认、弹窗）继承主题、无原生控件残留、无硬编码中文或色值。
- 中英切换后所有控件文案（含 naive-ui 内置文案）同步刷新。
