# Spec Delta

## ADDED Requirements

### Requirement: 显式容器模式兼容本机发布端口

**Identifier:** CLI-CONTAINER-001

CLI SHALL 仅在 `PIWORK_CLI_CONTAINER_MODE=1` 时启用容器模式；未设置、空值或 `0` 保持原生模式。需要解析该模式的 Desktop/proxy/open 入口遇到其他值 SHALL 在本地资源/网络操作前返回 usage exit 2；help/version 和普通不使用本地监听/浏览器的业务命令不因此改变。

容器模式 Desktop/proxy SHALL 监听容器内 `0.0.0.0`，公开 URL 继续使用同机 `desktop.localhost` 或既有 `127.0.0.1` proxy/WebDAV 地址，内外端口一致；原生模式保持原 loopback 监听。本机 Host、Origin、CSRF、浏览器会话/启动票据、WebDAV 临时 Basic 和平台鉴权 SHALL 保持。proxy 对端可来自 Docker 转发路径，不依据该模式信任请求中的 Forwarded/X-Forwarded-*，PAC 和文件入口依然限定准确本地 Host，拒绝跨站来源。容器模式只适用于宿主 loopback 发布和可信本地 Docker 管理者，不承诺独立容器网络的其他参与者可信，也不作为开放网络代理。

#### Scenario: Windows Desktop 端口转发
- **WHEN** Linux CLI 容器开启容器模式，宿主将 17891 仅发布到 127.0.0.1
- **THEN** 同机 Windows 浏览器可访问 Desktop 并完成既有本地授权，不因 Docker 转发后的 TCP 对端不是 loopback 而拒绝正常入口

#### Scenario: 未开启容器模式的原生 CLI
- **WHEN** 原生 CLI 不设置此 env，或设置为 0
- **THEN** 本地监听仍仅绑定 127.0.0.1，原有 proxy loopback 对端限制及浏览器打开行为保持

#### Scenario: 伪造本地来源
- **WHEN** 请求使用错误 Host/跨站 Origin，或通过 Forwarded/X-Forwarded-* 伪造 loopback
- **THEN** 本地授权拒绝，不创建浏览器会话、不借用平台 token、不转发文件请求

#### Scenario: 无效模式与帮助
- **WHEN** 模式值为 true 或 2 时执行 Desktop/proxy 启动，随后只请求 help/version
- **THEN** 前者 exit 2 且无监听/资源副作用，后者按既有无 I/O 帮助/版本契约成功

### Requirement: 在运行容器内重新打开与清理 Desktop

**Identifier:** CLI-CONTAINER-DESKTOP-001

容器模式 Desktop 启动 SHALL 不尝试打开容器内浏览器；主进程 stdout/stderr SHALL 只显示安全 origin 和执行 `desktop open --no-open` 的方向，不输出启动 ticket、Core token 或密码。发行说明 SHALL 使用同一个正在运行的 CLI 容器中的 `piwork-cli desktop open --no-open` 获取一次性链接；链接仅经本次可信调用返回，不写入主容器常规日志。匿名打开安全 origin 不得继承保存的 Core 身份。

容器内 open/logout SHALL 使用已有同用户私有控制通道、实例绑定和退出语义；执行方必须在目标 Desktop 容器中且使用同一有效 UID。另起仅共享凭证卷的容器不得因此成为目标实例的控制调用者。重新创建容器后 SHALL 创建新的实例授权，旧控制路径/票据/浏览器会话不得赋予新实例权限；平台保存凭证按原规则继续可用。服务健康检查 SHALL 不签发/兑换 ticket，不需要 Core 在线。

#### Scenario: 正常启动并手动打开
- **WHEN** CLI 容器主进程启动 Desktop，用户随后在同容器 exec open --no-open
- **THEN** 主日志只有安全入口；exec 返回五分钟一次性链接，用户在宿主浏览器兑换后可登录 Core

#### Scenario: 链接过期或丢失
- **WHEN** 用户没有可用启动链接但 CLI 容器仍运行
- **THEN** 同容器 open 返回新链接且保留已授权会话，其他容器的 open 找不到该实例，不能通过匿名 HTTP 恢复

#### Scenario: 无浏览器 Cookie 注销
- **WHEN** 用户在目标容器中执行 desktop logout
- **THEN** 按原实例注销契约撤销旧平台内容授权、尝试远端注销和条件清理，不停止 Work/Run/Operation

#### Scenario: 主进程重建
- **WHEN** 用户保留状态卷并重建 CLI 容器
- **THEN** 保存登录按原规则读取，旧浏览器实例授权不可续用，新的 open 链接可重新授权

## MODIFIED Requirements

### Requirement: 启动有界的 CLI 本地服务代理

**Identifier:** CLI-SERVICE-PROXY-001

`piwork-cli [--core <url>] proxy [--port <1..65535>]` SHALL 在原生模式前台监听`127.0.0.1`，默认17890；显式容器模式按 CLI-CONTAINER-001 监听容器内地址并保留宿主本机入口；启动前核验语法、当前用户凭证和Core service网关能力，并探测独立文件能力。Core URL SHALL 接受合法 HTTP 或 HTTPS origin，遵守 CLI-CORE-PROTOCOL-001，不因远程 HTTP 拒绝启动。启动成功 SHALL 输出代理地址、`/proxy.pac` URL及CLI-FILES-001规定的WebDAV信息；PAC SHALL 仅让符合默认Work域名形状的http/ws目标使用代理，其他目标DIRECT。

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

#### Scenario: HTTP Core 支持原代理网络路径
- **WHEN** 当前用户已登录 HTTP Core，service 网关能力可用，并启动 proxy
- **THEN** 原 HTTP、WebSocket、PAC 与可用 WebDAV 路径均可通过同一代理访问；仍拒绝非许可 Service 目标和开放 CONNECT，监听及本地临时凭证契约不变

#### Scenario: HTTP 不能绕过鉴权及能力检查
- **WHEN** HTTP Core 拒绝当前会话或必需 service 网关不可用
- **THEN** 分别按原 auth/网络失败契约退出，不留下半启动代理；文件能力缺失仍仅降级文件分支

### Requirement: 启动本地 Desktop WebUI

**Identifier:** CLI-DESKTOP-001

`piwork-cli [--core <url>] desktop [--port <1..65535>] [--no-open]` 及全局参数解析成功、无子命令且没有 `--json` 时的默认 Desktop 入口 SHALL 在原生模式前台启动仅监听 `127.0.0.1` 的本地 WebUI，默认端口 17891；原生模式默认打开系统浏览器，`--no-open` 仅输出本地打开地址。显式容器模式 SHALL 按 CLI-CONTAINER-001 提供宿主本机入口，并按 CLI-CONTAINER-DESKTOP-001 输出安全启动信息和取得启动链接。地址 SHALL 使用受验证的 localhost 主机名；原生模式本机无需 Docker，容器交付使用已安装的 Docker；两种模式的本地 WebUI 均无需代理/PAC、hosts 编辑或安装本地站点证书。Desktop Core 地址 SHALL 按显式 `--core`、`PIWORK_CORE_URL`、保存的 Desktop 默认地址、凭证 Core、`http://127.0.0.1:7171` 的优先级选择；参数与环境仅覆盖本次调用，普通业务命令仍按原地址优先级且不读取 Desktop 偏好；Core 可以使用合法 HTTP 或 HTTPS origin，不按目标位置限制 HTTP，遵守 CLI-CORE-PROTOCOL-001。无登录或 Core 暂不可达 SHALL 仍可打开登录/连接页面和本地包 Inspect，不能借用其他 Core 的 token。

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

### Requirement: 可信本机命令重新打开既有 Desktop

**Identifier:** CLI-DESKTOP-002

`piwork-cli desktop open [--port <1..65535>] [--no-open]` SHALL 连接同一系统用户拥有的既有 Desktop，默认端口 17891，不新建监听实例、不连接 Core、不读取平台凭证、不改变该实例当前 Core。成功输出当前本机启动链接，原生模式默认打开浏览器；`--no-open` 只打印链接。显式容器模式不尝试打开容器内部浏览器，链接及 exit 0 仍返回当前调用者；发行说明要求使用 `--no-open` 并在宿主浏览器手动打开。恢复不依赖调用命令的工作目录、`PIWORK_CONFIG_PATH` 或 Core 环境配置。该形式不接受全局 `--core` 或 `--json`、未知 flag、重复 flag、额外参数及非法端口；语法错误 exit 2，help exit 0 均先于文件/网络操作。

每次成功 open SHALL 签发五分钟内有效的一次性启动 ticket，更新尚未兑换的旧 ticket；既有浏览器会话保持有效。成功 exit 0，浏览器打开失败仍输出手动链接并 exit 0；实例不存在或已退出 exit 4，本机通道权限/安全校验拒绝 exit 3，协议不兼容或超时 exit 5。错误 stdout 为空，stderr 提供安全原因与下一步，不输出秘密、堆栈或任意路径；没有实例时不自动启动另一实例。

票据可兑换的正常响应丢失时 SHALL 按实际会话恢复，不无限兑换；过期、错误或重放票据继续拒绝。启动与 open 的票据仅在主动请求者的启动输出/打开地址中呈现，不进入普通诊断日志、Work 或持久凭证。Ctrl+C 结束 open 的本地等待不终止服务实例；原 `desktop` 的端口占用 exit 6 保持。

同一实例的有效浏览器本地会话 SHALL 最多 128 个，绝对期限十二小时；注册前清理过期会话，容量满返回 503 LOCAL_SESSION_CAPACITY，不驱逐有效会话、不消费本次 ticket。界面 SHALL 提示结束不再使用的浏览器授权或经确认重置全部浏览器访问，不弱化 Cookie/来源安全约束。

#### Scenario: 运行中的实例重新授权
- **WHEN** 当前 Desktop 已运行且旧链接失效，用户执行 open 并打开新链接
- **THEN** 原 PID、端口和 Core 保持，新链接可兑换，已有浏览器可继续访问，不需要平台登录凭证才能执行命令

#### Scenario: 自定义端口且环境配置不同
- **WHEN** 从不同目录及不同凭证/Core 环境执行 open --port 指向既有实例
- **THEN** 只重新打开该端口的同用户实例，不读取损坏凭证、不切换 Core、不尝试新的 TCP 监听

#### Scenario: 多次签发与票据重放
- **WHEN** 连续执行两次 open，或重放已经兑换的票据
- **THEN** 只有最新未兑换票据可用，已授权浏览器不被撤销，旧票据和重放均被拒绝

#### Scenario: 未运行、错误参数或打开浏览器失败
- **WHEN** 实例不存在、参数非法或系统浏览器无法启动
- **THEN** 分别返回 exit 4、exit 2 或带手动地址的 exit 0；均不创建后台副本、停止 Work 或泄漏平台 token

#### Scenario: 浏览器会话容量边界
- **WHEN** 有效会话达到 128 个，或注册时存在已过期会话
- **THEN** 分别拒绝新增并保留 ticket/有效会话，或先回收过期项再正常注册；错误有重置方向且不向匿名浏览器泄漏账号
