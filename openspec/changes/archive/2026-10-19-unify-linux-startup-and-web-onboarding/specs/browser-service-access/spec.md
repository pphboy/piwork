## MODIFIED Requirements

### Requirement: 逻辑域名与本地浏览器链接各有明确用途

**Identifier:** BSA-001

浏览器入口 SHALL 使用 Core 返回的稳定 Service 身份及声明端口确定目标，不能从显示名称拼接域名。原 .work 域名继续是 Core 逻辑身份，不代表浏览器自动具备 DNS；逻辑域名和可打开的访问链接 SHALL 明确区分。

统一服务端工作台 SHALL 生成当前服务器 IP 可访问的受保护 Service 链接，支持本机及另一台电脑，不要求客户端 CLI、本机代理、PAC/hosts、公共 IP 转域名服务或通配 DNS。独立 piwork-cli desktop 保留仅本机的 Copy local link 契约，不将其链接误称远程分享地址。两种链接都不得包含持久 token、启动秘密或一次性授权证明；链接本身不授予访问权限。

#### Scenario: 中文 Work 名称
- **WHEN** Work/Service 名称是中文或更改显示名称
- **THEN** 使用 Core 确认的稳定身份和声明端口，逻辑域名与可访问链接分别展示，不从名称推断目标

#### Scenario: 从另一电脑打开服务器入口
- **WHEN** 已登录用户通过服务器 IP 工作台打开或复制 Service 链接
- **THEN** 链接可在具备对应浏览器授权的远程环境使用，不指向客户端 localhost 或要求 DNS；无会话不能只凭复制链接访问内容

#### Scenario: 链接被另一电脑或未授权浏览器打开
- **WHEN** 用户在独立 CLI Desktop 复制本地链接到另一电脑
- **THEN** 仍按原本机范围说明，不误用统一服务器的远程承诺，也不扩大匿名权限

### Requirement: 每个浏览器入口仍经 Core 实时授权与解析

**Identifier:** BSA-002

浏览器入口 SHALL 仅把授权的 Service 身份及声明 HTTP 端口交给 Core service gateway；不得接受任意 URL/IP/Docker 目标，不以缓存容器地址替代 Core 解析。HTTP、SSE、WebSocket SHALL 共用当前所有者鉴权，跨 Work/用户资源不可见。Work/Service 停止、删除或会话撤销后活动连接 SHALL 遵守 Core 最多 2 秒撤销边界。

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

平台外壳、不同 Service/声明端口的应用 SHALL 使用不同 origin，隔离 DOM、localStorage、浏览器允许注册的 Service Worker 和应用访问授权；默认 HTTP IP 不承诺 Service Worker 可用。上游响应 Cookie 及其服务端会话 MUST 按浏览器会话及 Service 分区，不因服务器 IP 相同而跨应用或跨账号串用。仅 origin 端口不同不得被当作 Cookie 已隔离的证明。平台凭据、setup 证明与其他入口 grant SHALL 不转发给应用。

IP 模式 SHALL 使用独立端口的服务器受控入口，将上游 Set-Cookie 保存在服务端分区中，并仅用该分区构造上游 Cookie；浏览器传来的应用 Cookie 不得被混入或用于选择其他分区。响应 Cookie 的 Domain/Path/Secure/删除/过期和同名应用会话 SHALL 按有效转发契约处理，不将上游响应 Cookie 原样暴露到同 IP 浏览器空间。独立 CLI 本机模式继续使用独立主机来源；不得要求用户关闭浏览器安全设置、安装插件或配置 DNS。

首版 IP 模式 SHALL 明确说明：document.cookie/Cookie Store 与服务端 Cookie 分区不做同步；脚本自行写入浏览器 Cookie 仍可能被同 IP 其他 Service 读取、覆盖或删除，该部分不保证跨 Service 隔离，也不作为上游 Cookie 采用。此已确认限制不阻塞统一启动，不得扩大为平台凭据、Core 所有者权限或服务端响应 Cookie 分区的豁免，也不得宣称任意应用 Cookie 均已隔离。

平台接口 SHALL 校验精确 Host、Origin 和 CSRF，应用即使同 site 也不能调用平台控制/文件接口。入口只代理已登记且经 Core 授权的 Service/端口，未知 Host/端口不得得到平台页面、凭据或通用代理。内嵌和独立窗口 SHALL 使用同一应用入口与会话，opener/消息不能冒充平台授权。

#### Scenario: 应用不能访问平台内容
- **WHEN** Service 脚本访问父窗口、平台文件 API、注册覆盖平台的 Service Worker 或伪造授权消息
- **THEN** 由浏览器隔离及来源/CSRF 拒绝，不返回平台凭据或其他 Work 内容

#### Scenario: 两个应用使用相同 Cookie 名
- **WHEN** 两个 Service 使用相同响应 session Cookie 名称与 localStorage 键，并分别登录、修改、删除或过期
- **THEN** 服务端 Cookie 分区和 localStorage 各自独立，上游请求不携带另一分区 Cookie，脚本不能读取由服务端保管的响应 Cookie；切换独立窗口保留本应用登录

#### Scenario: 脚本自行写入 Cookie 的已知限制
- **WHEN** Service 脚本通过 document.cookie 写入浏览器 Cookie
- **THEN** 同 IP 不同端口不承诺隔离该 Cookie，代理不将其混入上游分区；Service 说明明确其可能跨应用串用，平台鉴权仍必须生效

#### Scenario: 不同浏览器账号访问同一逻辑服务
- **WHEN** 两个独立用户/浏览器会话请求相同形式的入口或重放他人的授权
- **THEN** 以真实所有者和会话校验，内容、Cookie 分区、临时资源与 grant 不串用

### Requirement: 转发保留应用路径与可支持的浏览器会话

**Identifier:** BSA-004

浏览器入口 SHALL 保留原始路径、查询、请求方法/体、应用 Authorization、响应码和流式时序，支持根绝对路径资源、相对导航、HTTP 跳转、SSE 和 WebSocket。仅对已授权映射的 origin 改写 Origin/Referer、Location 及 Cookie Domain 等代理必要元数据，不能把外部 Origin 洗成可信应用来源。相对跳转保持相对；指向当前已映射 `.work` origin 的绝对跳转映射到浏览器；外部 URL 保留外部身份，不能变成任意代理目标或携带平台凭据。

首版 SHALL 验收桌面 Chrome/Edge 当前稳定版，普通 host-only/服务自身 Domain 响应 Cookie 的服务端登录流程、应用 Basic/Bearer、内嵌到独立打开的登录态及常见路径路由。依赖 document.cookie/Cookie Store 读写 Cookie 的应用，包括脚本读取 CSRF Cookie 再提交请求头的流程，不在 IP 模式首版透明兼容保证内；脚本写入 Cookie 的隔离边界遵守 BSA-003。任意响应正文中的硬编码 `.work` URL、跨站 SSO 回调配置、要求上游 HTTPS 的应用、主动通过脚本共享父域 Cookie 的应用仍不在透明兼容保证内。界面 Service 说明与部署材料 SHALL 指明这些限制，不要求自动识别每个应用，不注入 Cookie shim、静默改写脚本、削弱应用 CSP/安全头或宣称所有网站兼容。

应用 origin 的 `/.well-known/piwork-local/` SHALL 保留给入口授权引导，不转发到应用；所有其他路径按应用处理。跳转到另一 `.work` Service SHALL 不自动授予目标访问，提供从所属 Work Service 选择器打开的方向；跨 Service 直跳不列为透明兼容保证。

#### Scenario: 根路径应用与流式协议
- **WHEN** 应用从 `/` 加载 `/assets/app.js`、调用 `/api`、接收 SSE 并建立 WebSocket
- **THEN** 路径和请求体到达同一 Service，事件增量可见、连接可交互，没有子路径前缀破坏路由

#### Scenario: 应用登录和重定向
- **WHEN** 应用使用响应 Cookie 登录并跳转到自身逻辑域名的路径，随后用户独立打开
- **THEN** 跳转仍到已授权的同一授权应用，原登录有效，平台 Cookie 不到达上游

#### Scenario: 外部来源和不支持的应用配置
- **WHEN** 外部网站伪造 Origin，或应用依赖硬编码外部回调/脚本域名
- **THEN** 外部来源不被伪装成该 Service；不支持配置提供可解释限制，不以关闭浏览器安全检查作为解决办法

#### Scenario: 应用读取脚本 Cookie 完成 CSRF
- **WHEN** 应用服务端设置 CSRF Cookie，页面脚本通过 document.cookie 读取后提交请求头
- **THEN** 不承诺服务端分区 Cookie 对脚本可见或该提交成功，Service 说明列明此兼容限制；应用 403 保留应用语义，不注销 Piwork、不注入脚本补偿，也不阻塞统一启动

### Requirement: 独立打开与不可嵌入回退保持真实边界

**Identifier:** BSA-005

`Open in new tab` SHALL 在用户动作中打开独立 Service 视图，正常模式保留 Work 身份、状态及 Back to Work，关闭不停止 Service 或 Run。嵌入被 CSP/X-Frame-Options 拒绝时 SHALL 保留这些响应策略，展示原因与直接新标签页打开应用的回退，不把空白 iframe 当成功。无法可靠判定加载结果时显示预览未确认和可操作回退，不伪称协议故障。

正常独立视图在资格丢失时 SHALL 显示对象/原因/返回；禁止嵌入的直接应用标签页保持应用自己的 UI，浏览器入口在下一次导航请求被拒绝时返回带 Work 身份与 Back to Work 的不可用页，活动连接仍按 BSA-002 撤销。不通过向任意应用注入脚本/导航栏承诺实时覆盖其已经渲染的画面。无默认入口时提供声明端口选择或明确无法预览，不猜测非 Web 服务成功。

Service 入口准备 SHALL 立即显示当前 Service/端口与准备状态；准备失败显示安全原因和显式重试，不能永久保持 Opening application。iframe 已创建但嵌入检查在有界等待后仍 unknown，SHALL 显示 Preview not confirmed 和重新检查/独立打开入口；不以 iframe load 事件单独宣称应用已正常加载。反馈更新 SHALL 保持同 Work/Service/port 的 iframe 和页面输入，不为显示加载而重建已就绪应用。

独立标签页和独立窗口 SHALL 保留用户手势打开机会；浏览器拦截时原 Work 显示允许弹窗或复制受保护受保护链接的下一步，不关闭原菜单并静默结束。需要异步授权时显示准备目标，失败后原页面仍可重试，不能留下无说明的空白窗口。新窗口 SHALL 不保留可访问原 Desktop 的 opener，不以关闭 CSP、代理/PAC 配置或暴露 ticket 绕过失败。

#### Scenario: 应用禁止嵌入
- **WHEN** 响应有禁止嵌入策略
- **THEN** 外壳说明无法嵌入并提供可用的直接打开，策略未被移除，原 Work 对话保留

#### Scenario: 独立窗口内 Work 停止
- **WHEN** 正常独立视图对应 Work 停止，或直接应用标签页在停止后重新导航
- **THEN** 分别立即更新外壳状态或返回不可用页，显示具体 Work 和返回入口，关闭窗口不发 Stop

#### Scenario: 入口准备失败与重试
- **WHEN** 入口准备请求失败或慢响应
- **THEN** 分别显示可解释失败及显式 Retry，或原 Service/端口的准备中；晚返回不替换另一 Service，重试仍走真实授权入口

#### Scenario: 嵌入检查未确认
- **WHEN** iframe 已创建但有界检查后 embed 仍 unknown
- **THEN** 显示 Preview not confirmed、Check preview 与独立打开，保留现有 iframe，不将 unknown 写成 blocked、Ready 或登录失败

#### Scenario: 浏览器拦截独立打开
- **WHEN** 用户点击新标签页或独立窗口，而浏览器未创建窗口
- **THEN** 原 Work 显示允许弹窗和 Copy access link 回退，复制链接不含凭据或 ticket；未发 Service 控制/停止请求

#### Scenario: 异步授权失败
- **WHEN** 用户手势已打开准备窗口，后续入口授权失败
- **THEN** 准备窗口显示安全失败说明或被关闭，原 Work 保留明确失败和重试入口，opener 不可访问 Desktop

### Requirement: 本地入口故障可恢复且不会扩大兼容承诺

**Identifier:** BSA-006

浏览器入口的临时授权 SHALL 在对应入口进程重启后失效。统一服务器或本机 CLI 重新启动后，从所属 Work 重新解析并取得当前受保护入口，不复用旧 grant、缓存容器 IP 或过期身份。端口变化 SHALL 提示使用当前入口，不修改客户端系统网络设置保活旧地址。

上游不可达、Work 停止、应用认证拒绝、嵌入限制、入口授权失效和入口池容量耗尽 SHALL 分别呈现并提供实际恢复方式。Files 单独降级不能阻断可用 Service。浏览器窗口关闭不停止 Work/Service，只有统一 Core 停机执行其关闭契约。

#### Scenario: 重新启动 CLI
- **WHEN** 统一服务器或本机 CLI 重启后用户打开旧应用链接
- **THEN** 旧临时授权不能取得新对象内容，用户可从原 Work 重新授权并取得当前入口

#### Scenario: 文件能力缺失
- **WHEN** Core service gateway 可用而文件能力不支持
- **THEN** Service 仍可使用，Files 独立报告缺失

#### Scenario: 容量或网络条件不足
- **WHEN** 受控入口池耗尽或远程网络未放行实际入口
- **THEN** 显示具体缺项和恢复，不能显示应用 ready、重用他人入口或降级为公开直连容器

## ADDED Requirements

### Requirement: 仅凭服务器 IP 完成远程 Service 使用

**Identifier:** BSA-IP-001

统一服务器的默认 Service 入口 SHALL 在无域名、无公共 DNS 转换、无客户端代理的条件下，使用服务器 IP 完成已支持应用的预览、独立打开、正常应用认证、根路径资源、HTTP/SSE/WebSocket 和返回工作台。允许服务器管理有界入口端口，但默认启动材料 SHALL 一次说明其监听/防火墙/代理可达条件；这些入口不是用户 Service 的 Docker 宿主端口。

入口 SHALL 绑定安装、用户/会话、Work、Service、声明端口及授权代次，有容量、过期和安全回收边界。链接不得指向客户端 localhost； IPv6 URL SHALL 使用正确括号。首站可打开不能代替 Service 入口可达，单纯不同端口不能代替 Cookie 分区验证。HTTPS/反向代理模式须同时验证主站及实际应用入口。

IP 模式首版 SHALL 使用 BSA-003/BSA-004 定义的响应 Cookie 分区和脚本 Cookie 限制作为兼容边界。已确认的脚本 Cookie 限制不得被当作要求域名或客户端代理的理由，也不阻塞一键启动和其他工作台功能；支持范围内的鉴权、隔离及协议失败仍必须修复。

本变更的必做远程网络验收 SHALL 采用通配监听与局域网或独立客户端网络的实际非回环 IP，覆盖主站及实际 Service 入口；不要求公网环境或公网连通性实测。通配地址只用于监听，浏览器 URL 和来源校验仍绑定实际地址，不允许任意 Host/Origin。

#### Scenario: 无域名的远程完整使用
- **WHEN** 用户从另一电脑只通过 Linux 服务器 IP 登录默认交付
- **THEN** 在无需安装 CLI 或配置 DNS/hosts/PAC 的情况下访问多个受支持 Service 的独立视口、响应 Cookie 或 Basic/Bearer 认证、SSE/WebSocket 和根绝对路径资源，脚本 Cookie 限制明确可见

#### Scenario: 授权撤销及入口回收
- **WHEN** 用户注销、身份被禁用或对应 Work/Service 停止后入口被回收
- **THEN** 所属流沿既有两秒目标断开，旧链接/grant 不能访问后来复用该端口的其他对象

#### Scenario: Cookie 与浏览器兼容验证
- **WHEN** 验证同 IP 下 Cookie、document.cookie、CSRF、WebSocket 握手、内嵌和独立打开行为
- **THEN** 真实浏览器证据必须证明支持范围内的响应 Cookie 分区、认证、路径及流式功能，并记录脚本 Cookie/CSRF 的已知限制复现；历史失败不改写为通过，支持范围内未满足项继续阻止交付，不以首页成功、公共 DNS 或弱化平台安全策略代替
