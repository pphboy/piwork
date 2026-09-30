# Proposal

## Why

Work 的 agent 已能部署持久 service，但 CLI 只能管理服务并查看 Docker 私网中的 `svc-<name>:<port>`，本机 curl 和浏览器无法访问这些应用。需要建立由 CLI 本地代理接入、Core 统一鉴权和路由的访问链路，并提供稳定、可扩展的服务域名。

## What Changes

- 新增 `piwork-cli proxy [--port <port>]`，默认监听 `127.0.0.1:17890`，使用当前用户登录凭证连接选定 Core，支持 HTTP、SSE 和 WebSocket；提供浏览器 PAC 地址。
- 新增 Core 服务访问网关，只能访问当前用户拥有的 Work 中已声明的服务端口；保持流式请求/响应、应用 Cookie 和 Authorization，隔离平台凭证。
- 为 Work 分配稳定网络标识 `w-<Work ID 短前缀>`，初始取 8 位，发生冲突时延长并持久保存；Work 显示名称继续允许中文。
- 默认域名为 `<service-domain-label>.<work-network-name>.work`。通常 service-domain-label 就是 service 名称，历史名称不满足 DNS label 规则时分配稳定合法标签。新建 service 容器名使用 `<work-network-name>_<service-name>`。
- 在 Core 内建立独立的域名分配、查询及端口选择接口，HTTP/gRPC/MCP 查询与 CLI 共用结果。本次仅开放默认域名；不增加自定义域名写 API 或 AI 改名工具。
- CLI service list/show 增加独立 `access` 信息，保留原有内部 `endpoints`；由 Core 返回域名、默认 URL、具名 TCP 端口候选 URL 和访问状态。
- 默认入口优先使用声明的 TCP 80，其次使用 HTTP readiness 指向的端口；没有默认入口时通过 URL 显式指定已声明的 TCP 端口。候选 HTTP URL 不承诺其后应用实际使用 HTTP；UDP 和原始 TCP 转发不属于首版。
- 对现有 Core schema 8 增加一次明确的 schema 9 升级与派生网络身份回填；原容器继续按 labels 接管，新建/替换容器使用新名称。导出包 V1 与 service 定义格式保持兼容，导入后按目标新 ID 重新分配网络身份。

目标是登录后运行一个代理进程，查看 service 返回的 URL，即可从 curl 或已配置代理的浏览器访问应用，并在 Work/Core 重启后继续使用相同 URL。

非目标：公网发布、系统 DNS/hosts 修改、自动安装系统代理、后台 daemon、自定义域名配置、任意 TCP/UDP、应用侧 HTTPS/wss 证书、Console 新 UI、CLI 创建/更新 service。CLI 到远程 Core 的传输使用 HTTPS；同机 loopback 开发连接允许 HTTP。

## Capabilities

### New Capabilities

- `service-network-access`：默认网络身份、可扩展解析接口、端口选择、Core HTTP/WebSocket 网关、生命周期路由撤销、流量边界与错误语义。

### Modified Capabilities

- `control-cli`：新增前台代理、PAC、代理进程输出/退出行为，并扩展 service list/show 的公开字段白名单。
- `work-services`：同时公布 Work 内部端点与经 CLI 访问的默认域名，增加可读 Docker service 容器命名和旧容器接管规则。
- `work-access`：定义应用访问的所有者权限、平台与应用认证隔离、会话撤销及受限转发目标。
- `portable-work`：明确默认网络身份是平台派生状态，导入使用新 Work ID 重建，保持包 V1 不变。
- `core-service-startup`：支持已有 schema 8 的受控升级和网络身份回填，恢复完成前阻止服务路由。

## Impact

- `apps/cli`、`packages/client-sdk`：增加 HTTP 代理/PAC、流式网关传输、service access 类型及输出投影；使用 Node 标准 HTTP/HTTPS/stream API，生产实现不引入代理框架。
- `apps/core`：增加服务网络身份/解析和 gateway 组件，在生产 HTTP listener 接入请求与 upgrade；复用用户会话、Work 授权、服务状态和 Docker 身份核验。
- `packages/core-store`：schema 9 派生身份表、事务分配、schema 8 回填；不更改用户服务定义和 Operation 的既有格式。
- `packages/contracts`、service gRPC 与 `apps/service-mcp`：为查询结果追加 access 投影及 protobuf 字段，不开放新的 mutation；旧客户端可继续忽略追加字段。
- `packages/runtime-docker`、Docker service adapter：接受可信 Core 提供的容器显示名称、解析经过身份核验的 Work 私网目标；Docker labels 继续作为身份依据。
- `apps/core/src/work-snapshots`：导入发布时生成目标网络身份，导出不加入派生身份；现有 V1 golden fixture 应继续通过。
- 文档和验收：补充 CLI/curl/PAC、HTTP/SSE/WebSocket、重启与鉴权边界，以及真实 Docker 容器无宿主端口发布的端到端验证。
- 兼容影响：升级后的数据库不能由只认识 schema 8 的旧 Core 打开；旧容器不会仅为改名而重启。`access` 是追加公开字段，严格依赖旧 CLI JSON 字段集合的消费者需允许该字段。
