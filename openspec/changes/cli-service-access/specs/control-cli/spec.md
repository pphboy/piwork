# Spec Delta

## MODIFIED Requirements

### Requirement: Inspect service lifecycle metadata safely

**Identifier:** CLI-SERVICE-002

`list` SHALL 返回未删除服务，按 name、serviceId 排序；`show` SHALL 返回指定服务元数据。每条 CLI 服务投影 SHALL 恰含 `workId`、`serviceId`、`name`、`enabled`、`observedState`、`desiredRevision`、`appliedRevision`、`lastError`、`endpoints`、`access`、`createdAt`。缺少时 `appliedRevision` 和 `lastError` SHALL 保持 null。`lastError` 非空时仅含现有公开的 `code`、`message`、`retryable`，诊断字符串通过现有安全脱敏规则处理。`endpoints` 每项仅含 Core 返回的 `name`、`protocol`、`host`、`port` 与可选 `url`。`access` 仅含 `hostname`、`defaultUrl`、`defaultPortName`、`status`、`ports`；每个 port 仅含 `name`、`port`、`url`。完整服务定义、environment、command、args、mount、镜像身份、容器 IP、平台 token 及其他字段 MUST NOT 输出。

JSON list 输出 SHALL 是单个 `{services: [...]}` 值，JSON show 输出 SHALL 是单条服务投影；文本模式沿用现有缩进 JSON 惯例。空列表 SHALL 输出 `{services: []}` 且 exit 0。即使服务 failed、disabled 或 stopped，成功读取仍 SHALL exit 0，查询成功 MUST NOT 暗示 ready。`endpoints` SHALL 保持 Work 私网端点，MUST NOT 被描述为宿主公开端点；`access` URL SHALL 标明需运行 CLI 代理。

#### Scenario: Inspect an agent-created service
- **WHEN** 已认证所有者先列出服务，再按已有 serviceId 查询详情
- **THEN** 输出该服务身份、开关与观测状态、期望/应用版本、公开错误、私网端点和代理访问信息，不改变服务状态

#### Scenario: Return an empty collection
- **WHEN** Work 没有未删除的服务
- **THEN** JSON list 恰输出 `{"services":[]}` 和换行，exit 0

#### Scenario: Protect service definition content
- **WHEN** Core 返回的完整服务定义包含环境凭证和任意额外字段
- **THEN** 文本与 JSON list/show 均不包含该定义、凭证或额外字段

#### Scenario: Inspect a failed service
- **WHEN** show 返回 `observedState: failed`、最近错误和稳定 hostname
- **THEN** CLI 显示公开错误和 `access.status=unavailable`，因查询成功而 exit 0，不声称 URL 当前可访问

## ADDED Requirements

### Requirement: 启动有界的 CLI 本地服务代理

**Identifier:** CLI-SERVICE-PROXY-001

`piwork-cli [--core <url>] proxy [--port <1..65535>]` SHALL 在前台监听 `127.0.0.1`，默认 17890；启动前核验语法、当前用户凭证和 Core 网关能力。远程 Core URL SHALL 使用 HTTPS，loopback Core 可以使用 HTTP。启动成功 SHALL 输出代理地址与 `/proxy.pac` URL；PAC SHALL 仅让符合默认 Work 域名形状的 `http://`、`ws://` 目标使用该代理，其他目标 DIRECT。CLI SHALL 拒绝代理其他域名、HTTPS/wss、未登记域名和未声明端口，不修改系统代理、hosts 或公网 DNS。帮助无需凭证和网络；`--json`、非法或重复端口为用法错误 exit 2，缺登录/会话失效 exit 3，Core 不可用 exit 5，端口占用 exit 6；启动失败不留监听进程。Ctrl+C SHALL 关闭代理及活动连接并退出 130。应用返回 4xx/5xx 不结束代理。

#### Scenario: curl 使用默认域名
- **WHEN** 所有者已登录，启动 `piwork-cli proxy`，执行 `curl --proxy http://127.0.0.1:17890 http://notes.w-a1b2c3d4.work/`
- **THEN** 返回目标应用 HTTP 响应，CLI 无需本机 Docker 权限

#### Scenario: 浏览器使用 PAC 和 WebSocket
- **WHEN** 浏览器配置 CLI 输出的 PAC URL，打开服务网页并建立 `ws://` 连接
- **THEN** HTTP 与 WebSocket 均经过代理和 Core，其他网站按 PAC 返回 DIRECT

#### Scenario: 无法启动代理
- **WHEN** 用户未登录、选择端口已占用或传入非数字端口
- **THEN** CLI 返回相应退出码及安全错误，不打印 token，不自动监听其他地址或端口

#### Scenario: 拒绝开放 CONNECT
- **WHEN** 浏览器为 WebSocket 向代理发送 CONNECT，随后发送非 HTTP Upgrade 字节或不匹配的 Host
- **THEN** 代理关闭该套接字，不建立任意 TCP 通道；合法 WebSocket 升级仍可完成
