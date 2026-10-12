# work-services 规格变更

## ADDED Requirements

### Requirement: Go Service MCP 的工具与安全投影

**Identifier:** WSRV-MCP-001

内置 Service MCP SHALL 作为 Agent 管理的原生 stdio 子进程交付，不接受任意 Work/Docker/宿主路径/证书参数。保留 deployment_context、service_create/list/get/update/start/stop/restart/remove/retry、operation_get、service_logs 共 12 工具及 work-services namespace / 原策略过滤，不能因换实现增加权限。

工具 schema SHALL 保留省略默认与显式 null/false/空集合差异、UTF-16 字符限额及严格未知字段拒绝。mutation 要求 idempotencyKey，返回持久接受结果不等待 readiness；读/写/logs 期限分别 5/10/2 秒，丢响应不新 key 自动重提。uint64 规范 JSON 为十进制字符串，text/structuredContent 一致，错误只安全分类不透出内部诊断。

配置 SHALL 只读固定 service-control JSON/PEM，拒绝重复 key、不安全整数、链接及超过 1 MiB 的非普通配置，验证安装 CA、完整双向角色和当前代次。stdout 仅 MCP，初始化失败固定安全 JSON；stdio 关闭/SIGINT/SIGTERM 取消 RPC 并关闭连接，不取消 Core 已接受的 Operation。应用 Service 内存明确 unlimited；当前默认 Web 环境沿有效 NiceGUI Spec，不复活旧 FastAPI/React 默认。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```sh
make build-go
go test -mod=readonly ./internal/servicemcp ./internal/internaltls
go test -mod=readonly -tags=integration -v ./internal/dockerengine \
  -run TestRealTSMCPClientNativeStdioAndCoreMutualTLS
```
