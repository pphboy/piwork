# Tasks

实施位置：master 基线工作树 `/home/p/Projects/piwork__worktrees/rebase-piwork-brain-onto-go-core`。功能来源 `1608098` 只提供可复用保留层；所有平台入口使用本工作树的 Go 实现。以下任务均须落地其对应测试与当前文档，不能以旧 TS 平台测试结果替代。验收范围以 design 的八条回路为准。

## 1. 当前双端契约与历史基础

- [x] 1.1 将功能来源中模型/来源/反馈/候选的当前 contracts 迁入保留包，扩展根 `proto/agent.proto` 与 `proto/work-services.proto` 的模型、请求、证据及五个私有 RPC，更新 Go schemas/DTO 与生成代码；剔除 LegacyBrainCandidateSubmissionSchema，保留字段 presence 和严格校验。验证：生成后双方编译通过，契约测试区分省略/null/string，拒绝未知字段、缺 verificationTarget、非法工具/输入/checks；当前协议说明与生成源一致。（CONV-RUN-001、CONV-MODEL-001、CONV-SOURCE-001、PKG-BRAIN-001、CLI-BRAIN-001）
- [x] 1.2 将 WorkStore 与 Go workhistory 的 schema.sql/schema-objects 同步到完整 schema 4（十三表及模型/来源/经验字段），只支持空库初始化与同版恢复；移植当前请求/证据/经验存储和有界分页，删除 schema 3 升级及旧候选补齐路径。验证：新库/同版重启、唯一键、外键/图引用、跨来源分页与同时间戳游标测试通过；不支持格式原数据不变；更新当前历史格式说明。（WCFG-005、WAF-003、WAF-004、WAF-007、WAF-009、BRN-003）

## 2. Go 模型解析与 Run 受理

- [x] 2.1 在 Go 模型 catalog/私有 WorkServices RPC 实现 ListRunModels 与 ResolveRunModel，并迁入 Agent 的实际 SDK 模型筛选/执行解析；保留当前安装范围、证书和代次授权，执行描述变化禁止回退。验证：enabled、secret 可用、SDK 不支持、空集合、读取故障、失效/描述改变、跨 Work 和旧代次测试；真实 SDK 的确定性两个模型能分辨实际 provider/model，输出与持久数据不泄漏 secret；更新模型接口文档。（CONV-MODEL-001、RUNTIME-CONTEXT-001、凭据隔离 requirement）
- [x] 2.2 扩展 Go agentclient、Core HTTP 与 Agent Run/Session 受理，落地 models、Session model PATCH、可选 Run selector 和不可变 actualModel/source；同键重放先返回原记录，偏好独立于配置。验证：同 Session 下一次换模型、执行中保存偏好、默认/null/省略、同键异模型冲突、原模型后来失效仍返回原 Run、自动 Run 取受理时 active 默认、busy/草稿语义与新 Session 默认；更新现有 Run/API 说明。（CONV-RUN-001、CONV-MODEL-001、CONV-SOURCE-001、WCFG-BRAIN-001）

## 3. Go Service 身份与直接交互

- [x] 3.1 在 Go runtime/dockerengine/internaltls 实现当前实例的私有绑定、Service 专属身份与 CA/反馈入口，接入 GetServiceInteractionBindings；随 Start/Restart/Stop/Remove 更换或撤销，Agent-only Apply 保持运行 Service 可访问。验证：真实容器的正反向连接、旧实例/跨 Work/跨 Service 拒绝、定义/端口/容器归属、Service Restart 与 Agent Apply 后原请求可查、同一实体旧 outbox 使用新身份去重投递，public/snapshot 不含凭据；更新运行身份说明。（RUNTIME-FEEDBACK-001、WAF-001、WAF-004）
- [x] 3.2 移植 Agent ServiceInteractionClient 与 TLS 收件/回执接口，依据当前 Go 绑定解析 capabilities/query/action/job，持久收件后响应；实现同来源去重、明确业务原因、outbox 来源核验、稳定 Action/预期状态版本与请求隔离。验证：普通事件不触发模型、同键异内容冲突、容量/64 KiB 边界、越界 URL/输入拒绝、响应丢失只查询原 Action、用户并发状态冲突、自己的回执/取消以及不可达 outbox 保留；更新语言无关的 Service 接入说明。（WAF-001、WAF-002、WAF-003、WAF-004、BRN-004、DUL-006） W5 补正：关联目标的 Job 回执先核对原 Action/Job，错误归属不写证据；普通无关联只读观察保持可用，HTTP 正反向回归通过。

## 4. Go 默认 brain 与真实资源加载

- [x] 4.1 将 piwork-brain 资源归属移入 `internal/coreassets/piwork-brain/`，通过原生 package prepare 与 CoreStore 一次性 metadata 原子播种普通 catalog/default 包，移除默认独立 deploy-work-service 播种；建立 Work 编辑副本且不覆盖后续编辑。验证：全新默认、显式 packages=[]/skills=[]、准备失败/事务中断重试、管理员定制/清空/禁用后重启、普通 Work 重启仍加载原 captured active；资源路径和当前初始化文档无 TS Core 依赖。（BRN-001、ADEP-001、WCFG-BRAIN-001、GO-DELIVERY-002）
- [x] 4.2 迁入薄层 extension、默认认知和四类 brain tools，接入 Agent 受限宿主 socket 与每次 SDK 上下文，更新 Go image/handshake 验证 history=4、runModel=1、workFeedback=1；保留 master package-helper contract=2、SAN/代次与真实 loaded 校验。验证：真实 SDK 加载、默认认知生效、资源缺失/身份错配/同版本异内容/空 package 握手/工具 deny/脑包 disable，以及编辑不热加载；更新脑包维护和部署 Skill 的当前工作流说明。（BRN-001、BRN-002、ADEP-002、RUNTIME-CONTEXT-001、WCFG-005）

## 5. 固定执行循环、等待与生命周期

- [x] 5.1 迁入 CoreFlow/CoreLoop 并接入 Go 当前生命周期门禁、兼容自动 Session、单活跃 Run、一秒手动让位、四次/三十分钟预算与真实来源；只调度合法 live agent.requested。验证：手动忙碌、等待时可 Chat、自动默认模型、context 改变新自动 Session、Run 与目标状态分离、Chat 来源的等待目标续接不伪造 Service、普通事实/结果不递归发起目标、预算耗尽；更新请求状态与运行说明。（WAF-005、WAF-007、CONV-SOURCE-001、BRN-002）
- [x] 5.2 迁入异步等待、五秒有界核对和返回后事务重读，落实请求/Job/Apply 的适用期限、等值到期、Cancel run/Cancel request、稳定新键 Retry 和原效果只读核对。本次复核补正：Retry 的 Action/Job/capabilities/验证 Query 返回后复查 live、生命周期及新请求期限，等待事务使用当前时刻；新增期限前/相等/之后、取消/终态/历史与原效果只读回归。验证：4999/5000ms 轮询边界、期限前/等值/之后、查询返回跨期限、取消/终态先提交、第一次进入七天 Apply 等待及不续期、合法续接后旧 waitRef 不误伤、新重试不复用旧期限或重复 mutation；更新取消/重试/期限说明。（WAF-006、WAF-007、BRN-005、PKG-BRAIN-002） W5 补正：Retry 与恢复一样只读核对原 Job 归属；Action 省略 Job 时保留已登记 ID，替换或错误归属不受理新 Run、不重复 mutation，正常完成对照通过。
- [x] 5.3 对接 Go Stop/Delete/Apply fence 与候选初始化禁止自动执行，落实正式 ready 后恢复核对与 interrupted Run 保留。验证：原 Action 接受但无 waitRef 的仍执行/已终态/不可证明，候选原键查询、停机跨期限、查询期间取消、Stop 与受理竞争、Apply 失败恢复 prior active；无重复 prompt/Action/prepare，不增加只读核对的自动次数；更新同版故障恢复说明。（WAF-008、WAF-006、RUNTIME-FEEDBACK-001）

## 6. 证据、经验与实际采用

- [x] 6.1 接入 evidence 与经验 staged/commit/head，验证成功后事务提交有效版本，每次模型调用前固定 adoptedExperienceVersion；保留失败经验和原有效版本。验证：已有兼容 Session 和新 Session 的下一次执行实际采用、当前 Run 快照不变、无证据/失败验证不能提交、容量一百条/4 KiB/损坏读取明确失败，权限与 Work 配置不变；更新经验范围与采用说明。（BRN-003、BRN-004、WAF-009、WCFG-BRAIN-001） W5 补正：完成事务核对 Job proof details 的 Job/Action 双重关联，拒绝直接 finish 及选中错误证明，目标和有效经验保持；正确证明仍原子提交。
- [x] 6.2 落地与原请求/候选/Run 关联的固定 SDK 行为验收，检查匹配工具/input 和必要 checks，完成条件结合真实 active/loaded；同内容候选也验证。验证：真实 SDK 新旧行为可辨、无关工具/Skill/status 不通过、失败/缺 checks/其他请求或 Run/伪造关联拒绝、加载通过但行为失败不 completed/不伪称回退；更新脑包能力验证说明。（BRN-005、PKG-BRAIN-002、WAF-007）

## 7. Go 原生候选捕获、发布与状态

- [x] 7.1 扩展原生 package-helper contract 2 的受限 source-capture，固定只读 Work 脑包路径，完整安全捕获与摘要核对后沿用既有隔离准备。验证：链接/路径/manifest/大小限制、捕获前源变化冲突、捕获后源变化不改变候选、依赖只读取固定源、资源/时限及 spool 恢复；更新 helper 当前契约与候选来源说明。（PKG-BRAIN-001、GO-DELIVERY-001）
- [x] 7.2 在 Go packageprepare/CoreStore 接入当前候选的稳定 Work Agent actor、descriptor 幂等与两个私有候选 RPC；从最新 desired 原子合并包，核对同名 active/desired 基线与生命周期，持久原 Operation。验证：进程替换后同键重放、不重新捕获、同键异目标/checks 冲突、用户无关编辑保留、同名替换/移除/禁用及 Stop/Delete 迟到结果不覆盖、正常客户端 local/ZIP 协议回归；更新候选发布/API 说明。（PKG-BRAIN-001、BRN-005）
- [x] 7.3 更新 Go 安全包/Operation 视图与 Agent CandidateController 的 prepare/status/等待采用路径，保持来源、desired/active/loaded/行为验证各自状态，显式 Apply 才改变 active。本次复核补正：按同 Work、候选发布后受理及相同启用脑包制品关联原 Apply，处理无关 AGENTS/Skills 保存后的加载失败；公开安全受理基线、固定目标/输入摘要/checks 及原 Apply，补测旧/其他内容 Apply 不认领。验证：候选准备成功未 Apply、同内容无需等待、用户取代候选、加载失败真实回退、加载成功后新兼容 Session 验证、取消不删 desired、超期不复活；更新 Pi Packages 状态及 Apply 说明。（PKG-BRAIN-002、BRN-005、DWUI-007）

## 8. Go 全闭包快照与独立环境分享

- [x] 8.1 扩展 Go workhistory 静态校验/rebuild 与 snapshothelper 到十三表、结构化反馈/候选/SDK 证明图；仅映射声明的 Work/context 引用，保留 SDK/用户 payload 和控制 Operation 归档规则。验证：全部列/外键/空集合、悬空/跨 Work/额外表或 trigger、非法状态/无依据完成/缺验收项/错工具输入证明拒绝；同版与空历史可恢复、未终态 Run 拒绝、opaque 操作与字面 ID 不递归改写；将旧 TS schema oracle 改为当前 Go 契约断言，更新格式说明。（CONV-SNAPSHOT-001、PWORK-BRAIN-001、WCFG-005） W5 补正：Go 静态历史验证同样拒绝错误 Job/Action 或缺 Action 的完成证明，接受正常关联且验证前后源文件字节不变。
- [x] 8.2 更新 `.work` 当前契约、Go workpackage/export/import，携带编辑源、所有 retained contexts/制品、业务 DB/outbox、反馈/经验/安全模型描述；导入 historical、重新生成身份与唯一目标模型匹配。验证：离线固定镜像/全部包来源、pending desired 与禁用 Service、历史不自动执行、源 outbox 不重开 Job、新反馈有效、不可用偏好需明确选择、两份导入后各自新候选 SDK 证明；更新完整分享及平台/ABI 条件说明。（PWORK-003、PWORK-BRAIN-001、CONV-SNAPSHOT-001、BRN-006）

## 9. Go CLI 与 Desktop 本地 API

- [x] 9.1 更新 Go client/CLI 的 Run 安全投影以及 Desktop 本地模型/偏好/请求/证据接口，保持既有 chat 参数、身份与 CSRF 验证、原 ID 查询和 transient mutation 门禁。验证：Go HTTP/RPC 与本地投影一致、无内部信息、limit/cursor 严格、认证/授权/已受理但刷新失败、stopped Work 拒绝、并发凭证与跨安装/用户旧响应隔离；更新当前 Go 用户入口文档。（CLI-BRAIN-001、CONV-MODEL-001、CONV-SOURCE-001、DWUI-FEEDBACK-001）

## 10. master 产品 UI 接入

- [x] 10.1 在 master 现有 Chat 输入区接入模型加载/空态/选择/保存/失败、下一次手动发送及每 Run 实际模型/来源；在 Services/Files/Chat 同级和单一输入上下文内保留状态。验证：偏好确认前不发送、保存响应丢失按原 Session 查实际值且不重发、失败草稿/已确认值保持、当前 Run 不换模型、busy 不排队、切换 Work/Session 晚返回隔离；现有 auth/CSRF/对象锁/本地三秒反馈/iframe 不刷新回归通过，更新 UI 能力映射和模型操作说明。（DWUI-004、DWUI-MODEL-001、DUL-002、DUL-012）
- [x] 10.2 在 Chat/对象详情接入按 Service 分页的请求/证据、等待/取消/原键 Retry/历史限制；在现有 Pi Packages 接入候选来源、Saved/Not applied/Loaded/行为结果与独立 Apply，Files 显示可编辑源。本次复核补正：现有 Package Details 分项展示安全受理基线、固定能力/输入摘要/必要 checks、准备结果和原 Apply ID/状态及请求/Operation 入口；浏览器断言字段真实、未知/失败分离和 iframe 不重载。验证：自动等待不占 Run、Cancel run 终止关联续接、原 ID 恢复、历史禁 Retry、外部 Service 观测边界、关闭不取消、Apply 期间新编辑保留，以及 master WorkcontrolVersion/Operation/导入导出/凭证并发全流程；更新 English 产品标签与能力映射。（DWUI-005、DWUI-007、DWUI-FEEDBACK-001、DUL-006、DUL-BRAIN-001、PKG-BRAIN-002）

## 11. 真实工作站与故障验收

- [x] 11.1 将工作站 fixture、brain-workstation/sharing 与 product acceptance 接到真实 Go Core、原生 helper、确定性模型和真实 SDK/MCP/Service；由 Pi 生成 Todo/复盘/异步导出，记录路径/动作、自动处理、代码改进、经验、脑包实际行为和两份分享。验证：design 八条闭环全部产生真实 Run/Action/Job/证据/SDK checks，真实浏览器及网关 HTTP/WebSocket 成功，无 live provider 凭据/部署时镜像 build/宿主 Service 端口；更新本次验收入口与结果格式。（ADEP-003、BRN-006、BRN-002、GO-DELIVERY-002）
- [x] 11.2 把 brain/package/file/desktop 故障验收中 TS CoreApplication/PiPackageWorker/旧 CLI 旁路换成当前 Go 测试或 Go 程序；保留与新增真实 agentd 中断、包加载失败、已加载行为失败、期限/取消/准入竞争、分享历史不回放断言。本次复核补正：真实坏行为候选失败验收锁定本次 live requestId、关联 Run/SDK 失败依据、仍为该候选的 active/loaded 与有效经验未提交，保留旧失败请求作为不能满足新断言的对照。验证：三类 Action 已接受无 waitRef 恢复和候选原键恢复全部通过，无第二次副作用；故障资源只清理本验收所有的对象，当前测试文档不含可运行旧入口。（WAF-008、WAF-006、BRN-005、ADEP-003、GO-DELIVERY-001）

## 12. 原生构建与依赖边界

- [x] 12.1 同步 master Makefile、原生镜像标签/协议哈希、release、fixture、TS workspace/lock 与资源路径，删除旧平台代码/生成器/启动脚本/依赖及失效测试；当前操作指南只给 Go 入口，历史记录明确只读。验证：generate/build/test 和原生镜像/发布清单检查通过，保留 TS 仅为目标架构 Agent/extension/browser，package-helper=2、history=4、模型/反馈=1 全链一致，Node 不成为发布宿主要求。（GO-DELIVERY-001、GO-DELIVERY-002、RUNTIME-CONTEXT-001）
- [x] 12.2 扩大源码边界扫描到 scripts、构建/运行配置、锁文件和当前文档，拒绝旧平台路径/import/dist/命令；checker 拒绝规则仅在自身精确排除，不忽略整个 scripts。验证：注入旧 script/动态 import/运行配置/lock 引用会失败，合法 Agent/extension/browser 不误报，源码/镜像/发布检查均通过；更新当前 gate 说明。（GO-DELIVERY-001、GO-DELIVERY-002）

## 13. 最终集成核验

- [x] 13.1 运行当前 master 分层 generate/build/test/integration/acceptance/release、源码/镜像/发布闭包检查以及扩展后的 scratch 无 Node 宿主八条回路；确认 master UI/授权/凭证/生命周期/文件/包/快照回归与全部新规范场景，记录实际 Go 基线、命令及结果。本次复核补正：先完成 5.2/7.3/10.2/11.2 的对应回归，再更新受影响构建、真实 SDK/Service、浏览器、发布/原生宿主及核验报告；W1～W4 必须各有修复后的当前证据，不以此前 PASS 或任务勾选替代。验证：`openspec validate rebase-piwork-brain-onto-go-core --strict --no-interactive` 和 implementation verify 无未处理问题，零旧 TS Core 运行/构建/测试依赖，所有任务及八条回路有当前证据；此项只核验集成，不代替各组欠缺的测试与文档。（GO-DELIVERY-001、GO-DELIVERY-002、BRN-006、ADEP-003、全部 delta requirements） W5 补正：3.2/5.2/6.1/8.1 完成，39+74 单元及四个 Go 包非缓存通过；重建受影响镜像、原生程序与 release，真实 scratch 八条回路及两副本独立 SDK 证明通过，源码/镜像/发布校验、任务和核验报告同步完成。
