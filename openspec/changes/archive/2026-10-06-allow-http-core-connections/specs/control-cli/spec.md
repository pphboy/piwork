# Spec Delta

## ADDED Requirements

### Requirement: 用户客户端统一接受 HTTP(S) Core origin

**Identifier:** CLI-CORE-PROTOCOL-001

用户客户端 SHALL 对普通业务命令、默认及显式 Desktop、Desktop 当前连接切换、默认 Core 保存/读取及 proxy 使用一致的 Core 协议准入：合法 HTTP 与 HTTPS origin 均可作为目标，不因目标是 loopback、局域网、公网、IP 或域名而拒绝 HTTP。该行为 SHALL 在 Windows 与 Linux 一致，不要求额外 flag、环境变量或确认步骤，不自动将 HTTP 改写为 HTTPS。

Core origin SHALL 沿用既有地址语法和规范化规则，拒绝缺失 scheme/host、不支持的协议、userinfo、非根路径、query、fragment 等非法地址。CLI 参数语法、帮助/版本/空 JSON 提前返回、地址优先级及无效高优先级地址不回退的契约 SHALL 保持。HTTP 地址不再属于协议准入错误；网络不可达、鉴权失败和服务端错误 SHALL 按原命令的失败/退出码契约处理。

用户选择 HTTPS 时，客户端 SHALL 继续验证系统信任、证书有效性和目标主机名，不跳过校验、不自动回退 HTTP。凭证 SHALL 继续按包含 scheme、host 和 port 的 Core origin 绑定；从 HTTPS 改为 HTTP 或反向修改 SHALL 不复用另一 origin 的 token，即使 IP 和端口相同。客户端 SHALL 不自动更改系统证书或代理配置。

#### Scenario: 远程 HTTP 地址适用于所有客户端入口
- **WHEN** 用户以合法远程 HTTP Core origin 调用普通命令、默认/显式 Desktop 或已登录的 proxy
- **THEN** 客户端按原命令流程执行，不返回远程 HTTP usage 错误，不要求额外许可，不改写地址；Windows 与 Linux 一致

#### Scenario: 地址来源不影响 HTTP 准入
- **WHEN** 合法 HTTP Core 分别来自参数、环境、Desktop 默认配置或原凭证
- **THEN** 按所属入口的原优先级选择该地址，不因来源或 HTTP 协议回退至其他 Core；业务 CLI 仍不读取 Desktop 偏好

#### Scenario: 非法地址仍被拒绝
- **WHEN** 用户提供空值、缺失 scheme/host、其他协议、userinfo、非根路径、query 或 fragment
- **THEN** 沿用该入口原校验错误；CLI 地址错误 exit 2，Desktop 连接或偏好输入错误返回本地 400，UI 保留编辑值；损坏的已存偏好仍按原存储失败处理，不静默回退

#### Scenario: HTTP 与 HTTPS 的凭证独立
- **WHEN** 已存凭证属于 HTTPS origin，用户选择同 host/port 的 HTTP origin，或反向选择
- **THEN** 不向新 origin 发送旧 token，Desktop 显示新 origin 的真实登录状态；同一 origin 的正常凭证复用仍可用

#### Scenario: HTTPS 校验失败保持失败
- **WHEN** 选择 HTTPS Core，而证书不受信任、过期或目标主机名不匹配
- **THEN** 连接按原网络错误契约失败，不发送应用层登录或业务内容，不关闭证书校验，不改连 HTTP

#### Scenario: HTTP Core 不可达
- **WHEN** 选定 HTTP Core 不可达
- **THEN** 普通命令/proxy 按原网络失败返回，Desktop 仍可显示连接恢复页及本地 Inspect；不把网络失败描述为不允许 HTTP，不重提修改

## MODIFIED Requirements

### Requirement: 启动本地 Desktop WebUI

**Identifier:** CLI-DESKTOP-001

`piwork-cli [--core <url>] desktop [--port <1..65535>] [--no-open]` 及符合 CLI-DEFAULT-001 的默认入口 SHALL 在前台启动仅监听 `127.0.0.1` 的本地 WebUI，默认端口 17891；默认打开系统浏览器，`--no-open` 仅输出本地打开地址。地址 SHALL 使用受验证的 localhost 主机名；本机无需 Docker、代理/PAC、hosts 编辑或安装证书。Core 地址 SHALL 按本规范的 Desktop 优先级选择；Core 可以使用合法 HTTP 或 HTTPS origin，不按目标位置限制 HTTP，遵守 CLI-CORE-PROTOCOL-001。无登录或 Core 暂不可达 SHALL 仍可打开登录/连接页面和本地包 Inspect，不能借用其他 Core 的 token。

启动前 SHALL 校验参数；未知参数、重复或非法端口、显式 Desktop 的 `--json` 返回 exit 2；端口占用返回 exit 6，资源缺失或监听失败返回 exit 5，不自动换端口或遗留半启动监听器。浏览器打开失败 SHALL 保持服务并打印手动打开地址；`--help` 不读取凭证或偏好、不启动监听、不访问网络。Ctrl+C SHALL 关闭本地连接、清理本次临时资源并退出 130，不停止 Work、不取消已经接受的 Core Operation/Run。平台会话失效 SHALL 回到登录状态而不退出 WebUI。既有 `proxy` 默认 17890、PAC、临时 WebDAV 密码及退出语义 SHALL 不变；Desktop 不要求先启动 proxy。

#### Scenario: 无登录的一键启动
- **WHEN** 用户首次运行默认入口或显式 desktop 且没有保存凭证
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

### Requirement: 启动有界的 CLI 本地服务代理

**Identifier:** CLI-SERVICE-PROXY-001

`piwork-cli [--core <url>] proxy [--port <1..65535>]` SHALL 在前台监听`127.0.0.1`，默认17890；启动前核验语法、当前用户凭证和Core service网关能力，并探测独立文件能力。Core URL SHALL 接受合法 HTTP 或 HTTPS origin，遵守 CLI-CORE-PROTOCOL-001，不因远程 HTTP 拒绝启动。启动成功 SHALL 输出代理地址、`/proxy.pac` URL及CLI-FILES-001规定的WebDAV信息；PAC SHALL 仅让符合默认Work域名形状的http/ws目标使用代理，其他目标DIRECT。

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
