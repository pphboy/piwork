# MCP Tool Access Specification

## Purpose

使 Work 中配置的 MCP 服务真正成为 agent 可发现和调用的工具，并区分本地进程、Work 容器和远程服务的生命周期，明确必要依赖、超时、凭证及连接故障对 Work 可用性的影响。

## Requirements

### Requirement: Discover and invoke configured MCP tools

系统 SHALL 支持配置的 stdio 和 Streamable HTTP MCP 服务，将工具以可区分 server 身份的名称暴露给当前 Work 的 agent，验证调用参数并返回工具结果或明确错误。凭证 SHALL 按需要注入，不能返回到工具发现响应。

#### Scenario: Agent invokes an MCP fixture

- **WHEN** 一个配置的 MCP server 提供确定性工具且 agent 发起有效调用
- **THEN** 工具被发现并执行，agent 得到其结果，运行事件可以关联 server 和 tool

#### Scenario: Two servers expose the same tool name

- **WHEN** 两个 MCP server 都暴露名为 search 的工具
- **THEN** 两个工具具有不同可寻址身份，调用不会被静默路由到错误 server

### Requirement: Distinguish required and optional dependencies

MCP 配置 SHALL 声明 required 或 optional；required 初始化失败 SHALL 阻止 agent ready，optional 失败 SHALL 保持 agent 可用并报告工具不可用。依赖本 Work 服务的 required MCP SHALL 使用显式服务引用；不接受循环或不存在的依赖。

#### Scenario: Required MCP is unavailable

- **WHEN** required MCP 在配置初始化期限内不能完成连接和发现
- **THEN** Work 报告具体依赖错误，不接受 Run

#### Scenario: Optional MCP is unavailable

- **WHEN** optional MCP 无法连接但其他必要初始化成功
- **THEN** agent 可接受对话，调用该 server 工具返回不可用错误，不伪造成功结果

### Requirement: Bound tool calls and connection recovery

MCP 调用 SHALL 有可配置超时，默认 30 秒；到期 SHALL 返回工具超时且不自动重复可能有副作用的调用。连接重建 SHALL 有有界预算，状态与错误可查询。

#### Scenario: Tool call times out

- **WHEN** 工具执行超过有效超时
- **THEN** Run 得到明确工具错误，系统不因重连自动再次执行同一调用

### Requirement: Own local processes and respect external lifecycles

daemon SHALL 回收自己启动的本地 MCP 进程及受管子进程，退出宽限默认 5 秒、之后终止；Work 容器 MCP 的启停 SHALL 遵循 work-services，远程 MCP 仅断开连接不能被 piwork 停止。

#### Scenario: Stop Work with local and remote MCP

- **WHEN** Work 停止且连接了本地 stdio 和远程 HTTP MCP
- **THEN** 本地受管进程被回收，远程连接关闭，远程服务继续运行

#### Scenario: Change MCP configuration

- **WHEN** 用户修改 MCP 配置后重启 Work
- **THEN** 新配置连接被建立，旧本地进程和旧工具列表不被复用
