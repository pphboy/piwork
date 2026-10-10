# Piwork-brain 与独立 Work Memory

平台宿主只运行 Go Core 和原生 helper；Pi SDK、Agent、extension 在 Agent 容器内运行。Go 内嵌的 `internal/coreassets/piwork-brain/` 是普通 Pi extension package 的首次安装来源，包含认知、薄 extension、部署 Skill 和语言无关交互协议。它不作为 npm node module 安装。首次原生 prepare 成功后，普通 catalog、默认选择和一次性标记在同一事务提交；失败保持运行不可用并允许修复重试。管理员修改、清空、禁用或移除后，后续启动不重新播种。

新 Work 默认独立 Skills 为空、packages 含启用的 piwork-brain。显式 packages=[] 创建无脑包 Work；skills=[] 只清空独立 Skills，不移除脑包。启动时 captured active 包经过完整内容身份和当前 Linux/架构/Node ABI/SDK 校验，由真实 SDK 加载四类工具和认知。Go 静态镜像及 mTLS readiness 要求 package-helper=2、history=4/5、runModel=1、workFeedback=1。空 packages 同样必须满足当前协议。

Work 首次加载时将独立可编辑源码复制到 `.pi/packages/piwork-brain/`。重启和 Apply 不覆盖已有编辑，源码编辑不会热加载；每次执行使用 captured active 中的固定认知，并读取该 Run 固定采用的有效经验版本。包资源、Files、Chat 都沿用 master 的入口。

## 默认 Web 开发环境与应用交付

未指定技术栈的新 Web Service 默认使用 FastAPI + React + TypeScript + Vite，以及已发布的 `pphboy/piwork-web-base` 固定 tag@digest。通用起点为脑包的 `templates/web-app/`，完整工作站例子为 `templates/workstation/`；用户指定其他栈或维护既有应用时沿用目标环境。镜像维护源在本仓库 `deploy/images/web-base/`，工具链、锁文件、使用与派生方式见 [Web base 手册](../deploy/images/web-base/README.zh-CN.md)。脑包只保存使用指导、模板与固定引用。

部署 Skill 的共享初始化入口在写入 Spec、源码、锁文件和注册信息前拒绝已有应用目标，包括空目录、文件和链接。已有应用先读取实际内容再局部修改，不能重新复制模板覆盖。应用源码与可写依赖位于 `apps/<service-name>`，业务数据位于 `data/<service-name>`，普通启动、重启和环境升级均沿用这些内容。

应用修改的交付包括必要 checks/build、原 Service 更新或重启、原 Operation 观察、实际运行版本和业务结果验证。默认页面自动采用就绪的新前端，并保留支持恢复的非秘密草稿与当前路径；仅后端更新和普通 Agent Action 通过查询重读生效，显式开发模式提供前后端热更新。代码与前端版本均绑定实际镜像环境身份，因此仅升级基础环境也会自动采用新产物。无需用户手动刷新，失败或断线不冒充完成，也不额外启动被动 Run 或触发脑包 Apply。

Agent 生产/验收镜像与 Web base 都预装真正的 sqlite3 CLI。AI 的授权 bash 在 Agent 中执行，可用于 workspace 数据开发和诊断；普通业务变更仍走 Query/Action，不能直接改写 Core/history/Memory。宿主无需安装 Python、Node 或 sqlite3。旧 Work 保留捕获的包和镜像；采用新脑包及 Agent 工具仍走 Package Update、镜像选择和显式 Apply，一次性默认种子不重新覆盖管理员定制。

## Pi → Service

1. 用户通过 Chat 提出目标，SDK 调用脑包工具时才给需要修改的业务建立目标关联；普通查询直接形成观察证据。
2. `brain_service` 读取 `.pi/services/<name>.json`，从当前 Go 私有绑定获得容器和声明端口，直接请求 Service capabilities。
3. 查询返回状态版本和 checks，成为回答 evidence。业务修改先记录稳定 Action 身份，然后向 Service 发送声明的 input 和 expectedStateVersion；冲突需要重新观察和决策。
4. 同步结果必须实际查询验证。异步结果登记原 Action/Job 等待后释放 Run，用户此时可继续 Chat；返回结果只按原 ID 核对，不能重复 mutation。
5. 验证通过才能完成目标或提交经验；Run 文本结束本身不证明业务目标完成。

## Service → Pi

1. Pi 开发的 Service 在自己的业务事务中记录页面 pathname、业务动作和持久 outbox。页面参数、DOM 和浏览器点击轨迹不进入事件。
2. Service 使用专属当前 token 向 Agent TLS 收件口发送事件，Agent 持久化后才返回可查询 receipt；无法送达时 Service 保留原事件并重试原 ID。
3. 普通事实仅更新观察。明确声明原因的 `agent.requested` 创建请求；Service 可查询或取消自己的请求，不能直接创建任意 Session/Run。
4. 既有 BrainLoop 在正式 ready、brain 工具可用、没有其他 Run 且手动让位期结束时自动受理，使用受理时 Work 默认模型。自动续接始终使用兼容 context 的独立自动 Session；目标原 Chat/Service 来源及原手动 Run 保留。
5. 自动执行仍经过同一 BrainFlow 查询、Action、Job、验证和完成路径。结果事件只唤醒核对原等待，不递归创建新目标。

## 有界等待与反馈

每 Work 仅一个活跃 Run，释放后让位手动输入一秒；每请求最多四次自动 Run，每次最多三十分钟。事件上限 64 KiB，同时最多一百个未完成 live 请求。请求/Job 最长二十四小时，首次 Apply 等待最长七天；只读核对间隔至少五秒且不增加自动次数。查询返回后重新读取当前状态与原 waitRef，截止时间等值即到期，已取消/终态/取代的结果不能重新激活目标。

Cancel run 终止其关联未完成目标的后续执行；Cancel request 停止后续处理，已经发生的业务效果仍保留。Retry 使用新稳定键、新期限和 retryOf，先只读核对原效果。Action、Job、能力和验证查询每次返回后，重新检查 live 状态、生命周期准入及新请求期限；原业务仍执行也不能跳过。登记等待使用返回后的当前时间，截止相等或已过立即收尾，取消、终态与历史状态保持。重启先核对原 Action/Job/候选，不能重复 prompt、Action 或 prepare。历史分享记录供解释和 evidence 查询，不自动执行或 Retry。

已登记的 Job ID 保持不变；Action 回执暂未提供 Job 时仍查询原 Job。Retry、等待和恢复均核对 Job 回执的 Action 归属，不一致即 `needs_attention/INVALID_WAIT`，不启动验证 Run、不重复 mutation，也不记录为该目标的有效 Job 证据。请求完成及环境导入的历史校验都要求 Job 证据中的 Job ID、Action ID 与原引用匹配；拒绝完成时有效经验不变。普通只读 Job 观察仍可在没有目标关联时使用。

经验 stage 记录候选规则，只有关联目标的实际成功验证才能原子提交新的有效 head；失败保留旧有效经验。下一次模型调用才采用新版本，当前 Run 的 adoptedExperienceVersion 保持不变。经验不改变 Work 权限、工具授权或模型配置。

## 正式脑包软件更新

用户明确要求或正式软件维护需要修改 Brain Core、Extension 或 Skill 时，Agent 修改 Work 可编辑脑包后，提交稳定键、源摘要和固定行为验收目标；Go 从固定只读路径捕获、隔离准备并保存到最新 desired。过程保留用户对其他配置的修改，同名包或生命周期被取代则停止发布。同键查询返回原 Operation，源码之后再编辑不改变冻结候选。用户在现有 Pi Packages/Settings 中显式 Apply，当前 SDK 加载 captured active；随后新兼容自动 Session 执行原验收工具与 input、完整 checks。SDK 工具开始事件保存安全有界 input，静态历史图同样核验，不允许只靠 Skill 阅读、状态查询、加载成功或模型自述完成请求。加载成功但行为失败保留真实 active，目标进入 needs_attention。

候选按发布后真实受理顺序，关联同 Work、捕获了同一启用脑包内容的最新 Apply。保存无关 AGENTS/Skills 后 context 改变也能关联原加载失败及 prior active 回退；发布前、其他 Work、禁用/移除或同版本异内容的 Apply 不认领。关联只使用现有 Operation、持久 Apply 计划及捕获包绑定，发布事务记录操作顺序边界，不依赖可变化的墙上时间或增加第二套 Apply 登记。

Pi Packages 的现有 Details 分项呈现受理时 active/desired 选择与当前匹配摘要、固定目标工具、安全输入摘要和必要 checks、准备发布结果、原 Apply ID/状态。可按原 ID 打开请求与 Operation，刷新只读取事实并保留 Service 页面。尚未 Apply、观测不可用、加载失败与 SDK 行为失败分别显示；公开详情不包含制品摘要、context identity、凭据或宿主路径。


## 固定认知与 Service 开发

Brain Core 保持 Understand / Specify、Act、Verify、Remember 四项原则。Go Core 负责平台生命周期与权限，Pi SDK / Agent Runtime 负责执行，BrainFlow / BrainLoop 沿原边界处理反馈和等待。四项认知不是四个 Agent 或工作流状态机。

操作现有 Service：Intent → Query / Action → 实际验证 → 返回结果。创建/修改 Service：Intent → 最小 Spec → 实现 → 受影响测试及业务验证 → 实际 Service。`deploy-work-service` 自动维护 `apps/<service>/SPEC.md` 的 Intent、Objects、State、Business Flow、Agent-operable Capabilities、Implementation Map、Acceptance Criteria；不要求用户审批中间步骤。UI 与 Agent 操作共用业务逻辑。SDK 工具记录、Files、请求和 Evidence 提供原有观察，不增加开发账本或独立 Eval/Tasks 平台。

## 独立 Memory 的存储契约

新 harness 的 main history 为 schema 5，Memory 为 schema 1。Memory 路径由 Core 提供的 private 数据根派生：当前映射为 `/var/data/memory.sqlite`，与 `/var/data/work.sqlite` 同处原 private 卷，workspace 仍为另一卷。Service / WebDAV 不获得 private 挂载，存储仍只有两个受管卷。

`work.sqlite` 保存 Run / Request / Evidence 和 Memory 归属绑定；独立 Memory 保存不可变有效版本、认知条目、候选/失败/失效依据与 head，只引用原请求和 Evidence，不复制业务状态或证据正文。升级后 main 不再保存或双写 Experience。两库由同一宿主连接 ATTACH，使用 DELETE journal、FULL synchronous 和同一事务，将已验证请求完成与 Memory 发布一起提交；既有 schema 5 的 WAL 模式不能冒充联合原子提交。损坏、缺失、链接或错配 Memory 明确失败，不初始化空认知替代。

旧 schema 4 使用冻结的精确格式校验。导入不换固定镜像、不运行输入 SQL/Extension、不自动升级或复活旧请求；目标 Work 保持 stopped。schema 5 导入重建 Work/store 归属，保留原 entryId、版本与来源本地 ID，所有旧请求与候选是只读历史。未恢复的联合 journal 使 cold export 返回 SNAPSHOT_HISTORY_BUSY，正常存储恢复后再停止/导出，不能在复制路径忽略日志产生半事务包。

4→5 升级必须由既有显式 Apply 的独占、授权、备份与回退路径完成；未经授权的旧库交给新 harness 返回 WORK_HISTORY_MIGRATION_REQUIRED。新 active 发布之前的失败可恢复原数据格式；成功升级后不支持向仅能读 schema 4 的镜像降级。完整生命周期升级/回退与真实 SDK/Service 的验收状态以 [已归档实施任务](../openspec/changes/archive/2026-10-09-simplify-piwork-brain-and-extract-work-memory/tasks.md) 和实际验收记录为准，存储单测通过不代表全部产品验收完成。

Apply 的旧历史备份位于 Core 已有 private `runtime/history-upgrades/<operationId>/`，不进入 Work 包，不成为运行时读取源。原 snapshot helper 在旧 writer 退出后保存精确文件；迁移仅在 initializationOnly 候选中执行，并在打开旧库前通过当前代次的 mTLS 核对 saved 备份授权。候选失败先关闭 writer、恢复原格式，再启动原固定镜像。Core 中断或 Stop/Delete/新 Apply 取代时，由当前 Work fence 收尾；已发布的 committed 备份不得再恢复到旧格式。


## Memory 操作与采用

继续使用 `brain_experience`，不增加同义 Tool：list/status 保留 adoptedExperienceVersion、snapshot、effectiveVersion；stage 就是 Propose；commit 沿原目标真实验证完成。新增 recall、read、revise、invalidate。候选在原验证通过后才生效，失败、取消和超期不成为有效认知。

每个 Run 在受理时固定版本和实际提供条目。默认按任务范围、关键词和适用偏好选择，最多 10 条、16 KiB；显式 recall 最多 20 条，所有查询继续使用当前 Run 的固定版本。后续 Run 才采用新 head；版本号不代表模型已遵循所有规则。不同 entryId 的等待候选可以继续合并，同一条目的内容/来源已变化时报 MEMORY_VERSION_CONFLICT，不覆盖新认知。有效快照最多 100 条，rule 最多 4 KiB；修正/失效保存新版本，旧 Run 仍可读原版本。

Memory 的偏好、经验与可信知识不改变 Tool 权限、平台配置或 Founder 决策，不递归生成 Agent 目标。没有值得保存的新认知时，普通任务没有 Memory 候选或额外等待/审批步骤。认知更新不编辑脑包、不 Prepare/Apply、不重建 Runtime；软件维护继续按上一节的正式路径。

用户通过原 Chat 工具活动、Run/请求/Evidence 和 CLI chat / run watch / run show 观察实际结果。Memory 回执引用原请求的实际提交版本，区别于当前 Run 已采用版本；界面不存第二份可修改的认知操作日志，也不靠最终模型文字判定生效。

Founder 不变量见 [BASELINE.md](piwork-brain/BASELINE.md)。文档与 Git 历史不等于强身份审批保护。
