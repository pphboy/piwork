# service-network-access 规格变更

## ADDED Requirements

### Requirement: 原生 Service 网关的协议与撤销边界

**Identifier:** SNET-OPS-001

Service SHALL 在同一 Work 的明确 workspace grant 下共享持久字节，应用与数据使用 workspace/apps/<name> 和 data/<name>，容器可写层/tmp 不作持久来源。Work 中文显示名与 Core 分配的 w- 网络身份分离，域名、容器名、私网端点由当前受管身份解析，不写入可移植配置的派生域名。

默认 HTTP 入口 SHALL 优先声明 TCP 80，再选 HTTP probe 端口，从 / 开始，UDP 不产生 URL。Core 的 service-access/resolve 与 service-gateway 只路由声明端口和当前容器，拒绝调用方 IP/任意外部 URL。平台凭据 X-Piwork-Gateway-Token 及保留头不进入应用，应用 Authorization/Cookie/状态/正文保持；仅平台失败标 X-Piwork-Gateway-Error，应用 401 不登出平台。

HTTP/SSE/WebSocket SHALL 流式转发并保留预读首帧；每用户 64/全 Core 256 连接，请求头 32 KiB、建连 10 秒，每两秒复核会话、Work/Service 和 Docker 路由。WorkServices 默认 7172 mTLS，监听/advertise 可显式配置且按安装/Work/generation/instance 重新授权，不使用应用凭据。Service 与 Pi 的 Query/Action/Event/Job 走现有直接交互及稳定原 ID，不经 Core 复制业务状态。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```sh
PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:go-migration-acceptance \
CGO_ENABLED=0 go test -mod=readonly -tags=integration -v ./internal/coreapp \
  -run 'TestNativeService|TestNativeSDKDeploysService'
```
