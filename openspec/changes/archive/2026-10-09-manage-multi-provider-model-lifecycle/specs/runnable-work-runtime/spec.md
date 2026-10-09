## MODIFIED Requirements

### Requirement: Keep model credentials out of public and persisted conversation data

Core SHALL 解析所选独立模型配置，将必要凭据以仅 agentd 可访问的只读 secret/private 通道传入 Work。凭据不进入 Work 元数据、Session 历史、Run 事件、错误或公开诊断。

每 Run 的显式模型 SHALL 由当前代次 Agent 经既有 mTLS 通道解析，只有该 Agent 获得当前请求所需 Key。公共列表/历史仅含安全模型描述，失效或不兼容不静默换模型。协议、精确执行定义及固定绑定只经当前 Work/代次/instance 的私有授权通道传递。

已配置的自定义 ID SHALL 在兼容 harness 中按原 Responses/Messages 协议自动注册普通消息执行，不要求用户创建 Provider 或能力模板；同一 ID 不同连接不得混用接口/Key。SDK 已知模型继续保留能力和 Thinking 映射，未知模型普通模式不发送未经确认的额外 Thinking 参数，不伪报已确认 Off。能力查询、偏好校验、初始化和执行使用一致定义，不削弱工具、历史、身份或 context 边界。

模型 Key 轮换后新获准 Run SHALL 使用当前 Key，不通过旧挂载绕过启停；已接受执行保持原协议/定义/凭据绑定，执行前准入失效安全失败，已发请求不隐式取消或重发。创建/初始化/重启/子代理材料同样依据明确模型绑定，只包含所需默认 Key，不挂载全部模型目录或秘密。

旧镜像不支持新普通注册/Thinking 契约时 SHALL 明确不兼容及升级方向，不自动更换固定镜像。新版必须能执行无 SDK 条目的合成 Model ID，不能仅通过列表投影宣称支持。

#### Scenario: Start agentd with a model credential
- **WHEN** 配置有效模型的 Work 启动
- **THEN** agentd 可初始化所选模型，公开响应不含 Key 或 secret 路径

#### Scenario: Model credential is missing or invalid
- **WHEN** 无法读取或使用必要凭据
- **THEN** readiness 或该 Run 安全失败，不泄露值、不换另一模型

#### Scenario: 接受后的模型条件发生变化
- **WHEN** 已接受尚未外发的模型被停用或其固定定义不匹配
- **THEN** 执行安全失败，已保存实际模型不被替换，旧材料不能绕过准入

#### Scenario: 同一 Work 分别使用两种协议
- **WHEN** Session 依次选择完整 Responses 和 Messages 模型
- **THEN** 请求各自使用正确路径、认证、模型定义及有效 Thinking，历史保留，只获取当前所需 Key

#### Scenario: 新 Key 与禁止旧 Key 回退
- **WHEN** 模型轮换或停用后接受新请求
- **THEN** 获准请求使用当前 Key，停用请求拒绝，不使用旧挂载继续执行

#### Scenario: 模型能力和实际请求一致
- **WHEN** 已知模型 Thinking 被受理，或未知模型普通模式被受理
- **THEN** 前者按确认映射执行，后者按原协议/ID/端点执行且记录未请求额外 Thinking，不能依赖别的模型默认值伪造事实

#### Scenario: 未知模型自动注册
- **WHEN** 用户仅提供协议、地址、Model ID 和 Key，兼容 Agent 初始化并执行
- **THEN** 普通消息可通过真实 SDK 完成，无 Provider/模板步骤；未知 Thinking 不阻断基础运行
