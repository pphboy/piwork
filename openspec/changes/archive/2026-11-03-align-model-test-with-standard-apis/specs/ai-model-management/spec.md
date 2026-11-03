# Spec Delta

## ADDED Requirements

### Requirement: 标准协议驱动的供应商无关消息 Test

**Identifier:** AIM-007

模型 Test SHALL 仅依据用户所选的 `anthropic-messages` 或 `openai-responses` 协议及模型草稿或保存项的 Base URL、Model ID 和 Key 构造请求，遵循相应官方协议的请求路径、鉴权、请求结构及可见 assistant 文本响应语义。Messages 的根地址、末尾 `/v1` 与尾斜杠形式 SHALL 保留前缀且解析为同一 `/v1/messages`；Responses SHALL 在 API base 后追加 `/responses`。Test、模型保存与实际执行 SHALL 对同一输入使用一致的协议、规范化端点、模型和凭据绑定。

Test SHALL 不因服务商、域名或模型名称添加专有请求头、选择不同鉴权、替换模型或改变请求协议；用户无需提供供应商专用配置。Test SHALL 保持 AIM-003 的单次消息、独立保存、超时、响应大小与秘密保护约束。Test SHALL 如实呈现单次请求得到的实际非空 assistant 文本或可安全表达的失败类别和真实 HTTP 状态，不把原始上游敏感文本回显，也不把上游通用鉴权错误断言为 Key 一定无效。

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
- **THEN** 两次请求遵守同一协议语义，系统不依据域名、供应商或模型名插入专有请求行为

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
