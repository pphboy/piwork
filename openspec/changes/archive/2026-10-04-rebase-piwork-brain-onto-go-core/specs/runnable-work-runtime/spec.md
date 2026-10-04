# Spec Delta

## MODIFIED Requirements

### Requirement: Keep model credentials out of public and persisted conversation data
Core SHALL 解析所选模型配置，将凭据以仅 agentd 进程可访问的只读 secret 挂载到 Work。Agentd SHALL 读取该凭据，但不得复制到 Work 元数据、Session 历史、Run 事件、错误信息或经 Core 返回的诊断。

每 Run 的显式模型 SHALL 由当前代次的 Agent 经既有 mTLS 私有通道请求 Go Core 解析；仅该 Agent 获得执行所需凭据。公共模型列表和历史只含安全模型描述；模型失效、端点变化或 SDK 不支持不能静默回退。

#### Scenario: Start agentd with a model credential
- **WHEN** 已配置 Work 使用可用模型 secret 启动
- **THEN** agentd 可以初始化所选模型，Core 与 CLI 响应只显示非秘密 provider 和模型标识

#### Scenario: Model credential is missing or invalid
- **WHEN** agentd 无法读取或使用所选模型凭据
- **THEN** readiness 或受影响 Run 以不含凭据值的安全模型配置错误失败

#### Scenario: 接受后的模型条件发生变化
- **WHEN** 已接受 Run 需要的模型被禁用或其执行描述已不匹配
- **THEN** 该 Run 安全失败，实际模型快照不被替换，凭据不进入公开输出

### Requirement: Verify the loaded context before routing

**Identifier:** RUNTIME-CONTEXT-001

Core SHALL 在路由 Session/Run 或激活候选之前核验 daemon readiness：预期 Work、runtime generation、instance、受支持 context contract、captured context、配置的 Skill 名称及捕获身份、有效工具策略。报告 SHALL 说明真实完成的 SDK 加载，不回显输入描述冒充加载。校验 SHALL 覆盖创建、Start、Restart、Apply、回退和 Core 恢复后的接管。必需握手字段缺失或版本不支持 SHALL 返回 `AGENT_CONTEXT_INCOMPATIBLE`；context 或实际加载成员错误 SHALL 返回 `AGENT_CONTEXT_MISMATCH`。内部身份 MUST NOT 出现在公开配置或诊断。

握手 SHALL 必需报告 packageContractVersion=1 及实际加载包的名称、内部制品身份和资源/工具来源；即使 packages=[] 也不能省略契约。Core SHALL 按 PKGA-005 验证 enabled 包集合完全匹配 captured context，并区别独立 Skills 与 package Skills。旧握手缺字段返回 AGENT_CONTEXT_INCOMPATIBLE；包成员/内容/工具错误返回 AGENT_CONTEXT_MISMATCH。

Go Core SHALL 同时验证当前 Run model contract=1、Work feedback contract=1 和 history schema=4；即使没有选择脑包或 models 列表为空也不能省略当前契约。Apply 初始化只能验证资源，不得开启自动请求执行；正式 active 当前代次才开放准入。

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

## ADDED Requirements

### Requirement: Go 平台提供 Work 内 Service 交互身份

**Identifier:** RUNTIME-FEEDBACK-001

Go 平台 SHALL 为实际运行且属于当前 Work 的 Service 提供专属投递身份、CA 和 Agent 私网入口；身份 SHALL 绑定当前 Service 实例，不授予 Core 控制权限或其他 Service 的回执访问。有效绑定 SHALL 依据实际容器、网络和已应用定义确认，不以 desired 或历史容器替代当前事实。Service 重启更换身份，移除后撤销；仅 Agent Apply 时仍运行的 Service 无需重新部署便能与新 Agent 交互。

Stop/Delete/Apply SHALL 在受理时关闭新的自动执行准入；初始化 Agent 不处理请求。身份与连接配置属于派生平台材料，不进入环境分享的权限闭包；目标 Work 显式 Start 时重新建立。

#### Scenario: Service 与 Agent 双向交互
- **WHEN** 本版 Work 和 Pi 开发的 Service 就绪
- **THEN** Service 经专属私网身份持久投递事件并读取自己的原请求，Pi 使用当前绑定查询业务 API

#### Scenario: Service 身份更换与越权
- **WHEN** Service 重启后旧身份继续调用，或当前身份请求其他 Service 的回执
- **THEN** 请求被拒绝且不返回跨来源内容，当前合法身份继续可用

#### Scenario: Agent Apply 后继续交互
- **WHEN** Agent 的候选已正式激活，而 Service 实例保持运行
- **THEN** Service 能连接新 Agent 并读原请求，不要求重新部署 Service，不重放既有业务 mutation

#### Scenario: Stop 与新执行竞争
- **WHEN** Stop 已受理而自动循环准备接受 Run
- **THEN** 新 Run 不被接受，原事件和请求保留，实际清理按 Go 生命周期执行
