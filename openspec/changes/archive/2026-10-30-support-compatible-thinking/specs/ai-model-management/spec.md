# Spec Delta

## MODIFIED Requirements

### Requirement: Thinking 不阻断基本模型使用

**Identifier:** AIM-006

已知模型 SHALL 自动保留 SDK 已确认的真实 Thinking 档位与映射，不因自定义地址或显示名丢失。未知 Model ID SHALL 自动建立所选协议的普通消息执行定义，不要求管理员配置能力模板/JSON，也不把 Thinking 未确认当作模型不可用。

未知 Thinking SHALL 单独显示未确认，不伪造 SDK 已确认档位或已确认“不支持”；兼容 Work SHALL 允许用户在聊天设置中明确选择按协议提供的兼容推理方式及档位，无需管理员补填能力定义。兼容选项 SHALL 标明未确认服务端支持，不改变模型目录的能力事实；普通模式表示未请求额外 Thinking，不误报为已确认 Off。已有非空 Thinking 偏好不得静默降档或清除，需用户明确确认兼容设置。设置、初始化和实际请求使用一致定义，管理流程不新增默认 Thinking 档位，Test 不证明 Thinking 全能力。

#### Scenario: 已知模型保留 Thinking
- **WHEN** 用户通过完整模型配置选择 SDK 已知的 reasoning 模型
- **THEN** 原有真实档位与请求映射保持，无模板填写或管理员默认档位步骤

#### Scenario: 未知模型普通消息
- **WHEN** 已配置模型的 Thinking 无法确认，用户新建会话正常发送
- **THEN** 模型可选且消息按原协议/ID/端点执行，Thinking 标为未确认/未请求，不用伪造 Off 换取可执行性

#### Scenario: 旧 Thinking 偏好保留
- **WHEN** 已有非空 Thinking 设置与新选择的未知模型不兼容
- **THEN** 保留原事实并明确提示，由用户显式确认普通模式或其他兼容设置，不静默修改已有 Run

#### Scenario: 新型号无需管理员配置推理
- **WHEN** 用户选择未被 SDK 收录、使用任一现有协议的新型号或网关别名，并在聊天设置中明确选择兼容推理
- **THEN** 可保存设置并在下一次手动 Run 请求对应参数，无需改名为旧型号、配置能力 JSON、重新 Test 或调整管理员默认


### Requirement: 独立模型的管理员 API 与兼容迁移

**Identifier:** AIM-API-001

管理员 API SHALL 在 /api/v1/admin 提供 POST/GET models、GET/PATCH models/:id、POST models/:id/enable、POST models/:id/disable、DELETE models/:id 和 POST model-tests；公共 DTO 不包含 Provider、能力 JSON 或秘密。Model ID 与可选显示名最大 256 字符，相同 ID 允许独立连接。普通用户只选择获准模型，不能调用管理 API。

创建输入 SHALL 为 `{model, api, baseUrl, credential, name?}`；读取的平铺模型字段为 `id/name/model/api/baseUrl/modelRef/enabled/credentialAvailable/createdAt/updatedAt`。PATCH 至少提供 model/api/baseUrl/credential/name 中一项，省略 Key 保留、显式空 Key 拒绝、空 name 恢复完整 Model ID。Test 接受完整 `{api,baseUrl,model,credential}` 草稿，或 `{modelId,api?,baseUrl?,model?,credential?}` 的保存项覆盖，省略字段采用已保存值而不泄漏 Key。

Responses SHALL 在 API base 后追加 /responses；Messages 根地址和等价末尾 /v1 规范化为一个 /v1/messages 并保留网关前缀。除 loopback HTTP 外要求 HTTPS，拒绝完整请求路径、内嵌凭据、query/fragment。型号/协议/实际端点改变发布新的执行引用，等价 Messages 地址、改名、Test 与 Key 轮换不改已捕获引用。

模型 Test SHALL 使用表单覆盖和当前/已有 Key 发一次 Reply with OK. 请求，不自动重试或携凭据跟随重定向；20 秒、响应 64 KiB、安全助手文本 8 KiB，非空助手文本即可，空/reasoning/工具结果不算成功。Test 不保存草稿、不改变默认、不启动 Work，也不是保存/启用门槛；供应商认证失败不注销管理员，弹窗晚到响应不重开，旧结果可查看并标明陈旧。

旧 Provider 子模型 SHALL 事务且幂等迁移为独立连接，保留有效启用、Key、引用、Work 捕获和显式定义，无子模型不猜测。升级前停止并备份配套数据/卷，旧二进制不直接打开新 registry。未显式选择兼容推理的未知 Thinking 使用 Normal/null，旧缺省 Off 和自动 Run 的普通模式不混同；chat contract 3 的 reader 与快照完整保留 null，导入使用目标唯一匹配模型及其 Key，源授权不迁移。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec
