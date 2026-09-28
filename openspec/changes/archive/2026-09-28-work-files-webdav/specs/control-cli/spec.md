## MODIFIED Requirements

### Requirement: Provide stable output and failure behavior

**Identifier:** CLI-OUTPUT-001

两个CLI SHALL 使用各自稳定的命令帮助和退出码。`piwork-serve`的错误必须区分Core未运行、管理员未初始化、默认配置缺失、Skill导入失败和权限失败；`piwork-cli`必须区分未登录、Core不可用、Skill不可用、Work不可用和Run失败。任何输出不得包含用户登录密码、平台bearer token、operator credential、模型API key、secret path、Skill import path或internal digest。唯一的密码展示例外是统一proxy成功启动时向启动者一次显示本进程随机生成的WebDAV本地临时密码；该值不得进入URL、PAC、普通日志、错误或后续请求输出，不得持久写入平台登录文件或Work。Work配置命令 SHALL 返回稳定Work/Operation身份及active/desired/pending状态，不返回公开revision。

#### Scenario: Reject a command on the wrong CLI
- **WHEN** 用户在`piwork-cli`执行operator Skill mutation或admin users，或用`piwork-serve`进行chat
- **THEN** 命令立即以usage错误退出，不联系Core或执行状态变更

#### Scenario: Request JSON output
- **WHEN** 用户对支持JSON的status、Skill、identity、Work、Operation、Session或Run命令添加`--json`
- **THEN** stdout恰输出一个合法JSON值

#### Scenario: Order concurrent configuration writes
- **WHEN** 两个已授权配置更新按顺序提交且没有公开revision条件
- **THEN** 后提交配置成为desired，两次响应均不包含内部revision

#### Scenario: Return revision conflict safely
- **WHEN** 旧客户端提供expectedRevision或带revision的配置请求
- **THEN** CLI/API拒绝已废弃输入，不改变desired context，也不返回当前revision

#### Scenario: Reject obsolete revision options
- **WHEN** 用户向默认Work或单Work配置命令传入`--expected-revision`
- **THEN** CLI返回说明无revision命令格式的usage错误，不联系Core

#### Scenario: Reject invalid command input
- **WHEN** 缺少必需参数或选项不合法
- **THEN** CLI向stderr打印相关usage并按规定退出，不联系Core

#### Scenario: 只展示本地临时密码
- **WHEN** proxy成功启动并显示WebDAV连接信息
- **THEN** 仅启动输出含本次本地密码，Core登录token和其他平台秘密始终不出现，后续日志不重复记录密码

### Requirement: 启动有界的 CLI 本地服务代理

**Identifier:** CLI-SERVICE-PROXY-001

`piwork-cli [--core <url>] proxy [--port <1..65535>]` SHALL 在前台监听`127.0.0.1`，默认17890；启动前核验语法、当前用户凭证和Core service网关能力，并探测独立文件能力。远程Core URL SHALL 使用HTTPS，loopback Core可以使用HTTP。启动成功 SHALL 输出代理地址、`/proxy.pac` URL及CLI-FILES-001规定的WebDAV信息；PAC SHALL 仅让符合默认Work域名形状的http/ws目标使用代理，其他目标DIRECT。

service分支 SHALL 拒绝其他域名、HTTPS/wss、未登记域名和未声明端口，不修改系统代理、hosts或公网DNS。WebDAV SHALL 仅通过CLI-FILES-001定义的本地origin-form路径进入独立分支，不扩大service网关可转发目标。帮助无需凭证和网络；`--json`、非法或重复端口为usage错误exit 2，缺登录/确认的Core会话失效exit 3，必需Core service网关不可用exit 5，端口占用exit 6；启动失败不留监听进程。文件能力缺失按CLI-FILES-002降级。Ctrl+C SHALL 关闭两类连接并退出130，不停止Work。应用4xx/5xx及非会话文件错误不结束proxy。

#### Scenario: curl 使用默认域名
- **WHEN** 所有者已登录，启动`piwork-cli proxy`并执行`curl --proxy http://127.0.0.1:17890 http://notes.w-a1b2c3d4.work/`
- **THEN** 返回目标应用HTTP响应，CLI无需本机Docker权限

#### Scenario: 浏览器使用 PAC 和 WebSocket
- **WHEN** 浏览器配置CLI输出的PAC URL，打开服务网页并建立ws连接
- **THEN** HTTP与WebSocket均经过代理和Core，其他网站按PAC返回DIRECT

#### Scenario: 无法启动代理
- **WHEN** 用户未登录、端口已占用或传入非数字端口
- **THEN** CLI返回对应退出码和安全错误，不打印平台token，不改听其他地址或端口

#### Scenario: 拒绝开放 CONNECT
- **WHEN** 浏览器为WebSocket发送CONNECT后传入非HTTP Upgrade字节或不匹配Host
- **THEN** 代理关闭连接，不建立任意TCP通道；合法WebSocket升级仍可完成

#### Scenario: 同一监听器服务两种访问
- **WHEN** service客户端使用HTTP代理，文件客户端直连本地Work文件URL
- **THEN** 两者共享一个proxy进程和端口，分别进入Core service网关和文件入口

## ADDED Requirements

### Requirement: 在统一 proxy 上提供多个 Work 的本地 WebDAV

**Identifier:** CLI-FILES-001

proxy SHALL 在同一端口提供`http://127.0.0.1:<port>/works/<workId>/files/`；客户端把该地址作为WebDAV服务器，无需为文件访问额外配置HTTP代理/PAC。一个进程支持多个自有Work，不新增`work files serve`命令或独立17891监听器。CLI SHALL 输出URL模板、文件能力状态、用户名piwork及32随机字节base64url临时密码；密码仅当前进程有效。Work ID通过现有work list/show获取，本地`/`和`/works/`不提供跨Work聚合列表。

本地文件路由 SHALL 只接受origin-form、准确本地Host（127.0.0.1或localhost和实际端口）及WACC-FILES-002认证。service absolute-form请求即使带`/works/.../files/`路径也 SHALL 保持service分支；文件路由不接受CONNECT/Upgrade，也不将任意绝对URL改成文件请求。CLI SHALL 替换请求前缀为Core文件入口，对Destination、返回Location及全部DAV:href做同Work映射；非法/越界目标拒绝。普通文件体流式转发，XML元数据最多有界缓冲16 MiB，禁止向客户端泄漏Core内部前缀或生成无法重新访问的href。

#### Scenario: 两个自有Work与路径映射
- **WHEN** 同一proxy分别访问两个自有Work的文件根
- **THEN** 路径中的workId选择正确workspace，列表href可以直接再次访问，不能串到另一Work

#### Scenario: service恰有同名路径
- **WHEN** service请求URL为`http://notes.w-a1b2c3d4.work/works/example/files/a`
- **THEN** 请求原样进入notes应用，不被本地文件分支拦截

#### Scenario: 移动和复制的Destination
- **WHEN** 客户端向本地文件入口发送同Work绝对或origin-form Destination
- **THEN** CLI转换为Core同Work目的路径，响应href/Location转换回来，跨Work或外部目的地在转发前被拒绝

#### Scenario: 本地认证与进程重启
- **WHEN** proxy退出后重新启动，客户端继续使用旧临时密码
- **THEN** 返回本地401，新进程使用新密码，Core登录凭据无需因proxy重启而改变

#### Scenario: 无须Docker和第二个代理
- **WHEN** 仅安装CLI和通用WebDAV客户端的用户启动proxy
- **THEN** 能通过Core访问文件，无需在客户端运行Docker、额外serve命令或本地service容器

### Requirement: 文件能力失败不得破坏既有 service 访问

**Identifier:** CLI-FILES-002

新CLI连接旧Core、文件能力版本不兼容、文件helper未配置或文件能力探测暂时失败时 SHALL 显示明确状态并继续已有service代理；后续文件请求可重查能力，未支持返回501 FILE_ACCESS_UNSUPPORTED、配置/版本/暂时不可用返回503 FILE_HELPER_UNAVAILABLE或CORE_UNAVAILABLE。能力缓存不能代替Core逐请求授权。普通WebDAV方法未实现仍为405，不能与整项功能未支持混淆。

本地401、文件403/404/409/5xx、207部分失败及service应用401 SHALL 保留proxy进程。只有确认的Core会话401 SHALL 关闭两类流量并exit 3，提示重新登录后重启proxy。CLI SHALL 不自动重放失败PUT/COPY/MOVE/DELETE，不把收到错误解释为服务端必然回滚。帮助与文档 SHALL 给出单proxy、多Work URL、rclone通用模式、本地密码有效期、运行状态限制、文件方法/限额及export/import验证步骤。

#### Scenario: 新CLI连接旧Core
- **WHEN** service capability可用但file-access返回404
- **THEN** proxy仍启动并显示文件不支持，service网页可访问，文件入口返回501而不尝试把它转成用户service

#### Scenario: 缺少helper
- **WHEN** file-access报告后端不可用
- **THEN** service继续可用，文件请求明确返回503；后端恢复后新文件请求可以重新发现能力

#### Scenario: 文件错误和会话错误分别处理
- **WHEN** 文件缺失、本地密码错误、应用返回401，随后Core真正撤销登录会话
- **THEN** 前三种错误不退出proxy；最后一种关闭两类连接并提示重新登录

#### Scenario: 写入响应断开
- **WHEN** PUT已转发但响应途中断开
- **THEN** CLI报告连接失败而不自动再发PUT，文档指引重新查询实际目标
