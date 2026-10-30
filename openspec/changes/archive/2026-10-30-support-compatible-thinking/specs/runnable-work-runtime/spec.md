# Spec Delta

## MODIFIED Requirements


### Requirement: Verify the loaded context before routing

**Identifier:** RUNTIME-CONTEXT-001

Core SHALL 在路由 Session/Run 或激活候选之前核验 daemon readiness：预期 Work、runtime generation、instance、受支持 context contract、captured context、配置的 Skill 名称及捕获身份、有效工具策略。报告 SHALL 说明真实完成的 SDK 加载，不回显输入描述冒充加载。校验 SHALL 覆盖创建、Start、Restart、Apply、回退和 Core 恢复后的接管。必需握手字段缺失或版本不支持 SHALL 返回 `AGENT_CONTEXT_INCOMPATIBLE`；context 或实际加载成员错误 SHALL 返回 `AGENT_CONTEXT_MISMATCH`。内部身份 MUST NOT 出现在公开配置或诊断。

握手 SHALL 必需报告 packageContractVersion=1 及实际加载包的名称、内部制品身份和资源/工具来源；即使 packages=[] 也不能省略契约。Core SHALL 按 PKGA-005 验证 enabled 包集合完全匹配 captured context，并区别独立 Skills 与 package Skills。旧握手缺字段返回 AGENT_CONTEXT_INCOMPATIBLE；包成员/内容/工具错误返回 AGENT_CONTEXT_MISMATCH。

Go Core SHALL 同时验证当前 Run model contract=1、Work feedback contract=1 和 history schema 与固定 Agent 的精确受支持声明一致（4、5、6 或 7）；即使没有选择脑包或 models 列表为空也不能省略当前契约。Apply 初始化只能验证资源，不得开启自动请求执行；正式 active 当前代次才开放准入。


本变更新 Agent 使用 history schema 7，Core 仍识别已知 schema 4/5/6 的固定旧 Agent，并根据镜像真实能力与受控升级结果核对版本；不把不匹配的 Agent 视为 ready。

#### Scenario: Verify the expected copied Skills
- **WHEN** 当前 daemon 报告预期 context，且成功加载的 Skill 身份及工具与配置完全匹配
- **THEN** Core 可以完成该 context 的 readiness 并发布安全的运行 Skill 状态

#### Scenario: Reject stale or incomplete readiness
- **WHEN** daemon 声称 ready，但 context、Work、generation、捕获身份不匹配，或 Skill 缺失、额外、重复
- **THEN** Core 不路由或激活该 daemon，并记录稳定的 mismatch 诊断

#### Scenario: Reject an old agent protocol
- **WHEN** agent 镜像省略 context 握手或声明不支持的契约
- **THEN** Operation 返回 `AGENT_CONTEXT_INCOMPATIBLE` 并说明应部署契约匹配的 Core/agentd，Work 不成为 ready

#### Scenario: Re-adopt after Core restart
- **WHEN** Core 重启后发现已有受管标签的容器
- **THEN** Core 先核验实际挂载 context 与完整当前握手才接管加载状态，不仅凭标签或缓存 ready 放行

#### Scenario: Reject a stale package identity
- **WHEN** 名称和 version 相同但 agent 实际加载包 bytes 与 captured context 不同
- **THEN** Core 不发布 ready、路由或 active，记录安全 context mismatch

#### Scenario: Do not infer support from an empty package list
- **WHEN** 旧 agent 没有 packageContractVersion 且 Work 没有 package
- **THEN** 握手仍失败，不能把 protobuf 缺省值当作支持

#### Scenario: 不完整的当前反馈握手
- **WHEN** 候选或被恢复容器缺少任一当前模型、反馈或历史契约
- **THEN** Go Core 拒绝 ready 与路由，返回安全不兼容诊断，不通过兼容入口或字段缺省放行

#### Scenario: 环境更新不使历史会话失效
- **WHEN** Work 应用新 active context 并替换 Agent，用户继续同一历史 Session
- **THEN** 资源加载器、AGENTS 和最终工具策略来自新 Run 固定的 active context，历史作为对话上下文保留，不按镜像版本或旧 Session context 增加例外规则

### Requirement: Execute Runs through the real Pi SDK

**Identifier:** RUNTIME-PI-001

Agentd SHALL durably accept a prompt and submission key, execute the Run with the configured model through the Pi SDK, persist ordered mapped events and a unique terminal state, and save the resulting Session history. A client or Core observation disconnect MUST NOT abort execution; explicit cancellation MUST request SDK abort and persist the resulting state. Each Session SHALL be constructed with the active Work-owned resource loader, including every file in its copied Skills, its AGENTS content, and its resolved tool policy.

每个 SDK session SHALL 获得独立的 package-aware resource runtime，按 PKGA-004 绑定 headless extension 事件，加载所绑定 context 的 enabled 包。工具实现与资源发现必须走真实 SDK，不能用 readiness 回显或 fixture 手写响应代替。Session SHALL 不再绑定创建时环境；每个 Run 固定受理时 active context，同一 Session 跨环境的历史不改写，不按镜像版本判断继续资格。

#### Scenario: Receive a deterministic acceptance reply through the real stack
- **WHEN** the acceptance fixture submits a prompt to a real agentd container configured with the deterministic model
- **THEN** the real Pi SDK executes it, agentd persists its events and result, and the CLI receives the expected assistant text through Core

#### Scenario: Use a real configured model
- **WHEN** the optional smoke is enabled with valid provider credentials and a user submits a prompt
- **THEN** agentd executes the Run through the configured real Pi SDK model and returns a non-empty assistant result

#### Scenario: Load complete Skill directories from the Work
- **WHEN** a Run uses a Skill whose instructions reference a copied script, reference, or template below that Skill directory
- **THEN** the Pi SDK resource loader exposes that Work-owned file and does not resolve it through a Core or host path

#### Scenario: Isolate Session context
- **WHEN** a Run starts for a Work with active Skills and AGENTS content
- **THEN** the Pi SDK exposes exactly that Work context and cannot load another Work, Core-managed source content, host user Skills, or pending desired content

#### Scenario: Session context is loaded from the Work
- **WHEN** a Session is created or restored for a ready Work
- **THEN** its Pi SDK resource loader reads the Work-owned active Skills and AGENTS content rather than resolving a Core or host source

#### Scenario: Retry a lost submit response
- **WHEN** Core repeats the same Session, submission key, and prompt after losing the first response
- **THEN** agentd returns the original Run and does not invoke the model a second time

#### Scenario: Execute package functionality in the real SDK
- **WHEN** deterministic model fixture 请求一个已授权包工具并读取包内 supporting file
- **THEN** 真实 SDK 调用包工具并读取 Work 自有文件，结果能区分包版本，持久 Run history 包含实际结果
