# Go Work Service MCP

`piwork-service-mcp` 是 Agent 管理的原生 stdio 子进程，固定入口 `/usr/local/bin/piwork-service-mcp`，不接受业务参数、用户选择的 Work ID、Docker ID、宿主路径或证书。完整 TS Agent harness、Pi SDK 和 MCP client 保留；仅内置服务端程序改为 Go。

## 工具与调用

提供现有 12 个工具：`deployment_context`、`service_create`、`service_list`、`service_get`、`service_update`、`service_start`、`service_stop`、`service_restart`、`service_remove`、`service_retry`、`operation_get`、`service_logs`。Agent 仍按 `work-services.<tool>` 策略过滤，并向模型投影为 `work-services__<tool>`；Go 服务端不改变 namespace 或授予权限。

工具声明使用显式 JSON schema，保留现有默认值、嵌套字段与限额；未知根字段和严格嵌套字段在 RPC 前拒绝。默认值只补省略字段，不覆盖显式 null/false/空集合。Zod 字符串限额按 UTF-16 保留；不把 Go struct 零值当成业务默认值。静态声明位于 `internal/servicemcp/tools.json`；迁移前采集的开发 oracle 已固定为测试 fixture，生产不启动 TS 来生成 schema。

Mutation 要求调用方提供 idempotencyKey，单次调用仅返回 Core 持久接受结果，不等待拉镜像或 readiness。读请求默认 5 秒，mutation 10 秒，logs 2 秒。响应丢失时不生成新 key、不在适配器中自动重提；调用方可显式用原 key 恢复同一接受结果。配置的 gRPC retry policy 禁用，未到达/未处理的底层透明重连仍使用原请求。

protobuf uint64 输出为十进制字符串，包括大于 JavaScript 安全整数的值；text 和 structuredContent 包含同一规范 JSON 对象，保留零值、空集合和 optional 字段缺失。RPC 错误只返回安全状态分类与固定消息，不回显 gRPC/npm/Docker 内部诊断或路径。

## Service 资源与默认 Web 环境

应用 Service 不设置 Piwork 内存上限，也不占用 Work/宿主的有效内存预留。`memoryBytes` 省略默认零，合法旧正数只保留请求与历史语义；负数、非整数和超过安全整数范围的值仍拒绝。当前 Service 的 `memoryLimitMode` 和 `deployment_context.serviceMemoryPolicy` 明确为 `unlimited`。`defaultServiceMemoryBytes=0` 表示无限制，旧 total/availableMemoryBytes 仅表示非 Service 预算。CPU、服务数、卷数和 Agent/helper 内存政策继续有效，恢复及导入不会重新施加旧 Service 限制。

默认脑包为新的 Web 应用选择固定 Web base、FastAPI + React + TypeScript + Vite 和共享 workspace 模板。部署入口仍是已有 Service MCP；修改后自动检查、构建、更新或重启，并核对原 Operation、实际运行版本及业务结果。模板自身提供页面自动采用，不增加新的 MCP 工具或 Apply 流程。具体命令见 [Web base 手册](../deploy/images/web-base/README.zh-CN.md)，正常升级及持久化语义见 [运维说明](operations.md#service-资源与版本升级)。

## 配置、安全和退出

只读取 `/etc/piwork/service-control.json` 与三个固定的 `/etc/piwork/control/` PEM 文件；拒绝未知配置字段、重复 JSON key、不安全整数、symlink leaf、非普通/超过 1 MiB 的文件和替代路径。Core serverName 固定为 `piwork-core`，endpoint 由 Core 写入。Go 验证安装 CA、客户端完整 installation/Work/generation/instance/role URI 与 clientAuth，服务端链、DNS 和完整 Core 角色 URI；Core 在每次 RPC 重新授权当前 runtime。

stdout 只承载 MCP 协议；初始化失败 exit 1，stderr 只写 `MCP_INITIALIZATION_FAILED` 的固定安全 JSON。stdio 关闭、SIGTERM/SIGINT 会取消所有进行中的 RPC，并关闭连接；不等正常工具 deadline，不取消已由 Core 接受的 durable Operation。实际 TS MCP client 验收中，关闭有活动 RPC 的子进程约 2 ms，符合 Agent 五秒回收边界。

## 构建与验证

```sh
make build-go
go test -mod=readonly ./internal/servicemcp ./internal/internaltls
go test -mod=readonly -tags=integration -v ./internal/dockerengine \
  -run TestRealTSMCPClientNativeStdioAndCoreMutualTLS
```

真实 Engine fixture 使用原生 `piwork-agentd:go-migration-acceptance`，只读挂载当前 Go 程序；宿主测试进程 PATH 无解释器或 Docker CLI。镜像内真实 TS MCP client 发现全部工具、执行 14 组默认值/RPC/JSON oracle、验证未知字段拒绝、丢失响应原 key 重试和活动 RPC 的退出。此命令的 Core listener 是 mTLS 协议 fixture。任务 7.4 已另由 `TestNativeSDKDeploysServiceThroughGoMCPAndCore` 在真实 Go Core、保留 Pi SDK 和 Go MCP 上完成部署与 Operation 查询；完整 Core gate 在 9.12。当前部署及网关边界见 [Service 访问](service-access.md)，镜像入口和能力标识见 [原生 Agent 镜像](native-agent-images.md)。
