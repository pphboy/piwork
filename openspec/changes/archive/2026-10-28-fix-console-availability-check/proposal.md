# Proposal

## Why

管理员打开管理页时，前端请求 `GET /console/api/availability`，但当前 Go 管理服务未实现该路由，导致正常运行的 Core 被附加 `NOT_FOUND` 黄色提示，Retry 仍请求同一缺失接口。页面加载恢复改动将原先静默忽略的失败呈现出来，而浏览器测试模拟了接口成功，未发现真实服务与前端契约不一致。

## What Changes

- 补齐同源、受管理员会话保护的 `GET /console/api/availability`，依据后端到固定 Core 的有界健康读取返回明确的 `reachable` 布尔值。
- 明确可达性只表示 Core 健康接口可用；Runtime 未配置、Docker 未就绪或没有 Work，不因此报告连接失败。
- 保留现有十秒读取截止、有限自动重试和显式只读 Retry；检查成功后移除原连接提示，不通过吞掉全部错误消除提示。
- 修正核验发现的内层会话错误分类和同路由重入归属遗漏：临时断连不转换为 401，旧视图的成功、失败和重试不得改变新视图。
- 增加真实 Go 路由、权限和故障回归，以及使用重新构建嵌入资源的浏览器回归；覆盖真实可用性响应及告警消除，避免仅凭模拟接口证明修复。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `serve-ui`：明确管理入口可达性接口的实际路径、响应、权限、故障恢复及与 readiness 的区分。

## Impact

- 服务端：`internal/consoleapp/console_api.go`、`hosted.go` 及相邻测试；`internal/webapp/` 的真实 Core/浏览器会话测试。
- 浏览器：核对 `apps/console-webui/src/adapter.ts`、`src/app.ts` 的可达性契约，维护相邻模拟测试和 `test/real-core.spec.mjs` 的真实服务验收。
- 构建：通过既有构建入口同步必要嵌入资源并重建宿主，使用独立数据目录验证。无新增依赖、启动参数、部署配置或公共 Core API；不改变 Work 生命周期和模型凭证。
