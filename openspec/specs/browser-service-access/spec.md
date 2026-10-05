# Browser Service Access Specification

## Purpose

为浏览器中的 Work Service 提供无需用户配置代理的本地访问入口，保留 Core 逻辑域名和所有者授权，明确应用导航、认证、流式连接、独立窗口与兼容边界，防止把本机链接误当作公网分享地址。

## Requirements

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

Service 入口准备 SHALL 立即显示当前 Service/端口与准备状态；准备失败显示安全原因和显式重试，不能永久保持 Opening application。iframe 已创建但嵌入检查在有界等待后仍 unknown，SHALL 显示 Preview not confirmed 和重新检查/独立打开入口；不以 iframe load 事件单独宣称应用已正常加载。反馈更新 SHALL 保持同 Work/Service/port 的 iframe 和页面输入，不为显示加载而重建已就绪应用。

独立标签页和独立窗口 SHALL 保留用户手势打开机会；浏览器拦截时原 Work 显示允许弹窗或复制受保护本地链接的下一步，不关闭原菜单并静默结束。需要异步授权时显示准备目标，失败后原页面仍可重试，不能留下无说明的空白窗口。新窗口 SHALL 不保留可访问原 Desktop 的 opener，不以关闭 CSP、代理/PAC 配置或暴露 ticket 绕过失败。

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
- **THEN** 原 Work 显示允许弹窗和 Copy local link 回退，复制链接不含凭据或 ticket；未发 Service 控制/停止请求

#### Scenario: 异步授权失败
- **WHEN** 用户手势已打开准备窗口，后续入口授权失败
- **THEN** 准备窗口显示安全失败说明或被关闭，原 Work 保留明确失败和重试入口，opener 不可访问 Desktop

### Requirement: 本地入口故障可恢复且不会扩大兼容承诺

**Identifier:** BSA-006

CLI 重启后的旧临时授权 SHALL 失效；从 Work 链接重新打开时重新解析授权并取得当前入口。端口变化导致旧本地地址失效时 SHALL 提示使用当前启动地址；不修改系统网络设置来保活旧地址。上游不可达、Work 停止、应用拒绝登录、浏览器拦截嵌入、本地入口失效 SHALL 分别呈现。文件后端不支持不影响 Service 入口，浏览器入口关闭不改变 Work 生命周期。

#### Scenario: 重新启动 CLI
- **WHEN** 同一账号重启 CLI 后打开原 Work/Service 链接
- **THEN** 使用新本地授权并重新取得 Core 映射，不能继续使用过期应用访问许可或缓存容器 IP

#### Scenario: 文件能力缺失
- **WHEN** Core service gateway 可用但文件能力不支持
- **THEN** Service 浏览器访问仍可用，Files 单独显示能力缺失

### Requirement: 专注与全屏仅改变已授权 Service 的容器布局

**Identifier:** BSA-FOCUS-001

Service 专注视图 SHALL 复用当前 Work/Service/端口的既有受保护入口和应用 origin，同一 iframe 的浏览器登录态、页面路径与输入不会仅因 Focus、Focus chat、Restore layout、Hide chat、Show chat、浏览器全屏或 Exit focus而被重建。专注与常规布局共用同一 Chat Session；隐藏 Chat 不停止 Run 观察或执行。布局入口不是授权动作，不发 Start/Stop/Apply，不修改 Service 映射、访问资格或应用安全头。

专注工具栏 SHALL 保留 Service 名称、真实状态和 Exit focus，提供 Chat 显隐；仅 Service 模式保留此最小外壳。浏览器 Full screen SHALL 由用户单独请求，退出或请求失败仍保留专注视图。正常独立 Service 视图可提供仅 Service 的 Focus 与同样的返回/全屏动作；独立视图不为了 Show chat 创建或载入新 Session，需要对话时经 Back to Work 返回原 Work。直接打开禁止嵌入应用的标签页保持原应用界面，不注入专注外壳。

Focus chat 隐藏 Service 后，Exit focus SHALL 由仍可见的 Agent 头部承接，Restore layout 和直接退出不依赖已隐藏的 Service 工具栏；同一 iframe 与祖先保持连接，仅改变可见性，不重取入口或扩大访问范围。

无入口、真实失去资格、嵌入被拒绝与预览未确认 SHALL 沿 BSA-002、005、006 分别表达。缺少可嵌入入口不开放虚假专注预览；已有未确认 iframe 可保留专注布局但持续标明 Preview not confirmed。Work/Service 停止或身份撤销后连接仍按原撤销界限关闭，不用专注保留缓存网络资格；下一次页面导航按真实入口重新授权。失败或不可用时返回与独立打开回退仍可达。

本轮 SHALL 不保证跨源应用键盘事件传回外壳，也不保证应用自身重载、真实网络故障或另一个窗口的内存状态保存；持续可达的返回按钮是专注返回的可靠入口。浏览器全屏不改变上述安全和兼容约束。

#### Scenario: 切换容器保留同源应用状态
- **WHEN** 正常嵌入的应用已登录并填有未保存表单，用户切换专注、Chat 显隐和全屏后返回
- **THEN** 应用 origin、同一 iframe、登录与表单保持，未重新请求入口或重载文档，没有新增会话或生命周期请求

#### Scenario: 嵌入限制不被全屏绕过
- **WHEN** 应用明确禁止嵌入或没有声明的可用 Web 入口
- **THEN** 保留真实限制和独立打开方向，没有通过 Focus/Full screen 削弱策略、伪造成功或注入应用 UI

#### Scenario: 专注期间撤销资格
- **WHEN** 用户处于仅 Service 的专注/全屏视图且 Work 停止或会话被撤销
- **THEN** 活动连接按原界限关闭，最小外壳说明原因并保留返回，隐藏 Chat 不改变停止与授权事实

#### Scenario: 独立视图返回
- **WHEN** 用户从正常独立 Service 视图进入仅 Service 专注后返回
- **THEN** 恢复该窗口自己的 Work 身份和 Back to Work，没有自动加载对话；关闭该窗口不停止应用或 Run


#### Scenario: Service 隐藏后仍可退出
- **WHEN** 用户从 Service 专注进入 Focus chat 并恢复或直接 Exit focus
- **THEN** 出口始终可达，同一 iframe、origin、登录与表单保持，无再次入口授权、文档加载或访问范围扩大
