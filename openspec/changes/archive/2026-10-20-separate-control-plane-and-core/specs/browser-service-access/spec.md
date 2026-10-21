# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: 应用视口与平台界面使用分离的浏览器源`
- TO: `### Requirement: 按入口模式明确应用来源与信任边界`

## MODIFIED Requirements

### Requirement: 逻辑域名与本地浏览器链接各有明确用途

**Identifier:** BSA-001

浏览器入口 SHALL 使用 Core 返回的稳定 Service 身份及声明端口确定目标，不能从显示名称拼接域名。原 .work 域名继续是 Core 逻辑身份，不代表浏览器自动具备 DNS；逻辑域名和可打开的访问链接 SHALL 明确区分。

统一服务端工作台 SHALL 生成当前服务器 IP 可访问的受保护 Service 链接，支持本机及另一台电脑，不要求客户端 CLI、本机代理、PAC/hosts、公共 IP 转域名服务或通配 DNS。独立 piwork-cli desktop 保留仅本机的 Copy local link 契约，不将其链接误称远程分享地址。两种链接都不得包含持久 token、启动秘密或一次性授权证明；链接本身不授予访问权限。

托管浏览器的规范入口 SHALL 为当前 ControlPlane origin 下的 `/services/<workId>/<serviceId>/<port>/`，默认 `http://SERVER_IP:17891`。三个路径段分别使用 Core 确认的 Work ID、Service ID 和已声明容器端口；不能接受任意 URL、Host 或容器地址。Service 数量不增加外部监听端口，入口不依赖别名域名。复制、预览、独立打开和登录返回 SHALL 保留完整前缀，链接本身不授予访问权限。独立 CLI Desktop 的本机 Host 入口与 CLI proxy 的逻辑域名访问继续各按原契约使用，不作为托管回退。

#### Scenario: 中文 Work 名称
- **WHEN** Work/Service 名称是中文或更改显示名称
- **THEN** 使用 Core 确认的稳定身份和声明端口，逻辑域名与可访问链接分别展示，不从名称推断目标

#### Scenario: 从另一电脑打开服务器入口
- **WHEN** 已登录用户通过服务器 IP 工作台打开或复制 Service 链接
- **THEN** 链接可在完成普通账号登录且当前用户获准的远程浏览器使用，不指向客户端 localhost 或要求 DNS；无会话不能只凭复制链接访问内容

#### Scenario: 链接被另一电脑或未授权浏览器打开
- **WHEN** 用户在独立 CLI Desktop 复制本地链接到另一电脑
- **THEN** 仍按原本机范围说明，不误用统一服务器的远程承诺，也不扩大匿名权限

#### Scenario: 同端口的多个目标
- **WHEN** 同一用户打开两个 Work 的多个 Service 或同一 Service 的不同声明端口
- **THEN** 所有托管链接使用相同 ControlPlane origin，以不同的规范路径确定目标，不分配额外宿主端口、不请求客户端 localhost

### Requirement: 每个浏览器入口仍经 Core 实时授权与解析

**Identifier:** BSA-002

浏览器入口 SHALL 仅把授权的 Service 身份及声明 HTTP 端口交给 Core service gateway；不得接受任意 URL/IP/Docker 目标，不以缓存容器地址替代 Core 解析。HTTP、SSE、WebSocket SHALL 共用当前所有者鉴权，跨 Work/用户资源不可见。Work/Service 停止、删除或会话撤销后活动连接 SHALL 遵守 Core 最多 2 秒撤销边界。

service gateway 与 WebDAV SHALL 为独立分支；已选定 Service 前缀内的任何应用路径包括 `/works/.../files/` 都不能落入平台文件/控制路由。service 的 401/403/404 保留应用语义，只有可信平台错误才触发重新登录。入口仅支持声明的 HTTP/ws 应用协议；非 Web 端口、上游 HTTPS/wss 和任意 TCP/UDP 不得伪装为可预览。

托管入口 SHALL 由 ControlPlane 后端通过 Core 17871 的既有 service-access/resolve 与 service-gateway API 转发。浏览器只连接 17891，Core 仍是目标及权限的最终权威，ControlPlane 不直连缓存 Docker IP。前缀解析 SHALL 单次校验路径段，拒绝编码分隔符、歧义端口、重复解码和跨前缀点段逃逸；未知或未授权目标返回稳定拒绝，不执行平台路由回退。

#### Scenario: 应用与平台同名路径
- **WHEN** 应用通过其 Service 前缀请求自身 `/api` 或 `/works/id/files/data`，或独立 CLI 使用自己的根入口
- **THEN** 均到达该 Service 原路径，不调用 Desktop API 或 Core WebDAV

#### Scenario: 撤销活动连接
- **WHEN** Service 停止或用户会话被撤销，而浏览器仍保持 SSE/WebSocket
- **THEN** 活动连接在既有撤销边界内关闭，后续请求重新检查真实状态，不能凭旧映射恢复

#### Scenario: 应用登录失败
- **WHEN** Service 返回自己的 401
- **THEN** 保留应用登录界面和响应，不注销 Desktop 或停止本地监听

#### Scenario: 原生网关与浏览器入口分工
- **WHEN** 浏览器请求合法 Service 路径，而原生 CLI 通过既有代理访问同一逻辑域名
- **THEN** 两者均经 Core 的同一 gateway 规则和当前容器解析，浏览器不直接请求 Core，不新增平行 Service API

#### Scenario: 伪造目标和路由逃逸
- **WHEN** 路径携带未声明端口、他人 Service、编码 slash 或试图越出前缀
- **THEN** 拒绝或安全规范化为同一已授权目标，不触达他人容器或平台控制接口，不根据 Referer/Cookie 猜测其他目标

### Requirement: 按入口模式明确应用来源与信任边界

**Identifier:** BSA-003

统一 ControlPlane 的托管 Service SHALL 与工作台共享浏览器 origin，视为当前用户信任的应用。产品 SHALL 明确同源 Service 脚本可能访问平台 DOM、同源存储并调用当前用户可用的 UI 接口；不得声称不同路径构成 DOM、localStorage、Service Worker 或当前用户权限隔离。独立 CLI Desktop 的本机 Service 来源分离契约继续保留，不将其安全承诺套用到托管模式。

两种模式 SHALL 继续执行真实用户/会话、Work 所有者、Service/端口及代次检查，不能因同源授予其他账号或 operator 权限。平台 bearer、operator credential、初始化委托和平台 Cookie SHALL 不转发到应用。托管上游响应 Cookie SHALL 保留按浏览器会话、Work、Service、端口的服务端分区，Domain/Path/Secure/删除/过期按原有效上游契约处理；浏览器传入的应用 Cookie 不混入该分区，上游 Set-Cookie 不直接写入平台 origin。

document.cookie/Cookie Store 与服务端分区 SHALL 不做同步；脚本 Cookie 不保证不同 Service 之间隔离，也不作为上游分区 Cookie 来源。该限制不能扩大为不执行用户所有权或泄漏平台凭据的豁免。官方应用的正常草稿等状态 SHALL 使用身份及 Service 目标命名空间避免碰撞，但不得宣称能抵御受信同源应用脚本。

平台接口 SHALL 保持精确 Host、Origin 和 CSRF，阻止其他来源的伪造请求；不得把这些校验当作阻止受信同源 Service 调用平台的能力。独立窗口不保留可直接操作原窗口的 opener，应用 CSP/X-Frame-Options 与 Service Worker scope 不被代理放宽。未知目标不获得通用代理、其他用户内容或新的浏览器授权。

#### Scenario: 托管 Service 的同源能力明确
- **WHEN** 已登录用户在托管 Service 中运行同源脚本
- **THEN** 按可信应用模型说明其可能访问当前用户 UI 能力，验收不把同源 DOM/API 可达误记为独立来源隔离通过；跨用户请求仍由 Core 拒绝

#### Scenario: 两个应用使用相同 Cookie 名
- **WHEN** 两个托管 Service 使用相同名称的响应 Cookie，分别登录、修改、删除或过期
- **THEN** 各自服务端 jar 不串用，平台 Cookie 不到达上游，独立打开同一 Service 保留该会话的应用登录

#### Scenario: 脚本自行写入 Cookie 的已知限制
- **WHEN** 应用使用 document.cookie 读写 Cookie 或读取服务端 CSRF Cookie
- **THEN** 明确不保证与上游 jar 同步或跨 Service 脚本隔离，不注入 shim、不剥除应用策略，应用拒绝仍保留其语义

#### Scenario: 不同浏览器账号访问同一逻辑服务
- **WHEN** 两个独立浏览器会话请求相同形式的链接或重放其他用户的目标路径
- **THEN** Core 按当前用户所有权处理，另一账号的内容、响应 Cookie 分区和上传资源不可取得

#### Scenario: 应用不能访问平台内容
- **WHEN** 独立 CLI Desktop 的分离来源 Service 脚本试图访问父窗口或平台内容
- **THEN** 原本机来源隔离和平台鉴权继续拒绝；该保证只适用于独立 CLI 模式，托管同源模式按可信应用边界处理

#### Scenario: 独立 CLI 的本机隔离
- **WHEN** 用户使用独立 piwork-cli desktop 的本机 Service Host 入口
- **THEN** 按原分离来源机制处理，不因为托管路径方案删除其原有来源隔离

### Requirement: 转发保留应用路径与可支持的浏览器会话

**Identifier:** BSA-004

托管浏览器入口 SHALL 在识别 `/services/<workId>/<serviceId>/<port>/` 后，向既有 Core gateway 传递去掉该前缀一次的应用路径，保留 path 编码、query、方法/体、应用 Authorization、响应码和流式时序。规范前缀 SHALL 作为经校验的代理元数据提供给应用；覆盖来访请求伪造的前缀/Forwarded 元数据，不把其作为授权或上游地址。独立 CLI 的根入口继续保留原应用路径。

托管应用 SHALL 支持动态 base path：资源、API、页面导航、下载及 WebSocket 使用完整 Service 前缀。未携带前缀的 `/api` 或 `/assets` 不根据最近访问、Cookie、Referer 或某个标签页状态猜测目标。任意硬编码根路径或 `.work` URL 的第三方应用不在透明兼容范围；不对响应 HTML/JS 注入通用重写器、Cookie shim 或关闭应用安全策略。

代理 SHALL 对可信当前应用请求处理必要的 Origin/Referer 元数据，不能把外部来源洗成可信来源。指向当前应用的根相对及逻辑 origin Location SHALL 映射为相同 Service 前缀；相对跳转保持其语义但不能逃入平台路径，已带规范前缀不得重复添加，query/fragment 保留。外部 URL 保留外部身份，不成为任意代理目标、不携带平台凭据；跨 Service 跳转不隐式取得目标权限。

首版 SHALL 以桌面 Chrome/Edge 验证受支持应用的资源、页面刷新、API、响应 Cookie 登录、Basic/Bearer、SSE、WebSocket 及嵌入到独立打开。脚本 Cookie/Cookie Store 同步、跨站 SSO 回调、上游 HTTPS/wss、任意 TCP/UDP 及主动共享 Cookie 不在托管透明兼容承诺内，说明 SHALL 同时列出路径前缀与 BSA-003 的信任/Cookie 边界。

托管路径 SHALL 直接使用普通已登录浏览器会话，不再交换跨 origin grant 或访问 `/.well-known/piwork-local/enter`；独立 CLI 本机入口可继续保留其原授权交换路径。此区别不能重新引入用户需操作的浏览器 Access 门禁。

#### Scenario: 根路径应用与流式协议
- **WHEN** 应用通过自己的完整前缀加载资源、调用 API、接收 SSE 和建立 WebSocket
- **THEN** 所有请求都到同一 Service 的原始路径，事件增量可见且双向帧可交互，不直连 17871 或容器

#### Scenario: 原始编码和相似平台路径
- **WHEN** Service 子路径包含合法编码、query 或与平台 API 同名的路径
- **THEN** 路径语义到达该应用，不重复解码、不落入平台 handler，非法逃逸安全拒绝

#### Scenario: 应用登录和重定向
- **WHEN** 应用使用响应 Cookie 登录，并返回根相对、相对、当前逻辑域名或已经带前缀的 Location
- **THEN** 跳转到同一授权 Service，前缀恰好一份且原 query/fragment 保持，独立打开保留应用服务端会话

#### Scenario: 外部来源和不支持的应用配置
- **WHEN** 不支持前缀的应用请求平台根 /api，或外部网站伪造 Origin
- **THEN** 不猜测 Service 或把外部请求洗成授权来源；平台保持自身路由鉴权，说明兼容边界，不自动重写应用脚本

#### Scenario: 应用认证失败
- **WHEN** Service 自身返回 401/403 或其脚本无法读取服务端 CSRF Cookie
- **THEN** 保留应用语义，不注销 Piwork；只有可信 Core 平台鉴权错误才触发普通登录恢复

#### Scenario: 应用读取脚本 Cookie 完成 CSRF
- **WHEN** 应用把上游响应 Cookie 当作脚本可读的 CSRF Cookie，随后提交对应请求头
- **THEN** 托管 jar 不向脚本同步该值，不承诺请求成功；说明列出限制，应用 403 不注销平台或触发脚本补偿

### Requirement: 本地入口故障可恢复且不会扩大兼容承诺

**Identifier:** BSA-006

托管入口 SHALL 使用普通浏览器登录与稳定 Service 路径。ControlPlane 重启后旧临时会话和映射不得授权内容；重新正常登录后从 Core 解析同一目标，无需终端链接或跨端口授权。旧托管端口池、其持久端口绑定和 grant 交换 SHALL 移除，不保留兼容 listener、自动回退或把旧入口复用给其他对象。独立本机 CLI 重启继续使其临时入口授权失效，用户通过所属 Work 取得当前本机入口。

上游不可达、Work/Service 停止、应用认证拒绝、嵌入限制、平台会话失效和 Core 连接限额 SHALL 分别提供实际恢复方向。Files 单独降级不阻断可用 Service。关闭浏览器不停止 Work/Service；统一进程关闭仍执行 Core 停机契约。旧托管端口链接不可用时 SHALL 指向当前工作台的使用方式，不修改系统 DNS/PAC 或重新分配旧端口保活。

#### Scenario: 重新启动 CLI
- **WHEN** ControlPlane 重启后用户打开旧路径链接并重新正常登录
- **THEN** 重新检查该目标所有权和运行代次，目标仍存在且可用时恢复，旧会话不能取得新内容，不要求 Access 授权

#### Scenario: 已删除目标及旧端口
- **WHEN** 链接指向已删除 Service，或客户端尝试旧端口池地址
- **THEN** 不映射给其他 Service，不启动兼容 listener；当前工作台可重新选择真实可用目标

#### Scenario: 文件能力缺失
- **WHEN** Files 能力缺失但 Service 可用，或 Service 上游失败但平台可达
- **THEN** 分别保留 Service 或平台恢复入口，错误不会扩大成整个安装不可用或绕过 Core 的容器直连

#### Scenario: 容量或网络条件不足
- **WHEN** Core 网关连接达到既有限额、上游或控制面网络不可达，或使用旧端口池部署材料
- **THEN** 分别显示真实限制/恢复方向，旧材料引导改用当前路径入口，不新建端口池、不直连容器、不假称 Ready

### Requirement: 仅凭服务器 IP 完成远程 Service 使用

**Identifier:** BSA-IP-001

统一服务器 SHALL 在无域名、公共 DNS 转换、客户端代理/PAC/hosts 的条件下，仅通过 ControlPlane 的服务器 IP 和默认 17891 端口完成受支持 Service 的预览、独立打开、应用认证、前缀资源、HTTP/SSE/WebSocket 及返回工作台。不同 Work/Service/声明端口 SHALL 通过规范路径区分，不分配额外 Service listener，不发布用户容器宿主端口。浏览器不需要连通 Core 17871 或内部 Agent RPC。

每次入口使用 SHALL 绑定当前用户/会话及 Core 确认的 Work、Service、声明端口和运行代次。路径不授予权限，不使用客户端 localhost；IPv6 URL 保留正确括号。HTTPS/受信反向代理模式 SHALL 在同一浏览器 origin 验证前缀、来源、证书及流式连接，不信任任意转发头。

必做远程网络验收 SHALL 使用通配监听与局域网或独立客户端网络的实际非回环 IP，不要求公网实测。该客户端网络仅放行浏览器端口时仍须完整使用；不能以首页成功或同机 localhost 代替。托管同源信任、响应 Cookie 分区、脚本 Cookie 和前缀兼容范围遵守 BSA-003/BSA-004，未通过的支持范围内行为继续阻止候选通过。

#### Scenario: 无域名的远程完整使用
- **WHEN** 远程浏览器网络仅能访问服务器 17891，17871 和原 Service 端口池不可达
- **THEN** 多个受支持 Service 的页面、应用认证、前缀资源、API、SSE/WebSocket、刷新和独立打开正常，浏览器网络记录只使用当前 ControlPlane origin

#### Scenario: 授权撤销及入口回收
- **WHEN** 用户注销、身份被禁用或 Work/Service 停止
- **THEN** 所属活动流在既有两秒目标内断开，后续路径请求按真实状态拒绝，链接不能因同源而跳过 Core 鉴权

#### Scenario: Cookie 与浏览器兼容验证
- **WHEN** 验证同源脚本能力、多个应用同名响应 Cookie、脚本 Cookie 限制和两个账号并发
- **THEN** 证据分别确认已接受的同源边界、服务端 jar 分区、已知不兼容以及账号权限；不能把同源能力写成来源隔离通过或把未测项写成成功
