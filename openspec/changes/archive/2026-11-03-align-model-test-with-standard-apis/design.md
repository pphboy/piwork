# Design

## Context

现行 `ai-model-management` 的 AIM-003 已规定 Core 独立发送单次消息 Test。`internal/coreapp/model_test_http.go` 使用 Go HTTP 分别构造 Messages 和 Responses 请求，`model_registry.go` 及 contracts 负责地址规范化，`model_test_errors.go` 分类结果；实际聊天由 `apps/agentd/src/pi-sdk-executor.ts` 的 Pi SDK 执行。前者为非流式短消息，后者可包含流式输出及工具，二者不应被描述为相同完整能力。

现有代码和合成测试已覆盖基本路径、鉴权、回复解析和秘密保护；目前尚无证据表明这两种协议的基本请求格式不符合官方标准。一次真实网关返回扩展要求及另一次上游鉴权失败，不能推出标准协议错误或 Key 必然失效。

## Goals / Non-Goals

**Goals:**

- 核验协议构造、响应解析、错误事实和 Test / 执行连接绑定；只修复可复现的偏差。
- 使协议契约和验收独立于服务商、域名、模型名称及额外客户端标识。
- 以安全可复现证据区分协议级单次 Test 和实际聊天的能力边界。

**Non-Goals:**

- 新增 Chat Completions、供应商专用请求头或用户可配置的供应商扩展。
- 将 Test 改为启动 Agent、Work 或真实聊天，或以 Test 判定工具/流式能力。
- 凭一次网关响应宣布官方协议不兼容、认证密钥无效或 Test 必然可以通过。

## Decisions

### 1. 以所选协议和现行行为契约为请求依据

Messages 使用规范化根路径加 `/v1/messages`，Responses 使用 API base 加 `/responses`；按协议构造模型、消息、鉴权及响应解析。URL 的可用性、上游支持及网关额外限制由返回结果表达，不能推导为另一协议。保留 `anthropic-version` 与官方仍支持的 `x-api-key`，不无证据改写已兼容的鉴权路径。依据：[Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create)、[Anthropic 鉴权](https://platform.claude.com/docs/en/api/overview)、[OpenAI Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses)。

不采用域名映射、特定服务商头部注入或自动探测重试：这些改变了标准协议测试的含义，也违反当前一次请求的契约。对未知扩展错误只安全呈现已有状态和类别，不泄露任意上游原文。

### 2. 比较相同配置，而非强迫执行机制相同

检查 Core 的 Test 输入解析、保存规范化、模型捕获与 Agent 的 `resolveProductionModel`，并以合成端点对照协议、规范化目标、模型、凭据来源；草稿覆盖不得被保存值遮盖。实际执行使用 SDK 和流式请求的细节允许不同，测试事实不扩展为聊天能力证明。已受理 Run 与凭据轮换沿现行契约。

### 3. 以证据驱动修改与对外反馈

先编写基于官方协议的合成 HTTP 契约用例和必要的跨路径验证，再对具体失败做最小修复；现有符合契约的代码无需重写。错误保留实际 HTTP 状态和可确认类别，401/403 表述为请求的鉴权或权限被拒，不把不明来源的上游错误当作 Key 确定失效。若公开结构或界面措辞确需变更，同步 contracts、生成物、Console 管理与 Quick setup 消费者；否则不扩张 UI/DTO。

## Risks / Trade-offs

- [仅支持标准协议的服务可能另加访问限制] → 明确展示本次失败；不承诺额外要求会被自动满足。
- [短 Test 通过但流式、工具或聊天失败] → 结果仅说明单次短消息，另外验证真实 Run。
- [非流式 Test 与 SDK 行为不同] → 比较绑定与各自协议合法性，不要求字节级一致或误判差异。
- [上游错误可能包含秘密] → 原始错误不外显、不落公开报告，回显文本执行现有脱敏和长度限制。
- [缺少真实服务凭据] → 合成协议契约必须通过；真实端点验收分别标明已测或未测，不使用真实秘密作为夹具。

## Migration Plan

本变更预期无数据迁移；尽量保持既有 DTO、保存数据和调用方式。实施后按源码构建、执行相关契约检查；若实际发现必须变更公开契约，再同步生成及跨语言消费者并核对兼容。回滚遵循普通代码提交回退，不重写用户模型、密钥或历史。

## 实施核验记录

- 本次责任边界：Core 的 `model_test_http.go`、`model_test_errors.go` 与 `model_registry.go` 分别负责短消息、结果分类和连接规范化；HTTP contracts 负责 DTO，Console `model-form.ts` 和 Quick setup 消费结果，Agent `pi-sdk-executor.ts` 负责真实 Run。新增合成测试覆盖输入、覆盖项、请求头和重定向；Console 的 `model-management.ts` 负责 Test 结果重绘、`app.ts` 更新所属弹窗外壳、`quick-setup.ts` 在语言切换时保留当前草稿 Key，源码构建同步对应嵌入资源，不改 DTO 或部署材料。
- 响应边界核验发现 Responses 的 `incomplete` 状态可能包含非空 assistant 正文；原解析器将其误判为协议错误。现将可见正文按既有成功契约展示，并以现有 `replyTruncated` 标识未完成；Messages 的 `stop_reason=max_tokens` 和 `model_context_window_exceeded` 同样标识截断。空正文仍报告失败，界面截断说明同时覆盖上游未完成和显示上限。
- 真实服务：Anthropic 官方 Messages 和 OpenAI 官方 Responses 均未取得可用凭据，本轮真实服务通过情况未测；此前对用户提供的兼容网关请求曾得到 HTTP 400 及 HTTP 401，未得到成功回复，不能视为本轮官方验证或确认凭据自身无效。全部自动测试使用合成值。
- 已通过两种协议的合成 Test 和真实 Docker Agent/合成网关集成：`TestNativeModelURLNormalizationAndErrorRecovery` 与 `TestNativeMultiProviderLifecycleThinkingAndPackageRoundTrip`；后者分别比较实际 SDK Run 和 Test 的协议、路径、模型及合成 Key，Test 非流式、Run 流式。Agent 验证镜像根据当前源码构建，revision `e8fe7a663e30b22aec7b8adf47305e87173a0994`、modified `true`、image ID `sha256:058fdbb1e41d5eb9980ff3985abec8de82a9d7aee92246d462fa9be25514388e`；helper 复用本机已有 acceptance 镜像。合成服务结果不代表外部真实模型可用。
- Console 构建和 162 项单元测试通过，`node scripts/check-generated.mjs ui`、`node scripts/check-ui-language.mjs` 通过；`CGO_ENABLED=0 go build -buildvcs=false` 构建了包含新资源的 Core。原浏览器 MCP 连接关闭，用户明确要求改用其他 Playwright 方案后，使用项目 Playwright 和合成数据继续验证。
- 浏览器验证先发现模型管理的 Test 弹窗未随语言变化、Quick setup 重绘时空密码框覆盖当前草稿 Key；分别修复两处所有者并保留 Test/保存分离。修复后 `feedback.spec.mjs` 与 `quick-setup.spec.mjs` 全套 153/153 通过，既有语言回归 4/4 通过；增强后的 8/8 定向用例分别覆盖两协议、两入口、390x844 与 1920x1080、中英文切换、成功和失败、失败后保存及选择、取消删除确认。截图以 `/tmp/piwork-model-management-*` 和 `/tmp/piwork-quick-setup-*` 保存；均为合成数据。
- Agent 单元测试 205 项通过，`go test ./internal/coreapp ./internal/contracts -count=1` 在 `umask 0022`、`GOFLAGS=-buildvcs=false` 下通过；模型短请求正负例和禁止跟随重定向的定向测试通过。首次不带上述环境运行完整 Core 测试时，原有 Git `core.worktree` 配置导致测试内部 Go 构建无法获得 VCS 状态，且进程 `0077` umask 影响权限夹具；上述明确环境下重跑通过。native-boundary、WebUI 依赖、增量源码风格、文档边界和 OpenSpec 严格校验通过。
- 复核警告修复：上下文窗口耗尽的有正文、无正文和自然结束合成 HTTP 用例先复现 `replyTruncated=false` 的偏差，修复后定向测试通过；使用 `umask 0022`、`GOFLAGS=-buildvcs=false` 重跑 `go test ./internal/coreapp ./internal/contracts -count=1` 通过，禁用 CGo 的 Core 构建与增量源码风格检查通过。官方真实服务仍未验证。
