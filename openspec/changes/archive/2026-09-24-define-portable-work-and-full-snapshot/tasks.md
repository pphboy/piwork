# Tasks

实施主线：把一个实际可用的 Work 完整搬到另一用户处，导入后启动即可继续使用。下列任务是系统内部实现与验证，不增加用户的数据分类或历史迁移步骤。复用原生记录，不实现通用迁移框架或逐 Operation kind 的 request/result/error 转换器；不能以精简为由省略文件、开发环境、服务或历史。第 1–9 节的已勾选任务是此前显式 bindings 版本的实施记录；第 10 节记录开箱即用修订及尚待补齐的端到端验收，凡与旧任务叙述冲突，以第 10 节和当前 spec/design 为准。

## 1. Portable Work 合约与包编解码

- [x] 1.1 在 packages/contracts 新增 Work 清单和 snapshot API schema，历史只使用 design 第1节固定的原生记录归档外壳；测试空集合、active=null、重复key、未知外层字段/版本、悬空引用和不透明历史字符串，禁止引入逐kind历史协议（PWORK-001..004）。
- [x] 1.2 新建 packages/work-package workspace，接入 TypeScript/build/unit 脚本与精确锁定的 tar-stream 依赖；确认包可被 Core/CLI/helper 独立引用且 repo build/typecheck 通过，不引入 Core 依赖到 CLI（PWORK-001，WSNAP-002）。
- [x] 1.3 实现 v1 magic/长度/严格JSON/blobs顺序/流式hash读写，提供 golden .work fixture；验证duplicate JSON key、尾随/截断、错误length/hash、空blob、跨kind去重、非安全整数全部按规范失败（PWORK-001，WSNAP-002）。
- [x] 1.4 实现tree索引/byte-path验证与闭包/恢复逻辑体积计算；测试非UTF8名字、深度/路径/条目/metadata/package边界、重复路径、symlink父路径、硬链环及重复blob不能绕过100GiB上限（WSTOR-SNAPSHOT-001，WSNAP-002）。
- [x] 1.5 实现离线inspect安全摘要与binding requirements提取；含env/AGENTS/token/history sentinel的包测试证明全部hash被检查、内容不打印、不打开SQLite/执行程序，并显示installationValidated=false（PWORK-002，WSNAP-002，WACC-SNAPSHOT-001）。
- [x] 1.6 扩展v1 manifest/contracts/codec的必需 quotaReservations：agent一行、每个保留service一行，保存desired CPU/内存与slots、逻辑key映射；更新golden包并测试缺项/重复/额外行、负数/超安全整数、悬空service key和旧原型包均返回PACKAGE_INVALID，不从enabled或definition补默认值（PWORK-001、002）。
- [x] 1.7 扩展v1两个volumes清单项的必需serviceRefKeys并更新golden包：private只能空数组、workspace为去重有序service逻辑key，Work引用隐含存在；测试悬空/重复/乱序引用、私有卷service引用、旧原型包均拒绝且不从service定义补默认值（PWORK-001、002，WSTOR-SNAPSHOT-001）。

## 2. 受信存储 helper 与 Docker 制品流

- [x] 2.1 为 runtime-docker 增加不破坏旧run接口的spawn streaming runner；慢reader、AbortSignal、stderr上限和子进程退出测试证明背压与超时生效、不全量缓冲二进制（WSNAP-002、005）。
- [x] 2.2 新建 apps/snapshot-helper 和 Dockerfile.snapshot-helper，固定Node入口与Python3 filesystem worker；添加构建/启动测试证明无网络、无Docker socket/平台凭证、非包选image、受限CPU/内存/pids与最小能力，配置缺失只阻断snapshot（PWORK-003，WACC-SNAPSHOT-001）。
- [x] 2.3 实现两个卷根分别采集和树还原，包括byte paths、uid/gid/mode/mtimeNs、硬链接、symlink、空目录；真实临时卷测试验证private中被workspace覆盖的底层文件也保留，源只读，目标是新卷（WSTOR-SNAPSHOT-001）。
- [x] 2.4 实现不跟随links的树预检及特殊文件/xattr/ACL整体拒绝；测试socket、FIFO、device、外部link、读取失败和stat变化，确认无静默漏项、宿主写入或源文件改动（WSTOR-SNAPSHOT-001，WSNAP-001、002）。
- [x] 2.5 实现captured image save与Docker/OCI流式归档标准化，固定identity/config/diff_ids验证和layer去重；fixtures覆盖多平台、缺层、gzip限额、未知media、archive traversal，禁止tag重解析/pull/commit（PWORK-003）。
- [x] 2.6 实现从verified config/layers生成无RepoTags的load归档并复验identity/platform；真实Docker验证自定义镜像恢复、已有同名tag不变、同identity复用、失败不prune已有image（PWORK-003，WSNAP-003）。

## 3. 完整历史备份与必要身份适配

- [x] 3.1 为 packages/work-store 增加不触发migrate的schema3离线检查；真实sqlite/WAL fixture覆盖全部表、外键、terminal Run、empty activity、SDK path，拒绝trigger/view/未知schema/跨Work行/非终态而不修复源DB（CONV-SNAPSHOT-001，WSNAP-001、002）。
- [x] 3.2 实现以固定DDL和prepared inserts重建目标Work DB及work/context/event身份映射，保留局部Session/Run ID和幂等；测试SDK v3文件逐字节不变、用户业务DB不修改、WAL已提交记录不丢、正文旧ID不替换（PWORK-004，CONV-SNAPSHOT-001）。
- [x] 3.3 汇总本Work全部contexts/config revisions/service revisions/heads、原生终态Operations与只读控制幂等记录；测试create-work不因空work_id漏项、三个历史JSON字符串逐字不变、未知kind保留且不执行、匿名主体，以及不采集global users/runtime secrets/宿主凭证路径（PWORK-001、002，CONV-SNAPSHOT-001，WACC-SNAPSHOT-001）。
- [x] 3.4 实现design第1、4节固定映射和新实例身份分配，只适配运行与查询所需字段；双导入验证存储/身份独立、requiredServiceId正确、tombstone不复活；再导出测试已导入历史、幂等归档和新增历史全部保留且不依赖旧包（PWORK-004，WSRV-SNAPSHOT-001，CONV-SNAPSHOT-001）。
- [x] 3.5 扩展WorkContextStore以verified package trees建立新owned context，不读取全局Skill库；测试AGENTS/Skills完整保留、active/desired关系与null保留、缺失context/Skill内容整体失败（WCFG-SNAPSHOT-001）。
- [x] 3.6 在同一Core读取快照中采集quota_reservations及service逻辑key映射，覆盖agent和包括tombstone在内的全部保留service；测试失败disable后enabled=false但desired预留非零仍按原值入包，额外/缺失行整体失败，读取不要求源occupied=0（PWORK-001、002，WSNAP-001，WSRV-SNAPSHOT-001）。
- [x] 3.7 在同一Core读取快照中采集两个受管volume records/references及service逻辑key；测试Work双引用、workspace多service引用、失败remove后tombstone残留引用都保留，额外未清除卷/缺卷/私有卷service引用/未知消费者整体失败，不复制源卷ID或Docker名称（PWORK-001、002，WSTOR-SNAPSHOT-001）。

## 4. Core 持久任务、配额与全入口门禁

- [x] 4.1 为 core-store 增加design第6节增量迁移和typed CRUD（含jobs/locks/packages/transfers/artifacts/name holds/owned images/history/provenance）；迁移既有schema6 fixture后逐项比较原Work/用户数据不变，重开幂等且新FK/unique约束测试通过（WSNAP-003、004、005）。
- [x] 4.2 实现export/import持久接受与digest-based幂等，按包内全部agent/service desired预留及两个目标卷原子检查Work/host预算并建立job容量/name/quota暂存保留；测试disabled/tombstone持有预算、接收端已有占用、预算不足不接受、相同key同内容/异内容、过期内容replay、新packageId相同digest、并发名称冲突及普通create与import名称竞争（WSNAP-003、004，PWORK-002，WSTOR-SNAPSHOT-001）。
- [x] 4.3 在lifecycle start/stop/retry/delete/apply、configuration whole/field更新、service manager、retained volume cleanup与Session/Run mutation接入事务内gate；覆盖HTTP/gRPC/admin和自动reconciliation，竞争测试证明互斥不是仅HTTP预检查（WLIFE-SNAPSHOT-001）。
- [x] 4.4 调整恢复/孤儿清理顺序与保护未发布artifact，普通lifecycle跳过snapshot Operations；crash fixture证明startup先恢复snapshot journal、不能启动半导入Work或删掉正在导入context（WLIFE-SNAPSHOT-001，WSNAP-004）。
- [x] 4.5 增加snapshot owner-only Operation/provenance/imported-history授权和安全只读投影；测试未发布目标/已删除源任务可查、普通非owner404、非owner admin403、operator/agent拒绝、畸形历史payload不回显但原文保留、查询不排队（WACC-SNAPSHOT-001，CONV-SNAPSHOT-001）。

## 5. 外部绑定和导入后配置兼容

- [x] 5.1 实现strict bindings解析和目标model/secret权限及provider/model/baseUrl匹配，接受与发布前重验；缺失/重复/额外/过期/无权binding测试均失败，不fallback源ID/名称/默认模型（PWORK-004）。
- [x] 5.2 增加Work-owned image selection与retained Skill解析到validator/buildWorkContext/runtime-catalog；测试导入不写global catalog/defaults，无关字段修改保留owned assets，跨Work引用拒绝，显式reselect仍走原catalog（WCFG-SNAPSHOT-001）。
- [x] 5.3 将每个context绑定为接收方captured RuntimeProfile并重建新metadata；验证原注入TLS/model密钥未进入package，目标启动材料使用新平台凭证且用户自存密钥未过滤（PWORK-002、004，WACC-SNAPSHOT-001）。
- [x] 5.4 接入imported Work首次start的active/desired分支；测试active=A/desired=B启动仍A、apply才激活B、active=null且无Work DB按正常路径初始化、新运行代次/网络/TLS仅在显式start创建以及原非导入Work创建/启动回归（WCFG-SNAPSHOT-001，WLIFE-SNAPSHOT-001，CONV-SNAPSHOT-001）。
- [x] 5.5 恢复全部服务revision/heads/image/enabled/tombstone/recovery budget、清单workspace引用与逐service持久资源预留；测试enabled/disabled两服务及失败disable的非零desired预留、失败remove后的tombstone残留卷引用、required依赖、shared workspace、历史applied不冒充ready、exhausted不清零、显式retry可用，且预留/引用不触发启动（WSRV-SNAPSHOT-001，PWORK-002，WSTOR-SNAPSHOT-001）。

## 6. Export 与 Import worker

- [x] 6.1 新建 apps/core/src/work-snapshots 管理器与runtime/clock/storage依赖接口，实现export预检、gate内复验、quiescence检查；测试stale stopped、Docker不可达、在途create、非终态Run、已绑定镜像丢失均不能产生成功包（WSNAP-001，PWORK-003）。
- [x] 6.2 实现export捕获闭包（含同一Core读取快照中的quotaReservations与卷引用）、受信helper、流式blob spool、完整seal/fsync/无半包发布；测试.env/Git/dependencies/HOME/business/history/context、持久预留和卷引用全部进入包，active=null且三SQLite文件均缺席按合法空历史导出，源hash不变、source保持stopped，不新增源occupied=0前置校验（WSNAP-001，PWORK-001、002，WSTOR-SNAPSHOT-001，CONV-SNAPSHOT-001）。
- [x] 6.3 实现import stage加载verified镜像、新卷完整还原、存在时的会话归属适配与控制历史原样归档、context/service记录准备及单事务发布；发布事务按新ID写入包内逐项desired/slots并置occupied=0、重建两个卷的Work/service引用及计数、释放暂存quota，Work使用目标owner/name/time和controlVersion=1，运行代次/网络/TLS不预置；逐阶段失败注入验证Work不可见、既有资源不变，成功只发布一个stopped Work且没有运行用户代码（WSNAP-003，PWORK-004，WSRV-SNAPSHOT-001，WSTOR-SNAPSHOT-001）。
- [x] 6.4 实现30min deadline/epoch fencing/cleanup journal，按标签确认helper退出后释放gate/名额/配额；timeout和失联Docker测试保留cleanup-pending、不误删除未知卷、迟到worker无法发布或释放新锁（WSNAP-004，WLIFE-SNAPSHOT-001）。
- [x] 6.5 实现startup恢复与45秒内shutdown协调；在accept、volume/context/image、ready rename、publish前后注入崩溃，验证规定的中断或已提交成功结果、无重复Work、无错误自动启动（WSNAP-004）。
- [x] 6.6 实现24h ready包TTL、持久transfer leases、每分钟/startup GC与中断upload清理；fakeclock测试本人410/跨用户404、下载/任务引用防回收、replay不重捕获、清理范围仅job-owned数据（WSNAP-005）。

## 7. 正式 HTTP 与客户端 SDK

- [x] 7.1 在CoreApplication接入design第9节JSON routes及owner-only import-provenance，严格DTO/duplicate key/header校验；正式应用HTTP测试覆盖401/403/404/409/410/413/415/416/503与未发布Operation查询（WSNAP-001..005，WACC-SNAPSHOT-001）。
- [x] 7.2 接入流式上传/下载，先认证再读body，60s idle/30min总期限，正确headers与headersSent后断流；使用合法8MiB包验证HTTP上传/下载与背压，并覆盖中断、截断、hash错及transfer并发限额，不经过1MiB JSON readJson；本期不要求2GiB稀疏包极限压测（WSNAP-002、005）。
- [x] 7.3 上传暂存中调用受信history验证helper后才标ready，断线/崩溃回收其journal；用正常schema3/WAL/SDK历史的Work包和active=null三文件全缺席的空历史包验证上传、导入、原Session继续与首次启动，未验证package不可用于import；已有异常schema/path/sidecar拒绝单测保留，本期不新增恶意历史HTTP专项fixture（WSNAP-002、003，CONV-SNAPSHOT-001）。
- [x] 7.4 扩展client-sdk的exportWork/snapshot/download/upload/import与provenance类型，二进制独立流接口及AbortSignal；SDK测试验证bearer、URI逐段编码、header/digest、慢流取消、JSON方法回归及无自动mutation重试（CLI-SNAPSHOT-001、002，WSNAP-005）。

## 8. 用户 CLI

- [x] 8.1 新增work-snapshot纯parser/help，接入main且在凭证加载前处理usage与离线inspect；编译子进程测试覆盖四条命令、缺值/重复/未知选项、无登录help/inspect、禁止filter/auto-start/auto-stop/stdout包（CLI-SNAPSHOT-001）。
- [x] 8.2 实现本地input同fd完整校验、strict bindings和敏感内容warning；测试不发包内数据到stdout、畸形包不上传、inspect无HTTP/Docker依赖、文件在校验与上传间改变能被拒绝（CLI-SNAPSHOT-001、002）。
- [x] 8.3 实现export观察后download和独立snapshot download，0600临时文件/fsync/无覆盖发布；测试existing destination/symlink父路径/竞争创建/下载中断/hash错和重下恢复，原用户文件完整保留（CLI-SNAPSHOT-001，WSNAP-005）。
- [x] 8.4 实现import upload+单次接受、可选--wait和120s可取消串行poll；fakeclock和HTTP子进程测试验证0/1/2/3/4/5/6退出、单JSON、waiting身份恢复、观察失败不取消任务，import后不start（CLI-SNAPSHOT-001、002）。
- [x] 8.5 复跑旧main/service/login/config/chat/operation测试，验证全局选项和service create/update限制不变；测试snapshot/imported-history新增Operation分支不改变普通Operation的查询退出行为（CLI-SNAPSHOT-002）。

## 9. 文档与完整验收

- [x] 9.1 用户文档以stop/export/import/start和继续使用的最短路径为主，补充平台bindings和敏感内容警告；明确Work持久边界是两个受管卷/context/服务/镜像等而非容器临时层或匿名卷，导入不自动创建运行网络/证书；运维与格式细节分别放docs/operations和docs/work-package-format.md，覆盖helper、TTL/限额、恢复限制与回滚，不要求用户编写Work清单或历史迁移脚本；用CLI help及golden包验证示例（全部要求）。
- [x] 9.2 新增snapshot真实Docker integration，覆盖private/workspace、node_modules链接、venv/HOME工具、业务数据库、固定镜像无tag覆盖、unsupported metadata整包失败；本期以本机经典 `overlay2` image store 的真实 Docker 集成和验收为准，保留 OCI/containerd 归档解析单测，但不要求 containerd image store 实机验证（PWORK-002、003，WSTOR-SNAPSHOT-001）。
- [x] 9.3 新增scripts/work-snapshot-acceptance.mjs作为首要完成门槛：双Core/双owner、acceptance image与deterministic模型，阻断目标registry后导入启动，实际运行原开发命令/使用原服务数据/继续Session，无依赖重装或手工重建；验证双副本独立、pendingApply保持、disabled服务非零持久预留及目标occupied=0、失败remove的workspace引用、接收端预算不足拒绝、active=null且无Work DB的空历史搬迁和首次启动，导入前无运行容器/网络/TLS；再导出并导入第三份后内容、预留、引用和前后历史仍完整（PWORK-001..004，WSNAP-001、003，WCFG-SNAPSHOT-001，WSRV-SNAPSHOT-001，WSTOR-SNAPSHOT-001，CONV-SNAPSHOT-001）。
- [x] 9.4 运行npm run build、npm run typecheck及受影响contracts/work-package/core-store/work-store/runtime-docker/client-sdk/cli/core/agentd/helper单测，执行本机 `overlay2` 模式的新增Docker integration与验收脚本；逐项核对spec scenario与已有单测或正常端到端证据，不为已覆盖的历史拒绝行为新增恶意HTTP专项fixture，也不以2GiB极限压测或containerd image store实机验证作为完成条件；本机Docker不可用或本期场景未覆盖的任务不得勾选完成（全部要求）。
- [x] 9.5 运行git diff --check及openspec validate define-portable-work-and-full-snapshot --strict；核对仅新增快照能力、没有过滤/覆盖导入/自动执行/平台凭证复制或service create/update扩权，并在本文件记录测试结果与已知限制（全部要求）。

## 实施记录（2026-09-23）

- 已完成 45/50 项；核心功能已经可以经 Core HTTP、SDK 和 CLI 完成 stop/export/import/start 的实际搬迁。未勾选项仍是本 change 的交付缺口，不以端到端 happy path 或 strict OpenSpec 格式校验替代。
- 已实现 Work-local `quotaReservations` 与显式 `volume.serviceRefKeys`、严格 `.work` framing/树/镜像/历史验证、受信 Docker helper、双卷冷捕获、固定镜像恢复、持久 job/transfer/锁/配额/名称/cleanup journal、单事务导入发布、owner-only 查询、24h TTL/GC、CLI 离线 inspect 与安全下载/上传。源 occupied 不要求为零；目标 occupied 固定为零。文件与用户自存密钥不做过滤，平台身份/凭证重新生成。
- 导入卷带精确 snapshot job 标签；即使进程在 Docker 创建卷之后、journal 从 planned 前进之前退出，startup/失败清理也只尝试删除本任务卷。计划态恢复单测和 Docker 非本任务标签保留测试通过；完整多阶段崩溃注入仍留在 6.5。
- `npm run build`、`npm run typecheck`、`npm test` 全仓通过；真实 Docker `PIWORK_SNAPSHOT_HELPER_TEST_IMAGE=piwork-snapshot-helper:apply-context-20260923 npm run test:integration` 全仓通过（Core 2/2、pi-adapter 6/6、runtime-docker 8/8，零跳过）。Node 运行环境为 25.6.0，仓库声明的目标 Node 为 24。
- `scripts/work-snapshot-acceptance.mjs` 在三份独立 Core 数据根上通过源 Session/Run、真实服务、业务 DB、HOME 工具、`.venv`/本地依赖无需重装、双副本隔离、pendingApply、空历史首次启动、第三份再导入及导入前无 Work 运行目录/TLS。验收使用独有 `unreachable.invalid` 服务镜像引用；导出后从本机删除该镜像 ID，再验证目标仅从包内镜像字节恢复并启动服务。
- 已通过 `git diff --check` 与 `openspec validate define-portable-work-and-full-snapshot --strict`。当时不再要求 2 GiB 极限压测或新增恶意历史 HTTP 专项 fixture；仍缺 8 MiB HTTP 流、正常历史上传/导入验收、完整多阶段崩溃注入、原计划的双 Docker image-store 模式及逐 scenario 证据核对。本机 Docker 为传统 `overlay2` image store，无法证明 containerd 模式；双模式实测要求后来已由 2026-09-24 的范围修订取消。格式 v1 限 Linux/现有协议布局、100 GiB 包及逻辑恢复体积；外部服务/宿主目录不在 Work 持久边界内。

## 实施记录（2026-09-24）

- 已完成 48/50 项。补齐 accept、镜像/卷/上下文、ready rename、发布前后恢复测试和 abort-aware shutdown 协调测试；HTTP 覆盖缺失长度、截断、错误 hash、中断上传、两条并行 transfer 上限，并修正超额请求残留暂存目录和缺失 Content-Length 的状态码。
- 真实 Docker 验收通过合法 8 MiB 内容的流式 HTTP 上传/下载、完整包 hash 校验，以及 schema3 Session 已提交但留在 WAL 的更新：目标导入后读到更新并继续原 Session；active=null 空历史包导入后首次启动成功。受信上传 helper 单测明确确认输入包含 Work SQLite WAL 和 SDK 历史。
- 当时仍未勾选 9.2/9.4：本机只有 Docker `overlay2` image store，尚无 containerd image store 现场验证；全套最终回归和逐 scenario 证据表仍待完成。此处保留为范围修订前的历史记录，不代表最新完成状态。
- 本轮最终版本 `npm run build`、`npm run typecheck`、`npm test` 与 `PIWORK_SNAPSHOT_HELPER_TEST_IMAGE=piwork-snapshot-helper:apply-context-20260923 npm run test:integration` 均通过；修改后的 `snapshot-http.test` 和真实 helper integration 又分别定向通过。最新 `scripts/work-snapshot-acceptance.mjs` 全链路通过，包含 `node_modules/.bin` 链接、venv/HOME、业务 DB、WAL、8 MiB HTTP 传输、原 Session 继续与第三份再导入。真实 helper integration 还证明 FIFO 使整包 capture 失败。`git diff --check` 与 strict OpenSpec 校验通过。
- 本期范围修订已确认：只以本机 Docker Engine 26.1.5 的经典 `overlay2` image store 为真实集成验收目标；OCI/containerd 归档解析与单测保留，containerd image store 实机兼容性未验证、不作为本期完成门槛。按既有真实 Docker integration 和完整验收结果，9.2 已完成；当前 49/50 项，仅 9.4 的逐 spec scenario 证据核对仍待完成。未来如需宣称 containerd 模式已支持，应另用该模式的 Docker daemon 做实测，不切换本机现有 daemon。
- 最终 50/50 项完成。新增 [scenario-evidence.md](scenario-evidence.md) 将 9 份 delta spec 的 71 个 Scenario 逐项映射到现有单测或真实验收；核对时补齐 CLI export 超时恢复与单 JSON 结果、两份导入副本各自继续同一 Session/WAL、目标 Docker 架构不兼容拒绝与安全 Operation 诊断，以及 export helper 未确认退出时保留 gate 的回归测试。
- 最终 `npm run build`、`npm run typecheck`、`npm test` 通过；`PIWORK_SNAPSHOT_HELPER_TEST_IMAGE=piwork-snapshot-helper:apply-context-20260923 npm run test:integration` 串行复跑通过（Core 2/2、pi-adapter 6/6、runtime-docker 8/8，零跳过）；`node scripts/work-snapshot-acceptance.mjs` 通过，包含 8 MiB HTTP、双副本 Session/WAL 继续、第三份再导入及 active=null 空历史。曾在与 `npm test` 并行的 Docker integration 复跑中出现一次既有 service readiness 15s 超时；随后串行完整复跑通过。`git diff --check` 与 `openspec validate define-portable-work-and-full-snapshot --strict` 通过。

## 10. 开箱即用导入与跨安装内置 MCP

- [x] 10.1 调整 contracts/SDK 的 import 请求为 `{packageId,name?,idempotencyKey}`、接受响应增加最终 `name`，拒绝未知 `bindings`；保持既有 v1 包内 `bindings` 清单与 upload `bindingRequirements` 响应可读。用无外部 MCP secret 的既有 v1 fixture 验证兼容导入，并测试请求多余字段被拒绝（PWORK-004，WSNAP-003..005）。
- [x] 10.2 将用户显式 bindings 解析改为 Core 自动模型解析：按 provider/model/规范化 baseUrl 筛选 enabled 且凭证可读的目标模型，按最高 runtime revision、再按 catalog ID 排序确定选择；接受时持久捕获内部映射、发布前重验。测试多个历史 context、同型号多候选、凭证缺失/变更、无匹配时 TARGET_MODEL_UNAVAILABLE，以及无源模型密钥进入包或控制响应（PWORK-002、004，WCFG-SNAPSHOT-001）。
- [x] 10.3 在导入接受事务内实现 sourceName 默认名称与 `-2`、`-3` 冲突后缀，覆盖已有、deleted Work 和并发 name hold；显式 name 冲突仍返回 WORK_NAME_CONFLICT。幂等 digest 只含包 digest 与显式 name/null，重试返回原 Work/Operation/name；测试双导入、并发与超长源名称（PWORK-004，WSNAP-003、004）。
- [x] 10.4 将无自定义外部 MCP secret 的包恢复路径改为使用 Core 自动生成的模型映射；包内有该类 secret 要求时接受前返回 EXTERNAL_MCP_SECRET_UNAVAILABLE，不发布半成品或要求 bindings。测试导入 context 的目标 credentialRef、active/desired 保留及 Work 文件/历史未被修改（PWORK-002、004，WSNAP-003，WCFG-SNAPSHOT-001）。
- [x] 10.5 更新正式 Core HTTP/SDK/CLI 错误映射，保留 TARGET_MODEL_UNAVAILABLE、EXTERNAL_MCP_SECRET_UNAVAILABLE、WORK_NAME_CONFLICT 等安全 code 与处理提示，杜绝只有 `Work snapshot request cannot be accepted`；用 API 与编译 CLI 子进程测试接受前 stdout 为空、stderr 可诊断、无凭证泄漏及既有退出码（CLI-SNAPSHOT-002，WSNAP-005，WACC-SNAPSHOT-001）。
- [x] 10.6 CLI 支持 `work export <workId>` 验证 ResourceId 后默认 `<workId>.work` 和 `work import <file> [--name] [--wait]`，移除 `--bindings` 文件读取；保留原有安全新建/无覆盖发布、上传校验和 wait 观察。测试 `first.work` 类无外部 secret 的单文件导入、默认/显式路径与名称、含路径分隔符的无效 workId、重复/未知选项、既有输出文件和 JSON 单结果含最终 name（CLI-SNAPSHOT-001、002）。
- [x] 10.7 补齐双 Core 真实 Docker 权限验收：保留已通过的源 active `work-services`、源 Core 断开、目标 pi-agentd 经真实 SDK→MCP adapter→mTLS gRPC 列出及 stop/start 新 service 并读取 Operation 的正向路径；另用导入后真实 pi-agentd 的模型工具列表断言源策略禁止的 `work-services.service_stop` 不可见，显式移除 MCP 后不被目标默认值补回。用目标新运行身份经真实 MCP/gRPC 对源 service ID 和目标 Core 另一 Work 的 service ID 分别尝试查询及变更，断言拒绝且没有跨 Work Operation 或状态变化；不能只以独立 agentd/gRPC 单测替代这些导入后断言（WSRV-SNAPSHOT-001，WCFG-SNAPSHOT-001，WACC-SNAPSHOT-001）。
- [x] 10.8 在 10.7 和 10.9 完成后，复跑 `npm run build`、`npm run typecheck`、受影响单测、真实 Docker integration、双 Core 验收、`git diff --check` 和 `openspec validate define-portable-work-and-full-snapshot --strict`；更新已有 scenario-evidence.md 的对应证据并核对全部场景，再勾选本项。README、用户快照文档与 operations 的最短命令路径及目标模型前提、自定义外部 MCP 平台 secret 限制此前已更新，不重复改产品行为（全部本次修订要求）。
- [x] 10.9 新增编译后 CLI→真实双 Core 的完整搬迁验收：在隔离源/目标安装分别用 CLI 用户凭证执行 `work export <workId>`（默认 `<workId>.work`）和 `work import <file> --wait`（不提供 name/bindings），确认本地文件完整、0600/无覆盖、目标名称和成功 Operation、目标 Work 导入后 stopped 且无容器/网络/TLS，随后显式 start 并继续原服务/Session；不能用模拟 HTTP 的 CLI 单测加直接 HTTP 双 Core 验收代替串联路径。现有本地 `first.work` 可用时另在独立临时目标 Core 配齐其模型要求并实际导入成功，只验证安全元数据且不启动、不向现用 Core 写入、不提交该私有文件；无此文件的环境用可复现的 v1 fixture 验证兼容性，但不宣称验证了该具体包（CLI-SNAPSHOT-001、002，WSNAP-003，PWORK-004）。
