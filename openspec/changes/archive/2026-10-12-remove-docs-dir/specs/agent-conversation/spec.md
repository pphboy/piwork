# agent-conversation 规格变更

## ADDED Requirements

### Requirement: 原生 Core 与 SDK 会话的协商和冷恢复

**Identifier:** CONV-ADAPTER-001

Core SHALL 负责用户授权、desired/active 与代次、Docker 和路由准入，完整 TS Agent 保持 SDK、Session/Run、模型/工具、MCP 与私有历史。只有当前 ready 代次 mTLS 通过才转发 Session/Run；观察断线只结束观察，明确 cancel 才中止执行。稳定 SDK Session ID 和历史路径 SHALL 可在另一进程恢复，路径存在不能冒充 SDK 已持久化消息。

可选聊天能力 SHALL 独立协商，未知/旧 Agent 继续基本聊天且新控件明确不可用，不自动换镜像。模型、Thinking、资源命令和原键查询按有效 agent-conversation / ai-model-management 契约；当前 nullable 行为使用 chat contract 3，不以旧文档的 contract 1 或 history schema 4 作为当前上限。Run 固定受理设置和来源，执行前核对同一模型与凭据描述，不替换失效模型。

资源命令 SHALL 仅从 validated active 资源发现，text 禁止 slash 展开，command 只执行已确认资源，旧省略行为保持；未知提交只查原键不自动重发。工具历史 SHALL 保持安全顺序块、原 Run 关联和 UTF-8 64 KiB 有界预览，不公开完整参数、原始 Thinking、凭据或私有路径。history schema 4 是兼容输入，schema 5 与独立 Memory 按有效主规格和生成源执行，不能把过期十三表描述当成当前数据库定义。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec
