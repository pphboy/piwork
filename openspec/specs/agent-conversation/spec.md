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

每次提交 SHALL 携带 Session 标识、提交键和可选模型选择；系统 SHALL 在持久接受后返回稳定 Run ID，并支持查询 accepted/running/cancelling/succeeded/failed/cancelled/interrupted 状态。幂等内容 SHALL 包含规范化的 Session、prompt 和请求模型选择语义：省略使用 Session 偏好、显式空值使用 Work 默认、显式模型引用使用该模型。相同键同内容 SHALL 返回原 Run及其实际模型与 Thinking，异内容 SHALL 冲突；重放不得因偏好、catalog 或默认模型后来变化而重新解析或重新执行。自动执行来源由系统产生，调用者不能通过公共提交冒充 Service 来源。

新调用者 SHALL 能明确区分字面文本与资源命令输入；相同提交键改变显式输入模式 SHALL 冲突，输入模式一经受理不得因重连或界面选择而变化。未携带新模式的旧请求 SHALL 保持原幂等摘要与原输入解释，不因新增默认字段使旧提交失去幂等命中；新 Desktop 的普通输入及 Send as text SHALL 使用明确字面模式。

新 Run SHALL 在持久受理时捕获同一组实际模型和有效 Thinking，执行只使用该组快照，不在执行或重放时重读 Session 设置。Session 偏好是受理参数来源，不是幂等请求内容的可变部分；相同原请求在偏好、Thinking 或命令目录变化后重放，SHALL 先返回原 Run，不重新检查新目录或重新执行。资源命令校验失败 SHALL 不受理新的模型/工具执行；已受理后的资源或能力错误 SHALL 形成原 Run 的可查失败，不静默改成文字、另一命令或另一模型。
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

#### Scenario: 改变输入模式重用提交键
- **WHEN** 调用者用同一提交键将 /foo 从明确字面文本改为资源命令
- **THEN** 返回冲突，原 Run 不改变、不产生第二次执行

#### Scenario: 旧请求和设置变化后的重放
- **WHEN** 原请求未携带新模式，或新请求接受后 Thinking 与命令目录已变化，调用者按原请求重放
- **THEN** 原摘要仍命中同一 Run，返回原实际设置与结果，不重新解析当前能力

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

系统 SHALL 完整保留 schema 4 的现有模型选择、实际模型、安全执行来源、反馈关联与采用经验版本；新 harness 使用 history schema 5，并额外保存独立 Memory 绑定与新 Run 实际提供的 entryId/截断信息。已知 schema 4 的导入按原格式静态校验并保留固定运行镜像，不在导入时升级；采用新 harness 的受控迁移遵守 WMEM-005。新增反馈图及导入历史的执行边界遵守 PWORK-BRAIN-001。平台派生身份不从源环境恢复为 live 权限。

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

#### Scenario: 两种已知格式保留采用事实
- **WHEN** 分别导入合法 schema 4 历史或 schema 5 与 Memory schema 1 的历史
- **THEN** 旧版本号不改写成新 head，新 Run 的实际提供条目引用保持，均不恢复旧请求的执行权限或替换固定 agent 镜像

### Requirement: 在同一 Session 为下一次手动 Run 选择模型

**Identifier:** CONV-MODEL-001

获准用户 SHALL 能查询当前 Work 可用的已启用模型安全列表并设置当前 Session 的模型偏好；列表只包含凭据可用、与当前执行环境匹配的模型，不返回 secret 或内部凭据路径。模型列表的加载、空集合、读取失败和已保存偏好不可用 SHALL 分开表达。

用户 SHALL 能保留同一 Session 历史，在下一次手动 Run 使用所选择的模型；选择与实际模型描述 SHALL 持久保存。选择 SHALL 不修改 Work active/desired、不产生 pendingApply、不触发 Apply或改绑 Session context。已接受 Run 的实际模型保持不变，自动处理忽略 Session 偏好而使用 active 默认模型。模型失效或无法解析 SHALL 明确拒绝新执行或形成安全失败，不静默使用其他模型。新 Session 默认使用 Work 默认。

系统 SHALL 提供每个可用模型及 Work 默认的真实 Thinking 可选档位与默认建议值，并允许将模型选择和 Thinking 作为完整设置对原子读写。无模型覆盖但 Work 默认有效不构成聊天不可用。不支持 Thinking 的模型只允许 Off；其他模型只允许当前执行环境确认的档位，未知档位、不可用模型和不兼容设置 SHALL 明确拒绝且不部分保存。读取 SHALL 区分已保存偏好与其当前可用性，不为修复读取自动覆盖设置。

完整设置对 SHALL 只作用于下一次新手动 Run。已有模型专用入口保持兼容，并保留原 Thinking；新模型不支持原档位时明确拒绝，不能静默清除 Thinking。自动 Run SHALL 使用 active 默认模型及与旧执行行为一致的默认 Thinking，不继承用户 Session 设置。执行初始化后 SHALL 与受理快照的有效值一致，SDK 自动调整或模型变化不得导致公开实际值和执行值不一致。

Session 中尚无 Thinking 的旧记录 SHALL 按旧 Off 偏好读取；模型实际不接受 Off 时明确显示不兼容，要求选择可用设置才接受新手动 Run。旧 Run 未保存 Thinking 的历史 SHALL 标为旧行为 Off，不根据当前模型能力改写。新 Desktop 初始草稿使用默认模型的已确认建议档位，并在显式创建/发送流程中确认完整设置，不静默更新旧 Session。
模型及 Thinking 能力 SHALL 以固定 Pi SDK 在实际执行环境中解析的模型定义为准，模型同时满足 Core 已启用/凭据准入；SDK 全目录不代表已获执行权限。能力查询、偏好校验与执行 SHALL 使用一致解析结果，兼容注册不得丢弃 SDK 已确认的 reasoning、档位及映射。能力未知 SHALL 给出能力未确认及恢复方向，不能伪造 Off 或通用档位；真正不支持 Thinking 的已确认模型仍仅允许 Off。

已确认 Thinking SHALL 实际作用于模型请求，允许关闭的模型使用 Off 时明确关闭，不能仅记录本地字段却依赖 Provider 的另一默认值。SDK 实际值、受理记录与请求语义一致，不公开推理原文或新增凭据/路径投影。

#### Scenario: 保持历史切换模型
- **WHEN** 用户在已有兼容 Session 选择另一可用模型并发送下一条消息
- **THEN** 原历史保留，新 Run 使用该模型并展示实际模型，Work 配置及 pendingApply 不变

#### Scenario: 执行中更改下一次偏好
- **WHEN** 一个 Run 正在执行而用户保存另一个模型偏好
- **THEN** 当前 Run 保持原模型，后续手动 Run 使用新偏好

#### Scenario: 空列表、读取故障与不可用偏好
- **WHEN** 模型查询分别为空、失败或已保存模型不可用
- **THEN** 界面保留草稿，分别显示真实原因；用户可明确选择另一个可用模型或 Work 默认，不能静默替换

#### Scenario: 不支持的 Thinking 原子拒绝
- **WHEN** 调用者提交可用模型和该模型不支持的 Thinking
- **THEN** 明确拒绝，原模型与 Thinking 都不改变，不能仅保存模型

#### Scenario: 保存与受理交错
- **WHEN** 完整设置保存和新手动 Run 受理交错
- **THEN** Run 捕获一组完整旧值或完整新值，不能混配；已受理执行不随后续保存变化

#### Scenario: 默认模型和旧记录
- **WHEN** 覆盖列表为空但默认模型可用，或读取没有 Thinking 的旧 Session/Run
- **THEN** 默认仍可使用，旧记录按 Off 解释；不兼容的 Session 设置要求明确修复，旧 Run 事实不改写

#### Scenario: SDK 已知兼容模型的 Thinking
- **WHEN** 已获准的兼容端点模型在固定 SDK 中已有 reasoning 与档位定义
- **THEN** 能力查询保留该 SDK 支持档位，设置与执行使用同一模型，不因兼容注册固定为非 reasoning

#### Scenario: Thinking 选择影响真实请求
- **WHEN** 用户分别选择当前模型支持的 Off 和非 Off 档位并明确发送
- **THEN** 每次新 Run 的记录、SDK 实际值与请求语义一致，Off 明确关闭，其他档位按 SDK 映射生效，既有 Run 不变

#### Scenario: 能力未知与不支持区分
- **WHEN** 一个模型的能力无法确认，另一个被 SDK 明确确认不支持 Thinking
- **THEN** 前者显示能力未确认并拒绝依赖它的新设置，后者明确仅支持 Off，不能都返回假 Off 成功

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

### Requirement: 新聊天能力可被安全发现并独立降级

**Identifier:** CONV-CHAT-CAPABILITY-001

获准调用者 SHALL 能确认当前 Work 是否支持基础命令、模型 Thinking 能力、完整 Session 设置和结构化工具历史；新能力是可选的增量契约，不能使原本满足现有运行契约的旧 Agent 失去基本聊天或 Service 准入。缺少能力确认 SHALL 明确返回不支持，不能伪造空目录、Off 已保存或成功响应，也不能自动替换固定镜像。

所有新增读取与修改 SHALL 沿用 Work 所有者授权、交互范围、active context、实际运行实例和 Session 归属规则；模型设置修改只对可继续的 Session 有效，历史读取保持原只读资格。旧实例/旧身份的晚响应不能归属新对象。公开目录、能力、设置和历史 SHALL 不返回宿主路径、凭据路径、密钥、内部 context identity 或配置修订。

#### Scenario: 旧 Agent 正常聊天
- **WHEN** Work 的固定 Agent 支持原聊天但未声明新能力
- **THEN** 原聊天、模型入口和 Service 访问仍按原能力可用，新功能明确显示不可用，不尝试升级镜像

#### Scenario: 越权及实例变化
- **WHEN** 非所有者读取命令或修改设置，或请求期间 active 实例被替换
- **THEN** 按原授权或实例规则拒绝，不泄露新旧对象私有信息，不接受旧实例返回值为新实例事实

### Requirement: 资源命令只执行已确认 active 资源

**Identifier:** CONV-COMMAND-001

系统 SHALL 为当前 Work 提供已验证 active Skill 与 Prompt Template 的安全命令目录，包含类型、命令名、简短说明和可公开来源名称。目录 SHALL 不包含未 Apply 的 desired、宿主 ambient 资源、未启用包、任意扩展命令或终端内建动作；查询不创建 Session/Run、不加载新扩展或触发业务副作用。网页保留的五个命令名不能被资源覆盖，与已加载扩展命令冲突的模板不作为可执行资源提供。

明确资源命令模式 SHALL 在新受理前确认当前 Session 可继续、命令存在于对应 active 目录且不是扩展命令；执行前再次确认其实际加载资源。参数只来自原输入，按当前 Pi 的 Skill/模板语义展开一次并交给同一 Run，不能运行网页动作或偷偷降级成字面输入。未知命令、资源不可读、资源冲突、context 不匹配与能力不支持 SHALL 给出不同的可理解拒绝/失败；失败不把上一轮 assistant 消息当本轮答案。

明确字面模式 SHALL 不解释 slash 为模板、Skill 或扩展命令，包括 Send as text。未显式使用新模式的旧调用者保持原解释与幂等兼容。已经接受的合法资源命令 SHALL 沿用单 Work 单活跃 Run、取消、事件观察与原提交键恢复，不绕过这些约束。

#### Scenario: 使用已加载资源
- **WHEN** 获准用户提交当前 active 中的 /skill:name 或模板命令及参数
- **THEN** 同一 Session 接受一个 Run，按该资源语义展开，模型和工具状态可按原身份查询

#### Scenario: desired 与不可执行资源
- **WHEN** 资源只安装到 desired 尚未 Apply，或其名称由网页命令/不支持的扩展占用
- **THEN** 不作为资源命令开放，不执行该扩展，用户收到明确原因而非普通聊天结果

#### Scenario: 字面 slash 与未知命令
- **WHEN** 用户明确按字面发送 /foo，或以资源命令提交不存在的 /foo
- **THEN** 前者原样传给模型且不展开，后者拒绝新的执行并保留可理解错误

#### Scenario: 执行资源失效
- **WHEN** 合法命令接受后实际资源校验失败或没有产生新的 assistant 回复
- **THEN** 原 Run 安全失败并可查询，不使用原 Session 的旧答案，不另发普通 prompt

### Requirement: 持久工具历史提供可合并的安全内容顺序

**Identifier:** CONV-TOOL-HISTORY-001

Session 历史 SHALL 在保留原文本接口的基础上提供稳定消息身份、顺序化正文/工具块、工具调用 ID、工具名、可取得结果、明确错误标志及可确认的所属 Run。投影 SHALL 只关联同一 Work/Session 的真实 Run；工具开始与结果按调用身份关联，不能仅靠名称或时间猜测。工具参数全集、原始 Thinking、模型凭据和内部路径不作为新增元数据公开。输出文字属于用户历史，保持其原文并安全呈现，不为提取元数据改写原 SDK 文件或删改正文。

新执行 SHALL 留下足以在重新连接、daemon 替换和完整包导入后确认 Run/工具关联的历史。事件重放和 Session 读取 SHALL 能合并同一调用；没有结束事实的调用保持未确认，未保存结果不得编造。旧历史仅有文本或缺关联时 SHALL 仍可读，提供局部稳定身份和真实可取得字段，关联未知保持未知。

公开结果文本 SHALL 以每个工具结果最多 64 KiB 的有界投影返回，并标明截断、非文本或结果不可取得；私有原始 SDK history 和导出内容不因此裁剪。没有工具的消息保持普通正文，没有新增空工具占位。

#### Scenario: 重连和历史读取一致
- **WHEN** 工具开始和结束已经保存，观察重连后又读取同一 Session
- **THEN** 同一调用可由相同身份合并，正文与结果保持原顺序，不制造重复执行项

#### Scenario: 旧历史缺少身份
- **WHEN** 读取仅包含旧文本或无法确认所属 Run 的工具结果
- **THEN** 原内容仍可读，未知关联不被推测为某一 Run，不影响继续查询

#### Scenario: 大结果与恶意标记
- **WHEN** 工具返回超长文本、非文本内容，或历史含指向其他 Session Run 的关联
- **THEN** 公开投影有真实截断/类型说明且不泄露其他对象，私有历史仍完整保留

### Requirement: 新聊天设置保持现有完整包格式与安全恢复

**Identifier:** CONV-CHAT-HISTORY-001

新增 Session Thinking、Run 实际 Thinking 和输入解释模式 SHALL 随原模型选择、实际模型、幂等记录及 SDK history 持久保存，daemon 重启和完整包导出导入后保持同一含义。系统 SHALL 继续使用 history schema 4、storage layout 2 和 .work formatVersion 1，不新增历史迁移、自动回放或 SQL 执行入口；可选结构化字段缺省按前述旧行为解释，未知字段和非法值仍拒绝。

导入后保持原 Session/Run 局部身份、工具历史和终态，按原 Work/context 映射恢复，只在接收方权限与原继续约束下接受新执行。已有 SQL/schema/path/外键、非终态历史拒绝、空历史及历史控制操作只读归档规则继续适用；新字段不能扩大 live 权限或作为隐式创建、调用模型和工具的依据。

#### Scenario: 新设置完整包往返
- **WHEN** 包含模型/Thinking、资源命令 Run 和工具历史的终态 Work 完成导出、导入、再导出
- **THEN** 新字段、原幂等及工具关联保持，未执行任何历史命令或工具，导入后显式新提交才执行

#### Scenario: 旧包与非法设置
- **WHEN** 导入合法 schema 4 包缺少新字段，或包带有非法 Thinking/输入模式
- **THEN** 前者按旧行为读取并保留原历史，后者校验失败，不执行迁移或以猜测值修复

### Requirement: 未知创建和提交可按原键只读核对

**Identifier:** CONV-SUBMISSION-001

获准调用者 SHALL 能在发起 Session 创建或 Run 提交前保留稳定的原键，并在接受响应丢失时通过只读查询取得该 Work 下原键对应的 Session 或 Run。查询 SHALL 只返回原持久映射与安全对象，不创建、不重提或重新解析 prompt；不能用同 Work 的其他 Session/Run 或仅有相近时间的记录解除未知状态。

查询未找到映射但原请求仍可能完成时 SHALL 表示尚未确认，不能推定未写入并自动重发；读取失败、身份变化和运行不可达保持未知与输入。找到映射后 SHALL 以原 Session/Run 身份继续设置确认或观察，不自动发送先前尚未受理的消息。旧客户端未提供新键时保持原接口行为，不取消既有幂等记录。

#### Scenario: 创建接受响应丢失
- **WHEN** 创建已经持久写入但接受响应丢失，用户按原创建键查询
- **THEN** 返回原 Session 并可明确选择继续，没有第二次创建或自动模型提交

#### Scenario: Run 接受未知与尚未找到映射
- **WHEN** 用户按原提交键查询已受理的 Run，或查询时原请求尚未持久完成
- **THEN** 分别返回同一 Run 供继续观察，或保持尚未确认；不把其他 Run 当作接受事实，不自动重发

### Requirement: 记录固定 Memory 版本及实际提供内容

**Identifier:** CONV-MEMORY-001

新 Run SHALL 在持久受理时记录 WMEM-004 的固定 Memory 版本、初始提供 entryId 集合及截断信息，实际 SDK 初始化使用该内容，幂等重放不重新检索。既有公开 adoptedExperienceVersion 字段 SHALL 继续表示该版本，不另建含同一含义的平行版本字段；旧历史没有提供条目明细时明确未知，不能补造已阅读事实。脑包未启用或内容未提供时不能宣称已采用。

既有 UI / CLI 的 Run 与工具记录 SHALL 能查证版本和 Memory 操作的实际结果；当前有效 head 和某个 Run 已采用版本 SHALL 分开显示。历史读取 SHALL 继续按当前 Work 权限执行；只读查询、观察断开和 Memory 提交不改变 Run 单槽、模型、取消、等待与恢复规则。

#### Scenario: UI CLI 与 SDK 一致
- **WHEN** 新 Run 提供一组相关 Memory 并执行一次 recall 或提交
- **THEN** SDK 上下文、持久 Run 版本、真实工具结果以及 UI / CLI 可见版本一致，提交 effectiveVersion 的推进不改写当前 adoptedExperienceVersion

#### Scenario: 幂等重放不重新采用
- **WHEN** Memory head 已更新后重放原 Run 提交键
- **THEN** 返回原 Run、版本与初始提供集合，不重新读新规则或再次执行

#### Scenario: 旧记录未知与禁用脑包
- **WHEN** 查看迁移前没有提供明细的 Run，或当前 Run 未启用脑包
- **THEN** 前者保留原版本且明细标为未知，后者不注入 Memory 也不伪造采用；两者均不改变既有 Session context
