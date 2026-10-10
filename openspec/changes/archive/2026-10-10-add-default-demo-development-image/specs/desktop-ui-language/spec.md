# Spec Delta

## MODIFIED Requirements

### Requirement: 脑包与反馈沿用现有产品任务语言

**Identifier:** DUL-BRAIN-001

Desktop SHALL 使用现有 Work、Service、Session、Run、Operation、Pi Package 对象和 English 产品标签，表达模型选择、处理记录、证据、候选 Saved / Not applied / Loaded 以及行为验证结果；实现中用于鉴权、代次、RPC、哈希和凭证的细节 SHALL 不成为普通用户的必经决策。业务证据与经验采纳 SHALL 有清晰结果与来源，Service 状态、包加载、请求完成之间不得互相代替。

目标场景 SHALL 是用户从 Work 模板创建个人工作站并让 Pi 开发和改进服务，例如 Todo、Kanban、日记或个人复盘。默认工作站示例 SHALL 采用 FastAPI + React + TypeScript + Vite 基础环境证明该闭环；此默认选择不成为其他 Service 的平台强制技术栈。保留现有 UI 的 Apply 独立步骤、故障如实呈现与导入导出分步流程；不为示例增加新的顶层产品结构。

#### Scenario: 候选失败能够定位结果
- **WHEN** 脑包已经 Loaded 但实际行为验证失败
- **THEN** 用户看到包加载成功和行为验证失败各自状态、原因与证据，不被告知更新已完成或业务效果已自动撤销

#### Scenario: 工作站技术栈变化
- **WHEN** 用户开发的 Service 使用示例以外的语言或 UI 框架
- **THEN** 相同交互与反馈契约仍可接入，Desktop 不要求选择默认基础镜像或特定技术栈才能创建或使用该服务
