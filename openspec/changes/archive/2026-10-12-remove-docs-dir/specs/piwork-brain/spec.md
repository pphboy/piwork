# Piwork Brain 规格变更

## MODIFIED Requirements

### Requirement: 保持 Founder 控制的简洁架构不变量

**Identifier:** BRN-007

项目 SHALL 在本 Spec 的 BRN-007 中直接保留 Mark 已授权的初始架构决策，不依赖独立开发文档。初始 Baseline 版本为 1.0.0，来源为「Piwork-brain 架构简化与独立 Memory 重构」变更中 Mark 给出的八项不变量：

| 决策 | 不变量 |
| --- | --- |
| B01 | 最少用户干预；普通产品任务没有额外 Spec / Plan / Eval 审批步骤。 |
| B02 | 最短有效执行路径；优先使用既有能力，需要开发时才进入开发。 |
| B03 | Spec-first Service Construction；创建或修改持久 Service 前形成必要 Spec。 |
| B04 | Agent-operable Service；核心 UI 与 Agent 能力共用权威业务状态。 |
| B05 | Verified Outcomes；完成宣称来自实际业务、测试与 Evidence。 |
| B06 | Independent Memory；认知独立于 Brain 软件、Service 与业务状态，正常学习不触发 Prepare / Apply。 |
| B07 | Minimum Sufficient Harness；复用 Go Core、Pi SDK 和现有 Runtime / BrainFlow / BrainLoop，不新增无关引擎。 |
| B08 | 可观测性不得改变 Agent 执行语义；查询可信事实，不由 UI / CLI 创建另一套执行状态。 |

初始材料及对应测试/验收来源 SHALL 保留为 `simplify-piwork-brain-and-extract-work-memory` 的变更附件，当前约束由本 Spec 承载，演化用 Git 历史追踪，不新增管理后台或版本控制系统。迁移 SHALL 保留原授权、版本和事实，不将仓库开发文档治理规则解释为产品 Work 的新审批机制。

Agent SHALL 不因学习、代码简化或失败测试自行改写已批准决策；未来决策修改须 Mark 授权，普通实现选择不增加人工审批步骤。认知里的可复用规则属于 Memory，Service 设计事实属于 Service Spec，固定权限与架构不变量不能由 Memory 改写。文件规则与 Git 历史本身不得被宣称为已强制执行的身份审批隔离。

#### Scenario: 初始 Baseline 与日常学习
- **WHEN** 建立本次初始 Baseline 后，一个 Work 提交新的认知
- **THEN** 本 Spec 的不变量和初始来源附件保持 Mark 已给定决策，学习不修改 Baseline 或脑包，版本及 Git 变更可查

#### Scenario: Agent 提出改变架构边界
- **WHEN** Agent 认为需要改变已批准不变量
- **THEN** 提出建议并等待 Mark 的决策，不为使实现或测试通过直接改写 Baseline

#### Scenario: 移除独立 Baseline 文档
- **WHEN** 根 `docs/` 及旧 Baseline 路径被移除
- **THEN** 八项不变量可直接在 BRN-007 查询，原始版本、授权来源和证据可从对应变更附件及 Git 历史追溯，不改变现行产品执行语义
