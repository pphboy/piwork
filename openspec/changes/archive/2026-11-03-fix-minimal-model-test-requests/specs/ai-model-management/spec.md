# Spec Delta

## MODIFIED Requirements

### Requirement: 消息 Test 独立于保存和选择

**Identifier:** AIM-003

管理员 SHALL 在新增/编辑模型表单直接 Test 当前完整草稿，或检查已保存模型；名称不是 Test 必填项，无 Provider 前置步骤。保存项省略 Key 使用当前保存值。Test SHALL 向指定 Model ID 发送固定 user 消息 `Reply OK`，通过单次 Go HTTP Responses /responses 或 Messages /v1/messages 请求取得实际 assistant 文本，路径与保存/实际执行规范化一致。 Test SHALL 使用非流式最小消息体，只包含所选模型、一条上述 user 消息及 64 个输出 token 的上限；不附加 system、工具、历史或 Thinking 配置。鉴权、客户端标识和必要的匿名会话信息 SHALL 由传输层处理，用户不需填写额外字段。

Test SHALL 不保存草稿、改默认/启停、创建 Work/Session/Run/Apply 或启动资源，不通过 Agent 执行，不自动重试。Test 成功、失败、未执行均不构成保存、启用或进入 Choose model 的门槛。网络、远端 404、认证、模型或协议失败只影响本次检查；结构错误定位字段，明确此时未外发。

Modal SHALL 展示目标、测试消息、实际回复或安全原因/恢复建议、检查时间/耗时及真实 HTTP 状态。成功须有非空 assistant 正文，不伪造 OK，不把推理/工具内容作为回复；20 秒、64 KiB 原始响应、8 KiB UTF-8 展示上限及明确截断保留。错误区分认证、模型、限流、DNS/TLS/连接、超时、供应商错误、协议不匹配、空回复和大小上限，不透传原始异常、Key、认证头或内部路径。

结果 SHALL 绑定发起草稿/保存项，输入变化或读回后标为过期。关闭、导航或身份变化后晚到结果不重新打开/覆盖新 Modal；查看旧结果不外发，不丢弃非敏感草稿。供应商 Key 错误不注销管理员，真正 Core/Console 登录失效才清理敏感内存并登录。

#### Scenario: 新增草稿直接 Test
- **WHEN** 管理员未保存模型就填写四项连接字段并 Test
- **THEN** 请求使用该模型草稿，Modal 展示真实结果，目录与默认不改变，名称留空仍可检查

#### Scenario: 失败不拦保存和选择
- **WHEN** Test 返回认证/404/网络错误后，管理员保存结构有效且启用的模型
- **THEN** 模型保存并进入 Choose model，错误事实单独保留，不需要先获得成功 Test

#### Scenario: 原协议与结果边界
- **WHEN** 两种协议分别返回正常文本、空/推理/工具内容、超大回复或安全错误
- **THEN** 按实际协议提取和分类，截断明确，私有材料不回显，不能仅凭 2xx 显示成功

#### Scenario: 最小推理请求
- **WHEN** 管理员在任一模型入口显式发起新的 Test
- **THEN** 系统向指定模型发送一次固定 `Reply OK`，使用当前协议的最小消息体、64 个输出 token 上限及非流式模式，不调用 Agent 或创建业务会话，页面显示同一实际测试消息

### Requirement: 标准协议驱动的供应商无关消息 Test

**Identifier:** AIM-007

模型 Test 的协议、连接目标、模型与凭据 SHALL 以用户所选的 `anthropic-messages` 或 `openai-responses` 以及草稿或保存项的 Base URL、Model ID 和 Key 为准，遵循相应官方协议的请求路径、鉴权、请求结构及可见 assistant 文本响应语义。Messages 的根地址、末尾 `/v1` 与尾斜杠形式 SHALL 保留前缀且解析为同一 `/v1/messages`；Responses SHALL 在 API base 后追加 `/responses`。Test、模型保存与实际执行 SHALL 对同一输入使用一致的协议、规范化端点、模型和凭据绑定。

Test SHALL 保持所选协议、鉴权与模型；传输层 SHALL 为预先确认的兼容端点自动提供必要的匿名客户端会话信息，且在首次外发前完成准备。端点匹配 SHALL 使用规范化后的精确主机、协议和路径范围，其他端点不附加该兼容信息；不得从上游任意错误文本动态决定头部或自动重试。用户无需填写供应商、SessionID 或自定义请求头。Test SHALL 保持 AIM-003 的单次消息、独立保存、超时、响应大小与秘密保护约束。Test SHALL 如实呈现单次请求得到的实际非空 assistant 文本或可安全表达的失败类别和真实 HTTP 状态，不把原始上游敏感文本回显，也不把上游通用鉴权错误断言为 Key 一定无效。

Test 成功 SHALL 仅证明当前短消息请求取得协议规定的非空 assistant 文本，MUST NOT 声称流式输出、工具调用或完整聊天已通过；失败 SHALL 不断言实际聊天必然失败。Test 和聊天使用不同执行路径时，其事实与边界 SHALL 可辨。

标准响应携带非空 assistant 文本但标明生成未完成或达到输出 token 限额时，Test SHALL 展示已有文本并标识回复不完整或已截断；上游未完成和显示长度截断 SHALL 不被描述为必然只由显示上限造成。未完成响应没有可见 assistant 文本时仍 SHALL 报告空回复。

#### Scenario: Messages 等价地址和标准请求
- **WHEN** 管理员使用同一自定义路径的 Messages 根地址、末尾 `/v1` 或尾斜杠形式测试相同模型和 Key
- **THEN** 每次仅发送一次标准 Messages 请求到相同的单个 `/v1/messages` 路径，保留自定义前缀和所选模型，展示真实 assistant 文本或实际失败

#### Scenario: Responses 标准请求
- **WHEN** 管理员选择 Responses 并填写 API base、模型和 Key 发起 Test
- **THEN** 系统向该 API base 的 `/responses` 发送一次符合 Responses 协议的消息请求并按协议解析实际回复

#### Scenario: 相同协议不随服务商改变
- **WHEN** 两个不同主机提供同一所选标准协议并收到相同模型测试参数
- **THEN** 两次请求遵守同一协议语义，消息体、鉴权、模型与单次请求语义不随服务商改变；只有命中明确兼容范围的端点附加必要匿名会话头，其他端点不附加

#### Scenario: 真实响应和有限结论
- **WHEN** 端点返回非空 assistant 正文、空正文、工具或推理内容、错误响应或非法协议响应
- **THEN** 仅非空 assistant 正文判定本次 Test 成功，其他情况呈现安全失败事实；结果不宣称完整聊天、工具或流式能力通过

#### Scenario: 上游鉴权失败
- **WHEN** 上游以 HTTP 401 或 403 拒绝 Test
- **THEN** 结果保留实际状态并说明请求的鉴权或权限遭拒，不泄露 Key、原始认证头或任意上游私有内容，不断言 Key 本身必定无效

#### Scenario: 输出限额产生不完整正文
- **WHEN** Responses 返回 `incomplete` 并包含非空 assistant 正文，或 Messages 以 `max_tokens`、`model_context_window_exceeded` 停止且包含非空 assistant 正文
- **THEN** Test 展示实际正文并标记不完整或截断，不误报协议不匹配；没有 assistant 正文时报告空回复

#### Scenario: Test 与实际执行绑定一致
- **WHEN** 测试并保存相同的协议、等价 Base URL、Model ID 和 Key，随后发起获准的普通聊天
- **THEN** Test 与聊天使用各自执行路径中的相同协议、规范化目标、模型和对应凭据；各自结果分别报告

#### Scenario: 无额外输入的匿名请求上下文
- **WHEN** Test 的规范化目标命中需要会话标识的兼容范围
- **THEN** 系统为该次显式 Test 生成新的匿名临时标识并在第一次请求中附加所需会话头，不持久创建业务会话、不复用用户或 Work 身份，不要求管理员补填字段

#### Scenario: 相似地址不获得兼容信息
- **WHEN** 目标为相似主机名、不受支持的路径或协议
- **THEN** 系统继续按所选协议处理或按现有 URL 校验拒绝，不误加另一端点的兼容会话头，也不携凭据跟随重定向

#### Scenario: 用户端点真实最小推理成功
- **WHEN** 用户提供的 `https://opencode.ai/inference/go/anthropic`、`deepseek-v4.1-flash` 与有效 Key 已在对照请求中成功，管理员在新构建页面显式点击 Test
- **THEN** Piwork 实际发送一次 `Reply OK` 请求，获得真实 HTTP 200 和可见 `OK` 回复，保存配置与已有 Work 不受影响；curl 或合成服务成功不能替代该页面验收

### Requirement: 独立模型的管理员 API 与兼容迁移

**Identifier:** AIM-API-001

管理员 API SHALL 在 /api/v1/admin 提供 POST/GET models、GET/PATCH models/:id、POST models/:id/enable、POST models/:id/disable、DELETE models/:id 和 POST model-tests；公共 DTO 不包含 Provider、能力 JSON 或秘密。Model ID 与可选显示名最大 256 字符，相同 ID 允许独立连接。普通用户只选择获准模型，不能调用管理 API。

创建输入 SHALL 为 `{model, api, baseUrl, credential, name?}`；读取的平铺模型字段为 `id/name/model/api/baseUrl/modelRef/enabled/credentialAvailable/createdAt/updatedAt`。PATCH 至少提供 model/api/baseUrl/credential/name 中一项，省略 Key 保留、显式空 Key 拒绝、空 name 恢复完整 Model ID。Test 接受完整 `{api,baseUrl,model,credential}` 草稿，或 `{modelId,api?,baseUrl?,model?,credential?}` 的保存项覆盖，省略字段采用已保存值而不泄漏 Key。

Responses SHALL 在 API base 后追加 /responses；Messages 根地址和等价末尾 /v1 规范化为一个 /v1/messages 并保留网关前缀。除 loopback HTTP 外要求 HTTPS，拒绝完整请求路径、内嵌凭据、query/fragment。型号/协议/实际端点改变发布新的执行引用，等价 Messages 地址、改名、Test 与 Key 轮换不改已捕获引用。

模型 Test SHALL 使用表单覆盖和当前/已有 Key 发一次 `Reply OK` 请求，不自动重试或携凭据跟随重定向；20 秒、响应 64 KiB、安全助手文本 8 KiB，非空助手文本即可，空/reasoning/工具结果不算成功。Test 不保存草稿、不改变默认、不启动 Work，也不是保存/启用门槛；供应商认证失败不注销管理员，弹窗晚到响应不重开，旧结果可查看并标明陈旧。

旧 Provider 子模型 SHALL 事务且幂等迁移为独立连接，保留有效启用、Key、引用、Work 捕获和显式定义，无子模型不猜测。升级前停止并备份配套数据/卷，旧二进制不直接打开新 registry。未显式选择兼容推理的未知 Thinking 使用 Normal/null，旧缺省 Off 和自动 Run 的普通模式不混同；chat contract 3 的 reader 与快照完整保留 null，导入使用目标唯一匹配模型及其 Key，源授权不迁移。

新 Test 结果的 `testMessage` SHALL 为 `Reply OK`；配套 reader SHALL 同时接受已有 `Reply with OK.` 结果并按原值展示，新请求不得继续发送旧提示词。此兼容读取不改变保存项、Key、modelRef 或历史内容。

#### Scenario: 新旧测试消息读取兼容
- **WHEN** 新 reader 分别收到新 `Reply OK` 结果与已有 `Reply with OK.` 结果
- **THEN** 两者均按真实返回内容展示，旧结果保留原测试消息，下一次显式 Test 只发送 `Reply OK`

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec
