## MODIFIED Requirements

### Requirement: Log in and persist credentials safely

`piwork-cli login` SHALL 接受账号，通过隐藏输入或标准输入获取密码；成功后持久保存包含 Core URL、token、到期时间与公开身份的版本化记录。POSIX 凭证父目录 SHALL 仅允许当前用户访问，凭证文件 SHALL 为 `0600`，符号链接等不安全目标 MUST 拒绝。`piwork-serve` 和它的 `piwork` 别名不提供用户 login，不读取该用户凭证文件。

凭证读取、保存与删除 SHALL 使用同一安全存储边界。读取现有凭证前 SHALL 核验父目录属于当前有效用户且没有 group/other 访问权限，并核验凭证为当前用户所有的普通 `0600` 文件；路径中的符号链接目录及符号链接文件 MUST 拒绝。新建凭证目录 SHALL 使用当前用户专属权限；已有目录权限或归属不满足要求时 SHALL 明确拒绝，不通过修改不安全目录的权限来继续访问。失败 SHALL 保留原凭证及外部目标，不发送从不安全路径取得的凭证，不输出凭证内容。

上述核验及实际读写删除 SHALL 基于已核验目录身份执行，使用目录句柄与相对路径、不跟随链接的操作，防止检查后替换路径将访问重定向到其他目录或文件。此边界 SHALL 同时用于用户 CLI 和 Desktop 共用的凭证存储，不要求用户配置额外代理或改动 Work。

凭证保存与删除 SHALL 使用同一跨进程互斥边界；按会话清理时，当前凭证身份核验及实际删除 SHALL 在一次持锁操作内完成，不得先比较再无条件删除。锁获取 SHALL 非阻塞，锁忙或获取失败 SHALL 返回安全错误，不降级为无锁操作。远端认证及撤销请求 SHALL 在该锁之外执行。

#### Scenario: Scripted login through standard input
- **WHEN** 用户运行 `piwork-cli login --account <account> --password-stdin`
- **THEN** CLI 完成认证并保存凭据，不打印密码或 bearer token

#### Scenario: Failed login preserves an existing credential
- **WHEN** Core 拒绝后续登录尝试
- **THEN** CLI 报告公开认证错误，先前保存的有效凭证保持不变

#### Scenario: Wrong command surface
- **WHEN** 用户执行 `piwork login` 或 `piwork-serve login`
- **THEN** 命令以 usage 错误退出，不读取用户凭据或联系用户登录端点

### Requirement: Show identity and perform server-side logout

`piwork-cli whoami` SHALL 显示保存凭据对应的公开身份。`piwork-cli logout` SHALL 撤销服务端会话，在确认撤销成功或会话已经无效后按该会话身份清理本地凭据；Core 不可达时 MUST 保留凭据以便后续重试。这些命令归属用户 CLI，不使用 operator 凭据。

logout 的成功撤销响应，或所选且与凭证归属匹配的 Core 返回可识别的 `401 AUTHENTICATION_FAILED` 公共错误，SHALL 视为无需继续保留该本地会话凭证。清理 SHALL 绑定请求开始时使用的规范化 Core URL 与 token，并在与保存共用的锁内安全读取和比较当前记录；仅身份仍匹配时删除。若凭证已安全确认不存在，或并发登录已将其替换为不同身份，SHALL 不修改当前记录。完成删除或上述无需删除的安全核验后，命令 SHALL exit 0，并按既有输出契约返回 `loggedOut=true`；该结果仅表示本次请求对应的旧会话已结束，不表示并发建立的新会话已登出。此规则包含会话已过期、已撤销或账号已禁用导致的明确认证失效。

网络故障、观察取消、403、5xx、未知错误代码或畸形响应 SHALL 保留本地凭证并按现有失败语义退出，不仅凭任意 HTTP 401 就宣告会话无效。其他 Core 的凭证及同一 Core 上并发登录取得的新 token SHALL 不被删除。本地安全核验、锁获取或删除失败 SHALL 返回失败，不报告 `loggedOut=true`，也不自动重放远端撤销请求。

#### Scenario: Use whoami in a new process
- **WHEN** 先前进程保存的凭据仍有效，用户在新进程执行 `piwork-cli whoami`
- **THEN** 无须重新提示密码即可返回相同账号、角色与用户 ID

#### Scenario: Log out a valid session
- **WHEN** 用户在 Core 可达时执行 `piwork-cli logout`
- **THEN** 服务端旧会话被撤销，仍匹配该会话的本地凭据被删除，旧 token 不再有效；若另一进程在请求期间登录同一 Core 获得新 token，或登录其他 Core 并保存凭据，新凭据保持不变；凭据已不存在时安全完成；保存与清理通过跨进程锁避免比较后删除新记录，锁忙或本地核验、删除失败时返回失败，不报告 `loggedOut=true`

#### Scenario: Core unavailable during logout
- **WHEN** 登出请求无法联系 Core 且撤销结果未确认
- **THEN** CLI 返回安全网络错误并保留本地凭据，不谎报已经撤销

## REMOVED Requirements

### Requirement: 文件能力失败不得破坏既有 service 访问

**Reason**: 原要求把旧 Core 发行版本作为验收前提；本次只交付当前 Go 平台，同时继续保留原有能力降级行为。

**Migration**: 由“文件能力独立降级并保持 service 代理”完整承接，继续使用 CLI-FILES-002 标识；以明确的 capability 响应验证，不建立 TS/Go 发行版本矩阵。

## ADDED Requirements

### Requirement: 文件能力独立降级并保持 service 代理

**Identifier:** CLI-FILES-002

文件能力未提供、版本不兼容、文件 helper 未配置或文件能力探测暂时失败时 SHALL 显示明确状态并继续已有 service 代理；后续文件请求可重查能力，未支持返回 `501 FILE_ACCESS_UNSUPPORTED`，配置/版本/暂时不可用返回 `503 FILE_HELPER_UNAVAILABLE` 或 `CORE_UNAVAILABLE`。能力缓存不能代替 Core 逐请求授权。普通 WebDAV 方法未实现仍为 405，不能与整项功能未支持混淆。此降级契约按当前能力响应验证，不要求维护旧 TS Core 与 Go CLI 的发行版本组合。

本地 401、文件 403/404/409/5xx、207 部分失败及 service 应用 401 SHALL 保留 proxy 进程。只有确认的 Core 会话 401 SHALL 关闭两类流量并 exit 3，提示重新登录后重启 proxy。CLI SHALL 不自动重放失败 PUT/COPY/MOVE/DELETE，不把收到错误解释为服务端必然回滚。帮助与文档 SHALL 给出单 proxy、多 Work URL、rclone 通用模式、本地密码有效期、运行状态限制、文件方法/限额及 export/import 验证步骤。

#### Scenario: 文件能力入口不存在
- **WHEN** service capability 可用但 file-access 能力探测返回 404
- **THEN** proxy 仍启动并显示文件不支持，service 网页可访问，文件入口返回 501 而不尝试把它转成用户 service

#### Scenario: 缺少helper
- **WHEN** file-access 报告后端不可用
- **THEN** service 继续可用，文件请求明确返回 503；后端恢复后新文件请求可以重新发现能力

#### Scenario: 文件错误和会话错误分别处理
- **WHEN** 文件缺失、本地密码错误、应用返回 401，随后 Core 真正撤销登录会话
- **THEN** 前三种错误不退出 proxy；最后一种关闭两类连接并提示重新登录

#### Scenario: 写入响应断开
- **WHEN** PUT 已转发但响应途中断开
- **THEN** CLI 报告连接失败而不自动再发 PUT，文档指引重新查询实际目标
