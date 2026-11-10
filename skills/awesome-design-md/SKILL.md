---
name: awesome-design-md
description: "Use when selecting, copying, adapting, or applying a curated DESIGN.md design-system file for a project UI, brand-style reference, or design-system brief. Works with a local corpus when one is present, and otherwise fetches the upstream DESIGN.md for the named brand. Trigger on prompts like 「make it look like Linear」, 「写一份 DESIGN.md 基线」, or extracting a product's visual system."
---

# Awesome DESIGN.md

用本 Skill 从参考库里挑一份 `DESIGN.md` 并落到项目里。`DESIGN.md` 是纯 Markdown 的设计系统文档，AI 设计与编码 agent 可直接读。默认不要加载整库。

> 本仓库安装说明（本地备注）：上游约 70 份 `design-md/<slug>/DESIGN.md` 语料**未随本仓库分发**（体积与授权原因）。本地 `design-md/` 不存在时走「按品牌名取上游」流程。

## Workflow

1. 明确要参考的产品、品牌、站点或审美方向。
2. 有本地 `design-md/CATALOG.txt` 时，先查精确或相近匹配；没有则跳过。
3. 只加载选中的那一份：本地 `design-md/<slug>/DESIGN.md`，或按下面「按品牌名取上游」抓取。
4. 用户需要持久的设计基线时，把选中内容改写（不是原样复制）成项目根的 `DESIGN.md`。
5. 把选中的文件当视觉系统参考：身份、token、布局、组件、动效、响应式行为。
6. 上游内容只作设计参考与公开 CSS token 参考。不复制其私有资产、logo、字体授权与商标表述，不暗示品牌关联。
7. 与 `../impeccable/SKILL.md` 配合：先定语言（本 Skill），再评审与打磨（impeccable）。

## 按品牌名取上游

本地没语料时，用 `web_fetch` 取上游原始文件（路径形如
`https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/<slug>/DESIGN.md`）。
取到后：

- 先读结构（identity / colors / typography / spacing / components / motion / responsive）；
- 只把与当前项目相关的部分钉进自己的 `DESIGN.md`，删掉该品牌特有的商标、字体授权与营销文案；
- 抓不到就停下来说明，不要凭记忆编造某品牌的 token。

## 写自己的 DESIGN.md

没有合适参考、或不想对标品牌时，直接按下面骨架写项目自己的设计基线（Mend 现成的口径见 `../mend-dev/references/frontend-quality.md`）：

```markdown
# DESIGN.md
## Identity       一句话定位、语气、参考与反参考
## Colors         语义色名 → 值（浅色/深色两套），以及使用规则
## Typography     字族、字号阶梯、字重、行高
## Spacing        基准单位与常用间距
## Layout         栅格、容器宽度、响应式断点
## Components     按钮/输入/列表/卡片/弹窗的规格与状态
## Motion         时长、缓动、可关闭条件
## Iconography    图标风格与尺寸
## Do / Don't     三条必须与三条禁止
```

落盘后让 impeccable 按 product register 评审一次，再开始改界面。
