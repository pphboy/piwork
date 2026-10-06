# Spec Delta

## MODIFIED Requirements

### Requirement: Chat 模型选择遵守下一次受理语义

**Identifier:** DWUI-MODEL-001

Desktop SHALL 在现有 Chat Box 输入框底部用一个轻量摘要呈现当前 Session 的下一次手动 Run Model 与 Thinking，点击摘要在同一 Response settings 面板中编辑两项，来源为 Go Core 与实际 SDK 共同确认的可用模型，包含 Use Work default。模型与 Thinking SHALL 作为完整设置对自动保存，不要求另按 Save model；保存 Session 偏好 SHALL 不触发 Apply、重建 Session、取消 Run 或立即发送消息。已受理 Run 的实际模型与 Thinking SHALL 保持不变；自动请求 SHALL 使用该 Run 受理时 Work active 默认模型及其兼容旧行为的 Thinking，不继承手动 Session 偏好。选择器及详情 SHALL 不公开密钥、私有路径或绑定凭证。

加载、保存、发送、错误和恢复 SHALL 沿用 DWUI-011、012、014、017、018、019 的对象归属、即时反馈、身份隔离及原 ID 规则。偏好保存尚未确认时 SHALL 不受理依赖该新选择的发送；失败保留草稿与已确认偏好，不将 UI 临时选项当作服务端事实。失效模型 SHALL 明确阻止新受理并提示选择可用项，不静默换模型。模型或偏好读取晚返回 SHALL 不覆盖切换后的 Work/Session；已受理的提交即使刷新失败也 SHALL 保留 Run ID 和 submissionKey，不重发 prompt。

偏好保存响应丢失或无法确认是否已写入时 SHALL 显示结果未知并保留原 Session 和所选值；Check chat settings SHALL 读取原 Session 的实际完整偏好，不重新发送 PATCH 或 prompt。确认当前偏好之前 SHALL 禁止依赖该保存结果发送；查询失败保持未知和草稿，明确拒绝且可证明未写入时才恢复原已确认偏好。

Thinking 可选档位 SHALL 仅来自当前真实模型的能力，不显示硬编码的通用档位。不能选择 Thinking 的模型 SHALL 显示 Off 和不可用原因；模型切换需要调整不兼容档位时，SHALL 在保存前显示目标模型提供的默认档位及调整说明，保存返回值才成为确认事实。模型覆盖列表为空但 Work 默认已确认可用时 SHALL 仍允许选择默认及发送。当前已保存值不可用时 SHALL 明确要求用户选择，不能静默回退。

快速连续选择 SHALL 在原 Session 内按完整设置对协调；上一请求未确认时保留最新选择，不并行提交可能互相覆盖的保存。发送 SHALL 等待最新选择可靠确认；未知结果阻止后续自动保存和发送，重查得到实际完整设置后由用户明确处理尚未保存的选择。切换 Work/Session 不丢草稿，不用晚响应覆盖新对象，也不为界面切换自动提交未开始的保存。

尚无 Session 时 SHALL 允许在 Work 的输入草稿上选择设置，说明用于新 Session；用户显式 Send 或 New session 才创建一次 Session并确认设置对。创建或保存结果未知时保留原身份、提交键和草稿，按原结果只读核对，不再次创建或发送。当前 Run 占用期间下一条设置可变更，但发送仍遵守单 Work 单活跃 Run。

打开选择器 SHALL 不立即改变设置；只有明确选择才触发保存。控件、菜单和错误恢复 SHALL 支持键盘且保持输入草稿。新聊天能力缺失时 SHALL 保留既有基础聊天与模型能力，Thinking 入口说明此 Work 不支持，不将缺失能力等同于 Off 已保存。
合并摘要、Input options 与 Send SHALL 组成输入框内同一底栏；Model 与 Thinking 不再作为两个独立字段常驻 Composer。摘要 SHALL 按内容占宽，宽度足够时所有底栏动作同行、等高并垂直居中；长名称在摘要中截断且不能挤走发送，完整名称在设置面板内可读取。360px 下所有必要动作和错误恢复 SHALL 可达且无整页横向滚动，局部空间不足时可让摘要整组换行，不能恢复两个平铺字段。打开面板不修改，Esc 或 Close 只关闭面板并返回来源；/model 与 /thinking SHALL 打开同一面板并直接展开对应的真实选项，不能只停在一个未展开按钮。

模型和档位 SHALL 以固定 Pi SDK 的已确认能力结合 Core 准入为准，不为让 Thinking 可点击而补通用档位。能力未确认、真正不支持、新契约缺失分别说明；已确认支持多个档位时必须可直接选择、保存并用于下一次真实请求，SDK/配置修订不成为默认模型标签。

Response settings SHALL 持续显示相邻的 Model 与 Thinking 当前值行，一次只展开其中一项的选项列表；点击当前展开行可收起列表，切换另一行只改变展开目标，不保存。摘要直接打开时 SHALL 先显示两行当前值，不默认展开长选项列表。模型选项 SHALL 包含 Use Work default 及其真实模型名称；Thinking 档位仅来自当前所选模型的已确认能力。

明确选择不同值后 SHALL 自动保存完整设置对、收起该选项列表并保留面板，焦点返回对应当前值行；选中值与保存中状态立即可辨。选择与当前完整设置相同的值 SHALL 不产生重复保存；由 /model 或 /thinking 发起且原设置已经确认时，这种明确确认可完成对应网页命令。Close 或 Esc 在选择之后 SHALL 不撤销、取消或重新提交已经发出的保存，面板不提供暗示撤销自动保存的 Cancel 动作。保存期间仍允许按原协调规则继续选择不同值。

摘要在模型目录加载、读取失败、偏好保存中或结果未知时 SHALL 仍可打开，以查看当前值、限制及恢复入口；能力和确认状态只限制实际修改与发送。首次未确认目录不得展示虚构选项或将错误当成空模型列表，已有旧值 SHALL 标为未确认或最后已知；已确认只有 Work default 的目录仍可正常选择和发送。结果未知时面板中两项修改 SHALL 禁用，原 Session 的 Check chat settings 仍可用。目录失败提供 Retry models，明确保存失败提供 Retry settings，所有恢复只作用于原上下文，不自动发送消息。

摘要与面板 SHALL 显示同一设置状态。正常状态使用已确认值；保存中、明确未保存和结果未知时可展示保留的最新选择，但 SHALL 同时明确其未确认状态，不能据此声称下一条消息已经可以使用该值。保存中、失败、未知、模型不可用、Thinking 真正不支持或能力未确认的必要状态与原因 SHALL 在面板关闭后仍留于 Composer 附近；尚无 Session 时显示 For new session。正常已确认状态不保留永久 Saved 条。

面板 SHALL 将当前展开列表的已选项作为初始焦点，未选中时使用首个可用项；从摘要直接打开时焦点进入 Model 当前值行，若该行不可编辑则进入可用的恢复入口或 Close。上下键及 Home/End 只移动当前列表的焦点，不改变设置；Enter/Space 明确选择，Tab/Shift+Tab 按面板焦点顺序导航。不可编辑项 SHALL 紧邻说明原因，不构造通用 Thinking 档位。直接摘要打开的面板关闭后焦点返回摘要，网页命令打开的面板关闭后返回 Composer；输入法组合期间 Enter 不选择或发送，Esc 只关闭面板而不同时退出专注布局。

面板状态 SHALL 归属打开时的 Core/账号、Work 和 Session。切换身份、Work、Session 或离开相应 Chat 时 SHALL 关闭原面板；晚结果只更新原对象，不重开旧面板或覆盖新对象草稿。/model 与 /thinking 保留 DWUI-COMMAND-001 的成功消费、取消/失败保留与原草稿比对规则；不接收额外参数，不提交 Run。Input options、Service identity 与资源命令参数边界继续遵循原规则。

#### Scenario: 当前执行中修改下一次模型
- **WHEN** 当前 Run 使用模型 A，用户保存当前 Session 的模型 B 偏好
- **THEN** 当前 Run 仍显示 A，下一次新手动 Run 在偏好保存确认后使用 B，Session 不变

#### Scenario: 偏好保存失败
- **WHEN** 用户选择 B，但保存返回鉴权或服务错误
- **THEN** 显示归属该 Session 的错误，草稿保留，后续发送不假定 B 已保存

#### Scenario: 默认与自动处理
- **WHEN** 用户将 Session 设为 Use Work default，随后有 Service 自动请求被受理
- **THEN** 手动和自动 Run 各自显示其受理时的真实模型，旧历史不随默认值变化

#### Scenario: 偏好保存响应丢失
- **WHEN** 保存可能已写入但响应丢失，随后查询也暂时失败
- **THEN** 显示未知结果并保留草稿，发送暂不可用；按原 Session 查询成功后显示其真实偏好，不重复 PATCH 或自动提交消息

#### Scenario: Thinking 与模型原子确认
- **WHEN** 用户切换模型并选择该模型支持的 Thinking，保存响应被延迟
- **THEN** 控件显示最新完整设置与保存中，输入仍可编辑，发送暂不可用；可靠确认后下一次 Run 显示真实模型和 Thinking

#### Scenario: 快速选择与跨 Session 晚响应
- **WHEN** 用户连续选择多个设置后切到另一 Session，原请求晚返回
- **THEN** 原设置只归属原 Session，当前控件和草稿不受覆盖；没有并行保存或自动向新 Session 发送

#### Scenario: 没有模型覆盖或没有 Session
- **WHEN** 已确认可用的 Work 默认模型之外没有模型，且用户还未创建 Session
- **THEN** 默认模型仍可用于草稿设置，显式发送才建立并确认一个 Session，未知响应不引发第二次创建

#### Scenario: 模型变化导致 Thinking 不兼容
- **WHEN** 用户从支持 High 的模型切换到仅支持 Off 的模型
- **THEN** 控件明确显示调整为 Off 的原因并保存完整设置对；当前 Run 的 High 保持不变，未确认前不发送

#### Scenario: 输入底栏对齐
- **WHEN** 用户在宽屏输入，或在 360px 选择长名称模型
- **THEN** 宽屏合并摘要、Input options 与 Send 同行等高并垂直居中，摘要按内容占宽；窄屏长名称仅在摘要内截断，完整名称在面板可读，所有必要控件与状态可达且无整页横向滚动

#### Scenario: Thinking 直接调整与网页命令一致
- **WHEN** 当前模型支持多个 SDK 档位，用户在设置面板展开 Thinking 或执行 /thinking
- **THEN** 同一面板中的实际档位列表打开，能选择并保存受支持值，关闭而未选择保留草稿，选择不立即发送 Run

#### Scenario: 设置菜单优先关闭
- **WHEN** 用户在 Focus chat 打开 Response settings 的 Model 或 Thinking 选项并按 Esc
- **THEN** 仅关闭设置面板并按打开来源恢复焦点，不同时退出 Focus，未知与保存中的提交保护仍成立

#### Scenario: 摘要打开与关闭不改变设置
- **WHEN** 用户有未发送草稿，点击配置摘要查看两行当前值后直接 Close 或 Esc
- **THEN** 不创建 Session、不 PATCH 偏好、不提交或取消 Run；草稿、光标、布局和阅读位置保持，焦点返回摘要

#### Scenario: 同一面板内调整两项
- **WHEN** 用户打开面板、展开 Model 选择另一模型，再展开 Thinking 选择该模型支持的档位
- **THEN** 两行当前值始终同组可见，一次只有一个列表展开；每次明确选择自动协调完整设置对，列表收起后面板保留，发送等待最新设置可靠确认

#### Scenario: 已确认值重复选择
- **WHEN** 当前完整设置已确认，用户再次明确选择相同的 Model 或 Thinking
- **THEN** 不发送新的偏好保存；从对应网页命令进入时可消费仍与原输入相同的命令草稿，没有 Run，用户新编辑的草稿不被清除

#### Scenario: 保存期间关闭并重新打开
- **WHEN** 选择模型后的保存响应被延迟，用户关闭面板、继续编辑消息并再次打开摘要
- **THEN** 保存仍属于原 Session，仅提交一次；摘要和面板都说明最新选择仍在 Saving，输入草稿不丢失，面板不重新提交选择或提前允许发送

#### Scenario: 目录首次读取与失败恢复
- **WHEN** 首次模型目录尚在读取或读取失败，用户打开摘要
- **THEN** 面板分别显示 Loading models 或读取原因与 Retry models，不显示虚构空列表；用户能关闭面板继续编辑，读恢复成功后显示真实选择，不自动发送或保存

#### Scenario: 无 Thinking 能力的命令入口
- **WHEN** 当前 Work 不支持新聊天能力、模型仅支持 Off 或 Thinking 能力未确认，用户执行 /thinking
- **THEN** 统一面板打开并显示对应禁用原因，真正不支持时显示 Off，缺失或未确认能力不伪装成已保存 Off；命令和草稿保持，没有偏好修改或 Run，关闭后仍能看到必要原因

#### Scenario: 未知结果的统一入口
- **WHEN** 保存结果未知，用户关闭并重开面板，然后执行 Check chat settings
- **THEN** 摘要仍可打开，两项修改与发送仍受限；Composer 与面板提供原 Session 的只读核对，成功后显示实际完整设置，不重复 PATCH、不自动应用保留选择、不发消息

#### Scenario: 命令直接展开与焦点返回
- **WHEN** 用户从 Composer 明确执行 /model 或 /thinking，使用上下键、Home/End 导航后关闭面板
- **THEN** 对应真实列表已展开且选项可操作，键盘移动不保存；未选择时保留原命令，关闭返回 Composer，输入法 Enter 不触发选择或发送

#### Scenario: 切换上下文与晚到保存
- **WHEN** 旧面板的设置正在保存，用户关闭面板后切换 Session、Work 或账号，旧结果随后返回
- **THEN** 旧面板不重开，当前摘要、草稿和界面状态属于新上下文；同身份的旧结果只归属原 Session，不产生另一个保存或 Run

#### Scenario: 新 Session 的草稿配置
- **WHEN** 尚无 Session，用户从摘要选择模型或 Thinking 后关闭面板
- **THEN** 摘要与附近状态说明 For new session，只有本地草稿选择改变；明确 Send 或 New session 才按原规则创建并确认一次 Session，没有后台创建或立即发送
