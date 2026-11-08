## ADDED Requirements

### Requirement: Session 标题持久化与并发保护

**Identifier:** CONV-SESSION-TITLE-001

系统 SHALL 在 Work 私有范围持久保存 Session 标题及其来源和修订身份，重启、受控升级与导出导入后保持。手动 Rename SHALL 校验非空名称及长度，使用目标 Work/Session 和条件修订防止并发覆盖；失败或未知结果不得伪报成功。无标题的旧 Session SHALL 使用 Desktop 定义的回退显示。

每个 Session 的首轮用户对话回复完成后，系统 SHALL 基于该轮已确认实际模型发起一次有界模型标题生成；失败、超时或模型不可用 SHALL 保留当前名称且不影响对话。生成请求 SHALL 仅使用有界的首轮必要文本，不执行工具、不创建用户可见 Run、不更改模型选择。用户 SHALL 可显式触发 Auto name；手动 Rename 后隐式自动结果 SHALL NOT 覆盖手动名称，但显式 Auto name 可更新。生成结果 SHALL 核对原身份、目标仍有效及标题修订；过期结果 SHALL 丢弃。

#### Scenario: 自动命名与手动改名竞争
- **WHEN** 首轮自动命名仍在进行时用户手动保存名称
- **THEN** 手动名称立即生效并跨重启保留，迟到的自动结果不能覆盖；用户之后仍可显式 Auto name

#### Scenario: 模型不可用
- **WHEN** 标题生成失败、超时或模型不可用
- **THEN** 原标题保持，对话可继续，显式 Auto name 可重试，不重发聊天消息

#### Scenario: 跨客户端条件写入
- **WHEN** 两个客户端基于同一旧标题修订提交不同名称
- **THEN** 已提交的新名称不被旧修订静默覆盖，冲突方能够读取当前结果

### Requirement: Session 可逻辑删除且保留执行证据

**Identifier:** CONV-SESSION-DELETE-001

系统 SHALL 提供按 Work/Session 身份的逻辑删除，普通会话列表不再返回已删除会话，新的对话提交及标题修改 SHALL 拒绝该目标。删除 SHALL 保留 SDK 历史、Run、幂等记录、Request、Evidence 和 Memory 引用以及 Work 文件；既有受授权证据和原提交结果仍可核对。删除 SHALL 在服务端事务中核对目标 Run，accepted、running 或 cancelling 时拒绝；存在可能继续向该会话提交的未完成请求且安全性不能确认时 SHALL 拒绝，不隐式取消或续接。写入结果未知 SHALL 可只读核对，不能自动重放其他目标。

#### Scenario: 删除有历史的会话
- **WHEN** 用户确认删除没有活跃执行的 Session
- **THEN** 会话从普通列表移除且不能继续，Work 文件、Memory 及其证据仍可验证

#### Scenario: 执行中删除
- **WHEN** 目标 Session 的 Run 为 accepted、running 或 cancelling
- **THEN** 服务端拒绝删除，不取消该 Run、不更改会话或其他会话

#### Scenario: 删除与迟到命名竞争
- **WHEN** 逻辑删除完成后，原自动命名结果到达
- **THEN** 结果不能恢复或重命名已删除 Session

### Requirement: 会话管理能力和历史格式兼容

**Identifier:** CONV-SESSION-COMPAT-001

系统 SHALL 明确提供标题和删除能力确认；旧 Agent 不支持时，客户端 SHALL 保留可用的创建、列表和读取，不虚称管理操作成功或自动更换 Agent。Work history 格式升级 SHALL 依现行受控备份、无活跃执行、验证和回滚流程进行；旧格式的静态读取和离线导入保持原格式，显式 Apply 才迁移。新格式 SHALL 防止旧 Agent 忽略删除标志或破坏标题和证据。

#### Scenario: 旧 Agent 未支持管理
- **WHEN** Desktop 连接未声明会话管理能力的旧 Agent
- **THEN** 创建、读取与切换保持可用，Rename、Auto name、Delete 显示不可用及原因

#### Scenario: 受控升级与导出导入
- **WHEN** 含标题、已删除会话和 Memory 证据的 Work 经升级、导出及导入后重新启动
- **THEN** 标题与删除语义、原 Session/Run 身份、提交键和 Memory 证据一致；失败时恢复原备份

## MODIFIED Requirements

### Requirement: Restore private conversation history with scoped identity

**Identifier:** CONV-SNAPSHOT-001

完整包 SHALL 保留 Session/Run 行、全部已保留 events、SDK history 文件、幂等记录和上下文关系，不要求重新对话。导入仅映射结构化 work_id/context_identity 及声明的事件身份字段；Session/Run 局部 ID、时间、文本、工具结果和 SDK 消息树不变。历史控制 Operation 使用新全局 ID 保存为只读历史，不进入执行队列；用户正文中的原 ID 保持原样。

控制历史 SHALL 复用现有 OperationRecord 归档，requestJson/resultJson/errorJson 字符串原样保存，不实现逐 kind 的递归字段迁移；仅新查询身份及归属重新分配。未知历史 kind SHALL 作为标签保留，不能分派执行，也不能仅因没有对应迁移器而丢弃或阻止完整导出。原生 create-work 即使 work_id 为 NULL，也 SHALL 按控制幂等 resourceId 关联纳入。历史控制幂等记录只读归档，源主体匿名化，不恢复源权限或 live 幂等命中。再次导出 SHALL 同时包含已导入和本实例新增的历史。

已终态 Run SHALL 保持终态，导入不执行工具、不调用模型、不重放提交键；非终态历史使包校验失败。Session 继续按所属 Work 当前已验证 active context 受理新 Run；Session 不绑定创建时环境，旧 Run 保持原环境事实。读取与继续均按新 Work 所有者授权。存在受管 sqlite 时，其 schema/path/外键必须验证，不能执行包携带 SQL、触发器或任意宿主路径；active=null 且主文件/WAL/SHM 全部缺席表示尚无私有 Session/Run 历史，导入保持缺席，首次显式 start 按正常路径初始化。

所有者 SHALL 能通过 import-provenance 查询导入包 digest、import Operation ID 和源到目标历史 Operation ID 映射，再用既有 operation show 读取映射后的终态安全投影。此历史查询不触发执行，非所有者管理员也不得读取该 provenance；源用户/平台 secret 信息不在响应中。

系统 SHALL 完整保留 schema 4 的现有模型选择、实际模型、安全执行来源、反馈关联与采用经验版本；新 harness 使用 history schema 8，保留 schema 5 的独立 Memory 绑定与新 Run 实际提供的 entryId/截断信息，以及 schema 6 的部分回复检查点。已知 schema 4 的导入按原格式静态校验并保留固定运行镜像，不在导入时升级；采用新 harness 的受控迁移遵守 WMEM-005。新增反馈图及导入历史的执行边界遵守 PWORK-BRAIN-001。平台派生身份不从源环境恢复为 live 权限。


当前 Agent SHALL 使用 history schema 8，保留 schema 7 已移除 `sessions.active_context_identity` 的结构及 `runs.context_identity`，并增加 Session 标题、来源、修订、命名状态、逻辑删除标记及原管理操作回执，Memory 保持 schema 1。schema 4/5/6/7 SHALL 作为精确已知历史输入，按各自声明的结构与语义静态校验和导入，保留源格式与固定镜像；导入不升级历史。用户显式 Apply 新 Agent 时 SHALL 按 WMEM-005 在无活跃执行、完整备份后将 4/5/6/7 转换到 8；4/5/6 删除 Session 创建环境绑定，7 保持其既有环境语义。迁移 SHALL 保留原 Session ID、SDK 文件、Run 执行事实、幂等及 Memory 引用，不回填兼容推理偏好或为旧 Session 伪造持久名称。升级失败恢复原备份；成功后拒绝仅支持 schema 4/5/6/7 的 Agent 直接运行新格式。

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
- **THEN** 静态导入保留源格式和固定镜像，仅按声明映射归属，不执行旧 Run；显式升级到 schema 8 后删除该 Session 环境列，原 Session 可按当前 Work 准入继续，旧 Run 环境差异仅作历史事实保留

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

#### Scenario: schema 7 静态保留与显式升级
- **WHEN** 合法 schema 7 包离线导入，随后用户显式 Apply 使用 schema 8 的 Agent
- **THEN** 导入阶段保留版本 7 和固定镜像；Apply 在无活跃执行、完整备份后升级到 8，Session/Run、SDK 历史、幂等和 Memory 保持，失败恢复原数据，成功后拒绝仅支持 7 的旧 Agent

### Requirement: 新聊天设置保持现有完整包格式与安全恢复

**Identifier:** CONV-CHAT-HISTORY-001

新增 Session Thinking、Run 实际 Thinking 和输入解释模式 SHALL 随原模型选择、实际模型、幂等记录及 SDK history 持久保存，daemon 重启和完整包导出导入后保持同一含义。系统 SHALL 沿用 CONV-SNAPSHOT-001 的现行 history schema 8 并静态兼容已知 schema 4/5/6/7、storage layout 2 和 .work formatVersion 1，不为图片新增 SQL schema、存储卷、导入迁移、自动回放或 SQL 执行入口；可选结构化字段缺省按前述旧行为解释，未知字段和非法值仍拒绝。

导入后保持原 Session/Run 局部身份、工具历史和终态，按原 Work/context 映射恢复，只在接收方权限与当前 Work 执行准入下接受新执行；schema 7/8 的 Session 不以创建时环境限制继续，新 Run 固定当前已验证 active context。已有 SQL/schema/path/外键、非终态历史拒绝、空历史及历史控制操作只读归档规则继续适用；新字段不能扩大 live 权限或作为隐式创建、调用模型和工具的依据。

图片原始内容、消息顺序、所属 Run 及幂等关系 SHALL 随原私有会话历史和完整包保留，包括尚未写入 SDK history 的已接受终态输入。用户显式在原 Session 续聊时，尚缺 SDK 消息的原已接受图文输入 SHALL 作为历史参与正确上下文，不重新执行旧 Run 或伪造旧回答；只读历史查看和重启本身不调用模型。导入后按新 Work 所有者读取，不依赖原 Desktop 缓存、源 Core、公网 URL 或共享 workspace 文件。新图片记录的合法性与摘要一致性 SHALL 在 TS/Go 冷历史验证中保持一致；未声明新图片记录的旧历史继续原静态兼容，不重写历史正文。


schema 6/7/8 中的兼容 Thinking 方式和档位 SHALL 按同一会话及 Run 身份完整保存；schema 4/5 不接受它们尚未声明的兼容推理语义。旧数据在导入和升级时均不回填该设置。

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

### Requirement: 原生 Core 与 SDK 会话的协商和冷恢复

**Identifier:** CONV-ADAPTER-001

Core SHALL 负责用户授权、desired/active 与代次、Docker 和路由准入，完整 TS Agent 保持 SDK、Session/Run、模型/工具、MCP 与私有历史。只有当前 ready 代次 mTLS 通过才转发 Session/Run；观察断线只结束观察，明确 cancel 才中止执行。稳定 SDK Session ID 和历史路径 SHALL 可在另一进程恢复，路径存在不能冒充 SDK 已持久化消息。

可选聊天能力 SHALL 独立协商，未知/旧 Agent 继续基本聊天且新控件明确不可用，不自动换镜像。模型、Thinking、资源命令和原键查询按有效 agent-conversation / ai-model-management 契约；nullable／未知能力和原有兼容行为继续读取 chat contract 3／4；不依赖 SDK 模型识别的完整协议兼容选择使用 chat contract 5，不以旧文档的 contract 1／4 或 history schema 4 作为当前上限。Run 固定受理设置和来源，执行前核对同一模型与凭据描述，不替换失效模型。

资源命令 SHALL 仅从 validated active 资源发现，text 禁止 slash 展开，command 只执行已确认资源，旧省略行为保持；未知提交只查原键不自动重发。工具历史 SHALL 保持安全顺序块、原 Run 关联和 UTF-8 64 KiB 有界预览，不公开完整参数、原始 Thinking、凭据或私有路径。当前 Agent 的受管历史 SHALL 使用 schema 8 与独立 Memory schema 1，已知 schema 4/5/6/7 按各自定义静态读取和导入，不能把过期十三表描述当成当前数据库定义。升级及回退遵循 CONV-SNAPSHOT-001，不降低原身份、授权或结果未知保护。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec
