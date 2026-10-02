# Tasks

执行顺序：1–9 完整 Go Core（含 operator 与四种 Go 辅助程序）→ 10–11 Go 用户 CLI → 12–13 Go 浏览器后端 → 14 删除旧平台并验收发布。Go MCP、Go package-helper 及兼容 Agent 镜像在 3.7–3.9 完成，先于 5.1 的真实 harness 运行；文件/快照 helper 分别在 8/9 完成。9.12 的 Core gate 通过后再开始 10；11.6 的 CLI gate 通过后再开始 12。规格映射详见 [verification-matrix.md](verification-matrix.md)，每项验证结果随实施写入 `docs/go-migration-acceptance.md`；本清单的测试要求与代码同时交付。

补充核验（2026-10-02）：verify 复现凭证父目录安全性和失效会话 logout 两项 WARNING，由 14.10–14.11 跟踪修复。原勾选项保留此前实际执行记录；两项补充任务完成前，迁移仍为未完成，原验收报告和 970 条场景证据不得作为这两项行为已符合规格的结论。补充回归关联现有两条 CLI 要求，完成后更新最终证据与发布产物。

前轮补充收尾（2026-10-02）：14.10–14.11 已完成，当时共 115/115。修复后的精确回归、完整 make test、Desktop 浏览器、真实 Engine CLI/Service/WebDAV、无解释器 scratch 发布宿主和发布校验全部通过；最终证据、报告和发布包已更新，两项 WARNING 关闭。

并发凭证补充核验（2026-10-02）：verify 另复现并发登录/登出删除新凭证的 WARNING，由新增 14.12 跟踪，修复前进度为 115/116。这里指同一用户的 CLI 进程或 CLI/Desktop 共用凭证文件；同一 Core 重新登录的新 token 也必须保护，其他 Core 登录只是另一种回归场景。原勾选项保留实际执行记录，修复前的最终报告和 970 条场景证据不能作为这项并发行为已符合规格的结论。

当前收尾（2026-10-02）：14.12 已完成，共 116/116。17 个顶层精确回归、race、完整 make test、源码/镜像边界及最终发布二进制的独立 Engine scratch 闭环均通过；原失败复现已验证保留新凭证。既有 6 条 CLI 场景的证据、验收报告和发布包/清单/校验和已更新，OpenSpec strict 校验通过。完整 Engine/Chrome/Edge 基线沿用前轮证据，不把它们描述为本轮全量重跑。

## 1. Go 工程、共享契约与验收基础

- [x] 1.1 建立 design D1 的根 Go module、固定工具链和纯 Go 依赖及最小程序入口；关联 NATIVE-001/007。验证：`CGO_ENABLED=0 go build` 成功，依赖有 go.sum，构建版本可追溯，不启动旧 TS 后端。
- [x] 1.2 将两份现有 proto 作为根 proto 单一来源，固定 protoc/Go/TS 生成器并生成两侧代码；关联 NATIVE-004、work-connectivity、work-services。验证：descriptor 的字段/enum/optional/oneof 无变化，重复 generate 无 diff，TS harness 与 Go RPC 构建通过。
- [x] 1.3 实现 Go HTTP DTO、错误投影和严格校验基础，导入当前 HTTP/Agent/context/helper 契约 fixtures；关联 core-admin-api、work-access、NATIVE-004。验证：缺失/null/空集合/默认值、未知字段、边界整数与安全错误的表驱动测试通过。
- [x] 1.4 提取现有 Skill/context/Pi package 规范编码与摘要 fixtures，实现 Go 对应编码；关联 skill-activation、pi-package-activation、NATIVE-004。验证：TS 和 Go 对中文/排序/执行位/链接/空内容得到相同共享身份，Core 私有哈希独立测试稳定性。
- [x] 1.5 建立 Go 测试驱动与按唯一 installation label 隔离的 Docker fixture，接入现有确定性 SDK 模型；关联 NATIVE-006、runnable-work-runtime。验证：驱动禁止真实模型默认调用及无范围清理，测试结束只删除自己的资源，其他测试资源仍在。
- [x] 1.6 新建 `docs/go-migration-acceptance.md` 的场景证据索引与 Go 构建说明，接入 make 的 generate/Go unit/integration 入口；关联 NATIVE-006/007。验证：矩阵的每个场景均有待验证记录，命令按文档可执行，尚未实现的 gate 不显示通过。
- [x] 1.7 按 design D4.1/D10 在验收文档建立完整 TS harness/浏览器的保留模块、导出、依赖与消费者清单，以及七种 Go 程序和镜像入口清单；关联 NATIVE-004/007。验证：Agent RPC/Session/Run/store/MCP 客户端依赖均有归属，独立 MCP/package-helper 明确为 Go，当前共享包中的平台专属导出有删除/迁移位置，开发工具与生产依赖区分明确。

## 2. Core 新格式存储与事务

- [x] 2.1 实现目录安全检查、OS 排他锁、Go marker 与 schema 1 的原子初始化；关联 CST-NATIVE-001。验证：空目录、部分初始化恢复、第二进程、旧 TS/未知/损坏格式分别得到规定结果，拒绝前后原目录内容相同。
- [x] 2.2 将当前最终 Core 表/索引/外键/唯一性约束移植到 Go schema，建立真实 SQLite repository；关联 work-storage、user-authentication、work-configuration。验证：事务回滚、外键、持久重开、desired/active/context 与用户记录的往返测试通过。
- [x] 2.3 实现幂等接受、持久 Operation、Work control version 和目标 fence；关联 work-lifecycle、WSRV-003、work-snapshots。验证：相同键重用、不同内容冲突、并发版本取代、提交前后崩溃均不重复接受或覆盖新结果。
- [x] 2.4 实现 Work/host 配额、service/volume 引用和保留占用记账；关联 WSRV-007、work-storage。验证：并发预留原子拒绝、共享卷只计一次、未确认释放不回收预算、重启保留占用。
- [x] 2.5 实现网络身份、文件任务/epoch/attempt、包与快照 jobs/leases/locks 的持久 repository；关联 CST-NATIVE-001、WLIFE-FILES-002、work-snapshots、pi-package-management。验证：真实 DB 重开保留归属，终态/cleanup-pending 和 lease 约束不能相互绕过。
- [x] 2.6 更新 operations 中 Go 数据格式、目录所有权、拒绝旧目录和恢复说明；关联 CST-NATIVE-001、NATIVE-007。验证：在独立临时目录运行文档化初始化/重开/拒绝流程，且不自动删除旧开发数据。

## 3. Docker Engine API、证书、原生辅助程序与镜像

- [x] 3.1 实现 Docker endpoint/context 解析、Unix socket 连接、API 版本协商与静态 registry auth；关联 NATIVE-002。验证：优先级、rootless socket 配置、未知/远程 context、socket 拒绝、版本不匹配和外部 cred helper 均有明确结果且无 fallback/凭证泄漏。
- [x] 3.2 实现容器/网络/卷的 inspect/list/create/start/stop/kill/remove 与受管身份核验；关联 runnable-work-runtime、work-storage、WSRV-ACCESS-002。验证：真实 Docker 无 CLI 运行，名称碰撞/错误 labels 被拒绝，重复 create 和迟到 create 不生成双实例。
- [x] 3.3 实现镜像解析/pull/固定身份、网络端点、资源限制和 readiness exec/HTTP/TCP；关联 WSRV-002/008/011、runnable-work-runtime。验证：tag 改变仍用原 ID，pull 错误和探针失败不伪报 ready，CPU/内存/mount/无宿主端口配置正确。
- [x] 3.4 实现 Docker logs/attach/archive/image save/load 的有界流与 multiplex 解码；关联 NATIVE-002、work-snapshots、work-file-access。验证：二进制完整性、分段/背压、stderr 截断、响应体 error、取消/超时/迟到资源案例通过，无整包入内存。
- [x] 3.5 用 Go 生成并持久保存 CA/两向角色证书与受控配置文件，保留 Agent 挂载及权限；关联 NATIVE-004、work-access。验证：真实 TS Agent 与 Go 双向握手成功，错误 SAN/角色/代次/过期证书被拒绝，PATH 无 openssl 仍可完成。
- [x] 3.6 更新 operations 的 Docker 目标、认证支持和内部 TLS 依赖说明；关联 NATIVE-001/002。验证：按文档在无 Docker CLI 的 Core 进程环境连入测试 Engine，失败示例返回安全诊断。
- [x] 3.7 实现 Go package-helper 的 prepare/init/capture/measure、manifest/归档/inventory/共享摘要和限额校验，以及兼容容器内 npm/Git 命令执行；关联 NATIVE-005、PKG-002/003、OPKG-001/002。验证：四入口及 npm/Git/local/ZIP fixtures、peer/Node ABI、原 manifest 字节、来源/依赖错误、命令超时与取消符合契约；非 prepare 入口不执行包脚本，工具只在镜像内调用；同步更新 package/helper 构建说明。
- [x] 3.8 实现 Go Service MCP 的 stdio、12 个既有工具及显式严格 schema、JSON 投影、受控配置和 Core mTLS gRPC 客户端；关联 NATIVE-004/005、MCP-SERVICE-001/002。验证：真实 TS MCP 客户端发现/调用 Go 子进程，默认值/未知字段/uint64/text/structuredContent fixtures 一致，错误安全、stdout 无诊断、丢失响应不换 key 重发，按 Agent 的五秒回收边界退出；同步更新 SDK adapter/MCP 程序说明。
- [x] 3.9 实现 design D6.1 的 Agent production/acceptance 多阶段镜像、两个 Go 程序固定路径/能力标识，以及 Engine API 的静态能力检查与检查资源归属回收；关联 NATIVE-004/005/007、OPKG-003、runnable-work-runtime。验证：两种 target 均含正确平台 Go 可执行文件、保留 Node Agent 入口；仅 TS helper/虚假 label/缺文件/错误平台被拒绝，检查不执行用户包或 helper，无旧 dist/shebang；更新镜像构建和兼容文档，真实 TS harness 可启动。

## 4. Core 启动、身份和 operator 控制面

- [x] 4.1 实现 Go application 启动、env-file、listen 校验、health/readiness、部分初始化与 runtime 状态；关联 core-service-startup、serve-control-plane。验证：空安装可健康监听、无默认 Work、缺 admin/runtime 可在线补齐，非法非 loopback 明文参数在监听前拒绝。
- [x] 4.2 实现密码验证、用户 bearer 会话持久化、login/whoami/logout 和账号管理；关联 user-authentication、user-administration。验证：禁用/重置/过期/撤销、重启后 token、反枚举与角色保护测试通过，DB 只存 token digest。
- [x] 4.3 实现 operator credential、离线和在线 bootstrap/config 及安全文件处理；关联 serve-control-plane、core-service-startup。验证：重复 bootstrap 不覆盖，离线写遵守目录锁，stdin secrets 不出现在 argv/日志/响应。
- [x] 4.4 实现 owner/admin/operator/Agent 的授权 policy 与现有 Core admin HTTP 路由；关联 core-admin-api、work-access。验证：管理员控制他人 Work 与禁止读取其聊天/文件/日志的差异成立，跨 owner 与缺失资源不可区分。
- [x] 4.5 实现 Go operator 的 admin/status/runtime/default-work 基础命令、帮助/JSON/退出码和 `piwork` 别名；关联 control-cli、NATIVE-001。验证：黑盒运行真实程序、错误命令在 I/O 前拒绝、每次 JSON stdout 单值，用户命令不能进入 operator。
- [x] 4.6 更新 README 的 Go Core 初始化和身份入口示例，并记录启动/权限阶段证据；关联 core-service-startup、NATIVE-007。验证：复制示例完成 bootstrap→config→status，配置变化不需要重启 Core。

## 5. Work 生命周期、Agent RPC 与对话

- [x] 5.1 实现两个受管卷、Work 私网、Agent 配置/context 挂载与 readiness 路由，接入 3.9 的 Go 内置镜像能力检查；关联 runnable-work-runtime、work-storage、NATIVE-004/005。验证：完整 TS harness 以原 uid/路径启动，workspace 与 private 分离，缺 Go MCP/package-helper 或错误镜像/context 不开放路由、不接受 Run；Agent 自身 RPC/Session/Run/store 保持 TS。
- [x] 5.2 实现 Work create/list/detail/start/stop/retry/delete 的持久协调和 Operation 查询；关联 work-lifecycle、core-service-startup。验证：Work 目标覆盖、幂等、默认保留数据、未确认停止与删除不伪成功。
- [x] 5.3 实现 Core startup recovery、单 Agent 代次、预算/退避、desired-running 恢复与 orphan 诊断；关联 work-lifecycle、work-diagnostics。验证：创建后崩溃、失联旧实例、连续 crash、Core 重启不重置预算、未知资源不删除。
- [x] 5.4 实现有界 drain、跨 Work 并发 shutdown 和信号退出状态；关联启动 delta 的 shutdown/restart、WLIFE-SERVICE-001/002。验证：30/10/45 秒预算及配置覆盖、Agent 无响应仍尝试其他资源停止、正常退出保留 desired、失败非零并可恢复。
- [x] 5.5 实现 AgentService Go 客户端及 Session create/list/read、Run submit/get/cancel 的 Core HTTP 转发；关联 agent-conversation、work-connectivity。验证：真实 SDK 保存并继续 Session，同键不重复执行，单 Work 活动 Run 边界与授权先于 RPC。
- [x] 5.6 实现 WatchRun 事件转发、游标、保留窗口、慢观察者缓冲与独立连接取消；关联 work-connectivity、agent-conversation。验证：分段及时到达、断开不 CancelRun、过期游标报错、一个慢观察者不阻塞其他观察与执行。
- [x] 5.7 实现 Work/Operation 的安全阶段诊断、有限日志收集和脱敏；关联 work-diagnostics。验证：初始化失败、回退失败、采集失败与原错误分别保留，重启后查询一致且不含秘密/内部路径。
- [x] 5.8 更新 operations/SDK adapter 的 Go Core→TS Agent 职责、重启与信号说明；关联 NATIVE-004、work-lifecycle。验证：真实 Go Core 重启后可继续 Session，文档不再称优雅退出会保留容器运行。

## 6. Work 配置、Skills 与 Pi Packages

- [x] 6.1 实现全局 defaults、独立 Work context、完整/字段级 Save 与公开 desired/active/pending 投影；关联 work-configuration。验证：省略与显式空集合、后保存取代、现有 Work 不跟随 defaults，内部分配 revision 不泄露。
- [x] 6.2 实现 Skill 管理/上传、目录复制、AGENTS.md、安全限制和 Go 内嵌 deploy-work-service 资源；关联 skill-management、agent-service-deployment。验证：原树及附属文件完整保留、不安全树拒绝、源目录删除后仍可加载，部署 Skill 被真实 SDK 发现。
- [x] 6.3 实现 Apply 接受时 context 捕获、busy 判断、切换、readiness 与失败回退；关联 work-configuration、skill-activation。验证：保存不重启、活动 Run 不被取消、Apply 期间新 Save 仍 pending、失败保留 prior active、停止 Work Apply 不 Start。
- [x] 6.4 实现 npm/Git/upload/local ZIP 的 Go 输入校验、受限上传与不可变内容存储；关联 PKG-001/003、core-admin-api。验证：四来源成功输入、重复路径/越界链接/炸弹/限额/错误 manifest 拒绝，不执行包内代码。
- [x] 6.5 实现 Go 包准备调度并连接 3.7 的 Go package-helper，接入 3.9 镜像能力检查及 platform/Node ABI/SDK 契约、日志/时限/空间控制；关联 PKG-002、OPKG-003、NATIVE-004/005。验证：新请求在不兼容镜像上以 PI_PACKAGE_HELPER_INCOMPATIBLE 拒绝且无 Operation，已接受同键重放先返回原结果；真实 Go helper 产物由 TS harness 验证并加载，来源/依赖失败分类正确，无宿主 npm/Git 调用、秘密挂载或 TS helper fallback。
- [x] 6.6 实现 Pi package 摘要/inventory/制品发布、Core/Work scope CRUD 与 --from-core 独立复制；关联 pi-package-management、pi-package-activation。验证：同名冲突、显式来源更新、enabled/default 引用、失败保持旧制品、desired 与 loaded 分离。
- [x] 6.7 实现 package durable jobs、leases、GC、崩溃恢复和 shutdown 收尾；关联 pi-package-management、work-storage。验证：发布前后崩溃、未确认 helper、引用保留、多次重启不丢失制品或误清理仍被引用内容。
- [x] 6.8 实现 Agent context 的包资源加载投影与故障诊断透传；关联 pi-package-activation、online-pi-package-compatibility、mcp-tool-access。验证：真实 SDK 发现 extension/skill/prompt/theme 与工具策略，来源离线重启不重新安装。
- [x] 6.9 完成 operator skills/packages/default-work/operation 命令及上传/等待/verbose；关联 CLI-PKG-001/003、skill-management。验证：四来源、250 ms 观察与退避、Ctrl+C 只停止等待、JSON 单值、错误 CLI 的命令拒绝。
- [x] 6.10 移植在线 Pi 包成功与故障验收场景到 Go Core，更新 README/package 流程说明；关联 online-pi-package-compatibility、NATIVE-006。验证：规定公开包实际安装→Apply→loaded 成功，故障注入分类成立；网络未执行项明确保留未验证。

## 7. Service 编排与 Core 服务网关

- [x] 7.1 实现完整 Service 定义规范化、revision、配额原子接受和稳定 Agent 幂等作用域；关联 WSRV-001/002/003/007/011。验证：默认值等价重试、无效/越权配置无副作用、并发更新/配额不越界。
- [x] 7.2 实现 Service create/update/start/stop/restart/retry/remove worker 和 readiness；关联 WSRV-004/005/006/008。验证：Work stop 保持 enabled、服务 stop 持久禁用、失败 revision/已应用历史准确、恢复预算不因重启清零。
- [x] 7.3 实现 Work stop/delete/shutdown 对 Service 的 fence、迟到资源清理与恢复接管；关联 WSRV-009、WSRV-ACCESS-002。验证：pull/create 延迟期间 stop、Agent 已缺失、未确认 Docker 结果不产生假 stopped，匹配实例只接管一次。
- [x] 7.4 实现 WorkServices gRPC mTLS server、HTTP 读写路由和 deployment context，接通 3.8 的 Go MCP；关联 work-access、NATIVE-004/005、agent-service-deployment。验证：真实 Pi SDK→TS MCP 客户端→Go MCP→Go Core 完成发现、部署及 Operation 查询，错误 Work/角色/代次拒绝且无定义写入；慢 pull 不耗尽工具调用，Agent 停止后 Go 子进程被回收。
- [x] 7.5 实现 Service list/show/access/endpoints、有限 logs 与安全输出；关联 WSRV-ACCESS-001、work-diagnostics。验证：HTTP/gRPC 投影一致，disabled/failed 仍有稳定域名，owner 与 admin 日志权限不同。
- [x] 7.6 实现 Core 域名 resolver、短 ID 网络名冲突延长、默认 Web 端口选择及 gateway capability；关联 service-network-access、WSRV-ACCESS-002。验证：中文 Work 显示名不影响网络身份、多 TCP/无 TCP 返回准确投影、派生身份不写进 Work 配置。
- [x] 7.7 实现 Core HTTP/SSE/WS 转发及应用认证/平台认证隔离；关联 service-network-access、work-access。验证：真实服务路径/query/body/status/cookie/Basic/Bearer 往返、SSE 首段及时、WS 双向，任意 IP/端口目标拒绝。
- [x] 7.8 实现 gateway 连接配额、建连时限、当前容器核验和两秒资格复核；关联 service-network-access。验证：会话撤销、Work/service stop、Docker 失联和慢流分别关闭或安全拒绝，应用 401 不触发平台登出。
- [x] 7.9 更新 Service 部署与网络访问文档并记录真实计数服务演示；关联 agent-service-deployment、NATIVE-006。验证：AI 通过原 Skill 部署、HTTP 访问改变 workspace 文件、停止重启服务仍保留计数。

## 8. Core WebDAV 与 Go 文件 helper

- [x] 8.1 实现 Go file-helper 协议解析、数据流与 Go 镜像，接入 Core Docker API attach；关联 NATIVE-005、work-file-access。验证：镜像不含 Python/Node，uid/network/mount/capability/限额与规范一致，不依赖 agentd 或用户 Service。
- [x] 8.2 实现 safefs 的 fd-relative/no-follow 文件查询、路径验证与目录枚举；关联 work-file-access 的路径/查询要求。验证：中文/编码/空目录、链接/特殊文件、路径替换竞争不读写 workspace 外内容，根目录受保护。
- [x] 8.3 实现流式 GET/HEAD、单段 Range、条件请求与 XML PROPFIND；关联 work-file-access 的查询/传输要求。验证：零字节/大文件/部分属性、Depth infinity、无效及多段 Range、HEAD 无 body、恶意 XML 与客户端断开结果正确。
- [x] 8.4 实现 PUT 暂存、提交许可、fsync/原子发布及 MKCOL；关联 work-file-access、WLIFE-FILES-001。验证：If-None-Match、已有硬链接、no-overwrite 竞争、中途失败不留下部分目标，未经提交许可不改变目标。
- [x] 8.5 实现 COPY/MOVE/DELETE、Destination 校验与 207 部分失败；关联 work-file-access 的命名空间修改要求。验证：同 Work 移动/复制、覆盖与禁止覆盖、递归部分成功、跨 Work/外部目标及根目录修改分别符合规范。
- [x] 8.6 实现 Core 文件授权、能力探测、readiness、请求/目录/流限额和稳定错误；关联 work-access、work-file-access。验证：owner-only、stopped/未核验拒绝、degraded 可用、无 helper 的 503 与应用错误分离、Core 根/Agent 私有卷不可访问。
- [x] 8.7 实现 file job/epoch/attempt、串行写入许可、取消、stop/apply/snapshot 准入互斥；关联 WLIFE-FILES-001、work-snapshots。验证：并发文件写入忙碌、Stop 先后顺序、Save 不关闭访问、Apply 不遗留迟到写入。
- [x] 8.8 实现文件资源 recovery 与暂存清理，接入 Core 启停；关联 WLIFE-FILES-002、NATIVE-005。验证：提交前/后崩溃、Docker create 超时后迟到、无法确认 helper 退出、未知标签资源均按归属处理，不重放用户 mutation。
- [x] 8.9 将 work-files/crash acceptance 场景接到 Go Core/helper 并更新 work-files 文档的镜像/平台边界；关联 NATIVE-005/006。验证：真实 Docker 上执行读写/故障集，Service 读到相同 workspace 数据，Core 不直接访问 Docker 宿主卷路径。

## 9. `.work` V1、Go 快照 helper 与完整 Core gate

- [x] 9.1 实现共用 V1 framing、严格 JSON、blob 流/hash 与安全摘要；关联 portable-work、WSNAP-002、NATIVE-005。验证：合法 golden 包读取、重复 key/未知字段/坏 UTF-8/不安全整数/截断/尾随/摘要错误均拒绝，内存不随包大小增长。
- [x] 9.2 实现 manifest 引用闭包、context/package/service/预留/卷关系，以及供离线 inspect 使用的静态镜像检查与 Core 独立目标兼容检查；关联 portable-work、work-storage、pi-package-management、WSNAP-002、NATIVE-005。验证：缺失/重复/悬空条目、逻辑恢复量绕限、Node ABI/架构不符在资源发布前拒绝；仅 TS helper/虚假声明/被 whiteout 删除的原生文件返回 PACKAGE_INCOMPATIBLE，不执行包内代码、不替换镜像或新增 V1 字段；Core 复核全部包数据及镜像能力，客户端 inspect 成功不能跳过目标检查，兼容性不按生产者语言判断。
- [x] 9.3 实现 Go 快照文件树 capture/restore 和原生镜像；关联 portable-work、NATIVE-005。验证：两个卷中隐藏文件/权限/硬链接/符号链接/空目录/依赖内容往返，恶意树不越界且不执行任何内容。
- [x] 9.4 实现 Work schema 3 历史校验及新身份重建，保持 SDK JSONL 不透明；关联 agent-conversation、NATIVE-005。验证：正常/无历史、WAL/SHM、非终态 Run、恶意 trigger/路径分别接受或拒绝；合法导入后真实 TS Agent 可继续会话。
- [x] 9.5 实现 export 准入锁、实际 writers 核验、镜像 capture 和完整 package 发布；关联 WSNAP-001、work-snapshots 文件要求。验证：运行中拒绝且不隐式 Stop、数据库假 stopped/残留 helper 拒绝、缺镜像/数据失败无半包。
- [x] 9.6 实现 bounded 完整 uploads/downloads、snapshot 保留/过期、owner-only 内容访问与权限，并显式拒绝 Range；关联 WSNAP-005、work-access、NATIVE-005。验证：有效单段、多段及无效 Range 均返回 416 且不提供部分内容；上传/下载中断、过期、用户禁用和流限额结果正确，保留期内按原 snapshot ID 从头重取相同内容/hash，不重新导出、不读取源 Work、不泄漏内容。
- [x] 9.7 实现 import 完整预检、model/MCP bindings、资源容量预留、隔离恢复与原子发布；关联 WSNAP-002/003、portable-work、NATIVE-005。验证：完整性及静态镜像检查已通过的包在目标缺凭据、平台不兼容或容量不足时仍按既有具体错误拒绝，不能以 inspect 成功绕过检查；显式重名、自动命名竞争和恢复失败均不暴露半成品，发布前再次核验目标约束，成功得到新 ID 的 stopped Work。
- [x] 9.8 实现导入后的 Service/context/Skill/Pi package/网络身份映射；关联 WSRV-SNAPSHOT-001、work-configuration、service-network-access。验证：保留 enabled/tombstone/预算/历史，只有受管身份变化，源 URL/用户数据库/包字节不替换，目标 MCP 可管理新 service ID。
- [x] 9.9 实现 export/import durable jobs、发布前后 recovery、leases/GC 和有界 shutdown；关联 WSNAP-004、work-storage。验证：各副作用边界故障注入不重复发布、不删除共享制品，已发布 Work 可查询，残留资源精确收尾。
- [x] 9.10 将快照/包故障验收接入 Go Core/helper，更新 work-snapshot/work-package-format/operations 的实现说明；关联 NATIVE-005/007。验证：文档流程 export→inspect→import→start 真实执行，V1 格式和停止边界未扩展。
- [x] 9.11 完成 Core 所有模块的 startup/shutdown 集成和诊断回归；关联 core-service-startup、work-lifecycle、work-diagnostics。验证：带 Run、Service、package/file/snapshot job 的 Go Core SIGTERM/SIGKILL 重启，无重复实例、无丢失已接受身份、未确认状态不伪装成功。
- [x] 9.12 通过完整 Go Core gate 并记录矩阵中所有 Core/Agent/辅助程序场景证据；关联 NATIVE-001/004/005/006。验证：独立空 Go 安装用真实 Docker/完整 TS harness 完成身份→Work→配置/包→Service→文件→双安装快照链和失败/权限/竞争集；被测 Core、MCP、package/file/snapshot 程序均为 Go，镜像能力拒绝及子进程边界已验证，无 TS 平台 fallback。

## 10. Go 用户 CLI 与业务命令

- [x] 10.1 实现 Go client 的 Core URL 解析、用户凭证读写、认证错误与安全请求；关联 control-cli 登录/身份 delta、work-access。验证：help/usage 先于凭证读取、端点归属、0600/符号链接、失败登录保留旧凭证、离线 logout 不丢凭证。
- [x] 10.2 实现用户 status/login/logout/whoami、Work create/list/show/start/stop/retry/delete/operation 命令；关联 CLI-WORK-001、CLI-OUTPUT-001。验证：真实子进程覆盖默认与覆盖配置、幂等、等待/失败退出、JSON 单值，operator 命令在用户入口被拒绝。
- [x] 10.3 实现 Work config/skills/AGENTS 命令与 catalog 发现；关联 CLI-WORK-001、CLI-SKILL-001、CLI-DIAG-001。验证：显式空集合、缺/重复参数、Save/Apply/pending/loaded、失败后 operation show，所有公开 revision 禁用。
- [x] 10.4 实现 Core catalog/Work Pi package 四来源及 from-core 命令、上传和持久观察；关联 CLI-PKG-002/003。验证：来源互斥在 I/O 前拒绝、自动幂等键、250 ms/退避/无总限时、verbose 心跳、Ctrl+C waiting 与后台继续。
- [x] 10.5 实现 Session/Run/chat、终端/脚本输入、游标与显式取消；关联 CLI-CHAT-001、agent-conversation、work-connectivity。验证：Go CLI 调真实 TS SDK，持久 Session、观察断开不重提、Ctrl+C 请求取消、Run 终态退出码正确。
- [x] 10.6 实现八个既有 service 子命令、受限投影/日志、120 秒观察；关联 CLI-SERVICE-001 至 006。验证：按 ID 寻址、create/update 仍拒绝、owner/admin 权限、应用不可用/截断日志、未知接受结果不伪造 ID 或重发。
- [x] 10.7 实现离线 package inspect 与 Work export/import/snapshot download；关联 CLI-SNAPSHOT-001/002、WSNAP-002/005、NATIVE-005。验证：inspect 不登录、不联系 Core/Engine/网络、不执行包或 SQLite，成功摘要为 integrityVerified=true、installationValidated=false；包内镜像能力不支持返回 PACKAGE_INCOMPATIBLE，目标缺凭据/配额不足不使合法包的离线 inspect 失败，但后续导入由 Core 拒绝；下载不发送 Range，校验后原子本地发布，覆盖/中断/空间不足保留原 snapshot ID，从头重取且不重做 export，JSON 和各错误退出符合规范。
- [x] 10.8 更新 README、snapshot 和用户命令文档为原生 CLI 示例，移植对应命令黑盒测试；关联 NATIVE-001/007、control-cli。验证：在无 Node/Docker 的 CLI 进程环境执行所有命令组示例，日志不含秘密或源绝对路径。

## 11. Go proxy、WebDAV 入口与 CLI gate

- [x] 11.1 实现前台 proxy:17890、PAC、absolute-form Service HTTP/WS 与受限 CONNECT；关联 CLI-SERVICE-PROXY-001。验证：curl/WS 往返，非法 Host/域名/端口/协议与开放 TCP 隧道拒绝，帮助无网络，端口占用不换端口。
- [x] 11.2 实现同 listener 的多 Work WebDAV origin-form 路由、随机 Basic 密码和 XML/Location/Destination 映射；关联 CLI-FILES-001、work-access。验证：两个 Work 不串数据、同名 service 路径不被劫持、跨 Work 目标拒绝、重启旧密码失效且只首次输出密码。
- [x] 11.3 实现独立文件能力探测/降级、平台会话撤销和传输收尾；关联 CLI-FILES-002 delta。验证：文件 404/503/207 与应用 401 不退出 proxy，确认平台 401 才退出3，丢失 PUT/COPY/MOVE/DELETE 响应不重放。
- [x] 11.4 接通流式背压、header/XML 限额、超时和 Ctrl+C 退出；关联 CLI-SERVICE-PROXY-001、CLI-FILES-001。验证：并行 SSE/WS/大文件、慢客户端/上游取消不泄漏连接，退出130不 Stop Work。
- [x] 11.5 更新 work-files/网络使用文档，提供单 proxy 的 curl 与 rclone 通用模式示例；关联 CLI-FILES-002、NATIVE-007。验证：真实通用 WebDAV 工具完成列表、上传、下载、移动、删除，不要求系统挂载或 LOCK。
- [x] 11.6 通过 Go CLI gate 并记录命令/proxy 场景证据；关联 NATIVE-001/006。验证：Go CLI + Go Core + 完整 TS harness + Go MCP/package/file/snapshot 程序完成对话部署、service 访问、WebDAV 文件、启停恢复与 export/import；CLI 无本机 Docker/解释器依赖。

## 12. Go Desktop 后端与浏览器复用

- [x] 12.1 将 Desktop browser 源码/资源提取到独立前端 workspace，并构建嵌入 Go CLI；关联 NATIVE-003、desktop-ui-language。验证：浏览器类型检查通过、资源 URL 不变、脱离源码/cwd 仍加载真实界面，初始页面视觉无无关改动。
- [x] 12.2 实现 desktop 命令监听/port/no-open/打开器/信号及启动资源验证；关联 CLI-DESKTOP-001。验证：无登录/Core 不可达仍开页面，端口占用/参数错误正确退出，打开器缺失显示手动地址，退出不 CancelRun/Stop Work。
- [x] 12.3 移植 bootstrap ticket、本机会话、Origin/Host/Fetch-Metadata/CSRF 与 Core identity 状态；关联 desktop-webui、work-access、NATIVE-003。验证：单次/过期票据、跨站/伪造 Host、token 隔离、切 Core、过期和离线登出浏览器测试通过。
- [x] 12.4 移植全部 Desktop control routes、按 Core/user 隔离的持久 Operation 记录和 Chat 事件流；关联 desktop-webui。验证：现有 UI 完成 Work 创建/动作、Service 管理、配置/Skills/packages/AGENTS Save/Apply、Session/Run，刷新/重登按原 ID 恢复而不重提。
- [x] 12.5 移植每 Service 本机 origin、授权交换与独立窗口入口；关联 browser-service-access。验证：预览和独立标签页免代理可用，跨 service/端口/会话授权不能复用，父域 cookie 污染和保留路径冲突被阻止。
- [x] 12.6 移植 Service Cookie/Origin/Location 与 Basic/Bearer/SSE/WS 适配和撤销收尾；关联 browser-service-access、work-access。验证：真实应用登录与长连接、CSP/XFO 回退保持、跨 service 跳转不自动授权、不重写正文或泄漏平台 token。
- [x] 12.7 移植 browser Files 到 Core DAV 的桥接、元数据映射与有界编辑/上传；关联 desktop-webui、work-file-access。验证：现有 Files UI 全部操作、1 MiB 文本编辑边界、覆盖确认、207 部分失败、未知结果刷新、与外部 WebDAV/Service 共享同一数据。
- [x] 12.8 移植离线 inspect、import/export/download transfer、临时空间与 session 身份约束；关联 desktop-webui、work-snapshots、NATIVE-005。验证：先 Stop 后 Export、先 Inspect 后 Import；Inspect 成功保留 integrityVerified=true、installationValidated=false，不宣称目标兼容，Core 仍独立检查；下载不发送 Range，取消/失败/过期/空间不足分别符合既有语义，保留期内下载中断后按原 snapshot ID 从头恢复、相同内容/hash 且不重新导出，换身份不可复用传输。
- [x] 12.9 更新 desktop-webui 使用文档并在桌面 Chrome/Edge 执行真实 Go 后端验收与 UI 语言 Review；关联 NATIVE-003/006、desktop-ui-language。验证：Work List/面板/Service/Files/Chat/Settings/导入导出及加载/空/错误/未知结果均有对应场景记录和必要截图。

## 13. Go Console 管理后端

- [x] 13.1 提取 Console browser workspace 并内嵌到 Go Console，实现 serve/TLS/listen/public-origin/Core loopback 校验；关联 NATIVE-003、serve-ui。验证：独立二进制任意 cwd 加载全部页面，错误 TLS/origin 配置明确失败，关闭 Console 不影响 Core。
- [x] 13.2 移植管理员 login/session/logout、CSRF、限频、安全 header 与服务端 token；关联 serve-ui、serve-ui-users。验证：普通用户拒绝、跨站/伪造 Host 拒绝、重启重新登录、浏览器看不到 bearer/operator secret。
- [x] 13.3 移植用户/runtime/default-work 管理及安全表单投影；关联 core-admin-api、serve-ui-users、serve-ui-configuration。验证：真实 Go Core 上新用户/禁用/重置、秘密不回显、默认配置不修改现有 Work，表单错误与未初始化状态正确。
- [x] 13.4 移植 Skills/Pi Packages 目录和 ZIP 上传、管理、Operation 查询；关联 serve-ui-skills、serve-ui-packages。验证：浏览器设备内容真实上传、四来源和来源互斥、默认引用保护、只查 Core scope Operation、观察中断后原 ID 可恢复。
- [x] 13.5 更新 serve-console 文档与进程/浏览器验收记录；关联 ui-language、serve-ui 及其子能力、NATIVE-003/006。验证：真实 HTTPS Go 后端覆盖全部管理路由与详情、1440/360 布局及 loading/empty/error/unknown 状态，不回归已定产品语言。

## 14. 移除旧平台、构建交付与最终验收

- [x] 14.1 按 design D10 删除已替换的 TS Core/CLI/Console 后端、TS Service MCP/package-helper 及 Python/TS 文件/快照 helper，保留完整 harness、迁出的 UI/内置资源；关联 NATIVE-007。验证：生产入口、import graph、Dockerfile 和发布包无旧后端路径、helper dist/shebang 或 fallback，历史 OpenSpec、开发数据与用户 Service 未被删除。
- [x] 14.2 删除仅旧平台使用的 packages，按 1.7 清单裁剪 contracts/pi-package 的平台专属模块/导出、npm workspace/lock/tsconfig；关联 NATIVE-004/007。验证：完整 TS harness/browser 全部 build/typecheck/test，Go MCP/package-helper 构建及契约测试通过；共享常量不引入 TS ZIP/source/upload/准备实现，Agent 历史和包加载依赖完整保留，通过依赖图证明无遗留平台运行库。
- [x] 14.3 更新所有 product/file/snapshot/package/browser 验收驱动与根测试入口只启动 Go 平台，保留真实 SDK 和确定性模型；关联 NATIVE-006/007。验证：干净树下统一测试入口可运行，测试不引用被删 SDK/Core/CLI，integration 仍精确按 installation 清理。
- [x] 14.4 完成 make build/test/test-integration/acceptance/release 和三个宿主程序/四种镜像内 Go 程序的发布流水；关联 NATIVE-001/005/007。验证：七种程序 Go 构建信息、纯 Go ELF、完整嵌入资源、别名、版本/镜像能力清单/SHA256SUMS 齐全，Agent production/acceptance 使用相同 Go 辅助程序，无运行时 npm 构建。
- [x] 14.5 汇总核对各阶段已更新 README/operations/testing/Desktop/Console/文件/快照/SDK 文档和当前架构说明；关联 NATIVE-007。验证：当前示例均指向 Go 入口，历史 TS 验收与架构草稿标明范围，说明清楚区分宿主/构建/镜像内依赖。
- [x] 14.6 在无 Node/npm/Python/Go/docker/openssl 可执行文件的受控宿主运行发布包；关联 NATIVE-001/002/003/005。验证：使用本机 Unix socket 的独立 Engine 完成初始化、Work、Service、两种 Web 入口、WebDAV 和快照；检查宿主平台子进程没有解释器或工具 fallback，镜像内完整 TS harness/Pi 包和 Go 辅助程序实际执行。
- [x] 14.7 核对并交付 1.7 的最终 TS 保留/消费者与 Go 程序清单，对源码、npm 生产依赖、Agent/helper 镜像入口/文件树和实际进程执行发布边界检查；关联 NATIVE-004/005/007。验证：仅登记的 harness/Pi 生态、浏览器和开发测试范围保留 TS，独立平台程序均为 Go；只含 TS helper 的镜像不能启动平台 fallback，用户 Service 和用户文件的语言不受此检查限制。
- [x] 14.8 在两个独立 Go 安装执行完整离线搬迁及异常恢复集；关联 NATIVE-005/006、portable-work、work-snapshots。验证：源下线且 package 来源不可达，目标静态导入 stopped→显式 start，计数/文件/历史/配置/包及固定镜像一致，新目标 Go MCP 经真实 TS SDK 操作恢复服务；不支持的镜像明确拒绝，无代码预执行或镜像替换，权限和失败场景通过。
- [x] 14.9 对 verification-matrix 的每个有效 Requirement/Scenario 关联最终 test/命令/必要人工记录并完成最终报告；关联 NATIVE-006/007。验证：无缺失/跳过却标成功的项，全部阶段 gate 和源码/镜像边界检查通过，工作树中已不存在旧平台生产实现，OpenSpec strict 校验通过。
- [x] 14.10 修复凭证目录安全 WARNING：在 CLI/Desktop 共用 Go credential store 的读取、保存、删除中核验当前用户归属、父目录专属权限、普通 0600 文件及路径链接；使用已核验目录句柄上的相对路径操作防止检查后替换，不 chmod 不安全的现有目录。关联 control-cli 的 Log in and persist credentials safely、design D9、NATIVE-001/003/006。验证：安全目录正常读写删除；0777 父目录、非当前用户归属、符号链接文件/父路径及路径替换竞争均拒绝或保持已核验对象边界，原凭证和外部目标不被修改，不发送不安全路径中的 token；覆盖真实 Go CLI 子进程和 Desktop 共用存储回归。将精确 test/命令/结果补入既有要求的证据索引，修复通过前不沿用旧完整通过结论。
- [x] 14.11 修复已失效会话 logout WARNING：仅对匹配凭证归属的 Core 成功撤销响应或可识别的 401 AUTHENTICATION_FAILED 清除本地凭证，清除成功才 exit 0、loggedOut=true；网络故障、取消、403、5xx、未知/畸形响应保留凭证，本地删除失败不伪报成功、不自动重放撤销。关联 control-cli 的 Show identity and perform server-side logout、design D9、NATIVE-001/003/006/007。验证：真实 Go Core 上先撤销、再 logout 的复现通过；覆盖过期/禁用、未知401/畸形响应、不可达、删除失败与切换 Core，原有效登出和 Desktop 本地即时登出行为保持。两项 WARNING 修复后执行对应回归及共享 CLI/Desktop 检查，更新验收证据和最终报告，重建受影响发布二进制/清单/校验和并验证发布包，完成 OpenSpec strict 及 verify 后再标记收尾通过。
- [x] 14.12 修复并发登录/登出时删除新凭证的 WARNING：共享 Go credential store 的保存与删除使用已核验私有父目录 FD 上的非阻塞跨进程 flock 排他锁；按 logout 开始时的规范化 Core URL/token，在同一次持锁操作中核验当前记录并条件删除，远端 HTTP 在锁外执行。当前凭证已不存在或已被新会话替换时安全完成且保留新记录；旧会话已确认结束时 CLI 可 exit 0、loggedOut=true，该结果仅指旧会话。锁忙、读取/解析/安全核验或删除失败返回安全错误，不无锁回退、不谎报成功、不自动重发撤销。CLI 与 Desktop 的会话失效及登出清理共用该机制，保持 Desktop 本地即时登出与远端撤销提示语义。关联 control-cli 的 Log in and persist credentials safely、Show identity and perform server-side logout、design D9、NATIVE-001/003/006/007。验证：真实 Go CLI 双进程中暂停旧 logout 响应，分别并发登录同一 Core 获取新 token、登录其他 Core，释放响应后新记录均保留；覆盖凭证已不存在、锁忙、比较与删除间的保存竞争，以及 Desktop 共用存储清理回归；原目录/文件身份、路径替换与失效响应分类回归继续通过。将精确 test/命令/结果补入既有要求及场景证据，更新验收报告，重建受影响发布二进制/清单/校验和并验证发布包，完成 OpenSpec strict 与 verify 后再标记收尾通过。
