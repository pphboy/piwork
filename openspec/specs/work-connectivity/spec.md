# Work Connectivity Specification

## Purpose

提供只依赖稳定 Work 身份的远程连接与执行观察能力，屏蔽容器地址变化，并明确认证、实例路由、事件恢复和慢速客户端行为，使 Client 可以保持简单而不承担 Work 生命周期或业务状态推断。

## Requirements

### Requirement: Discover and connect by stable Work identity

Client SHALL 只需配置 Core 入口并登录，通过 discovery 和 Work ID 连接有效 daemon，无需输入容器 IP 或端口。所有路由 SHALL 执行 work-access 授权并使用加密远程连接。

#### Scenario: Connect after instance replacement

- **WHEN** 同一个 Work 的 daemon 地址因替换而改变
- **THEN** Client 使用原 Core 入口和 Work ID 能连接新有效实例，无需人工更新地址

### Requirement: Route only to a verified ready instance

系统 SHALL 仅路由到当前有效代次且完成必要初始化的 daemon；stopped、starting、unknown 或故障状态 SHALL 返回明确不可用状态，不隐式创建第二个实例或触发启动。

#### Scenario: Connect to a stopped Work

- **WHEN** 用户连接已停止 Work
- **THEN** Client 得到 Work 未运行结果和可用的显式启动入口，不直接访问旧容器

#### Scenario: Core recovers routing

- **WHEN** Core 重启并尚未完成实例身份与 readiness 核对
- **THEN** 路由暂时不可用，核对后才允许连接匹配实例

### Requirement: Observe ordered identifiable Run events

观察接口 SHALL 为事件提供 Work、Session、Run 身份、Run 内递增序号和事件类型，并在业务终态后能查询最终结果。传输错误 SHALL 与 Run 终态区分，MUST NOT 仅因流断开宣称 Run 失败。

#### Scenario: Stream failure after progress

- **WHEN** 用户已收到文本或工具事件但观察传输随后失败
- **THEN** Client 显示观察中断并可查询 Run，不伪造业务失败或自动重新提交 prompt

### Requirement: Resume observation within explicit retention bounds

系统 SHALL 支持按事件游标继续观察，并返回可用的最早游标；默认每 Run 保留最近 10,000 个事件，终态后至少 24 小时不因时间清理该保留窗口。超出窗口的游标 SHALL 返回 CURSOR_EXPIRED 并提供状态／历史读取方式，Run 最终状态保留遵循 work-storage。

#### Scenario: Resume within window

- **WHEN** Client 从仍在保留窗口内的最后接收序号重连
- **THEN** 系统提供其后事件，Client 能按序号去重且不会重新执行 Run

#### Scenario: Resume with expired cursor

- **WHEN** Client 请求比最早保留事件更旧的游标
- **THEN** 系统明确返回 CURSOR_EXPIRED，用户仍能读取当前状态、最终结果和已保存会话历史

### Requirement: Bound slow observers independently

系统 SHALL 对观察连接执行有界缓冲，默认每流上限 1 MiB；慢速观察者超限 SHALL 结束其观察并允许重连，不能无界消耗内存或阻止其他观察者和 Run 执行。

#### Scenario: One of two observers stops reading

- **WHEN** 两个 Client 观察同一 Run，其中一个超过发送缓冲上限
- **THEN** 慢速连接以可重连错误结束，另一连接继续收到事件，Run 继续执行

### Requirement: Provide a minimal remote CLI

CLI SHALL 提供登录／注销、Work 创建／列出／查询／启停／重试／删除、Session 对话和 Run 查询／观察／取消。用户在回答期间明确按取消键 SHALL 发起 CancelRun；普通网络丢失仅触发连接恢复提示。

#### Scenario: Login create and chat

- **WHEN** 用户使用 CLI 登录、按指定环境创建 Work 并等待就绪
- **THEN** 用户能够进入该 Work 对话并看到流式结果，CLI 不需要本机 Docker
