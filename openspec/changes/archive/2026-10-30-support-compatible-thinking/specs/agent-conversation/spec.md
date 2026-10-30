# Spec Delta

## MODIFIED Requirements

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


### Requirement: 原生 Core 与 SDK 会话的协商和冷恢复

**Identifier:** CONV-ADAPTER-001

Core SHALL 负责用户授权、desired/active 与代次、Docker 和路由准入，完整 TS Agent 保持 SDK、Session/Run、模型/工具、MCP 与私有历史。只有当前 ready 代次 mTLS 通过才转发 Session/Run；观察断线只结束观察，明确 cancel 才中止执行。稳定 SDK Session ID 和历史路径 SHALL 可在另一进程恢复，路径存在不能冒充 SDK 已持久化消息。

可选聊天能力 SHALL 独立协商，未知/旧 Agent 继续基本聊天且新控件明确不可用，不自动换镜像。模型、Thinking、资源命令和原键查询按有效 agent-conversation / ai-model-management 契约；当前 nullable 和兼容推理行为使用 chat contract 4，不以旧文档的 contract 1 或 history schema 4 作为当前上限。Run 固定受理设置和来源，执行前核对同一模型与凭据描述，不替换失效模型。

资源命令 SHALL 仅从 validated active 资源发现，text 禁止 slash 展开，command 只执行已确认资源，旧省略行为保持；未知提交只查原键不自动重发。工具历史 SHALL 保持安全顺序块、原 Run 关联和 UTF-8 64 KiB 有界预览，不公开完整参数、原始 Thinking、凭据或私有路径。当前 Agent 的受管历史 SHALL 使用 schema 7 与独立 Memory schema 1，已知 schema 4/5/6 按各自定义静态读取和导入，不能把过期十三表描述当成当前数据库定义。升级及回退遵循 CONV-SNAPSHOT-001，不降低原身份、授权或结果未知保护。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec


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

## ADDED Requirements

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
