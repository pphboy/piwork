# Work Access Specification

## Purpose

建立用户、管理员和 Work 运行身份之间的授权边界，确保工作配置、会话内容、容器服务和持久数据只能由获准主体访问，并让跨 Work、过期运行实例和伪造身份的请求得到一致、可验证的拒绝。

## Requirements

### Requirement: Owner-scoped Work access

系统 SHALL 将 Work 绑定到创建用户；普通用户只能列出、查询、配置、启停、删除和连接自己拥有的 Work。对其他用户的 Work、Session、Run、服务、Operation 和卷的请求 SHALL 返回不可见结果，不能仅依赖 Client 隐藏入口。

#### Scenario: Access another user's Work

- **WHEN** 用户 A 使用用户 B 的 Work 或 Run 标识发起控制、观察或对话请求
- **THEN** 系统拒绝并不返回该资源内容，两个 Work 的状态均不改变

#### Scenario: List owned resources

- **WHEN** 普通用户请求 Work 和留存数据列表
- **THEN** 结果只包含其有权访问的对象，已删除 Work 的留存卷仍按原所有者授权

### Requirement: Separate administration from conversation access

管理员 SHALL 能管理所有 Work 的控制状态、资源与配置，但在不是所有者时 MUST NOT 自动获得会话正文、Run 输出或交互权限。

#### Scenario: Administrator stops another user's Work

- **WHEN** 管理员停止其他用户的 Work
- **THEN** 控制操作被允许且可查询结果，但该权限不允许读取用户会话或发送 agent 消息

### Requirement: Work runtime identity is limited and fenced

**Identifier:** WACC-SERVICE-001

daemon 的运行身份 SHALL 绑定 Work 和有效实例代次，只允许报告本实例状态及操作本 Work 服务。系统 MUST NOT 接受通过请求参数覆盖身份归属，MUST NOT 接受旧代次 mutation 或将运行身份用于用户管理。

Core service gRPC SHALL authenticate a cryptographic agent-client identity bound to installation, Work, generation, and instance, and validate that instance is currently authorized on each call. Agent identity MUST NOT be converted into an unrestricted owner/admin credential. Request fields cannot select another Work or a raw Docker target. Service lookups SHALL verify both Work ownership and application-service resource kind; the caller cannot stop, restart, update, or delete agentd itself. Failed, superseded, initialization-only and draining instances MUST NOT submit service mutations. Replacement credentials SHALL invalidate the old instance, even when certificates have not expired.

#### Scenario: Cross-Work service creation

- **WHEN** Work A 的 daemon 使用其身份请求向 Work B 添加服务
- **THEN** 请求被拒绝且 Work B 不产生定义、配额预留或容器

#### Scenario: Replaced daemon sends a late request

- **WHEN** 一个已被替换的 daemon 使用旧代次身份提交服务修改
- **THEN** 系统拒绝该修改，当前服务配置保持不变

#### Scenario: Refuse daemon self-management
- **WHEN** a valid agent passes its own container ID or agentd identity to a service operation
- **THEN** Core returns NOT_FOUND or INVALID_ARGUMENT without invoking Docker

#### Scenario: Reject unauthenticated sibling
- **WHEN** an application container reaches the control listener without an agent-client credential
- **THEN** the transport rejects it before any service data or mutation is returned

#### Scenario: Reject forged ownership metadata
- **WHEN** a valid certificate for Work A is accompanied by metadata claiming Work B or a newer generation
- **THEN** Core rejects the mismatch and changes neither Work

#### Scenario: Initialization cannot deploy
- **WHEN** a candidate daemon is validating a pending Work context
- **THEN** local MCP discovery can complete but Core rejects its lifecycle mutations until activation

### Requirement: Enforce resource and transport isolation

系统 SHALL 在运行时隔离不同 Work 的私有网络和卷；默认拒绝特权容器、宿主网络、Docker socket、任意宿主路径挂载和跨 Work 挂载。daemon 控制与对话入口 SHALL 仅接受受信控制面身份，不允许绕过 Gateway 或使用伪造用户元数据。

#### Scenario: Forbidden mount or runtime privilege

- **WHEN** agent 声明包含其他 Work 卷、宿主 socket 或特权模式的服务
- **THEN** 系统在创建资源前拒绝，并返回可识别的策略错误

#### Scenario: Direct unauthorized daemon access

- **WHEN** 未授权客户端或另一 Work 身份直接调用 daemon，或伪造转发用户标识
- **THEN** daemon 拒绝请求，不执行 Run 或返回会话数据

#### Scenario: Network boundary

- **WHEN** Work A 中的容器尝试访问 Work B 私有服务地址
- **THEN** 请求无法到达 Work B 服务，已授权的模型和 MCP 出站访问仍按策略工作

### Requirement: Authorize service content independently of control metadata

**Identifier:** WACC-SERVICE-002

The Work owner and current authorized Work agent SHALL be able to read bounded application logs for that Work service. A non-owner administrator SHALL retain service control and safe diagnostic access but MUST NOT gain application-log content access merely through administrative role. Cross-Work service and Operation IDs SHALL be indistinguishable from absent IDs. Daemon credentials, model secrets, database files and Session history SHALL NOT be mounted into application services.

#### Scenario: Read own application logs
- **WHEN** the valid Work agent requests logs from its own application service
- **THEN** Core returns the bounded content result without extending its authority to another resource

#### Scenario: Admin can repair without content access
- **WHEN** a non-owner admin inspects or stops a service and then requests its application log content
- **THEN** control and safe diagnostics are permitted while log content is denied

### Requirement: Authorize full packages as owner content rather than control metadata

**Identifier:** WACC-SNAPSHOT-001

export、snapshot 内容/详情、upload package、import 及其敏感 provenance SHALL 仅允许相应已认证用户访问自己的内容；非所有者管理员的控制权限不包含导出/下载权限，返回 403；普通非所有者返回 404。operator 或 agent runtime 凭证不能调用这些用户入口。import 的 owner SHALL 由认证主体确定，不能来自包或请求的任意 ownerId。snapshot job 的 Operation 查询 SHALL 校验任务 owner，不能沿用普通管理员可读控制 metadata 的权限扩大内容访问。

包不会成为源 Core 的 credential；接收端导入时 SHALL 新建平台 Work/service/卷身份并按 PWORK-004 自动验证目标模型权限与凭证可用性，显式启动时 SHALL 新建运行网络、代次和 TLS 身份。内置 `work-services` MCP 的目标 Core 地址及服务控制证书 SHALL 由目标安装注入，认证身份只允许操作新 Work，不能因包内文本、源 Work ID 或源控制记录获得源平台权限。导入不能复制源证书或在尚未启动的 Work 中预置可用的运行凭证。普通状态、错误、日志和 CLI stdout 仍脱敏，完整包文件是用户明确请求的内容传输例外，不经过会破坏用户字节的内容脱敏。离线持有者能读取包内容，产品 SHALL 提醒分享者自行确认接收方可信，不宣称包已自动清除秘密。

#### Scenario: Administrator cannot export private content
- **WHEN** 一个管理员能够停止另一用户的 Work 后尝试 export/download
- **THEN** 请求返回 403，不返回包或历史正文

#### Scenario: Forge ownership in the manifest
- **WHEN** 包声称源 ownerId 是管理员或 import 请求试图指定其他 owner
- **THEN** 非法 owner 字段被拒绝，导入不能赋予调用者额外平台权限

#### Scenario: Access a failed unpublished import
- **WHEN** import 失败且 Work 没有发布
- **THEN** 只有发起者可按 Operation ID 读取安全失败诊断，其他用户不能利用缺失 Work 绕过鉴权

#### Scenario: Imported agent controls only its new Work
- **WHEN** 导入 Work 的 pi-agentd 经内置 MCP 调用目标 Core 的 service 工具，并尝试指定源 Work 或其他 Work 的 service ID
- **THEN** 目标 Core 只按新生成的 Work/运行代次/实例身份授权，拒绝跨 Work 操作，不接受包内源身份作为凭证

### Requirement: 将应用内容访问限定为当前 Work 所有者

**Identifier:** WACC-SERVICE-ACCESS-001

Core SHALL 在域名解析、HTTP 请求及 WebSocket Upgrade 时用当前用户会话检查 Work 所有者与当前服务身份。普通非所有者及非所有者管理员 SHALL 不得经该网关读取或写入应用内容；其控制元数据权限不视为应用内容权限。未知域名、跨 Work 请求与非所有者请求 SHALL 返回不可区分的不可见错误。CLI 本地代理不得使用 operator 或 agent 身份回退。已有连接在会话失效、Work 停止或 service 停止/删除后 SHALL 在 2 秒内关闭。

#### Scenario: 管理员不获得应用正文
- **WHEN** 非所有者管理员可以检查、停止某 service，却访问其 HTTP URL
- **THEN** Core 拒绝并不返回应用正文或容器地址

#### Scenario: 伪造其他 Work 域名
- **WHEN** 用户 A 的代理请求用户 B 的 service 域名
- **THEN** 返回与不存在域名相同的不可见结果，不访问 B 的容器

#### Scenario: 登出撤销活动连接
- **WHEN** 用户登出后，其代理仍保持一个 WebSocket 连接
- **THEN** Core 在 2 秒内关闭连接，代理不凭缓存的授权继续发送帧

### Requirement: 隔离平台认证与应用认证

**Identifier:** WACC-SERVICE-ACCESS-002

CLI 与 Core 使用的用户 token SHALL 仅用于 Core 鉴权，不得转发给 service。应用原有 `Authorization`、Cookie 及响应 Cookie SHALL 作为应用流量保持；客户端或应用伪造的网关保留头 SHALL 被剔除。Core 只能连接经当前 service ID 与 Docker labels 核验且位于所属 Work 私网的已声明 TCP 端口，不接受请求带来的原始 IP/URL/网络目标。应用响应中的 HTTP 401/403/404 SHALL 不被当作平台鉴权错误改写。

#### Scenario: 应用使用自己的 Bearer
- **WHEN** 浏览器向应用发送自己的 Authorization Bearer 和 Cookie
- **THEN** 应用收到这些头，但收不到 CLI 登录 token、网关保留头或 operator 凭证

#### Scenario: 应用返回 401
- **WHEN** 应用拒绝其自身登录态并返回 401
- **THEN** 用户收到应用原有 401 与正文，CLI 代理保持运行且不会删除平台登录状态

### Requirement: 将 workspace 文件内容限定为当前所有者

**Identifier:** WACC-FILES-001

Core SHALL 对所有文件请求及提交校验当前有效用户会话和 Work 所有权；非所有者管理员不因控制权限获得文件内容。未知、已删除和跨所有者 Work SHALL 返回不可区分的404；缺失/无效会话返回401。operator、agent运行身份和请求伪造的owner/Work元数据不能替代用户认证。资格检查 SHALL 先于文件内容读取、临时文件写入、helper创建及资源信息返回。

活动文件请求 SHALL 至少每2秒复核会话有效性及Work资格；会话被撤销或用户被禁用后最多2秒停止传输并开始取消。撤销之后不能发出新的写入提交许可；已经授予许可的请求可能已完整提交，不能对客户端宣称必然回滚。文件内容在授权数据响应中原样传输；WebDAV目录/逐项错误响应可包含已授权请求范围内的规范化href，不能包含宿主路径、卷名、凭据或无关文件正文。普通平台日志与控制诊断不得携带用户文件名或内容。

#### Scenario: 管理员有控制权限但没有文件权限
- **WHEN** 非所有者管理员能停止某Work并请求读取其workspace
- **THEN** 文件接口返回与未知Work相同的404，不能沿用管理身份读取文件

#### Scenario: 猜测Work身份或存储目标
- **WHEN** 用户替换URL中的workId，或注入owner、卷名、容器ID及保留平台头
- **THEN** Core按当前会话和自己的归属记录授权，不读取其他Work或请求指定的存储

#### Scenario: 长上传期间撤销会话
- **WHEN** 用户上传尚未获得提交许可时登出
- **THEN** 两秒内断开流并开始清理，不发出新提交许可，旧目标保持完整

#### Scenario: 原样传输用户文件
- **WHEN** 所有者下载内容包含看似凭据字符串的普通文件
- **THEN** 文件字节保持一致；平台日志只包含安全身份、计数和错误码，不复制文件内容

### Requirement: 隔离本地 WebDAV 认证与 service 应用认证

**Identifier:** WACC-FILES-002

CLI 文件入口 SHALL 仅接受loopback连接、精确本地Host及当前proxy的临时Basic凭据；拒绝跨站Origin和cross-site请求，不提供CORS放行。无效本地凭据只产生本地401，不联系Core、不撤销平台登录。CLI SHALL 移除本地Basic、Cookie、Proxy认证、客户端平台保留头和逐跳头，使用保存的用户Bearer调用Core文件接口。Core token不得交给WebDAV客户端、service或文件helper。

service分支 SHALL 保持原有应用Authorization/Cookie和网关认证隔离；若请求的Authorization使用大小写不敏感的Basic认证方案，且解码后的用户名与密码字节恰为当前WebDAV临时凭据，SHALL 拒绝而不转发给应用。合法应用自己的Basic凭据仍按原规则转发。service响应中的401、文件路径404、本地认证401与平台会话失效必须区分，只有确认的Core会话失效结束proxy。公开文件后端 SHALL 不能获得Core/admin/agent凭据、Docker socket、私有卷或另一Work卷。

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
