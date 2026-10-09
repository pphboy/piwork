# Piwork-brain Baseline

版本：1.0.0。Owner：Mark（`@pphboy`）。初始来源：Mark 在本次「Piwork-brain 架构简化与独立 Memory 重构」任务中明确给出的八项不变量。

本文件记录已给定的架构决策。具体实现与实际验收结果分别在当前源码、OpenSpec 变更和验收记录中；测试路径存在不代表测试已经通过。

| 决策 | 不变量 |
| --- | --- |
| B01 | 最少用户干预；普通任务没有额外 Spec / Plan / Eval 审批步骤。 |
| B02 | 最短有效执行路径；使用既有能力完成操作，需要开发时才进入开发。 |
| B03 | Spec-first Service Construction；创建或修改持久 Service 前形成必要 Spec。 |
| B04 | Agent-operable Service；核心 UI 与 Agent 能力共用权威业务状态。 |
| B05 | Verified Outcomes；完成宣称来自实际业务、测试与 Evidence。 |
| B06 | Independent Memory；认知独立于 Brain 软件、Service 与业务状态，正常学习不触发 Prepare / Apply。 |
| B07 | Minimum Sufficient Harness；复用 Go Core、Pi SDK、现有 Runtime/BrainFlow/BrainLoop，不新增无关引擎。 |
| B08 | 可观测性不得改变 Agent 执行语义；用户和 Agent 查询现有可信事实，不由 UI/CLI 创建另一套执行状态。 |

未来改变上述不变量须 Mark 授权并留下对应 Git Review/commit 与验收依据；Agent 可以提出建议，不能因学习或测试失败直接改写决策。普通实现选择按已授权任务执行，不增加 Founder 审批环节。

认知规则随 Memory 修正，Service 设计随 `SPEC.md` 修改，Brain Core/Extension/Skill 通过正式 Package Prepare / 显式 Apply / 实际行为验收更新。它们都不能隐式更改本 Baseline。

测试映射：Memory 的 T01–T06 见 [本次 tasks](../../openspec/changes/archive/2026-10-09-simplify-piwork-brain-and-extract-work-memory/tasks.md)；基础存储/来源验证见 [Memory tests](../../packages/work-store/src/memory.test.ts)、[历史验证](../../internal/workhistory/memory_test.go)；真实运行路径见 [工作站集成测试](../../internal/coreapp/brain_workstation_integration_test.go)。验收状态必须查看实际记录。

查询版本与演化：`git log -- docs/piwork-brain/BASELINE.md`、`git show <commit>:docs/piwork-brain/BASELINE.md` 和普通 Git diff。不实现历史管理后台。

Markdown 规则与 Git 历史不提供强身份隔离。本次不声称已配置 GitHub 强制 Code Owner Review、禁止绕过或独立 Agent 身份；其是否生效需要单独核对真实权限。
