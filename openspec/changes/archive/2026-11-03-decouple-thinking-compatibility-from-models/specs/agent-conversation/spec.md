## MODIFIED Requirements

### Requirement: 在同一 Session 为下一次手动 Run 选择模型

**Identifier:** CONV-MODEL-001

获准用户 SHALL 查询当前 Work 的安全模型列表并设置 Session 的完整模型/Thinking 偏好。完整模型配置经启用、凭据和实际环境兼容性准入后进入可选列表，自定义 ID 不因 SDK 未收录、Thinking 未确认或无模板被过滤。相同 Model ID 的不同配置须可安全区分；公开列表不含 Key、端点、secret 路径或内部执行定义。真正停用、无凭据或旧环境不兼容须说明原因和恢复方向，列表加载、空集合、读取失败与偏好不可用分别表达。

用户 SHALL 保留同一 Session 历史，在下一次手动 Run 使用所选模型；偏好与实际模型描述持久保存，不改 Work active/desired、pendingApply、Session 身份或既有历史。已接受 Run 固定模型与有效 Thinking，自动执行忽略 Session 偏好而使用 active 默认；默认停用不妨碍查询/选择其他可用覆盖。新 Session 默认使用 Work 默认，目录/名称修改不重写既有历史。

Work default 选项、Response settings 和聊天输入区域 SHALL 明确展示该 Work 当前捕获描述中的实际 `model`，并与友好名称及“Work default”身份区分。目录名称或当前 head Model ID 变化不能使旧捕获默认只显示新名称而掩盖实际型号。使用现有安全公开字段；不得暴露端点/Key/私有定义，不能通过显示修复自动改变 modelRef、Work 配置、Session 偏好、Thinking 或历史；长 Model ID 在窄屏保持完整身份可访问。

SDK 已知模型 SHALL 提供实际确认的 Thinking 档位和建议值；SDK 已确认不支持时，其 SDK 档位组只提供 Off。执行准入有效且使用两种支持协议之一的模型 SHALL 同时提供该协议的兼容方式与档位，不以 SDK 收录状态或 SDK 档位作为兼容选择的准入条件。不在所选 SDK 能力或兼容推理方式中声明的档位/不兼容设置 SHALL 原子拒绝，不能只保存模型；未明确选择兼容方式时不得借兼容能力放行 SDK 不支持的档位。已有模型专用入口保留原 Thinking，不兼容则明确拒绝，不能静默清除。能力查询、设置校验和执行共用同一解析定义，已知兼容模型的 reasoning/映射不能丢失。

未知 Model ID SHALL 自动支持所选协议的普通消息执行，Thinking 能力单独标为 unknown，SDK 确认档位为空、默认 thinkingLevel=null 表示未请求额外 Thinking；兼容推理方式和可请求档位 SHALL 单独提供，只有用户明确选择档位并由系统确定合法内部方式后才允许非空 Thinking；不把此状态伪装为已确认 Off 或已确认不支持。新建未知默认/覆盖 Session 可直接普通发送，无能力 JSON 或管理员设置步骤。已有非空 Thinking 与未知模型不兼容时保留原偏好并明确提示，用户显式确认普通模式或完整兼容推理设置后才原子保存新设置；模型仍可选择，不能被整个隐藏。

完整设置 SHALL 包含模型、Thinking 档位和兼容推理方式（若有），作为同一个原子偏好保存；兼容方式 SHALL 随 Session 及受理时 Run 快照保留。完整设置对 SHALL 仅作用于下一次新手动 Run，保存与受理交错须捕获完整旧组或新组。已知 Thinking 与显式兼容 Thinking 实际作用于请求，允许 Off 的模型应明确关闭，不仅记录本地值；普通模式不附加未经确认的 Thinking 参数，也不宣称供应商内部推理已关闭。自动 Run 使用 active 默认的原已知行为，未知默认使用普通模式，不继承聊天覆盖。

缺少 Thinking 的旧 Session/Run SHALL 按旧 Off 解释，旧模型实际不接受 Off 时要求显式修复，不改历史。新 null 普通记录与缺省旧记录严格区分，不根据当前目录回写。新 Desktop 初始草稿使用已知默认的确认建议值，未知默认为普通模式，通过显式创建/发送确认完整设置。

Test SHALL 不作为聊天准入或 Thinking 证明。执行配置改变发布新选择引用，旧覆盖明确不可用，不静默迁移；停用/删除后保留偏好、Thinking、草稿与历史。已经受理 Run 不随目录变化，同键重放先返回原事实，不因当前失效重执行或换模型。公开输出不含推理原文或新增凭据材料。

nullable/unknown 及兼容推理行为 SHALL 明确协商版本并同步客户端/历史验证；chat contract 5 SHALL 声明已知与未知模型均按协议提供兼容选项，contract 0–4 保留各自既有语义；旧环境不支持时给出升级方向，不误投影为 Off。兼容新版环境中，自定义模型必须完成真实 SDK 普通消息与显式兼容推理执行，不能只出现在下拉。旧写请求省略兼容字段 SHALL 保持原解释；当前偏好已有兼容方式时，省略字段的写请求 SHALL 原子拒绝，不清除原偏好。新版写请求使用 `thinkingProfile:null` 明确清除兼容方式，字符串表示明确选择兼容方式；读取和历史在无兼容方式时省略该字段。历史 SHALL 保持原解释，不能借非空档位隐式启用兼容方式；旧 Agent 不支持时明确拒绝新设置并保留原偏好。

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
- **WHEN** 未显式选择兼容方式却提交已知模型不支持的 Thinking 或未知模型的非空档位，或提交兼容方式与协议/档位不匹配的设置
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
- **WHEN** 用户发送 SDK 已知档位、未知模型的普通消息，或任一准入模型的显式协议兼容推理
- **THEN** 已知和兼容请求分别与受理档位及方式一致，普通消息不加入额外推理参数；各自记录真实，既有 Run 不改变

#### Scenario: 能力未知与不支持区分
- **WHEN** 一个模型 Thinking 未确认，另一个被 SDK 确认不支持
- **THEN** 前者默认可普通聊天并显示 unknown/null，后者的 SDK 档位明确 Off；两者在支持完整兼容契约时均提供各自协议的兼容选项，不伪造相同 SDK 能力或隐藏任一合法兼容入口

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
- **THEN** 已有兼容设置和历史保留原方式及映射，用户明确切换才能采用 SDK 能力；新会话沿用该 SDK 的已知默认行为，并继续提供完整协议兼容选择

#### Scenario: 已知模型首次保存兼容设置
- **WHEN** 新 Session 使用 SDK 已知模型，用户首次选择协议兼容方式及 SDK 档位未列出的合法等级
- **THEN** 完整设置原子保存，下一次 Run 固定该方式和等级；不得要求该 Session 先前已保存相同 profile，或先换成未知型号

#### Scenario: 同协议与跨协议更换模型
- **WHEN** 用户更换模型并明确确认兼容设置，目标与原模型使用相同协议或不同协议
- **THEN** 相同协议的合法 profile 和档位可在新模型上确认保存；跨协议错误组合原子拒绝并保留原设置，用户明确选择目标协议设置后才保存，不隐式转换方式

### Requirement: 兼容推理按连接协议执行

**Identifier:** CONV-THINKING-COMPAT-001

系统 SHALL 为所有执行准入有效的 openai-responses／anthropic-messages 模型提供有界、按协议区分的兼容选项。兼容方式与档位集合 SHALL 只由连接协议及版本化兼容定义确定，不因模型 ID、名称、SDK 收录状态、SDK reasoning 标记或 SDK 档位列表改变；已知模型仅声明 Off 也不得隐藏或拒绝该协议的合法兼容选择。用户 SHALL 能保留原设置或选择单一 Thinking 等级，系统根据后端声明确定其内部方式；兼容方式只是请求声明，不能把服务端支持标为已确认，也不能改变模型 ID、端点、凭据、图片能力、Work 默认或自动 Run 设置。

OpenAI Responses 兼容方式 SHALL 提供 Off、Minimal、Low、Medium、High、XHigh、Max，分别请求 `reasoning.effort` 的 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。Anthropic Messages SHALL 提供自适应与预算两种兼容方式：自适应提供 Off、Low、Medium、High、XHigh、Max，非 Off 使用 `thinking.type=adaptive` 与同名 `output_config.effort`；预算方式提供 Off、Minimal、Low、Medium、High，非 Off 使用 `thinking.type=enabled` 与该方式声明的正整数 `budget_tokens`。Messages 两种方式的 Off SHALL 明确请求 `thinking.type=disabled`，不携带 effort 或预算。普通模式 SHALL 不发送额外推理字段，不等同于 Off。

兼容方式 SHALL 明确其档位与请求参数映射，预算方式在内部保留对应 token 预算。预算 SHALL 小于实际输出上限并为正文留出空间；无法满足时在外发前明确失败，不静默缩减预算或混同档位。SDK 初始化、模型流请求及工具续轮 SHALL 使用同一受理配置，不得夹限、覆盖或丢弃所选档位。用户明确选择兼容方式时，其已受理协议映射 SHALL 优先于 SDK 内置的模型专用 Thinking 映射；未选择兼容方式的旧 SDK 设置保持原映射。不能用猜测型号前缀、改用另一模型或自动探测请求补齐能力。

服务端拒绝兼容参数 SHALL 形成原 Run 的可查失败及安全恢复方向，保留已选设置与输入；用户可明确改普通模式或另一兼容设置后新提交。系统 SHALL 不因参数不被接受自动降档、切换方式、删除参数重发或声称推理已生效；模型响应成功也不自动把兼容档位登记成 SDK 已确认能力。

#### Scenario: 未收录的 Responses 型号
- **WHEN** 用户为 SDK 未收录的 Responses 模型选择兼容 High 并发送
- **THEN** 使用原 Model ID/连接请求 `reasoning.effort=high`，受理事实记录兼容方式及 High，不能因 reasoning 默认 false 而丢失参数

#### Scenario: 未收录的新版 Messages 型号
- **WHEN** 用户为 SDK 未收录的 Messages 型号或别名选择自适应兼容 Max 并发送
- **THEN** 请求携带 adaptive 与 effort=max，不受内置型号名单阻断，不降为 High，也不宣称该型号已被 SDK 确认

#### Scenario: 预算推理与上下文不足
- **WHEN** 用户选择预算兼容档位并发送，实际输出空间足够或不足
- **THEN** 足够时发送内部方式定义的准确预算且保留正文空间；不足时明确失败且不发送被静默缩小的预算

#### Scenario: 普通模式与关闭推理不同
- **WHEN** 用户分别选择普通模式及兼容 Off
- **THEN** 前者不追加推理字段，后者按原协议请求关闭；若服务端拒绝关闭则显示失败，不能以普通请求冒充成功关闭

#### Scenario: 兼容参数被拒绝
- **WHEN** 合成模型服务拒绝兼容档位，或拒绝某种 Messages 推理方式
- **THEN** 原 Run 失败且可查，显示调整设置的方向，原偏好保留，不自动发送另一档位或普通请求

#### Scenario: 普通默认与自动执行回归
- **WHEN** 用户从未选择兼容推理，或自动 Run 使用 Thinking 未确认的 Work 默认
- **THEN** 保留原普通模式且不发送推理参数，不继承其他手动 Session 的兼容设置

#### Scenario: SDK 已知但等级不足
- **WHEN** 用户对 SDK 已知 Responses 模型选择兼容 XHigh 或 Max，而 SDK 原档位未包含该值
- **THEN** 原连接请求对应的 reasoning.effort=xhigh 或 max，受理事实与实际请求一致，不能夹限为 High 或拒绝首次保存

#### Scenario: 仅 Off 模型的显式兼容请求
- **WHEN** SDK 声明某已知 Messages 模型只有 Off，用户明确选择自适应兼容 Max 或预算兼容 High
- **THEN** 分别请求 adaptive 与 effort=max，或 enabled 与该方式声明的准确预算；SDK reasoning 标记不删除参数，服务端是否接受按原 Run 实际结果记录

#### Scenario: 模型专用映射与兼容映射
- **WHEN** 一个模型的 SDK 默认映射会改写 Thinking 请求，用户分别发送原 SDK 设置及显式协议兼容设置
- **THEN** 前者保留既有模型专用行为，后者在首轮和工具续轮均严格使用所选协议兼容定义，不被模型专用映射再次改写

#### Scenario: 固定兼容等级与未来扩展
- **WHEN** 当前 SDK 更新模型目录，或调用者提交尚未声明的新等级、新 profile 或任意推理参数
- **THEN** 现有版本化兼容等级与映射保持不变，未声明输入原子拒绝；新增等级须由后续显式适配变更提供，不从模型名称、返回内容或浏览器自由输入自动扩展

### Requirement: 新聊天能力可被安全发现并独立降级

**Identifier:** CONV-CHAT-CAPABILITY-001

获准调用者 SHALL 能确认当前 Work 是否支持基础命令、模型 Thinking 能力、完整 Session 设置和结构化工具历史；新能力是可选的增量契约，不能使原本满足现有运行契约的旧 Agent 失去基本聊天或 Service 准入。缺少能力确认 SHALL 明确返回不支持，不能伪造空目录、Off 已保存或成功响应，也不能自动替换固定镜像。

chat contract 5 SHALL 明确提供不依赖 SDK 模型识别的协议兼容选择；目录中的已知模型可同时携带 SDK 档位与后端声明的兼容方式，未知模型保留 unknown、空 SDK 档位与 null 默认。当前客户端 SHALL 继续读取 contract 0–4，并按原版本和实际目录提供已有能力；不能向旧 Agent 合成未声明选项、伪报新版能力或删除 profile 后假装保存成功。未知未来版本 SHALL 不被推断为已支持当前可选功能。

所有新增读取与修改 SHALL 沿用 Work 所有者授权、交互范围、active context、实际运行实例和 Session 归属规则；模型设置修改只对可继续的 Session 有效，历史读取保持原只读资格。旧实例/旧身份的晚响应不能归属新对象。公开目录、能力、设置和历史 SHALL 不返回宿主路径、凭据路径、密钥、内部 context identity 或配置修订。

#### Scenario: 旧 Agent 正常聊天
- **WHEN** Work 的固定 Agent 支持原聊天但未声明新能力
- **THEN** 原聊天、模型入口和 Service 访问仍按原能力可用，新功能明确显示不可用，不尝试升级镜像

#### Scenario: 越权及实例变化
- **WHEN** 非所有者读取命令或修改设置，或请求期间 active 实例被替换
- **THEN** 按原授权或实例规则拒绝，不泄露新旧对象私有信息，不接受旧实例返回值为新实例事实

#### Scenario: 新版目录包含已知与未知模型
- **WHEN** Work 声明 chat contract 5，其目录同时包含 SDK 已知、未知和仅 Off 的两种协议模型
- **THEN** 每个合法模型均提供对应的完整兼容方式，SDK 能力字段保持各自真实含义，空覆盖列表但默认有效时仍提供默认模型的兼容选择

#### Scenario: 旧 Agent 的兼容边界
- **WHEN** 当前客户端连接 contract 3、contract 4 或不认识的未来版本 Agent
- **THEN** contract 3 保留原普通／SDK 能力，contract 4 保留其实际声明的未知模型兼容选择；缺失的完整协议兼容能力明确指向更新 Work Agent，未来版本不冒充已支持，不自动 Apply 或阻断原基本聊天

### Requirement: 原生 Core 与 SDK 会话的协商和冷恢复

**Identifier:** CONV-ADAPTER-001

Core SHALL 负责用户授权、desired/active 与代次、Docker 和路由准入，完整 TS Agent 保持 SDK、Session/Run、模型/工具、MCP 与私有历史。只有当前 ready 代次 mTLS 通过才转发 Session/Run；观察断线只结束观察，明确 cancel 才中止执行。稳定 SDK Session ID 和历史路径 SHALL 可在另一进程恢复，路径存在不能冒充 SDK 已持久化消息。

可选聊天能力 SHALL 独立协商，未知/旧 Agent 继续基本聊天且新控件明确不可用，不自动换镜像。模型、Thinking、资源命令和原键查询按有效 agent-conversation / ai-model-management 契约；nullable／未知能力和原有兼容行为继续读取 chat contract 3／4；不依赖 SDK 模型识别的完整协议兼容选择使用 chat contract 5，不以旧文档的 contract 1／4 或 history schema 4 作为当前上限。Run 固定受理设置和来源，执行前核对同一模型与凭据描述，不替换失效模型。

资源命令 SHALL 仅从 validated active 资源发现，text 禁止 slash 展开，command 只执行已确认资源，旧省略行为保持；未知提交只查原键不自动重发。工具历史 SHALL 保持安全顺序块、原 Run 关联和 UTF-8 64 KiB 有界预览，不公开完整参数、原始 Thinking、凭据或私有路径。当前 Agent 的受管历史 SHALL 使用 schema 7 与独立 Memory schema 1，已知 schema 4/5/6 按各自定义静态读取和导入，不能把过期十三表描述当成当前数据库定义。升级及回退遵循 CONV-SNAPSHOT-001，不降低原身份、授权或结果未知保护。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec


## ADDED Requirements

### Requirement: 唯一 Thinking 等级保留确定请求映射

**Identifier:** CONV-THINKING-SELECTION-001

系统 SHALL 按已声明的 SDK 档位及协议 profile 元数据提供单一等级选择，同一等级只出现一次。新选择优先使用该等级的 SDK 映射，否则使用协议目录中第一个包含该等级的 profile；未声明的等级仍拒绝。当前等级已有合法 profile 时，重复确认 SHALL 保留原方式，不能以界面去重为由清除偏好或改写历史。未知模型 Normal 与 Off 保持原语义，服务端拒绝仍形成原 Run 失败且不自动换参重发。

#### Scenario: 已保存预算 High 的重复确认
- **WHEN** 原 Session 的 High 使用预算 profile，而目录中的 High 默认选择 SDK 或自适应映射
- **THEN** 用户看到唯一 High 且其已选，重复确认不改变保存方式，不重新 PATCH；明确选择其他等级才采用对应的新选择映射
