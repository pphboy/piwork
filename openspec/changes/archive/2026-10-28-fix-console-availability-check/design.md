# Design

## Context

动机见 [proposal.md](proposal.md)。当前调用链为：

```text
Console start / Retry
  --> ConsoleAdapter.connection()
  --> GET /console/api/availability
  --> webapp session validation
  --> hosted Console administrator validation
  --> serveAPI fallback: 404 NOT_FOUND
  --> console-availability-notice
```

`apps/console-webui/src/app.ts` 的启动恢复代码会显示该失败，并以 1 秒、3 秒间隔最多自动重试两次。旧启动代码同样调用可达性检查，但静默忽略失败；本次定位不是合并冲突丢失了已有路由。`internal/consoleapp/console_api.go` 已实现 `/console/api/health`，通过固定 Core 客户端读取 `/healthz`，但其响应字段是 `healthy`；前端连接检查需要的是 `reachable`。

`internal/webapp/server.go` 在转交管理 API 前验证浏览器会话，`internal/consoleapp/hosted.go` 验证管理员角色。`apps/console-webui/test/feedback.spec.mjs`、`language.spec.mjs` 等模拟了成功的 `availability`；现有真实浏览器测试虽然访问管理页，却未断言这项请求的响应和全局连接提示。现有规格已要求有界首读及安全恢复，本变更在 `serve-ui` 中补足可达性接口契约。

## Goals / Non-Goals

**Goals:**

- 让当前前端连接检查在真实托管 Go 服务上得到可验证结果。
- 沿用现有会话、权限、固定上游和读取恢复机制，明确连接状态与业务 readiness 的差异。
- 用真实路由和浏览器断言约束模拟测试与交付服务的一致性。

**Non-Goals:**

- 不新增公开匿名状态接口、通用 Core 代理或第二套认证。
- 不重构管理导航、引导、Work 恢复、模型配置或已有 `/console/api/health` 契约。
- 不处理与本错误无关的历史规格文字，也不升级测试框架或建立全仓接口生成系统。

## Decisions

### 1. 在管理适配层补齐既有请求路径

在 `internal/consoleapp/console_api.go` 的明确路由中实现 `/console/api/availability`。沿用 `webapp`、`NewHostedHandler` 和 `serveAPI` 的身份与权限校验，不把该路径加入匿名认证路由。通过既有固定 Core 客户端和 Transport 执行只读探测，不接受浏览器提供的 Core URL 或凭据。

保留该路径可以让当前启动、Retry 和去重/取消逻辑继续工作。替代方案是把前端连接检查改用 `/console/api/health` 并映射 `healthy`；它也能消除缺失路径，但需要同步更换读取键、模拟契约和恢复调用。当前修复选择补齐已被调用的适配 API，保持改动集中。重新吞掉错误会隐藏真实连接故障，不能满足现行首读恢复要求。

### 2. 使用 Core 健康读取，保持 readiness 独立

复用既有 `/health` 探测方式：后端固定读取 Core `/healthz`，使用请求派生的最长 5 秒 context，并正确关闭响应体。仅 HTTP 200 得到 `{ "reachable": true }`；在管理员身份验证成功之后，健康探测的网络错误、超时或非 200 得到 `{ "reachable": false }`，两者均以 HTTP 200 JSON 返回，防止探测结果被误解为业务写入失败。响应只含安全布尔状态，不透传上游响应或秘密。

不使用 `/readyz`、`admin/status` 或 `/_web/api/onboarding` 作为连接成功的依据；它们涵盖 Docker、Runtime 或准备过程，会把可正常配置的 Core 错判为不可达。也不以 UI 自身 `/healthz` 证明后端 Core 可用。

会话检查在探测前执行：已失效身份和普通用户仍分别得到 401/403；前置验证遇到连接错误仍交给既有安全错误路径，不由可达性处理器重解释成已认证成功或注销。有效管理员的非 GET 请求在既有 Origin/CSRF 检查之后返回 405，不发起业务修改。

核验发现 `NewHostedHandler` 把解析器的任意错误转换为 401，而更内层 `serveAPI` 又把任意解析错误转换为 502；因此错误分类必须在这两个管理入口共用一致的安全投影。以已有 Core 客户端错误和公开错误的 HTTP 状态区分真实 401、403 与连接/意外错误，不透传上游文本；不更改外层会话验证和管理员角色检查。测试除外层断连外，还需在外层验证成功后才切断实际 Transport，覆盖内层错误及原会话恢复。

### 3. 保留恢复提示，只接受有效布尔状态

核对 `apps/console-webui/src/adapter.ts` 的 `connection()`，使其仅接受 `typeof reachable === 'boolean'` 的响应；缺失或错误类型使用既有无法验证响应的本地化错误。`reachable: false` 使用既有 Core 不可达提示，`true` 使 `readAvailability()` 清除当前连接提示。

`src/app.ts` 的十秒截止、最多两次自动重试、显式 Retry 及身份/视图归属检查继续负责读取生命周期。只在回归发现本契约相关缺陷时做必要的局部调整，不用页面重载清除告警，不因状态恢复重放任何写入。现有语言机制继续渲染状态；不增加产品流程。

核验发现可达性只比较身份与路由字符串，无法区分离开后再次进入同一路由。复用页面已有的 `loadId` 作为视图代次：创建新视图时取消前次可达性读取和重试，建立该视图自己的只读检查；同页保留上下文的刷新不建立新代次。可达性结果及自动重试同时验证身份、代次和请求序列，普通导航、历史导航及显式 Retry 遵守同一归属。初始检查在初始页面代次建立后启动，避免被初次 `loadPage` 自己判定为过期。

### 4. 分别验证真实服务与浏览器表现

- `internal/consoleapp`：以固定合成 Core HTTP 服务和管理员解析器验证真实管理处理器。覆盖探测 200、非 200、断连、受控超时/取消和非 GET；计数证明只发生健康 GET，没有管理写入。等待控制使用现有测试注入方式或可控 Transport，不人为延长整套测试。
- `internal/webapp`：复用现有 `fixture`、`browser`、`signIn`，以真实 Core、Cookie 登录和完整路由请求 `/console/api/availability`。覆盖未配置 Runtime 时返回 true、匿名/失效 401、普通用户 403、前置验证临时断连保留会话；不能仅调用内部 helper 代替实际 URL。
- 浏览器模拟：在现有 Console 测试中覆盖布尔值校验、失败后 Retry 清除告警，以及草稿和写请求计数；保留既有超时、迟到响应和身份归属回归。
- `apps/console-webui/test/real-core.spec.mjs`：在既有真实服务登录流程中监听实际请求，断言 `/console/api/availability` 为 200 且 `reachable === true`，并等待状态处理后检查 `#console-availability-notice` 不存在；覆盖直接打开和刷新管理页。成功路径不得拦截此接口提供模拟响应；真实 Core 的 Runtime 可以保持未配置，不依赖运行 Agent 或外部模型。双语登录已有夹具可复用。

至少一个使用真实 URL 的回归必须在修复前因当前 404 失败、修复后通过，避免测试只证明新 helper 或模拟器本身正常。

## Risks / Trade-offs

- [把 Core 可达性当作业务已就绪] → 健康 GET 与 readiness 分离，加入 Runtime 未配置对照，不触发镜像准备或 Work 启动。
- [新增路由绕过认证或误清会话] → 保持现有管理路由顺序，用完整 `webapp` 请求验证 401/403 与临时断连恢复；不为此接口新增匿名特例。
- [模拟测试再次掩盖缺失路由] → 真实 Go HTTP 和真实浏览器测试都断言具体 URL、状态和布尔字段，而非只检查页面主标题。
- [构建清理测试使用的资源] → 先完成构建与嵌入同步，再运行浏览器测试；宿主与测试使用同次构建产物，输出放 `dist/`。

## Migration Plan

无数据迁移和新配置。实施时先添加可证明当前缺失接口的回归，再补齐适配层与必要前端响应校验；按既有入口构建、同步嵌入资源及宿主后验收。使用独立安装和数据目录，不复用用户当前预览实例的凭证；本变更不授权发布或重置已有安装。回退代码不改变持久数据，旧版本仍可能显示原连接告警。
