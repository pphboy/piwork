# Design

## Context

动机与范围见 `proposal.md`。本设计落实 `specs/desktop-ui-language/spec.md` 的 DUL-WORKSPACE-001 与 `specs/desktop-webui/spec.md` 的 DWUI-MODEL-001。

已核对的实现依据：

- `apps/desktop-webui/src/app.ts` 的 `modelComposer()` 为两个按钮各渲染字段标签、当前值和下箭头；`modelFeedback()` 将保存、能力与恢复状态留在 Composer 附近。
- `apps/desktop-webui/public/style.css` 的 `.chat-options` 与 `.chat-picker` 使用伸展布局；420px 以下又把整组选项放到独立行。等高已有保障，短内容仍会随 Chat 宽度被拉开。
- `openChatPicker()`、`modalMarkup()`、`closeModal()` 与根节点键盘处理已提供原生 dialog、菜单选项、Esc 优先关闭和焦点恢复，但默认假定 Model 与 Thinking 是两个不同的弹层。
- `adapter.ts` 已按 Core/账号、Work、Session 管理模型目录、能力及完整设置对，串行保存、保护未知结果，并协调新 Session 草稿设置。此次复用该状态来源。
- `recovery.test.ts` 已覆盖设置对串行、丢失响应、实际 SDK 档位、命令、Focus 和 iframe 保持；现有几何测试主要验证四个独立按钮等高、对齐与 360px 可达，尚不能证明配置的视觉层级合适。

## Goals / Non-Goals

**Goals:**

- 明确常态摘要、成组编辑、暂存选择与确认事实之间的关系，保持一次设置只有一个状态来源。
- 在现有 UI 角色、模态管理和浏览器构建中实现；对齐结果有逐项依据，也有实施后的验收证据。
- 将面板、命令、键盘及错误恢复的行为决定在编码前明确。

**Non-Goals:**

- 不改模型目录/能力/偏好/Run 的后端接口、持久化、单 Work 单活跃 Run 或授权边界。
- 不合并 Input options，不修改 Service identity、slash 参数处理、Activity、Work Settings 或全局样式令牌。
- 不新增状态缓存、UI 框架、浮层依赖、设计系统或独立设置页面。

## Decisions

### 1. 常态采用一个摘要，底栏分成配置与发送动作两组

摘要使用真实模型名与 Thinking 值，例如 `Work model · Medium`，可访问名称包含 `Response settings`、模型、Thinking 和 `For your next message`。Work default 的实际名称沿用 `modelDisplayName()`；内部修订、ID、凭证不进入摘要。两项字段标签只在面板内出现。

局部样式复用 `.button.quiet`：高度 31px、字号 12px、圆角 8px，与现有 Input options 和 Send 等高；默认无填充强调色和可见控件边框，hover、focus 和选中反馈使用已有角色。摘要按内容占宽，最大宽度 320px，并受底栏实际可用宽度约束；仅模型名称优先省略，Thinking 与下箭头保留。

底栏左侧是摘要，右侧将 Input options 与 Send 放在同一动作组，以组外自动间距分开两侧。右侧动作组不收缩，组内使用现有 6px 间距；删除旧的两项均分和 420px 强制配置整行规则。空间不足时摘要整体换行，不能把两项再次摊成独立字段；整页不能横向溢出。完整模型名在面板内换行可读，tooltip 只是补充。

```text
+------------------------------------------------+
| Ask anything about this Work...                |
|                                                |
| [Work model / Medium v]     [Options] [Send]    |
+------------------------------------------------+
```

采用单摘要是因为配置低频且两项关联。两个紧邻小按钮虽可减少距离，仍会保留两个常态编辑入口；纯图标会让发送前核对当前值多一步，因此此次采用可读摘要。

### 2. 统一面板沿用现有居中原生 dialog

新增一个 `chat-response-settings` 面板，复用现有 `#modal` 外壳、header、body、footer、遮罩、Close 和焦点管理，不新增锚定 popover 或嵌套 dialog。摘要触发按钮使用稳定的 `response-settings-trigger` 身份。沿用现有面板宽度 `min(520px, calc(100vw - 32px))`、窄屏边距与最大视口高度；正文和选项支持局部滚动。

面板标题为 `Response settings`，说明为 `For your next message`；尚无 Session 时增加 `For new session`。顶部两行相邻呈现 `Model` 与 `Thinking` 当前值，采用现有轻量选择按钮与边框分隔，不增加卡片。两行保留在同一组；当前展开的选项区域位于其后，一次只有一个列表。长名称可换行，列表最大高度为 `min(240px, 40dvh)` 并局部滚动，极矮窗口仍可滚动面板正文。

```text
+----------------------------------------+
| Response settings                  [x] |
| For your next message                  |
|                                        |
| Model       [Work model v]             |
| Thinking    [Medium v]                 |
| -------------------------------------- |
| Thinking                               |
| [ ] Off                                |
| [ ] Low                                |
| [x] Medium                             |
| [ ] High                               |
|                                [Close] |
+----------------------------------------+
```

图中档位仅示意；实际选项完全来自当前模型能力。模型列表含 `Use Work default` 和其真实模型名，覆盖列表空时仍保留已确认的默认模型。

面板本地状态放入既有 `view.data`，包含 `workId`、`sessionId`、打开来源与展开目标，不保存第二份模型/Thinking 值：

| 动作 | 展开状态及结果 |
| --- | --- |
| 摘要打开 | 两行当前值；无展开列表；焦点进入 Model 行，可编辑性不足时进入恢复或 Close |
| 点击 Model / Thinking 行 | 展开该项并收起另一项；再次点击同一行收起；不保存 |
| 明确选择不同值 | 调用已有选择方法，收起列表，面板保持，焦点返回对应值行 |
| 明确选择相同完整设置 | 不保存；已确认的对应网页命令可完成；面板保持 |
| Close / Esc | 关闭面板，不取消、撤销或重放保存；按来源恢复焦点 |
| 对象或身份改变 | 关闭原面板，不恢复旧对象焦点、不重开旧面板 |

保留面板便于连续调整相关配置。采用 Close 表达自动保存后的关闭；不提供含糊的 Cancel。采用现有居中 dialog 是为了沿用当前菜单的焦点、键盘和小屏行为；未来改锚定浮层需要单独设计焦点与边界，不纳入此次范围。

### 3. 摘要与面板共用确认状态和恢复路径

摘要、两行当前值、展开列表和状态说明均读取 `adapter.modelSelection()`、目录、能力与原 Session 的确认值。现有 `modelFeedback()` 的状态归属继续有效，提取共用的状态表达供面板使用；不要在 UI 本地重建保存协调。

| 现有状态 | 可见值与说明 | 修改与发送 |
| --- | --- | --- |
| `clean` 且能力已确认 | 已确认模型与 Thinking；没有永久 Saved 条 | 按原模型可用性和 Run 准入 |
| 无 Session 的 `dirty` | 草稿选择与 For new session | 可调整；明确 Send/New session 才创建 |
| `saving` | 最新待确认选择与 Saving… | 可继续选择；保存协调串行；消息发送受限 |
| 明确保存失败的 `dirty` | 保留选择、Not saved 与安全原因、Retry settings | 原已确认偏好仍保留；发送不能依赖未确认值 |
| `unknown` | 保留选择、Unconfirmed 与 Check chat settings | 摘要可打开；两项修改和发送受限；只读核对原 Session |
| 首次目录加载或失败 | Loading models 或读取原因、Retry models；旧值标为最后已知 | 不构造可用选项；确认前发送与实际编辑受限 |
| 仅支持 Off / 能力缺失 / 未确认 | 分别为 Off 与不支持原因、Unavailable 与 Work 能力原因、Unconfirmed 与能力原因 | 只限制不可用项；兼容基础模型聊天仍按既有契约 |

保存中、明确失败、未知、模型不可用和 Thinking 必要原因在 Composer 附近持续可见。面板打开时恢复动作在面板内也可达，使用同一状态文本与行动；外部和内部不重复 live 播报。普通成功由新确认值承接，关闭面板不制造 toast 或读取成功流水。

同值判断基于完整设置对和当前待保存状态。已确认同值不 PATCH；未保存同值不能假装已经确认，继续保留原恢复。模型变化造成档位调整时沿用 `selectModel()` 的真实默认档位与说明，完整设置对仍走现有保存序列。核对成功使用原 Session 返回的实际完整设置，不能自动重发保留选择。

### 4. 网页命令和键盘接入同一面板

`openChatPicker()` 调整为统一面板的入口：摘要打开不展开列表，`/model` 与 `/thinking` 明确执行后分别直接展开模型或档位列表。能力不足时仍打开同一面板，给出原因与恢复动作，不把命令变成仅聚焦一个禁用控件，也不消费未完成命令。

列表沿用 `role=menu`、`menuitemradio`、勾选图标与当前选中背景；行按钮有 `aria-expanded` 和对应列表关联。箭头及 Home/End 限于当前展开列表，Enter/Space 明确选择，Tab/Shift+Tab 沿用模态焦点限制。直接展开后聚焦已选项或首个可用项；不能编辑时聚焦对应恢复入口或 Close。保存响应只更新内容，保持展开目标和有效焦点；仅当前焦点因状态变化失效时转到面板中对应恢复或关闭动作。

`focusReturn` 使用稳定来源：摘要为 `#response-settings-trigger`，网页命令为 `#composer`，避免返回已经收起的菜单项或旧按钮。关闭时校验对象/身份；保留输入光标及阅读锚点。Esc 处理先于 Focus/覆盖层返回，输入法组合期间 Enter 不选择或发送。

命令选择继续使用 `pendingWebCommand`、完整设置对比与原草稿相等检查，确认前保留命令，可靠确认后只消费仍相同的原输入；重复选择已确认值可完成命令而不 PATCH。关闭前未选择则清理未开始的命令等待，但草稿不清除；已选择但尚未确认则继续沿原保存结果处理，用户后续新输入不被清除。打开和关闭面板都不提交 Run。

### 5. UI/UX 对齐核对与验收

| 维度与基线 | 本设计的对齐方式 | 实施后的验收依据 |
| --- | --- | --- |
| 任务层级：DUL-010、DUL-WORKSPACE-001 | 输入和 Send 优先，低频设置常态只有一个内容宽度摘要 | 短名称宽屏截图与摘要宽度断言；没有两个常驻字段 |
| 对象和容器：DUL-002、DUL-012 | 同一 Work/Session，辅助栏、常规 Chat、Focus chat 共用 | 布局切换不创建 Session/Run，草稿和阅读位置保持 |
| 视觉角色：DUL-007、DUL-WORKSPACE-002 | 复用共享颜色、字体、边框、8px 圆角、quiet 按钮和菜单选中态；只加局部布局 | 与现有 Input options、Session 菜单并排检查 hover、focus、disabled；不靠降低对比度弱化配置 |
| 状态和恢复：DUL-003、DWUI-019、DWUI-MODEL-001 | 关闭后仍显示必要状态与原对象恢复，已确认值代替成功流水 | 延迟、拒绝、丢失响应、只读恢复的现有 fixture 与 PATCH/Run 计数 |
| 焦点和键盘：DUL-007、DWUI-FOCUS-001 | 同一原生 dialog、可见焦点、来源返回、Esc 优先级、IME 保护 | 纯键盘路径、Focus 下 Esc、参数与草稿保留 |
| 长内容和窄屏：DUL-WORKSPACE-002 | 摘要收缩、名称局部截断、完整值在面板可读、动作组不收缩 | 1440px、Agent 辅助栏实际宽度、Focus chat、360px、矮视口；无整页横向滚动 |
| 命令兼容：DWUI-COMMAND-001 | 原两条命令直达对应真实选项，只有成功消费原命令 | 当前受理 Run 不变、未知命令保留、同值确认没有 PATCH |

核对结论：该方向与现有产品层级、视觉角色、状态语义和容器边界对齐。DUL-WORKSPACE-001 与 DWUI-MODEL-001 原有底栏并列选择器及相应场景需要替换，本变更两份 delta 已明确该变化；DUL-WORKSPACE-002 等其余约束继续适用。本阶段确认的是设计与规范的一致性，尚未实现的新界面不能标为浏览器或视觉验收已通过。

实施时在 `verification/uiux/` 保存正常摘要、展开面板、长名称和错误恢复的截图，在 `verification.md` 记录上述矩阵的实际结果。视觉验收必须看实际浏览器页面：自动几何断言不能替代输入优先、配置成组和控件一致性的检查。

## Risks / Trade-offs

- 合并后改变配置多一步打开面板 → 符合低频定位；两项同组编辑，网页命令仍直达选项。
- 重绘、选项收起或旧触发按钮移除导致焦点失效 → 使用稳定摘要/输入来源，选择后回到值行，响应更新保持有效焦点，并回归 Focus 的 Esc 优先级。
- 收纳配置时误将保存未知或禁用原因一并隐藏 → 原 Composer 状态持续呈现，面板复用恢复路径，未知结果不开启修改或发送。
- 现有测试辅助函数默认选择后弹层关闭 → 显式区分面板内连续选择与关闭回到 Composer，保持原失败/串行/命令测试语义，不通过删除断言规避失败。
- 超长名称或局部窄列挤走发送 → 摘要限宽和名称截断，动作组不收缩；面板局部滚动与完整名称读取纳入验收。

## Migration Plan

1. 只修改 Desktop 的渲染、入口、局部样式和对应浏览器测试，复用既有 adapter；不修改共享令牌或任何服务端契约。
2. 更新设置选择辅助函数和有变化的布局/命令断言，执行 Desktop 类型检查、构建与浏览器回归。
3. 完成 UI/UX 矩阵的实际浏览器截图及检查记录；确认设置动作不重载 Service iframe，不影响当前 Run。
4. 用既有构建脚本同步 Go 内嵌静态资源并验证嵌入包。发布回退恢复旧渲染、样式和相应生成资源即可；没有数据迁移，已保存完整设置对继续兼容。
