# Tasks

## 1. 最终 V1 数据与公开契约

- [x] 1.1 在 contracts 增加 package name/source/selection/inventory/environment/view/Operation DTO 与严格验证，WorkConfig/default-work 增加必需 packages；更新新建默认和测试 fixture 为显式 []，以 scoped name、重复、空值、64 项边界及同版本异内容用例验证（PKG-001、PKG-008、WCFG-001、WCFG-005）。
- [x] 1.2 扩展 ToolPolicy 专用 package key schema，保留 builtin/MCP 现有键与 deny 优先规则；验证 scoped name、native tool 限制、未知键、512 字符边界及既有工具回归（PKGA-003、RUNTIME-TOOLS-001）。
- [x] 1.3 在 CoreStore 新鲜 schema 8 建立 catalog/artifact/upload/job 表及 Operation kind，添加旧非空存储的迁移前拒绝；验证 fresh init、同版本重启、旧 schema 返回 CORE_STORAGE_FORMAT_UNSUPPORTED 且 bytes 未被重写（PKG-006、WCFG-005）。
- [x] 1.4 为持久 catalog/lease/job 增加事务方法、唯一约束、epoch 和查询；用事务测试证明一个 scope 一个非终态包任务、原子默认追加、发布成功与 Operation 成功一致（PKG-004、PKG-006、PKG-007、PKG-009）。

## 2. 来源输入与制品基础模块

- [x] 2.1 新建 packages/pi-package 并接入 workspace build/typecheck，固定 ZIP 读写依赖；实现无代码执行的 npm/Git/local/ZIP source 解析、manifest name 和静态资源清单，测试四来源、非法 URL 凭证、缺 name/version、单根与嵌套 ZIP（PKG-001）。
- [x] 2.2 实现流式 ZIP 编解码、路径/类型/链接/执行位规范化及明确限额；测试遍历、重复路径、加密、循环/越界 symlink、合法 .bin、截断、超大条目及展开炸弹，证明不写出允许根（PKG-003）。
- [x] 2.3 实现完整制品树摘要、preparedEnvironment 和静态 inventory 验证；测试同 name/version 异 bytes 被区分、稳定 bytes 不随时间戳变化、依赖缺失或摘要错误明确失败（PKG-001、PKG-009）。
- [x] 2.4 实现 CLI 侧目录打包与 ZIP 文件输入共用流，上传前产生长度/摘要并安全清理临时文件；验证 source 来自客户端、保留有效执行位/链接且无 shell 拼接（PKG-001、PKG-003、CLI-PKG-001、CLI-PKG-002）。

## 3. 隔离准备与持久任务

- [x] 3.1 新建 apps/package-helper 和受信 init/capture 入口，扩展 Dockerfile.agentd production/acceptance、构建脚本与 runtime-docker helper 接口；通过 image build 与 Docker 检查证明镜像具有 Node/Pi/helper/Git 契约（PKG-002、RUNTIME-CONTEXT-002）。
- [x] 3.2 实现仅挂载 source-input 和临时 volume 的非 root prepare 容器、独立出站网络、资源/deadline 限制和结束后 capture；增加运行期 owned volume 用量监测，超过每 helper 4 GiB 时终止并确认退出，再以 PI_PACKAGE_LIMIT_EXCEEDED 失败和清理；隔离测试证明无法访问 Core secrets、Docker socket、其他 Work 或宿主 HOME（PKG-002、PKG-003）。
- [x] 3.3 实现 npm 确切版本下载、Git 固定 commit、local/ZIP 归一和 npm 运行依赖准备；远端来源树在依赖安装/复制前验证 1 GiB 与条目等限制，最终制品仍独立验证；用本地 registry/Git fixture 验证四来源、lockfile 行为、安装 lifecycle、来源超限、失败及不猜测额外 build（PKG-001、PKG-002、PKG-003）。
- [x] 3.4 实现 Core package worker 的 queued/source/prepare/validate/publish 阶段、最多两个执行容量和 scope 排他；测试第三作业排队、30 分钟终止、非零退出和安全错误映射，原状态不变（PKG-002、PKG-006、PKG-007）。
- [x] 3.5 将作业与 nullable work_id 的持久 Operation 关联，按请求语义摘要实现幂等 replay/conflict；测试响应丢失、重复上传不同 uploadId、同键失败重放与新键重试（PKG-006）。
- [x] 3.6 实现 Core 重启后的 helper 归属核验、capture/publish 收尾、不可证明时 failed 和清理；在准备中、rename 后、DB 提交后注入重启，验证不重执行脚本、不重复发布（PKG-006、PKG-009）。
- [x] 3.7 为 helper 已知命令失败增加来源获取与依赖安装两个稳定错误码，经 Docker runtime 白名单和 Core worker 安全映射到 Core/Work Operation；用本地 npm registry、Git 和失败 lifecycle fixture 验证两类失败、原始输出/路径/凭据不泄露、超限与截止时间错误优先、旧制品及 desired/active 不变、资源确认退出后清理（PKG-002、PKG-006）。
- [x] 3.8 用同一准备镜像比较固定 `pi-web-access@0.31.0` 在单独 helper 与真实 Core 安装链的行为，定位真实链中 prepare 容器 exit 1 的具体根因并修复；只增加能证明该根因的定向回归，不以更换包版本、单独 helper 成功或错误码分类替代真实 Core 安装成功（PKG-002）。
- [x] 3.9 在 Core 与 Work package Operation 查询的现有授权边界内投影持久 job.phase 为可选 `packagePhase`，扩展公共 Operation schema 且非 package 响应不增加字段；用定向服务测试覆盖两个 scope、阶段变化、重启后读取、越权不可见及 helper/source/原始日志不泄露（PKG-006）。

## 4. Core 包库与默认选择

- [x] 4.1 实现 Core install/update/enable/disable/remove 服务，重复 install/改名 update/未知 name 使用规定错误；验证 update 保留 enabled/default，失败不改变旧 head（PKG-004、PKG-005）。
- [x] 4.2 实现原子 install --default、默认引用保护和最多 64 项校验；测试默认追加不丢其他项、默认包不能直接 disable/remove、移出后可操作（PKG-004、SERVE-CTRL-001）。
- [x] 4.3 扩展 default-work PUT 严格 patch 分支及服务端字段合并；测试 package-only 更新保留 Skills/模型/AGENTS，两个字段并发不因 CLI 旧快照互相覆盖（PKG-007、SERVE-CTRL-001）。
- [x] 4.4 加入 enabled-only 用户 catalog 与完整 operator catalog DTO；验证排序、空库、disabled 可见性、安全 provenance，以及无运行配置时 list/show/health 仍可用（PKG-008、SERVE-START-001）。

## 5. Work 自有 context 与变更顺序

- [x] 5.1 扩展 WorkContextStore 的 packages/nameKey 树、packageBindings、packageContractVersion 和 context identity，完成 staging/rename/只读封存；测试完整依赖复制、disabled 保留和树失败原子性（WCFG-001、WCFG-003、PKG-009）。
- [x] 5.2 扩展 Work create 的 packages 合并和 catalog heads 原子捕获/lease；验证 defaults、显式列表、显式空集合及 Core 并发 update/remove 时每个 Work 仍捕获一致自有副本（WCFG-001、PKG-004）。
- [x] 5.3 实现 Work install/update 与 --from-core，准备成功后在最新 desired 上 CAS 合并；首次接受事务内验证当前 Core enabled head 与目标环境兼容、租用并记录制品，幂等 replay 保留原捕获；测试异步镜像准备期间 Core 更新/禁用/移除或换成不兼容 head、来源切换、同名约束、disabled 更新、Core 副本独立及并发无关模型编辑保留（PKG-005、PKG-007、WCFG-003）。
- [x] 5.4 实现 Work enable/disable/remove 和 generic config set 的已安装名选择规则；验证只改 desired、不隐式刷新 Core、重复开关 no-op、remove 后 active/history 保留且 list union 可见（PKG-005、PKG-008、WCFG-001）。
- [x] 5.5 接入 start/apply、stop/delete 与 snapshot 栅栏，持久化 supersession；测试准备中 start/apply/export 拒绝、stop/delete 后迟到 worker 不能提交，export 期间所有包写入均被拦截（PKG-007、WLIFE-SNAPSHOT-001）。
- [x] 5.6 实现 catalog/context/history/job/snapshot/upload 的引用 GC 与 lease 清理；测试 Core remove 不损坏 Work、旧 active/history 不被回收、未确认退出 helper 的资源不提前释放（PKG-009、WLIFE-SNAPSHOT-001）。

## 6. HTTP 与 client-sdk

- [x] 6.1 新增 operator/user catalog、Work package routes 及 Core-only Operation 查询，使用 design 接口表和现有错误 envelope；测试 operator/user/owner/跨 owner/管理员内容边界、scoped name 路径只解码一次（PKG-004、PKG-008、SERVE-CTRL-001）。
- [x] 6.2 实现两个 scope 的 binary ZIP upload、headers、流控、期限和 lease，隔离 whole-Work upload namespace；测试鉴权在读 body 前、跨 scope upload 拒绝、413/415、断流清理与过期（PKG-003、WSNAP-005）。
- [x] 6.3 在 client-sdk 增加 package/source/upload/operation/default patch 方法；请求测试验证 JSON body 幂等键、URL 编码、二进制 headers 和 deadline 传播，禁止上传绝对宿主路径字段（CLI-PKG-001、CLI-PKG-002、PKG-003）。
- [x] 6.4 实现 package list/show 的 desired/active/runtime 组合视图与安全诊断，验证同版本异 bytes pending、删除待 apply、stopped/stale loaded=null 及无 secret/digest/revision 泄露（PKG-008、PKGA-005）。

## 7. SDK 实际激活与 readiness

- [x] 7.1 将 isolated resource loader 改为每次预检/SDK session 独立 factory，关闭自动发现并显式加载 enabled package roots，保留 AGENTS/独立 Skills 行为；真实 SDK 测试证明 HOME/project/其他 Work/pending 资源均未加载（PKGA-001、SKILL-001、RUNTIME-PI-001）。
- [x] 7.2 实现四类资源 inventory 与加载 diagnostics、静态/动态路径约束、跨包及独立 Skill 冲突检查；测试坏 extension、缺依赖、外链、重复 Skill/prompt/theme/command/tool，以及 disabled 包不执行（PKGA-001、PKGA-003、SKILL-001）。
- [x] 7.3 实现 package canonical tool key 到 SDK native tool 的映射与最终 allowlist；真实工具测试证明 allowed/denied、builtin/MCP 冲突和禁止覆盖注册表，不把 extension 当工具沙箱（PKGA-003、RUNTIME-TOOLS-001）。
- [x] 7.4 在 PiSdkRunExecutor 以 JSON 模式绑定 headless session_start/resources_discover/Run/tool 事件，bind 前注册 SDK runner 错误监听；初始化 hook 失败须在 prompt 前拒绝，运行期 hook 失败须使 Run 安全失败，reason=quit 的 shutdown/finally 和 listener/session 清理仍执行；测试成功、abort、两阶段 handler 错误、shutdown 错误不改终态、两 Session 隔离和旧 context Session 拒绝（PKGA-004、RUNTIME-PI-001）。
- [x] 7.5 扩展 agent proto 并重新生成代码，增加必需 package contract、loadedPackages/resources/diagnostics，更新 agentd 与 Core verifier；测试空包契约、缺字段、额外/缺少/重复包、同版本异 digest、旧代次及重启 adoption（PKGA-005、RUNTIME-CONTEXT-001）。
- [x] 7.6 把包错误接入既有 apply worker 和 rollback，保留 Operation 捕获 candidate；Docker 集成验证 install 不激活、普通重启用旧 active、显式 apply、生效后 later desired 仍 pending、active Run 忙和 stopped 验证（PKGA-002、WCFG-002）。
- [x] 7.7 验证 package bytes 以 context 数据挂载且不进入 agent 镜像：用同一固定 image 完成 install/update/enable/disable/remove/apply/restart，用不同版本工具结果证明绑定正确（RUNTIME-MATERIALIZE-001、RUNTIME-CONTEXT-002、PKGA-001）。

## 8. 两个 CLI 的完整操作面

- [x] 8.1 在 piwork-serve 增加 packages list/show/install/update/enable/disable/remove 与 Core operation show，连接上传及 default patch；命令测试覆盖四来源、--default 原子语义、缺 --source、默认引用错误和 operator 授权（CLI-PKG-001、SERVE-CTRL-001）。
- [x] 8.2 在 piwork-cli 增加公开 catalog 与 work packages 全命令，实现两种 --from-core 语法和 source 互斥；命令测试覆盖位置顺序、scoped name、四来源和仅 desired 提交（CLI-PKG-002）。
- [x] 8.3 扩展 create/config set/default-work set 的 --package/--no-packages 与配置文件优先级；测试重复/矛盾/空值在 I/O 前失败、显式 []、省略保持和现有 Skill flags 回归（CLI-WORK-001、CLI-PKG-001、WCFG-001）。
- [x] 8.4 两 CLI 复用 package Operation 的 acceptance/--wait/JSON/exit code 逻辑；假时钟及请求测试证明超过 120 秒仍观察原任务、250 ms 串行、单次请求超时不重提、不取消，stdout 对 acceptance、终态及观察失败的 waiting 各只输出一条且保留原 ID、help 无 I/O（CLI-PKG-003）。
- [x] 8.5 将两个 CLI 的 package --wait 改为暂时观察超时/断线/502/503/504 后按 250 ms 至 5 秒退避继续 GET 同一 Operation，恢复后正常轮询；401/403/404 保留 ID 后 exit 5，Ctrl+C 输出 waiting/恢复命令并 exit 130，仅停止本地等待；用假时钟和请求计数定向测试超过两分钟、恢复、终态失败、用户中断、JSON stdout 单值及绝不重提安装（CLI-PKG-003）。
- [x] 8.6 两 CLI 的 package install/update 增加仅与 --wait 同用的 --verbose；在 I/O 前拒绝无 --wait 的用法。用安全进度回调把原 ID、packagePhase 变化、已等待时间、每 30 秒心跳、暂时观察故障/恢复及终态安全 stage/code 写 stderr，保持 --json stdout 单值；定向测试 Core/Work、敏感字段缺席、普通轮询不刷屏及不改变重试/退出码，并更新对应 help（CLI-PKG-003、PKG-006）。
- [x] 8.7 从两个 CLI 的 package install/update 解析、help 和示例中移除 --idempotency-key，始终由 CLI 为每次提交生成内部 UUID；带旧 flag 在鉴权、来源文件和网络 I/O 前 exit 2。用两个 CLI 的定向测试验证自动键、旧 flag 早期拒绝和等待不重复提交；保留 HTTP/client-sdk 的必需 idempotencyKey 与其他非 package CLI 命令的既有参数（CLI-PKG-003、PKG-006）。

## 9. `.work` 完整包闭包与静态恢复

- [x] 9.1 直接扩展 portable-work 最终 formatVersion=1 schema，增加 piPackageArtifacts、piPackageContract、每 context packages/bindings；更新所有当前 V1 fixture，验证缺字段旧 V1 明确拒绝而无 backfill/v2 分支（PWORK-001、WCFG-005）。
- [x] 9.2 扩展 work-package codec 的包制品 graph/hash/tree/环境验证、blob 去重和逻辑恢复量计数；测试同名多版本、同版本异内容、disabled 绑定、缺 blob、重复 name、外链和共享 blob 超限（PWORK-001、PWORK-003、WSNAP-002）。
- [x] 9.3 扩展 snapshot capture 遍历全部 retained contexts 的包及依赖，纳入冷快照 gate；验证 active/desired/history/disabled/removed-pending 全部捕获，缺失任一制品使整体 export failed（PWORK-002、WSNAP-001、WLIFE-SNAPSHOT-001）。
- [x] 9.4 扩展受信 snapshot helper restore-context 与 imported context 构造，从 `.work` 字节恢复完整 owned packages；测试不调用 npm/Git/SDK/extension，不查目标 catalog/defaults，不执行 source image entrypoint（PWORK-003、WSNAP-003）。
- [x] 9.5 把包恢复、引用图重映射与 lease 纳入现有 import journal/原子发布/失败清理；验证新 Work stopped、active=null/pending 保留、目标身份独立、重启前后无半成品和 Operation 不重放（PWORK-004、WCFG-SNAPSHOT-001、WSNAP-003、WSNAP-004）。
- [x] 9.6 扩展离线 inspect 与 CLI safe summary 的 Pi 包数量/name/version，保持 integrityVerified 与 installationValidated 区别；测试无登录/无网络/无执行，单数 work package 与复数 work packages 不冲突（CLI-SNAPSHOT-001、WSNAP-002）。
- [x] 9.7 验证导入后无关配置编辑、start/apply/re-export 使用自有 package，并在源 `.work`/upload 过期后仍成立；测试后续 --from-core 仅显式采用接收 Core（WCFG-SNAPSHOT-001、PWORK-002、PKG-005、WSNAP-005）。

## 10. 验收矩阵、文档与交付验证

- [x] 10.1 增加两个版本的可复用示例 package，含真实 tool/events、Skill、prompt、theme、运行依赖；使本地 registry/Git/目录/ZIP fixture 生成同一合法 manifest name 与行为，并保证 registry/Git 从 prepare helper 的独立 Docker 网络可达，无需公共 tag 或真实模型 secret（PKG-001、PKGA-001、PKGA-004）。
- [x] 10.2 扩展现有 integration/acceptance 驱动四来源 × Core/Work 的八次真实 worker 安装，验证实际 version/sourceKind、默认继承、独立副本、显式 update、enabled 状态和 Core 重启；共用固定 image/fixture 与运行链验证真实 SDK 工具和事件，不要求八条重复全生命周期测试；保留可重复运行命令和稳定资源清理（PKG-001 至 PKG-008、PKGA-001 至 PKGA-005）。
- [x] 10.3 增加跨 Core stop/export/import/start/apply/re-export 验收：导出 Work 的 retained contexts 实际引用 npm/Git/local/ZIP 四种来源制品，且至少一个保留的 SDK Session 已产生真实 package tool call/history；关闭原 registry/Git、删除 local/ZIP 并清除来源 Core catalog，在目标放同名不同包。导入后启动旧 active，必须用预期的映射后 context identity 继续执行同一个历史 Session 并成功完成 Run；apply pending desired 后 re-export/import 到第三 Core，再次继续该历史 Session 并成功完成 Run。两次均须验证四种制品、active/desired/history/disabled/依赖/持久运行文件及 target catalog 不变。若历史 Session continuation 失败，必须先用不包含 prompt、tool result、package 内容或敏感路径的阶段诊断区分 resource loader、Session 加载、AgentSession/extension bind、prompt 与 shutdown 阶段并修复恢复路径；不得改写/删除 SDK 历史或放宽成功断言（PWORK-001 至 PWORK-004、WSNAP-001 至 WSNAP-005、WCFG-SNAPSHOT-001）。
- [x] 10.4 增加组合故障验收：ZIP 越界/超限、npm/Git 来源树超过 1 GiB、lifecycle script 写满 4 GiB 临时工作卷、脚本失败、hook 错误、加载冲突、Core 崩溃、stop/delete 晚到、export 竞争及 apply rollback；验证及时终止、安全诊断、无半包/状态变更、确认退出后资源清理、无重复执行和无误回收（PKG-002、PKG-003、PKG-006、PKG-007、PKG-009、PKGA-002 至 PKGA-004、WLIFE-SNAPSHOT-001）。
- [x] 10.5 更新两个 CLI 帮助、用户示例、架构说明及 docs/work-package-format.md，逐条记录四来源、install 与 apply 分界、默认仅影响新 Work、完整搬迁与最终 V1 硬修改；按文档命令运行 fixture 演练验证闭环（CLI-PKG-001 至 CLI-PKG-003、CLI-SNAPSHOT-001、WCFG-005、PWORK-001）。
- [x] 10.6 在以上缺口实现并实测后，必须先取得 10.3 两次跨 Core 历史 Session continuation 的成功证据，再运行 npm run typecheck、npm run build、npm test、npm run test:integration、npm run agent:image:acceptance 和 npm run acceptance；运行 openspec validate manage-pi-packages --strict，按实际证据更新 verification.md 的 requirement/scenario 映射。只有完整 stop/export/import/start/apply/re-export 链和各验证门禁均有实际成功证据，且确认仅已完成项勾选、无未实现契约时，才可勾选本项（全部需求）。
- [x] 10.7 在 3.7、3.8、3.9、8.5、8.6、8.7 完成后运行受影响 helper、Docker runtime、Core/Work Operation 与两 CLI 的定向回归；用固定 `pi-web-access@0.31.0`、同一准备镜像及暂存 Core 真正执行 `packages install npm:pi-web-access@0.31.0 --default --wait --verbose`，只有 Operation succeeded 且 catalog 显示正确 name/version、enabled=true、isDefault=true 才通过，失败分类不能代替成功。再运行 `npm run typecheck`、`npm run build`、相关定向测试与 `openspec validate manage-pi-packages --strict`；仅在修复影响共享行为或定向测试发现回归时扩展测试。按新增 PKG-002、PKG-006、CLI-PKG-003 场景同步 verification.md，记录实际命令和成功证据，不重跑此前已通过的完整 Docker 搬迁矩阵（PKG-002、PKG-006、CLI-PKG-003）。
