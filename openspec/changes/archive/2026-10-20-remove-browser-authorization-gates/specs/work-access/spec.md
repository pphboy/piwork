# Spec Delta

## REMOVED Requirements

### Requirement: Desktop 浏览器授权不得泄漏平台身份

**Reason:** 取消本机启动授权、独立浏览器重置和必须经终端重新授权的边界；保留普通账号与来源保护。

**Migration:** 由“Desktop 普通浏览器入口不得泄漏平台凭据”承接 WACC-DESKTOP-001；内容所有权、凭据不外泄和正常注销撤销规则完整保留。

## ADDED Requirements

### Requirement: Desktop 普通浏览器入口不得泄漏平台凭据

**Identifier:** WACC-DESKTOP-001

Desktop SHALL 仅提供宿主 loopback 入口；原生模式仅监听 loopback，显式容器模式可监听容器内 0.0.0.0 并仅向宿主 loopback 发布。合法普通页面自动建立必要的 HttpOnly 浏览器会话，按同 Core 的有效共享 CLI 凭据或正常账号登录继续，不要求本地启动授权、ticket 或独立 Access。普通浏览器会话、平台账号会话、Service 应用认证与外部 WebDAV 临时 Basic SHALL 保持各自职责。Core token 和密码不得进入应用上游、普通链接、localStorage、已知操作记录或日志。

控制、登录、文件、上传及 Inspect 入口 SHALL 精确校验本地主机和来源，mutation 使用防跨站请求保护；本地 Inspect 可不登录 Core，普通地址即可使用。所有者判断仍由 Core 每次执行，不能信任浏览器提供的 owner、原始目标或旧缓存。Desktop 文件请求 SHALL 剥离浏览器 Cookie/Authorization、代理凭据和伪造平台头后使用当前用户认证访问 Core WebDAV；文件后端及 Service 均不能获得平台用户/admin/agent 凭证。

切换 Core、用户、登出或确认 Core 会话失效 SHALL 撤销该平台身份派生的 Service/文件/观察授权并关闭活动流；普通入口继续提供正常登录。普通浏览器会话缺失/到期 SHALL 自动建立，不要求新的启动链接，且不得延长或伪造 Core 登录。未知网络错误不被当作应用 401 或确定的远端登出成功。浏览器入口 SHALL 不使用 operator/admin 权限弥补用户 API 失败，也不允许请求指定任意本机文件路径。

通过可信本机控制通道调用 open/logout SHALL 仅允许该 Desktop 的当前系统用户；普通网页、跨站请求、Service 应用和其他系统用户不能调用该通道清除身份或冒充实例。控制请求 SHALL 绑定目标实例和有界操作，不接受任意 Core URL、宿主文件或其他进程目标。控制资源不得被其他用户读取/替换，进程退出后旧控制身份不能用于新的监听实例。open 返回普通地址，不授予新的浏览器权限。

Desktop SHALL 移除独立浏览器访问重置及其授权恢复流程。正常注销和 CLI 退出仍不停止 Work；平台身份撤销后活动内容流至多两秒断开，旧身份派生的 Service/文件访问不能续用。平台上已授予的写入可能已提交，不承诺回滚；普通页面会话恢复不撤回已接受的业务操作，也不能恢复被 Core 撤销的账号权限。

#### Scenario: 任意网站探测本地入口
- **WHEN** 外部网页访问本地控制/文件/Inspect 路由，或 DNS rebinding 带入非许可 Host
- **THEN** 在读取 Core 内容或本机暂存前拒绝，不因为请求来自 loopback 就授予 CLI 用户身份

#### Scenario: Service 试图借用平台身份
- **WHEN** Service 脚本向 Desktop 控制入口发请求或伪造网关保留头
- **THEN** 本地来源/普通会话校验拒绝，Core token 不进入浏览器响应或应用请求

#### Scenario: 浏览器文件与外部 WebDAV 并存
- **WHEN** 浏览器通过 Desktop Files 操作，外部客户端通过 proxy Basic 操作
- **THEN** 二者分别验证普通浏览器会话/CSRF 或临时 Basic，再使用各自有效用户会话访问 Core；浏览器无需知道临时 Basic，也不出现 Access 授权步骤

#### Scenario: Core 会话失效
- **WHEN** Core 明确撤销当前用户会话
- **THEN** 浏览器 Service/文件/观察连接停止，旧平台派生内容授权不能续用，普通地址可直接重新登录，WebUI 不退出

#### Scenario: 外部主体不能清理实例身份
- **WHEN** 外部网页、Service 脚本或另一系统用户尝试调用可信本机控制通道的 open/logout
- **THEN** 控制请求被拒绝，保存的 Core 登录、现有普通会话及 Work 状态不变；不存在可供签发的浏览器入口 ticket

#### Scenario: 控制通道资源不可信
- **WHEN** 控制路径被符号链接、其他用户目录或非预期对象替换，或连接的实例代次不匹配
- **THEN** 操作在打开地址或清理身份之前失败，不删除任意文件、不降级到未经实例归属校验的控制通道

#### Scenario: 普通会话恢复与正常注销
- **WHEN** 用户清 Cookie 后直接打开普通地址，随后明确 Sign out
- **THEN** 先自动恢复普通会话并按真实共享登录继续，注销再撤销平台身份及派生访问；没有浏览器授权重置步骤，Work 运行目标不变

#### Scenario: 容器入口直接打开
- **WHEN** 浏览器通过宿主 loopback 发布端口打开 Desktop，或另一容器仅共享 CLI 凭据卷
- **THEN** 合法普通页面自动建立会话并正常登录/复用共享凭据，另一容器不能取得目标实例控制权限，Core token 不进入浏览器或主容器常规日志
