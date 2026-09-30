# Design

## Context

参见 [proposal.md](proposal.md)。当前 `WorkServiceManagementService` 将 service 的 `svc-<name>` Docker 私网别名和声明端口返回给 agent 与客户端；`PiworkClient.serviceSummary()` 对输出采用固定字段白名单；生产 Core 使用一个 HTTP listener，另有只供 agent 的 mTLS gRPC listener。Docker 通过 installation/Work/kind/logical ID labels 查找和接管容器，现有显示名称是哈希。Core schema 为 8，启动会拒绝任何不等于当前版本的非空数据库。`.work` V1 清单使用严格 schema，派生的容器/网络身份不在包内。Work 名称仅在所有者内唯一，且可能是中文；service 名称允许尾部连字符。Docker HTTP readiness 已能从受管容器的 Work 私网 IP 检查端口，说明 Core 宿主具备这一路由能力。

## Goals / Non-Goals

**Goals:** CLI 到同一 Core 的认证连接可流式访问用户 service；域名和端口由 Core 从受管身份解析；同一服务重启后地址稳定；通过独立解析接口预留未来域名策略替换；已有 Work/包/容器可安全升级。

**Non-Goals:** 首版不暴露独立的域名修改/持久化 API、不把派生别名写入 `.work` V1、不通过代理访问任意 TCP/UDP、不提供应用侧 TLS、宿主端口、公网 DNS、系统级代理配置或 Console 页面。

## Decisions

### 1. 平台身份与路由身份分开

新增 schema 9 的 `work_network_names(work_id PRIMARY KEY, name UNIQUE, created_at)` 与 `service_domain_labels(work_id, service_id, label, UNIQUE(work_id,label))`。两表属于目标 Core 派生身份，不改变 `works.name`、service definition/revision 或 Docker labels。创建 Work、导入发布 Work、创建 service 的接受事务同时分配对应记录；删除保留记录以避免旧书签解析到新对象。重复幂等请求沿用已有记录。域名解析由 `ServiceDomainResolver` 统一完成，公开 `assignDefault`、`describe`、`resolveTarget` 三种操作；以后自定义 label 可替换分配策略与引入独立变更入口。本次没有自定义写接口。

对于正常 `work-<UUID>`，去除固定前缀和 UUID 连字符并小写，取前 8 个十六进制字符作为 `w-<prefix>`；若与现存别名冲突，则每次延长 4 位，至 32 位；极端完整 UUID 冲突按 Work ID 的 SHA-256 后缀继续确定性延长，前缀部分最多 61 位，耗尽则拒绝分配而不复用。旧系统中非 UUID 的合法 Work ID 使用 SHA-256(完整 Work ID) 的前 8 位，依同样规则延长。分配在同一写事务里按唯一约束重试，现有 Work 的迁移按 `(created_at,id)` 顺序回填，使竞争不影响升级结果。网络名一经分配不随 Work 重命名改变。

service 名称若符合 DNS 单 label（末尾是字母/数字），默认 label 即原名。现有允许末尾连字符的 service 使用去除尾部连字符后的名字加 `-` 和 service ID 哈希前 8 位；与现存 label 冲突时延长哈希并按 63 字符上限截断基础部分。事务唯一约束保证同 Work 不重复。完整主机名固定为 `<label>.<work-network-name>.work`，按大小写不敏感、去除末尾点的方式解析；不接受额外标签、IP 或 Unicode 变体。`.work` 是公网 TLD，CLI 仅拦截该 Core 已登记的主机名，PAC 对其他站点返回 DIRECT。

替代方案是从用户可见名称生成域名；既有中文名称和不同所有者可重名，使地址不唯一。另一个方案是把新字段写入 service definition，但会扩大 V1 包格式和 revision 语义，且域名变化会无谓地替换容器。

### 2. HTTP 入口由声明端口确定，readiness 不作为首页

`ServiceAccess` 公开投影为 `{hostname, defaultUrl: string|null, defaultPortName: string|null, status, ports:[{name,port,url}]}`。`ports` 仅包含声明的 TCP 端口，按 `(port,name)` 排序；`url` 为 `http://<hostname>:<containerPort>/`，即候选 HTTP 地址，不保证应用协议。若声明 TCP 80，则 `defaultUrl=http://<hostname>/` 且默认目标为 80；否则若 HTTP readiness 指向已声明 TCP 端口，则默认目标取该端口，默认 URL 仍使用无端口域名；其他情况 `defaultUrl=null`。未声明 TCP 端口时 `ports=[]`。readiness.path 只用于健康检查，绝不附加到访问 URL；`http://<hostname>:<实际端口>/` 始终选择该声明端口。无端口 URL 虚拟 80 的优先级如上，显式 `:80` 在确有 TCP 80 时选择真实 80。若无真实 80 且默认目标是其他端口，`:80` 与无端口访问使用默认目标，确保浏览器的 CONNECT `:80` 可用。若无默认目标，无端口 URL 返回 `PORT_REQUIRED`。

`status` 取 `available|unavailable|no-default-port`：只有 Work desired=running、observed=ready/degraded、service enabled 且 observed=ready、未删除，并且 Core 确认当前受管 service 容器 running 时为 available；无默认入口但存在可用的显式 TCP 端口时为 no-default-port；其余为 unavailable。列表/详情不会因 Docker 临时错误失败，Core 返回 `unavailable` 和安全原因；一次访问在真实转发前重新检查，因此旧列表不会授权新连接。ready 是路由门槛，不能仅由 Docker running 推断。

### 3. Core 提供仅用于服务的 HTTP 网关

在生产 HTTP listener 增加三类路由：`GET /api/v1/service-access` 用用户 Bearer 返回版本/支持协议，供代理启动检查；`GET /api/v1/service-access/resolve?hostname=<domain>&port=<1..65535>` 用网关专用认证头返回 `{hostname,workId,serviceId,port}`，仅供本地代理确认 CONNECT 目标；`/api/v1/service-gateway/<hostname>/<port>/<raw-path-and-query>` 流式转发任意普通 HTTP method 或 WebSocket Upgrade。后两类用 `X-Piwork-Gateway-Token` 验证现有用户会话，普通请求的 `Authorization` 留给应用。每次请求、Upgrade 和 CONNECT 解析都从域名映射到 Work/service/声明 TCP 端口，执行 `read-content` 所有者授权，检查 lifecycle，并通过现有 Docker labels 与所选 Work 网络名核验容器，再取该网络的 IP；不接收客户端的容器 IP、网络名、Work ID、service ID 或任意目标 URL。Core 使用直连应用 IP 的 Node HTTP client，明确绕开宿主环境 HTTP proxy；应用看到虚拟域名的 Host。

网关使用原始 HTTP path/query，保留方法、状态码、响应体、应用 Cookie 与应用 Authorization，并剔除 `Connection` 所点名的逐跳头、`Proxy-*`、`X-Piwork-Gateway-*` 等平台头；转发前重新生成 Host、长度和必要的 Upgrade 头。Core 对下游响应也删除自称网关错误的保留头，并以平台专用 `X-Piwork-Gateway-Error` 标记自身失败，让 CLI 区分应用返回的 401/404/500。对 `Location: http://svc-<name>:<port>` 这类 Work 私网绝对跳转，首版不改写；应用应使用相对地址或虚拟 Host，文档注明限制。流式传输以 Node 背压连接两侧，不完整缓冲上传、下载或 SSE；WebSocket 101 后双向 pipe，关闭一端或撤销权限会关闭两端。所有网关入口在建立与持续期间校验会话和 service 目标，活动流每 2 秒复查，防止停止/删除/登出后长连接继续读内容。并发限制：每用户 64、整个 Core 256 条访问连接，超限 503 `SERVICE_ACCESS_LIMIT`；请求头上限 32 KiB，连接建立超时 10 秒。已建立 SSE/WS 不设总时长限制，仍受关闭与定期授权检查约束。

网关错误：未登录/过期 401 `AUTH_REQUIRED`，非所有者或未知域名 404 `NOT_FOUND`，未声明端口 404 `PORT_NOT_DECLARED`，缺默认端口 400 `PORT_REQUIRED`，停止/未就绪 503 `SERVICE_UNAVAILABLE`，Docker 状态未知或连接失败 502 `SERVICE_UPSTREAM_UNAVAILABLE`，超限 503。错误 JSON 不含目标 IP、容器 ID、服务定义或秘密。普通应用的同名状态码与正文原样传递。Core 关闭时新连接 503，已建立连接在关闭期间结束。

使用独立网关而非 CLI 查询 Docker IP：Docker IP 在替换后会失效，且 CLI 不应有宿主 Docker 权限。使用专用平台认证头而非占用 `Authorization`，因为应用自身可能使用该头。

### 4. CLI 前台 HTTP 代理和 WebSocket CONNECT

`piwork-cli proxy [--port 1..65535]` 复用全局 `--core` 解析和登录凭证；`--json` 对前台持续运行命令为用法错误。先做语法与凭证检查，并对非 loopback Core URL 强制 HTTPS，再请求 Core capability，最后监听 loopback。默认 `127.0.0.1:17890`；冲突或非 loopback 失败，绝不自动换端口。启动后打印代理 URL 和 `http://127.0.0.1:<port>/proxy.pac`；PAC 只把符合 `^[a-z][a-z0-9-]*\.w-[a-f0-9]{8,61}\.work$` 的 HTTP/WS 目标发给代理，其余返回 DIRECT。PAC 响应无缓存且仅允许 loopback 直接请求，避免其他主机把它当作开放代理。CLI 拒绝非 HTTP URL、未登记主机、无声明端口及直接代理非 `.work` 主机，不做公网回退。

普通 HTTP 代理请求使用 absolute-form URL，CLI 解析 authority 后用 SDK 的原始流式网关客户端转发；本地不解析用户域名的公网 DNS。浏览器 WebSocket 对 `ws://` 通常先使用 `CONNECT domain:80`：CLI 用 `resolve` 核对权限和端口后，仅在该 CONNECT 套接字上接受 HTTP/1.1 Upgrade，然后通过 Core upgrade 网关转发，绝不把 CONNECT 变成可发送任意字节的 TCP 隧道；CONNECT 后的 Host 必须与已核对的 authority 一致。普通 absolute-form WebSocket Upgrade 同样支持。`https://`、`wss://` 的 CONNECT 被拒绝，PAC 返回 DIRECT；文档明确首版公开应用 URL 使用 `http://`/`ws://`，CLI 到远程 Core 仍必须为 HTTPS，loopback Core 可使用 HTTP。

代理进程在 Ctrl+C 时关闭 listener/流并退出 130，平台会话失效时停止接受新连接并退出 3；单个应用 4xx/5xx 不终止代理。关闭期间不取消 Work/Service Operation。身份仅在启动时从凭证文件读取，不在进程存活中悄悄换用户；Core 登录失效需重新启动代理。PAC 只为非安全 scheme 配置代理，不自动改系统代理配置。安全错误写 stderr，凭证、请求/响应体不写日志；CLI 命令帮助无需登录或联网。

采用前台进程使登录生命周期和监听端口清晰，避免引入后台 daemon、全局 DNS 或本机证书。连接上的 HTTP 解析受限而非裸 TCP CONNECT，避免绕过 Core 的逐请求授权和服务范围限制。

### 5. Docker 显示名与迁移

`DockerContainerSpec` 增加仅 Core 内部构造的服务显示名称；service 新建/替换用 `<work-network-name>_<service-name>`，agent 与 helper 仍使用现有命名。`ensureContainer` 先按 labels 找匹配资源，若旧容器存在，依原 spec hash/labels 接管并保留旧名称；不存在时才尝试新名称。若 Docker 中同名但 labels 不属该 Work/Service，返回明确冲突，不删除或复用。现有 `svc-<name>` 网络别名和无宿主端口约束不变。

升级路径：只接受空库、新 schema 9、已有 schema 8；8→9 在单事务建表并按固定顺序回填 Work/service 的派生别名，失败则回滚并不报告 ready。低于 8 或高于 9 继续按现有存储格式错误拒绝。Core 9 启动后旧二进制不能回滚读取数据库，部署前需备份数据目录。旧容器无需改名或重建；重建时新名称可见。

导出只携带原有 Work/service 定义；导入在目标 Core 发布事务中为新 Work/service ID 分配网络标识。V1 manifest/schema/golden bytes 不变；源应用文件内的 URL 文本仍按 PWORK-004 保留字节，不擅自改写。目标列表给出新域名，源平台的旧域名不会被目标 Core 认领。

## Risks / Trade-offs

- [真实 `.work` TLD 与公网域名重合] → PAC 只按严格模式选择代理；Core 只认数据库已分配域名，未知域名拒绝且无 DNS 回退。
- [服务声明的是 TCP 端口但应用并非 HTTP] → 所有显式 URL 标明候选；HTTP 失败返回上游错误，首版不宣称原始 TCP 可访问。
- [SSE/WS 长连接越过权限变化] → 每 2 秒复核，会话失效或服务不可用立即关闭连接。
- [旧 service 名称不满足 DNS label] → 稳定哈希标签与原名称分开保存，不改变 service ID/name 或 Docker 私网别名。
- [数据库版本升级无法由旧软件直接回滚] → 单事务升级、备份与升级前测试，旧 Docker 容器通过 labels 原样接管。
- [浏览器应用绝对内部 URL/HTTPS 假设] → 首版保留应用层行为，文档明确相对 URL 与 `http://`/`ws://` 用法。

## Migration Plan

1. 发布前备份 Core 数据目录；保留现有 Docker 容器运行。
2. 新 Core 在取得单实例锁后从 schema 8 事务升级到 9，并回填派生别名；校验唯一性和映射完整性，再开启网关。
3. 使用原登录凭证启动新 CLI proxy；旧 CLI 仍能调用原有 service 管理 API，旧容器保持原名直至被正常替换。
4. 如果升级失败，事务回滚，恢复到 schema 8 的备份与旧二进制；升级成功后需要回滚时先恢复整个备份，不能直接以旧二进制打开 schema 9。
