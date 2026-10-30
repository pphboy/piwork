# Agent Conversation Specification

## Purpose

定义用户在 Work 内与 agent 交互的持久会话和执行契约，使提交、并发、结果、取消和进程中断都具有稳定身份与可查询状态，并在重新连接或 daemon 替换后保留历史而不重复执行未知副作用。

## Requirements

### Requirement: Persist and restore Work sessions

**Identifier:** CONV-SESSION-001

系统 SHALL 让 Session 属于同一 Work 并保留稳定 ID、SDK 历史和用户偏好。Session SHALL NOT 绑定创建时的运行环境作为继续条件。每个新 Run SHALL 使用受理时已验证的 Work active context，并固定到该 Run；原 Run 的执行环境、结果、幂等记录和 Memory 引用 SHALL 保持。跨 Work 请求仍拒绝。

#### Scenario: Continue after daemon replacement
- **WHEN** 一个已完成对话的 daemon 被替换，用户继续原 Session
- **THEN** 系统恢复原历史并在同一 Session 接受新 Run，Run 固定受理时 active context

#### Scenario: Restore the same Work context
- **WHEN** a daemon restarts with the same Work-owned active context
- **THEN** the restored Session uses that Work-owned resource loader and tool policy without importing Core or host context or exposing a revision

#### Scenario: 同一会话跨环境继续
- **WHEN** 用户更新并 Apply 镜像、Skills、包、AGENTS、MCP 或工具配置后，在原 Session 明确发送新消息
- **THEN** 同一 Session ID 保留原历史，新 Run 使用当前 active 配置；旧 Run 保持原环境事实，不新增 Session、不重放旧调用、不恢复已移除工具权限

#### Scenario: 图片历史跨环境恢复
- **WHEN** 已受理的图片输入未写入 SDK 即中断，随后 active 环境变化，用户在同一 Session 明确发送新消息
- **THEN** 按原 Work/Session/Run 身份及输入摘要验证后作为上下文恢复，旧 Run 保持 interrupted；环境变化本身不判为历史损坏，不执行旧模型或工具

#### Scenario: 升级与离线导入后的续聊
- **WHEN** 原会话经受管升级、重启或完整包导出导入后启动
- **THEN** 原 Session ID 和历史保留，新提交按目标 Work active 环境执行，旧 Run context 仅作历史事实映射，读取和启动不触发执行

### Requirement: Durably accept idempotent Runs

**Identifier:** CONV-RUN-001

每次提交 SHALL 携带 Session 标识、提交键和可选模型选择；系统 SHALL 在持久接受后返回稳定 Run ID，并支持查询 accepted/running/cancelling/succeeded/failed/cancelled/interrupted 状态。幂等内容 SHALL 包含规范化的 Session、prompt 和请求模型选择语义：省略使用 Session 偏好、显式空值使用 Work 默认、显式模型引用使用该模型。相同键同内容 SHALL 返回原 Run及其实际模型与 Thinking，异内容 SHALL 冲突；重放不得因偏好、catalog 或默认模型后来变化而重新解析或重新执行。自动执行来源由系统产生，调用者不能通过公共提交冒充 Service 来源。

新调用者 SHALL 能明确区分字面文本与资源命令输入；相同提交键改变显式输入模式 SHALL 冲突，输入模式一经受理不得因重连或界面选择而变化。未携带新模式的旧请求 SHALL 保持原幂等摘要与原输入解释，不因新增默认字段使旧提交失去幂等命中；新 Desktop 的普通输入及 Send as text SHALL 使用明确字面模式。

新 Run SHALL 在持久受理时捕获同一组实际模型和有效 Thinking，执行只使用该组快照，不在执行或重放时重读 Session 设置。Session 偏好是受理参数来源，不是幂等请求内容的可变部分；相同原请求在偏好、Thinking 或命令目录变化后重放，SHALL 先返回原 Run，不重新检查新目录或重新执行。资源命令校验失败 SHALL 不受理新的模型/工具执行；已受理后的资源或能力错误 SHALL 形成原 Run 的可查失败，不静默改成文字、另一命令或另一模型。

获准的图文提交 SHALL 将文字和有序图片作为一个不可变输入受理。相同提交键改变任一图片的原始内容、MIME 或顺序 SHALL 冲突；输入摘要 SHALL 覆盖实际图文内容，不仅覆盖文字。未提供图片或图片为空的文本请求 SHALL 保持原摘要及重放语义，不因新增字段失去旧记录命中。图片接受事实及原内容 SHALL 在返回可靠受理前持久保存，执行尚未将消息写入 SDK history 即中断也不得丢失已接受图片或自动重新执行。

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

#### Scenario: 相同图片与改变图片的重放
- **WHEN** 调用者按原键重放相同图文输入，或分别改变图片字节、MIME、顺序
- **THEN** 相同输入返回原 Run，改变输入返回冲突，均不产生第二次模型执行

#### Scenario: 已接受图片在 SDK 写入前中断
- **WHEN** 图片 Run 已持久受理，但 daemon 在 SDK 保存用户消息前退出
- **THEN** 重启后原 Run 为 interrupted，原文字和图片仍可按原身份读取，不自动重新发送

### Requirement: Limit active execution per Work

第一版每个 Work SHALL 最多有一个 accepted/running/cancelling Run，不同 Work 可以并行。未显式请求 CONV-CANCEL-SEND-001 的不同提交与现有活动 Run 冲突时 SHALL 返回 WORK_BUSY；相同键的幂等重试不受此错误替代。

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

Session SHALL 作为同一 Work 的持续对话保留，不以创建环境限制继续。每个新 Run SHALL 在受理时固定 Work 当前已验证的 active context，包括 copied Skills、`AGENTS.md`、包、基础镜像、MCP 和最终工具策略；已受理 Run 保持原快照。历史消息不提供执行权限，执行器 SHALL 加载当前 Run 固定的资源与工具，不复用旧环境授权。配置更新、Session history、Run events 和错误响应 MUST NOT expose secrets, host paths, managed-storage paths, internal digests, or configuration revisions.

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

已终态 Run SHALL 保持终态，导入不执行工具、不调用模型、不重放提交键；非终态历史使包校验失败。Session 继续按所属 Work 当前已验证 active context 受理新 Run；Session 不绑定创建时环境，旧 Run 保持原环境事实。读取与继续均按新 Work 所有者授权。存在受管 sqlite 时，其 schema/path/外键必须验证，不能执行包携带 SQL、触发器或任意宿主路径；active=null 且主文件/WAL/SHM 全部缺席表示尚无私有 Session/Run 历史，导入保持缺席，首次显式 start 按正常路径初始化。

所有者 SHALL 能通过 import-provenance 查询导入包 digest、import Operation ID 和源到目标历史 Operation ID 映射，再用既有 operation show 读取映射后的终态安全投影。此历史查询不触发执行，非所有者管理员也不得读取该 provenance；源用户/平台 secret 信息不在响应中。

系统 SHALL 完整保留 schema 4 的现有模型选择、实际模型、安全执行来源、反馈关联与采用经验版本；新 harness 使用 history schema 7，并额外保存独立 Memory 绑定与新 Run 实际提供的 entryId/截断信息。已知 schema 4 的导入按原格式静态校验并保留固定运行镜像，不在导入时升级；采用新 harness 的受控迁移遵守 WMEM-005。新增反馈图及导入历史的执行边界遵守 PWORK-BRAIN-001。平台派生身份不从源环境恢复为 live 权限。


本变更新 Agent SHALL 使用 history schema 7，移除 `sessions.active_context_identity` 并保留 `runs.context_identity`，Memory 保持 schema 1。schema 4/5/6 SHALL 作为精确已知历史输入，按各自声明的结构与语义静态校验和导入，保留源格式与固定镜像；导入不升级历史。用户显式 Apply 新 Agent 时 SHALL 按 WMEM-005 在完整备份后将 4/5/6 一次转换到 7，删除 Session 创建环境绑定并保留原 Session ID、SDK 文件、Run 执行事实、幂等及 Memory 引用，不回填兼容推理偏好。升级失败恢复原备份；成功后拒绝仅支持 schema 4/5/6 的 Agent 直接运行新格式。

#### Scenario: Continue a copied Session
- **WHEN** 同一个包被导入两份，分别显式启动，并在完成所需的受管升级后使用新 Agent 继续同一局部 Session ID
- **THEN** 两份各自从相同历史继续，新 Run 使用各自 Work 当前已验证 active context，后续消息独立，源 Session 不增加消息

#### Scenario: Keep a completed tool call historical
- **WHEN** 包内已完成 Run 的历史含发邮件或服务创建记录
- **THEN** import 不重放这些动作，新 Run 只有显式提交才执行

#### Scenario: Reject hostile history metadata
- **WHEN** 私有数据库包含非预期 schema/trigger、错误 Work scope 或指向 /etc 的 SDK history path
- **THEN** 导入整体失败，不把数据库作为可信脚本打开，也不访问该路径

#### Scenario: Preserve an old context mismatch
- **WHEN** schema 4/5/6 源历史的 Session 环境列与源 Work active 不一致
- **THEN** 静态导入保留源格式和固定镜像，仅按声明映射归属，不执行旧 Run；显式升级到 schema 7 后删除该 Session 环境列，原 Session 可按当前 Work 准入继续，旧 Run 环境差异仅作历史事实保留

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

获准用户 SHALL 查询当前 Work 的安全模型列表并设置 Session 的完整模型/Thinking 偏好。完整模型配置经启用、凭据和实际环境兼容性准入后进入可选列表，自定义 ID 不因 SDK 未收录、Thinking 未确认或无模板被过滤。相同 Model ID 的不同配置须可安全区分；公开列表不含 Key、端点、secret 路径或内部执行定义。真正停用、无凭据或旧环境不兼容须说明原因和恢复方向，列表加载、空集合、读取失败与偏好不可用分别表达。

用户 SHALL 保留同一 Session 历史，在下一次手动 Run 使用所选模型；偏好与实际模型描述持久保存，不改 Work active/desired、pendingApply、Session 身份或既有历史。已接受 Run 固定模型与有效 Thinking，自动执行忽略 Session 偏好而使用 active 默认；默认停用不妨碍查询/选择其他可用覆盖。新 Session 默认使用 Work 默认，目录/名称修改不重写既有历史。

Work default 选项、Response settings 和聊天输入区域 SHALL 明确展示该 Work 当前捕获描述中的实际 `model`，并与友好名称及“Work default”身份区分。目录名称或当前 head Model ID 变化不能使旧捕获默认只显示新名称而掩盖实际型号。使用现有安全公开字段；不得暴露端点/Key/私有定义，不能通过显示修复自动改变 modelRef、Work 配置、Session 偏好、Thinking 或历史；长 Model ID 在窄屏保持完整身份可访问。

SDK 已知模型 SHALL 提供实际确认的 Thinking 档位和建议值，已确认不支持只允许 Off；不在所选 SDK 能力或兼容推理方式中声明的档位/不兼容设置原子拒绝，不能只保存模型。已有模型专用入口保留原 Thinking，不兼容则明确拒绝，不能静默清除。能力查询、设置校验和执行共用同一解析定义，已知兼容模型的 reasoning/映射不能丢失。

未知 Model ID SHALL 自动支持所选协议的普通消息执行，Thinking 能力单独标为 unknown，SDK 确认档位为空、默认 thinkingLevel=null 表示未请求额外 Thinking；兼容推理方式和可请求档位 SHALL 单独提供，只有用户明确选择兼容方式及档位才允许非空 Thinking；不把此状态伪装为已确认 Off 或已确认不支持。新建未知默认/覆盖 Session 可直接普通发送，无能力 JSON 或管理员设置步骤。已有非空 Thinking 与未知模型不兼容时保留原偏好并明确提示，用户显式确认普通模式或完整兼容推理设置后才原子保存新设置；模型仍可选择，不能被整个隐藏。

完整设置 SHALL 包含模型、Thinking 档位和兼容推理方式（若有），作为同一个原子偏好保存；兼容方式 SHALL 随 Session 及受理时 Run 快照保留。完整设置对 SHALL 仅作用于下一次新手动 Run，保存与受理交错须捕获完整旧组或新组。已知 Thinking 与显式兼容 Thinking 实际作用于请求，允许 Off 的模型应明确关闭，不仅记录本地值；普通模式不附加未经确认的 Thinking 参数，也不宣称供应商内部推理已关闭。自动 Run 使用 active 默认的原已知行为，未知默认使用普通模式，不继承聊天覆盖。

缺少 Thinking 的旧 Session/Run SHALL 按旧 Off 解释，旧模型实际不接受 Off 时要求显式修复，不改历史。新 null 普通记录与缺省旧记录严格区分，不根据当前目录回写。新 Desktop 初始草稿使用已知默认的确认建议值，未知默认为普通模式，通过显式创建/发送确认完整设置。

Test SHALL 不作为聊天准入或 Thinking 证明。执行配置改变发布新选择引用，旧覆盖明确不可用，不静默迁移；停用/删除后保留偏好、Thinking、草稿与历史。已经受理 Run 不随目录变化，同键重放先返回原事实，不因当前失效重执行或换模型。公开输出不含推理原文或新增凭据材料。

nullable/unknown 及兼容推理行为 SHALL 明确协商版本并同步客户端/历史验证；旧环境不支持时给出升级方向，不误投影为 Off。兼容新版环境中，自定义模型必须完成真实 SDK 普通消息与显式兼容推理执行，不能只出现在下拉。旧写请求省略兼容字段 SHALL 保持原解释；当前偏好已有兼容方式时，省略字段的写请求 SHALL 原子拒绝，不清除原偏好。新版写请求使用 `thinkingProfile:null` 明确清除兼容方式，字符串表示明确选择兼容方式；读取和历史在无兼容方式时省略该字段。历史 SHALL 保持原解释，不能借非空档位隐式启用兼容方式；旧 Agent 不支持时明确拒绝新设置并保留原偏好。

#### Scenario: 保持历史切换模型
- **WHEN** 用户在已有 Session 选择另一兼容模型并发送
- **THEN** 原历史保留，新 Run 使用所选配置，Work 配置/pendingApply 不变

#### Scenario: 执行中更改下一次偏好
- **WHEN** Run 执行时用户保存另一完整设置
- **THEN** 当前 Run 不变，后续手动 Run 使用新设置

#### Scenario: 空列表、读取故障与不可用偏好
- **WHEN** 模型查询为空、失败或旧偏好不可用
- **THEN** 分别说明原因并保留草稿/原设置，不静默选择其他模型

#### Scenario: 不支持的 Thinking 原子拒绝
- **WHEN** 提交已知模型不支持的 Thinking、未知模型未显式选择兼容方式的非空档位，或兼容方式与协议/档位不匹配的设置
- **THEN** 明确拒绝完整设置对，原模型/Thinking 都不改变，允许用户显式改为兼容模式

#### Scenario: 保存与受理交错
- **WHEN** 完整设置保存与新 Run 受理交错
- **THEN** 捕获完整旧组或新组，不能混配或随后改写已接受执行

#### Scenario: 默认模型和旧记录
- **WHEN** 覆盖为空但默认有效，或读取缺少 Thinking 的旧记录
- **THEN** 默认仍可用，旧记录保持 Off 解释；新 null 记录保留普通模式语义，不与旧缺省混淆

#### Scenario: SDK 已知兼容模型的 Thinking
- **WHEN** SDK 已知模型使用自定义连接
- **THEN** 保留其真实档位和映射，设置/执行使用同一模型定义，不强制非 reasoning

#### Scenario: Thinking 选择影响真实请求
- **WHEN** 用户发送已知模型支持的 Off 或非 Off，或未知模型的普通消息及显式兼容推理
- **THEN** 已知和兼容请求分别与受理档位及方式一致，普通消息不加入额外推理参数；各自记录真实，既有 Run 不改变

#### Scenario: 能力未知与不支持区分
- **WHEN** 一个模型 Thinking 未确认，另一个被 SDK 确认不支持
- **THEN** 前者默认可普通聊天并显示 unknown/null，且另有标为未确认的兼容选项；后者明确 Off；不能伪造相同能力或隐藏前者

#### Scenario: 同一 Model ID 的不同配置
- **WHEN** 两条启用模型连接不同，用户选择第二条
- **THEN** 列表可区分，真实请求使用第二条的地址与 Key，不混用或要求 Provider 管理

#### Scenario: 默认停用后选择覆盖模型
- **WHEN** 默认模型停用但另一配置可用
- **THEN** 默认原因与覆盖分别表达，用户可明确选择覆盖并继续同一 Session

#### Scenario: 编辑或删除已有偏好模型
- **WHEN** 覆盖执行引用因模型编辑或删除失效
- **THEN** 原历史/偏好/Thinking 保留，明确重选，不自动改绑新引用

#### Scenario: 模型管理不覆盖 Thinking
- **WHEN** 管理员 Test、启停、改 Key 或改名称
- **THEN** Session Thinking 与已接受事实不被管理动作改写，不兼容设置显式处理

#### Scenario: 自定义模型完整执行
- **WHEN** 用户选择不在 SDK 目录的新模型并新建普通会话发送
- **THEN** 经真实 SDK 请求原协议/ID/端点，得到回复，不需模板或其他配置；thinkingLevel=null 表示未请求额外 Thinking


#### Scenario: 默认型号与当前目录名称分离
- **WHEN** Work 捕获 old-id，管理员将同一条目的显示名称/当前 head 改为 new-id，用户打开默认模型菜单、响应设置或聊天输入区域
- **THEN** Work default 明确显示实际 old-id，当前目录条目可单独辨认为 new-id，不显示秘密；Work 捕获、Session Thinking 和既有 Run 不改变，256 字符型号在 360px 下仍可辨认

#### Scenario: 兼容设置持久化及重放
- **WHEN** 用户保存兼容方式和档位，提交 Run 后修改偏好、重启 Work，或使用同一 submissionKey 重放原请求
- **THEN** 原 Run 保留受理的模型、兼容方式和档位，重放先返回原事实且不重执行；重新打开 Session 能读取保存的完整偏好

#### Scenario: 快照保留兼容推理事实
- **WHEN** 含兼容 Session/Run 的 stopped Work 完整导出并导入目标安装
- **THEN** 兼容方式和档位与历史原样保留，仍按目标模型匹配及目标凭据规则继续；无法匹配或不支持该方式时偏好不可用且不静默变成普通模式

#### Scenario: 旧请求与明确清除兼容方式
- **WHEN** Session 已保存兼容方式，旧客户端省略该字段提交设置，或新版客户端显式发送 `thinkingProfile:null` 切换普通模式
- **THEN** 前者原子拒绝并保留原设置；后者在档位和模型有效时原子清除方式并保存普通模式

#### Scenario: SDK 后续收录同一型号
- **WHEN** 已保存兼容设置的型号在后续 Agent SDK 中被收录
- **THEN** 已有兼容设置和历史保留原方式及映射，用户明确切换才能采用 SDK 能力；新会话沿用该 SDK 的已知默认行为

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

新增 Session Thinking、Run 实际 Thinking 和输入解释模式 SHALL 随原模型选择、实际模型、幂等记录及 SDK history 持久保存，daemon 重启和完整包导出导入后保持同一含义。系统 SHALL 沿用 CONV-SNAPSHOT-001 的现行 history schema 7 并静态兼容已知 schema 4/5/6、storage layout 2 和 .work formatVersion 1，不为图片新增 SQL schema、存储卷、导入迁移、自动回放或 SQL 执行入口；可选结构化字段缺省按前述旧行为解释，未知字段和非法值仍拒绝。

导入后保持原 Session/Run 局部身份、工具历史和终态，按原 Work/context 映射恢复，只在接收方权限与当前 Work 执行准入下接受新执行；schema 7 的 Session 不以创建时环境限制继续，新 Run 固定当前已验证 active context。已有 SQL/schema/path/外键、非终态历史拒绝、空历史及历史控制操作只读归档规则继续适用；新字段不能扩大 live 权限或作为隐式创建、调用模型和工具的依据。

图片原始内容、消息顺序、所属 Run 及幂等关系 SHALL 随原私有会话历史和完整包保留，包括尚未写入 SDK history 的已接受终态输入。用户显式在原 Session 续聊时，尚缺 SDK 消息的原已接受图文输入 SHALL 作为历史参与正确上下文，不重新执行旧 Run 或伪造旧回答；只读历史查看和重启本身不调用模型。导入后按新 Work 所有者读取，不依赖原 Desktop 缓存、源 Core、公网 URL 或共享 workspace 文件。新图片记录的合法性与摘要一致性 SHALL 在 TS/Go 冷历史验证中保持一致；未声明新图片记录的旧历史继续原静态兼容，不重写历史正文。


schema 6/7 中的兼容 Thinking 方式和档位 SHALL 按同一会话及 Run 身份完整保存；schema 4/5 不接受它们尚未声明的兼容推理语义。旧数据在导入和升级时均不回填该设置。

#### Scenario: 新设置完整包往返
- **WHEN** 包含模型/Thinking、资源命令 Run 和工具历史的终态 Work 完成导出、导入、再导出
- **THEN** 新字段、原幂等及工具关联保持，未执行任何历史命令或工具，导入后显式新提交才执行

#### Scenario: Responses 工具身份保持可读
- **WHEN** 兼容模型的 SDK 历史包含 `call_id|item_id` 等供应商工具调用 ID，用户分页或重新打开会话
- **THEN** 调用 ID 作为长度 1–1024 的不透明字符串原样读取，调用与结果按同一身份关联，不套用内部对象 ID 的字符限制，不误报历史损坏，也不改写 SDK 文件；内部对象 ID 的校验保持

#### Scenario: 旧包与非法设置
- **WHEN** 导入合法 schema 4 包缺少新字段，或包带有非法 Thinking/输入模式
- **THEN** 前者按旧行为读取并保留原历史，后者校验失败，不执行迁移或以猜测值修复

#### Scenario: 图片包离线往返
- **WHEN** 含 SDK 图片消息及受理后中断图片输入的终态 Work 导出后，源 Core 下线，再导入目标安装
- **THEN** 原图片字节和对应 Session/Run 保持，目标 Work 为 stopped，用户显式 Start 后可读取原图，导入不调用模型

#### Scenario: 图片持久记录损坏
- **WHEN** 新图片受理记录的 MIME、长度、内容摘要或 Run/Session 归属被破坏
- **THEN** TS/Go 对对应记录一致拒绝，不以空图片修复、跨对象查找或执行输入来绕过验证

#### Scenario: 中断输入后的显式续聊
- **WHEN** 已接受图片在 SDK 保存前中断，用户重启后在原 Session 明确发送新消息
- **THEN** 新 Run 的上下文包含原图片输入，旧 Run 保持 interrupted，不重放旧模型/工具或生成虚构旧回复

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

### Requirement: 原生 Core 与 SDK 会话的协商和冷恢复

**Identifier:** CONV-ADAPTER-001

Core SHALL 负责用户授权、desired/active 与代次、Docker 和路由准入，完整 TS Agent 保持 SDK、Session/Run、模型/工具、MCP 与私有历史。只有当前 ready 代次 mTLS 通过才转发 Session/Run；观察断线只结束观察，明确 cancel 才中止执行。稳定 SDK Session ID 和历史路径 SHALL 可在另一进程恢复，路径存在不能冒充 SDK 已持久化消息。

可选聊天能力 SHALL 独立协商，未知/旧 Agent 继续基本聊天且新控件明确不可用，不自动换镜像。模型、Thinking、资源命令和原键查询按有效 agent-conversation / ai-model-management 契约；当前 nullable 和兼容推理行为使用 chat contract 4，不以旧文档的 contract 1 或 history schema 4 作为当前上限。Run 固定受理设置和来源，执行前核对同一模型与凭据描述，不替换失效模型。

资源命令 SHALL 仅从 validated active 资源发现，text 禁止 slash 展开，command 只执行已确认资源，旧省略行为保持；未知提交只查原键不自动重发。工具历史 SHALL 保持安全顺序块、原 Run 关联和 UTF-8 64 KiB 有界预览，不公开完整参数、原始 Thinking、凭据或私有路径。当前 Agent 的受管历史 SHALL 使用 schema 7 与独立 Memory schema 1，已知 schema 4/5/6 按各自定义静态读取和导入，不能把过期十三表描述当成当前数据库定义。升级及回退遵循 CONV-SNAPSHOT-001，不降低原身份、授权或结果未知保护。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

### Requirement: 显式取消指定 Run 后提交新消息

**Identifier:** CONV-CANCEL-SEND-001

获准 Work 所有者 SHALL 能查询当前 Work 的真实活跃 Run，并通过显式携带指定旧 Run 身份的新消息提交，执行取消后发送。活跃查询 SHALL 为只读，返回所属 Work 的安全 Run 投影或已确认无活跃 Run；读取失败、旧实例及未支持能力不能伪装成空闲，也不读取其他 Session 全部历史或创建执行。该能力 SHALL 独立可确认，旧 Agent 与未携带取消目标的普通提交保持原能力、WORK_BUSY 和幂等行为，不自动更新运行镜像。

新意图 SHALL 在任何取消副作用前检查新消息、目标 Session/context、模型及 Thinking、输入模式、图片和权限，并校验指定旧 Run 属于同一获准 Work。取消目标 SHALL 绑定调用者明确传入的旧 Run，不因等待或读取期间出现新 Run 而改绑。旧 Run 可以来自同一 Session、另一 Session 或 Service；指定旧 Run 已终态且 Work 空闲时正常受理新消息，另一个不同 Run 已占槽时明确拒绝且不取消它。空或非法取消目标 SHALL 不作为隐式选择最新 Run。

系统 SHALL 将取消、实际收尾和新 Run 受理协调为一个有界操作，期间其他不同提交及后台自动受理不得抢占该次交接；仍保持每 Work 最多一个 accepted/running/cancelling Run。取消等待从请求停止到执行收尾确认最多 5 秒，达到上限且尚未确认停止 SHALL 返回明确超时，保留旧 Run 实际状态及活动槽，不创建新 Run，不在它稍后结束时延迟发送。等待期间不提前创建 accepted Run，不形成持久待发送队列；其他 Work 保持可执行。

新 Run 受理前 SHALL 再检查当前运行实例、Work 准入、Session/context 和已选模型的有效性；Stop、Delete、draining、Apply 关闭准入时不接受新 Run。已经明确取消的旧 Run 不因新提交失败而恢复。已选模型/Thinking 作为完整组使用，不混入等待期间随后编辑的设置；实际模型、Thinking、图片、Memory 和来源仍按既有新 Run 受理契约记录。取消关联未完成请求 SHALL 沿用 WAF-007 终止后续自动处理，不转换成暂停或自动恢复；业务 Job 和已提交数据不被推断为撤销。

取消目标 SHALL 纳入新提交的幂等内容，相同键同内容在受理后先返回原 Run，不再次取消或启动执行；改变目标、Session、输入或显式选择语义 SHALL 冲突。受理前相同键同内容的并发调用只协调一次，相同键异内容不得产生第二次取消；不同键的同 Work 并发交接明确冲突。未携带新字段的原请求摘要和历史重放 SHALL 保持原值。接受响应未知时 SHALL 支持按原键只读查询实际新 Run；没有映射不代表原调用已经失败，不得自动重发。

已接受 Run SHALL 继续独立于观察连接执行；任何用户身份/实例变化后晚到的接受事实只归属原对象，不继续以旧授权提交新执行。此能力 SHALL 复用现有 Run/请求终态与历史，不新增任务生命周期；5 秒上限约束取消等待，不承诺强制终止不响应取消的任意工具。

#### Scenario: 取消其他 Session 或 Service Run 后发送
- **WHEN** 所有者提交有效新消息并明确指定同 Work 的活跃旧 Run
- **THEN** 先请求取消并等待实际收尾，再在目标 Session 接受一个新 Run；取消关联未完成请求时阻止其后续自动续接，其他 Work 不受该交接阻塞

#### Scenario: 校验失败与越权目标
- **WHEN** 新输入、模型、图片、命令或 Session/context 不合法，或指定旧 Run 属于另一 Work/用户
- **THEN** 在取消前拒绝，不改变任何原 Run，不创建新 Run，不暴露另一 Work 内容

#### Scenario: 旧目标完成或被另一个执行取代
- **WHEN** 指定旧 Run 已终态，Work 分别为空闲或已由另一个 Run 占槽
- **THEN** 空闲时保留旧终态并正常受理；已占槽时返回明确冲突，不取消新出现的 Run

#### Scenario: 取消等待超过五秒
- **WHEN** 已请求取消但 5 秒到达时执行及受管任务尚未确认结束
- **THEN** 返回取消等待超时，旧 Run 保持实际 cancelling/终态及应有活动槽，无新 Run；原执行随后结束也不自动提交该新消息

#### Scenario: 后台和多窗口竞争
- **WHEN** 交接释放旧执行时后台尝试受理，或另一窗口同时用不同键执行停止并发送
- **THEN** 当前交接期间不接受后台或第二个冲突交接，最终最多一个新 Run，拒绝者保留原输入且不排队

#### Scenario: 幂等重放与取消目标变更
- **WHEN** 相同键同内容并发或在接受响应丢失后重放，或相同键更换取消目标
- **THEN** 前者最多一次取消和一个新 Run且受理后返回原结果，后者冲突；不把重放的目标改成当前最新 Run

#### Scenario: 新消息未受理或已经受理时断线
- **WHEN** 连接在取消等待中或新 Run 已受理后断开
- **THEN** 未受理部分受有界操作与当前授权/准入约束且不进入恢复队列，已受理 Run 按原身份继续执行；重连只读查询原 submissionKey，不自动再提交

#### Scenario: 取消期间生命周期或设置变化
- **WHEN** 等待期间 Work 关闭执行准入、实例/context 改变、所选模型失效，或用户编辑后续模型/Thinking
- **THEN** 失去准入或有效性时不受理新 Run且不复活旧取消；仍可受理时使用原完整选择组，不混用后续编辑

#### Scenario: 旧客户端与完整包历史
- **WHEN** 原客户端未传取消目标，或已终态的新旧 Run 及幂等映射经重启/完整包导入后读取
- **THEN** 原客户端行为和摘要不变，原历史保持可读且无迁移、自动补发、旧任务复活或隐式镜像升级

### Requirement: 图文 Run 有界校验并使用实际模型图片能力

**Identifier:** CONV-IMAGE-001

系统 SHALL 为获准用户提供独立可发现的图片输入能力，包含受支持类型和固定限额，并区分实际所选模型支持、不支持与未确认图片。该能力 SHALL 来自实际运行实例及已解析模型的输入定义，不从型号名称、协议或 Thinking 能力推测。旧 Agent 未实现图片能力时 SHALL 明确不支持并保留原基础聊天，不自动替换固定镜像。

第一版 SHALL 接受 PNG、JPEG、WebP 的原始图片，最多 4 张、每张最多 5 MiB、图片合计最多 10 MiB；单图宽高各最多 8192 像素、总像素最多 40,000,000。图文提交的编码请求体 SHALL 有 16 MiB 上限，文字继续不超过 64 KiB。图片容器结构完整性、Base64 解码后字节长度、声明 MIME 与实际类型、尺寸和总量 SHALL 在受理前校验；客户端提供的摘要不得替代服务端计算。不接受远端 URL、宿主路径、SVG、GIF 或任意普通附件。受理前结构校验不等同于完整像素解码或保证供应商接受；后续解码/供应商错误按原 Run 执行失败保存，不能宣称成功或重发。

文字为空但至少一张合法图片 SHALL 可以受理；文字和图片都为空 SHALL 拒绝。有图片只允许明确字面消息模式；命令携图 SHALL 在受理前明确拒绝。新提交所需图片能力不支持/未确认时 SHALL 拒绝并给出恢复方向，不静默丢图或换模型；实际继续上下文含图片时亦不得由仅文本模型悄悄忽略。已经受理的同键同内容重放先返回原事实，不因当前能力变化重新执行。

受理后的真实模型请求 SHALL 包含同一组图片及文字，保留顺序和内容；图片不得只显示为客户端附件、转换成模型不可读取的路径或放入工具 Activity。授权、单 Work 活跃槽、模型/Thinking 快照、取消、观察断开及 context 准入继续原契约。图片正文不得进入普通日志或公开状态事件。

#### Scenario: 模型收到真实图片
- **WHEN** 获准用户向支持图片的模型提交纯图片或图文组合
- **THEN** 一个 Run 被受理，真实模型请求含原图片及文字，图片内容和顺序一致，不只发送文件名或路径

#### Scenario: 无效输入在受理前拒绝
- **WHEN** 提交空消息、携图命令、非法编码、伪造 MIME、容器非法/截断的图片、超限数量/字节/尺寸
- **THEN** 返回可区分原因且不受理 Run、不触发模型/工具，合法旧历史不变

#### Scenario: 旧环境及未知模型
- **WHEN** Agent 缺少图片能力，或实际模型图片能力未确认/明确不支持
- **THEN** 图片新提交明确拒绝，原支持的文本模型仍可查询和使用，不自动升级 Agent 或修改模型设置

#### Scenario: 包含图片的上下文换成文本模型
- **WHEN** 用户在同一会话改用不支持图片的模型，而本次实际上下文仍含图片
- **THEN** 明确说明不能处理该图片上下文，不隐式删掉历史图片或执行另一个模型，用户可显式重选或新建会话

### Requirement: 图片历史按消息身份只读取得

**Identifier:** CONV-IMAGE-HISTORY-001

支持图片 profile 的会话历史 SHALL 提供已发送图片的有序内容块、稳定引用、MIME、字节长度及完整性描述；历史列表不内联全部图片正文。未请求该 profile 的调用者 SHALL 保持旧文字/工具投影，不要求旧客户端解析新图片块。调用者 SHALL 能按同一 Work/Session/Run 内稳定图片身份读取一张原图，单次响应不超过 5 MiB，返回准确 Content-Type/长度及禁止缓存的响应，不接受调用者指定的路径或外部地址。

图片读取 SHALL 沿用会话历史的所有者、运行实例及本地授权边界；Session/Run/图片归属均须核对，越权或归属不匹配不得返回其他对象内容。公开信息不得暴露私有文件路径或凭据。已接受输入与已保存 SDK 用户消息 SHALL 合并成一条真实消息；事件压缩不得删除图片唯一持久副本。图片损坏、缺失与读取暂不可用 SHALL 明确区分，不能用空图片或其他消息的图片代替。

#### Scenario: 历史列表与按需读取
- **WHEN** 用户打开含多条图片消息的 Session，再请求其中一张图片
- **THEN** 列表只返回有界图片描述，该图片请求返回对应原始字节，列表不反复携带全部图片数据

#### Scenario: 旧历史调用者
- **WHEN** 调用者未声明图片历史 profile
- **THEN** 返回既有文字/工具投影，不向旧客户端引入未知图片块，原 SDK 历史不被裁剪或改写

#### Scenario: 原输入与 SDK 历史合并
- **WHEN** 原图文受理输入已保存，随后同一 Run 的 SDK 用户消息落盘并重读 Session
- **THEN** 仍是一条用户消息，同一图片引用可用，没有双份消息；事件压缩后仍能读取原图

#### Scenario: 越权及跨会话身份
- **WHEN** 调用者请求其他用户 Work 的图片，或混用自有 Work 的另一个 Session/Run 图片身份
- **THEN** 请求被拒绝，不能返回图片、私有路径或通过错误透露其他对象内容

#### Scenario: 图片缺失和读取中断
- **WHEN** 原图损坏、已缺失或运行连接暂不可用
- **THEN** 返回可理解的对应错误，不补造成功、不调用模型、不自动启动 Work

### Requirement: 会话历史通过有界分页完整读取

**Identifier:** CONV-HISTORY-READ-001

支持新版历史读取的 Work SHALL 提供独立于整份 Session 响应的分页通道，并在历史源到 Core、客户端的每一跳保持单页有界。默认每页 SHALL 最多包含 50 条不同逻辑消息，最终 HTTP JSON 正文 SHALL 不超过 512 KiB，包含元数据、游标、正文及转义开销；页大小不得只按消息条数、字符数或压缩后的字节计算。会话总量超过既有 1 MiB、4 MiB、6 MiB 单次响应边界时，获准调用者 SHALL 仍能逐页取得全部公开历史，不能在内部先传输整份历史再切页。

单条消息或内容块超过页预算时 SHALL 通过稳定消息/内容块身份、有序字节范围及完成标志分片取得；每片保持合法 UTF-8，拼接后等于原公开正文，不降低既有工具结果 64 KiB 预览上限或增加正文截断。尚有内容时 SHALL 返回可推进游标，不能用空成功页、跳过大消息或永不变化的游标解除超限。正文只需一种表示；历史页不重复携带兼容文本副本、全部 Run 完整结果或图片字节。

公开正文、工具预览、安全字段和图片描述 SHALL 沿用 CONV-TOOL-HISTORY-001 与 CONV-IMAGE-HISTORY-001。完整遍历 SHALL 包含该快照内的全部消息及可确认 Run/工具关联，不得因关联查询达到固定条数而静默遗漏。历史读取仍为只读，不执行模型、工具或历史提交。

#### Scenario: 正常长会话跨越全部既有单次响应边界
- **WHEN** 获准用户读取工具结果占多数、整份公开历史分别超过 1 MiB、4 MiB 和 6 MiB 的 Session
- **THEN** 各层逐页处理，最终 HTTP 正文逐页不超过 512 KiB，全部公开历史可按原顺序还原，无整份历史 RPC、隐式裁剪或新的模型执行

#### Scenario: 单条消息和转义后的内容超过页预算
- **WHEN** 一条正文超过 512 KiB，或控制字符、中文及 JSON 转义使候选页实际编码超限
- **THEN** 返回合法 UTF-8 分片及可推进游标，完整遍历后的正文逐字节等于原公开正文，每个实际编码页满足预算

#### Scenario: 关联数量超过旧查询窗口
- **WHEN** Session 含超过 1000 个 Run，或旧工具关联位于某 Run 第 1000 条保留事件之后
- **THEN** 完整遍历仍取得全部合法消息及可确认关联，缺少可靠关联时明确未知，不猜测、不静默删去相关历史

### Requirement: 历史游标固定读取范围并保持逻辑身份

**Identifier:** CONV-HISTORY-CURSOR-001

历史分页 SHALL 支持从最新内容向前读取，以及从最早内容向后完整遍历；同次遍历 SHALL 绑定固定快照边界。游标 SHALL 绑定当前获准 Work、Session、历史 profile、适用 Run 范围、方向和位置，不接受调用者指定私有路径。新消息追加不得改变已有页的位置、造成跨页重复或遗漏；当前 Run 状态可单独确认，但不得冒充冻结快照内的结果。

已接受的图文输入转为 SDK 保存消息时 SHALL 保持同一逻辑消息和图片身份；工具跨页、事件重放与历史读取 SHALL 能按可靠身份合并，同名或相同文字不能被当作同一对象。旧历史缺少 Run 标记时仍保持原顺序与稳定局部身份，不能伪造关联。

非法游标 SHALL 明确拒绝；快照过期、来源被替换或 daemon 重启后无法继续原快照时 SHALL 明确报告游标失效，允许客户端重新建立读取范围并去重，不返回伪空历史。游标不是授权，后续每页 SHALL 重新执行所有者、Session 归属及实际运行实例校验，旧授权晚响应不得进入新对象。

#### Scenario: 向前阅读时后台持续追加
- **WHEN** 用户从最近页向前翻页，同时同一 Session 持续保存新的正文与工具结果
- **THEN** 原快照遍历保持同一顺序和边界，无漏页或重复；新内容在新的读取范围中按原消息身份合并

#### Scenario: 图文输入落盘与跨页工具合并
- **WHEN** 已接受图文输入随后写入 SDK，且同一工具的开始与结果分属不同页或事件连接
- **THEN** 原用户消息和图片只呈现一次，工具按真实调用身份合并，结果不会被晚到的开始事实降级

#### Scenario: 游标失效、跨对象使用与身份切换
- **WHEN** 客户端使用失效游标、将其用于另一 Work/Session/Run 范围，或读取期间身份和运行实例发生变化
- **THEN** 按失效或原授权规则明确拒绝，不返回别的对象数据或成功空页，重新读取本身不创建 Session/Run

### Requirement: 历史观察的控制响应与完整结果分离

**Identifier:** CONV-HISTORY-OBSERVE-001

声明新版历史响应 profile 的调用者 SHALL 取得有界 Run 摘要和同一获准对象的结果引用，完整最终正文通过分页历史读取。状态确认、事件观察、受理重放、原提交键查询、活跃 Run 与取消结果等可能返回已有 Run 的响应 SHALL 不因重复内联完整 `finalText` 而再次超过单次传输预算；新 profile 的单条事件 SHALL 保持有界，终态事件明确表示正文由引用取得，不能把省略正文解释为真实空结果。

Run 终态与正文读取完成 SHALL 分开表达。事件游标过期后 SHALL 可只读取得原 Run 状态及其全部已保存正文；已持久保存但尚无对应 SDK 最终消息的结果仍可通过该通道读取，不能编造旧回复或重复追加已有最终答案。观察断开和内容读取失败不得取消 Run、释放活动槽、改变终态或重发 prompt。响应 profile 只控制返回表示，不改变原提交幂等内容。

#### Scenario: 超大最终结果正常完成并可恢复
- **WHEN** Run 的最终正文超过原 JSON 或 gRPC 单次接收预算，随后收到终态、重新打开会话或事件入口返回 410
- **THEN** 有界摘要和事件可正常取得，完整正文通过历史页读取，终态不依赖整份结果响应，原最终答案只出现一次

#### Scenario: 原键核对一个已经完成的大结果 Run
- **WHEN** 客户端用新 profile 重放原受理请求或按原提交键查询已完成 Run
- **THEN** 返回同一 Run 的有界接受事实与结果引用，原幂等命中保持，不重新执行或因旧完整结果超限而变成未知

### Requirement: 分页历史能力独立协商且保留原始历史

**Identifier:** CONV-HISTORY-COMPAT-001

新版分页历史与配套轻量响应 SHALL 通过独立能力版本明确协商，不提高基础聊天准入门槛或自动替换固定 Agent 镜像。旧 Agent 未支持时 SHALL 明确不支持新版通道，保留原本可用的基础聊天与旧读取；新版客户端不得把缺少能力、读取失败或部分结果当作完整空历史，也不得将不断重试旧整份接口作为长会话恢复方案。

新增读取投影 SHALL 不改写 SDK 原文、消息树、既有 history schema、完整包格式、Session context、幂等记录或导入历史执行边界。重启与完整包导入后 SHALL 可重建读取能力并从新快照读取保留历史；不要求恢复旧进程的游标。超限、传输不完整、游标失效与 JSON 格式错误 SHALL 可区分，正常大历史不再因总量被误报为 `MALFORMED_RESPONSE`。

#### Scenario: 旧 Agent 和未声明新 profile 的客户端
- **WHEN** Work 仍运行旧 Agent，或旧客户端使用原接口且不声明新 profile
- **THEN** 原有可用能力保持，新通道不支持有明确说明，不自动换镜像、截断历史或发送新的 Run

#### Scenario: 重启与完整包往返
- **WHEN** 含长会话、图片、模型与工具历史的终态 Work 重启，或完成导出导入并由用户显式 Start
- **THEN** 新快照仍能完整读取原公开历史，原始私有内容及包格式不变，导入和只读查看不执行历史模型或工具

### Requirement: Agent 通过普通回复交付当前 Work 文件引用

**Identifier:** CONV-FILE-REFERENCE-001

支持本约定的 Agent SHALL 在实际模型执行上下文提供简短的文件交付指导，独立于是否启用 piwork-brain：通过既有获准能力核实生成或已有文件位于共享 workspace 后，使用普通 Assistant Markdown 链接交付，例如 `[报告.txt](piwork-file:/output/%E6%8A%A5%E5%91%8A.txt)`。无法核实文件时 SHALL 如实说明，不以链接文字冒充文件已生成或用户已下载。

`piwork-file:/` SHALL 表示所属回复所在 Work 的 workspace 根 `/var/data/workspace/`，后续各段按 UTF-8 URL 编码一次。引用 SHALL 不携带 Work ID、Core 地址、凭据、容器根路径或宿主路径，不接受 authority、query、fragment、根目标、空段、`.`、`..`、解码后的分隔符/控制字符或非法编码。合法字面百分号 SHALL 编码并只解码一次；路径边界继续遵循 WF-005。该约定只交付文件身份，不增加工具权限、隐式复制 workspace 外文件或新的 Agent 文件传输协议。

#### Scenario: 生成文件后提供可用引用
- **WHEN** Agent 通过已有工具生成并核实 `/var/data/workspace/output/报告.txt`
- **THEN** 实际模型可取得文件格式指导，回复提供指向 `/output/报告.txt` 的受控链接，原 Run 与工具记录仍按既有机制保存

#### Scenario: 未启用脑包或缺少文件能力
- **WHEN** Work 未启用脑包，或当前获准工具无法生成/核实用户需要的文件
- **THEN** 前者仍可获得平台文件引用指导而不隐式加载脑包；后者说明实际限制，不扩大工具权限或宣称已交付不存在的文件

#### Scenario: 路径编码与越界格式
- **WHEN** 文件名含中文、空格、百分号或井号，或候选引用包含其他 Work 的 authority、路径穿越、非法编码
- **THEN** 合法文件名按段编码且可一次往返还原；非法格式不被解释为文件操作或外部访问地址

### Requirement: 文件引用保留当前路径语义与原会话历史兼容

**Identifier:** CONV-FILE-REFERENCE-HISTORY-001

文件引用 SHALL 沿用普通 Assistant 文字事件、最终回复和 SDK 会话历史保存，不内联文件字节、不新增附件副本或结构化内容块。重新连接、重新打开会话及完整 Work 包导出导入 SHALL 保留原文字；导入后的链接按接收 Work 的相同相对路径解析，不依赖原 Work ID 或源 Core。历史读取和文件入口不得重放旧 Run、工具或文件写入。

引用 SHALL 指向点击时该路径的当前文件，不承诺发送时版本或读取/下载间的内容一致性快照；修改后重开读取当前内容，删除或改名后原引用可失效。原用户图片输入与私有图片历史 SHALL 保持 CONV-IMAGE-001 和 CONV-IMAGE-HISTORY-001 的独立语义，不与 workspace 文件引用混用。

旧 Agent SHALL 保持原聊天与文件能力；支持本约定的 UI 可以解析其真实文字中已有的合法引用，不伪造旧 Agent 已采用新指导。采用新版指导 SHALL 沿现有显式 Agent 镜像选择及 Apply 边界，不自动更新既有 Work 或为升级创建执行。

#### Scenario: 重开历史后文件已改变
- **WHEN** 原回复引用的文件被修改后用户重新打开历史，再点击该链接
- **THEN** 原回复文字保持，文件入口读取当前路径内容，不补造发送时副本或执行原任务

#### Scenario: 完整包导入另一个 Work
- **WHEN** 包含回复和对应 workspace 文件的 Work 完整包导入为新 Work，并由用户显式 Start
- **THEN** 链接在新 Work 内打开相同相对路径，源 Core 下线不影响解析，导入和查看本身不执行旧 Run

#### Scenario: 旧 Agent 和现有用户图片
- **WHEN** Work 仍使用旧 Agent，或用户查看原先发送给模型的图片历史
- **THEN** 原聊天和图片历史继续按既有契约工作，不自动换镜像，也不将用户图片变成可变 workspace 引用

### Requirement: Run 安全识别模型认证与权限失败

**Identifier:** CONV-MODEL-ERROR-001

系统 SHALL 在实际模型请求发生认证或授权失败且可从该请求可靠识别时，为原 Run 持久记录可区分的安全错误类别、固定消息与 `retryable=false`，在实时状态、Run 查询、重连和历史中保持一致。可确认 Key 无效时 SHALL 给出检查及更新 Key 的方向；仅确认认证被拒或权限不足时 SHALL 说明对应事实并指导检查 Key 或模型访问权限，不猜测特定原因。无权管理模型的用户 SHALL 获得联系管理员的方向；供应商认证失败 MUST NOT 注销用户或停止 Work。

限流、网络、取消、未知错误及工具返回的 HTTP 错误 MUST NOT 被误报为模型认证失败；无法可靠分类时 SHALL 保留安全通用错误。供应商原始错误正文、凭据、认证头及内部路径 MUST NOT 进入公开错误、Run 事件、日志或新增长期历史。确认认证或权限失败后原 Run 不自动重试、不更换模型或重放工具；修复配置后用户可显式提交新 Run，使用当时获准的凭据。

#### Scenario: 实际模型请求返回无效 Key
- **WHEN** 已受理 Run 的真实模型请求以可识别的认证错误拒绝合成 Key
- **THEN** 原 Run 显示明确的安全认证原因及处理方向、`retryable=false`，查询和重连结果一致，Work 保持原实际状态且不自动重发

#### Scenario: 权限不足与其他失败
- **WHEN** 模型返回权限不足，或请求限流、网络失败、工具访问返回 401
- **THEN** 权限失败不声称 Key 一定无效；其他失败不被误报为模型认证错误，所有结果不透传原始异常

#### Scenario: 轮换后的显式新 Run
- **WHEN** 管理员更新该模型 Key，用户提交新的 Run 并重新查看旧 Run
- **THEN** 新 Run 使用当前获准 Key，旧 Run 的身份、模型及失败事实不被改写或重放

#### Scenario: 恶意供应商响应
- **WHEN** 供应商错误包含合成 Key、认证头、内部路径或伪造的自然语言错误
- **THEN** 公开结果、事件、日志和新增历史不包含这些值，无法可靠分类时使用安全通用类别

### Requirement: Run 终结后衔接临时服务清理

**Identifier:** CONV-TEMP-SERVICE-001

Run SHALL 将正常完成、失败、明确取消及已确认的 daemon 中断与其已受理临时 Service 的收尾关联。系统 SHALL 不依赖后续模型调用或重放原 Run 发起清理；观察连接断开不等于取消。Run 终态与临时清理结果 SHALL 分别可查，清理失败或状态未知不得改写已提交 Run 的原终态或宣称资源已收尾。

#### Scenario: Run 取消后 Agent 仍存活
- **WHEN** 含临时 Service 的 Run 被取消并达到终态
- **THEN** 原 Run 保持 cancelled，关联临时 Service 自动进入清理，结果可查询且没有新模型调用

#### Scenario: Agent 在副作用附近退出
- **WHEN** 临时 Service 创建已受理而 Agent 在返回结果或清理前崩溃
- **THEN** 原 Run 按既有规则 interrupted，已受理临时 Service 继续自动收尾，不重放创建或原 prompt

#### Scenario: 用户仅断开观察
- **WHEN** Run 仍在执行但浏览器或 CLI 停止观察
- **THEN** 不因观察断开取消 Run 或提前结束其仍被使用的临时 Service

### Requirement: 兼容推理按连接协议执行

**Identifier:** CONV-THINKING-COMPAT-001

系统 SHALL 为 Thinking 未确认且执行准入有效的模型提供有界、按协议区分的兼容选项。用户 SHALL 能明确选择普通模式或兼容方式与档位；兼容方式只是请求声明，不能把服务端支持标为已确认，也不能改变模型 ID、端点、凭据、图片能力、Work 默认或自动 Run 设置。

OpenAI Responses 兼容方式 SHALL 提供 Off、Minimal、Low、Medium、High、XHigh、Max，分别请求 `reasoning.effort` 的 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。Anthropic Messages SHALL 提供自适应与预算两种兼容方式：自适应提供 Off、Low、Medium、High、XHigh、Max，非 Off 使用 `thinking.type=adaptive` 与同名 `output_config.effort`；预算方式提供 Off、Minimal、Low、Medium、High，非 Off 使用 `thinking.type=enabled` 与该方式声明的正整数 `budget_tokens`。Messages 两种方式的 Off SHALL 明确请求 `thinking.type=disabled`，不携带 effort 或预算。普通模式 SHALL 不发送额外推理字段，不等同于 Off。

兼容方式 SHALL 明确其档位与请求参数映射，预算方式同时展示对应 token 预算。预算 SHALL 小于实际输出上限并为正文留出空间；无法满足时在外发前明确失败，不静默缩减预算或混同档位。SDK 初始化、模型流请求及工具续轮 SHALL 使用同一受理配置，不得夹限、覆盖或丢弃所选档位。不能用猜测型号前缀、改用另一模型或自动探测请求补齐能力。

服务端拒绝兼容参数 SHALL 形成原 Run 的可查失败及安全恢复方向，保留已选设置与输入；用户可明确改普通模式或另一兼容设置后新提交。系统 SHALL 不因参数不被接受自动降档、切换方式、删除参数重发或声称推理已生效；模型响应成功也不自动把兼容档位登记成 SDK 已确认能力。

#### Scenario: 未收录的 Responses 型号
- **WHEN** 用户为 SDK 未收录的 Responses 模型选择兼容 High 并发送
- **THEN** 使用原 Model ID/连接请求 `reasoning.effort=high`，受理事实记录兼容方式及 High，不能因 reasoning 默认 false 而丢失参数

#### Scenario: 未收录的新版 Messages 型号
- **WHEN** 用户为 SDK 未收录的 Messages 型号或别名选择自适应兼容 Max 并发送
- **THEN** 请求携带 adaptive 与 effort=max，不受内置型号名单阻断，不降为 High，也不宣称该型号已被 SDK 确认

#### Scenario: 预算推理与上下文不足
- **WHEN** 用户选择预算兼容档位并发送，实际输出空间足够或不足
- **THEN** 足够时发送界面声明的准确预算且保留正文空间；不足时明确失败且不发送被静默缩小的预算

#### Scenario: 普通模式与关闭推理不同
- **WHEN** 用户分别选择普通模式及兼容 Off
- **THEN** 前者不追加推理字段，后者按原协议请求关闭；若服务端拒绝关闭则显示失败，不能以普通请求冒充成功关闭

#### Scenario: 兼容参数被拒绝
- **WHEN** 合成模型服务拒绝兼容档位，或拒绝某种 Messages 推理方式
- **THEN** 原 Run 失败且可查，显示调整设置的方向，原偏好保留，不自动发送另一档位或普通请求

#### Scenario: 普通默认与自动执行回归
- **WHEN** 用户从未选择兼容推理，或自动 Run 使用 Thinking 未确认的 Work 默认
- **THEN** 保留原普通模式且不发送推理参数，不继承其他手动 Session 的兼容设置
