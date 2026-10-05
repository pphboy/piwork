# Proposal

## Why

同一 Core 的 HTTP 地址已经能被普通业务 CLI 使用，却被 Desktop 启动、界面切换、默认地址保存和 proxy 拒绝，导致用户无法选择实际可用的连接方式。Windows 原生候选对 `http://192.168.14.134:7171` 的 `status` 已返回 healthy/ready；客户端应统一接受用户选择的 HTTP(S) Core origin。

## What Changes

- `piwork-cli` 的普通命令、默认/显式 Desktop、Core 切换、默认 Core 配置和 proxy 统一允许 HTTP 与 HTTPS，不根据 loopback、局域网、公网、域名或操作系统限制 HTTP。
- 移除 Go 与 WebUI 中“远程 Core 必须 HTTPS”的重复校验和提示；HTTP 无需新增开关、环境变量、确认弹窗或强制改写为 HTTPS。
- 保持合法 Core origin 校验、原地址优先级、凭证 origin 绑定、本地浏览器授权和原错误/退出码契约；HTTPS 继续使用正常证书与主机名校验。
- 补齐 HTTP 启动、切换、保存后重启及代理网络路径的测试，重新构建内嵌 UI 与两平台候选，并将验证结果绑定到新产物。
- 在实施阶段协调 `support-cross-platform-cli-and-default-desktop` 中重复的 HTTPS 约束和验收文档，避免后续同步规格重新写回旧限制。

本变更只调整用户客户端对 Core 协议的选择。Core/Console 部署、安装 CA、系统证书库、服务端 TLS、Service 目标域名与协议准入、代理监听范围及账号权限保持现有行为。

## Capabilities

### New Capabilities

无新增 capability。

### Modified Capabilities

- `control-cli`：明确所有用户客户端入口采用统一的 HTTP(S) Core 协议选择，修改 Desktop 与 proxy 的远程地址要求，保留原调用契约。
- `desktop-webui`：连接/切换和默认 Core 配置接受远程 HTTP，保留当前连接与下次启动配置的独立语义和身份隔离。

## Impact

- Go 客户端：`internal/client/desktop_preferences.go`、`internal/cli/user_desktop.go`、`user_desktop_api.go`、`user_proxy.go`，以及相关 resolver、偏好、身份和进程测试。HTTP/WebSocket 传输已有实际实现，不需要新增传输后端。
- WebUI：`apps/desktop-webui/src/adapter.ts`、默认 Core 浏览器测试及构建生成的 Desktop 内嵌资源；不新增 Core API、本地 API 路由或偏好格式。
- 文档与验证：`docs/cli-platforms.md`、相关命令说明和两个变更的规划/验证记录；真实 HTTP Core 与 HTTPS 正反例分别验收，不能用 HTTP 成功替代 HTTPS 证书校验结果。
- 并行变更：依托当前跨平台变更已实现的默认入口与偏好能力。规划本变更时只创建自己的 artifacts；实施时先协调该变更的重复条款，再修改代码。其未完成的平台安全及发布验收继续独立保留。
