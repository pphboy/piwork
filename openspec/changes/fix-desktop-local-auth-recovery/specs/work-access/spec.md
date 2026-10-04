## MODIFIED Requirements

### Requirement: Desktop 浏览器授权不得泄漏平台身份

**Identifier:** WACC-DESKTOP-001

Desktop SHALL 仅提供 loopback 入口，以本地启动授权和 HttpOnly 浏览器会话保护对已保存 Core 用户凭证的使用；匿名本地访问不能自动继承 CLI 登录。本地授权、平台会话、Service 应用认证与外部 WebDAV 临时 Basic SHALL 各自独立。Core token、密码和授权票据不得进入应用上游、普通链接、localStorage、已知操作记录或日志。

控制、登录、文件、上传及 Inspect 入口 SHALL 精确校验本地主机和来源，mutation 使用防跨站请求保护；本地 Inspect 可不登录 Core，但不能绕过本地入口授权。所有者判断仍由 Core 每次执行，不能信任浏览器提供的 owner、原始目标或旧缓存。Desktop 文件请求 SHALL 剥离浏览器 Cookie/Authorization、代理凭据和伪造平台头后使用当前用户认证访问 Core WebDAV；文件后端及 Service 均不能获得平台用户/admin/agent 凭证。

切换 Core、用户、登出或确认 Core 会话失效 SHALL 撤销该平台身份派生的 Service/文件/观察授权并关闭活动流；仍有效的浏览器本地控制会话保留用于重新登录。本地授权失效不退出整个 WebUI，必须经新的本地启动授权才能使用账号登录，不能凭匿名网页自动继承保存凭证。未知网络错误不被当作应用 401 或确定的远端登出成功。浏览器入口 SHALL 不使用 operator/admin 权限弥补用户 API 失败，也不允许请求指定任意本机文件路径。

重新签发启动授权或执行无 Cookie 的实例注销 SHALL 仅允许该 Desktop 的当前系统用户经可信本机控制通道请求；普通网页、跨站请求、Service 应用和其他系统用户不能调用该通道取得票据或清除身份。控制请求 SHALL 绑定目标实例和有界操作，不接受任意 Core URL、宿主文件或其他进程目标。控制资源不得被其他用户读取/替换，进程退出后旧控制身份不能用于新的监听实例。

Reset browser access SHALL 经有效浏览器本地会话、精确 Host/Origin 和 CSRF 校验及影响确认，撤销指定 Desktop 全部浏览器授权和派生访问，但保留平台凭证；重签 ticket 不产生该撤销。注销平台身份、重置浏览器访问、CLI 退出均不停止 Work。浏览器访问重置后活动内容流至多两秒断开，旧 Cookie/CSRF/Service 授权不能继续访问，平台上已授予的写入可能已提交，不承诺回滚。

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
- **THEN** 浏览器 Service/文件/观察连接停止，旧平台派生内容授权不能续用，有效本地控制会话可重新登录，WebUI 不退出

#### Scenario: 外部主体不能重新签发或清理
- **WHEN** 外部网页、Service 脚本或另一系统用户尝试访问恢复/实例注销入口
- **THEN** 票据和身份清理均被拒绝，保存的 Core 登录、现有浏览器授权及 Work 状态不变

#### Scenario: 控制通道资源不可信
- **WHEN** 控制路径被符号链接、其他用户目录或非预期对象替换，或连接的实例代次不匹配
- **THEN** 操作在签发票据或清理身份之前失败，不删除任意文件、不降级到匿名 HTTP 授权

#### Scenario: 浏览器授权重置与新票据
- **WHEN** 有效用户确认重置浏览器访问，或只请求新的启动票据
- **THEN** 前者撤销全部旧本地浏览器访问但保留平台登录，后者仅替换待兑换票据且保持已授权会话；两者不改变 Work 的运行目标
