# 第三方 Skill 来源与许可

`skills/` 下的第三方 Skill 为便于本地与后续 agent 直接读取而随仓库分发。内容是上游文本的摘录或适配版本，版权归原作者所有。

## self-improving

- 上游：`jdrhyne/agent-skills`（`clawdbot/self-improving-agent`）
- 许可：见上游仓库
- 本仓库改动：写入目录改为项目私有 `local/learnings/`（避免过程记录进入公开仓库），其余结构化条目格式沿用上游。

## impeccable

- 上游：`seflless/dot-agents`（`skills/impeccable`），基于 Anthropic 的 frontend-design skill
- 许可：SKILL.md 为 Apache 2.0，仓库为 MIT
- 本仓库改动：只随带 `SKILL.md` 与 `reference/{brand,product,craft}.md`；上游脚本（`load-context.mjs` / `pin.mjs`）与其余 `reference/*.md`、`commands/` 未分发，SKILL.md 顶部与命令表已就地标注，避免误引用缺失文件。

## awesome-design-md

- 上游：`VoltAgent/awesome-design-md`（MIT）
- 本仓库改动：语料库（约 70 份 `design-md/<slug>/DESIGN.md`）未分发，改为「本地有语料就读、没有就用 web 取上游」的流程，并补充了自写 `DESIGN.md` 的骨架。

## 使用约束

- 不复制上游的商标、私有资产与字体授权；引用只作设计参考。
- 上游文本若与仓库内 `docs/` 的硬性约束冲突，以 `docs/` 与 `AGENTS.md` 为准。
