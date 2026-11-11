# Mend 前端质量口径

Mend 是 product register（用户在执行任务，界面服务于任务）。本文件是 Mend 自己的视觉与交互基线，配合 `impeccable` 的共享设计法则使用；两者冲突时以本文件的具体约定为准。

## 技术基线

- Vue 3 `<script setup>` + TypeScript 严格模式 + TailwindCSS（`tailwind.config.ts`，`darkMode: 'class'`）。
- 颜色与圆角全部走 `src/assets/main.css` 的 CSS 变量（`:root` 与 `.dark` 两套 HSL），不写死 `#hex`、不新造色板。
- 组件类名用 `cn()` 组合；不引入新的样式库、组件库；图标只用已装的 `lucide-vue-next`（按需引入单个图标），不再引入第二套图标库，也不堆 emoji。
- 深浅两套必须同时成立：新组件要检查 `.dark` 下的对比度与层级。

## 文案

- 所有界面文案进 `src/locales/zh-CN.json` 与 `en.json`，键名成组（`nav.*` / `entry.*` / `trash.*` / `settings.*` / `toast.*`）。
- 中文用陈述句、动词开头；不写"请点击此处"这类社交辞令。
- 错误提示给"发生了什么 + 下一步"，不暴露内部路径或密钥信息。
- 标点：不用长破折号；中文用全角，英文用半角。

## 组件状态清单

每个交互组件都要考虑：default / hover / focus / active / disabled / loading / error。

- 按钮：`focus-visible` 必须有可见环（`ring-*`），禁用态降透明度并阻止点击。
- 输入：错误态给边框 + 辅助文案，不只靠颜色区分。
- 列表：空态给"为什么空 + 怎么开始"（例如"暂无条目，点击新增条目创建第一条"），而不是"暂无数据"。
- 异步操作：提交中禁用按钮并保持宽度，失败回滚 UI 并 toast。

## 布局与密度

- 主界面左右结构固定：左侧分类栏、右侧列表；窗口最小 860×560。
- 间距沿用现有节奏（4/8/12/16/20），不要每处都 16px；分组靠近、区块拉开。
- 卡片不是默认答案：条目本身就是一条信息，不要卡片套卡片。
- 表格/列表行高稳定，长文本截断（`truncate` / `line-clamp-*`），不撑破布局。

## 动效

- 只表达状态变化：显隐、切换、loading、反馈。150–250ms，`ease-out`，不用 bounce / elastic。
- 不动画布局属性（width/height/top/left），只用 `transform` 与 `opacity`。
- 尊重 `prefers-reduced-motion`。

## 绝对禁令

- 侧边彩色条（`border-left/right > 1px` 当强调）、渐变文字（`background-clip: text`）、装饰性毛玻璃。
- 大数字 hero 指标、同尺寸卡片阵列、动辄开弹窗（能用内联/渐进替代先用内联）。
- 硬编码颜色、深浅主题只做一套。
- 用 emoji 当图标或当装饰（用户未要求时一律不用）。

## 安全相关展示

- 密码默认隐藏，显示需显式点击；复制按钮与显示按钮分开。
- 回收站内不提供复制与编辑入口。
- 弱密码/重复密码标记用文字短标签 + `title` 解释，不只靠颜色。
- 备份、恢复、清空回收站等不可逆动作必须二次确认，并在文案里写清后果。
