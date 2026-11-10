# 第三方 Skill 来源与许可

`skills/` 下的第三方 Skill 随仓库分发，便于后续接手者直接用。版权归原作者，改动处逐条标注。

## self-improving

- 上游：`jdrhyne/agent-skills`，目录 `clawdbot/self-improving-agent`（SKILL.md 原文）
- 许可：见上游仓库
- 本仓库改动：`name` 改为 `self-improving`（与目录一致）；写入目录从 `.learnings/` 改为项目私有 `local/learnings/`，避免过程记录进入公开仓库。

## impeccable

- 上游：`seflless/dot-agents`，目录 `skills/impeccable`（整目录安装，含 `SKILL.md`、`reference/*.md`、`scripts/*.mjs`、`agents/openai.yaml`）
- 许可：SKILL.md 为 Apache 2.0，仓库为 MIT；后者基于 Anthropic 的 frontend-design skill
- 本仓库改动：无内容改动，按上游目录原样分发。

## awesome-design-md

- 上游：`VoltAgent/awesome-design-md`（MIT），语料 84 份 `design-md/<slug>/DESIGN.md`
- 许可：仓库 MIT，见 `awesome-design-md/LICENSE`
- 本仓库改动：新增 `SKILL.md`（上游只有语料、没有 skill 清单）与 `CATALOG.txt`（从每份 DESIGN.md 的 frontmatter 生成 slug、名称、一句话描述）；`README.md` 以 `UPSTREAM_README.md` 保留作快照。

## 使用约束

- 不复制上游的商标、私有资产与字体授权；引用只作设计参考。
- 上游文本与仓库 `docs/` 的硬性约束冲突时，以 `docs/` 与 `AGENTS.md` 为准。
