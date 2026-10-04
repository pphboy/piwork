# Piwork brain 工作流

平台宿主只运行 Go Core 和原生 helper；Pi SDK、Agent、extension 在 Agent 容器内运行。Go 内嵌的 `internal/coreassets/piwork-brain/` 是普通 Pi extension package 的首次安装来源，包含认知、薄 extension、部署 Skill 和语言无关交互协议。它不作为 npm node module 安装。首次原生 prepare 成功后，普通 catalog、默认选择和一次性标记在同一事务提交；失败保持运行不可用并允许修复重试。管理员修改、清空、禁用或移除后，后续启动不重新播种。

新 Work 默认独立 Skills 为空、packages 含启用的 piwork-brain。显式 packages=[] 创建无脑包 Work；skills=[] 只清空独立 Skills，不移除脑包。启动时 captured active 包经过完整内容身份和当前 Linux/架构/Node ABI/SDK 校验，由真实 SDK 加载四类工具和认知。Go 静态镜像及 mTLS readiness 要求 package-helper=2、history=4、runModel=1、workFeedback=1。空 packages 同样必须满足当前协议。

Work 首次加载时将独立可编辑源码复制到 `.pi/packages/piwork-brain/`。重启和 Apply 不覆盖已有编辑，源码编辑不会热加载；每次执行使用 captured active 中的固定认知，并读取该 Run 固定采用的有效经验版本。包资源、Files、Chat 都沿用 master 的入口。

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
4. 固定 CoreLoop 在正式 ready、brain 工具可用、没有其他 Run 且手动让位期结束时自动受理，使用受理时 Work 默认模型。自动续接始终使用兼容 context 的独立自动 Session；目标原 Chat/Service 来源及原手动 Run 保留。
5. 自动执行仍经过同一 CoreFlow 查询、Action、Job、验证和完成路径。结果事件只唤醒核对原等待，不递归创建新目标。

## 有界等待与反馈

每 Work 仅一个活跃 Run，释放后让位手动输入一秒；每请求最多四次自动 Run，每次最多三十分钟。事件上限 64 KiB，同时最多一百个未完成 live 请求。请求/Job 最长二十四小时，首次 Apply 等待最长七天；只读核对间隔至少五秒且不增加自动次数。查询返回后重新读取当前状态与原 waitRef，截止时间等值即到期，已取消/终态/取代的结果不能重新激活目标。

Cancel run 终止其关联未完成目标的后续执行；Cancel request 停止后续处理，已经发生的业务效果仍保留。Retry 使用新稳定键、新期限和 retryOf，先只读核对原效果。Action、Job、能力和验证查询每次返回后，重新检查 live 状态、生命周期准入及新请求期限；原业务仍执行也不能跳过。登记等待使用返回后的当前时间，截止相等或已过立即收尾，取消、终态与历史状态保持。重启先核对原 Action/Job/候选，不能重复 prompt、Action 或 prepare。历史分享记录供解释和 evidence 查询，不自动执行或 Retry。

已登记的 Job ID 保持不变；Action 回执暂未提供 Job 时仍查询原 Job。Retry、等待和恢复均核对 Job 回执的 Action 归属，不一致即 `needs_attention/INVALID_WAIT`，不启动验证 Run、不重复 mutation，也不记录为该目标的有效 Job 证据。请求完成及环境导入的历史校验都要求 Job 证据中的 Job ID、Action ID 与原引用匹配；拒绝完成时有效经验不变。普通只读 Job 观察仍可在没有目标关联时使用。

经验 stage 记录候选规则，只有关联目标的实际成功验证才能原子提交新的有效 head；失败保留旧有效经验。下一次模型调用才采用新版本，当前 Run 的 adoptedExperienceVersion 保持不变。经验不改变 Work 权限、工具授权或模型配置。

## 脑包自更新

Agent 修改 Work 可编辑脑包后，提交稳定键、源摘要和固定行为验收目标；Go 从固定只读路径捕获、隔离准备并保存到最新 desired。过程保留用户对其他配置的修改，同名包或生命周期被取代则停止发布。同键查询返回原 Operation，源码之后再编辑不改变冻结候选。用户在现有 Pi Packages/Settings 中显式 Apply，当前 SDK 加载 captured active；随后新兼容自动 Session 执行原验收工具与 input、完整 checks。SDK 工具开始事件保存安全有界 input，静态历史图同样核验，不允许只靠 Skill 阅读、状态查询、加载成功或模型自述完成请求。加载成功但行为失败保留真实 active，目标进入 needs_attention。

候选按发布后真实受理顺序，关联同 Work、捕获了同一启用脑包内容的最新 Apply。保存无关 AGENTS/Skills 后 context 改变也能关联原加载失败及 prior active 回退；发布前、其他 Work、禁用/移除或同版本异内容的 Apply 不认领。关联只使用现有 Operation、持久 Apply 计划及捕获包绑定，发布事务记录操作顺序边界，不依赖可变化的墙上时间或增加第二套 Apply 登记。

Pi Packages 的现有 Details 分项呈现受理时 active/desired 选择与当前匹配摘要、固定目标工具、安全输入摘要和必要 checks、准备发布结果、原 Apply ID/状态。可按原 ID 打开请求与 Operation，刷新只读取事实并保留 Service 页面。尚未 Apply、观测不可用、加载失败与 SDK 行为失败分别显示；公开详情不包含制品摘要、context identity、凭据或宿主路径。
