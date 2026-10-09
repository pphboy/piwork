## MODIFIED Requirements

### Requirement: 在同一 Session 为下一次手动 Run 选择模型

**Identifier:** CONV-MODEL-001

获准用户 SHALL 查询当前 Work 的安全模型列表并设置 Session 的完整模型/Thinking 偏好。完整模型配置经启用、凭据和实际环境兼容性准入后进入可选列表，自定义 ID 不因 SDK 未收录、Thinking 未确认或无模板被过滤。相同 Model ID 的不同配置须可安全区分；公开列表不含 Key、端点、secret 路径或内部执行定义。真正停用、无凭据或旧环境不兼容须说明原因和恢复方向，列表加载、空集合、读取失败与偏好不可用分别表达。

用户 SHALL 保留同一 Session 历史，在下一次手动 Run 使用所选模型；偏好与实际模型描述持久保存，不改 Work active/desired、pendingApply 或 Session context。已接受 Run 固定模型与有效 Thinking，自动执行忽略 Session 偏好而使用 active 默认；默认停用不妨碍查询/选择其他可用覆盖。新 Session 默认使用 Work 默认，目录/名称修改不重写既有历史。

Work default 选项、Response settings 和聊天输入区域 SHALL 明确展示该 Work 当前捕获描述中的实际 `model`，并与友好名称及“Work default”身份区分。目录名称或当前 head Model ID 变化不能使旧捕获默认只显示新名称而掩盖实际型号。使用现有安全公开字段；不得暴露端点/Key/私有定义，不能通过显示修复自动改变 modelRef、Work 配置、Session 偏好、Thinking 或历史；长 Model ID 在窄屏保持完整身份可访问。

SDK 已知模型 SHALL 提供实际确认的 Thinking 档位和建议值，已确认不支持只允许 Off；未知档位/不兼容设置原子拒绝，不能只保存模型。已有模型专用入口保留原 Thinking，不兼容则明确拒绝，不能静默清除。能力查询、设置校验和执行共用同一解析定义，已知兼容模型的 reasoning/映射不能丢失。

未知 Model ID SHALL 自动支持所选协议的普通消息执行，Thinking 单独标为 unknown，thinkingLevels 为空、thinkingLevel=null 表示未请求额外 Thinking；不把此状态伪装为已确认 Off 或已确认不支持。新建未知默认/覆盖 Session 可直接普通发送，无能力 JSON 或管理员设置步骤。已有非空 Thinking 与未知模型不兼容时保留原偏好并明确提示，用户显式确认普通模式后才原子保存新设置；模型仍可选择，不能被整个隐藏。

完整设置对 SHALL 仅作用于下一次新手动 Run，保存与受理交错须捕获完整旧组或新组。已知 Thinking 实际作用于请求，允许 Off 的模型应明确关闭，不仅记录本地值；普通模式不附加未经确认的 Thinking 参数，也不宣称供应商内部推理已关闭。自动 Run 使用 active 默认的原已知行为，未知默认使用普通模式，不继承聊天覆盖。

缺少 Thinking 的旧 Session/Run SHALL 按旧 Off 解释，旧模型实际不接受 Off 时要求显式修复，不改历史。新 null 普通记录与缺省旧记录严格区分，不根据当前目录回写。新 Desktop 初始草稿使用已知默认的确认建议值，未知默认为普通模式，通过显式创建/发送确认完整设置。

Test SHALL 不作为聊天准入或 Thinking 证明。执行配置改变发布新选择引用，旧覆盖明确不可用，不静默迁移；停用/删除后保留偏好、Thinking、草稿与历史。已经受理 Run 不随目录变化，同键重放先返回原事实，不因当前失效重执行或换模型。公开输出不含推理原文或新增凭据材料。

新 nullable/unknown 行为 SHALL 明确协商版本并同步客户端/历史验证；旧环境不支持时给出升级方向，不误投影为 Off。兼容新版环境中，自定义模型必须完成真实 SDK 普通消息执行，不能只出现在下拉。

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
- **WHEN** 提交已知模型不支持的 Thinking 或未知模型的未经确认非空档位
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
- **WHEN** 用户发送已知模型支持的 Off 或非 Off，或未知模型的普通消息
- **THEN** 前两者请求与受理档位一致，普通消息不加入未经确认的参数；三者记录分别真实，既有 Run 不改变

#### Scenario: 能力未知与不支持区分
- **WHEN** 一个模型 Thinking 未确认，另一个被 SDK 确认不支持
- **THEN** 前者可普通聊天并显示 unknown/null，后者明确 Off；不能伪造相同能力或隐藏前者

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
