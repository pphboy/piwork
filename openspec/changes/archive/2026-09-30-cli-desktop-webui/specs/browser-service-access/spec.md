# Spec Delta

## Purpose

为浏览器中的 Work Service 提供无需用户配置代理的本地访问入口，保留 Core 逻辑域名和所有者授权，明确应用导航、认证、流式连接、独立窗口与兼容边界，防止把本机链接误当作公网分享地址。

## ADDED Requirements

### Requirement: 逻辑域名与本地浏览器链接各有明确用途

**Identifier:** BSA-001

Desktop SHALL 使用 Core 返回的域名和声明端口确定 Service，不能从 Work 显示名称拼接域名。`.work` SHALL 保持 Core 的逻辑身份/解析能力，不表示浏览器、操作系统或容器自动具备该 DNS。工具栏 SHALL 区分 `Service domain` / `Copy domain` 与 `Open Service` / `Open in new tab` / `Copy local link`。

本地链接 SHALL 打开对应 Work/Service 的受保护入口，说明只用于本机、需 CLI 持续运行和有效登录，不是公网链接；复制内容不含 token、启动密钥或一次性授权票据。已有登录可直接打开；缺本地授权时提示从 CLI 启动入口进入，缺 Core 会话时登录，不能借匿名访问绕过授权。外部 `.work` 访问继续使用既有 CLI proxy。

#### Scenario: 中文 Work 名称
- **WHEN** Work 显示名称是中文，Core 返回稳定网络标识和域名
- **THEN** 工具栏显示 Core 域名与中文名称，Copy local link 可在当前本机打开，Copy domain 不被标为直达浏览器链接

#### Scenario: 链接被另一电脑或未授权浏览器打开
- **WHEN** 用户复制本地链接到另一电脑或无本地授权的浏览器
- **THEN** 产品不承诺跨电脑访问，匿名本地请求不能取得 Service 内容或复用平台登录

### Requirement: 每个浏览器入口仍经 Core 实时授权与解析

**Identifier:** BSA-002

本地入口 SHALL 仅把授权的 Service 身份及声明 HTTP 端口交给 Core service gateway；不得接受任意 URL/IP/Docker 目标，不以缓存容器地址替代 Core 解析。HTTP、SSE、WebSocket SHALL 共用当前所有者鉴权，跨 Work/用户资源不可见。Work/Service 停止、删除或会话撤销后活动连接 SHALL 遵守 Core 最多 2 秒撤销边界。

service gateway 与 WebDAV SHALL 为独立分支；任何应用路径包括 `/works/.../files/` 都不能落入平台文件/控制路由。service 的 401/403/404 保留应用语义，只有可信平台错误才触发重新登录。入口仅支持声明的 HTTP/ws 应用协议；非 Web 端口、上游 HTTPS/wss 和任意 TCP/UDP 不得伪装为可预览。

#### Scenario: 应用与平台同名路径
- **WHEN** 应用请求自身 `/api` 或 `/works/id/files/data`
- **THEN** 均到达该 Service 原路径，不调用 Desktop API 或 Core WebDAV

#### Scenario: 撤销活动连接
- **WHEN** Service 停止或用户会话被撤销，而浏览器仍保持 SSE/WebSocket
- **THEN** 活动连接在既有撤销边界内关闭，后续请求重新检查真实状态，不能凭旧映射恢复

#### Scenario: 应用登录失败
- **WHEN** Service 返回自己的 401
- **THEN** 保留应用登录界面和响应，不注销 Desktop 或停止本地监听

### Requirement: 应用视口与平台界面使用分离的浏览器源

**Identifier:** BSA-003

Desktop 外壳与各 Service/端口 SHALL 使用不同 origin，应用不能读写外壳 DOM、浏览器存储或本地平台会话。不同 Service 的正常 host-only Cookie、localStorage 和应用会话 SHALL 不串用；响应 Cookie 的 Domain SHALL 被限制到该应用本地主机，平台保留 Cookie SHALL 不转发给应用。Service 在内嵌和独立打开时 SHALL 使用同一应用 origin 以保持正常应用登录态。

本地平台接口 SHALL 校验精确 Host、来源及防跨站请求凭据，Service 即使与外壳同 site 也不得调用平台控制/文件 API。应用入口不得代理未登记主机；未知本地 Host 不得获得控制页面、凭证或通用转发。窗口 opener 和跨窗口消息 SHALL 受限，应用不得冒充 Work 切换或授权消息。

#### Scenario: 应用不能访问平台内容
- **WHEN** Service 脚本尝试读取父窗口、请求平台文件 API、注册覆盖外壳的 Service Worker 或伪造授权消息
- **THEN** 请求/访问被浏览器隔离或入口校验拒绝，平台 token 和其他 Work 内容不返回

#### Scenario: 两个应用使用相同 Cookie 名
- **WHEN** 两个 Service 都设置 `session` Cookie 及同名 localStorage 键
- **THEN** 各自正常会话保持独立；切到独立窗口后仍使用对应 Service 的会话

### Requirement: 转发保留应用路径与可支持的浏览器会话

**Identifier:** BSA-004

浏览器入口 SHALL 保留原始路径、查询、请求方法/体、应用 Authorization、响应码和流式时序，支持根绝对路径资源、相对导航、HTTP 跳转、SSE 和 WebSocket。仅对已授权映射的 origin 改写 Origin/Referer、Location 及 Cookie Domain 等代理必要元数据，不能把外部 Origin 洗成可信应用来源。相对跳转保持相对；指向当前已映射 `.work` origin 的绝对跳转映射到本地；外部 URL 保留外部身份，不能变成任意代理目标或携带平台凭据。

首版 SHALL 验收桌面 Chrome/Edge 当前稳定版，普通 host-only/服务自身 Domain 响应 Cookie、应用 Basic/Bearer、内嵌到独立打开的登录态及常见路径路由。任意响应正文中的硬编码 `.work` URL、跨站 SSO 回调配置、要求上游 HTTPS 的应用、主动通过脚本共享父域 Cookie 的应用不在透明兼容保证内；界面/文档 SHALL 指明具体限制，不能静默改写脚本、削弱应用 CSP/安全头或宣称所有网站兼容。

应用 origin 的 `/.well-known/piwork-local/` SHALL 保留给本地授权引导，不转发到应用；所有其他路径按应用处理。跳转到另一 `.work` Service SHALL 不自动授予目标访问，提供从所属 Work Service 选择器打开的方向；跨 Service 直跳不列为透明兼容保证。

#### Scenario: 根路径应用与流式协议
- **WHEN** 应用从 `/` 加载 `/assets/app.js`、调用 `/api`、接收 SSE 并建立 WebSocket
- **THEN** 路径和请求体到达同一 Service，事件增量可见、连接可交互，没有子路径前缀破坏路由

#### Scenario: 应用登录和重定向
- **WHEN** 应用使用响应 Cookie 登录并跳转到自身逻辑域名的路径，随后用户独立打开
- **THEN** 跳转仍到已授权的本地同一应用，原登录有效，平台 Cookie 不到达上游

#### Scenario: 外部来源和不支持的应用配置
- **WHEN** 外部网站伪造 Origin，或应用依赖硬编码外部回调/脚本域名
- **THEN** 外部来源不被伪装成该 Service；不支持配置提供可解释限制，不以关闭浏览器安全检查作为解决办法

### Requirement: 独立打开与不可嵌入回退保持真实边界

**Identifier:** BSA-005

`Open in new tab` SHALL 在用户动作中打开独立 Service 视图，正常模式保留 Work 身份、状态及 Back to Work，关闭不停止 Service 或 Run。嵌入被 CSP/X-Frame-Options 拒绝时 SHALL 保留这些响应策略，展示原因与直接新标签页打开应用的回退，不把空白 iframe 当成功。无法可靠判定加载结果时显示预览未确认和可操作回退，不伪称协议故障。

正常独立视图在资格丢失时 SHALL 显示对象/原因/返回；禁止嵌入的直接应用标签页保持应用自己的 UI，本地入口在下一次导航请求被拒绝时返回带 Work 身份与 Back to Work 的不可用页，活动连接仍按 BSA-002 撤销。不通过向任意应用注入脚本/导航栏承诺实时覆盖其已经渲染的画面。无默认入口时提供声明端口选择或明确无法预览，不猜测非 Web 服务成功。

#### Scenario: 应用禁止嵌入
- **WHEN** 响应有禁止嵌入策略
- **THEN** 外壳说明无法嵌入并提供可用的直接打开，策略未被移除，原 Work 对话保留

#### Scenario: 独立窗口内 Work 停止
- **WHEN** 正常独立视图对应 Work 停止，或直接应用标签页在停止后重新导航
- **THEN** 分别立即更新外壳状态或返回不可用页，显示具体 Work 和返回入口，关闭窗口不发 Stop

### Requirement: 本地入口故障可恢复且不会扩大兼容承诺

**Identifier:** BSA-006

CLI 重启后的旧临时授权 SHALL 失效；从 Work 链接重新打开时重新解析授权并取得当前入口。端口变化导致旧本地地址失效时 SHALL 提示使用当前启动地址；不修改系统网络设置来保活旧地址。上游不可达、Work 停止、应用拒绝登录、浏览器拦截嵌入、本地入口失效 SHALL 分别呈现。文件后端不支持不影响 Service 入口，浏览器入口关闭不改变 Work 生命周期。

#### Scenario: 重新启动 CLI
- **WHEN** 同一账号重启 CLI 后打开原 Work/Service 链接
- **THEN** 使用新本地授权并重新取得 Core 映射，不能继续使用过期应用访问许可或缓存容器 IP

#### Scenario: 文件能力缺失
- **WHEN** Core service gateway 可用但文件能力不支持
- **THEN** Service 浏览器访问仍可用，Files 单独显示能力缺失
