## MODIFIED Requirements

### Requirement: Report Core and Work-runtime status

piwork-cli status SHALL 查询用户可见的 Core 健康与 Work runtime 状态并隐藏 secret。Core 初始化和准备状态由网页及既有状态 API 展示，不再提供独立 operator status 命令。

#### Scenario: Report an empty Core

- **WHEN** Core 正在运行但尚未创建管理员
- **THEN** 网页显示 ADMIN_REQUIRED，`piwork-cli status` 仍能显示健康但不得假装用户已登录

#### Scenario: Report a ready Core

- **WHEN** Core and its Work runtime are ready
- **THEN** `piwork-cli status` reports both as ready and exits with status 0

#### Scenario: Report unavailable Docker

- **WHEN** Core is reachable but its Docker dependency is unavailable
- **THEN** `piwork-cli status` identifies the runtime dependency as unavailable and exits nonzero without a stack trace

### Requirement: Log in and persist credentials safely

`piwork-cli login` SHALL 接受账号，通过隐藏输入或标准输入获取密码；成功后持久保存包含 Core URL、token、到期时间与公开身份的版本化记录。POSIX 凭证父目录 SHALL 仅允许当前用户访问，凭证文件 SHALL 为 `0600`，符号链接等不安全目标 MUST 拒绝。`piwork-core` 不提供用户 login，不读取该用户凭证文件。

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
- **WHEN** 用户执行 `piwork-core login`
- **THEN** 命令以 usage 错误退出，不读取用户凭据或联系用户登录端点

### Requirement: Create and control Works from the CLI

**Identifier:** CLI-WORK-001

`piwork-cli` SHALL provide Work lifecycle, `work config show`, `work config set`, field-specific configuration commands, and explicit `work config apply` without public revision arguments. `work create` SHALL accept `--base-image <image>`, repeatable `--skill <skill-name>`, `--no-skills`, `--agents-md-file <path>`, and `--config <file>`. If neither Skill option nor a `skills` field is supplied, Core SHALL copy the current default Work Skill selection; explicit Skill flags SHALL replace defaults and a configuration-file selection, while `--no-skills` SHALL select an empty set. The CLI SHALL reject duplicate names and mutually exclusive Skill options before contacting Core. Core SHALL copy selected managed Skill directories, AGENTS content, and the resolved configuration into Work-owned storage before reporting successful creation. `piwork-core` 命令行 MUST NOT 提供用户 Work 操作子命令；Core 的 Work API 和领域能力保持。

SDK-invalid imported Skill bytes SHALL be diagnosed asynchronously during required initialization rather than rejected as a CLI syntax error. Both `work config set <workId> --config <file>` and `work config skills set <workId>` SHALL update desired state consistently; omitted fields in field-specific commands SHALL preserve unrelated desired fields. `--no-skills` SHALL be parsed as a boolean flag on create and per-Work Skill set. Missing selection on the field-specific Skill-set command SHALL be a usage error, not implicit clearing. `work config apply <workId> [--wait] [--idempotency-key <key>]` SHALL report acceptance immediately unless waiting was requested and use the same durable Operation observation behavior as create/start.

work create SHALL 额外支持重复 --package <name> 或互斥 --no-packages，优先于配置文件 packages 与默认集合；重复/空 name 或矛盾选项在 auth/file/network 前拒绝。work config set 同样支持该选择，对已存在 Work 只引用自身 desired 已安装包；flags 选中项 enabled=true，其他字段省略保留，disabled 可用专用命令或完整配置表示。包安装与 apply 分离，create --wait 的成功仍要求最终完整 context ready。

#### Scenario: Create from the current default
- **WHEN** 用户运行 `piwork-cli work create --name <name> --wait` without a Skill selection
- **THEN** the Work receives independent copies of the current default Skills and other effective context, and later default or managed-Skill changes do not alter it

#### Scenario: Create with explicit Skills
- **WHEN** a user supplies one or more `--skill <skill-name>` options
- **THEN** the Work receives exactly those enabled managed Skills in the supplied order, replacing the default or configuration-file selection

#### Scenario: Create with per-Work context overrides
- **WHEN** a user supplies base image, Skills, AGENTS content, or a configuration file while creating a Work
- **THEN** explicit CLI fields take precedence over the corresponding configuration-file and default fields, and Core copies the resulting complete context into the new Work

#### Scenario: Create with no Skills
- **WHEN** a user supplies `--no-skills`
- **THEN** the Work is created with an empty Skill directory and does not inherit default Skills

#### Scenario: Reject invalid create context
- **WHEN** a create request repeats a Skill, combines `--skill` with `--no-skills`, names a missing or disabled Skill, or supplies a missing, unreadable, or oversized AGENTS file
- **THEN** the CLI exits with a usage or validation error, no Work becomes visible, no partial Work context remains, and no secret or host path is disclosed

#### Scenario: Update one Work only
- **WHEN** a user changes Work A configuration without an expected-revision argument
- **THEN** only Work A's desired context changes, later successfully committed updates replace earlier desired values, and other Works and global defaults remain unchanged

#### Scenario: Set Skills and AGENTS independently
- **WHEN** an owner invokes `work config skills set <workId> --skill <name>...`, `work config skills set <workId> --no-skills`, or `work config agents set <workId> --file <path>`
- **THEN** Core copies the requested content into that Work's desired context, preserves unrelated fields, and leaves the running active context unchanged

#### Scenario: Apply pending Work configuration explicitly
- **WHEN** an owner invokes `piwork-cli work config apply <workId>`
- **THEN** the CLI submits one apply operation for the desired context captured at acceptance, reports its stable Operation identifier, and does not require a revision or silently cancel an active Run

#### Scenario: Apply a pending Work configuration explicitly
- **WHEN** an owner invokes `piwork-cli work config apply <workId>` while `pendingApply` is true
- **THEN** the CLI applies the desired context captured by that Operation without an expected-revision option and reports the durable Operation state

#### Scenario: Create and wait for a ready Work
- **WHEN** a logged-in user invokes `piwork-cli work create --name <name> --wait` against a configured installation
- **THEN** the CLI returns the stable Work identifier, follows its Operation, and exits successfully only after the Work-owned context is mounted and agentd is ready

#### Scenario: Show a Work preparation failure
- **WHEN** Docker, the image, model configuration, or agent readiness causes an accepted create Operation to fail
- **THEN** the CLI displays the stable Work and Operation identifiers plus a safe actionable failure and exits nonzero

#### Scenario: Stop and restart one Work
- **WHEN** an owner stops a ready Work and later starts it with `--wait`
- **THEN** the CLI observes both Operations and the Work becomes ready again with its retained Work-owned context and data

#### Scenario: Clear Skills through the documented flag
- **WHEN** the owner uses `work config skills set <workId> --no-skills` and successfully applies
- **THEN** desired and active Skills become empty, the ready runtime reports no loaded Skills, and AGENTS/model/image/tool fields are preserved

#### Scenario: Set Skills through configuration JSON
- **WHEN** the owner supplies a valid configuration file with skills [s-a] to the generic set command
- **THEN** it produces the same desired Skill snapshot and pending state as the field-specific set command with s-a, without changing active Skills before apply

#### Scenario: SDK-invalid creation is an Operation failure
- **WHEN** an enabled managed Skill has bytes that pass Core tree validation but fail SDK loading
- **THEN** create returns the accepted Work and Operation, initialization fails before ready, and `--wait` shows the Skill error with those identifiers and exits 6

#### Scenario: Repeated apply key
- **WHEN** a caller repeats an apply with the same idempotency key
- **THEN** the CLI receives the original Operation and reused true, without causing another initialization

#### Scenario: Create from package defaults
- **WHEN** 用户不提供 package flags 或配置字段创建 Work
- **THEN** 继承当时默认包的独立副本，不持续跟随 Core

#### Scenario: Override package selection
- **WHEN** 用户提供 --package tools 或 --no-packages
- **THEN** 分别替换为 tools 或 []，不与文件/defaults 合并

#### Scenario: Reject duplicate package flags before I/O
- **WHEN** 用户重复同名 --package 或与 --no-packages 同用
- **THEN** exit 2 且不读取凭证、本地文件或发起网络请求

### Requirement: Create and continue persistent conversations

**Identifier:** CLI-CHAT-001

`piwork-cli` SHALL independently provide login, Session, Run, Work configuration, and chat commands; `piwork-core` MUST NOT provide user conversation commands. The user client's credential file and operator credential file MUST remain separate. A chat request SHALL use the Work's active copied context, including active Skills, AGENTS content, base image, model, and tool policy, and SHALL report `pendingApply` rather than applying desired changes implicitly or exposing a configuration revision.

#### Scenario: Continue a Work conversation
- **WHEN** 用户使用 `piwork-cli chat <workId>` 发送消息
- **THEN** CLI 使用用户会话访问其拥有的 Work，并返回持久化 Run 结果

#### Scenario: Send one scripted message
- **WHEN** a user invokes `piwork-cli chat <workId> --message <text>` for a ready Work
- **THEN** the CLI creates or selects a Session, submits exactly one Run, displays the assistant reply, and exits according to the Run terminal state

#### Scenario: Continue an existing Session
- **WHEN** a user invokes chat with a previously returned Session identifier after Core or agentd has restarted
- **THEN** the prompt is added to the same restored Pi SDK history and the reply is associated with that Session

#### Scenario: Chat while configuration is pending
- **WHEN** a Work has a desired context different from its active context and a user sends a prompt
- **THEN** the CLI uses the active context, reports `pendingApply: true`, and does not change the running context as a side effect of chat

#### Scenario: Interrupt an active chat explicitly
- **WHEN** the user presses the documented cancellation key while observing an active Run
- **THEN** the CLI requests Run cancellation, waits for or reports its durable state, and does not treat a mere transport disconnect as cancellation

### Requirement: Provide stable output and failure behavior

**Identifier:** CLI-OUTPUT-001

piwork-cli SHALL 保留稳定帮助和退出码，区分未登录、Core不可用、Skill不可用、Work不可用和Run失败。任何输出不得包含用户登录密码、平台bearer token、operator credential、模型API key、secret path、Skill import path或internal digest。唯一的密码展示例外是统一proxy成功启动时向启动者一次显示本进程随机生成的WebDAV本地临时密码；该值不得进入URL、PAC、普通日志、错误或后续请求输出，不得持久写入平台登录文件或Work。Work配置命令 SHALL 返回稳定Work/Operation身份及active/desired/pending状态，不返回公开revision。

#### Scenario: Reject a command on the wrong CLI
- **WHEN** 用户在`piwork-cli`执行operator Skill mutation或admin users，或用`piwork-core`进行chat
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
- **WHEN** 用户向单Work配置命令传入`--expected-revision`
- **THEN** CLI返回说明无revision命令格式的usage错误，不联系Core

#### Scenario: Reject invalid command input
- **WHEN** 缺少必需参数或选项不合法
- **THEN** CLI向stderr打印相关usage并按规定退出，不联系Core

#### Scenario: 只展示本地临时密码
- **WHEN** proxy成功启动并显示WebDAV连接信息
- **THEN** 仅启动输出含本次本地密码，Core登录token和其他平台秘密始终不出现，后续日志不重复记录密码

### Requirement: Keep snapshot output and existing commands compatible

**Identifier:** CLI-SNAPSHOT-002

JSON 模式 SHALL 对每个成功命令输出恰好一个对象：inspect 为 WSNAP-002 安全摘要；export/download 为 `{workId,snapshotId,operationId,path,digest,size}`；import 非 wait 为 `{workId,name,operationId,correlationId,reused}`；import wait 为既有终态 Operation envelope 加目标 name，export waiting 额外带 snapshotId。text 模式用可读摘要/缩进 JSON，进度与敏感内容警告只写 stderr。相对于旧“internal digest 不公开”的限制，新 digest 仅指用户包校验 hash，不暴露平台 context identity。

syntax/local file exit 2；缺登录/401/403 exit 3；404 exit 4；网络、503、transfer/观察超时 exit 5；409、已接受任务 failed/superseded exit 6；包校验400/413、不兼容、目标模型或自定义外部 MCP 凭证不可用与410 exit 1；成功 exit 0。接受前错误 stdout 为空，且 stderr SHALL 显示安全的错误 code 与可执行处理方向；不能仅输出 `Work snapshot request cannot be accepted`。接受后观察失败输出带 ID 的 waiting；校验过的包下载后本地发布失败也必须在安全错误中保留 snapshotId。用户 Work/service/chat 和通用 operation show 行为 SHALL 不变，不新增 service create/update。

#### Scenario: One JSON result
- **WHEN** --json work export 完成接受、观察、下载
- **THEN** stdout 只有最终文件结果，早期 acceptance/进度/警告不污染 JSON

#### Scenario: Preserve service boundary
- **WHEN** 用户运行 work service create 或 update
- **THEN** 仍是 usage error，本变更仅支持作为整个包恢复服务定义

### Requirement: 用户客户端统一接受 HTTP(S) Core origin

**Identifier:** CLI-CORE-PROTOCOL-001

用户客户端 SHALL 对普通业务命令、默认及显式 Desktop、Desktop 当前连接切换、默认 Core 保存/读取及 proxy 使用一致的 Core 协议准入：合法 HTTP 与 HTTPS origin 均可作为目标，不因目标是 loopback、局域网、公网、IP 或域名而拒绝 HTTP。该行为 SHALL 在 Linux 各命令入口一致，不要求额外 flag、环境变量或确认步骤，不自动将 HTTP 改写为 HTTPS。

Core origin SHALL 沿用既有地址语法和规范化规则，拒绝缺失 scheme/host、不支持的协议、userinfo、非根路径、query、fragment 等非法地址。CLI 参数语法、帮助/版本/空 JSON 提前返回、地址优先级及无效高优先级地址不回退的契约 SHALL 保持。HTTP 地址不再属于协议准入错误；网络不可达、鉴权失败和服务端错误 SHALL 按原命令的失败/退出码契约处理。

用户选择 HTTPS 时，客户端 SHALL 继续验证系统信任、证书有效性和目标主机名，不跳过校验、不自动回退 HTTP。凭证 SHALL 继续按包含 scheme、host 和 port 的 Core origin 绑定；从 HTTPS 改为 HTTP 或反向修改 SHALL 不复用另一 origin 的 token，即使 IP 和端口相同。客户端 SHALL 不自动更改系统证书或代理配置。

#### Scenario: 远程 HTTP 地址适用于所有客户端入口
- **WHEN** 用户以合法远程 HTTP Core origin 调用普通命令、默认/显式 Desktop 或已登录的 proxy
- **THEN** 客户端按原命令流程执行，不返回远程 HTTP usage 错误，不要求额外许可，不改写地址；Linux 各命令入口一致

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

### Requirement: 启动有界的 CLI 本地服务代理

**Identifier:** CLI-SERVICE-PROXY-001

`piwork-cli [--core <url>] proxy [--port <1..65535>]` SHALL 在 Linux 前台监听`127.0.0.1`，默认17890；启动前核验语法、当前用户凭证和Core service网关能力，并探测独立文件能力。Core URL SHALL 接受合法 HTTP 或 HTTPS origin，遵守 CLI-CORE-PROTOCOL-001，不因远程 HTTP 拒绝启动。启动成功 SHALL 输出代理地址、`/proxy.pac` URL及CLI-FILES-001规定的WebDAV信息；PAC SHALL 仅让符合默认Work域名形状的http/ws目标使用代理，其他目标DIRECT。

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

`piwork-cli [--core <url>] desktop [--port <1..65535>] [--no-open]` 及全局参数解析成功、无子命令且没有 `--json` 时的默认 Desktop 入口 SHALL 在 Linux 前台启动仅监听 `127.0.0.1` 的本地 WebUI，默认端口 17891；默认打开系统浏览器，`--no-open` 仅输出本地打开地址。地址 SHALL 使用受验证的 localhost 主机名；本机无需 Docker，本地 WebUI 无需代理/PAC、hosts 编辑或安装本地站点证书。Desktop Core 地址 SHALL 按显式 `--core`、`PIWORK_CORE_URL`、保存的 Desktop 默认地址、凭证 Core、`http://127.0.0.1:17871` 的优先级选择；参数与环境仅覆盖本次调用，普通业务命令仍按原地址优先级且不读取 Desktop 偏好；Core 可以使用合法 HTTP 或 HTTPS origin，不按目标位置限制 HTTP，遵守 CLI-CORE-PROTOCOL-001。普通地址 SHALL 不含浏览器入口 ticket 或其他授权片段；来源合法的浏览器自动建立必要会话，复用同 Core 的有效共享 CLI 凭据或进入正常登录。无登录或 Core 暂不可达 SHALL 仍可打开登录/连接页面和本地包 Inspect，不能借用其他 Core 的 token，不要求终端重新授权。

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

### Requirement: 可信本机命令打开既有 Desktop 普通地址

**Identifier:** CLI-DESKTOP-002

`piwork-cli desktop open [--port <1..65535>] [--no-open]` SHALL 连接同一系统用户拥有的既有 Desktop，默认端口 17891，不新建监听实例、不连接 Core、不读取平台凭证、不改变该实例当前 Core。成功输出当前实例准确本机 origin 的普通地址，不含 ticket、证明或账号秘密；原生模式默认打开浏览器，`--no-open` 只打印地址。调用不依赖工作目录、`PIWORK_CONFIG_PATH` 或 Core 环境配置。该形式不接受全局 `--core` 或 `--json`、未知 flag、重复 flag、额外参数及非法端口；语法错误 exit 2，help exit 0 均先于文件/网络操作。

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

### Requirement: 平台私有状态与独立客户端交付

**Identifier:** CLI-PLATFORM-001

客户端 SHALL 支持 Linux 原生入口和任意工作目录，不依赖源码、相邻 WebUI、Go/Node/Python/Docker。Desktop 默认与显式入口按 --core、PIWORK_CORE_URL、独立偏好、凭证 Core、默认地址选择；业务 CLI 不读偏好。偏好保存/清除只影响后续启动，不切换连接或清凭据，响应未知先读回，损坏不静默回退。

凭证路径 SHALL 按 PIWORK_CONFIG_PATH、显式 XDG_CONFIG_HOME、平台 UserConfigDir 选择；帮助/版本/离线 inspect 不创建状态。偏好为独立 v1 文件和锁，最大 64 KiB。保留 Linux owner/0700/0600/flock，拒绝不安全权限、链接和额外硬链接，不自动放宽权限。并发原子发布只读旧/新完整内容，不承诺所有设备物理断电；缺少变更序号时核对摘要，不以大小/mtime 不变证明同字节。未知容量、身份或进程存活不授权上传/清理。

可信 desktop open/logout SHALL 使用私有实例控制并与 cwd、Core 环境及凭证路径无关，不接受 --core；Linux peer UID/Unix socket 隔离保持。端口占用 exit 6，不自动换端口；关闭浏览器不退出，Ctrl+C 有界收尾，强杀不保证回调。

Linux 本地来源与归档安全遵守 CLI-PORT-005；离线 .work 不解压执行。客户端构建 SHALL 固定 Go 1.25.5/Node 24/CGO=0，独立编译 Desktop 和 Linux 目标，真实 build.json 记录 commit/dirty/目标/摘要；候选与 Linux 实际运行通过分别记录。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

## ADDED Requirements

### Requirement: 原生用户客户端一致选择 Core 地址

系统 SHALL 提供 Linux 原生 piwork-cli 用户客户端。业务 Core 地址按显式 --core、PIWORK_CORE_URL、保存凭证中的 Core、默认 http://127.0.0.1:17871 的顺序解析。operator 身份与受保护 API 保留，但旧 operator 命令及其地址/env-file 解析 SHALL 删除。

默认或显式 Desktop 启动 SHALL 按显式 `--core`、`PIWORK_CORE_URL`、Desktop 默认 Core 配置、保存凭证中的 Core、相同 loopback 默认值的顺序解析。参数和环境变量 SHALL 仅影响本次启动，不自动保存。业务 CLI SHALL 不读取 Desktop 偏好；`desktop open/logout` SHALL 继续只选择既有本机实例，不重新解析 Core。

Desktop 默认配置不存在 SHALL 回退到原凭证/默认值，不要求迁移旧凭证。需要读取的配置损坏、版本不支持、地址字段非法、超过大小限制或无法安全访问 SHALL 返回 exit 1 和安全恢复方向，保留原文件，不静默改连其他 Core；已由参数或环境选定地址时 SHALL 不读取无须使用的 Desktop 偏好。通过参数、环境或旧凭证选定的地址无效 SHALL 返回 exit 2，不继续尝试低优先级地址。凭证仅 SHALL 用于与其 Core origin 相同的请求。

用户 CLI、operator API 调用方和独立 Desktop 后端 SHALL 直接访问 Core HTTP 服务，不能要求先启动或经由 ControlPlane 17891。默认端口变化不得迁移已有凭据 origin、改写显式地址、试探旧端口或把连接失败转成浏览器登录；选定旧地址不可达时提供显式配置当前 Core 后重新登录的方向。远程 Core 的可达性由部署监听决定，不由客户端自动修改服务器。

#### Scenario: Use the user client endpoint
- **WHEN** 用户运行业务 CLI 且未提供显式地址
- **THEN** 使用 `PIWORK_CORE_URL`、保存凭证中的地址或 loopback 默认值；Desktop 默认配置不影响该选择

#### Scenario: Override the Core URL explicitly
- **WHEN** 用户提供 `--core <url>`，另有环境、Desktop 配置或保存凭证地址
- **THEN** 业务 CLI 或 Desktop 使用显式地址；Desktop 启动不覆盖持久配置，不把另一 Core 的 token 发给该地址

#### Scenario: Reuse the saved endpoint
- **WHEN** 没有显式或环境地址，业务 CLI 有保存凭证，或 Desktop 没有默认配置但有保存凭证
- **THEN** 使用该凭证的 Core 地址，不重写或迁移凭证

#### Scenario: Desktop 默认地址和旧凭证并存
- **WHEN** Desktop 配置 Core B，凭证属于 Core A，且没有参数或环境覆盖
- **THEN** Desktop 连接 B 并呈现未登录状态，不发送 A 的 token；业务 CLI 仍解析为 A

#### Scenario: 退出登录后保留 Desktop 默认配置
- **WHEN** 用户保存 Desktop 默认 Core 后清理当前登录，随后重新启动
- **THEN** 仍选择保存的 Core，不因凭证删除回到 loopback，不恢复已清理的 token

#### Scenario: 缺失、损坏和被覆盖的配置
- **WHEN** 默认配置不存在、需要读取的配置损坏，或参数/环境已经覆盖损坏配置
- **THEN** 分别使用原有回退、返回 exit 1 且不监听、或按覆盖地址正常启动；损坏文件均不被自动删除

#### Scenario: 无效高优先级地址
- **WHEN** 参数、环境或保存配置给出不合法 Core origin
- **THEN** 拒绝选定地址，不悄悄使用凭证或 loopback，不泄漏 token

#### Scenario: 无历史配置直接使用新 Core
- **WHEN** 同机客户端没有显式地址、环境覆盖、相关偏好或保存凭据
- **THEN** 连接 127.0.0.1:17871，使用原用户或 operator 身份，不访问 17891

#### Scenario: 已保存旧端口
- **WHEN** 保存凭据或 Desktop 偏好仍指向已停止的 7171
- **THEN** 报告所选地址不可达，不把旧 token 转发到 17871 或其他发现的服务；用户可显式选择新 Core 并正常登录

## REMOVED Requirements

### Requirement: Manage Core packages from the operator CLI

**Reason**: 旧 Core 管理命令交付退役。
**Migration**: Core 内嵌管理 UI 或既有受保护 operator/admin API 承担包管理；保留领域与 Operation 权限边界，不移入用户 CLI。

### Requirement: 显式容器模式兼容本机发布端口

**Reason**: CLI 容器交付和专用监听模式删除。
**Migration**: 使用 Linux 原生 CLI，Desktop/proxy 保持 loopback；旧容器模式变量不再读取，不保留模式分支。

### Requirement: 在运行容器内重新打开与清理 Desktop

**Reason**: CLI 容器终端及容器 Desktop 模式删除。
**Migration**: 使用 Linux 原生 desktop/open/logout，保留本机身份和实例恢复，不维护容器控制路径。

### Requirement: Resolve one Core endpoint consistently

**Reason**: 本变更删除旧命令、独立交付或非 Linux 路径；旧条款的相关正向场景不再成立，完整替换为“原生用户客户端一致选择 Core 地址”，保留其中有效的业务和权限约束。
**Migration**: 按新条款使用两个 Linux 程序、Core 内嵌 UI 与既有管理 API；不保留旧语法、平台或容器兼容入口。
