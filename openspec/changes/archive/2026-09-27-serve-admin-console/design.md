# Design

## Context

动机与产品范围见 [proposal.md](proposal.md)。本次读取到的仓库事实如下：

| 现有位置 | 事实及对方案的约束 |
| --- | --- |
| `apps/console/src/main.ts` | 只有输出 Works/Services 的占位 HTML，没有 listener、登录或管理接口；可在该工作区内实现面板，不需新建服务体系 |
| `apps/core/src/cli.ts` | `piwork-serve` 覆盖 status、users、runtime/default-work、Skills、Core packages 和 operation show；首管理员 bootstrap 与 daemon 启动继续保留 |
| `apps/core/src/application/core-application.ts` | `/control/*` 在分发前验证 Operator；`/api/v1/login/me/logout` 已提供用户会话；尚无 admin 管理路由 |
| `apps/core/src/identity` | 用户服务已有 admin 角色、账号校验、会话撤销及最后管理员保护；browser-security 工具仅被其测试引用，没有接入 Core HTTP |
| `apps/core/src/configuration` | Skills 已有完整树验证、原子制品和目录名称身份；目前仅从 Core 宿主路径导入 |
| `apps/core/src/packages` | package 上传、异步 worker、阶段、查询已经存在，但 Core install/update、上传及重放 actor 固定为 operator |
| `packages/core-store/src/pi-packages.ts` | 数据表、上传引用、幂等记录及 worker 已具有 actorId/scope 字段，可以直接传入实际管理员 userId |
| `/control/default-work` | 已支持 patch；CLI base-image 分支仍发送整份旧配置，新 API 必须支持原子 baseImage 字段更新 |
| `/control/runtime` | 先保存再刷新 runtime，刷新失败会返回 503；新管理 API 需要明确“保存成功但未 ready” |
| `packages/client-sdk` | 使用 Node fs、crypto、package 打包工具，适合面板服务端调用，不能直接打包到浏览器 |
| `packages/pi-package` | 已有目录打包、ZIP 安全校验、流式长度/摘要处理；不复制 package 安装逻辑到面板 |

现行 `serve-control-plane` 与 `pi-package-management` 的 operator-only 约束和新的管理员入口冲突，delta 只调整授权范围；`skill-management` 增补内容传输。用户认证、用户管理和 CLI 的已有规范能够继续复用，无需写入页面行为。

## Goals / Non-Goals

**Goals:**

- 面板可独立构建、运行及用管理 API fixture 验证，Core 无 console 编译或运行依赖。
- Core 对所有管理客户端提供相同的授权、校验、原子修改、错误和 Operation 契约。
- 浏览器输入目录来自用户设备；Core 发布制品不依赖 console 暂存路径。
- 在设计阶段确定启动参数、认证生命周期、API、上传格式、错误及并发行为，任务可直接实施。

**Non-Goals:**

- 不引入独立认证服务、外部数据库、队列、反向代理必需项或前端开发服务器作为生产依赖。
- 不把 operator credential 分发给面板，不以 CLI 子进程充当管理 API，不共享 Core 存储目录。
- 不扩展 Work 内容访问、重做 package 准备引擎、提供自动升级/迁移历史 Work 格式或通用文件管理。
- 不以本 change 为由全面移动现有 CLI/Core 入口代码；新面板交互和浏览器安全实现全部位于 Core 外。

## Decisions

### 1. 两进程同机，面板直接终止 TLS

```text
Remote browser
      |
      | HTTPS + console cookie
      v
apps/console (pages + browser API + temporary uploads)
      |
      | HTTP loopback + administrator bearer
      v
Core /api/v1/admin/* --> existing application/domain services
      ^
      |
piwork-serve --> /control/* + operator credential
```

采用 `piwork-console serve`，根项目增加 `npm run console -- serve ...` 的本地启动脚本；`apps/console/package.json` 增加 bin。参数及退出码由 SUI-001 固定。部署示例：

```sh
piwork-console serve --core http://127.0.0.1:7171 --listen 0.0.0.0:7173 --public-origin https://piwork.example:7173 --tls-cert /etc/piwork/console.crt --tls-key /etc/piwork/console.key
```

仅允许 loopback Core URL；localhost 解析结果必须全部为 loopback，连接不跟随重定向。HTTPS Core URL 也校验证书，不提供跳过验证开关。public-origin 不允许路径、query、userinfo、fragment，其有效端口必须等于 listen 端口；请求 Host 必须匹配该 origin，不信任 Forwarded/X-Forwarded-*。TLS key 必须是非 symlink 的普通文件且仅当前用户可读；证书和 key 缺失/无效时启动失败。不自动签发或默许不受信证书；部署者负责提供浏览器信任的证书。

Core 暂时不可达时仍提供登录页和面板自身 `GET /healthz -> {status:"healthy"}`。启动输出只包含公开面板 URL。SIGINT/SIGTERM 停止接受新请求，终止未完成传输、清理本进程暂存和内存会话，最多等待 10 秒后退出；不调用 Core 停机或 Operation 取消。

选择直接 TLS 是为了只运维两个进程。把 UI 嵌入 Core 会绑定发布/故障边界；第一版强制外部代理会增加部署组件，因此不采用。前端框架或证书自动化可以后续独立演进。

### 2. 轻量独立 UI，不向浏览器暴露 Node SDK

`apps/console` 使用 Node HTTPS 服务提供固定 HTML shell、CSS 和 TypeScript 编译后的浏览器原生 ES modules。第一版采用 DOM/form/history API，不引入 SPA 框架和运行期打包服务；浏览器入口使用独立含 DOM lib 的 tsconfig，服务端继续采用仓库 NodeNext 配置。构建复制 HTML/CSS 到 dist，生产只运行已构建文件。

建议文件职责（是设计边界，不要求无意义的一文件一类）：

| 目录/文件 | 职责 |
| --- | --- |
| `apps/console/src/cli.ts`、`server.ts` | 参数、TLS、listener、静态资源、健康与关闭 |
| `apps/console/src/server/session.ts`、`browser-security.ts` | 进程内会话、登录挑战、Cookie、CSRF 与限流 |
| `apps/console/src/server/admin-api.ts` | 固定管理路由映射、DTO 检查、上游错误/超时 |
| `apps/console/src/server/package-inputs.ts` | 浏览器 package 输入转换及临时文件清理 |
| `apps/console/src/browser/*` | 共享 API 调用、表单状态、各管理页面与上传/观察 |
| `apps/core/src/admin/*` | 管理路由、管理应用服务、Skill 内容接收 |
| `packages/contracts/src/control/admin.ts` | 客户端无关的请求/响应 TypeBox schema 与公开类型 |

console 服务端依赖 contracts、client-sdk、pi-package；不依赖 core、core-store、work-store 或 runtime-docker。新增流式 multipart 解析采用 `busboy`，在 Core 和 console 声明直接依赖及 types。不把 multipart 解析扩展为全仓新基础设施。类型导入可用 contracts；浏览器运行时代码不加载 contracts 的 Node/gRPC 导出或 client-sdk。公开 DTO 与错误在 contracts 及 fixture 中校验。

现有 Core `identity/browser-security.ts` 是未接入 HTTP 的工具。把 Cookie/CSRF 功能和对应测试移到 console 私有模块；不从 console 导入 Core 工具，也不新增通用 browser 包。工具中的日志脱敏仅保留本次实际使用部分。

shell 路由为 `/login`、`/`、`/users`、`/runtime`、`/default-work`、`/skills`、`/skills/:name`、`/packages`、`/packages/:name`、`/operations`、`/operations/:id`。根路由为状态页，路径参数单次编码，表单可在页面内展开。shell 本身不嵌入管理数据；脚本获得 session 后才能拉取数据。登录后返回经白名单验证的本站原路由，否则返回 /。未支持路径 404，静态文件固定清单，禁止目录遍历和任意代理。

### 3. 面板会话只是 Core 用户会话的浏览器适配

服务端内存 Map 保存随机 256-bit consoleSessionId 对应的 `{coreToken,user,expiresAt,csrfBinding}`；只将 ID 的 Cookie 给浏览器，命名 `__Host-piwork-console`，设置 Secure/HttpOnly/SameSite=Strict/Path=/ 和不超过 Core TTL 的 Max-Age。不把 bearer 写入 Cookie、localStorage、sessionStorage 或数据目录。过期条目每分钟回收，最大 1,024 个已登录面板会话；容量满返回 503 `CONSOLE_SESSION_CAPACITY`，不踢掉有效会话。

浏览器接口如下：

| 路径 | 行为 |
| --- | --- |
| GET /console/api/session | 有效会话：调用 Core me 后返回 authenticated/user/expiresAt/csrfToken；无会话：返回 authenticated=false 及登录挑战 csrfToken |
| GET /console/api/availability | 未登录也可调用，只返回 Core reachable 与 administratorInitialized，不返回配置或用户信息 |
| GET /console/api/health | 需面板会话，固定查询 Core /healthz，供状态页区分 liveness 与 readiness |
| POST /console/api/login | JSON account/password，登录挑战 Cookie + X-CSRF-Token + Origin；成功返回公开身份 |
| POST /console/api/logout | Core 注销成功或已失效后清除 console 会话，失败保持可重试状态 |
| /console/api/admin/* | 仅 CADM-002 白名单方法与路径，映射到 /api/v1/admin/*；所有请求由服务端加入真实管理员 bearer |
| POST /console/api/package-inputs/directory | 接收浏览器目录，转换并上传到 Core |
| POST /console/api/package-inputs/zip | 接收浏览器原 ZIP，校验并上传到 Core |

无会话的 session 请求签发 `__Host-piwork-login` 挑战 Cookie，10 分钟过期，CSRF 使用进程密钥 HMAC 绑定挑战。最多保留 2,048 个挑战，过期优先淘汰；过量请求返回 429，不影响有效登录会话。登录成功撤销挑战、轮换为新会话 ID；重复登录失败不覆盖其他已有会话。CSRF 对每个状态变更（含登录、注销、上传）校验配置的精确 Origin 和 X-CSRF-Token，先验证后读取大 body。所有 JSON 请求检查 application/json；目录/ZIP 使用各自指定类型。

登录依次调用 Core login、验证角色、读取 admin status 并确认 `adminApiVersion=1`。普通 user 不签发 console 会话并尝试撤销刚取得的 token；Core API 404 或版本不符显示 `CORE_ADMIN_API_UNAVAILABLE`，撤销/丢弃 token，不回退使用 operator 或旧 control 接口。Core bearer 只通过固定上游请求使用，浏览器传来的 Authorization/Cookie/X-Forwarded-* 不向 Core 转发。

Core 每个管理员 API 自己校验用户身份；console 在自己的受保护适配入口前调用 me，特别覆盖本地 package 暂存工作。会话 401 或 role 变化清理 Map 与 Cookie，浏览器终止观察并登录；Core 网络 502/超时 504 不清除尚未到期的会话。可见页面每 15 秒调用 session，聚焦立即检查；绝对到期时间到达后本地清理。

注销 Core 不可达时显示失败并保留可重试会话。面板重启后内存会话丢失，浏览器重新登录；旧上游 bearer 无法再通过面板使用，按 Core 到期规则失效。正常关闭可尽力撤销，但不以撤销成功作为关闭条件，不停止任何已接受 Operation。

console 对账号键和真实 socket IP 加每分钟 5 次失败限制，使用定时淘汰并返回 retryAfterMs；不信任浏览器上报 IP。Core 现有登录限流继续生效。Core 会把同机代理视为 loopback 来源，因此第一版可能有更保守的聚合限流，错误明确显示等待时间；本次不引入可信代理配置或修改 Core 登录来源协议。

### 4. Core 管理服务共享领域能力，路由保持凭证分隔

CADM-002 表格是规范性的路由/DTO 契约。新增管理分发在 /api/v1 bearer 认证后匹配 admin 前缀，不把 administrator 检查放在 UI 的“隐藏按钮”逻辑里。Core 的 admin status 返回版本 1 和已有状态投影，能查询即使 runtime 非 ready。状态检查复用现有 RUNTIME_UNAVAILABLE 恢复探测，并防止并发刷新重复进入恢复。

用户服务沿用现有领域逻辑。异步密码哈希、长上传和 package image/env 检查后，在写入事务前重新认证原 token；授权失败不发布结果。已接受持久任务不再依赖操作者会话。统一 safe error 映射复用现有 code/message/correlationId，管理输入错误可增加 field；不修改旧端点的 response shape。错误语义：

| 类别 | HTTP / code | 客户端行为 |
| --- | --- | --- |
| 未登录/失效 | 401 AUTHENTICATION_REQUIRED 或 AUTHENTICATION_FAILED | 清除面板会话并登录 |
| 已认证无 admin 权限 | 403 PERMISSION_DENIED | 清除面板会话，显示管理员限制 |
| 参数/字段 | 400 INVALID_REQUEST、INVALID_CONFIGURATION 或领域码，field 可选 | 保留非敏感草稿，定位字段 |
| 资源不存在 | 404 NOT_FOUND、SKILL_UNAVAILABLE、PI_PACKAGE_NOT_FOUND | 刷新或返回列表，不泄露隐藏对象 |
| 账号重复/幂等冲突 | 409 CONFLICT | 显示冲突，禁止自动更换语义重试 |
| 默认未初始化 | 409 DEFAULT_WORK_NOT_CONFIGURED | 跳转运行时配置 |
| 默认引用/并发任务 | 409 PI_PACKAGE_IN_DEFAULTS、PI_PACKAGE_BUSY；Skill 使用已有安全引用错误 | 显示处理步骤，不能隐式修改默认 |
| 超限/媒体类型 | 413 或 415，对应领域码 | 重新选择输入 |
| 来源、依赖准备失败 | Operation failed + 安全 stage/code/message | 显示阶段，可显式新提交 |
| 限流/上传容量 | 429 + retryAfterMs | 等待后显式重试 |
| 未知内部异常 | 500 INTERNAL_ERROR | 安全提示、correlationId，不显示堆栈 |
| console 无法连接/等待 Core | 502 CORE_UNAVAILABLE / 504 CORE_TIMEOUT | 保留会话，写请求视为结果待核实 |

Core 管理 JSON reader 限制 2 MiB，以容纳 256 KiB AGENTS 被 JSON 转义后的边界输入；原有 1 MiB reader 用于旧接口不变，console 自己的 JSON 接收也使用 2 MiB。id 和 operationId 采用当前 ResourceId 格式（16–128 个字母、数字或连字符）。scoped package name 按一个路径段编码/解码，拒绝二次编码绕过和多余路径段。method 不受支持返回 405，未知资源路径返回 404。

### 5. 默认配置只接受字段 patch，运行时返回保存状态

GET default-work 在当前公开 configuration 外返回 baseImage 可读引用；UI 为 CLI 可修改的四个字段提供表单，其余公开字段只读。PATCH 输入直接为 `{baseImage?,skills?,packages?,agentsMd?}`，package 名称转换为 enabled=true 的选择；不允许传 configuration 全量替换、agentImage 内部 ID 或 expectedRevision。Core 在一个存储事务中读取最新默认、注册所需 image catalog、转换选择、完整校验、合并并返回。无效引用时事务回滚，包括本次临时 catalog 注册。GET 未初始化返回 null；PATCH 返回 DEFAULT_WORK_NOT_CONFIGURED。

skills 按所选顺序保留，package 按现有规范化顺序返回；空集合与字段省略不同。UI 用加载基线计算 dirty 字段，只发送改变部分，成功结果成为新基线，不实现客户端自动合并同字段竞争。无关默认字段、runtime modelRef 及包安装完成时的 addToDefaults 使用现有原子提交顺序，共享服务不得覆盖对方的最新值。

同时修正现有 operator CLI 的 base-image 提交分支：/control/default-work 的 patch 增加可选 baseImage，拒绝同时提供 agentImage；CLI 所有 default-work flags 均只发指定字段 patch。原命令语法、旧全量 configuration 请求和 operator 授权保留。此处落实已有 SERVE-CTRL-001 的省略字段保留规则，不增加 UI 对 CLI 的运行依赖。

运行时输入采用现有完整 configure 语义，每次重新输入 key。新 admin service 复用 RuntimeProfileStore、catalog 注册、默认 runtime 同步、refreshRuntime，但把“保存完成”和“探测失败”分开。有效配置提交后即使 runtime 不可用，返回 200 `{runtime,status}`，其中 status 为实际 readiness；新投影省略 internal revision 和 credentialRef。旧 /control/runtime 仍保留现有响应行为。

runtime 保存与默认 runtime 字段同步需要同一应用级变更串行入口，并对默认配置同步使用最新事务值，避免并发管理员配置乱序覆盖。持久配置先于 runtime refresh；refresh 阶段异常不回滚已发布 secret/profile。存储异常后客户端用 GET 核实，不依据超时自动再次写入。重启继续复用现有持久 profile 和恢复机制。

UI 只对成功响应显示“已保存”；200 且 ready=false 显示独立 warning。HTTP 超时或连接中断显示“结果待核实”，提供读取当前配置的动作而不清掉非敏感草稿。key 在提交结束后清空，不重试复用 secret。

### 6. Skill 上传有独立内容协议

使用 SKM-004 的 multipart：directoryName 字段第一且唯一，files part filename 为 encodeURIComponent(relativePath)。示例：用户选择 code-review/references/rules.md，directoryName 为 code-review，filename 为 references%2Frules.md；Core 的随机暂存 ID 不参与 Skill name。

console 先校验 session/CSRF，再把流和原 Content-Type 边界转给 Core 的 POST/PUT skills，自己不构造可让 Core 读取的共享路径。Core 使用 busboy 流式接收到专属 staging root 下的随机上传目录，再建立已验证名称的内容子目录；每个文件通过独占创建写入，不跟随 symlink。只解码路径一次，不信任 multipart 的默认 basename 清理；先验证完整相对路径再创建父目录。目录层次、冲突、数量和字节数边接收边检查，根 SKILL.md 按普通文件验证，HTTP body 上限 64 MiB。

Core 在临时区域内验证完毕和重新鉴权后复用现有 SkillArtifactStore 与 catalog 原子发布。staging 与已发布 artifacts 的 orphan cleanup 区域分离，不能清掉其他活跃上传；发布阶段沿用同步 commit 边界。请求结束/拒绝/断连清理自己的 staging，Core 启动清理没有发布的旧 skill-upload staging。客户端断连发生在发布以后不会回滚有效结果，UI 明确要求查询确认。

浏览器 FileList 只代表可枚举文件，不可还原权限、链接和空目录；本协议将其视为普通文件树，不假称传输了完整 POSIX 元数据。Skill 路径 CLI 保持原有目录校验；Core 内容接口不允许 path JSON 旁路。协议和限额属于 Core，面板目录选择与进度属于 UI。

### 7. Package 本地输入在 console 转换，Core 复用原上传协议

npm/Git 直接提交 source descriptor；源解析复用现有 Pi package 解析器，不接受含明文凭据 URL。目录与 ZIP 先经 console 上传适配，再返回 Core uploadId，随后由浏览器明确提交 install/update。新 Core API 的二进制上传与现有 /control/package-uploads 使用相同 header/ZIP/sha256/长度契约，只替换授权和 actor。

- directory endpoint 接收同样的 directoryName + files multipart。这里 directoryName 为 1–255 UTF-8 字节的展示名，拒绝 slash/backslash/控制字符、. 和 ..，不使用 Skill name 正则。文件相对路径采用同一编码和安全校验，但限额取 PKG-003。
- 浏览器目录暂存文件统一为普通文件 0644、父目录 0755；清单缺根 package.json 立即拒绝。使用现有 packPiPackageDirectory 和 inspectPiPackageZip，确定性路径排序、固定 ZIP 时间戳，使同一目录快照重复上传产生相同摘要。需要保留执行位或内部链接的输入通过 ZIP。
- zip endpoint 只接收 application/zip，`X-Piwork-Package-Name` 为编码后的 File.name；stream 计算长度/摘要并调用现有 ZIP 校验，不重新压缩或在 console 执行解包脚本。把实际 ZIP bytes 原样上传 Core。
- directory multipart HTTP 总量上限 1 GiB + 64 MiB；普通文件总内容上限 1 GiB、单文件 64 MiB，ZIP 输入/输出上限 256 MiB，其他树/manifest 约束沿用 PKG-003。传输中 count/byte/path 错误立即停止，不等全部缓冲。
- 每个 console 同时最多处理两个 package-inputs 请求，超额 429 `CONSOLE_UPLOAD_BUSY`（retryAfterMs=1000）。每个请求 staging 最多保存 1 GiB 原树和 256 MiB ZIP；Core 自己的接收和准备限额仍独立执行。multipart 每个 part header 限制 16 KiB，file/field/parts 限额显式设置。60 秒无进展及 30 分钟总时限适用于浏览器至 console；向 Core 传送继续使用既有上传截止时间。
- 成功返回 `{uploadId,expiresAt}` 后删除 console 暂存；任何失败、取消或断连同样清理。Core 的 ready upload 由既有 24 小时 GC/lease 管理，面板无需保留文件以等待安装。

console data-dir 0700、临时 ZIP 文件 0600；目录快照文件为打包所需的 0644，位于不可被其他用户进入的 0700 请求根目录内。符号链接数据根及不安全路径拒绝。独占进程锁采用原子创建和活进程检查，无法证明旧锁失效时拒绝启动；取得锁后才清理旧 staging。锁实现留在 console，不因此导入 Core store。关闭清理与 startup cleanup 覆盖 crash 遗留。

给 SDK 增加显式 admin scope 的 package upload/management 方法；现有 scope={kind:"core"} 的 operator 默认行为不被静默替换。Core service 的 install/update/accept 接受经过授权的 actor 参数，并贯穿 upload lookup、findReplay、store.accept；operator 调用显式传原字符串 operator。worker 和表结构已有 actor，无需为 console 新增 package 数据表。Core operation 按 scope 过滤，允许任意 admin 查询 Core 任务，同时 upload 消费保持 actor 私有。

### 8. 页面状态与 Operation 观察

每页使用相同 `loading | ready | submitting | error` 状态骨架。表单维护 server baseline 和 local draft；选择文件只更新 draft，保存成功才更新 baseline。更新失败保留非敏感编辑。原生 beforeunload 和面板内导航确认保护脏表单，密码输入不持久化。

AGENTS 使用浏览器 File.arrayBuffer 与 fatal UTF-8 解码，字节数使用 TextEncoder，保留换行和 BOM 文本，不自动 Markdown 渲染。256 KiB 按文本实际 UTF-8 bytes 验证；Core 同样校验。加载文件替换脏草稿需确认，取消不改变文本。Skill/Package 目录用 file input 的目录选择能力与 webkitRelativePath 获取根名，上传用 XMLHttpRequest 以显示发送字节；不支持目录选择时给明确提示，package 可用 ZIP。

package 页面接受前保存 `{intentKey,source,verb,target,addToDefaults}` 于当前页面内存。上传完成后 source 为 Core uploadId；npm/Git 为规范化 descriptor。一次提交期间重试使用原 key/source，不能自动产生新 key。超时可点击“恢复此次提交”；同一 actor 重新登录且当前页面上下文已丢失时不承诺恢复未收到 ID 的请求。获得 ID 后立即更新 URL 为 /operations/:id 并显示复制按钮。

Operation 详情仅顺序发起一个 GET，结束后间隔 2 秒再次请求；页面隐藏/离开、会话失效或终态停止轮询，重新聚焦立刻查询。网络失败显示 stale、保留 ID 并暂停，点击重试恢复；不把观察失败改成服务端 failed。phase 可显示 queued/source/prepare/validate/publish/cleanup-pending/succeeded/failed/superseded，state 是终态判断依据，不计算伪造百分比。同一个原 Operation 在 failed 终态保持可查；新尝试需返回表单、重新确认来源并用新 key。

“找回任务”只有按已知 ID 查询；用户可在其他设备或面板重启后恢复。Core 没有 recent list 接口，本版不新增。管理员可以观察其他管理员的 Core 任务，但不能使用其 uploadId。每个 Core catalog 同时一个非终态 install/update 的既有门禁保持。

列表删除、账号禁用和密码重置使用名称确认。自禁用/重置成功使当前 session 清理；最后管理员保护以 Core 事务结果为准，不仅靠禁用按钮。Skill/package 的默认保护错误提供到默认 Work 的链接，不自动替用户解除引用。状态/会话每 15 秒刷新，草稿不被后台请求覆盖。

### 9. 传输、安全响应和日志

普通 JSON Core 请求截止时间为 120 秒；上传采用其独立时限。Core 与 console 的 HTTP server requestTimeout 必须容纳 30 分钟上传，再由每条路由实施普通请求与上传各自的绝对/无进展时限，不能由 Node 默认超时提前截断。multipart 解析保留未处理 filename 后独立验证，显式处理 file.truncated、filesLimit/partsLimit/fieldsLimit 及 parser error，失败立即终止和清理。该选型已核对 [busboy 官方 API](https://github.com/mscdex/busboy#api)；浏览器目录/文件输入验收使用 [Playwright 文件上传能力](https://playwright.dev/docs/input#upload-files)。读取/写入流有背压，不能把最多 1 GiB 的 package 存入内存。客户端 disconnect 终止未接受传输；安装接受前丢失连接的情况由稳定 key 处理，不把 HTTP cancellation 等同于 Operation cancellation。

HTML/CSS/JS 均同源。API/包含身份的响应使用 Cache-Control: no-store；设置 CSP（default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'）、X-Content-Type-Options: nosniff、Referrer-Policy: no-referrer。不允许跨域读取管理 API；静态错误页也不插入未经转义的输入。所有显示名称、错误和 AGENTS 编辑都用文本节点/textarea value。

日志仅记录路由模板、状态、持续时间与 correlationId；不记录 body、query、headers、来源 URL、密码、Cookie、token 或暂存绝对路径。Core 返回错误不能以原始 Error/子进程输出透传；console 产生的错误同样使用固定安全消息。

### 10. 验证组织与独立实施顺序

先实现 contracts 和 Core admin API，再实现可使用 fixture 的 console；UI spec 的验收依赖公开接口，不要求 Core 类或 CLI 代码。各 UI 页面用同一 session/API 抽象和各自 fixture 测试，可分模块实施；Core 业务不为页面加入 UI 状态字段。

- contracts/SDK：严格 schema、路径编码、错误及 operator/admin 方法隔离；同 DTO fixture 用于 Core 和 console。
- Core 集成：实际 HTTP listener + 临时持久 store + 现有可替换 runtime/package helper，覆盖角色、上传前后撤销、actor、幂等、默认 patch、最后管理员和 Work 数据边界；不以纯 mock 测试代替授权。
- console server：实际 HTTPS listener、固定测试证书、Core HTTP fixture，覆盖 Cookie/CSRF、上游失效、限流、stream/cleanup、启动参数和重启。
- 浏览器：引入 dev-only `@playwright/test`，以 Chromium 运行真实浏览器、console 和测试 Core；验证所有核心操作、选择目录/文件、进度、错误/空态、刷新与 operation URL。测试环境显式信任 fixture 证书，生产不增加 insecure 开关。
- Docker 验收：在现有 package integration 测试基础上增加一条 admin bearer 的真实本地目录/ZIP 安装与查询路径，验证 helper 准备、actor 和默认发布，不要求外部模型 key。npm/Git 的真实准备继续由现有 package integration 负责，新页面测试验证 descriptor 与最终状态映射。
- 回归：原 control-plane、CLI、身份、Skills、packages 及默认配置测试继续通过，专门验证停止 console 后 CLI 可管理且任务不被取消。

新增 console 的 test:unit/test:browser，以及根 console 启动脚本和操作文档。实施任务逐项写明 requirement ID 和对应验证，不留待实现阶段决定关键 API。

## Risks / Trade-offs

- [浏览器目录无法提供 POSIX 元数据] → Skill 接受普通文件快照；package 明示使用 ZIP 保留执行位/内部链接，校验仍由 Core 执行。
- [面板进程重启丢失登录状态] → 第一版会话只在内存保存，用户重新登录；Operation 在 Core 持久化，已有 ID 继续有效。
- [管理员 API 扩大合法管理入口] → Core 每请求按真实用户检查，长操作发布前复验；operator 和普通 user 的原有边界不变。
- [配置提交后 runtime 探测失败] → 新 API 同时返回持久配置与 readiness，UI 不自动重发，未知传输结果先读取核实。
- [大目录消耗临时磁盘/网络] → 有界流、两项并发、独占 staging、失败及重启清理；Core 上传/准备限额独立执行。
- [多管理员或 CLI 同时编辑] → 服务端 patch 与现有 catalog 门禁共同生效，幂等键包含 actor，默认引用保护在提交时判定。
- [HTTPS 证书部署成本] → 提供明确参数、启动诊断和同机示例；第一版不增加自动签发服务。
- [Core 将登录来源视为同一个 loopback 代理] → 保留现有 Core 限流，同时面板按真实来源限流并显示 Retry-After；高并发分布式身份场景不在第一版范围。
- [接受响应丢失且页面也关闭] → 无 ID 不承诺自动找回；当前页面可同键恢复接受，取得 ID 后立即显示 URL/复制入口。这一限制写入帮助，避免暗示存在任务历史服务。

## Migration Plan

1. 本 change 增加 API/console，不改变现有 operator 路由或历史 Work/package 格式。包库 actor 字段已存在，管理员使用真实 userId，不需要把旧 operator 记录转换为用户记录。
2. 先部署同版本 Core 和 contracts/SDK 构建产物，再运行独立 console；首次 Core/admin bootstrap 按已有 CLI/env 流程完成。无 console 时旧 CLI 继续可用。
3. 配置可信 TLS 文件及 console 自有 data-dir，启动后管理员登录，验证状态、用户、默认配置和小 Skill 上传，再进行一项 Core package 安装/按 ID 查询。
4. 回滚面板只需停止其进程并回退 console 产物；Core 中已经提交的用户、配置与制品保持有效。若回退 Core 二进制，仅回退到可读取现有最终 V1 store 的版本；不删除数据或改写 actor 记录。
5. 已存在 Core lacking admin API 时，console 明确显示版本/能力不兼容；不通过 operator credential 或宿主路径绕过。
