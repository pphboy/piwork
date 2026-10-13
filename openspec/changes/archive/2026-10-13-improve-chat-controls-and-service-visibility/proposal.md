# Proposal

## Why

Service 已能向 Agentd 提交请求，但 Desktop 的请求入口主要在 Chat 中，用户难以在使用 Service 时查看和取消处理。Main Chat 遇到同 Work 的活跃 Run 只能等待或另找取消入口，正文中的 Run ID 列表也干扰阅读。

初轮实现已提供上述入口、停止并发送和正文简化。追加核验发现已确认回复在读取失败时消失、后台执行覆盖当前 Chat 错误、原 Chat Retry 丢回执无法核对，以及列表取消后不跟踪终态；本次修订补齐这四项恢复行为。

上述四项恢复实施后，再次核验复现一条 Warning：More evidence 的旧响应晚到，会把已确认的 cancelled 覆盖成 cancelling；返回列表后原收尾观察已停止，状态再次卡住。本轮仅补齐这一分页并发边界，不纳入 Stop and send 初始化时序的 SUGGESTION。

## What Changes

- 在现有 Service 工具栏右侧增加 Agent requests 按钮：确认当前 Service 有任意请求记录才显示，真正空集合时隐藏；已完成、已取消和导入历史仍属于可查看记录。不增加摘要条、计数、状态卡或顶层页面。
- 复用现有请求列表与详情，Service 入口默认筛选当前 Service，提供请求内容、状态、可取得的 Agent 回复、结果与取消。保持既有 Chat 中的全 Work 请求入口、分页、历史只读及显式 Retry 能力；不新增补充对话、任务状态机或让位恢复流程。
- 在用户当前 Chat 输入区提供 Stop and send：显式取消当前 Work 中指定的旧 Run，确认执行收尾后在用户所选 Session 提交新消息。旧 Run 可以来自同一 Session、其他 Session 或 Service；取消关联未完成请求时沿用现有终止后续自动处理的语义。
- 取消等待上限设为 5 秒。失败或到期时保留消息、原 Run 和核对入口，不在稍后偷偷发送；接受响应丢失按原 submissionKey 查询。复用现有取消能力，不在本次引入执行进程隔离或强制终止任意卡死工具。
- 移除 Chat 正文中的 Run History ID 列表；实际模型、来源、Thinking、错误和历史仍可在按需详情中查询。
- 将入口位置、空态、专注布局、返回规则与取消并发送行为同时写入现有 UI 语言及功能规格，任务按这些 Scenario 验收。

- 读取关联 Run 失败时，保留原请求最后确认的回复、实际模型与 Thinking，并单独显示读取错误；不把已取得内容改成未取得。
- 全 Work 活跃 Run 继续决定 Stop and send 的明确目标；当前用户 Session 的失败与观察恢复反馈独立保留，不被后台活动覆盖。
- 补齐原 Chat 显式 Retry 的原 submissionKey 只读核对，恢复已受理的新请求；未找到映射仍保持未知，不重发 Retry。Service 新入口仍只提供查看和取消。
- 从列表取消请求后，在列表或对应详情可见时只读核对原记录直到终态，保持分页、过滤、焦点和阅读位置；关闭只停止观察。
- 证据分页返回时只向当前缓存合并证据及其分页游标，保留原请求最新确认的状态、关联 Run、结果和错误；晚分页不得回退终态或改变取消收尾观察标记。

## Capabilities

### New Capabilities

无。沿用现有 Work、Service、Session、Run 和请求记录。

### Modified Capabilities

- desktop-ui-language：明确最后确认内容保留、当前 Chat 错误与后台活动并存及列表取消后的原位收尾；补充 DUL-002 的 Service 工具栏条件入口及既有详情容器，补充 DUL-012 的显式停止并发送和按需执行信息；保持原导航、单一 Chat 输入上下文及视觉语言。
- desktop-webui：补齐关联回复读取失败保留、原 Retry 只读核对及可见列表取消收尾；细化 DWUI-FEEDBACK-001 的有记录显示、查看与取消、身份隔离和刷新；细化 DWUI-004 的 Stop and send、错误恢复及移除正文 ID 列表。
- agent-conversation：增加指定旧 Run 的取消并提交契约，明确单槽协调、5 秒取消等待、幂等、生命周期准入及旧客户端兼容。

## Impact

- Desktop：apps/desktop-webui/src/app.ts、adapter.ts、models.ts、action-state.ts，按需调整 public/style.css 及浏览器测试；构建资源同步 internal/desktopassets/static，并重新构建 Go CLI 宿主。
- Agentd：apps/agentd/src/runs.ts、brain-loop.ts、application.ts 及相关测试；Service 接收、请求与 CoreFlow/CoreLoop 继续沿用现有实现，不把业务调度移入 Go Core。
- 契约与代理：proto/agent.proto、packages/contracts、internal/agentclient、internal/coreapp/conversation.go、internal/cli/user_desktop_control.go，以及 make generate 产物和跨语言契约测试。现有 SubmitRun 增加可选取消目标与独立能力确认，增加当前 Work 活跃 Run 的只读查询，普通提交保持原行为。
- 原 Chat Retry 核对：增加受保护的只读查询，经现有 Go Core/CLI 代理到 Agentd，直接核对现有请求提交键及 retryOf 关系，不触发模型或新的 Retry。
- 存储：复用 WorkStore 的 Run、请求、活动槽和幂等映射，不新增表、请求状态或历史格式版本；完整包继续保留原事实，不恢复已取消处理。
- 使用说明：更新 docs/desktop-webui.md 的入口、Stop and send 和超时核对说明；需要修改 README 时，中英文对应更新。此次不改部署、镜像发布身份或对外发布。
