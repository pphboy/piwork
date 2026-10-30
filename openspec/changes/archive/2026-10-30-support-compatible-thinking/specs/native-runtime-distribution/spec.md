# Spec Delta

## MODIFIED Requirements


### Requirement: 保持与容器内 Pi 生态的当前契约

**Identifier:** NATIVE-004

Go Core SHALL 与完整保留的 TS pi-agentd Agent harness 通过当前协议互通。harness SHALL 包含其 RPC 服务、readiness/drain、Session/Run、私有历史存储、资源加载、模型/工具执行、MCP 客户端和 SDK 工具适配，以及这些职责所需 TS 依赖；迁移不要求将其中未直接调用 SDK 的函数拆为 Go。`AgentService` 与 `WorkServices` 的 RPC、消息字段、事件序号、缺省值和错误语义 SHALL 保持；双方 SHALL 核验安装、Work、generation、instance 与角色的 mTLS 身份。readiness 完成前不开放运行路由，旧代次不因证书仍有效而获得权限。

Agent runtime/context 配置、挂载布局、Skill/Pi package 内容身份、兼容属性以及 Work history SHALL 遵循 CONV-SNAPSHOT-001 的现行 schema 7、已知 schema 4/5/6 静态兼容及 storage layout 2。SDK 会话、工具执行、模型调用与 Run 终态由 pi-agentd 管理，平台迁移 SHALL 不替换成模拟 Agent 或要求宿主安装 Pi SDK。独立 Service MCP 服务端和 package-helper SHALL 使用 Go；前者继续由 harness 的 TS MCP 客户端调用，后者保持 Pi 兼容准备环境。构建与测试可使用 Node；生产 Node/npm/Pi 生态依赖 SHALL 位于对应镜像内。


本变更新 Agent 的现行 Work history 为 schema 7，继续识别精确 schema 4/5/6 与 Memory schema 1；版本、镜像身份及受控升级遵循 CONV-SNAPSHOT-001。

#### Scenario: 双向真实 RPC 部署
- **WHEN** Go Core 启动真实 TS Agent 镜像，通过现有 SDK 提交一次部署请求
- **THEN** SDK 经 TS MCP 客户端、Go Service MCP 的真实 MCP 请求及 mTLS gRPC 调用 Go Core，返回持久 Service/Operation，Agent 可查询就绪并访问 Work 私网服务

#### Scenario: 拒绝旧代次控制请求
- **WHEN** 一个已被替换的 Agent 使用旧 generation 或错误 Work 身份调用服务管理
- **THEN** Core 拒绝且不写入定义、不分配配额、不创建容器

#### Scenario: 包准备后离线恢复
- **WHEN** Go package-helper 在兼容容器内完成制品准备，Go Core 保存并应用到 Work，随后来源不可达
- **THEN** 制品摘要和实际加载结果一致，后续 Work 启动、快照和恢复不重新访问来源或调用宿主 npm

#### Scenario: 保留完整 TS Agent harness
- **WHEN** Go Core 驱动真实 TS pi-agentd 创建 Session、执行工具、观察 Run、drain 并替换 Agent 容器
- **THEN** harness 通过原 RPC 和私有历史恢复会话；这些职责仍由 TS harness 执行，宿主没有 Node Agent 进程，平台编排不因保留 harness 而回退为 TS
