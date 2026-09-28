# Service Network Access Specification

## Purpose

为 Work 内由 agent 创建的服务提供稳定的本地可用域名，并使已登录用户经过 CLI 与 Core 的认证链路访问应用网页、HTTP API、SSE 和 WebSocket。域名和实际容器地址由 Core 统一解析，Work 的重启、恢复与导入不要求用户手动查找 Docker 地址。

## Requirements

### Requirement: 分配稳定且唯一的 Work 和 service 网络身份

**Identifier:** SNET-001

系统 SHALL 为每个 Work 持久分配唯一 `w-<短 ID>` 网络名称：正常 `work-<UUID>` 取去连字符 UUID 的前 8 位十六进制字符，冲突时按 4 位逐步延长；历史非 UUID ID 以其完整 ID 的 SHA-256 前缀代替，仍保持唯一。Work 显示名称 SHALL 保持原样，中文显示名称无需转写。service 默认域名 SHALL 为 `<service-domain-label>.<work-network-name>.work`；合法 DNS service 名称直接作为 label，尾随连字符等不合法名称 SHALL 获得唯一且稳定的合法 label。域名在 service 重启、Core 重启及 Work 名称变化后 SHALL 不变；删除后的 label 不得被其他 service 复用。本次不提供修改 label 的外部操作。

#### Scenario: 中文 Work 和普通服务
- **WHEN** 名为“笔记项目”的 Work ID 为 `work-a1b2c3d4-0000-4000-8000-000000000001`，其中创建 `notes` 服务
- **THEN** Work 网络名称为 `w-a1b2c3d4`，service 域名为 `notes.w-a1b2c3d4.work`，显示名称仍为“笔记项目”

#### Scenario: 前缀冲突
- **WHEN** 两个 Work ID 的前 8 位相同，或历史 service 名称在 DNS 标签规范化后冲突
- **THEN** 系统为后分配者延长标识并持久保存，两个域名均能唯一解析，重启后不交换归属

#### Scenario: 不合法的旧 service 名称
- **WHEN** 已有 service 名称为 `demo-`
- **THEN** Core 为其返回符合 DNS 单标签规则的稳定域名，不修改服务名称或定义版本

### Requirement: 对声明的 TCP 端口提供明确的访问地址

**Identifier:** SNET-002

Core SHALL 为每个未删除服务返回 `{hostname,defaultUrl,defaultPortName,status,ports}`。`ports` SHALL 只包含当前定义中已声明的 TCP 端口，按 `(port,name)` 排序，并分别提供 `http://<hostname>:<port>/` 候选 URL；UDP 端口不产生 HTTP URL。若声明真实 TCP 80，默认无端口 URL 指向它；否则若 HTTP readiness 指向 TCP 端口，默认 URL 指向该端口；其他情况 `defaultUrl` 与 `defaultPortName` 为 null。无默认端口时访问无端口 URL SHALL 返回 `PORT_REQUIRED`；显式端口只允许匹配声明的 TCP 端口。readiness 路径不成为应用 URL 的路径。`status` SHALL 区分 `available`、`no-default-port` 和 `unavailable`，列表中的地址可见不等于当前可访问。

#### Scenario: HTTP readiness 使用其他路径
- **WHEN** `web` 端口为 8000、HTTP readiness.path 为 `/health`，且无 TCP 80
- **THEN** defaultUrl 为 `http://<hostname>/` 且转发到 8000 的 `/`，候选 URL 为 `http://<hostname>:8000/`，不默认打开 `/health`

#### Scenario: 多端口显式选择
- **WHEN** service 声明两个 TCP 端口且无 80/HTTP readiness
- **THEN** defaultUrl 为 null；未带端口请求返回 PORT_REQUIRED，带任一已声明端口的 HTTP 请求路由到对应端口

#### Scenario: 空端口或 UDP-only
- **WHEN** service 未声明任何 TCP 端口
- **THEN** ports 为空，任何 HTTP 访问均不转发到容器

### Requirement: 经 Core 网关传输 HTTP、SSE 与 WebSocket

**Identifier:** SNET-003

Core SHALL 为已认证且获准的请求流式转发 HTTP 方法、path、query、请求体、响应状态、响应体和应用 Cookie/Authorization。SSE SHALL 在应用发送时逐段送达，不等待终态；WebSocket SHALL 完成 101 升级并双向传输帧。应用的 4xx/5xx SHALL 原样返回；Core 自身错误 SHALL 携带可辨识的安全平台错误标记。网关 SHALL 通过 Core 中当前 Work/service/端口与 Docker 受管身份解析目标，不接受任意 IP、URL、宿主端口或未声明端口。网关 SHALL 对用户 64、全 Core 256 条并发连接设限，超限返回 `SERVICE_ACCESS_LIMIT`；请求头上限 32 KiB，连接建立上限 10 秒。

#### Scenario: 浏览器与 curl 访问同一服务
- **WHEN** 所有者通过 CLI 代理对已 ready 的 `notes.w-a1b2c3d4.work` 发起 GET 和 POST
- **THEN** 应用收到原 path/query、方法、正文和应用认证头，客户端收到原应用响应，容器无宿主发布端口

#### Scenario: SSE 与 WebSocket
- **WHEN** 应用持续发出 SSE 事件或接受 WebSocket Upgrade
- **THEN** CLI 实时交付事件与双向帧，不等待整个响应结束

#### Scenario: 禁止其他目标
- **WHEN** 请求域名不存在、端口未声明或试图指定容器 IP/其他 Work 地址
- **THEN** Core 拒绝而不执行 DNS 回退或建立上游连接

### Requirement: 生命周期变化及时撤销访问

**Identifier:** SNET-004

仅当 Work 期望 running 且观测 ready/degraded、service enabled 且观测 ready、未删除，并确认当前受管容器 running 时，Core SHALL 建立访问；其他状态 SHALL 返回明确不可用结果，不能隐式启动 Work/service。每次请求和升级重新核验；活动 SSE/WebSocket SHALL 至少每 2 秒复核会话与 service 资格，资格失效即关闭连接。Docker 暂不可用 SHALL 返回上游不可用而非猜测旧 IP。Core 正在恢复但尚未核对实例时 SHALL 拒绝访问。

#### Scenario: Work 停止并重新启动
- **WHEN** 所有者停止 Work，随后显式重新启动且 service 再次 ready
- **THEN** 停止期间访问失败，恢复后同一域名再次访问新有效容器

#### Scenario: service 删除或用户登出
- **WHEN** service 被删除或当前登录会话被撤销，已有 SSE/WebSocket 仍在传输
- **THEN** Core 在 2 秒内关闭该访问流，不允许旧连接继续读取应用内容

#### Scenario: 未确认容器
- **WHEN** 数据库标为 ready，但 Docker 核验失败或正在恢复实例
- **THEN** 访问返回安全的不可用错误，不连接旧地址也不创建新容器
