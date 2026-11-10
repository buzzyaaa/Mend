---
name: awesome-design-md
description: "Use when selecting, copying, adapting, or applying a curated DESIGN.md design-system file for a project UI, brand-style reference, or design-system brief. Ships the VoltAgent awesome-design-md corpus locally (84 brands). Trigger on prompts like 「make it look like Linear」, 「照 Stripe 的视觉做一版」, 「写一份 DESIGN.md 基线」, or extracting a product's visual system."
---
# Awesome DESIGN.md

从本地语料里挑一份 `DESIGN.md` 并为项目落地。`DESIGN.md` 是纯 Markdown 的设计系统文档，AI 设计与编码 agent 可直接读。**默认不要加载整个语料库**，只读选中的一份。

## 语料

- 语料根目录：`design-md/<slug>/DESIGN.md`（84 个品牌，上游 VoltAgent/awesome-design-md，MIT）
- 索引：`CATALOG.txt`，每行 `slug<TAB>名称<TAB>一句话描述`
- 上游说明快照：`UPSTREAM_README.md`；许可：`LICENSE`

每份 `DESIGN.md` 结构为 YAML frontmatter（`name` / `description` / `colors` token）+ 正文（identity、typography、spacing、components、motion、responsive、agent prompt 指引）。

## Workflow

1. 明确要参考的产品、品牌、站点或审美方向；先想清楚"要它的哪一部分"（配色？密度？层级？排版气质？），别整份照搬。
2. 在 `CATALOG.txt` 里按 slug 或描述找精确或相近的匹配。没有合适匹配就说明并改用 `mend-dev/references/frontend-quality.md` 的现有口径，不要硬套一个不相干的品牌。
3. 只加载选中的 `design-md/<slug>/DESIGN.md`。
4. 需要持久设计基线时，把选中内容**改写**（不是原样复制）成项目根的 `DESIGN.md`：换成项目自己的语义色名与字号阶梯，删掉该品牌特有的商标、字体授权、营销文案。
5. 用这份基线约束实现：颜色走 token、排版走阶梯、间距走节奏，组件状态齐全。
6. 不复制上游私有资产、logo、字体文件、商标表述，不暗示与品牌存在关联。
7. 评审交给 `../impeccable/SKILL.md`：先按它判 register（Mend 是 product），再逐条过 anti-pattern。

## 写项目自己的 DESIGN.md（无合适参考时）

```markdown
# DESIGN.md
## Identity       一句话定位、语气、参考与反参考
## Colors         语义色名 → 值（浅色/深色两套）+ 使用规则
## Typography     字族、字号阶梯、字重、行高
## Spacing        基准单位与常用间距
## Layout         栅格、容器宽度、响应式断点
## Components     按钮/输入/列表/卡片/弹窗的规格与状态
## Motion         时长、缓动、降级条件
## Iconography    图标风格与尺寸
## Do / Don't     三条必须与三条禁止
```

Mend 现有的 token 与组件口径以 `../mend-dev/references/frontend-quality.md` 为准，写 `DESIGN.md` 时直接对齐，不要另起一套色板。
