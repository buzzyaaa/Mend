---
name: self-improving
description: "把失败、纠正与新发现沉淀成可复用的本地学习记录，避免同一坑重复踩。当以下情况出现时使用：(1) 命令、构建、打包、工具调用意外失败；(2) 用户纠正了你的假设或项目约定；(3) 发现了更省事的重复流程；(4) 外部 API/工具不可用或行为异常；(5) 用户要求当前不具备的能力；(6) 开工前需要回顾某一领域以前踩过的坑。记录含结构化的学习、错误、能力请求三类条目。"
---

# Self-Improving

把非显而易见的学习、失败与能力请求记进一个小的本地知识库，让同类错误不再重复。

## 何时记录

- 命令、工具、集成以值得记住的方式失败
- 用户纠正了假设，或教会了项目特定约定
- 发现更好的可复用流程
- 用户要求了尚不存在的能力，需要登记
- 在一个熟悉的领域开工前，需要回顾旧记录

## 存放位置

写入本地私有目录（不同项目可自定义，本项目约定为 `local/learnings/`）：

- `local/learnings/LEARNINGS.md`
- `local/learnings/ERRORS.md`
- `local/learnings/FEATURE_REQUESTS.md`

首次使用时创建目录。这些文件属于过程材料，**不得**进入公开仓库。

## 条目格式

### Learning（纠正、约定、更好的做法）

```markdown
## [LRN-YYYYMMDD-XXX] category

**Logged**: ISO-8601 时间
**Priority**: low | medium | high | critical
**Status**: pending
**Area**: frontend | backend | infra | tests | docs | config

### Summary
一句话结论

### Details
发生了什么，现在确认正确的做法是什么

### Suggested Action
具体后续动作或应当固化的规则

### Metadata
- Source: conversation | error | user_feedback
- Related Files: path/to/file.ext
- Tags: tag1, tag2
- See Also: LRN-20250110-001
```

### Error（可复现的失败或时好时坏的流程）

```markdown
## [ERR-YYYYMMDD-XXX] tool_or_workflow

**Logged**: ISO-8601 时间
**Priority**: high
**Status**: pending
**Area**: frontend | backend | infra | tests | docs | config

### Summary
失败的一句话描述

### Error
原始报错文本或症状

### Context
- 尝试了什么操作
- 输入或环境细节（不含机密）

### Suggested Fix
最可能的下一步
```

### Feature Request（缺失的能力）

```markdown
## [FEAT-YYYYMMDD-XXX] capability_name

**Logged**: ISO-8601 时间
**Priority**: medium
**Status**: pending
**Area**: frontend | backend | infra | tests | docs | config

### Requested Capability
用户想要什么

### User Context
为什么重要

### Suggested Implementation
可能的扩展点与实现方向
```

## 流程

1. 上下文一清楚就立刻记，别攒到最后。
2. 重复出现的模式用 `See Also` 互链。
3. 解决、否决或已固化为规则时，更新 `Status`。
4. 在熟悉的问题领域做大事之前，先翻一遍已有记录。

## 升级规则

学习成果若要变成长久规则：

- 先蒸馏成一两句可执行的话；
- 只有用户明确要求，才写进仓库里的共享规则文档；
- 写回后在条目里注明规则现在落在哪里。

验证过、可移植、不再只属于某个项目的模式，适合抽成独立 Skill。

## 安全边界

- 未经用户明确要求，不改动用户拥有的规则/规范文件。
- 绝不记录密码、访问令牌、私钥、个人隐私数据。
- 不是每个失败都值得记，优先记耐久教训。
- 没有实际验证修复前，不要把条目标成已解决。
