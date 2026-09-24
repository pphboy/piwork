# Design

## Context

See proposal.md — Why。已确认产品边界：完整、不做用户内容过滤、包含开发环境、显式停机冷快照；平台身份新建，平台托管凭证不复制。本设计是新增恢复路径，不把当前内部数据库结构直接宣布为通用 Work Spec。

本次收敛后的主线是整体备份与恢复，不是建立通用迁移协议。用户只需停止、指定 Work 导出、指定 `.work` 文件导入、显式启动；实际内容全部随包走。模型由目标 Core 自动解析并注入目标凭证，内置 `work-services` 使用目标 Core 新生成的服务控制身份。下文格式、校验和身份适配均为实现细节，不要求用户理解或填写 bindings。控制历史是只读归档，不转换为可执行的新请求；不再实现逐 Operation kind 的 request/result/error 迁移器。

检查到的落点与约束：
- DockerRuntime.ensureContainer 使用只读 rootfs、10001 用户（agent/service 显式指定）、no-new-privileges，/tmp 为 tmpfs；Dockerfile.agentd 的 HOME=/var/data。开发环境可分解为固定 image 和两个持久卷，不需要容器 commit。
- DockerWorkRuntime.prepare/start 分开管理 work-private (/var/data) 与 work-workspace (/var/data/workspace)，context 在 /run/piwork 只读挂载；TLS 与模型 key 是独立受控 bind mount。
- WorkContextStore 保存 contexts/<snapshotId>/{config.json,metadata.json,AGENTS.md,skills/}；metadata 的 workId/snapshotId 强绑定；Core cleanupOrphans 根据记录清理文件。因此导入上下文必须在恢复 journal 保护下建立，不能先写孤儿目录再寄希望于下一次启动。
- 本变更起点为 Core schema=6、Work schema=3；Core 增量 schema=7 已在实施中落地。Core 持有 works/config revisions/context snapshots/service revisions/heads/operations/quota reservations；Work sqlite 持有 sessions/runs/events/幂等/work_activity。不能复制整份 core.sqlite，不能在导入初期先创建一个可运行 works 行。
- AgentSessionService.requireRecord 拒绝 context 不匹配，SDK history 在 /var/data/sessions。继续旧 Session 必须映射 context；原本因 apply 而失配的历史不在本变更中修复。
- Runtime catalog 使用全局 agentImage.catalogId/modelRef，配置验证还要求全局 Skill 存在；导入要增加 Work-owned 解析路径，否则导入成功后一次无关配置修改就会失效。
- CoreApplication 是正式 HTTP 入口，readJson 限制 1 MiB；DockerCommandRunner 当前为字符串缓冲接口。两者都不能直接承载大包。
- 现有 CLI service 功能仍在未归档变更中，作为当前代码基线保留，不修改其 create/update 边界。
- 参考镜像传输边界：[Docker save](https://docs.docker.com/reference/cli/docker/image/save/) 保存镜像层；[Docker load](https://docs.docker.com/reference/cli/docker/image/load/) 会恢复 tags。因此必须构造无 tags 的受检镜像归档，而非直接加载任意上传 tar。

## Goals / Non-Goals

**Goals:** 用一个可验证、版本化的内容闭包作为 Work 扩展基础；平台元数据允许定点映射，用户字节保持；跨用户/同安装双副本/另一安装均可恢复；大文件流式；每个崩溃点都能证明“未发布或完整发布”。

**Non-Goals:** 不新建市场/发布者信任系统，不做包签名/加密/压缩/增量，不引入通用插件执行机制；不改 agent SDK 的旧 Session context 策略；不实现新 secret 管理产品、远程数据迁移、image build/commit 或跨架构运行。第一版不是“所有 Linux 文件系统对象的位级磁盘镜像”。

Work 的可移植边界采用现有产品持久语义，而非 Docker 容器镜像：用户字节在 agent-private 与 workspace 两个受管卷及保留 context 树；Core 的 Work-scoped 持久状态由配置/服务版本、受管卷引用、资源预留、历史和固定镜像清单表达。service 的可持久业务数据只在获准 workspace 内；容器临时可写层、镜像声明产生的匿名卷、tmpfs、进程与连接不是 Work 持久数据，不能在导出成功说明中声称被搬迁。平台用户/权限、运行代次与资源 ID 不原样复制，而是导入后按下文映射。这个边界沿用现有 work-storage/work-services 合约，不新增用户筛选开关。

## Decisions

### 1. Work 清单与完整快照

新增 packages/contracts/src/control/portable-work.ts 和 work-snapshots.ts，TypeBox 严格 schema；新增 packages/work-package 纯数据编解码库。现有 WorkConfig/ServiceDefinition 对普通请求不变。PortableWorkSpec 不直接复用原始数据库行或 RuntimeProfile。

模型用包内逻辑 key 表达关系，格式固定为 [a-z][a-z0-9-]{0,63}，禁止把 key 当成宿主路径。按源记录稳定排序分配 c-000001、s-000001、i-000001、m-000001、k-000001；逻辑 key 不是平台 ID。用户名/名称沿用原合约并以 JSON 字符串表示。

Manifest 所有字段均必需（明确标为 nullable 的除外），unknown fields 拒绝：
| Field | v1 representation |
| --- | --- |
| formatVersion / snapshotKind | 1 / cold-full |
| createdAt / sourceName | 包生成的 RFC3339 UTC 时间 / 导出时的源 Work name；不是目标实例的创建时间/名称 |
| compatibility | {os:"linux",architecture,variant:string-or-null,agentProtocol:"v2",workHistorySchema:3,storageLayout:2} |
| activeContext / desiredContext | context key-or-null / context key |
| contexts | sorted Context[] |
| services | sorted Service[]，包含 tombstone |
| quotaReservations | agent 与全部保留 service 的持久预留，顺序为 agent 后按 service key 排序 |
| volumes | 恰好 [{role:"agent-private",tree:blobRef,serviceRefKeys:[]},{role:"workspace",tree:blobRef,serviceRefKeys:sorted service keys}]；Work 对两个卷的引用隐含存在 |
| images | sorted Image[] |
| bindings | {models:ModelRequirement[],secrets:SecretRequirement[]}；仅作为现有 v1 包内依赖描述保留，不是导入请求参数 |
| history | {control:blobRef,sourceIdentityMap:blobRef} |
| blobs | 按 SHA-256 小写 hex 字典序排序的唯一 {digest,size,kinds}[] |

blobRef 是 64 位小写 SHA-256 hex，size 是非负安全整数；kinds 为非空、去重、有序 enum 数组，固定顺序 file、tree、control-history、identity-map、image-config、image-layer。相同 digest 的重复内容仅保存一次，kinds 是全部引用用途的并集；每个引用端仍按对应 schema 验证，不能靠 hash 相同绕过类型校验。

Context={key,createdAt,configuration,skillsTree,agentsBlob,imageKey}。configuration 保留 WorkConfig 的 resources/tools/mcpServers/skills 顺序；移除 agentImage/modelRef/agentsMd，替换为 modelBindingKey；mcpServers.requiredServiceId 换成 requiredServiceKey，secretRefs 的 secretId 换成 bindingKey，key 字段保留。imageKey 对应固定 image，AGENTS 字节与 UTF-8 内容一致。skillsTree 是该 context 的完整 Skill 根树，不能指向接收者全局库。

Service={key,name,desiredRevision,appliedRevision:null-or-int,enabled,tombstonedAt:null-or-time,revisions:[{revision,createdAt,definition,imageKey:null-or-key}],recovery:{count,windowStartedAt,nextRetryAt,readySince},sourceObservation:{state,lastError}}。definition 为去掉 serviceId/revision 的规范化 ServiceDefinition，image.reference 原文保留，固定镜像由 imageKey 决定。revisions 按数字排序且 heads 引用有效；删除仍保留 name 和历史，lastError 不用于执行。

QuotaReservation={subjectKind:"agent"|"service",subjectKey,desiredCpuMillis,desiredMemoryBytes,serviceSlots,volumeSlots}；四个数值均为非负安全整数。agent 行的 subjectKey 固定为 "agentd"，恰好一行；每个清单 Service（包括 tombstone）恰好一行，subjectKey 是其逻辑 service key；不允许额外行、重复行或悬空引用。导出从本 Work 的 quota_reservations 读取这些持久值，不从 enabled、当前 definition 或历史 revision 反推：例如 disable 已接受但运行时 stop 失败后，service 可为 enabled=false 而 desiredCpuMillis/desiredMemoryBytes 仍非零。source 的 occupiedCpuMillis/occupiedMemoryBytes 是运行实例计数，updatedAt 是平台记账时间，均不进入可移植清单；导入新实例对应 occupied 值固定为 0、updatedAt 为目标提交时间。这不要求源的 occupied 计数为零，也不改变第 7 节已有的实际容器停止预检。v1 尚未作为完整导入导出功能交付；当前开发中的 v1 fixture/schema 随此必需字段更新，缺少该字段的原型包按 PACKAGE_INVALID 拒绝，不补默认值。

Volume.serviceRefKeys 保存当前 Core volume_references 中消费 workspace 的全部 service 逻辑 key，包括 tombstone 后清理失败而仍持有引用的 service；不从服务的最新 mount 定义或 tombstone 推断。agent-private 的该数组必须为空，两个卷都隐含一个 Work 引用。导出核对 source volume_records 为本 Work 恰好两个未 purged 且 state=active 的受管卷、role/安装归属/实际卷身份一致、reference_count 与实际引用数一致，且引用仅为各自 Work 引用与 workspace 的清单 service 引用；已 purged 记录是已清除数据，不入包。发现额外未清除卷、缺卷、私有卷被 service 引用或悬空消费者时，以 SNAPSHOT_STORAGE_UNSUPPORTED/UNREADABLE 失败，不宣称完整成功。目标只创建两个新卷，按映射重建上述引用并由引用数计算 reference_count；不复制源卷 ID、Docker 名称、创建时间或已清除记录。与 quotaReservations 一样，这些字段是持久关系而非运行占用。

Image={key,imageId,platform:{os,architecture,variant},config:blobRef,layers:blobRef[]}。imageId 是 image config 原始 JSON 字节的 sha256；layers 按 config.rootfs.diff_ids 原序，每项是解压后的原始 layer tar 字节，其 digest 必须等于 diff_id；同层跨镜像去重。保留 config 全文（包含镜像环境与 labels），不执行它。源未解析服务 revision 的 imageKey=null，不制造镜像；所有非 null 引用必须具备 config 和全部层。

ModelRequirement={key,provider,model,baseUrl:null-or-string}，不含 catalogId/credentialRef；SecretRequirement={key,uses:[{contextKey,serverId,key:null-or-string}]} 不含源 secretId/path/value。每个不同源 catalog/secret reference 仍建立一个包内逻辑 key，不能因显示名相同就合并。包内字段名称 `bindings` 保持 v1 格式不变，以便已经生成的无自定义 MCP secret 的 `first.work` 可被新版读取；导入 API/CLI 不再接受用户填写映射。sourceIdentityMap 仅保存 sourceWorkId/contextId/serviceId/operationId 到逻辑 key，供历史定点处理，不保存用户登录身份/安装证书。

control-history 是当前原生记录的只读备份，不是逐 kind 转换的通用 Operation 协议。它只收集本 Work 的记录，不复制 core.sqlite 或 users/catalog/secrets 等平台表。RuntimeProfile 不在历史归档中，运行所需 image 来自包，model 按包内 provider/model/baseUrl 要求由目标 Core 自动解析并捕获目标 credentialRef。当前 export 自身 Operation/锁不属于捕获前的历史，排除该任务；更早的终态 snapshot Operations 和已导入历史仍保留。

为使实现无需再发明存储结构，两个内部 metadata blob 固定如下；所有外层字段必需、未知字段拒绝，空集合为 []。这只是快照读写布局，不增加用户配置项：

| Blob / record | 精确字段 |
| --- | --- |
| control-history | {version:1,work:{name,createdAt},configurationRevisions:[{revision,contextKey}],operations:OperationRecord[],idempotency:ArchivedIdempotency[]} |
| OperationRecord | {id,workId,serviceId,kind,state,targetVersion,requestJson,resultJson,errorJson,createdAt,updatedAt}，字段类型沿 packages/core-store/src/store.ts 的同名接口；state 仅 succeeded/failed/superseded |
| ArchivedIdempotency | {principalKey,principalKind,workScope,operationKind,idempotencyKey,requestDigest,resourceId,operationId,createdAt} |
| sourceIdentityMap | {version:1,sourceWorkId,contexts:[{sourceId,key}],services:[{sourceId,key}],operations:[{sourceId,key}]} |

OperationRecord 的 id/workId/serviceId 是导出实例的受管 ID；workId 必须等于 sourceWorkId（原生 create-work 的空 workId 在采集时由其 idempotency resourceId 关联后填入），serviceId 可为 null，否则必须在映射表中。id/sourceId/sourceWorkId 使用 ResourceIdSchema，kind 非空且最多128字符，targetVersion/revision 为正安全整数，时间使用 TimestampSchema。requestJson 为字符串，resultJson/errorJson 为字符串或 null，三者作为不透明的原生记录内容逐字保存，不解析后改写、不按 kind 拒绝、不用于运行或绑定。原文中的旧 catalog/secret reference ID 只是历史文字，不授予平台访问能力；平台 secret 值、credentialRef、宿主凭证路径不从 RuntimeProfile 或全局表采集。新增 snapshot Operation 的持久请求/结果也不得嵌入这些平台材料。用户原本写入请求内容的凭证副本仍属于不做过滤的用户内容。

ArchivedIdempotency 的 principalKind 为 owner/admin/agent，principalKey 是按源主体稳定排序分配的 p-000001 类逻辑 key；不保存源账号 ID、不查询或恢复主体权限。owner 指本 Work owner，agent 指 work-agent:<sourceWorkId>，其他获准控制主体归为 admin，仅表示来源类别。其余字符串字段沿现有 idempotency_records 保存值，operationId 必须指向本归档 Operation，operationKind 必须与其 kind 一致；workScope 保留原字符串（包括 sourceWorkId、new-work 及新导入任务的接受作用域），只作为历史而不恢复 live scope。resourceId 只允许本 Work 或映射内 service，requestDigest 为原有64位hex摘要。空 operation_id 的无关联记录不能被当作本 Work 历史猜测采集。

configurationRevisions 按 revision 排序并完整引用清单 contexts；operations 按 id 排序，idempotency 按 principalKey/workScope/operationKind/idempotencyKey 的 UTF-8 字节顺序排序。映射数组按 sourceId 排序，sourceId/key 在各自集合唯一，context/service 与清单一一对应，Operation key 以 o-000001 分配且与归档记录一一对应。缺失运行配置或映射引用仍整体失败，不能补默认值。历史 JSON 字符串内的旧 ID 不参与引用闭包检查；只有归档外层受管字段参与。这明确替代原方案“遍历每类历史 request/result/error 并转换引用”的要求。

### 2. 包格式与树格式：简单 framing、内容寻址、不压缩

扩展名 .work，MIME application/vnd.piwork.work-package。精确布局：

```text
8 bytes      ASCII "PIWORK1\n"
8 bytes      unsigned big-endian manifest UTF-8 byte length
N bytes      manifest JSON
remaining    blobs in manifest.blobs order, each exactly its declared size
EOF          no trailing bytes
```

JSON UTF-8 严格解码；拒绝重复 object key、非安全整数、过深嵌套（128 层）。解码 map 使用无原型对象，不执行对象合并/setter；结构字段严格白名单，用户 environment 等受支持 map 中的 constructor/prototype 字面 key 不被过滤。写方对象键按 UTF-8 字节排序、紧凑编码，数组按合约顺序，读方不要求原始 JSON 的空白一致。整包 hash 基于全部 framing 字节，不包含自身；放在 HTTP header/数据库而不制造自引用。blob hash 与 kinds 声明分别校验。metadata/blob 最大值见 WSNAP-002；大镜像层不是 JSON metadata。v1 原始镜像层逻辑字节加文件逻辑字节总和也限 100 GiB，避免小稀疏包恢复成无限磁盘分配。相同 blob 复用不会绕过恢复体积核算。

Tree blob={version:1,entries:[...]}，entries 按路径原始字节排序。路径用非空 segmentsBase64:string[] 表示 POSIX 原始文件名字节（根 entry 用空数组），避免 UTF-8 解码损失 Linux 文件名。每段 decode 后禁止空、NUL、/、.、..；总路径/深度受限。每条共同字段 type、segmentsBase64、uid/gid(uint32)、mode(0..4095)、mtimeNs(有符号十进制字符串)；type 为 directory、file、symlink、hardlink。file 加 blob/size；symlink 加 targetBase64（目标原字节，允许悬空/绝对）；hardlink 加 targetSegmentsBase64，指向同树普通文件，不允许跨树/目录/环。symlink 不承诺 Linux 不可设置的 mode；其他 metadata 若不能恢复则失败，不能降级。ACL/xattr 使用受信 helper 在预检中检查，v1 非空直接拒绝，后续版本可扩展支持。

export 不跟随链接，基于 lstat/O_NOFOLLOW/read-fd 获取内容和二次 stat；目录遍历不是 shell glob。缓存包括普通文件；socket/FIFO/device 不是被过滤，而是导致明确不支持错误。restore 先验证完整树、创建目录/文件、建立硬链接，最后建立符号链接和应用目录元数据；不能遍历 symlink 父目录。新卷仅被受信 helper 挂载，整段 restore 无用户容器，防止 TOCTOU。setuid 文件位原样保留，但 runtime 继续 no-new-privileges；不能因此获得宿主权限。数据包本身不得指示 xattr、capability 或 runtime security flags。

不用外层 tar/zip：不需要压缩格式/路径解包器，按 digest 流和清单更容易限制；没有“解压时执行脚本”。包 checksum 证明传输一致性，不证明发送者可信。

### 3. 镜像制品路径与受信卷 helper

DockerCommandRunner 保留 run 给旧命令，新增独立 stream runner（spawn argv、stdin/stdout 流、背压、AbortSignal、有限 stderr），不能扩大原 execFile maxBuffer 来装镜像。DockerRuntime 增加 inspectCapturedImage、saveCapturedImage、loadVerifiedImage 和受管 snapshot helper 接口。source save 使用固定 image ID，禁止 tag 重新解析、自动 pull 或 commit。

save 输出以 streaming tar parser 解析，不解压到宿主路径。使用 tar-stream 包（精确版本在实现时经 lockfile 固定；仅选 parser/generator API，不依赖自动 filesystem extraction；参考 [upstream](https://github.com/mafintosh/tar-stream)）。接受 Docker save manifest/config/layer 条目并标准化到第 1 节 Image；若 Docker 提供 OCI layout，用其 index/manifest/config/layer descriptors 解析为同一模型。只接受选定平台单 image，OCI gzip layer 有限流式解压并校验 compressed descriptor 与 diff_id，不支持的 media type 整体失败；metadata、层条目数和逻辑字节统一受包限制。绝对路径/穿越/duplicate archive entry、未知额外 image 拒绝。

load 不把用户 tar 原样交给 Docker：从已验证 image config/layer blobs 生成只有 manifest.json、<config-digest>.json、layers/<diff-id>/layer.tar 的 Docker save tar，manifest RepoTags=[]，没有 repositories 文件；只加载预期 image，不更改目标同名 tags。load 后重新 inspect imageId/OS/architecture/variant；不执行 image entrypoint。已有同 identity 镜像直接校验复用。镜像加载可留共享 cache；失败清理不 image prune。本期由本机经典 `overlay2` image store 的真实 Docker 测试验证 Engine 可解析标准化归档；保留 OCI/containerd 归档解析及单测，但不把 containerd image store 实机测试作为本期交付门槛，也不据此宣称该模式已完成端到端验证。unsupported 格式明确失败。

新增受信 Dockerfile.snapshot-helper 与 apps/snapshot-helper：Node 24、仓库 work-package/work-store 编译代码及 Python 3 标准库 filesystem worker。Node 负责 framing/history；固定 Python worker 使用 bytes 路径、lstat/open-no-follow、listxattr(follow_symlinks=False)、utime(ns=...) 完成树元数据读写，避免 Node 时间 API 精度损失和额外原生 addon。仅以有界 JSON/字节流调用固定脚本，不接收包内代码或脚本路径；非空 xattr（包含 POSIX ACL xattr）整体拒绝。Core 部署显式配置 PIWORK_SNAPSHOT_HELPER_IMAGE；启动解析到受信固定 ID，不从包选择 helper。缺失只使 snapshot readiness 不可用，不影响旧 Work 功能；运行 snapshot 前返回 503。不在请求中临时构建 helper。

helper 以 installation/job 标签识别；--network none、read-only root、无 Docker socket/TLS/model mount；仅允许 Core 解析的一个受管卷和专有 spool bind（包不能选宿主路径），entrypoint 固定受信脚本。为保留 uid/gid/不可读用户文件，运行 root + 最小 CHOWN/FOWNER/DAC_OVERRIDE/DAC_READ_SEARCH capabilities，其他能力移除，no-new-privileges，CPU/内存/pids/time 限制。导出源卷只读；导入只挂新卷可写。helpers 不复用用户 image、不调用包内 npm/pip 或程序。helper 跟踪允许 snapshot gate 准确确认退出。

metadata 检查和 sqlite 映射也在该无网络 helper 中执行，不在 Core 进程解析未信任 sqlite 扩展。每个 job 最多一个 helper 同时运行。upload 在传输名额内另启动至多一个只挂载该 upload spool 的验证 helper，不挂用户卷，无需 CHOWN 等恢复权限；完整校验后才返回 packageId。CLI 离线 inspect 只验证 framing/schema/闭包/全部 hash，不打开包内数据库，输出 integrityVerified=true、installationValidated=false。v1 全安装最多一个 active export/import job，另一个返回 409 SNAPSHOT_CAPACITY_BUSY；防止包暂存并行耗尽资源。传输可以与 job 并行，但全安装最多两条 transfer，额外请求返回 503 SNAPSHOT_TRANSFER_BUSY。接受 upload 时 journal 记录 helper/spool 意图，断线/重启按 transfer 记录回收，不扫描删除其他内容。

### 4. 历史恢复与平台身份映射

包内保存私有卷原始 sqlite/WAL/SHM 字节及 SDK 文件，不能只导出 sessions API 的摘要。对 active=null 且尚未初始化 agentd 的 Work，work.sqlite、-wal、-shm 三者同时不存在表示合法的空私有会话历史；不得为了导出而启动 agentd 或生成源数据库。只缺主文件却留有 sidecar、或 active 非 null 但缺主文件均为损坏并失败。存在主文件时，helper 把 Work sqlite 文件组复制到隔离处理目录后，使用只读/禁止扩展/trusted_schema=OFF，验证 sqlite_master 只包含当前 WORK_SCHEMA_VERSION=3 的已知 tables/indexes、无 view/trigger/virtual table、列与外键约束精确匹配，再做 integrity_check/foreign_key_check 与行值检查。不得先调用会自动 migrate 的 WorkStore.open；不得运行从 sqlite_master 读取的 SQL。schema_migrations、sessions/runs/events/两个 idempotency 表/work_activity 均纳入验收；Run 全终态、activity 为空、record work scope 一致、context 存在且 history path 在 /var/data/sessions 下的 regular file。

导入有两份不同含义的内容：包内原始私有卷字节保持不动；存在受管 Work sqlite 时，新卷内必须用仓库当前固定 DDL 重建，prepared inserts 写入验证后的行，映射 work_id/context_identity 和已声明 Event DTO 的结构化 workId。合法的空数据库缺席状态则原样保持三文件缺席，首次显式 start 由 agentd 的正常初始化创建目标 Work DB。保留局部 sessionId/runId/submissionKey/event sequence/时间/正文，原始 sdk JSONL 文件完全不改；绝对 sdk_history_path 因容器路径固定可保持，但必须解析到新私有卷的对应 history 文件。旧 WAL 不能贴到新 DB：发布新 DB 后删除目标已吸收的 WAL/SHM（仅这一组受管数据库文件），新目录/权限恢复；这是平台元数据转换，不是用户业务数据过滤。用户业务数据库不打开、不转换。

控制历史直接保存为 imported_work_history.record_json，内容是上面 OperationRecord 的原始记录；行键 work_id/operation_id 使用接收方新身份，source_operation_id 保存输入 record.id。不修改 requestJson/resultJson/errorJson，不插入 live operations 或控制执行队列。读取时生成新 operationId/workId/correlationId（correlationId 使用新 operationId）的只读安全投影；仅接受现有公开诊断/结果 schema 的字段，未知或不合法 payload 不回显，result/error 为 null、diagnostics 使用空诊断；完整原文仍保存在归档中。公开诊断按现有 safeDiagnostic 固定消息输出，结构化 serviceId 仅在找到映射时转换，否则省略；不暴露原文或原平台访问引用。历史 kind 是标签，不是命令分派入口，因此没有逐 kind 迁移器，也不能通过历史 kind 触发动作。

源 control idempotency 仅归档，不能写入 live idempotency_records。work_import_provenance.identity_map_json 保存 {sourceIdentityMap,targets:{workId,contexts:[{key,id}],services:[{key,id}],operations:[{key,id}]},archivedIdempotency}；targets 是导入接受时预分配并写入 journal 的同一组身份，引用必须完整且一一对应。新增 owner-only GET /api/v1/works/:id/import-provenance 仅返回 {sourcePackageDigest,importOperationId,operationMap:[{sourceOperationId,operationId}]}，用于找回历史控制结果，不输出归档正文或主体。Session/Run API 本来带 workId，不需全局改 ID。映射 provenance 不允许普通 admin 读取。

再次导出收集本 Work 的 live terminal Operations 与 imported_work_history，并按当前可查询 operationId 去重；导入历史只将记录外层 id/workId/serviceId 适配为当前实例的查询身份，三个 JSON 字符串保持原样。上次保留的只读幂等记录通过 targets 适配其 operationId/resourceId，workScope 仅在等于上次 sourceWorkId 时替换为当前 workId，其他字面 scope 不改，再与本次 live provenance 一起归档，匿名 principalKey 在本次包内重新分配且不同来源不合并。这样每代包都完整包含历史，不依赖原包文件或递归嵌套旧包；不重放任何历史。导出时的 idempotency 归属查询还覆盖通过 resourceId 关联的原生 create-work，不能因其 operations.work_id 原来为 NULL 而漏项。

导入后的旧 Session 仍受 AgentSessionService 的 active context 相等规则限制；不引入多 agent 同时装载旧 context。完整历史保留不等于改变原有继续条件。更早 context 的完整 Skill/image 闭包仍保留，便于后续显式操作/再导出。

### 5. Work-owned context/image 与目标模型自动解析

新增 work_owned_images(work_id,selection_id,image_identity,source_reference)；selection_id 是新生成 ResourceId，作为导入 WorkConfig.agentImage.catalogId 的 Work-local 选择值，不注册 global catalog。WorkConfigurationValidator、buildWorkContext 和 resolveRuntimeProfileFromWorkConfig 接收 workId + 可选 retained context：当前 Work 的 retained image/Skills 优先于 catalog；显式选择新的 image/Skill 才转普通 catalog 流程。跨 Work selection_id 必须拒绝，不能把本地表变成全局可用镜像列表。

导入时 Core 从目标 catalog 的 enabled model 条目中筛选 provider/model/baseUrl 与包内要求完全一致的条目；baseUrl 使用规范化 URL 比较，null 不等于显式其他地址。对每个候选校验 immutable credentialRef 指向可读普通文件，选 sourceRuntimeRevision 最大的候选，同 revision 时按 catalog ID 字典序取最小者；没有候选返回 TARGET_MODEL_UNAVAILABLE。多个包内逻辑 model key 可以解析到同一个目标条目。接受事务保存生成的内部逻辑 key→目标 catalogId 映射与捕获的 RuntimeProfile；发布前重新验证 owner enabled、catalog 可用性与凭证文件，失败则原 Operation 报 TARGET_MODEL_UNAVAILABLE 并清理未发布资源。发布后不跟随目标默认模型变化。内置 `work-services` 的标准配置禁止 secretRefs，故无需 secret 映射；v1 若包内 `bindings.secrets` 非空，在接受前返回 EXTERNAL_MCP_SECRET_UNAVAILABLE，不读取或复制源平台 secret，不让用户补 bindings 文件。该限制仅针对平台托管的自定义外部 MCP secret；用户放在 Work 文件或 service environment 的字节仍随包原样携带。

导入保留 active/desired context 内的内置 `work-services` 配置和工具策略，不从目标全局默认配置重建。目标 agent 镜像来自包，内置 adapter 可执行文件仍按保留的固定镜像身份运行；首次显式 start 由目标 DockerWorkRuntime 注入目标 Core 的 service-control endpoint、目标安装 CA 与新 Work/generation/instance 的 mTLS 客户端证书。目标 Core gRPC 按该新身份限定 Work scope，绝不接受源 Work ID、源证书或调用方自选 Work ID。源 context 若移除内置 MCP，目标不补入。

WorkContextStore 增加从已验证包 trees 构造新 context 的路径，仍计算并验证 Skill identity 与 AGENTS 字节，不经全局 Skill selection。为每个保留 context 建立新 snapshotId 与 config revision 关系，active/desired 的逻辑同一性保留。全部新文件通过 normal validateSnapshotDirectory 复验，imported manifest 不能提供宿主目录。

首次 start 必须分支为“已有 active context 的 imported Work”：使用其 captured active runtimeProfile/镜像；不能复用当前“先捕获 desired 再 start”的逻辑覆盖 pending 语义。active=null 时走现有首次初始化。后续 config 修改产生新 desired context，未变 image/Skills 继承 owned 副本。修改全局 defaults/catalog 不改变导入 Work；重新导出时 owned selection 又转换为逻辑 image key，不把临时 ID 写成跨安装依赖。

### 6. 数据库增量迁移与任务状态

Core schema 从 6 增量到 7；Work schema 保持 3，只新增读取/重建 API。所有新表 STRICT：
- snapshot_jobs: operation_id PK/FK operations，owner_user_id，kind(export/import)，source_work_id nullable，target_work_id nullable（导入发布前非 FK），snapshot_id nullable unique，package_id nullable，name nullable，request_digest，phase，deadline_at，worker_epoch，created_at，updated_at，cleanup_error nullable。
- work_snapshot_locks: work_id PK/FK works，operation_id unique，worker_epoch；独占 export gate。
- snapshot_packages: id PK，owner_user_id，digest nullable，size，state(staging/ready/expired/deleting)，job_id nullable，created_at，ready_at nullable，expires_at nullable。路径由 CorePaths.snapshotDirectory/id 计算，不接收外部路径。
- snapshot_artifacts: operation_id + artifact_key PK，kind，logical_id，state；记录卷/helper/staging/context 的创建意图、实际完成、清理进度。清理只沿该 journal 且二次校验 installation/job 标签。
- snapshot_transfers: id PK，owner_user_id，package_id nullable，snapshot_id nullable，kind(upload/download)，phase，deadline_at，last_progress_at，helper_id nullable，created_at；为未完成 upload 记录专有 spool，并为已完成包持有 reader lease。启动时先确认关联 helper 退出再清理中断上传/释放 lease。
- work_import_names: owner_user_id + name PK，operation_id；导入接受时保留目标名。普通 Work create 也检查它。
- work_owned_images: work_id + selection_id PK，image_identity，source_reference；只作用于该 Work。
- imported_work_history: work_id + operation_id PK，source_operation_id，record_json；完整原生终态 OperationRecord 归档，不参与 lifecycle queues。
- work_import_provenance: work_id PK，package_digest，import_operation_id，identity_map_json。
配额仍使用 quota_reservations，为未发布 target_work_id 创建 import 暂存保留（其 work_id 当前无 FK）；发布事务原子转换为清单中的 agent/service 保留。目标预算计算取 quotaReservations 中所有行的 desired CPU/内存之和（含 disabled 或 tombstone 中仍未释放的持久预留），再与接收端已有 Work 的 max(desired,occupied) 占用相加；同时按导入 Work 的资源策略及接收端 host 策略检查，不以源运行占用计数拒绝导出或增加目标预算。服务数量按非 tombstone heads、保留卷数量按新建的两个 volume records 的既有口径检查；已 tombstone 仅为历史，不占 active service slot。暂存保留覆盖完整总额，不能在接受与发布之间被其他请求抢占。serviceSlots/volumeSlots 原值映射到目标行，不代替实际服务/卷计数检查。

operations.work_id 对未发布 import 保持 NULL；snapshot_jobs 记录 targetWorkId。acceptDurableMutation 在同一事务建立 Operation/idempotency/job/name/quota，resourceId 为预分配 workId。operation 查询先查 snapshot_jobs 做 owner-only 授权，再用既有 publicOperation 投影补 targetWorkId；失败也可读。不得让 WorkLifecycleManager.recover 把 snapshot operation 当作 create/start。

所有额外路径在 CorePaths 新增 snapshotsDirectory，private 0700，文件0600。ready package fsync 后原子 rename + fsync 父目录；随后数据库事务 ready+Operation success。import 的新卷/contexts 准备完成后单事务插入 works/config/service/history/两个新 volume records 与清单引用，释放 name hold、转换 quota，Operation success。发布的 Work 使用认证接收者和接受时选定的名称、目标创建/更新时间、desired/observed=stopped、controlVersion=1、包内最高配置 revision 为 desired、active key 对应 revision 或 null；context/config 的 createdBy 映射为接收者，历史原时间仍留在包/归档中。runtime_generations 与 resource_bindings 不从源复制，导入时不创建 agent/service 容器、网络或 TLS 文件；首次显式 start 经既有 prepare/start 路径建立新运行代次、网络和证书。agent 的旧代次恢复计数随旧代次结束，不移植；service 级恢复预算仍按清单保留。发布事务不执行 Docker/文件 I/O；此前文件均已 durably ready。未发布路径由 job 引用保护，普通 orphan cleanup 跳过。

### 7. 冷快照 fence 与 export 状态机

```text
accepted --> verifying --> capturing --> sealing --> succeeded
     |           |            |           |
     +-----------+------------+-----------+--> failed --> cleanup
```

接受顺序：认证 owner -> 先解析相同 key replay -> 必须执行 Docker 停止状态只读预检 -> SQLite BEGIN IMMEDIATE 下检查 Work stopped、无 pending/running 操作、无 gate、全局 job slot -> 记录 gate/Operation/job。不在事务里 await；预检发现运行或不可确认分别返回409/503，事务重检控制状态，worker 在 gate 内再次检查实际容器。接受后的检查失败通过 Operation 报告，不撤回202。服务中 late create 清理完才允许捕获。所有 ingress（HTTP/gRPC/Core manager）在同一接受事务检查 gate：lifecycle mutateDesired/apply、配置 whole/field updates、service manager mutation、retained volume purge、Session/Run mutation；automatic reconciliation/health 也跳过 gated Work。metadata reads 继续。任何更早 operation 尚未完成都拒绝 export，因此无需暂停正在执行的用户操作。

在 gate 内按两个卷 + 全保留 contexts + Core snapshot transaction 构造闭包；同一个 Core 读取快照采集 Work/config/service heads 与 revisions、quota_reservations、两个 volume records/references、控制历史及映射，逐项验证 quota 行和卷引用与 service 逻辑 key 一一对应。Core transaction 只取记录，不在 SQL 写锁中复制 GiB 文件。既有 cleanup/expiry 不得改变 captured context/records，当前 export 自身通过明确 scope 排除。只读 helper 再检查所有 source files；before/after stat 不同失败。存在原私有 DB 却不完整时不修复，提示用户正常 start/recover 再 stop；合法三文件缺席按第 4 节处理。控制记录 captured 后不再读取可变默认配置。停止预检只判断实际 agent/service 容器是否运行或不可确认，不额外检查 quota_reservations 的 occupied 值。

每个 worker action 验证 job epoch 和 gate 所属。capture 输出只能到 job staging，sealing 校验、fsync、final rename；job success 与 lock release 同事务。先确认 helper 退出，再释放 gate。timeout/shutdown abort 杀死本 job helper并确认退出；不能确认则 cleanup-pending 保留 gate（Operation failed 也不代表 cleanup 已完成）。source Work 绝不自动重启。

源宿主 operator 的外部 Docker/文件写入不在产品并发保证内；仍检测未受管容器挂载源卷并拒绝，不向用户宣称能冻结宿主 root。测试以受产品管理的写入互斥为保证范围。

### 8. 导入状态机、故障恢复与清理

```text
verified upload --> accepted --> staging --> validating --> publishing --> succeeded
                       |             |            |
                       +-------------+------------+--> failed --> cleanup
```

upload 只保存包，不配置 Work。import 先验证 packageId 所属并从保留记录解析 digest，然后用 digest/explicitNameOrNull 查找幂等 replay；replay 返回旧 Work/Operation/已选名称，不重新检查 expiry、当前模型、名称或预算。仅新请求要求 package ready且未过期、完整 manifest 已验证，再检查自定义外部 MCP secret 要求、目标模型、兼容性、配额与名称。没有显式 name 时在同一个接受事务中取 spec.sourceName 作为候选；若 works 或 work_import_names 已占用（包括 deleted Work），依次试 `-2`、`-3`，以 Unicode code point 截短基础名使总长不超过既有 128 字符约束，并对每个候选走既有名称校验，首个可用名称即持久 job name。显式 name 冲突则返回 WORK_NAME_CONFLICT。预算必须来自清单的 quotaReservations：接受事务按其总额建立暂存保留；发布事务按新 Work/service ID 写入逐行 desired/slots，occupied 置零，并释放暂存保留，不能按 enabled 或最新 definition 重算。预分配所有平台身份，将映射及目标模型选择写 journal，重启不可随机再生成另一套 ID。helper 只修改未发布新卷和存在时的新受管 Work DB，平台容器不启动；镜像加载后校验 exact identity、树恢复后校验内容、context 走正常验证、SQL 所有引用复验。published Work desired/observed=stopped；services live observed=disabled/stopped，tombstone 保留，旧 source errors 进入 provenance；恢复预算字段原样保留，nextRetry 不调度直到正常生命周期允许。再次导出直接读取新实例的逐行 reservation 和卷引用，不依赖原包或重新推导。

启动 Core 顺序调整：load store -> snapshot recovery/cleanup -> context orphan cleanup -> ordinary lifecycle/service recovery -> HTTP 可接受 mutation。未发布 import 一律标 SNAPSHOT_INTERRUPTED 并清理，不猜测继续到哪一步；已 published 不回滚。export 若 ready 文件/hash/完成标记完整则完成原 Operation，否则失败中断；不是给原 ID 自动捕获一个新的时间点。

清理 snapshot_artifacts journal 中的 helper/new-volume/unpublished-context/name/quota；缺失资源视已清理，归属不符停止并报人工处置，不删除。clear gate 只在原 epoch helper 已退出。target 不发布前失败可释放 name hold，若旧卷未清掉继续占用相应 storage reservation，禁止假释放物理占用。新 key 的后续尝试可在清理完成且 slot/配额足够时进行。同 key 保留失败结果。

job 30min deadline从接受开始，跨重启不延长。日常 runner 避免缓存 expired admissions；Core shutdown先关闭快照 mutation/transfer admission，abort jobs并在原45秒 shutdown预算内确认 helpers退出，记录failed/cleanup-pending。普通 Work graceful shutdown不因新的复制任务而无限等待。

### 9. HTTP、SDK 和 CLI

正式路由在 CoreApplication.handle 内按现有 auth/URL decoding 接入，stream 路由在 readJson 前分流。metadata JSON 上限仍1MiB。
| Method / path | Request | Success |
| --- | --- | --- |
| POST /api/v1/works/:workId/exports | {idempotencyKey} | 202 {workId,snapshotId,operationId,correlationId,reused} |
| GET /api/v1/work-snapshots/:snapshotId | none | 200 {workId,snapshotId,operationId,state,digest:null-or-hex,size:null-or-int,expiresAt:null-or-time,error:null-or-publicError} |
| GET /api/v1/work-snapshots/:snapshotId/content | none | 200 binary; ready only, otherwise409 |
| POST /api/v1/work-packages | binary; Content-Type exact MIME; Content-Length required; X-Piwork-SHA256 required | 201 {packageId,digest,size,expiresAt,bindingRequirements}；末字段仅保留为兼容性的只读依赖摘要 |
| POST /api/v1/work-imports | {packageId,name?:string,idempotencyKey}；拒绝 bindings 等未知字段 | 202 {workId,name,operationId,correlationId,reused} |
| GET /api/v1/works/:workId/import-provenance | none | owner-only DTO from section4 |
| GET /api/v1/operations/:operationId | existing | owner-only snapshot/imported history or unchanged existing behavior |

非适用 Content-Type 返回415，缺失/错误 length/hash header 返回400；归入CLI fallback1。所有 idempotencyKey 为trim后非空但原文比较、最多256 UTF-8 bytes；opaque ID 不包含NUL、不为空且URI逐段编码；显式 name 沿既有 Work create 验证，省略 name 则由服务端按第 8 节生成。JSON对象duplicate key拒绝（新routes采用严格parser），未知字段拒绝。TARGET_MODEL_UNAVAILABLE 的安全提示指向目标 Core 模型配置；EXTERNAL_MCP_SECRET_UNAVAILABLE 的提示说明本版不迁移自定义外部 MCP 平台 secret；WORK_NAME_CONFLICT 提示换名或省略 `--name`。Core mapError 保留上述 code，并提供不含模型 key/secret 值的 message/field；CLI 对 PiworkApiError 显示 code 和安全 message，不只显示通用拒绝句。

download headers: Content-Length、Content-Type、X-Piwork-SHA256、Cache-Control:no-store，固定attachment文件名snapshot.work，不把源name直接拼响应头。无 Range支持，发送Range返回416；同CLI fallback1。上传下载60s无字节进展/30min总期限，包括in-flight stream；backpressure传播到fetch/file/Docker stream，错误时销毁流，headersSent后断开，不能拼JSON。HTTP disconnect仅中止transfer，不取消export/import任务。任务请求body无需本机文件路径；远程Core不可读取客户端output/input路径。

upload owner/digest去重 ready bytes，同owner返回原packageId/到期时间，不续期；不同owner分独立授权记录，不能凭hash查询另一owner。保持 job/read lease 引用防GC，revalidate auth每次新请求；已开始transfer持有授权快照，撤销影响后续请求不声称逐chunk鉴权。ready 24h后不得建立新引用，existing lease完成后清理；DB保留expired tombstone以区分本人410/他人404。每分钟及startup清理一次，不承诺精确某秒删除。用户不需要新包管理CLI；v1通过TTL控制暂存生命周期。

SDK新增 exportWork、snapshot、downloadSnapshot、uploadWorkPackage、importWorkPackage；binary方法接受AsyncIterable/ReadableStream与AbortSignal，返回metadata不自动在SDK写任意路径，控制JSON仍复用request。不能用现有boundedText读取二进制，不能在认证失败时fallback operator/Docker。

CLI新 apps/cli/src/work-snapshot.ts，纯parser在credential loading前，inspect/help完全离线。读取本地package先open nofollow，保持同fd校验与上传并检查stat，上传hash是这次验证的字节；删除 bindings 文件读取和 `--bindings` 选项。export 未给 `--output` 时以 `<workId>.work` 作为当前目录目标，显式输出路径保持原有安全预检；最终发布用同目录O_EXCL temp、fsync、link无覆盖发布+unlink temp+fsync directory（不能rename覆盖竞争创建的用户文件）。所有父目录lstat/realpath并保持受控fd，symlink父路径拒绝，错误保留原文件。下载通过digest/length完整验证再发布；path输出是最终本地路径，不是Core宿主path。

export一直等待最多120s后下载；download用已存在snapshotId。import --wait仅等安装，不启动；非wait返回含最终 name 的接受响应，wait 将该 name 加到终态 Operation 输出以便用户定位自动命名的 Work。poll与transfer分别计时，transfer可超过120s但不超过30min。因本地发布/网络失败还可download原snapshot。旧Work/service wait代码不重构；复用安全错误和小范围共享观察helper，保留既有退出码。

### 10. 资源预算与容量故障

规范的100GiB package/restore逻辑上限是明确的v1防滥用默认，不代表volume硬配额。staging前基于manifest核算blob/恢复逻辑大小及free space，source第一次扫描得不到可靠大小就拒绝；读取到超限立即失败。Core spool至少需要包字节两倍+metadata，Docker数据根需要恢复volume逻辑字节+缺失image层逻辑字节+1GiB余量；statfs与Docker driver不能证明容量时以实际写失败为准，不声称保证容量。ENOSPC必须可恢复，不能为腾空间删除已有Work或image。

实例quota一次性保留，snapshot helper另限1CPU/512MiB/pids64，镜像/文件流每条highWaterMark<=1MiB；metadata累计内存界限<=256MiB。相同blob在两个卷引用时恢复空间按两份计算。取消不用并发SIGKILL所有容器，只终止journal关联helper/stream。所有资源错误返回安全stage/code，不在stderr记录env、history或blob内容。

### 11. 验收优先：导入后继续使用

主验收必须先有一个实际可用的 Work：代码、依赖、HOME 工具、业务数据库、服务、Skill 和可继续的 Session。完成 stop/export/import/start 后运行相同开发命令、读取相同业务数据、启动原服务并继续该 Session；不得重新 npm/pip 安装或手工重建服务。再导出导入一次，验证内容和历史仍完整。以下检查为这条主线提供自动化保障，不扩展为用户需要配置的边界产品。本期以 8 MiB 合法包证明传输不经过 1 MiB JSON 路由，不以 2 GiB 极限压测或新增恶意历史 HTTP fixture 作为交付门槛；既有包完整性和历史 schema/path 校验行为保持不变。

- 合约/codec：golden v1包与hash，空文件/空Skill、active=null、workspace serviceRefKeys（含 tombstone 残留引用）、重复key/未知版本、缺blob/额外尾部、1MiB以上流、阈值边界、非UTF8文件名、symlink父路径、硬链环、巨大声明、小内存backpressure。
- 历史备份恢复：以正常运行的 WORK_SCHEMA_VERSION=3 数据库/WAL、SDK v3 JSONL 和 active=null 且三个受管 SQLite 文件均缺席的空历史完成上传、导入、启动及继续 Session；所有已存在表列/外键、正文和控制历史三个 JSON 字符串保持原样，未知 kind 只读保留不执行，create-work 不漏项，再导出不丢既有历史，两个导入副本局部 Session/Run ID 相同而隔离。已有的异常 schema/path/sidecar 拒绝单测保留，但本期不新增恶意历史 HTTP 专项 fixture。
- Core store/manager：锁与所有mutation接受竞争，先后顺序、同key replay/异payload、name冲突、quota跨Work、两个卷的持久引用映射与孤儿引用拒绝、cleanup归属检查、expiry lease、acceptance前与后错误ACL、未发布Operation可查。
- adapter/Docker：helper没有网络/用户image/平台密钥，volume只读或新卷；image层身份/tag不覆盖；实际导入依赖与hidden files，ACL/socket明确拒绝而非漏项。
- 配置/服务：active A/desired B启动仍A、保留Skill无需全局库、无关config edit不丢image、enabled/disabled/tombstone/desired-applied/recovery budget保持、required MCP service key正确映射；复现失败 disable 后 enabled=false 但 desired reservation 非零的已停止 Work，验证包、导入与再次导出均保留该值，导入前 occupied=0 且不自动启动；不足预算的目标拒绝导入而不发布 Work。
- 真实端到端：两个Core数据根和不同用户；源Work在workspace装一个本地依赖并生成业务文件，HOME放工具、创建Session/Run、运行服务写数据；stop/export；目标不访问registry（先从包恢复image），import两次、start、读数据/跑开发命令、继续Session、改一份另一份不变；另覆盖未初始化但卷已存在、active=null且无Work SQLite的导出导入；使用acceptance image+deterministic provider而非真实API key。显式断言导入阶段没有 Work agent/service 容器、运行网络/证书、模型或服务执行，运行身份仅在start创建；受信快照 helper 不算 Work 运行实例。
- 开箱即用追加验收：源 Work 的 active context 必须实际包含内置 `work-services` 和允许的 service 工具（不能像旧验收脚本那样设 `mcpServers: []`）；断开源 Core 后，目标 Work 显式启动，经真实 pi-agentd SDK→stdio MCP adapter→目标 Core mTLS gRPC 列出恢复的 service、stop/start 它并查询 Operation。独立的 CLI→真实 Core 验收必须以编译后的 CLI 子进程分别连接源和目标安装，执行 `work export <workId>`（验证默认 `<workId>.work` 的完整落盘）与 `work import <file> --wait`（不提供 name 或 bindings），验证返回名称、成功 Operation、导入后 stopped 且无运行容器/网络/TLS，再显式 start 并继续使用；模拟 HTTP 的 CLI 单测与直接调用 HTTP 的双 Core 验收不能代替这条串联路径。现有本地 `first.work` 若可用，还须在独立临时目标 Core 中按其模型要求配置可读测试凭证并完成真实导入成功检查，不在用户现用 Core 上导入、不启动包内代码、不把包内容或凭证写入测试日志；该私有文件不提交为仓库 fixture。无此本地文件的环境仍以可复现的 v1 golden/真实导出包验证格式兼容，但不能据此声称已实测该具体文件。
- 导入后的权限追加验收：通过目标 pi-agentd 实际暴露给模型的工具列表确认 `work-services.service_stop` 被源 active context 拒绝时不可见，且显式移除整个 MCP 后目标默认值不会补回；用目标新运行身份经真实 MCP/gRPC 分别尝试对源 service ID 和目标 Core 另一 Work 的 service ID 发起查询及变更，断言拒绝、没有跨 Work Operation 或状态变化，同时保留本 Work service 的正向 stop/start 验证。独立 agentd 工具过滤单测和独立 gRPC scope 单测是补充证据，不能单独替代导入后端到端断言。
- 每个关键stage注入崩溃：after accept/helper/new-volume/context/image/ready rename/before publication/after commit；重启必须显示规定结果、无重复Work/无未验证published状态、无挂死gate、无删除别人的资源。
- CLI编译子进程+本地HTTP：help未登录、usage优先、stderr warning、--json单值、120s fakeclock、slow stream、目标文件竞争与symlink、重新下载、remote Core路径不混淆。
- 完成前运行全repo build/typecheck，受影响workspace unit tests，既有core lifecycle/config/services/access和agentd sessions测试，新增snapshot Docker integration与独立两Core验收。不能仅凭mock通过宣称完整环境可移植；若Docker不可用应记录未验证并保留验收任务未勾选。

## Risks / Trade-offs

- [Full package contains real private material] -> owner-only访问、0600、明确警告，不宣称脱敏；分享者授权内容复制不等于授权源平台权限。
- [Opaque user files embed source IDs/remote URLs] -> 字节保持，不试图自动修复；只保证受管引用可移植，外部系统仍需可访问。
- [Unsafe image/sqlite/files] -> 验证全闭包，受信无网络helper，不运行包代码；Docker engine本身仍是可信运行时边界，hash不是恶意检测。
- [Older retained image removed by operator] -> 完整导出明确失败，绝不用新tag冒充；未解析revision保留unresolved。
- [Large size / no compression] -> 简化首版格式与资源计算，以背压和100GiB上限约束；格式未来可演进，不静默裁剪。
- [Metadata unsupported in v1] -> 对ACL/xattr/特殊文件整体拒绝，错误可见，不把部分包称为完整。
- [目标平台模型或自定义外部 MCP secret 不在包内] -> 模型按 provider/model/baseUrl 匹配目标已配置凭证，缺失时在接受前报告 TARGET_MODEL_UNAVAILABLE；自定义外部 MCP 平台 secret 暂不迁移，包含该引用时报告 EXTERNAL_MCP_SECRET_UNAVAILABLE。内置 `work-services` 不使用该路径，目标 Core 重新签发其控制身份。
- [旧 v1 包与导入 API 差异] -> 保留包内 `bindings` 依赖清单及上传响应字段，确保无自定义外部 MCP secret 的旧包仍可读；导入请求的显式 bindings 为有意移除的未归档接口，不做静默忽略。
- [Historical contexts and local duplicate Session IDs] -> 所有API保持Work scope；保留原context mismatch规则，定点映射并测试。
- [Current workspace references outlive a failed service removal] -> 将两个受管卷的实际 Work/service 引用纳入清单并映射，缺失/额外未清除卷或未知消费者整体失败，不从当前定义猜测。
- [Schema changes during implementation] -> 变更起点Core6/Work3，当前已完成Core7增量迁移；若其他变更先合并只调整后续迁移序号，不自动接受新Work history schema。

## Migration Plan

1. 发布contracts/work-package/helper以及Core增量schema7（CLI/SDK一起升级）；给现有数据库加空表，不重写Work/context/历史。部署构建受信helper并配置其image引用；普通功能不依赖helper就绪。
2. 注册snapshot recovery于现有恢复/孤儿清理之前；既有Work无需迁移，可在支持的当前storage layout上停机后导出。
3. 首次导入只创建新Work，包版本1/history3/storage2；不支持的历史格式保留原数据并明确拒绝，不自动reset。
4. 回滚必须先停止Core和snapshot任务，确认无helper写入，并恢复升级前Core数据库/配置备份；含已导入Work的新数据库不能交给旧binary假装兼容。新卷按journal记录保留供升级版本恢复，不以回滚为由删除用户数据。
5. 新目录权限/TTL与helper配置加入operations文档，先用无真实密钥的两Core验收包验证再让用户分享生产内容。
