# Design

## Context

动机见 proposal.md。当前实现的三个耦合点：

| 当前源码 | 现状 | 本次调整 |
| --- | --- | --- |
| `internal/app/run.go`、`internal/coreapp/application.go` | `ListenWithHandler` 把网页包装到 Core 的单一 listener | 启动协调器持有两个独立 HTTP server 的生命周期 |
| `internal/webapp/server.go`、`setup.go`、`authentication.go` | 注入 Core 对象/handler，使用 `NewHandlerTransport`，直接读取身份、准备状态和订阅会话 | 只接收 Core URL、HTTP 客户端及最小首次初始化委托 |
| `internal/cli/user_desktop_service*.go`、`hosted_services.go` | 本机 Desktop 按 Host 区分 Service；托管模式分配额外端口并交换入口 grant | 复用转发能力，托管入口改为路径选择与普通浏览器会话 |

Core 已有 `/api/v1/login`、`/api/v1/me`、`/api/v1/logout`、`/api/v1/admin/*`、`/control/status`、`/control/admin/bootstrap`、Service resolve/gateway 和文件/包/事件接口。真正的缺口是网页首管理员的受限调用身份、持久用户集合是否为空的投影，以及替代进程内 WatchSession 的客户端观察；不需要平行建设用户或 Service API。

现行 BSA-003/BSA-004/BSA-IP-001、DWUI-HOSTED-001、NATIVE-003 和 Docker 网络条款仍承诺独立来源/端口与根路径透明访问。本变更显式替换这些托管模式契约，独立 CLI proxy 和本机 Desktop 仍有各自用途，不能按“旧代码”整体删除。

## Goals / Non-Goals

**Goals**

- 在同一个进程中以真实 HTTP 边界运行 ControlPlane 和 Core；Core 仍是用户/权限、Work、Docker、文件、包、快照和 Service 的唯一权威。
- 浏览器所有 Piwork 工作流使用 `17891`；CLI/operator 与 ControlPlane 后端使用 `17871`。
- 无域名、无客户端代理的 IP 访问下，多个托管 Service 共用 `17891`，官方应用实际支持其动态前缀。
- 一键启动、首次创建管理员、Admin Quick setup、固定 Agent 镜像、正常登录和退出恢复继续成立。

**Non-Goals**

- 不引入 `core.sock`、生产环境进程内 HTTP transport、第二默认进程、Windows Core 或新的 Service 编排协议。
- 不建设通用 `/api/v1/*` 浏览器直通入口，不把 CLI 改造成 ControlPlane 客户端。
- 不透明修复任意第三方根路径应用，不重写用户源码、旧镜像或 `.work` 包，不恢复旧托管端口池。
- 不自动发布制品或修改外部官网仓库；本轮提供可验证的当前材料及官网生成产物。

## Decisions

### 1. 一个启动入口，两个 HTTP 服务

```text
Browser --> ControlPlane :17891 ----+
                                   |
                                   | HTTP
CLI / operator --------------------+--> Core :17871 --> Work resources
                                        ^
Agent -- mTLS WorkServices :7172 --------+

ControlPlane + Core = one Linux process / one binary / one startup command
```

默认 `--listen 0.0.0.0:17891` 表示浏览器 listener；新增 `--core-listen 127.0.0.1:17871` 明确 Core listener。Core 默认地址按同机一键部署采用 loopback；远程 CLI 可显式使用 `--core-listen 0.0.0.0:17871` 或指定网卡，并按其实际网络放行。这样默认浏览器仅需一个可达端口，同时保留原生客户端直接调用 Core 的能力。CLI 默认 Core origin、operator 和独立 Console 默认上游统一到 `http://127.0.0.1:17871`。

`--public-origin`、既有 `--tls-cert/--tls-key` 描述 ControlPlane 的浏览器 origin/TLS，不改变 Core URL。ControlPlane 使用启动器确认的实际 Core 监听地址；通配地址转换为同机可连接地址，不请求 `0.0.0.0`，不使用浏览器 `Host` 推导上游，也不跟随任意重定向携带凭据。远程 CLI 的 HTTP(S)、自定义 CA 和显式地址继续遵守原客户端契约；高级 Core HTTPS 可由受信终止入口提供。

启动先校验并取得所需 listener/数据所有权，再开放服务与启动恢复。任一必需 listener 绑定失败必须关闭已取得资源，不换端口、不留下半个实例或误报成功。缺管理员、模型、Docker 或镜像属于 readiness 问题，不能阻止首次配置网页。

统一进程监听两个 server 的异常退出。正常终止或必需 listener 意外结束都进入同一有界关闭流程；先撤 readiness、停止新业务准入和浏览器内容流，再让 Core 完成其受管 Work 停止与持久收尾。保留总 45 秒、Compose 60 秒窗口，不因增加第二个 server 叠加两份无限等待。浏览器关闭、CLI 退出仍不停止 Work。

替代方案：继续包装 Core handler 或注入 `net.Pipe` 无法验证网络边界；拆两个默认进程不符合单进程一键启动，因此均不采用。

### 2. 调用边界和 HTTP 契约

`internal/app` 是唯一组合根，可以创建两端并传递地址和生命周期信号。ControlPlane 业务代码不导入 Core/store/identity 实现；允许共享公开 DTO、客户端、协议错误及不含业务权威的工具。Core 不依赖网页会话和浏览器包。

| ControlPlane 原直接调用 | 替代方式 |
| --- | --- |
| 身份验证 | 已有 `GET /api/v1/me`；每个受保护操作由 Core 再次授权 |
| 登录、注销 | 已有 login/logout API；Core bearer 仅存在后端 |
| Core 状态、准备进度 | 已有 `GET /control/status`，扩展最小 `hasUsers` 字段；不以“启用管理员数量”判断是否能首次创建 |
| Runtime、发行默认 | 已有 `/api/v1/admin/runtime`、`/api/v1/admin/runtime-defaults` |
| 首管理员创建 | 复用 `POST /control/admin/bootstrap`，增加下面的单用途初始化委托 |
| WatchSession | 以已有 `/me` 做有界、去重的后台复核；内容流自身仍由 Core 实施撤销 |
| Work、文件、包、Service、事件 | 复用已有客户端/API；生产 transport 为真实 HTTP |

不新增 Core 路由。为避免网页后端取得完整 operator 管理权限，启动器生成只存在内存的随机初始化委托，分别注入 Core 的校验端和 ControlPlane 的初始化客户端。该身份只允许现有 `POST /control/admin/bootstrap`，且仅在持久用户集合为空时有效；其他 `/control/*` 仍只接受 operator credential。普通用户/admin bearer 不取得该权限，委托不能登录、读取 Work、配置模型或访问任意管理接口。首次成功后不可再创建，重启后旧委托失效；env/operator/网页共用原子事务。

这只是替换原进程内 Bootstrap 调用，不增加用户操作：网页仍自动取得普通 Cookie/CSRF，上报账号与单个密码，不显示或索取内部委托，不出现 Access/设置链接。密码确认继续只在表单完成。创建响应未知时读取状态，不自动重发。

普通后台复核按会话去重，活跃流的撤销观察与请求超时合计不超过既有两秒目标。明确失效时撤销该浏览器内容能力；Core 暂时不可达时停止不能确认权限的内容传输，保留尚未到期的普通会话并显示连接失败，不把网络错误说成密码错误，也不自动重试写入。

`17891` 只注册网页适配器及允许的路由，不透传全部 `/api/v1/*` 或 `/control/*`。`17871` 不提供 UI/静态文件，不接受浏览器 Cookie 代替 Core 凭据、不开放浏览器跨源 CORS。浏览器不直连是产品链路要求；Core 仍是原生客户端可调用的独立服务。

### 3. 托管 Service 的路径寻址

规范入口：

```text
http://SERVER_IP:17891/services/<workId>/<serviceId>/<containerPort>/
```

`workId`、`serviceId` 是 Core 返回的稳定 ID，端口是已声明应用容器端口，三者均不是显示名称或宿主端口。尾斜杠是应用根。浏览器 `entryUrl`/`basePath` 必须保留整个前缀，不再从 `origin + "/"` 重建 URL。

```text
Browser:
  /services/W/S/8080/api/items?limit=5
ControlPlane:
  validate browser session + W/S/port
  resolve logical Service hostname through Core
Core HTTP:
  /api/v1/service-gateway/notes.w-xxxx.work/8080/api/items?limit=5
Container:
  /api/items?limit=5
```

代理复用 `user_desktop_service_proxy.go` 的协议转发、错误分类、凭据过滤、Cookie 分区和活动连接管理。Core gateway 保留原路径、所有者鉴权、Work/Service/端口/当前代次核验与 Docker 私网解析。ControlPlane 不保存容器 IP 作为权威、不直连 Docker、不新开 Service listener。

在代理选择层单次解析和校验 ID/端口；拒绝重复解码、编码分隔符、点段越界和无效目标。仅剥离被验证的前缀一次，保留剩余路径编码、query、method/body。Service 子路径即使叫 `/api/v1/...`、`/_desktop/...` 或 `/works/.../files/`，也只能作为该 Service 的上游路径，不能回落平台路由。未带 Service 前缀的根路径不根据 Referer、Cookie 或最近打开的应用猜测目标。

代理覆盖浏览器传入的转发前缀/主机相关头，向上游提供规范 `X-Forwarded-Prefix`（不带末尾 `/`）。Core 在 gateway 已授权目标上保留经校验的前缀元数据，不把它当作授权凭据或可选目标。平台 token/初始化委托、浏览器平台 Cookie、保留头不进入容器。

根相对 Location 或当前 Service 逻辑 origin 的 Location 映射回同一前缀；相对跳转按其浏览器解析结果检查，越出该前缀的同 Service 跳转不能落入平台路径。query/fragment 保留，已规范化链接不重复加前缀；外部地址不变成任意代理、跨 Service 跳转不自动授权。HTTP、SSE 和 WebSocket 共用相同目标，不能把升级连接转到 Core 或容器公网地址。

iframe、独立应用页、复制链接、刷新与登录返回都使用该入口。复制链接不含凭据，未登录先普通登录再只读重验目标；停止/删除/撤权返回可恢复不可用页，不自动 Start。相同目标的布局变化继续保持原 iframe。

### 4. 同源信任与保留的 Cookie 能力

托管 Service 是当前用户信任的应用。与工作台同源意味着脚本可能访问平台 DOM、同源存储并以当前用户身份调用 UI API；Origin/CSRF 仍防其他来源，但不被描述成阻止同源 Service 的隔离机制。

保留既有上游响应 Cookie jar，按浏览器会话、Work、Service 和声明端口分区。平台 Cookie 只在 ControlPlane 认证，浏览器发送的应用 Cookie 不混入上游；应用响应 Set-Cookie 不直接写入平台 origin，避免覆盖平台会话及普通服务端 Cookie 串用。脚本 Cookie/Cookie Store 与 jar 不同步的限制继续明确，不添加 Cookie shim。应用 Authorization 与平台凭据分开传递。

官方模板的草稿、反馈记录和返回路径至少按浏览器用户会话及完整 Service 目标分名，登出/身份切换清理所属非秘密状态，避免正常多应用使用时碰撞；这不形成对恶意同源脚本的安全保证。不扩展 Service Worker scope，不剥除应用 CSP/X-Frame-Options；不能嵌入时保留独立打开。

独立 `piwork-cli desktop` 的本机 Host 路由与隔离模式保留，`piwork-cli proxy` 的 `.work`/PAC/WebDAV 契约保留。它们是独立客户端入口，不是托管模式的兼容回退；统一 ControlPlane 不再生成这些本机地址。

### 5. 官方应用的前缀契约

核心 Gateway 的 URL 前缀一直是服务器内部协议；新 `/services/...` 则出现在浏览器 URL，不能仅剥一次前缀就宣称所有旧网页兼容。

`deploy/images/web-base/tools/piwork_web_runtime.py` 注入的 `/piwork-assets/page-client.js`，以及 `page-client.js` 中 `/api/runtime-version`、`/ui/receipts/...`、`/ui/requests/...` 都有根路径假设。官方 base、`web-app` 及工作站模板必须共同适配请求级前缀，页面路由、资源、业务 API、下载、反馈、自动刷新及 NiceGUI Socket.IO 路径使用同一规范入口。

前缀来源于已校验代理请求，以框架 root-path/forwarded-prefix 能力与模板 URL helper 实现；不要同时重复添加两套前缀。容器内仍以 `/health`、`/pi/v1`、业务根路径服务 Agent/探针；无浏览器前缀的合法内部访问和独立 CLI 根入口仍可运行。前缀不能写死服务器 IP、Work/Service ID 或进入持久模板源码；包导入换身份后自动使用新请求前缀。

第三方应用必须配置其 base path/公开 URL 能力；没有这种能力的根路径应用不在此次透明兼容范围。代理不注入 `<base>`、不扫描改写 HTML/JS，也不猜测根 `/api` 目标。提供清楚说明，不要求实现通用自动检测。

### 6. 可移植性与兼容债务

保留 `.work` V1 framing/manifest、固定镜像、用户源码/数据和新 Work 的 ID 映射。`.piwork` 的 Core/Agent mTLS 身份与 Service `.work` 逻辑域名不因外部 URL 改动。

符合新前缀契约的应用导出、导入、显式启动后通过新目标入口使用。旧包可以格式校验和导入，但旧网页可能不支持新入口；不能谎报损坏、静默换镜像或改写用户字节来掩盖。不承诺所有旧网页自动恢复；显式应用适配独立于包安装。

删除托管端口池、`--service-ports`、端口 pin/回收、旧跨 origin grant 交换和 hosted 的假 Core origin/handler transport 分支。旧 `runtime/service-origins` 属于派生状态，不再读取；仅按所属安装私有目录规则清理，不动 Work 持久资源。旧端口/地址无兼容监听或自动改连；废弃参数返回 usage 错误和迁移方向。

保留非兼容债务：CLI proxy、独立 Desktop、operator 身份、应用 Cookie jar、Core gateway、服务逻辑域名、Service MCP 和 Agent RPC。

### 7. Docker、内部 RPC 与材料

继续 Linux host 网络、同路径数据挂载和 Engine Unix API。浏览器/Service 只需放行 `17891`；需要远程 CLI 时显式开放 `17871`。Agent WorkServices `7172` 是现有容器回连通道，不能改成浏览器入口、误并到 `17871` 或简单绑定 loopback 导致 Agent 失联。保持 mTLS 安装/Work/代次/角色校验，部署网络仅允许所需容器回连；不把“浏览器单端口”表述为整个系统只存在一个 TCP listener。

Docker liveness 检查 ControlPlane `/healthz`；其可服务初始化页面时应健康。readiness 从 Core 安全状态投影，保留基础与 `docker-delivery` profile 差别；Core 不可达时不得报 ready。高级 CLI readiness 检查直连 Core `17871`。

同步 `Dockerfile.core`、Compose 及模板、单机示例、双语部署手册、当前架构说明、帮助、官网生成源与候选清单。单机示例中的 bridge CLI 必须配置可达 Core listener/host-gateway；默认 loopback Core 不能被写成 bridge CLI 已可访问。同机另开独立 Desktop 会与默认 ControlPlane `17891` 冲突，明确用其既有 `--port`，不偷偷换端口。

未发布候选不能冒充已发布版本支持新端口。本地材料/官网预览放隔离候选输出，旧发布身份与下载不改写；发布后才切正式发行引用。

## Risks / Trade-offs

- [同源 Service 取得当前用户页面能力] → 明确可信应用边界；保留用户/管理员/Work 权限，不再宣称来源隔离。
- [旧根路径应用不能使用新入口] → 官方 base/模板完整适配；第三方说明前缀要求；保留原字节与镜像，不加兼容端口池。
- [真实 HTTP 引入断线、超时与未知结果] → 有界连接和观察、流式转发、只读核对、原幂等键恢复，禁止后台盲重放修改。
- [拆 listener 后启动恢复或关闭重复执行] → 单一组合根与单份关闭预算，端口冲突、并发信号及异常退出测试。
- [Core 默认地址变化导致旧保存地址失效] → 不自动改凭据 origin、不试探 7171；提示显式选择新地址后重新登录。
- [新 base 未发布而正式默认仍引用旧环境] → 分开记录本地候选与正式发行；端到端验收使用实际候选，不能将本地 tag 写成公网可用 digest。

## Migration Plan

1. 实现双服务边界及既有 API 的初始化投影/委托，先验证 CLI/operator 与 ControlPlane 均可通过实际 Core listener 操作。
2. 替换托管 Service 入口并适配官方 base/模板，删除旧托管路由与端口池；不迁移用户内容。
3. 同步构建与部署材料，重建两套嵌入 UI、宿主程序、需要变化的候选镜像及脑包资源。
4. 原生、Docker run、Compose 使用独立安装，按通配监听加实际 IP 验收；同时验证直连 Core 的 CLI。
5. 实际升级前正常停止旧实例，备份安装目录及相关卷，再启动新版本；旧浏览器会话失效后普通登录。回退使用匹配旧二进制/镜像和备份，不保证已经修改应用内容后的旧版本兼容；不覆盖任何已发布制品。
