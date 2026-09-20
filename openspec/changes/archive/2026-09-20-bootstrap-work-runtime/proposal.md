# Proposal

## Why

piwork 需要把架构图中的 Work 变成可登录访问、可配置、可恢复的持久运行单元；现有 demo 只提供单 daemon 与 CLI 对话，尚不能管理用户、隔离 Work 或恢复 agent 自主创建的容器服务。本变更建立第一版完整闭环，让用户创建 Work 后，agent 能声明服务并在 Work 重启时保留配置和数据。

## What Changes

- 建立单机 Core、每 Work 一个 piwork-agentd、最小 CLI 和 Core Web 控制面板。
- 提供首次管理员初始化、用户创建／禁用／凭证重置、登录／注销，以及用户和 daemon 的 Work 访问隔离。
- 引入持久 Work、版本化环境配置、异步 Operation 和生命周期协调；启动、停止、删除和崩溃恢复均可查询。
- 支持选择兼容 agent 基础镜像、固定版本 Skills、MCP 和模型配置；区分期望版本与实际加载版本。
- 提供持久 Session／Run、单 Work 执行并发控制、显式取消和可重连事件观察，执行不依赖 Client 连接存活。
- 向 agent 提供 Work 服务管理工具。Core 先保存服务定义和操作记录，再创建容器；Work 重启时独立恢复已启用服务及其持久卷。
- 定义配额、运行身份、资源归属、删除保留策略、重试预算和故障接管，验证不会重复创建或跨 Work 操作。
- 第一版不包括跨主机调度、Work 分享、包导入导出、公开应用域名、通用镜像构建、完整桌面端或 WebChat。

## Capabilities

### New Capabilities

- `user-administration`: 首个管理员初始化，以及控制面板中的用户创建、禁用和凭证重置。
- `user-authentication`: 可撤销登录会话、登录／注销／过期及 CLI 和浏览器凭证处理。
- `work-access`: 用户所有权、管理员控制权限和 Work 运行身份的授权边界。
- `work-lifecycle`: Work 创建、查询、启动、停止、删除、异步操作和资源接管。
- `work-configuration`: 版本化镜像、Skills、MCP、模型与资源策略的验证和应用。
- `work-storage`: 工作文件、会话和服务数据的隔离、保留、重挂载与显式清理。
- `skill-activation`: 固定版本 Skills 的加载、状态报告和故障处理。
- `mcp-tool-access`: MCP 工具发现与调用、必需／可选依赖及连接／子进程生命周期。
- `agent-conversation`: 持久会话、Run 接受与终态、并发、取消和中断恢复。
- `work-connectivity`: 稳定 Work 入口、认证路由、流式观察、重连和背压。
- `work-services`: agent 自主声明、更新和管理持久容器服务，并随 Work 恢复。

### Modified Capabilities

无。当前项目没有已有主 capability specs。

## Impact

- 设计依据为 `arch/piwork.arch.md` 的第一版范围；架构中的推荐默认值在本 change 中转化为待评审的具体设计决定。
- 新增 `apps/core`、`apps/agentd`、`apps/cli`、`apps/console`，以及 contracts、client-sdk、pi-adapter、runtime-docker、core-store、work-store 等共享模块。
- 复用 `demo/` 的 SDK 适配经验、事件映射和 gRPC 集成测试方法；保留 demo 作为独立样例，不承诺其匿名 `Ask` 协议与新产品 API 兼容。
- 引入 Docker、持久卷与网络隔离、SQLite、用户认证、TLS、MCP 客户端和最小 Web UI；生产模型凭证通过受控 secret 引用提供。
- 需要受控 Docker 集成环境验证创建／恢复／删除与故障窗口；普通测试使用确定性模型和 MCP fixtures，不依赖真实模型费用。
- 本轮仅创建规划 artifacts；实现、部署和主 specs 同步均在后续工作流完成。
