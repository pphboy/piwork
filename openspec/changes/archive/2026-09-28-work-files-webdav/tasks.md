# Tasks

## 1. 文件契约与内部任务存储

- [x] 1.1 在 `packages/contracts` 定义 design D2/D4/D7 的能力DTO、方法/错误枚举、路径与限额常量及helper v1帧结构，不修改agent.proto或portable schema；验证：契约测试覆盖字段精确性、缺失/非法字段、1 MiB帧边界和完整错误表，contracts typecheck通过。（WF-001、WF-006、WF-007）
- [x] 1.2 在 `packages/core-store` 增量迁移中加入file jobs、attempts、temporaries及每Work文件门禁/epoch，记录中不存token，cleaned后24小时GC而未清理任务保留；验证：迁移测试从既有DB升级且Work/卷/context不变，重开DB保留非终态任务，portable metadata不包含新运行表。（WLIFE-FILES-002、WSNAP-FILES-001）
- [x] 1.3 实现同事务文件准入、每Work writer槽、Core/用户/Work限额、commit授权和snapshot/生命周期关闭互斥；验证：core-store竞争测试证明只允许一个writer、取消中名额不提前释放、stop或snapshot先取得门禁时旧任务不能取得新commit许可。（WF-006、WSTOR-FILES-002、WLIFE-FILES-001、WSNAP-FILES-001）

## 2. 受限文件 helper 与文件语义

- [x] 2.1 新增 `apps/file-helper` Python执行器及npm workspace测试入口，实现design D6二进制帧、REQUEST/DATA/END/ACK/CANCEL状态机、超时和安全错误；验证：Python单元测试覆盖截断、乱序、超大帧、错误epoch、EOF和取消，文件bytes不经JSON编码。（WF-003、WF-006、WF-007）
- [x] 2.2 实现root fd逐段访问、单次路径解码契约校验、stat/list/read与类型识别，拒绝链接穿越及不支持文件；验证：helper测试覆盖中文/空格/%/#、越界编码、FIFO非阻塞拒绝、硬链接读取、目录替换/symlink竞争及非法文件名，根外哨兵字节不变。（WF-002、WF-005）
- [x] 2.3 实现PUT/单文件COPY的精确暂存登记确认、fsync、提交许可、no-replace/替换、权限保留与清理；验证：中断/磁盘满/条件失败保持旧目标，提交后断线保留完整新文件，替换脚本保留执行位、硬链接另一目录项不变，身份不符暂存不被删除。（WF-003、WSTOR-FILES-001、WSTOR-FILES-002）
- [x] 2.4 实现MKCOL、递归COPY/DELETE、MOVE、Depth/Overwrite、树规模预检及逐项失败结果；验证：测试覆盖空目录、嵌套树、已存在目标、根保护、祖先/子树冲突、链接预检拒绝、10,000条目边界和权限变化后的部分失败。（WF-004、WF-005、WSTOR-FILES-002）
- [x] 2.5 实现HEAD/GET单Range和存在性/日期条件，以及有界读写、元数据和清理动作；验证：测试覆盖零长度、合法/不可满足Range、无ETag语义、mtime条件、帧背压和只删除已登记暂存，完整测试接入 `npm test` 的helper workspace。（WF-003、WF-006、WSTOR-FILES-002）

## 3. Docker 文件执行资源与部署

- [x] 3.1 新增 `Dockerfile.file-helper`、协议label、镜像构建命令及 `PIWORK_FILE_HELPER_IMAGE` 解析/兼容检查，按不可变ID执行；验证：构建镜像后检查label，配置缺失/错误/旧协议时仅文件能力不可用，Work和service功能不受影响。（WF-001、WF-007、CLI-FILES-002）
- [x] 3.2 在 `packages/runtime-docker` 新增file-helper create/attach/inspect/stop/remove和标签核验，按design D1资源限制与唯一workspace挂载执行；验证：真实Docker integration核对uid、只读rootfs、capabilities、network、mounts、read-only请求及无host端口/私有卷/socket，并证明stream abort后仍显式确认容器退出。（WF-007、WACC-FILES-002）
- [x] 3.3 更新 `docs/operations.md` 的文件镜像配置、缺失诊断、升级/禁用/回滚前收尾步骤及内部资源边界；验证：按文档在测试安装配置helper并读取available=true，移除配置后只文件能力不可用，文档命令与构建脚本一致。（WF-001、WF-007、WLIFE-FILES-002）

## 4. Core 文件任务协调与恢复

- [x] 4.1 新增 `apps/core/src/work-files` 的执行协调器，先持久化任务/attempt再创建Docker资源，双向流式转发并按协议处理temporary/commit许可和结果；验证：协调器测试覆盖成功、延迟启动、创建超时后迟到资源、错帧及客户端断开，任何分支均保留可核验归属。（WF-007、WSTOR-FILES-002、WLIFE-FILES-002）
- [x] 4.2 实现用户会话、owner、Work状态和运行实例核验，活动任务2秒复核，暂停提交权限与取消传输；验证：缺失/跨所有者/非所有者管理员均不可见，operator/agent凭据拒绝，登出/禁用上传在许可前取消，ready/degraded无service的Work可正常访问。（WF-001、WACC-FILES-001）
- [x] 4.3 实现运行中有界清理重试及Core启动恢复：先结束旧attempt，再用有记录的cleanup attempt清理精确暂存，未知身份保留；验证：故障注入覆盖登记前后、暂存确认前后、commit前后、移除失败、预算耗尽及stop/retry恢复，不重放用户写入、不误删用户文件。（WLIFE-FILES-002、WSTOR-FILES-002）
- [x] 4.4 实现独立文件任务配额、传输/确认期限、cleanup-pending阻塞和不含用户路径/正文的安全诊断，并在运维文档补充恢复说明；验证：可控时钟测试验证429/504、名额释放顺序与重试上限，其他Work及service名额未被误占，诊断指出可执行恢复方向。（WF-006、WACC-FILES-001、WLIFE-FILES-002）

## 5. Core WebDAV 协议入口

- [x] 5.1 在Core路由归一化/通用JSON处理前增加原始文件入口及file-access capability，接入独立Bearer鉴权和任务协调器；验证：HTTP测试覆盖root尾斜杠、非法raw路径、停止/恢复状态、helper缺失、旧agent镜像及大于JSON限制的body，不允许URL归一化绕过路径校验。（WF-001、WF-003、WF-005）
- [x] 5.2 添加精确版本 `saxes@6.0.0`，实现有界XML解析/转义、OPTIONS、PROPFIND属性分组与PROPPATCH拒绝；验证：HTTP协议测试覆盖空目录、自身条目、隐藏文件、未知属性404、Depth缺省/infinity、DTD/实体/深度/大小拒绝，不宣称DAV class兼容。（WF-002、WF-006）
- [x] 5.3 实现GET/HEAD/PUT、Range、存在性/日期条件、长度校验及XML错误映射；验证：HTTP测试覆盖chunked/Content-Length、16 MiB字节往返、304/412/416、415编码拒绝、Content-Range拒绝、流中断不追加XML和507存储故障。（WF-003、WF-006、WSTOR-FILES-002）
- [x] 5.4 实现MKCOL/COPY/MOVE/DELETE的Destination/Depth/Overwrite映射、同Work限制、207逐项失败、根保护及方法限制；验证：HTTP测试覆盖跨Work/外部Destination不发起网络连接、错误父目录/类型、目录覆盖与部分失败、LOCK/UNLOCK返回405。（WF-004、WF-005）
- [x] 5.5 新增 `docs/work-files.md` 的Core路径、方法矩阵、限额、条件/覆盖/硬链接行为及文件下载与数据库备份边界；验证：文档覆盖所有公开状态和不支持能力，示例请求由上述HTTP测试执行，未承诺系统挂载或全局文件锁。（WF-001至WF-007、WSTOR-FILES-001、WSTOR-FILES-002）

## 6. CLI 统一代理和用户使用说明

- [x] 6.1 在 `packages/client-sdk` 增加file capability和流式文件请求；扩展proxy origin-form本地文件分支，保留absolute-form service分支、PAC、WS/CONNECT；验证：SDK/CLI测试同时发送两类请求，service同名`/works/.../files/`路径不被抢占，CLI无需Docker、没有第二个监听器。（CLI-SERVICE-PROXY-001、CLI-FILES-001）
- [x] 6.2 加入进程级Basic凭据、一次启动展示、Host/Origin检查及两类认证头隔离；验证：错误Basic不联系Core，重启后旧密码失效，平台token不输出/不进应用，本地密码误投service被拒绝而应用自身Basic/Cookie保持，`--json`和启动失败语义不变。（CLI-OUTPUT-001、CLI-FILES-001、WACC-FILES-002）
- [x] 6.3 实现本地/Core前缀、Destination、Location与207中href的有界namespace映射；验证：中文/%/#/空格路径、COPY/MOVE、collection斜杠、root重定向与部分错误均可从客户端再次访问，Core内部前缀不泄漏，外部/跨Work目标被拒绝。（CLI-FILES-001、WF-004、WF-005）
- [x] 6.4 实现旧Core/版本不兼容/缺helper降级、能力重查、可信会话401退出及写请求不重放；验证：模拟旧Core404仍能访问service，文件错误或应用401不退出，真实会话撤销关闭两类流并exit 3，中途断线没有第二次PUT。（CLI-FILES-002、WACC-FILES-001、WACC-FILES-002）
- [x] 6.5 更新proxy help、README及 `docs/work-files.md` 的单proxy、多Work URL、临时凭据、rclone vendor=other配置和文件操作实例；验证：help无需凭据/网络，文档不出现`work files serve`或17891使用要求，真实客户端按原样示例访问本地入口。（CLI-FILES-001、CLI-FILES-002）

## 7. 生命周期与完整快照集成

- [x] 7.1 接入 `work-management/lifecycle.ts` 的stop/delete/apply切换及Core退出，原子关闭文件准入并将helper收尾纳入现有总预算；验证：生命周期测试覆盖上传与stop/commit竞争、只保存desired继续访问、apply前收尾、helper失败仍停止agent/service、45秒退出界限及没有假stopped。（WLIFE-FILES-001）
- [x] 7.2 接入Core启动恢复、Work自动恢复和显式stop/retry，先核验旧文件attempt/cleanup再开放新实例；验证：进程故障测试在临时写/commit/创建响应/移除窗口杀死Core，重启不重放操作，不遗留迟到写入，其他Work正常恢复。（WLIFE-FILES-002）
- [x] 7.3 扩展snapshot admission/preflight及恢复顺序，检查文件journal、实际helper和暂存，与文件准入/commit共享锁；验证：快照测试拒绝假stopped/活动writer/cleanup-pending，故障恢复先清理文件资源，不捕获helper镜像/运行表/临时密码，既有portable schema和元数据完整性测试通过。（WSNAP-FILES-001）
- [x] 7.4 更新 `docs/work-snapshot.md` 与文件文档的上传→停止→export/import→新ID访问流程和清理失败诊断；验证：文档明确停止是用户显式操作、导入保持stopped、WebDAV子集不缩小已有快照文件范围，示例命令符合现有CLI语法。（WSNAP-FILES-001、WSTOR-FILES-001）

## 8. 端到端交付验收

- [x] 8.1 新增 `scripts/work-files-acceptance.mjs`，使用真实Docker、显式文件/snapshot测试镜像和rclone通用模式，依赖缺失必须失败；验证：两自有Work和另一所有者环境下，客户端完成基本操作、中文/隐藏/空/大文件往返和SHA-256核验，agent与读写/只读service共享行为正确。（WF-001至WF-007、WACC-FILES-001、WSTOR-FILES-001）
- [x] 8.2 在端到端验收增加上传中断、同Work竞争、登出撤销、停止/重启、Core崩溃和真实卷父目录/symlink竞争，并记录安全的rclone版本及验证结果；验证：没有根外写入或半文件冒充成功，待清理阻止新写/导出，临时认证不进入命令行/日志，测试资源按归属清理。（WACC-FILES-001、WACC-FILES-002、WSTOR-FILES-002、WLIFE-FILES-001、WLIFE-FILES-002）
- [x] 8.3 完成真实上传→stop→export→import→start→按新ID下载校验，并在同一proxy持续验证service HTTP/SSE/WebSocket、应用Cookie/Authorization及PAC；验证：文件hash一致，源Work独立，`.work`无平台helper配置，既有service-access与snapshot验收通过。（WSNAP-FILES-001、CLI-SERVICE-PROXY-001、CLI-FILES-001、CLI-FILES-002）
- [x] 8.4 执行最终跨模块门禁 `npm run typecheck`、`npm run build`、`npm test`、`npm run test:integration` 和显式镜像配置的文件/既有快照验收；验证：命令全部成功，记录运行环境与结果，逐一对应本change所有场景，不能以模拟测试替代真实客户端或真实卷验收。（本change全部规格）

## 9. 验证发现问题的修复

- [x] 9.1 为 stop/delete/apply 和 Core 退出传递共享的绝对收尾截止时间，有界并行回收文件任务，不在关闭时先无界等待后台恢复；验证：同 Work 多个迟缓 helper 与 Docker 调用故障注入证明不逐任务累加超时，仍尝试停止 agent/service，超时保留 journal 与 cleanup-pending、不报告假 stopped，Core 在 45 秒总预算内非零退出。（WLIFE-FILES-001、WLIFE-FILES-002）
- [x] 9.2 修复提交后 helper 持续移除失败的文件响应映射，保留实际已提交内容和待清理记录；验证：HTTP 故障注入在 PUT 已提交、RESULT 已确认而移除失败时得到 409 FILE_CLEANUP_REQUIRED，不自动重放写入，后续文件访问和 export 在收尾前被阻止；清理恢复后重新查询可看到完整目标。（WF-006、WSTOR-FILES-002、WLIFE-FILES-002）
- [x] 9.3 修复 snapshot preflight 对实际 file-helper 的错误码区分；验证：未清理 journal 返回 409 WORK_BUSY，实际运行的迟到/孤儿 helper 返回 409 SNAPSHOT_REQUIRES_STOPPED，已退出残留 helper 仍阻止导出，Docker 状态不可确认返回 503 SNAPSHOT_RUNTIME_UNAVAILABLE，均不生成成功快照。（WSNAP-FILES-001）
- [x] 9.4 统一 CLI 文件与 service 分支的临时 Basic 凭据判定，按大小写不敏感的认证方案解析并以常量时间比较解码凭据；验证：`Basic`、`basic` 和混合大小写携带同一临时密码时均不转发给 service，合法应用 Basic/Cookie 继续可用，错误本地密码不联系 Core。（WACC-FILES-002）
- [x] 9.5 修复后重新运行 `openspec validate work-files-webdav`、typecheck、build、unit/integration 及显式镜像的文件和既有快照验收，逐一复核 9.1–9.4 的故障测试与结果；验证：全部门禁通过，Tasks 与实际实现状态一致。（本change全部规格）

## 10. 再次验证发现问题的修复

- [x] 10.1 修复已有文件的多段 Range 拒绝响应：返回 416 时包含 `Content-Range: bytes */<size>`；补 HTTP 测试。仅验证拒绝行为，不实现多段下载。（WF-003）
- [x] 10.2 修复目录及根目录的 PROPFIND `getlastmodified`：allprop 和显式请求均归入 200 propstat，未知属性仍归入 404；补协议测试。（WF-002）
- [x] 10.3 修复已存在 symlink 的 PROPPATCH：不跟随链接，返回 207 且每项属性为 403；验证链接目标及元数据不变，根目录保护和不存在目标的错误仍正确。（WF-002、WF-005）
- [x] 10.4 增加文件清理故障的生命周期与进程级验收：验证清理卡住时仍尝试停止 agent/service，不报告假 stopped；Core 收到退出信号后在 45 秒总预算内非零退出，保留 journal 与 cleanup-pending，后台任务不能阻止退出。（WLIFE-FILES-001、WLIFE-FILES-002）
- [x] 10.5 修复后重跑 OpenSpec 校验、相关协议与故障测试、typecheck、build、unit/integration，以及真实 Docker 文件和快照验收，记录结果。（本 change 全部规格）

验证记录（2026-09-28）：Node v25.6.0、Docker 26.1.5、rclone v1.60.1-DEV。`openspec validate work-files-webdav`、`npm run typecheck`、`npm run build`、`npm test`、`npm run test:integration` 均通过；9.1–9.4 的故障测试通过。文件验收使用 `PIWORK_FILE_HELPER_TEST_IMAGE=piwork-file-helper:local`、`PIWORK_SNAPSHOT_HELPER_TEST_IMAGE=piwork-snapshot-helper:pi-packages`、`PIWORK_RCLONE_BIN=/tmp/piwork-rclone/usr/bin/rclone` 运行 `npm run work-files:acceptance`，真实 Docker/rclone 和崩溃恢复均通过；既有快照验收使用同一快照镜像运行 `node scripts/work-snapshot-acceptance.mjs`，返回 `status: passed`。

10.1–10.5 验证记录（2026-09-28）：Node v25.6.0、Docker 26.1.5、rclone v1.60.1-DEV。`openspec validate work-files-webdav --strict`、`npm run typecheck`、`npm run build`、`npm test`、`npm run test:integration` 均通过；显式配置文件及快照镜像后再次运行根 `npm run test:integration` 通过，其中 runtime-docker 为 9 通过、1 个无关 package-helper 用例因未配置镜像跳过。新增测试覆盖多段 Range 的 416/Content-Range、目录属性分组、symlink PROPPATCH、SIGTERM 后非零退出及持久清理记录。`npm run work-files:acceptance` 使用真实 Docker/rclone 与配置镜像通过，包含实际卷 symlink 元数据不变和崩溃恢复；`node scripts/work-snapshot-acceptance.mjs` 返回 `status: passed`。
