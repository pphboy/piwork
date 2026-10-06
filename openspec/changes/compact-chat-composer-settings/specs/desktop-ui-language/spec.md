# Spec Delta

## MODIFIED Requirements

### Requirement: 工作区反馈和聊天控制保持任务层级

**Identifier:** DUL-WORKSPACE-001

Desktop SHALL 用所属内容区的骨架、就地状态或控件内等待表达普通读取；对象标题、返回与独立动作始终可见，普通导航不显示通用 Check/Checked/Confirmed 条。显式刷新和恢复核对 SHALL 留在目标附近，背景正常读取静默完成。错误与未知修改 SHALL 按 DUL-003 保留原因、原身份和可执行恢复，不能为减少噪声而隐藏风险事实。

Chat Box SHALL 以文本输入与 Send 为常态的主要内容，在输入框底栏提供一个合并 Model 与 Thinking 的轻量配置摘要入口；两项字段标签和独立选择器 SHALL 只在按需展开的 Response settings 面板内呈现。摘要 SHALL 展示真实模型名称和当前 Thinking，例如 Work model · Medium，按内容占宽且不均分、铺满底栏。摘要、Input options 与 Send 在宽度足够时 SHALL 同行、等高且垂直居中；长名称先在摘要内截断，完整名称可在面板中读取，窄屏必要时允许摘要整组换行，所有必要动作仍可达。摘要 SHALL 不以默认强调色、大块背景、技术 ID 或额外常驻说明争夺输入权重。

Response settings SHALL 在同一面板中相邻呈现 Model 与 Thinking 的当前值，以现有英文文案、轻量按钮、菜单选中态和模态焦点规则完成编辑。打开或关闭面板 SHALL 不提交修改；明确选择不同值才自动保存完整设置对，不增加 Save model 或 Apply 主动作。摘要默认表达已确认设置，未确认的选择 SHALL 有明确的 Saving、Not saved 或 Unconfirmed 状态，尚无 Session 的选择 SHALL 说明用于新 Session，不将草稿设置表达为已保存。必要的失败、未知、Thinking 不可用原因及恢复入口 SHALL 在 Composer 附近持续可见，面板关闭不隐藏这些事实；正常已确认状态不增加永久成功条。

所有可输入的 Chat 容器 SHALL 共用上述层级和同一 Session 草稿。面板 SHALL 可通过键盘打开、选择与关闭，Esc 优先关闭面板并返回来源，不能同时退出 Focus chat；360px 下所有动作、状态、长名称和面板 SHALL 可达，页面无横向溢出。

工具执行 SHALL 以默认折叠的 Activity 表达，摘要包括调用数量、进行中或已结束状态和失败数量；成功不永久占用聊天正文，失败摘要不能被折叠隐藏。展开内容保持工具名、实际状态和可取得结果，折叠不隐藏正文回复。界面标签与无障碍名称 SHALL 为英文并沿用 DUL-007 的视觉令牌，360px 下控件可换行、弹层可达且不产生整页横向滚动。

#### Scenario: 打开已有内容并后台更新
- **WHEN** 用户返回已读取的 Work 模块且后台正在更新
- **THEN** 标题与旧内容仍可阅读，取得时间和局部更新状态可查看；完成后内容更新且没有通用检查条或成功播报

#### Scenario: 输入和执行详情共存
- **WHEN** 用户阅读回复、工具仍在运行并切换下一条消息的模型或 Thinking
- **THEN** 正文和输入保持主要空间，Activity 显示真实进度，设置反馈归属当前 Chat Box，不把临时选择描述为已确认事实

#### Scenario: 窄屏与键盘操作
- **WHEN** 用户在 360px 宽度用键盘打开设置或展开工具详情
- **THEN** 焦点可见且控件完整可达，长工具名和模型名不撑宽页面，动态提示遵守减少动态效果设置

#### Scenario: Composer 常态突出输入
- **WHEN** 用户在 Agent 辅助栏、常规 Chat 或 Focus chat 输入普通消息，模型与 Thinking 已确认
- **THEN** 输入区域与 Send 保持主要层级，底栏只有一个呈现两项当前值的低权重配置摘要，没有两个常驻字段标签、铺满底栏的配置栏目或永久保存成功条

#### Scenario: 按需调整成组配置
- **WHEN** 用户通过摘要打开 Response settings
- **THEN** 同一面板相邻显示 Model 与 Thinking 的当前值，并可进入各自真实选项；使用既有按钮、选中态和焦点规则，打开不保存，关闭返回来源且保留草稿

#### Scenario: 收起面板仍能解释发送限制
- **WHEN** 偏好保存未确认、明确失败或结果未知，用户关闭设置面板
- **THEN** Composer 附近仍显示对应状态、原因与合法恢复入口；发送按真实确认状态受限，输入可编辑，不用无说明的灰色按钮或隐藏详情代替必要反馈

#### Scenario: 摘要在宽屏保持内容宽度
- **WHEN** 用户放大 Chat，当前模型名和 Thinking 都很短
- **THEN** 配置摘要只占其内容需要的宽度，Input options 与 Send 在底栏右侧，输入区不会出现两个随宽度拉开的配置字段
