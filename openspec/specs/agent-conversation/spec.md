# Agent Conversation Specification

## Purpose

定义用户在 Work 内与 agent 交互的持久会话和执行契约，使提交、并发、结果、取消和进程中断都具有稳定身份与可查询状态，并在重新连接或 daemon 替换后保留历史而不重复执行未知副作用。

## Requirements

### Requirement: Persist and restore Work sessions

**Identifier:** CONV-SESSION-001

系统 SHALL 允许 Work 所有者创建、列出、读取和继续 Session，保存与 Work 绑定的稳定 Session ID 和历史。daemon 重启后 SHALL 能按同一 ID 加载已保存历史，不能要求用户仅因进程替换而新建会话。每个 Session SHALL 绑定创建时验证的内部 immutable Work active context identity；公开 Session data MUST NOT expose numeric configuration revisions, Skill import or storage paths, AGENTS host paths, internal digests, or secrets.

#### Scenario: Continue after daemon replacement
- **WHEN** 一个已完成对话的 daemon 被替换，用户继续原 Session
- **THEN** 系统恢复原历史并在同一 Session 接受新 Run

#### Scenario: Restore the same Work context
- **WHEN** a daemon restarts with the same Work-owned active context
- **THEN** the restored Session uses the same copied Skills, AGENTS content, and tool policy without importing Core or host context or exposing a revision

### Requirement: Durably accept idempotent Runs

**Identifier:** CONV-RUN-001

每次提交 SHALL 携带 Session 标识、提交键和可选模型选择；系统 SHALL 在持久接受后返回稳定 Run ID，并支持查询 accepted/running/cancelling/succeeded/failed/cancelled/interrupted 状态。幂等内容 SHALL 包含规范化的 Session、prompt 和请求模型选择语义：省略使用 Session 偏好、显式空值使用 Work 默认、显式模型引用使用该模型。相同键同内容 SHALL 返回原 Run及其实际模型，异内容 SHALL 冲突；重放不得因偏好、catalog 或默认模型后来变化而重新解析或重新执行。自动执行来源由系统产生，调用者不能通过公共提交冒充 Service 来源。

#### Scenario: Retry after lost acknowledgment
- **WHEN** Client 未收到接受响应并用相同提交键重试
- **THEN** 系统返回同一 Run，不再次触发模型或工具执行

#### Scenario: Reuse key with another prompt
- **WHEN** Client 使用既有提交键发送不同 prompt
- **THEN** 系统返回冲突，原 Run 不被修改

#### Scenario: 改变模型后重用提交键
- **WHEN** 调用者对同一提交键改变显式模型选择
- **THEN** 返回冲突，原 Run 的模型、上下文和结果不变

#### Scenario: 模型已经不可用的幂等重放
- **WHEN** 原 Run 已接受后其模型被停用，调用者重放原规范化请求
- **THEN** 返回原 Run，不因重新解析模型而拒绝查询或创建第二次执行

### Requirement: Limit active execution per Work

第一版每个 Work SHALL 最多有一个 accepted/running/cancelling Run，不同 Work 可以并行。不同提交与现有活动 Run 冲突时 SHALL 返回 WORK_BUSY；相同键的幂等重试不受此错误替代。

#### Scenario: Concurrent sessions in one Work

- **WHEN** 两个 Session 同时在同一 Work 提交不同 Run
- **THEN** 最多一个被接受，另一个返回 WORK_BUSY，不进入隐藏队列

#### Scenario: Separate Works run concurrently

- **WHEN** 两个获准 Work 分别提交 Run 且资源允许
- **THEN** 二者可同时执行而不共享活动槽或会话状态

### Requirement: Execution survives observer loss

已接受 Run SHALL 独立于提交和观察连接执行；观察取消、网络中断、用户注销或 Core Gateway 中断 MUST NOT 被隐式解释为 CancelRun。Run 终态及最终结果 SHALL 可通过后续授权查询获得。

#### Scenario: Disconnect during a tool call

- **WHEN** Client 观察连接在工具调用期间断开
- **THEN** Run 继续，重连后用户能查询同一 Run 的结果或仍在执行的状态

### Requirement: Explicit cancellation and terminal consistency

系统 SHALL 提供显式取消；取消请求被接受后，在确认执行及受管任务结束之前 SHALL 保留 cancelling 和活动槽。取消与完成竞争时 SHALL 保留唯一已提交终态，不把已成功结果改写为取消；重复取消终态 Run SHALL 返回既有终态。

#### Scenario: Cancel an active Run

- **WHEN** 用户显式取消正在运行的 Run
- **THEN** 系统请求停止执行，确认停止后记录 cancelled 并释放活动槽

#### Scenario: Completion wins cancellation race

- **WHEN** Run 成功终态先于取消请求持久提交
- **THEN** 取消返回已成功状态，不重复执行、不覆盖结果

### Requirement: Recover interrupted execution conservatively

daemon 启动恢复时 SHALL 将旧进程未终结的 accepted/running/cancelling Run 标记为 interrupted，保留历史及部分结果，不自动重新执行。模型或工具错误 SHALL 形成明确 Run 失败/工具错误，不自动停止 Work。

#### Scenario: Crash after an external side effect

- **WHEN** daemon 在工具已产生外部副作用但尚未提交 Run 终态时崩溃
- **THEN** 恢复后 Run 显示 interrupted，系统不自动重复工具调用，用户可查看已保存历史

#### Scenario: Model unavailable

- **WHEN** 一个 Run 的模型请求失败
- **THEN** 用户可以查询具体失败原因，Work 仍保持可连接以便修复和再次提交

### Requirement: Apply Work context to every Session

**Identifier:** CONV-CONTEXT-001

系统 SHALL 在每个新建或继续的 Session 中使用所属 Work 的 active owned context，包括固定 copied Skills、`AGENTS.md` 内容、base image runtime context 和最终工具策略。Apply 成功后创建的新 Session SHALL 使用新 active context；已接受的 Run SHALL 继续使用开始时的内部 context identity。配置更新、Session history、Run events 和错误响应 MUST NOT expose secrets, host paths, managed-storage paths, internal digests, or configuration revisions.

#### Scenario: New Session sees applied context
- **WHEN** an owner applies desired context containing new Skill and AGENTS content, then creates a Session
- **THEN** the Session uses the new active owned context and public metadata reports configuration state without a revision, file content, path, digest, or secret

#### Scenario: Existing Run keeps its context
- **WHEN** Work configuration is applied while a Run is active
- **THEN** the active Run continues with its original internal context identity and only later Sessions or Runs use the newly active context

#### Scenario: Reject cross-Work context access
- **WHEN** a Session or Run request attempts to use a context identity belonging to another Work
- **THEN** Core or agentd rejects the request without returning the other Work's Skills, AGENTS content, history, or tool policy

### Requirement: Restore private conversation history with scoped identity

**Identifier:** CONV-SNAPSHOT-001

完整包 SHALL 保留 Session/Run 行、全部已保留 events、SDK history 文件、幂等记录和上下文关系，不要求重新对话。导入仅映射结构化 work_id/context_identity 及声明的事件身份字段；Session/Run 局部 ID、时间、文本、工具结果和 SDK 消息树不变。历史控制 Operation 使用新全局 ID 保存为只读历史，不进入执行队列；用户正文中的原 ID 保持原样。

控制历史 SHALL 复用现有 OperationRecord 归档，requestJson/resultJson/errorJson 字符串原样保存，不实现逐 kind 的递归字段迁移；仅新查询身份及归属重新分配。未知历史 kind SHALL 作为标签保留，不能分派执行，也不能仅因没有对应迁移器而丢弃或阻止完整导出。原生 create-work 即使 work_id 为 NULL，也 SHALL 按控制幂等 resourceId 关联纳入。历史控制幂等记录只读归档，源主体匿名化，不恢复源权限或 live 幂等命中。再次导出 SHALL 同时包含已导入和本实例新增的历史。

已终态 Run SHALL 保持终态，导入不执行工具、不调用模型、不重放提交键；非终态历史使包校验失败。Session 继续仍遵循原有 active context 匹配约束：源上可继续的 Session 在相应 active context 导入启动后可继续，源上因旧 context 不匹配而不能继续的 Session 不被静默迁移到新 context。读取与继续均按新 Work 所有者授权。存在受管 sqlite 时，其 schema/path/外键必须验证，不能执行包携带 SQL、触发器或任意宿主路径；active=null 且主文件/WAL/SHM 全部缺席表示尚无私有 Session/Run 历史，导入保持缺席，首次显式 start 按正常路径初始化。

所有者 SHALL 能通过 import-provenance 查询导入包 digest、import Operation ID 和源到目标历史 Operation ID 映射，再用既有 operation show 读取映射后的终态安全投影。此历史查询不触发执行，非所有者管理员也不得读取该 provenance；源用户/平台 secret 信息不在响应中。

最终 MVP SHALL 使用 history schema 4，并完整保留本版模型选择、实际模型、安全执行来源、反馈关联与采用经验版本；新增反馈图及导入历史的执行边界遵守 PWORK-BRAIN-001。平台派生身份不从源环境恢复为 live 权限。

#### Scenario: Continue a copied Session
- **WHEN** 同一个包被导入两份，分别启动并继续其匹配 active context 的同一局部 Session ID
- **THEN** 两份各自从相同历史继续且后续消息独立，源 Session 不增加消息

#### Scenario: Keep a completed tool call historical
- **WHEN** 包内已完成 Run 的历史含发邮件或服务创建记录
- **THEN** import 不重放这些动作，新 Run 只有显式提交才执行

#### Scenario: Reject hostile history metadata
- **WHEN** 私有数据库包含非预期 schema/trigger、错误 Work scope 或指向 /etc 的 SDK history path
- **THEN** 导入整体失败，不把数据库作为可信脚本打开，也不访问该路径

#### Scenario: Preserve an old context mismatch
- **WHEN** 源 Session 绑定旧 context，与当前 active 不一致
- **THEN** 历史保留，导入不隐式改绑或承诺该 Session 可继续

#### Scenario: Preserve an uninitialized empty history
- **WHEN** 未初始化 Work 的 active=null，私有卷没有 Work SQLite 主文件或 sidecar，控制面仍有已完成的 Work 操作历史
- **THEN** 导出导入保留控制历史和空私有会话状态，不制造源会话或拒绝合法包；首次显式启动后再正常创建受管数据库

#### Scenario: Keep native control history without replay
- **WHEN** 一条终态控制历史的 request/result/error 含旧 ID、用户原文或当前没有执行处理器的 kind
- **THEN** 原始记录内容完整保留，导入和再导出均不执行它、不递归替换其内容；查询只返回经过校验的安全投影

#### Scenario: Go 版本恢复反馈及模型历史
- **WHEN** 本版完整包被 Go Core 导入并显式启动
- **THEN** 原 Session/Run、模型描述和反馈关联可查询，旧目标为 historical 且不执行，新目标使用接收方权限

### Requirement: 在同一 Session 为下一次手动 Run 选择模型

**Identifier:** CONV-MODEL-001

获准用户 SHALL 能查询当前 Work 可用的已启用模型安全列表并设置当前 Session 的模型偏好；列表只包含凭据可用、与当前执行环境匹配的模型，不返回 secret 或内部凭据路径。模型列表的加载、空集合、读取失败和已保存偏好不可用 SHALL 分开表达。

用户 SHALL 能保留同一 Session 历史，在下一次手动 Run 使用所选择的模型；选择与实际模型描述 SHALL 持久保存。选择 SHALL 不修改 Work active/desired、不产生 pendingApply、不触发 Apply或改绑 Session context。已接受 Run 的实际模型保持不变，自动处理忽略 Session 偏好而使用 active 默认模型。模型失效或无法解析 SHALL 明确拒绝新执行或形成安全失败，不静默使用其他模型。新 Session 默认使用 Work 默认。

#### Scenario: 保持历史切换模型
- **WHEN** 用户在已有兼容 Session 选择另一可用模型并发送下一条消息
- **THEN** 原历史保留，新 Run 使用该模型并展示实际模型，Work 配置及 pendingApply 不变

#### Scenario: 执行中更改下一次偏好
- **WHEN** 一个 Run 正在执行而用户保存另一个模型偏好
- **THEN** 当前 Run 保持原模型，后续手动 Run 使用新偏好

#### Scenario: 空列表、读取故障与不可用偏好
- **WHEN** 模型查询分别为空、失败或已保存模型不可用
- **THEN** 界面保留草稿，分别显示真实原因；用户可明确选择另一个可用模型或 Work 默认，不能静默替换

### Requirement: 自动执行与业务目标有可追溯来源

**Identifier:** CONV-SOURCE-001

系统 SHALL 在现有 Session/Run 历史中标明手动提交或 Service 请求来源，自动 Run SHALL 关联适用的来源 Service、原请求、处理阶段、实际模型和采用的经验版本。自动执行 SHALL 使用兼容 active context 的自动 Session，不插入或改写用户当前 Session 的 prompt；context 改变时创建新的兼容自动 Session并保留关联，旧 Session不静默改绑。

Run 终态与业务目标状态 SHALL 分开查询：等待 Job/Apply 时，结束的 Run 可以 succeeded，而原目标仍 waiting_result/waiting_apply。所有者可查询原请求并按 WAF-007 取消未完成的自动处理，仍保持现有 Run 取消、单槽和观察断线契约。公共元数据不得包含内部 context identity、secret、宿主路径或制品 digest。

用户 Chat 发起并需要等待/采用续接的目标 SHALL 保留 chat 来源及原 Run 关联；其后续自动验证同样遵循单槽、模型、期限和证据规则，没有来源 Service 时不得伪造 Service 身份。

#### Scenario: 从 Service 请求查看执行
- **WHEN** 所有者打开自动处理记录
- **THEN** 可以进入真实 Session/Run，看到来源、阶段和实际模型；当前用户 Session 及草稿不被替换

#### Scenario: Apply 后继续验证原目标
- **WHEN** 脑包 Apply 改变 active context 且原请求等待采用验证
- **THEN** 系统使用新兼容自动 Session 继续原目标，旧 Session 历史保留且不改绑
