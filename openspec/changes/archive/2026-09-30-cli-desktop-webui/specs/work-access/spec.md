# Spec Delta

## MODIFIED Requirements

### Requirement: 隔离本地 WebDAV 认证与 service 应用认证

**Identifier:** WACC-FILES-002

现有 `piwork-cli proxy` 的外部 WebDAV 文件入口 SHALL 仅接受loopback连接、精确本地Host及当前proxy的临时Basic凭据；拒绝跨站Origin和cross-site请求，不提供CORS放行。无效本地凭据只产生本地401，不联系Core、不撤销平台登录。CLI SHALL 移除本地Basic、Cookie、Proxy认证、客户端平台保留头和逐跳头，使用保存的用户Bearer调用Core文件接口。Core token不得交给WebDAV客户端、service或文件helper。

同一外部 proxy 的 service分支 SHALL 保持原有应用Authorization/Cookie和网关认证隔离；若请求的Authorization使用大小写不敏感的Basic认证方案，且解码后的用户名与密码字节恰为当前WebDAV临时凭据，SHALL 拒绝而不转发给应用。合法应用自己的Basic凭据仍按原规则转发。service响应中的401、文件路径404、本地认证401与平台会话失效必须区分，只有确认的Core会话失效结束proxy。公开文件后端 SHALL 不能获得Core/admin/agent凭据、Docker socket、私有卷或另一Work卷。

#### Scenario: 同一proxy交替访问service与文件
- **WHEN** 应用使用自己的Bearer和Cookie，同时文件客户端使用临时Basic
- **THEN** 应用收到自己的认证，Core文件入口收到平台认证，双方都收不到不属于自己的凭据

#### Scenario: 错误本地密码
- **WHEN** WebDAV客户端提供错误密码
- **THEN** 本地返回401且Core请求数为零，service代理与已有平台会话保持可用

#### Scenario: 临时密码误投到service
- **WHEN** service请求使用当前proxy生成的WebDAV Basic认证
- **THEN** CLI拒绝请求，service没有收到该密码；合法应用自己的Basic仍按原规则转发

#### Scenario: Basic认证方案大小写变化
- **WHEN** service请求将Basic方案写为`basic`或混合大小写，但凭据解码后仍是当前proxy的WebDAV用户名和临时密码
- **THEN** CLI拒绝请求，service收不到临时密码；不同的应用Basic凭据仍可转发

#### Scenario: 浏览器跨站访问本地文件入口
- **WHEN** 网页用其他Host或跨站Origin访问本地文件路径
- **THEN** 请求被拒绝，不通过本地代理借用已保存的Core凭据

## ADDED Requirements

### Requirement: Desktop 浏览器授权不得泄漏平台身份

**Identifier:** WACC-DESKTOP-001

Desktop SHALL 仅提供 loopback 入口，以本地启动授权和 HttpOnly 浏览器会话保护对已保存 Core 用户凭证的使用；匿名本地访问不能自动继承 CLI 登录。本地授权、平台会话、Service 应用认证与外部 WebDAV 临时 Basic SHALL 各自独立。Core token、密码和授权票据不得进入应用上游、普通链接、localStorage、已知操作记录或日志。

控制、登录、文件、上传及 Inspect 入口 SHALL 精确校验本地主机和来源，mutation 使用防跨站请求保护；本地 Inspect 可不登录 Core，但不能绕过本地入口授权。所有者判断仍由 Core 每次执行，不能信任浏览器提供的 owner、原始目标或旧缓存。Desktop 文件请求 SHALL 剥离浏览器 Cookie/Authorization、代理凭据和伪造平台头后使用当前用户认证访问 Core WebDAV；文件后端及 Service 均不能获得平台用户/admin/agent 凭证。

切换 Core、用户、登出或确认会话失效 SHALL 撤销该本地会话派生的 Service 授权并关闭活动流；本地会话失效不退出整个 WebUI，允许重新登录。未知网络错误不被当作应用 401 或确定的远端登出成功。浏览器入口 SHALL 不使用 operator/admin 权限弥补用户 API 失败，也不允许请求指定任意本机文件路径。

#### Scenario: 任意网站探测本地入口
- **WHEN** 外部网页访问本地控制/文件/Inspect 路由，或 DNS rebinding 带入非许可 Host
- **THEN** 在读取 Core 内容或本机暂存前拒绝，不因为请求来自 loopback 就授予 CLI 用户身份

#### Scenario: Service 试图借用平台身份
- **WHEN** Service 脚本向 Desktop 控制入口发请求或伪造网关保留头
- **THEN** 本地来源/会话校验拒绝，Core token 不进入浏览器响应或应用请求

#### Scenario: 浏览器文件与外部 WebDAV 并存
- **WHEN** 浏览器通过 Desktop Files 操作，外部客户端通过 proxy Basic 操作
- **THEN** 二者分别验证各自本地认证，再使用各自有效用户会话访问 Core；浏览器无需知道临时 Basic

#### Scenario: 本地会话失效
- **WHEN** Core 明确撤销当前用户会话
- **THEN** 浏览器 Service/文件/观察连接停止，旧本地授权不能续用，WebUI 留在可重新登录的状态
