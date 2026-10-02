# Go Core Service 部署与访问

本页对应 `go-core-cli-migration` 的 Service 阶段。用户在 Work 对话中要求持久运行应用后，pi-agentd 使用原部署 Skill、真实 Pi SDK 与 MCP 客户端调用内置 Go Service MCP；Go MCP 经 mTLS 调用 Go Core。Core 持久接受定义与 Operation，再异步拉取既有镜像、建立受管容器并核验 readiness。

## 文件与身份

程序放在 `/var/data/workspace/apps/<service-name>`，业务数据放在 `/var/data/workspace/data/<service-name>`。Service 显式声明 workspace mount；挂载该卷的同一 Work Agent 和 Service 读写同一份文件。容器可写层和 `/tmp` 不承担持久化。用户服务可使用 Python、Node 等现有镜像，平台原生程序的语言边界不限制用户应用。

Core 保留中文 Work 显示名称，单独分配 `w-<短 ID>` 网络身份。域名为 `<service-domain-label>.<work-network-name>.work`，容器名为 `<work-network-name>_<service-name>`，Work 私网仍使用 `svc-<service-name>`。网络身份由 Core 管理，派生域名不写进 Work 配置；自定义域名的后续扩展使用独立 resolver 边界。

## 运行与恢复

- `service_stop` 持久禁用 Service；Work 下次启动时保持禁用。
- Work Stop 保留 enabled 定义和 workspace，Work Start 恢复启用的服务。
- `service_restart` 替换匹配的容器，复用持久卷；`service_retry` 重试当前定义并重置恢复预算。
- `service_remove` 移除受管实例与运行配额，保留共享 workspace 文件。
- 已声明的 HTTP/TCP/exec probe 必须成功；只有未声明 probe 的服务以进程 running 为就绪依据。总 deadline 默认 120 秒，单次 probe 至多 2 秒。
- 自动恢复使用持久的三次重试预算和 1/5/15 秒延迟。Core 重启不补充预算；连续 ready 十分钟或显式 retry 才重置。未知 Docker 创建结果保留为未知状态，匹配的迟到实例按最新 Work 目标收尾。

## Core 网络访问接口

`GET /api/v1/service-access` 使用用户 Bearer，返回协议能力。Service list/show 同时提供 Work 私网 `endpoints` 和域名 `access`，后者包含 `hostname/defaultUrl/defaultPortName/status/ports`。地址存在不表示服务当前可用。

默认 Web 入口优先选择已声明 TCP 80，再选择 HTTP readiness 对应的 TCP 端口；应用 URL 始终从 `/` 开始。其他 TCP 端口需要显式选择，UDP 不产生 HTTP URL。

Core 网关内部路径是 `/api/v1/service-gateway/<hostname>/<requested-port>/<application-path>`；默认 Web 入口使用 requested-port 80。实际目标由 Core 当前受管容器和 Work 私网解析，不接受任意 IP 或外部 URL。resolve 路径为 `/api/v1/service-access/resolve?hostname=<hostname>&port=80`。

转发专用平台凭证位于 `X-Piwork-Gateway-Token`。应用自己的 `Authorization`、Cookie、状态和正文继续传输；平台凭证及 `X-Piwork-Gateway-*` 保留头不会进入应用。只有平台失败携带 `X-Piwork-Gateway-Error: 1`，应用 401 不代表用户从 Core 登出。

HTTP 请求体和响应流式传输，SSE 逐段刷新，WebSocket 保留 Upgrade 后双向帧及随请求预读的首帧。网关限制每用户 64、全 Core 256 个连接，请求头 32 KiB、建连 10 秒；活动连接在两秒内复核并撤销失效会话、停止/删除的服务及未确认的 Docker 路由。

## 运维与验证

Go Core 默认在 `0.0.0.0:7172` 提供 WorkServices mTLS。可通过 `--agent-grpc-listen` / `--agent-grpc-advertise` 或 `PIWORK_AGENT_GRPC_LISTEN` / `PIWORK_AGENT_GRPC_ADVERTISE` 配置监听和容器内连接地址。该接口依赖安装证书与当前 Work/generation/instance/service-control 角色，不使用用户应用凭证。

```sh
PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:go-migration-acceptance \
CGO_ENABLED=0 go test -mod=readonly -tags=integration -v ./internal/coreapp \
  -run 'TestNativeService|TestNativeSDKDeploysService'
```

测试只清理其 installation 标记的资源。证据和具体场景见 [Go 迁移验收](go-migration-acceptance.md)。用户使用 `piwork-cli proxy` 访问 `.work` 域名，或使用 `piwork-cli desktop` 的本机 Service 链接在浏览器直接打开；WebDAV 也由同一个 CLI proxy 提供，详见 [Work 文件访问](work-files.md)。本页的 Core 网关路径仅用于平台集成。
