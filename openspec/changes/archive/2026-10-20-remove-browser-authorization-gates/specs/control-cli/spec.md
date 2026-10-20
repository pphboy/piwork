# Spec Delta

## REMOVED Requirements

### Requirement: 可信本机命令重新打开既有 Desktop

**Reason:** open 不再签发、轮换或验证一次性票据，原重新授权与重放拒绝行为被取消。

**Migration:** 由“可信本机命令打开既有 Desktop 普通地址”承接 CLI-DESKTOP-002；命令语法、实例归属及退出码不变，输出为普通 URL。

## ADDED Requirements

### Requirement: 可信本机命令打开既有 Desktop 普通地址

**Identifier:** CLI-DESKTOP-002

`piwork-cli desktop open [--port <1..65535>] [--no-open]` SHALL 连接同一系统用户拥有的既有 Desktop，默认端口 17891，不新建监听实例、不连接 Core、不读取平台凭证、不改变该实例当前 Core。成功输出当前实例准确本机 origin 的普通地址，不含 ticket、证明或账号秘密；原生模式默认打开浏览器，`--no-open` 只打印地址。显式容器模式不尝试打开容器内部浏览器，地址及 exit 0 仍返回当前调用者；发行说明要求使用 `--no-open` 并在宿主浏览器手动打开。调用不依赖工作目录、`PIWORK_CONFIG_PATH` 或 Core 环境配置。该形式不接受全局 `--core` 或 `--json`、未知 flag、重复 flag、额外参数及非法端口；语法错误 exit 2，help exit 0 均先于文件/网络操作。

open SHALL 只是可选的地址发现/浏览器打开操作，不签发、轮换或兑换浏览器入口授权；任何来源合法的新浏览器均可直接打开该普通地址。多次 open 不改变现有浏览器会话或平台身份。成功 exit 0，浏览器打开失败仍输出手动地址并 exit 0；实例不存在或已退出 exit 4，本机通道权限/安全校验拒绝 exit 3，协议不兼容或超时 exit 5。错误 stdout 为空，stderr 提供安全原因与下一步，不输出秘密、堆栈或任意路径；没有实例时不自动启动另一实例。Ctrl+C 结束 open 的本地等待不终止服务实例；原 `desktop` 的端口占用 exit 6 保持。

浏览器普通会话 SHALL 自动建立，最多 128 个且绝对期限十二小时；注册前回收过期项，容量满返回 503 LOCAL_SESSION_CAPACITY，不驱逐有效会话。容量错误 SHALL 作为普通连接资源限制提供重试说明，不要求取得新 ticket、重置浏览器访问或重新授权。普通浏览器会话到期不延长 Core 账号会话，下一次合法页面初始化自动建立普通会话并按真实账号状态继续。

#### Scenario: 运行中的实例重新打开
- **WHEN** 当前 Desktop 已运行，用户执行 open 并打开输出地址
- **THEN** 原 PID、端口、Core 和平台身份保持，普通地址直接进入正常登录或工作区，已有浏览器可继续访问，不需要平台凭据才能执行命令

#### Scenario: 自定义端口且环境配置不同
- **WHEN** 从不同目录及不同凭证/Core 环境执行 open --port 指向既有实例
- **THEN** 只重新打开该端口的同用户实例，不读取损坏凭证、不切换 Core、不尝试新的 TCP 监听

#### Scenario: 多次打开与旧票据链接
- **WHEN** 连续执行两次 open，或浏览器打开含历史 ticket 的旧链接
- **THEN** open 均返回同一普通地址，旧片段被忽略或移除，没有一次性校验、已有会话撤销或 Access 恢复页面

#### Scenario: 未运行、错误参数或打开浏览器失败
- **WHEN** 实例不存在、参数非法或系统浏览器无法启动
- **THEN** 分别返回 exit 4、exit 2 或带手动地址的 exit 0；均不创建后台副本、停止 Work 或泄漏平台 token

#### Scenario: 浏览器会话容量边界
- **WHEN** 有效普通会话达到 128 个，或注册时存在已过期会话
- **THEN** 分别拒绝新增并保留有效会话，或先回收过期项再自动建立；资源限制不要求重置浏览器访问，不泄漏账号秘密

## MODIFIED Requirements

### Requirement: 启动本地 Desktop WebUI

**Identifier:** CLI-DESKTOP-001

`piwork-cli [--core <url>] desktop [--port <1..65535>] [--no-open]` 及全局参数解析成功、无子命令且没有 `--json` 时的默认 Desktop 入口 SHALL 在原生模式前台启动仅监听 `127.0.0.1` 的本地 WebUI，默认端口 17891；原生模式默认打开系统浏览器，`--no-open` 仅输出本地打开地址。显式容器模式 SHALL 按 CLI-CONTAINER-001 提供宿主本机入口，并按 CLI-CONTAINER-DESKTOP-001 输出可直接打开的普通地址。地址 SHALL 使用受验证的 localhost 主机名；原生模式本机无需 Docker，容器交付使用已安装的 Docker；两种模式的本地 WebUI 均无需代理/PAC、hosts 编辑或安装本地站点证书。Desktop Core 地址 SHALL 按显式 `--core`、`PIWORK_CORE_URL`、保存的 Desktop 默认地址、凭证 Core、`http://127.0.0.1:7171` 的优先级选择；参数与环境仅覆盖本次调用，普通业务命令仍按原地址优先级且不读取 Desktop 偏好；Core 可以使用合法 HTTP 或 HTTPS origin，不按目标位置限制 HTTP，遵守 CLI-CORE-PROTOCOL-001。普通地址 SHALL 不含浏览器入口 ticket 或其他授权片段；来源合法的浏览器自动建立必要会话，复用同 Core 的有效共享 CLI 凭据或进入正常登录。无登录或 Core 暂不可达 SHALL 仍可打开登录/连接页面和本地包 Inspect，不能借用其他 Core 的 token，不要求终端重新授权。

启动前 SHALL 校验参数；未知参数、重复或非法端口、显式 Desktop 的 `--json` 返回 exit 2；端口占用返回 exit 6，资源缺失或监听失败返回 exit 5，不自动换端口或遗留半启动监听器。浏览器打开失败 SHALL 保持服务并打印手动打开地址；`--help` 不读取凭证或偏好、不启动监听、不访问网络。Ctrl+C SHALL 关闭本地连接、清理本次临时资源并退出 130，不停止 Work、不取消已经接受的 Core Operation/Run。平台会话失效 SHALL 回到登录状态而不退出 WebUI。既有 `proxy` 默认 17890、PAC、临时 WebDAV 密码及退出语义 SHALL 不变；Desktop 不要求先启动 proxy。

#### Scenario: 无登录的一键启动
- **WHEN** 原生用户首次运行默认入口或显式 desktop 且没有保存凭证
- **THEN** 浏览器打开登录/连接页面，可以配置默认 Core 和本地 Inspect；输入有效用户凭据后进入自己的 Work List

#### Scenario: 打开浏览器失败
- **WHEN** 本地监听已成功但系统没有可用的打开浏览器命令
- **THEN** 命令持续运行并显示手动地址，不谎报启动失败或自动关闭

#### Scenario: 非法端口与端口占用
- **WHEN** 用户指定非法端口或已被占用的合法端口
- **THEN** 分别返回 exit 2 或 6，不自动监听其他端口，不启动后台副本

#### Scenario: 关闭窗口和退出 CLI
- **WHEN** 用户关闭浏览器窗口，随后终止 Desktop 进程
- **THEN** 关闭浏览器不停止监听；进程退出只终止本地入口，Core 上已接受的工作继续，可在下次登录后查询

#### Scenario: 两种访问命令并存
- **WHEN** 用户同时运行默认 Desktop 与 proxy
- **THEN** 二者使用独立端口与本地凭据，WebUI 的启动和浏览器 Files 不依赖 proxy

#### Scenario: 使用远程 HTTP 启动及恢复
- **WHEN** 用户默认启动或显式 desktop 指定合法远程 HTTP Core，随后执行同用户 desktop open
- **THEN** Desktop 正常监听并输出/打开本地页面，页面报告实际 Core 状态；open 只恢复原实例，不改地址或创建第二实例

### Requirement: 可信本机命令清理 Desktop 当前平台登录

**Identifier:** CLI-DESKTOP-003

`piwork-cli desktop logout [--port <1..65535>]` SHALL 通过同用户的可信本机通道清理所选 Desktop 当前平台登录，默认端口 17891。此命令不读取调用者的凭证文件、不依赖浏览器 Cookie/CSRF，不接受 `--no-open`、全局 `--core`/`--json`、重复/非法端口及其他参数；help 与语法校验先于 I/O。实例选择、缺失/权限/通道失败的退出码沿用 CLI-DESKTOP-002。

实例 SHALL 先撤销捕获平台身份的本地内容访问，再对捕获的 Core 会话进行至多五秒的远端注销尝试并条件清理其保存凭证。远端已撤销/已无效或原本无平台登录时 exit 0；本地清理确认但远端不可达、响应未知或凭证清理失败时 exit 5，明确分别结果和安全恢复方向；不可把超时写成远端注销成功。条件清理不得删除另一个进程随后保存的不同凭证。命令不改变本地控制会话、实例监听及任何 Work/Run/Operation 运行目标，不提供不加区分的配置文件删除。

保存凭证清理失败时 SHALL 保留原会话的有界重试上下文；再次执行 logout 继续条件清理该原会话，不能因为内存已 signed-out 而宣称磁盘清理完成。没有待清理记录的空身份注销只确认当前无平台登录，不追认之前未确认的远端撤销。

保存凭证仍待清理时，新的平台登录或切换 Core SHALL 被明确的清理未完成结果拒绝并保留输入，提示执行原实例 logout 后再继续；不能丢弃待清理记录、覆盖它或删除另一 CLI 新保存的会话。

#### Scenario: 浏览器授权丢失后注销
- **WHEN** 浏览器已关闭或 Cookie 已清除，系统用户执行实例 logout
- **THEN** 指定实例的旧平台身份及内容授权失效，随后普通地址可进入正常账号登录，无需 open 或重新授权；其他端口实例不被直接清理

#### Scenario: Core 离线与重复清理
- **WHEN** 平台注销响应不可确认，或已无平台登录再次 logout
- **THEN** 前者报告本地清理和远端未确认且 exit 5，后者 exit 0；均保持实例可重新打开，不假造远端成功

#### Scenario: 并发保存新凭证
- **WHEN** 注销旧会话期间另一个 CLI 写入新登录
- **THEN** 仅条件清理原会话，保留新凭证，不将其 token 或其他内容写入输出

### Requirement: Go 客户端转发当前模型与处理记录并保留原身份

**Identifier:** CLI-BRAIN-001

用户 CLI 和 Desktop 本地后端 SHALL 使用 Go Core 的当前模型、Session/Run 来源、请求和证据接口；公开投影 SHALL 排除平台密钥与内部路径。既有 chat 命令的参数和单槽语义保持，省略模型选择时遵循 Session 偏好；本次不新增自动流程顶层命令。Run 查询 SHALL 能报告真实模型和来源。

Desktop 本地后端 SHALL 按当前 Core/账号/Work 验证请求、转发模型偏好和请求取消/重试、分页读取证据，并沿用自动建立的普通浏览器会话、CSRF、凭证并发及原 ID 记录规则，不增加浏览器 Access 门禁。接受结果与后续读取分开；断线、导航、身份变化不隐式取消或重复提交。未知修改只能核对原对象。

#### Scenario: Desktop 与 CLI 查询同一 Run
- **WHEN** Desktop 选择模型并提交后，所有者使用 Go CLI 按原 Run ID 查询
- **THEN** 两个入口报告相同实际模型、来源与状态，不取得模型 secret

#### Scenario: 接受后刷新失败
- **WHEN** 本地入口已取得原 Run/请求/Operation 回执但关联读取失败
- **THEN** 原 ID 与接受事实保留，只提供原对象查询恢复，不自动重发修改

#### Scenario: 身份改变时晚返回
- **WHEN** 请求在旧 Core/账号下发出，返回前用户切换身份
- **THEN** 旧内容不进入新身份、不释放新动作的锁，同身份已接受结果仍可按原 ID 找回

### Requirement: 显式容器模式兼容本机发布端口

**Identifier:** CLI-CONTAINER-001

CLI SHALL 仅在 `PIWORK_CLI_CONTAINER_MODE=1` 时启用容器模式；未设置、空值或 `0` 保持原生模式。需要解析该模式的 Desktop/proxy/open 入口遇到其他值 SHALL 在本地资源/网络操作前返回 usage exit 2；help/version 和普通不使用本地监听/浏览器的业务命令不因此改变。

容器模式 Desktop/proxy SHALL 监听容器内 `0.0.0.0`，公开 URL 继续使用同机 `desktop.localhost` 或既有 `127.0.0.1` proxy/WebDAV 地址，内外端口一致；原生模式保持原 loopback 监听。本机 Host、Origin、CSRF、自动建立的普通浏览器会话、WebDAV 临时 Basic 和平台鉴权 SHALL 保持；Desktop 不要求启动票据或本机浏览器授权。proxy 对端可来自 Docker 转发路径，不依据该模式信任请求中的 Forwarded/X-Forwarded-*，PAC 和文件入口依然限定准确本地 Host，拒绝跨站来源。容器模式只适用于宿主 loopback 发布和可信本地 Docker 管理者，不承诺独立容器网络的其他参与者可信，也不作为开放网络代理。

#### Scenario: Windows Desktop 端口转发
- **WHEN** Linux CLI 容器开启容器模式，宿主将 17891 仅发布到 127.0.0.1
- **THEN** 同机 Windows 浏览器可直接打开普通地址，复用有效共享登录或进入正常账号登录，不因 Docker 转发后的 TCP 对端不是 loopback 而拒绝正常入口

#### Scenario: 未开启容器模式的原生 CLI
- **WHEN** 原生 CLI 不设置此 env，或设置为 0
- **THEN** 本地监听仍仅绑定 127.0.0.1，原有 proxy loopback 对端限制及浏览器打开行为保持

#### Scenario: 伪造本地来源
- **WHEN** 请求使用错误 Host/跨站 Origin，或通过 Forwarded/X-Forwarded-* 伪造 loopback
- **THEN** 来源校验拒绝，不创建普通浏览器会话、不借用平台 token、不转发文件请求

#### Scenario: 无效模式与帮助
- **WHEN** 模式值为 true 或 2 时执行 Desktop/proxy 启动，随后只请求 help/version
- **THEN** 前者 exit 2 且无监听/资源副作用，后者按既有无 I/O 帮助/版本契约成功

### Requirement: 在运行容器内重新打开与清理 Desktop

**Identifier:** CLI-CONTAINER-DESKTOP-001

容器模式 Desktop 启动 SHALL 不尝试打开容器内浏览器；主进程 stdout/stderr SHALL 输出宿主本机可直接打开的普通 origin，不输出入口 ticket、Core token 或密码。发行说明 SHALL 直接引导宿主浏览器访问该地址，不要求 `docker exec` 或 `desktop open` 取得授权。普通合法来源自动建立必要会话，并按同 Core 的有效共享 CLI 凭据或正常账号登录继续。容器内 `desktop open --no-open` 继续作为可选地址发现操作，返回同一普通地址。

容器内 open/logout SHALL 使用已有同用户私有控制通道、实例绑定和退出语义；执行方必须在目标 Desktop 容器中且使用同一有效 UID。另起仅共享凭证卷的容器不得因此成为目标实例的控制调用者。重新创建容器后 SHALL 创建新的控制实例身份，旧控制路径和普通浏览器会话不用于新实例；新页面会话自动建立，平台保存凭据按原规则继续可用。服务健康检查 SHALL 不创建浏览器会话、不修改账号状态，不需要 Core 在线。

#### Scenario: 正常启动并手动打开
- **WHEN** CLI 容器主进程启动 Desktop，用户在宿主浏览器打开输出的普通地址
- **THEN** 无需额外 exec/open 命令即可正常登录或使用有效共享 Core 登录，主日志不含 token 或授权 ticket

#### Scenario: 链接过期或丢失
- **WHEN** 用户没有旧启动链接但 CLI 容器仍运行，或在同容器执行 open --no-open
- **THEN** 可直接打开普通 origin，open 也只返回普通地址；其他容器的 open 不能控制该实例，浏览器不出现 Access 门禁

#### Scenario: 无浏览器 Cookie 注销
- **WHEN** 用户在目标容器中执行 desktop logout
- **THEN** 按原实例注销契约撤销旧平台内容授权、尝试远端注销和条件清理，不停止 Work/Run/Operation

#### Scenario: 主进程重建
- **WHEN** 用户保留状态卷并重建 CLI 容器，再打开普通地址
- **THEN** 自动建立当前实例的普通浏览器会话，保存登录按原规则核验并继续，不能复用旧控制实例身份，也不需要新的授权链接
