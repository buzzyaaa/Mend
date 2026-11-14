# Skill 来源与许可

`skills/` 下的第三方 Skill（以及项目自有的 `mend-dev`）随仓库分发，便于后续接手者直接用。第三方内容的版权归原作者，改动处逐条标注。

## mend-dev

- 来源：**项目自有**（非第三方），随仓库维护。
- 本仓库改动：0.4.0 重构后重写为 Native Shell（nsh 0.5.0）+ TSX 原生视图 + Rust 的架构口径；旧的 Tauri / Vue / naive-ui 内容已全部替换，更新时以 `AGENTS.md` 与 `docs/11-native-shell.md` 为准。

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

## nsh

- 上游：`longbridge/nsh`，目录 `skills/nsh`（SKILL.md + references/ 共 10 个文件），快照取自 commit `a93759e01bb3e2b3af0bdeeaf1f6ad8f890a7d4f`
- 许可：仓库 Apache-2.0（见上游 `LICENSE-APACHE`）
- 本仓库改动：无内容改动，按上游目录原样分发。上游指南可能比 Mend 使用的 nsh 0.5.0 新，以本项目 `.nsh/types` 与实际依赖源码为准。

## nsh-design-guides

- 上游：`longbridge/nsh`，目录 `skills/nsh-design-guides`（SKILL.md + references/design-guides.md），快照取自 commit `a93759e01bb3e2b3af0bdeeaf1f6ad8f890a7d4f`
- 许可：仓库 Apache-2.0（见上游 `LICENSE-APACHE`）
- 本仓库改动：无内容改动，按上游目录原样分发。

## 使用约束

- 不复制上游的商标、私有资产与字体授权；引用只作设计参考。
- 上游文本与仓库 `docs/` 的硬性约束冲突时，以 `docs/` 与 `AGENTS.md` 为准。
