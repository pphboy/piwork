# Design

## Context

动机及产品范围见 `proposal.md`。本设计基于以下现有实现：

- `apps/cli/src/service-proxy.ts` 在 `127.0.0.1:17890` 接受 service absolute-form 请求和 `/proxy.pac`，目前没有文件路由；`packages/client-sdk/src/index.ts` 通过 Core service gateway 流式转发，并隔离应用认证与平台 token。
- `apps/core/src/runtime/docker-work-runtime.ts` 将 `work-workspace` 挂到 `/var/data/workspace`，`work-private` 挂到 `/var/data`；`docker-service-runtime.ts` 仅为显式获准 service 挂载前者，共享 uid/gid 为 `10001:10001`。Core 进程没有可直接当作各 Work 根使用的 `/var/data/workspace`。
- `packages/runtime-docker/src/snapshot-helper.ts` 已有 Core 受管、无网络 helper 的挂卷模式；`stream.ts` 可用参数数组启动 Docker 并保持二进制背压。终止 Docker CLI 子进程并不等于确认容器退出。
- `apps/snapshot-helper/filesystem.py` 已使用目录 fd、`O_NOFOLLOW` 和逐段访问；普通文件后端沿用这种安全策略，不借用冷快照 helper 的 root 权限。
- `work-management/lifecycle.ts` 当前只收尾 agent/service；`work-snapshots/preflight.ts` 只核验这两种容器。新增文件写入者必须显式接入两者。
- `CLI-OUTPUT-001` 当前禁止输出密码，`CLI-SERVICE-PROXY-001` 当前只描述 service 代理。delta 将完整修改这两条，限定本地临时凭据的一次展示及文件分支，不放宽平台凭据规则。

## Goals / Non-Goals

**Goals:**

- 文件权威入口与状态协调在 Core；CLI 只是受限代理；持久卷为唯一文件数据源。
- 同一 proxy 端口同时支持现有 service 流量与多个自有 Work 的 WebDAV。
- 明确请求、提交、取消、容器回收和 snapshot 准入之间的顺序，覆盖 Core 崩溃与迟到 Docker 创建。
- 用可重复的 Docker、rclone 与协议测试证明数据可编辑、可恢复、可导出。

**Non-Goals:**

- 不改 agent 协议、agent 基础镜像、Work context、service 定义、域名分配、portable format 或用户数据布局。
- 不把 Docker 的宿主 Mountpoint 当公共文件路径，不把 service 网关改成任意 HTTP/TCP 转发器。
- 不提供通用文件管理 JSON API、系统挂载承诺或全局 POSIX 文件系统模拟。CLI 暂不增加 ls/cp/mount/serve 等文件子命令。

## Decisions

### D1. Core 终止 WebDAV，按请求创建受管文件 helper

采用如下链路；其中 service 分支保持现有实现语义：

```text
WebDAV client --> CLI /works/<id>/files/ --> Core /api/v1/works/<id>/files/
                                                       |
                                                       v
                                              file helper (one request)
                                                       |
                                                       v
                                              work-workspace volume
```

新增 `apps/core/src/work-files`、`apps/file-helper`、`Dockerfile.file-helper` 与 runtime-docker 的 file-helper 适配。每个需要文件系统的 HTTP 请求对应一个辅助容器；请求完成后删除，首版不做常驻池。OPTIONS、拒绝请求和能力查询无需容器。采用一次请求一个容器以限定卷权限、传输取消和故障归属；容器启动开销由并发限制控制，未来池化不影响公开契约。

helper 由 Core 配置 `PIWORK_FILE_HELPER_IMAGE`；启动时解析为不可变镜像 ID并核验镜像 label `piwork.file_protocol=1`。缺失、无法解析或版本不符只使文件能力 unavailable，Core 与 service proxy 保持原有功能。镜像是平台部署依赖，不是 Work 自有镜像，不加入 `.work`。不复用运行中 pi-agentd 的文件工具，不在 Work 中增加 WebDAV service。直接访问 Docker 宿主卷路径会引入宿主权限/布局依赖，故不采用。

容器使用 `--network none`、只读根文件系统、`10001:10001`、`--cap-drop ALL`、`no-new-privileges`、0.5 CPU、128 MiB、32 PID；`/tmp` 为 16 MiB tmpfs。唯一持久挂载是当前 Work 的 workspace，挂到 helper 内 `/workspace`，只读请求使用只读挂载。禁止 agent-private、Docker socket、控制面凭据、宿主路径和其他 Work 卷。resource kind 为 `file-helper`，按 installation/work/job 标记归属，独立于 service 资源与 `maxServices`，不创建额外持久卷。

### D2. 外部入口与能力发现

| 接口 | 认证 | 结果 |
|---|---|---|
| `GET /api/v1/file-access` | 现有用户 Bearer | `{version:1,protocol:"webdav",profile:"workspace-transfer-v1",available:boolean,reason:null|"FILE_HELPER_UNAVAILABLE",rootTemplate:"/api/v1/works/{workId}/files/",limits:{...}}`；limits 为 D7 的公开固定数值 |
| `/api/v1/works/<workId>/files/` 及子路径 | 用户 Bearer、owner | D4 的 WebDAV 方法 |
| CLI `/works/<workId>/files/` 及子路径 | 本地临时 Basic | 转换到上述 Core 路由 |

Core 在 WHATWG URL 的 dot-segment 归一化、通用 parts 解码和 JSON 路由之前识别原始 request-target 上的文件前缀；认证后交给独立路径解析器。文件 body 不经过现有 1 MiB JSON reader。客户端不指定 volumeName、image、Docker ID、owner 或宿主路径。

capability DTO 顶层字段恰为表中字段；available=true 时 reason=null。limits 的整数键固定为：maxHeaderBytes=32768、maxXmlBytes=65536、maxXmlDepth=32、maxProperties=128、maxMetadataBytes=16777216、maxDirectoryEntries=10000、maxTreeEntries=10000、maxFileBytes=10737418240、maxTreeBytes=10737418240、maxSegmentBytes=255、maxPathBytes=4096、maxPathDepth=128、maxCoreRequests=16、maxUserRequests=8、maxWorkRequests=4、maxWorkMutations=1、connectTimeoutMs=10000、helperTimeoutMs=10000、idleTimeoutMs=60000、requestTimeoutMs=1800000、authorizationRecheckMs=2000。服务端与SDK使用同一契约；能力查询不接受用户覆盖这些字段。

文件接口仅允许 desired=running、observed=ready/degraded、未删除、当前实例已完成 Core/Docker 核验且无关闭中的文件门禁的 Work。不调用 agent 文件 RPC；Docker 核验属于 Work 状态判断。无 service 或可选 service 失败不阻止访问。配置仅修改 desired 时继续使用当前 Work；apply 实际替换开始后关闭文件准入。

未带尾斜杠的文件根在认证及资格检查后返回 308 到同 Work 的带斜杠根。其他目录请求无需重定向，但返回的 collection href 始终带尾斜杠。本地 `/`、`/works/` 不提供目录聚合或 Work 列表，用户继续用 `work list/show` 获得 ID。

### D3. 同端口分流、认证与 URL 映射

CLI 保留现有参数、默认端口、IPv4 loopback 绑定、远程 Core HTTPS 及退出码；不增加 17891 监听器。路由按原始请求形式和 authority 判断：

1. 合法 service absolute-form `http://<service-domain>/...` 走既有 resolve/gateway；即使 path 是 `/works/.../files/` 也保持 service 请求。
2. origin-form 且 Host 精确为 `127.0.0.1:<实际端口>` 或 `localhost:<实际端口>` 的 `/works/<id>/files[/...]` 才进入 WebDAV；绝对 localhost URL、任意 Host、重复 Host、Upgrade 或 CONNECT 不进入文件路由。
3. `/proxy.pac` 保持既有独立处理，其他目标继续拒绝。PAC 内容不添加文件域名，不改变系统设置。

每次成功启动生成用户名 `piwork` 和 32 随机字节 base64url 密码，只存当前进程内存。启动 stdout 一次输出原 Proxy/PAC 行、WebDAV URL 模板、用户名、临时密码及文件能力状态；禁止把密码放 URL、PAC、文件日志、错误或 Core 请求。`--json` 仍 exit 2。proxy 退出/重启即失效；不写登录凭据文件或 Work。无本地密码/错误密码返回 401 Basic challenge，不请求 Core也不结束 proxy。

文件分支验证 loopback peer、Host、Basic；存在 Origin 时只接受本监听器的同源值，拒绝跨站 Origin/`Sec-Fetch-Site: cross-site`，不开放 CORS。移除 Basic、Cookie、Proxy-Authorization、所有客户端 `X-Piwork-*` 与逐跳头，再注入 Core Bearer。两条分支共用临时凭据判定：Basic 认证方案按大小写不敏感解析，解码后以常量时间比较完整的 `piwork:<临时密码>` 字节。service 分支遇到该凭据即拒绝，防止大小写不同的 Basic 方案把本地密码转发给应用；其他应用 Basic/Bearer 维持原行为。

启动先验证既有 service 能力，再查询 file-access。旧 Core 返回 404、能力版本不兼容、文件 helper 缺失或文件能力探测暂时失败时，显示相应不可用原因，service 监听仍启动；file capability 在下一文件请求时重查，不缓存授权。有效会话失效仍结束整个 proxy，exit 3。文件 403/404/409/5xx、本地 401 和应用 401 均不冒充平台会话失效。

CLI 将本地前缀替换为 Core 前缀。COPY/MOVE 的 Destination 接受本地同源绝对 URL或完整 origin-form 路径，仅允许同一 workId；转换为 Core origin-form，Core 再独立检查 Work 与根边界。Core 也接受与其请求 Host/scheme 匹配的绝对 Destination，但绝不据此向外建立连接。用户信息、query、fragment、其他 origin/Work 或根目的地均拒绝。返回的 DAV:href（包括错误 multistatus）和 Location 必须限定在同一个 Core 根后转为本地前缀；不依赖正则替换整个 XML、不信任客户端的 forwarded-prefix。XML 响应最多 16 MiB，允许有界缓冲后 namespace-aware 重写并重算 Content-Length；普通 GET/PUT body 全程流式。

### D4. WebDAV 文件传输子集

请求 XML 和代理 XML 重写使用 `saxes@6.0.0` 的 namespace 模式；禁用/拒绝 DTD、自定义实体、外部实体、非 UTF-8 XML，限制深度 32、属性请求 128 项、XML body 64 KiB。响应使用固定模板与 XML/URL 分别转义，不将文件名直接插入 XML。依赖精确写入 lockfile；不添加拥有独立鉴权或文件系统实现的完整 DAV server 框架。

| 方法 | 行为与状态 |
|---|---|
| OPTIONS | 已认证且 Work 可访问时 200，Allow 列出实现方法；不宣称 DAV class 1/2/3，不返回对应 DAV compliance token |
| PROPFIND | Depth=0/1；缺省按协议无限深度请求处理并返回 403 `propfind-finite-depth`；显式 infinity 同样拒绝，非法值 400。空 body=allprop，支持 allprop、propname、prop/include；200/404 属性分组置于 207 |
| GET / HEAD | 普通文件 200，二进制原样，Content-Length、Last-Modified、Cache-Control:no-store；HEAD 无 body。目录 GET 405，目录 HEAD 200 无 body；无 HTML 文件浏览页 |
| GET Range | 支持单段 bytes=start-end/start-/suffix，满足时 206，不可满足/多段 416；If-Range 存在则忽略 Range 返回完整 200。不提供跨修改版本的续传一致性保证 |
| PUT | 完整文件上传，支持 Content-Length 或 chunked；新建 201，替换 204；父目录缺失 409，目标目录 405，Content-Range 400；不会自动创建父目录 |
| MKCOL | 空 body 创建单层目录 201；父目录缺失 409、目标已存在 405、非空 body 415 |
| DELETE | 文件/目录 204；目录递归，缺省/显式 Depth=infinity；其他 Depth 400；不存在 404，根 403 |
| COPY | 同 Work 文件/目录复制，新目标 201、覆盖 204；目录 Depth=0 仅创建空 collection，缺省/infinity 递归；其他 Depth 400 |
| MOVE | 同 Work 重命名/移动，新目标 201、覆盖 204；collection 只接受缺省/infinity，其他 Depth 400 |
| PROPPATCH | 校验 XML 后 207，各请求属性 403，不落盘任何自定义属性或 mtime；不存在 404 |
| LOCK / UNLOCK / 其他方法 | 405 与准确 Allow；不伪造锁成功。带 WebDAV If/Lock-Token 条件的其他方法返回 400 `FILE_CONDITION_UNSUPPORTED` |

PROPFIND live 属性：`DAV:displayname`（路径末段，根为 `/`）、`DAV:resourcetype`、普通文件的 `DAV:getcontentlength`、`DAV:getlastmodified`、`DAV:getcontenttype`（文件为 application/octet-stream，目录为 httpd/unix-directory）、空 `DAV:supportedlock`/`DAV:lockdiscovery`，另有只读 namespace `urn:piwork:files` 的 `kind` 标识 file/directory/symlink/unsupported。不提供 creationdate、getetag、hash 或可编辑 dead properties；显式请求未知/不适用属性返回 propstat 404。空目录的 207 仍包含自身。条目按 UTF-8 字节序排序。文件和XML请求的Content-Encoding仅接受缺省/identity，其他返回415，避免未声明的解压和表示转换。

COPY/MOVE 的 Overwrite 缺省 T，允许 T/F；F 且目标存在返回 412；源目标相同或互为不允许的祖先/子树关系返回 409；源不存在 404、目的父目录缺失 409。替换目标先做路径、类型、规模和权限预检；目录覆盖可涉及删除旧目的树，不承诺整体事务，部分失败返回 207 与失败 href/status，不能报完整成功。所有 mutating 方法禁止以 workspace 根为操作目标；允许从根 COPY 到根外的能力也不提供。

首版不返回 ETag，不提供基于内容版本的乐观锁。存在性条件明确实现：`If-Match:*` 要求资源存在；实体标签型 If-Match 无可匹配 tag，返回 412；`If-None-Match:*` 在 GET/HEAD 已存在时返回 304，在其他方法已存在时返回 412；实体标签型 If-None-Match 无匹配，正常继续。无 If-Match 时才评估合法 If-Unmodified-Since，无 If-None-Match 时 GET/HEAD 评估 If-Modified-Since；无效日期忽略，mtime 使用 HTTP 秒精度。条件针对 Request-URI，目的地另由 Overwrite 控制。提交前重查存在性/时间条件；来自 service 的直接并发写入不受 HTTP 条件锁保护。

### D5. 路径、文件类型与并发提交

按 raw URL 先切分再逐段 percent-decode 一次，严格 UTF-8，不做 Unicode 归一化或大小写折叠。拒绝空中间段、`.`、`..`、NUL、反斜杠、解码后斜杠、非法 percent、非法 UTF-8、XML 1.0 无法表达的控制字符和 query。`%252e` 是字面文件名 `%2e`，后端不得再解码。单段最多 255 UTF-8 字节，相对路径最多 4096 字节、128 层；绝对宿主路径不作为输入。

Python helper 固定打开 `/workspace` root fd；逐段 `open(..., dir_fd=..., O_DIRECTORY|O_NOFOLLOW)`，最终文件用 `O_NOFOLLOW|O_NONBLOCK` 并 fstat 类型，操作使用 dir_fd 版本。每次提交检查持有 parent fd 与当前 root 下同路径解析的 inode 身份，改变则 409；不使用 `realpath` 检查后再按字符串打开。只挂一个 workspace 卷意味着即使目录在同卷内被并发移动，也不能借 fd 越到 agent-private 或宿主。持续变化时失败，不重试未经重新验证的路径。

PROPFIND 对 symlink/特殊项只列出自身类型，不跟随目标；GET、PUT、COPY、MOVE、DELETE 直接指向这些项均返回 409 `FILE_TYPE_UNSUPPORTED`。递归操作预检遇到链接、特殊项或不可表示文件名则在修改前拒绝；不静默跳过。操作开始后新出现的不支持项/权限变化可产生 207 部分失败。已有普通文件的硬链接按路径处理：GET 可读；PUT 原子替换当前目录项而不修改其他硬链接；COPY 产生独立文件；不通过 DAV 创建或保留硬链接关系。

每 Work 同时最多一个文件 mutation，从请求接受到 helper 清理结束持有 writer 槽；其他写入立即 429，不无界排队。读可与写并行，直接 agent/service 写入不被锁住。无条件覆盖以实际完成的提交为准；不提供多文件一致快照。helper 新建文件 0644、目录 0755，uid/gid=10001；PUT 替换保留原文件普通权限位（含执行位，排除 setuid/setgid/sticky），COPY 保留源普通权限位，MOVE 保留源 inode。无权操作则 403，不递归 chown 或授予 root 权限。

PUT 和单文件 COPY 在目标父目录创建 `.piwork-file-<jobId>-<nonce>.tmp`，以 O_EXCL/O_NOFOLLOW 和 0600 打开。Core 在允许创建前持久记录精确目录/名字，helper 创建后返回 dev/inode，Core记录并 ack 才允许写内容。用户业务目录不预留固定隐藏子树；DAV 仅隐藏有已核验任务记录的精确临时 inode，不能按文件名前缀隐藏用户文件。暂存完成后 fsync、记录 prepared、请求 Core 授予 commit；Core 复核会话、Work 门禁和任务 epoch 后持久标记 committing 并发许可，helper 在 parent fd 内提交、fsync 父目录后返回完成。create-only 采用 no-replace 原语，存在则 412；允许覆盖时原子替换。不能以先截断目标再写实现 PUT。

Core 对每个 HTTP 写入不承诺恰好一次，也不接受幂等键模拟上传恢复。commit 已发出后连接断开可能得到完整新文件，客户端应重新查询；commit 未发出则目标不变。未确认清理时 writer 槽和 snapshot 门禁保留；不删除身份不匹配的临时项。Core 崩溃后在新文件访问和 Work 恢复之前确认旧容器退出，再清理精确暂存。若崩溃发生在临时创建而尚未记录 inode的窗口，只有核验该任务容器与精确随机名字均归本任务才能收尾；不能证明归属则 cleanup-pending，禁止猜测删除用户数据。

### D6. helper 通道与可恢复任务

通过 `docker create --interactive` 后 `docker start --attach --interactive` 的 stdin/stdout 交换帧；shell=false、无 TTY、无网络监听。复用 DockerStreamingRunner 的背压，但增加显式容器 stop/remove/inspect，绝不把 stream.abort 当作退出证明。helper 使用 Python 标准库执行 fd 文件操作；Node Core 负责 HTTP/XML，二者只传类型化操作和字节。

协议版本 1：帧为 1 字节 kind + 4 字节大端长度 + payload；DATA 最大 1 MiB，JSON 控制帧最大 64 KiB。Core 到 helper：REQUEST(1，jobId/workId/epoch/action/pathSegments/destinationSegments/depth/overwrite/conditions/range/expectedLength)、DATA(2)、END(3)、ACK(4，暂存身份或 commit 阶段许可)、CANCEL(5)。helper 到 Core：META(17，文件元数据或一条目录项)、DATA(18)、PREPARED(19，phase=temporary|commit 及必要身份)、RESULT(20，状态/计数)、ERROR(21，固定错误码和相对路径)。REQUEST 必须首帧，PUT 必须 END 才能进入 commit；非法长度、顺序、重复 commit 或错误 epoch 立即失败。metadata 和错误不含任意 stderr/宿主路径；Core stderr 只保留受限内部诊断，不转给客户端。

helper EOF、CANCEL、60 秒无进展或总时限到达即停止接收写入并清理/退出；PREPARED 等 ACK 最多 10 秒。Core 同时负责容器回收，即使 Docker CLI 死亡也继续核对容器。所有 mutating 操作在第一次改变用户目标前都经过 commit 许可；PUT 暂存不视为改变最终目标，目录操作只授予一次许可，后续仍受取消与期限约束。

新增 Core store 内部表 `work_file_jobs`：id、work_id、owner_user_id、session_id（内部标识而非 token）、Core epoch、runtime_generation、kind、state、trusted_image_id、volume_name、路径段、accepted/deadline 时间、错误码；子表 `work_file_attempts` 记录每次主执行/恢复清理的确定容器名、id、epoch、创建/退出/移除状态，`work_file_temporaries` 记录精确parent路径、随机名字、dev/inode及清理状态。另设每 Work 的关闭标记/epoch，用同一 SQLite 事务检查生命周期、snapshot 锁、未清理任务和并发名额。状态：accepted -> starting -> running -> prepared -> committing -> finished -> cleaned；任何阶段可到 cancelling -> cleanup-pending/cleaned。读操作跳过 prepared/committing。任务创建先持久化，再调用 Docker；容器名在调用前确定并记录，使迟到创建可按 installation/work/job/epoch 核对。

PUT及COPY的每个暂存项逐项登记/确认，包括递归COPY中的子文件；并发reader只隐藏登记且身份一致的暂存。恢复先停止全部旧attempt，再以同一可信镜像启动有单独attempt记录的cleanup动作；cleanup只接受原job已记录的暂存列表，无用户路径入口，不重放原操作。维护清理可在用户文件门禁关闭、Work stopped时执行，仍受同一卷归属、身份检查和期限限制。原任务cleaned之前必须确认cleanup容器也已移除。正常Core运行时每5秒尝试收尾可重试的Docker错误；10分钟内最多3次（含首次），之后保留诊断，用户修复依赖后可通过现有work stop/retry触发新一轮收尾。身份不符不自动重试删除，诊断说明需核查存储归属。

文件 HTTP 不生成用户可查询的通用 Operation，也不把 journal 导出为 Work 历史。active/cleanup-pending 条目不得 GC；cleaned 条目保留 24 小时后清理，计入 Core 运行记录。未获 commit许可的旧 epoch不能修改最终目标。Core 重启时不恢复传输/不重放写操作：核对日志和带本 installation 标签的 helper，清理旧任务，再开放该 Work 的文件访问及恢复。未知/归属不符容器保留并报告不可用，禁止按名字全局删除。

### D7. 固定 v1 限额与错误

| 限额 | v1 值 |
|---|---|
| HTTP 请求头 | 32 KiB，沿用已有监听器 |
| XML 请求 | 64 KiB，深度 32，请求属性 128 项 |
| 单目录 children / 单递归任务总条目 | 各 10,000（不计 PROPFIND 自身项） |
| 单个元数据/XML 响应 | 16 MiB |
| 单文件 PUT/COPY/GET 总文件长度、单递归 COPY 逻辑字节 | 各 10 GiB；GET 不用 Range 绕过整文件上限 |
| Core / 每用户 / 每 Work 活动 helper | 16 / 8 / 4；每 Work mutation 1 |
| Core 连接建立 / helper 启动或 ACK等待 | 各 10 秒 |
| 无进展 / 单文件请求总期限 | 60 秒 / 30 分钟 |
| 会话与 Work 资格复核 | 活动请求至少每 2 秒 |
| 收尾 | 并入既有 30 秒 drain + 10 秒终止确认；Core 总退出默认仍 45 秒 |

限额进入 capability DTO 与共享 contracts 常量，首版无用户级调参。文件 helper 名额包含 starting、取消和 cleanup-pending；计数不得因本地 socket 关闭提前释放。文件限额与 service 网关连接限额分开，耗尽不占用其名额。文件临时内容计入实际 workspace 磁盘占用；磁盘不足返回 507，不承诺预留整个上传空间。

文件路由失败为 `application/xml; charset=utf-8` 的 DAV:error，含 `urn:piwork:files` 的 code；CLI/Core 产生的文件错误带 `X-Piwork-File-Error: <code>`。HEAD 没有 body。已开始二进制响应后错误只能断开连接，不能追加 XML/JSON。207 中逐项错误按同一映射；错误与日志禁止回显凭据、文件内容、内部卷名或宿主路径。

| HTTP | code / 条件 |
|---|---|
| 400 | FILE_PATH_INVALID、FILE_XML_INVALID、FILE_REQUEST_INVALID、FILE_CONDITION_UNSUPPORTED |
| 401 | LOCAL_AUTH_REQUIRED（本地）；AUTH_REQUIRED（Core 会话） |
| 403 | FILE_ROOT_PROTECTED、FILE_PERMISSION_DENIED、FILE_DESTINATION_DENIED、FILE_DEPTH_UNSUPPORTED；非所有者文件资源统一 404 |
| 404 | NOT_FOUND（未知/其他所有者/已删除 Work），FILE_NOT_FOUND（已授权 Work 内不存在文件） |
| 405 | FILE_METHOD_NOT_ALLOWED（含 Allow） |
| 409 | WORK_FILES_UNAVAILABLE（运行状态不满足）、WORK_SNAPSHOT_BUSY、FILE_CONFLICT、FILE_TYPE_UNSUPPORTED、FILE_NAME_UNSUPPORTED、FILE_CLEANUP_REQUIRED |
| 412 | FILE_PRECONDITION_FAILED（存在性/时间/Overwrite 条件） |
| 413 / 414 | FILE_LIMIT_EXCEEDED（body/目录/递归/文件限额） / FILE_PATH_TOO_LONG |
| 415 / 416 | FILE_MEDIA_UNSUPPORTED / FILE_RANGE_UNSATISFIABLE（含 bytes */size） |
| 429 | FILE_ACCESS_BUSY，Retry-After:1，无排队 |
| 431 | HEADERS_TOO_LARGE |
| 501 | FILE_ACCESS_UNSUPPORTED（CLI连接旧Core未提供整个文件能力） |
| 502 | FILE_BACKEND_PROTOCOL_ERROR；CLI 到 Core 网络失败为 CORE_UNAVAILABLE |
| 503 / 504 / 507 | FILE_HELPER_UNAVAILABLE 或 FILE_RUNTIME_UNAVAILABLE / FILE_TRANSFER_TIMEOUT / FILE_STORAGE_FULL |

认证先于资源可见性，随后检查路径语法、快照/生命周期门禁、后端和限额。缺少文件 helper 的 Work 请求只在所有者认证后返回 503；无论 helper 状态如何，不暴露其他所有者 Work。可查询 capability 不含 Work 列表或卷信息。

CLI专有的非法本地Host/Origin返回403 FILE_REQUEST_DENIED，误投到service的临时Basic返回403 LOCAL_CREDENTIAL_TARGET_DENIED。它们不代表Core会话失效；文件客户端错误头不透传为可信平台错误。

### D8. 停止、切换、退出和导出

Work stop/delete 的目标接受事务、apply 即将切换实例的事务关闭文件门禁并递增 epoch；配置仅保存 desired 不关闭。关闭后不接受新文件请求/新 commit许可。已获许可的请求可在 drain 内结束；未获许可的上传取消并清理。Core 在资格失效后最多 2 秒断开客户端流并开始取消，停止完成前必须确认每个 helper 已退出、迟到创建已解决、暂存已清理。停止、删除、apply 与 Core 退出的文件收尾共享各自操作的绝对截止时间，按 Work/attempt 有界并行，不把单次 Docker 调用的期限逐任务相加；文件收尾并入既有 30 秒 drain、10 秒终止确认及 45 秒 Core 退出总预算。截止时间到达而退出或清理仍未确认时保留 journal 和 cleanup-pending，报告操作失败或 Core 非零退出，不报告 stopped/deleted/新实例 ready，也不阻止对 agent/service 的独立停止尝试。

GET 等只读 helper 也必须回收；不因其只读而留下生命周期外容器。正常请求只返回 mutation 成功前必须已得到 RESULT、fsync结果并确认容器结束；提交后最终未能确认 helper 移除时保留 cleanup-pending，HTTP 返回 409 FILE_CLEANUP_REQUIRED，即使底层 Docker 错误属于运行依赖故障也不以 503 掩盖待清理状态。目标可能已经完整提交，不能描述为回滚；待清理解决并恢复文件访问后，客户端可重新查询实际文件结果。客户端断开不使 Core忘记任务。

Core graceful shutdown 关闭全局文件门禁，在现有 Work shutdown预算内并行收尾；文件恢复后台任务也受同一退出截止时间约束，不得在生命周期收尾前无界等待。超时非零退出并保留恢复记录。异常恢复先回收旧文件任务，再进行普通 Work 自动恢复或 snapshot 恢复执行。若某 Work清理未确认，该 Work保留阻塞，其他 Work与 service功能不扩大授权也不全局停用。

export admission 在现有原子锁事务中额外检查没有未 cleaned 文件任务；preflight 按 Docker 标签检查没有 file-helper（包括迟到/孤儿）且暂存已收尾。持久任务未清理返回 409 WORK_BUSY，实际仍运行的 file-helper 返回 409 SNAPSHOT_REQUIRES_STOPPED，Docker 状态不可确认返回 503 SNAPSHOT_RUNTIME_UNAVAILABLE；已退出但仍残留的 helper 仍阻止导出并返回 409 WORK_BUSY。snapshot 锁与文件请求接受/提交共享同一 Work 门禁；即使 observed 误为 stopped 也不能边写边导出。清理失败不删除未知用户文件来换取导出成功。导出包含正常 workspace内容；不新增 portable 字段、不把 helper镜像、临时认证或文件 journal 当 Work数据。import 发布后仍 stopped；按导入后的新 workId 显式 start 后访问。

### D9. 验证与交付组织

- 新 capability `work-file-access` 定义 WF-001..WF-007；相关增量位于 proposal 列出的五个现有 capability。
- 单元与 HTTP 测试覆盖严格路径/编码、XML、条件/错误、大小边界、代理路由和 header 隔离；使用现有 `node:test`，Python文件原语测试纳入 helper workspace test:unit。
- runtime-docker integration 使用真实镜像核对 user/capabilities/network/mount/labels、退出证明、取消及迟到创建；真实卷竞争测试反复替换父目录与 symlink，验证不能越界。
- 新 `scripts/work-files-acceptance.mjs` 需要 Docker、显式 `PIWORK_FILE_HELPER_TEST_IMAGE`、现有 snapshot测试镜像与 rclone；缺少依赖使专用验收失败，不静默跳过。rclone 使用 vendor=other、原样指定本地 URL/Basic；脚本记录 rclone版本并通过临时受限配置文件传入密码，不在命令行/日志输出真实凭据。
- 验收普通文件、空目录、中文/空格/%/#/隐藏文件、至少 16 MiB流式文件、单Range、完整基本操作和两Work隔离；以客户端重新下载的 SHA-256 校验字节，不依赖服务器hash能力。
- 集成停止/取消/崩溃恢复、旧 Core/缺helper兼容、旧 pi-agentd镜像仍可用、单proxy混合service/DAV流量。完成 stop/export/import/start 后按新 Work ID下载对比；复用现有snapshot验收防止完整性回归。
- 故障注入覆盖多个迟缓 helper 的共享停止/退出期限、提交后容器移除持续失败的 409 响应、实际运行与已退出残留 helper 的快照错误码，以及大小写变化的 Basic 方案误投到 service；修复后重跑跨模块门禁。
- 发布文档说明应用需真实写入workspace、文件下载与数据库备份边界、方法/限额、错误恢复以及本地临时凭据；不把通用client验收扩写成Finder/Windows系统挂载支持。

## Risks / Trade-offs

- 每请求启动容器增加延迟：首版换取清晰的权限和回收边界，设定并发/期限；不在本次引入池化协议。
- 直接 agent/service 写入不受 WebDAV writer 槽保护：不提供全局文件锁/内容版本保证，读写竞争按实际变化失败或最后提交处理，业务一致性使用停机导出或应用备份。
- GET流中直接修改文件可产生不一致内容：长度/元数据前后变化可检测时中断，不宣称覆盖所有并发修改；验收数据校验使用静止测试文件。
- 原子上传暂存位于共享卷：精确任务/inode跟踪，拒绝不确定清理；未知文件绝不按通配删掉。此保护可能使异常 Work 保持 cleanup-pending，诊断必须明确。
- WebDAV传输子集兼容范围有限：不发送未实现的DAV class承诺，固定rclone真实验收与协议矩阵；无锁/无属性持久化在文档列明。
- 多层认证容易误判错误：本地Basic、Core Bearer、应用Authorization分别测试；只由可信Core的401会话失效终止proxy。

## Migration Plan

1. 先构建平台文件 helper 镜像并设置 `PIWORK_FILE_HELPER_IMAGE`，升级 Core；内部 Core DB作增量迁移，不改 Work卷/context或 `.work`。
2. Core升级即能向当前卷布局的旧Work提供接口，无需重新部署service或升级pi-agentd；不支持的历史混合卷布局明确拒绝。
3. 升级CLI后复用原 `proxy` 命令；旧CLI继续仅提供service代理。新CLI连接旧Core显示WebDAV不可用，现有service仍可访问。
4. 部署异常时可先禁用文件helper配置并重启Core，但仍执行已有journal恢复/清理。彻底回滚旧Core前必须先由新版确认所有文件任务cleaned、helper已移除，并遵守现有Core DB版本兼容规则；禁止在未知写入者存在时直接降级。用户workspace保留。

## References

- [RFC 4918](https://www.rfc-editor.org/rfc/rfc4918.html)：作为方法、Depth、Destination、Multi-Status与能力声明的协议基准；本变更的支持矩阵明确限定实现子集。
- [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)：作为HTTP条件请求、Range与状态语义基准。
- [rclone WebDAV](https://rclone.org/webdav/)：通用vendor配置与真实文件传输验收入口；不依赖供应商扩展属性。
