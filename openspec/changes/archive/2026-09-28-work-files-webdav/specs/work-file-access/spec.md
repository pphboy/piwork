## Purpose

为 Work 所有者提供由 Core 独立管理的 workspace WebDAV 文件传输能力，使通用客户端能通过现有 CLI proxy 访问真实持久文件，并明确运行状态、协议子集、路径隔离、资源限额和失败行为，为文件持久化与冷快照闭环提供可验证的访问契约。

## ADDED Requirements

### Requirement: 提供独立于 agent 的 Core 文件访问入口

**Identifier:** WF-001

Core SHALL 提供用户认证的 `GET /api/v1/file-access`，返回 version=1、protocol=webdav、profile=workspace-transfer-v1、available、reason、rootTemplate=`/api/v1/works/{workId}/files/` 及 WF-006 固定限额。可信文件后端未配置或不可用时 available=false、reason=FILE_HELPER_UNAVAILABLE；此状态 MUST NOT 使既有 Work 管理或 service 访问失效。

Core SHALL 在 `/api/v1/works/<workId>/files/` 提供 WebDAV，根对应整个 workspace 卷，即 pi-agentd/service 内的 `/var/data/workspace`。文件请求 SHALL 使用用户 Bearer 并按 WACC-FILES-001 校验所有者；客户端不能选择 Docker 卷、宿主路径、其他身份或存储后端。仅 desired=running、observed=ready/degraded、未删除且当前运行实例已核验、文件门禁开放的 Work 可访问；其他已授权 Work 返回 409 WORK_FILES_UNAVAILABLE，运行依赖无法核验返回 503 FILE_RUNTIME_UNAVAILABLE。接口 MUST NOT 隐式 start/apply、调用模型或要求 pi-agentd 新增文件协议。授权后的根缺少尾斜杠返回 308 到同 Work 带斜杠根；不存在跨 Work 聚合目录。

#### Scenario: 旧 agent 镜像的当前布局 Work
- **WHEN** 所有者访问采用当前 workspace 卷布局、已正常运行但 pi-agentd 未实现文件 RPC 的 Work
- **THEN** Core 通过自身文件能力提供文件访问，无需升级 Work 镜像、创建用户 service 或改变 Work 配置

#### Scenario: 没有 service 或可选 service 失败
- **WHEN** Work 为 ready/degraded，workspace 存在且其他准入条件满足
- **THEN** 仍能访问文件，不要求创建 WebDAV service 或让某个应用 service 就绪

#### Scenario: 停止和未核验状态
- **WHEN** 所有者访问 stopped、starting、stopping、尚未恢复核验或正在实例切换的 Work
- **THEN** 请求失败且不触发隐式启动、重建或写入

#### Scenario: 文件后端不可用
- **WHEN** Core 未配置兼容文件后端，用户查询 capability 并访问自己的文件
- **THEN** capability 显示不可用，文件请求返回 503 FILE_HELPER_UNAVAILABLE，现有 service 网关保持可用

### Requirement: 提供有界且准确的目录与属性查询

**Identifier:** WF-002

OPTIONS SHALL 返回 200 与准确 Allow，不宣称未实现的 DAV class 1/2/3。PROPFIND SHALL 支持 Depth 0/1、空 body/allprop、propname、prop 与 include，返回 207；缺省 Depth 或 infinity 返回 403 FILE_DEPTH_UNSUPPORTED 并包含 DAV:propfind-finite-depth，其他非法值返回 400。空目录 SHALL 包含自身条目；子项按 UTF-8 字节序排序，隐藏用户文件和任意普通目录不得因 apps/data 布局过滤。

live 属性 SHALL 提供 DAV:displayname、resourcetype、getlastmodified、getcontenttype、普通文件的 getcontentlength、空 supportedlock/lockdiscovery，以及 namespace `urn:piwork:files` 的 kind（file/directory/symlink/unsupported）。根 displayname 为 `/`；普通文件 content type 为 application/octet-stream，目录为 httpd/unix-directory。未知或不适用属性（含 creationdate/getetag）SHALL 在 propstat 中返回 404，其他成功属性保持 200。所有 href SHALL 按段编码并限定在请求的同 Work 根，collection href 带尾斜杠；文件名 SHALL XML 转义。PROPPATCH SHALL 对存在目标返回 207 和逐属性 403，不持久化属性，不伪报修改成功。

#### Scenario: 空目录和隐藏内容
- **WHEN** 客户端分别列出空目录和含 `.env`、中文、空格文件的目录
- **THEN** 空目录返回自身；另一目录完整返回合法用户条目，名称与路径可往返还原

#### Scenario: 部分属性不支持
- **WHEN** 客户端同时请求 getcontentlength 和未支持的 getetag
- **THEN** 普通文件长度出现在 200 propstat，getetag 出现在 404 propstat，不使整个合法请求失败

#### Scenario: 无限深度请求
- **WHEN** PROPFIND 缺少 Depth 或显式指定 infinity
- **THEN** 返回有限深度错误，不在后台遍历整个 workspace

#### Scenario: 客户端尝试修改 mtime 或扩展属性
- **WHEN** 客户端提交合法 PROPPATCH
- **THEN** 返回逐属性拒绝，文件内容和文件系统元数据不改变

### Requirement: 流式传输文件并明确条件与覆盖行为

**Identifier:** WF-003

普通文件 GET/HEAD SHALL 返回原始文件字节或对应无 body 元数据，包含 Content-Length、Last-Modified 和 Cache-Control:no-store；目录 GET 返回 405，目录 HEAD 返回 200 无 body。GET SHALL 支持单段 bytes range，成功 206，不可满足或多段请求 416 并含 `Content-Range: bytes */<size>`；有 If-Range 时返回完整 200，不宣称跨修改版本的续传一致性。

PUT SHALL 支持 Content-Length 与 chunked 完整文件上传，新建 201、替换 204，父目录缺失 409、目录目标 405、Content-Range 400；不得自动创建父目录。上传 SHALL 遵守 WSTOR-FILES-002 的提交和清理规则。二进制 body SHALL 背压传输，不能经过 JSON/Base64 或整体内存缓冲；Content-Encoding 除缺省/identity 外返回 415。GET/PUT 的字节不得经过日志脱敏而改变内容。

接口 SHALL 不返回 ETag。If-Match:* 要求目标存在，其他实体标签 If-Match 返回 412；If-None-Match:* 对存在目标的 GET/HEAD 返回 304，对其他方法返回 412，非匹配实体标签列表不阻止请求。无 If-Match 时评估合法 If-Unmodified-Since；GET/HEAD 无 If-None-Match 时评估合法 If-Modified-Since，使用 HTTP 秒精度，无效日期忽略。条件不满足返回 412；覆盖前再次检查条件。非法条件语法返回 400。WebDAV If/Lock-Token 条件返回 400 FILE_CONDITION_UNSUPPORTED。无条件覆盖不提供内容版本保护。

#### Scenario: 大文件和空文件
- **WHEN** 所有者上传零字节或至少 16 MiB 的合法文件，再下载
- **THEN** 创建/替换状态正确，下载字节与上传一致，大文件不触发普通 JSON 限制

#### Scenario: 存在性条件避免覆盖
- **WHEN** 两个请求先后使用 If-None-Match:* 上传同一路径
- **THEN** 最多一个创建成功，后一个返回 412，先前内容保持完整

#### Scenario: 时间条件或缺少可匹配 ETag
- **WHEN** 目标的 mtime 晚于 If-Unmodified-Since，或客户端发送实体标签型 If-Match
- **THEN** 写入返回 412，不修改目标，响应不伪造 ETag

#### Scenario: 单段读取与无效范围
- **WHEN** 客户端请求合法中间段、后缀段或超出文件长度的范围
- **THEN** 前两者返回准确 206 字节与 Content-Range，后者返回 416

#### Scenario: 数据流中后端失败
- **WHEN** GET 已发送二进制数据后发生后端故障
- **THEN** 连接中断，不在文件尾部附加 XML/JSON 错误或伪报完整传输

### Requirement: 支持同 Work 的目录和命名空间修改

**Identifier:** WF-004

MKCOL SHALL 仅创建单层空目录，成功 201、已存在 405、父目录缺失 409、非空 body 415。DELETE SHALL 删除普通文件或递归目录，成功 204、不存在 404；目录仅支持缺省/infinity Depth，其他值 400。COPY/MOVE SHALL 只操作同一 Work 根内普通文件/目录；Destination 必须同源、同 Work、无用户信息/query/fragment，外部或跨 Work 目标返回 403 FILE_DESTINATION_DENIED，不能建立外部连接。

COPY/MOVE SHALL 支持 Overwrite T/F、缺省 T，新建目标 201、覆盖 204，F 且目标存在 412；不存在源 404、缺少目的父目录 409、源目标相同或目标造成祖先/子树循环 409。COPY collection 支持 Depth 0 或缺省/infinity；MOVE collection 支持缺省/infinity，其他 Depth 400。所有修改方法 SHALL 保护 workspace 根并返回 403 FILE_ROOT_PROTECTED。目录覆盖/递归修改 SHALL 先预检已知类型与规模；实施后的部分失败返回 207 与失败路径，不承诺整体回滚。LOCK/UNLOCK 与其他未实现方法 SHALL 返回 405 和 Allow。

#### Scenario: 创建并整理目录
- **WHEN** 客户端建目录、复制文件、移动目录，最后删除测试树
- **THEN** 每一步返回实际结果，agent/service 通过同卷看到对应变化

#### Scenario: 覆盖与禁止覆盖
- **WHEN** COPY/MOVE 的目的地已经存在，分别指定 Overwrite T 和 F
- **THEN** T 按规定覆盖，F 返回 412 且保留原目标

#### Scenario: 跨 Work 或外部 Destination
- **WHEN** 请求将文件移动到另一个自有 Work、其他用户 Work 或公网 URL
- **THEN** 返回 403，不改变任一目标，不使用 Destination 发起外部请求

#### Scenario: 递归操作部分失败
- **WHEN** 删除或复制过程中某个子项权限发生变化
- **THEN** 返回 207 标识失败子项，已完成部分如实保留，不将操作描述为原子回滚或完整成功

#### Scenario: 根目录与文件锁
- **WHEN** 客户端试图删除根或执行 LOCK
- **THEN** 前者返回 403，后者返回 405；workspace 根存在且未创建伪锁

### Requirement: 以明确的路径和文件类型边界访问 workspace

**Identifier:** WF-005

相对路径 SHALL 按原始 URL 分段并解码一次，保留 Unicode 字节、大小写及合法字面 `%`；拒绝 `.`、`..`、中间空段、NUL、反斜杠、解码后斜杠、非法 percent/UTF-8、XML 1.0 不支持的字符和 query。系统 SHALL 防止父目录被替换、符号链接竞争或伪造路径造成根外访问，不能只做字符串前缀检查。单段最多 255 UTF-8 字节、总相对路径 4096 字节、128 层。

PROPFIND SHALL 将 symlink/特殊项显示为自身类型，不解引用；直接 GET/PUT/COPY/MOVE/DELETE 这些项返回 409 FILE_TYPE_UNSUPPORTED。递归操作预检发现这些项或不可表达文件名时 SHALL 整体拒绝，不静默跳过。普通文件硬链接可读取，但 PUT 替换当前路径、COPY 创建独立普通文件，不承诺保持硬链接关系或完整 POSIX 元数据。

#### Scenario: 编码与中文往返
- **WHEN** 文件名含中文、空格、`%` 或 `#`，客户端按 URL 编码访问
- **THEN** 指向原文件；`%252e` 仅解码成字面 `%2e`，不再次解释成路径控制字符

#### Scenario: 路径穿越和替换竞争
- **WHEN** 请求含编码穿越，或并发进程将父目录替换为指向根外的 symlink
- **THEN** 请求失败或仍限制在合法卷内，不能读写 agent-private、宿主或其他 Work

#### Scenario: 开发目录含链接
- **WHEN** 列出含 symlink 的目录，再对链接读取或递归复制该目录
- **THEN** 列表显示链接自身类型，读/递归复制明确失败，不泄漏链接目标内容或静默少拷文件

#### Scenario: 硬链接文件被覆盖
- **WHEN** 两个路径原本为硬链接，WebDAV PUT 覆盖其中一个
- **THEN** 当前路径获得完整新内容，另一路径保留原内容，文档不宣称 DAV 保持硬链接关系

### Requirement: 对文件访问实行有界传输和可区分错误

**Identifier:** WF-006

v1 SHALL 限制 HTTP 头 32 KiB、XML请求64 KiB/深度32/属性128项、metadata/XML响应16 MiB、目录children与递归操作总条目各10,000、单文件总长度与递归COPY逻辑字节各10 GiB；Range 不绕过整文件上限。Core/每用户/每Work 活动文件任务最多16/8/4，每Work最多1个mutation，包含启动中、取消和待清理任务；超额返回429 FILE_ACCESS_BUSY与Retry-After:1，不无界排队，不占用service网关连接名额。连接建立与helper启动/确认各最多10秒，无进展60秒、请求总时限30分钟，资格复核间隔最多2秒。

文件错误 SHALL 用 DAV:error XML、安全 code 和 X-Piwork-File-Error 表示；HEAD没有body。400表示非法路径/XML/条件，401表示相应认证失败，403表示根/权限/目的地/深度限制，404表示不可见Work或缺失文件，405表示方法限制，409表示Work状态/快照/清理/类型/冲突，412表示条件失败，413表示内容或数量超限，414表示路径超长，415表示不支持的媒体编码，416表示范围错误，429表示并发限制，431表示请求头超限，502表示后端协议或CLI上游失败，503表示helper/运行依赖不可用，504表示超时，507表示磁盘不足。错误中的具体code与design D7表保持一致；207逐项失败使用相同映射。MUST NOT 在普通日志或错误中回显文件内容、凭据、卷名、宿主路径；已开始的数据流错误只能关闭连接。

#### Scenario: 超限上传或目录
- **WHEN** 上传声明/实际超过10 GiB，或目录children超过10,000
- **THEN** 返回413，不发布半文件或截断后冒充完整目录列表

#### Scenario: 并发写入与资源占用
- **WHEN** 一个Work有尚未清理的写任务，又收到写请求
- **THEN** 新请求返回429，名额直到原任务确认收尾才释放，其他Work和service名额仍独立计算

#### Scenario: 文件传输超时或磁盘不足
- **WHEN** 请求60秒无进展、总时限到达或存储满
- **THEN** 分别得到504或507（已开始响应则断流），请求停止并进入可恢复清理，不能继续后台无限写入

#### Scenario: 非法 XML
- **WHEN** XML包含DTD/外部实体、过深结构、过大body或非法命名空间结构
- **THEN** 请求被拒绝，不读取实体目标、不发起网络请求，资源保持不变

### Requirement: 文件执行资源由 Core 独立托管

**Identifier:** WF-007

系统 SHALL 将文件执行资源作为平台内部资源独立部署与管理，使用平台配置的可信兼容镜像；用户请求和Work配置不能选择镜像。每个执行资源只能挂载请求所属Work的workspace，按操作限定读写，以共享uid/gid=10001运行，无公共端口、无网络、无特权、无Docker socket、无私有卷和控制面凭据。文件资源 SHALL 不出现在用户service列表、不消耗service数量配额、不进入Work配置或portable镜像集合。

所有执行资源 SHALL 有可恢复归属记录，创建、取消、进程退出和资源移除结果必须核验；客户端断开或启动调用超时不能使平台遗忘仍可能存在的容器。不可确认归属或清理时 SHALL 返回明确不可用/待清理结果并遵循WLIFE-FILES-002。文件能力的可信镜像不可用时不回退到agent或用户service执行。

#### Scenario: 核验后端隔离
- **WHEN** 执行一次文件写入并检查平台创建的运行资源
- **THEN** 只挂本Work workspace，以共享身份运行，无额外持久卷或网络入口，service列表和Work配置不增加条目

#### Scenario: 启动超时但容器迟到出现
- **WHEN** 后端创建调用超时后资源实际创建完成
- **THEN** Core仍按持久归属回收它，不把HTTP失败当作资源不存在证明

#### Scenario: 文件功能未配置
- **WHEN** 平台没有兼容文件镜像但Work及service仍运行
- **THEN** 只拒绝文件能力，不要求agent部署替代service，也不停止已有应用
