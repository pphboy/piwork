# Proposal

## Why

Work 内的服务已可由 pi-agentd 创建和管理，Core 也已提供对应的用户 HTTP 接口，但用户无法用 piwork-cli 直接查看、启停和排查这些服务。补齐 CLI 入口，使用户可以在不发起 agent 对话的情况下控制已有服务并查询持久化操作结果。

## What Changes

- 新增 `piwork-cli work service` 命令组，包含 `list`、`show`、`start`、`stop`、`restart`、`retry`、`remove`、`logs`。
- 命令显式指定 Work ID，单服务命令指定 serviceId；沿用现有资源 ID 定位方式。本次不增加按名称查找。
- `start`/`stop` 映射现有 enable/disable，持久保存启用状态；服务运行仍受所属 Work 状态约束。`remove` 保留共享 workspace 数据。
- 生命周期变更支持 `--wait`、`--idempotency-key`，全部命令支持前置全局 `--core`、`--json`；复用现有 `operation show` 查询已接受操作。
- 增加客户端 SDK 对现有服务读取、控制和日志 HTTP 接口的封装，补齐帮助、自动化测试和使用文档。
- CLI 不提供 create、update、定义编辑或 revision 管理；创建和更新服务定义继续由 pi-agentd 工作流承担。现有 HTTP/gRPC 创建与更新接口保持兼容。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `control-cli`: 增加已有 Work 服务的生命周期命令、状态查询、有限日志读取、参数校验和异步操作输出契约。

## Impact

- 实现范围：`apps/cli/src/`、`packages/client-sdk/src/`、相应测试、`docs/operations.md` 和 README 中的 CLI 使用说明；正式 Core HTTP 路由测试可扩展以验证接入兼容性。
- 复用 `apps/core/src/application/core-application.ts` 中 `/api/v1/works/:workId/services` 与 `/api/v1/operations/:operationId`；不新增服务端路由、数据库字段、迁移、依赖或 Docker 管理路径，不改变 `work-services` 的既有要求。
- 使用现有用户 bearer 会话和授权规则：所有者及有控制权限的管理员可读元数据并控制服务；日志仅向所有者开放。CLI 状态输出采用元数据白名单，不输出 HTTP 响应中可能包含环境变量的完整服务定义。
- 保持原有 Work、chat、配置、operator CLI 和 agent 服务部署行为；属于增量兼容变更。
- 主要风险是把持久禁用误解为临时停止、把停止 Work 上的 enable 完成误解为服务 ready，以及在异步观察失败后丢失资源标识。帮助、输出和测试必须明确这些区别。
- 明确非目标：名称解析、批量/all 操作、日志 follow、清理持久数据、服务创建/更新、自动启动所属 Work、修改恢复策略、Console UI。
