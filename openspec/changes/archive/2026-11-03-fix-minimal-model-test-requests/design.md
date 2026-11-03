# Design

## Context

见 proposal.md 的动机。当前 Core 的 `internal/coreapp/model_test_http.go` 以 Go HTTP 发送 `Reply with OK.`，固定输出上限 128，无 system/tools，非流式。两种协议、地址规范化、真实文本解析和截断行为已有测试。`model_test_errors.go` 将未知上游错误映射为安全失败；本变更不会用伪造回复将失败显示为成功。

当前请求链路与 Claude Code 不同。诊断已实际确认：用户端点 `https://opencode.ai/inference/go/anthropic`、模型 `deepseek-v4.1-flash` 和有效 Key 在最小 Messages 请求中返回 HTTP 400 `MissingSessionID`；只增加匿名会话头即可返回 HTTP 200 和可见 `OK`。本机 Claude Code 2.1.228 同样调用成功，实际带原生会话头。仅添加 Anthropic 标准 `metadata.user_id` 不足以通过这个端点的校验。以上是诊断事实，尚不是 Piwork 页面验收通过。

当前 AIM-007 禁止依据端点添加兼容头，与此次“只填连接字段并在给定接口 Test 成功”的验收目标冲突；本变更显式修订该约束，不把纯错误提示改善当作成功调用。

## Goals / Non-Goals

**Goals:**

- 一次固定 `Reply OK` 最小推理请求，并在用户指定端点取得真实页面回复。
- 用户不配置供应商、SessionID 或额外头，平台自动准备必要的匿名客户端信息。
- 保持 Go 宿主、原身份与 Key 边界、无业务副作用及新旧结果读取兼容。

**Non-Goals:**

- 运行 Claude Code、完整 Agent、容器或 Work 来完成 Test。
- 添加 Chat Completions、模型配置字段或通用自定义请求头编辑器。
- 复制 Claude Code 的 system prompt、工具、历史、Thinking 或 User-Agent；不冒充其他客户端。
- 自动试探多个协议、域名、Key、模型或在错误后重发；不改写实际聊天和已接受 Run。

## Decisions

### 1. 消息体保持最小，传输层承担请求上下文

每次显式 Test 只发一次：Messages 为 `model/messages/max_tokens/stream=false`，Responses 为 `model/input/max_output_tokens/stream=false`；消息字节固定 `Reply OK`，输出上限均为 64。选择此值是为了容纳已验证模型的短推理和可见回复，同时限制测试输出成本。没有可见文本时继续报告空回复，不伪造 `OK`。

协议路径和鉴权沿现有 `NormalizeProtocolModelEndpoint` 及 Test 实现，Core 继续使用 Go HTTP。增加一个窄的请求上下文构造边界，输入仅规范化 URL、协议、匿名本次标识与真实 Piwork 客户端标识，输出附加头；不传整个 Application、用户身份、Key、模型草稿或聊天状态。

通用 User-Agent 使用 Piwork 自身版本。临时标识使用每次 Test 新生成的随机 UUID，不使用用户 ID、Work ID、CLI 凭据、历史 Session 或设备标识，不落持久存储。

### 2. 会话兼容策略预先确定，并限定精确范围

初始规则仅覆盖此次已确认的 Go 网关命名空间：HTTPS、主机名精确为 `opencode.ai`、缺省端口或 443；Messages 规范化 API 根路径为 `/inference/go/anthropic`，Responses API base 为 `/inference/go/openai/v1`。匹配后添加该服务公开要求的 `x-opencode-session`，值为本次匿名 UUID；不添加其他不必要的服务头。

使用服务公开的会话头，避免将 `X-Claude-Code-Session-Id` 当作 Piwork 自身客户端身份。两种 API 的消息、鉴权和响应解析不受此规则改变；非匹配端点只使用原协议和 Piwork 通用客户端信息。相似域名、其他路径、HTTP 和非默认端口不命中。重定向仍不跟随，头部和凭据不转交其他目的地。

规则在首次请求前决定，禁止解析上游消息来动态添加头、重试或创建供应商猜测目录。与 SDK 已有会话处理保持语义一致，但不为此把 Test 迁入 SDK/harness；生产 Core 不增加 Node 依赖。

依据：[Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create)、[OpenAI Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses)、[服务的客户端会话要求](https://opencode.ai/v2/docs/console/go/)。这些资料与实际对照请求共同限定策略，不能据一个服务推断所有标准端点都要求会话头。

### 3. 新消息同步写端，读取保留旧结果

Core 的 `modelTestMessage` 和 Console `model-form.ts` 的新请求说明改为 `Reply OK`。`packages/contracts/src/ai-model-management.ts` 的 `testMessage` reader 接受新值及已发布的 `Reply with OK.`；Core 只发新值。浏览器展示已返回结果中的原消息，未发起状态展示新消息，不把旧结果改写成新消息。

同步 `validModelTest`、模型管理和 Quick setup 的相关夹具及测试，经 `make generate` 更新 schema、Go DTO/golden 等生成结果；再经工作区构建同步 Console 嵌入资源。不开新业务配置、不改变 modelRef 或 Key。

### 4. 真实页面成功是完成条件

实施先用合成测试验证两协议最小消息、旧结果读取、兼容规则的正负例、无重试/重定向和秘密保护，再在**确认正在运行新构建**的模型管理页面，用用户已提供的合法连接配置点击 Test，验证实际 HTTP 200 和可见 `OK`。Quick setup 也需使用相同生产调用链验证，不能仅替换 browser route 得到模拟成功。

真实凭据仅从实施时已授权的私有配置或会话安全获取；不写进 proposal、测试夹具、截图、日志或 Git。若凭据失效、服务拒绝或未能运行新构建，保持该验收任务未完成并给出实际失败事实，不能改为可跳过。优先使用独立验收安装；如需重启用户安装，遵守已有授权及并发资源归属，不替换其他会话持有的 Core 或直接修改其私有数据库。

## Risks / Trade-offs

- [此前禁止兼容头的规范发生变化] → delta 明确修改 AIM-007，并将规则与用户输入配置分开；不宣称仍是完全不带扩展头的请求。
- [兼容头误发到其他服务] → 精确 URL 范围、负例、禁止跟随重定向，头部只含匿名本次 ID。
- [64 token 被模型用于推理而没有正文] → 如实报告空回复；给定用户端点的成功验收不能被空/推理内容替代，不自动扩大预算或重发。
- [新 testMessage 被旧严格 reader 拒绝] → 同版 UI/DTO 同步，升级新 reader 接受旧值，记录对旧严格客户端的消息字面量变化；不改历史。
- [外部服务或凭据随时间变化] → 保留真实验收任务，报告阻塞，保留合成协议证据的适用范围。

## Migration Plan

没有数据迁移。先同步 contracts 与 Core，再同步 UI 及生成物，构建同版宿主后进行实际验收。回滚恢复原请求构造和配套 UI/DTO，不回滚或覆盖用户模型、Key、Work 数据及历史。仅本地构建和验收，不自动发布或推送。

## 实施与验收记录

- 责任模块：`model_test_http.go` 发送最小消息，`model_test_context.go` 只构造 User-Agent 和匿名会话头，输入为最终规范化请求 URL、协议、临时 UUID 与版本，不接认证或业务状态。规范化 API 根路径追加协议资源路径后，按完整最终路径精确匹配。`model_test_context_test.go` 覆盖匹配边界、标识独立和保存项 API 双向覆盖；`model_standard_protocol_test.go` 验证实际请求只有四个消息字段及正确预算。
- contracts 的新旧消息 union 与 Console `validModelTest` 同步，`model-form.ts` 的新提示词为 `Reply OK`。`make generate` 同步 schema 和 oracle，Console 构建同步嵌入资源；UI 语言检查仅补充固定协议文本例外，没有新增用户配置、部署文档变化或宿主语言依赖。
- 自动检查通过：Core 和 contracts 完整 Go 单元测试；contracts 50 项单元、Console 163 项单元；模型管理与 Quick setup 浏览器全套 153 项；真实 Core 配合合成 Responses/Messages 网关的浏览器测试 1 项；语言检查器 20 项单元；两工作区 typecheck；HTTP/协议及 UI 生成一致性、native-boundary、WebUI 依赖、文档边界和增量源码风格检查。早期两项浏览器用例仍以旧提示词断言待发送状态，修正为新请求提示词后，同时验证旧返回结果仍按原消息展示。
- 真实用户端点验收：独立数据目录运行本次源码构建的完整 `app.RunWithRPCListener`，开发入口 `scripts/corefixture` 仅提供隔离 RPC listener，不模拟 API 或模型响应。验收二进制 SHA256 为 `c797d203f99773d37ac31e03800e3c278ee7fbab110868cc6068c55bffebfd6f`，版本标识为 `0.1.0-dev.minimal-model-test`；产品 `cmd/piwork-core` 也已关闭 CGo 独立构建。独立实例验收完成后正常退出，未替换另一个会话占用的 17891 实例。
- 从模型管理页面显式 Test 用户提供的 Messages 端点和 `deepseek-v4.1-flash`：实际 HTTP 200、`testMessage=Reply OK`、可见正文 `OK`，耗时 1589ms；从 Quick setup 同样点击 Test：实际 HTTP 200、同样消息与正文，耗时 1235ms。两处共两次模型 Test API 请求，未创建/修改模型、默认或 Work，验收前后目录及 runtime 相同，Key 未进入浏览器持久存储和验收日志/数据文件。截图仅截取结果弹窗：`/tmp/piwork-minimal-live-management.png`、`/tmp/piwork-minimal-live-quick-setup.png`，已目视核对。
- 随后用户明确要求在原地址重载新版本，正常停止原 Core 后使用 `cmd/piwork-core` 新构建复用原数据目录启动，umask 为 0022，健康检查通过，两个原 Work 恢复 ready。从用户实际 17891 模型管理页面再次点击保存项 Test，获得实际 HTTP 200、`Reply OK` 与可见 `OK`，耗时 2156ms；截图为 `/tmp/piwork-minimal-reloaded-model-test.png`。
