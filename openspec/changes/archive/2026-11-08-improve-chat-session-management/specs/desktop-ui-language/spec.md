## MODIFIED Requirements

### Requirement: Session 与 Run 的交互完整且不重复执行

**Identifier:** DUL-012

原型 SHALL 展示当前 Work 的 Session 列表、新建、读取/切换和对话提交，以及 accepted/running/cancelling/succeeded/failed/cancelled/interrupted。Session 标题 SHALL 优先显示已确认持久标题；无标题或旧 Agent 时使用已加载首消息摘要；没有摘要时按当前列表位置显示 Session 1、Session 2 等编号。一个 Work 的活跃 Run 限制 SHALL 在其他 Session 中有 busy 说明并保留草稿，不能暗示隐藏队列。

Chat 输入区 SHALL 提供独立的 Cancel run 图标动作，不以非空草稿、合法新消息或 Stop and send 能力作为可取消已确认 Run 的前提；新消息发送仍遵守原准入。独立停止与 Stop and send 的图形、提示和可访问名称 SHALL 清楚区分，二者分别绑定取消和原子交接。Cancel run SHALL 是明确请求，取消中保留状态直至终态；切换、关闭或断线不等于取消。观察恢复 SHALL 使用原 Run ID/游标，过期读结果/历史，未知不得自动重发 prompt。旧 context 导致 Session 不可用 SHALL 给原因和 New session，不能自动迁移或承诺仍可继续。stopped Work SHALL 不被承诺可以加载 Session/Run；之前加载的消息可标注为旧内容。

Chat SHALL 表达模型选择只作用于下一次新手动 Run，展示每次 Run 实际模型与用户/Service 来源。自动请求的 pending、等待、验证及终态 SHALL 与 Run 执行状态分开呈现：等待不是模型一直运行，不是手动消息隐藏队列。Cancel run 与 Cancel request SHALL 分别解释取消当前执行及直接取消请求的范围；取消有关联请求的 Run 也终止原未完成请求的后续自动处理。

当前用户 Chat 有可发送的模型输入、且同 Work 存在已确认活跃 Run 时，支持该能力的 Desktop SHALL 在原发送按钮位置提供 Stop and send，目标为用户点击时明确绑定的旧 Run。用户显式提交才请求取消，取消可以针对本 Session、其他 Session 或 Service Run，仍在用户所选 Session 发送新消息。未显式执行该动作、仅切换或输入时 SHALL 保持既有 busy 与草稿规则。取消关联未完成请求后 SHALL 不自动恢复原处理，历史与已产生业务结果保持。

取消等待和提交 SHALL 在所属消息与输入控制处表达，正常受理不重复铺回执；失败或取消等待超过 5 秒时保留待发内容并提供原状态核对，不把请求取消当作已经停止，不在超时后自动发送。普通发送、网页 slash 动作、模型设置、输入法与观察恢复 SHALL 保持原语义；旧 Agent 未确认新能力时保留原 Cancel run 及普通聊天，不暗中替换运行镜像。

Chat 正文 SHALL 不再附加按 Run ID 罗列的 Run History 列表；每次 Run 的实际模型、Thinking、来源及必要执行诊断 SHALL 通过可确认关联的按需详情保持可查。删除该展示不删除历史、不隐藏正在执行、错误或未知结果，不把历史详情的打开变成 Session 切换或新提交。

全 Work 活跃执行的来源与停止目标 SHALL 和当前用户 Session 的执行反馈分开展示。另一 Session 或 Service 占槽时，当前 Chat 原 Run 的失败、观察中断和未知提交反馈 SHALL 继续在所属输入上下文可见；核对和详情 SHALL 绑定该原 Run，Stop and send 仍只针对用户明确看到的全 Work 活跃目标。不得因为显示后台活动而移除用户错误、切换用户 Session 或将原恢复动作改绑到后台 Run。

#### Scenario: 跨 Session 遇到忙碌
- **WHEN** 同一 Work 已有活跃 Run，用户切到另一个 Session 输入
- **THEN** 看见忙碌原因、草稿与已知活动执行入口，不隐式取消原 Run 或排队新 Run

#### Scenario: 观察连接丢失
- **WHEN** 回答中连接中断
- **THEN** 显示观察中断和最后确认时间，Check status/恢复观察针对原 Run，不把执行标为失败或再次提交

#### Scenario: 取消与成功竞争
- **WHEN** 用户请求取消但 Core/agent 已记录成功终态
- **THEN** 显示真实成功，不把它强制改成取消；取消中仅在尚无终态时显示

#### Scenario: 处理记录与模型执行区分
- **WHEN** Service 请求正在等待且没有活跃 Run，用户查看 Chat
- **THEN** 可识别请求等待对象、最近确认时间和各历史 Run 的真实模型，仍可输入新手动消息

#### Scenario: 明确停止旧 Run 后发送
- **WHEN** 用户在当前 Session 输入有效消息，并点击指向同 Work 另一 Session 或 Service Run 的 Stop and send
- **THEN** 输入区显示取消等待，确认旧执行收尾后只提交一次新消息到当前 Session，原历史保留且被取消请求不自动恢复

#### Scenario: 导航与网页命令不取消 Run
- **WHEN** 用户切换 Session、编辑草稿，或执行 /new、/resume、/model、/thinking、/settings
- **THEN** 沿用原导航与设置语义，没有隐式取消或模型提交

#### Scenario: 正文简化且执行依据仍可查
- **WHEN** 用户读取包含多个 Run 的 Session
- **THEN** 正文没有 Run History ID 列表，消息与 Activity 顺序保持，真实实际模型、来源和错误可按需查看，旧关联未知时不猜测归属

#### Scenario: 后台活动不覆盖当前对话错误
- **WHEN** 当前用户 Session 的原 Run 失败或观察中断，同时另一个 Session 或 Service 有活跃 Run
- **THEN** 当前 Chat 保留原错误及原对象核对入口，同时显示后台来源和指向该后台 Run 的 Stop and send，两类动作不混用目标

#### Scenario: 空输入下取消与新提交分离
- **WHEN** 原 Run 可取消但输入为空，或用户已有下一条草稿
- **THEN** 独立停止可用且不发新消息；用户另行明确执行 Stop and send 时才原子交接，取消不消费新草稿或冒称已成功终止

## ADDED Requirements

### Requirement: Session 列表提供紧凑管理入口

**Identifier:** DUL-SESSION-MANAGE-001

Session 选择器 SHALL 在标题右侧提供紧凑 New，并在每行提供独立于选择动作的菜单，包含 Rename、Auto name、Delete。名称、选中、命名等待及目标 Run 状态 SHALL 可区分；长名称可辨且不撑破窗口。Rename 预填当前名称并支持 Enter 保存和 Esc 取消，输入法组合不提交；删除确认 SHALL 表明逻辑移除和保留范围，活跃目标的 Delete 不可用并解释原因。列表滚动、键盘焦点、失败反馈和原目标归属 SHALL 在操作前后保持可理解。

#### Scenario: 操作非当前行
- **WHEN** 用户打开非当前 Session 的菜单并取消 Rename 或 Delete
- **THEN** 不切换当前会话、不提交修改，焦点返回原操作上下文

#### Scenario: 长列表和长标题
- **WHEN** 用户滚动列表至长标题行并通过键盘打开菜单
- **THEN** 列表保留位置、焦点可见，标题和确认说明不溢出视口

#### Scenario: 命名等待与执行中并存
- **WHEN** 同一 Session 正在执行且标题生成中
- **THEN** 两种状态均可辨，Delete 保持不可用且不隐式停止执行

#### Scenario: 无持久标题的稳定回退
- **WHEN** Session 没有持久标题，或列表顺序发生变化
- **THEN** 使用已加载首条用户消息摘要；没有可用摘要时按当前列表位置显示 Session 1、Session 2 等编号；列表变化后允许重排，真实身份不变，也不为标题额外读取历史
