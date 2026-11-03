## MODIFIED Requirements

### Requirement: Thinking 不阻断基本模型使用

**Identifier:** AIM-006

已知模型 SHALL 自动保留 SDK 已确认的真实 Thinking 档位与映射，不因自定义地址或显示名丢失。未知 Model ID SHALL 自动建立所选协议的普通消息执行定义，不要求管理员配置能力模板/JSON，也不把 Thinking 未确认当作模型不可用。

未知 Thinking SHALL 单独显示未确认，不伪造 SDK 已确认档位或已确认“不支持”；支持完整协议兼容契约的 Work SHALL 为所有执行准入有效的 openai-responses／anthropic-messages 模型提供按协议确定的兼容推理方式及档位，无论 SDK 是否收录、SDK 声明哪些等级或是否仅声明 Off；用户 SHALL 能在聊天设置中明确选择，无需管理员补填能力定义、改变 Model ID 或更新 SDK 模型目录。SDK 能力事实与协议映射 SHALL 在内部独立保留；界面合并为单一等级选择，不展示重复来源或模式，不以 SDK 能力限制协议声明等级的选择。等级选择不改变模型目录的能力事实，不显示额外能力认证说明；普通模式表示未请求额外 Thinking，不误报为已确认 Off。已有非空 Thinking 偏好不得静默降档或清除，需用户明确确认兼容设置。设置、初始化和实际请求使用一致定义，管理流程不新增默认 Thinking 档位，Test 不证明 Thinking 全能力。

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

#### Scenario: 已收录型号的兼容等级
- **WHEN** SDK 已收录某 Responses 或 Messages 型号，但其内置档位缺少某个现有协议兼容等级
- **THEN** 用户仍可选择该协议声明的兼容方式和等级并用于下一次手动 Run，SDK 档位事实不被修改，不要求升级 SDK

#### Scenario: SDK 仅声明 Off 的兼容连接
- **WHEN** SDK 对一个执行准入有效的模型仅声明 Off，而其连接使用支持的两种协议之一
- **THEN** SDK 内部事实仍如实为 Off，界面提供包含协议等级的唯一列表；真实服务拒绝兼容请求时原 Run 明确失败，不将 SDK 资料当作禁止用户请求兼容等级的依据

#### Scenario: 相同协议不依赖型号识别
- **WHEN** 用户在同一协议的已知型号、未收录型号和网关别名之间查看兼容设置，或 SDK 更新了型号资料
- **THEN** 该协议的版本化兼容方式及等级集合保持一致，已保存设置不被切换、降档或清除，管理员表单不增加能力配置步骤
