# Agent Service Deployment Specification

## Purpose

Enable the Work agent to turn user-requested persistent applications into Core-managed private services using a default instructional Skill and MCP tools, with shared durable files, verifiable deployment outcomes and automatic lifecycle recovery.

## Requirements

### Requirement: Seed and select the deployment Skill through managed snapshots

**Identifier:** ADEP-001

全新安装 SHALL 将随发行提供的 `piwork-brain` 本地 Pi extension package 准备为普通 Core catalog 的默认包，包内包含 `deploy-work-service` Skill；不再为全新默认配置另选同名独立 Skill。首次具备兼容默认 agent 环境时 SHALL 通过现有隔离准备与制品验证完成种子，发布包、初始默认选择及完成标记 SHALL 原子且只执行一次。准备失败不得提供假的已安装默认能力，Core 健康与配置修复入口保持可用。

省略 package 选择的新 Work SHALL 捕获独立脑包并在 ready 前确认实际 SDK 加载。显式 packages=[] 不选择脑包，skills=[] 只清除独立 Skills。重启 MUST NOT 覆盖管理员修改、重新启用已禁用包、复活已移除包或补回被清空默认值。既有 Work 和已有独立部署 Skill SHALL 保持，采用脑包要求显式安装/选择与 Apply；同名资源冲突遵循既有包激活错误并提供移除重复 desired 独立选择的方向，不静默覆盖用户 Skill。包内容更新 SHALL 不要求重建兼容 agent 镜像。

#### Scenario: Load the fresh default deployment Skill
- **WHEN** 全新配置完成的安装创建一个省略 package 选择的 Work
- **THEN** Work 拥有 piwork-brain，其包内 deploy-work-service 与默认认知的真实加载得到确认，独立默认 Skills 不包含同名副本

#### Scenario: Respect no-Skills
- **WHEN** 用户创建时指定独立 skills=[]，但未清空 packages
- **THEN** 独立 Skills 为空，脑包内部署 Skill 仍按包选择加载；显式 packages=[] 才不选择默认脑包

#### Scenario: Do not reseed operator changes
- **WHEN** 管理员移除默认脑包选择并修改、禁用或移除 catalog 项后重启 Core
- **THEN** 已完成种子不重复执行，管理员选择和既有 Work 副本保留

#### Scenario: Recover interrupted first seeding
- **WHEN** Core 在首次种子发布事务提交前失败
- **THEN** 恢复准备或明确失败后重试，只能发布一个完整包和默认引用，不创建重复独立 Skill 或默认项

#### Scenario: Adopt the brain in an existing Work
- **WHEN** 已有 Work 安装脑包且仍显式选择同名独立部署 Skill
- **THEN** 原运行不变，Apply 以资源冲突失败并指明需要调整 desired 独立选择；只有明确选择及成功 Apply 后才采用脑包

### Requirement: Guide deployments using persistent code and explicit verification

**Identifier:** ADEP-002

脑包默认认知 SHALL 将 Service 开发细节路由到现有部署 Skill 与 Reference；部署 Skill SHALL 指导 Pi 查询 deployment_context 确认 workspace、工具和配额，将代码放在 apps/<service-name>、业务数据放在 data/<service-name>，对未指定技术栈的新 Web Service 默认使用 WEBBASE-001 至 WEBBASE-007 的已发布固定 Web 基础镜像及匹配模板、固定可复现依赖准备、监听 0.0.0.0 并解析 Work 私网端点。Pi SHALL 显式更新匹配服务、使用稳定 mutation 键和预期定义版本、查询持久 Operation、失败及日志，并从 agentd 验证实际应用后才报告成功。

创建或修改持久且由 Pi 开发维护的 Service 之前，Pi SHALL 自动先维护 apps/<service-name>/SPEC.md 的必要设计，包含 Intent、Objects、State、Business Flow、Agent-operable Capabilities、Implementation Map 和 Acceptance Criteria。首次创建形成最小文档；已有 Service 先读当前 Spec 与受影响代码，仅更新相关条目与实现坐标；缺失旧 Spec 时根据真实代码和用户目标补齐最小依据后再改实现，不要求用户补文档。不因普通 Query / Action 操作改 Spec 或启动开发测试。

新应用从模板初始化 SHALL 使用 WEBBASE-004 的共享不覆盖入口，在任何 SPEC.md 写入或复制之前拒绝已有应用目标；首次安全初始化 SHALL 先提供必要 Spec 再写入其余模板，后续业务实现仍先维护实际 Spec。Skill/Reference、模板 README 和实际 SDK 验收 SHALL 使用同一入口，初始化失败不得继续 service_create/update/restart，不得靠已有幂等回执宣称成功。用户维护既有应用时 SHALL 读取当前内容并局部修改，不重新复制模板覆盖源码、锁文件或注册信息。

实现 SHALL 使用现有项目测试验证相关 Acceptance Criteria，并读取实际 Service 状态与 Evidence；UI 与 Agent 业务入口复用同一业务逻辑与权威状态。失败保留真实结果，能自主修复时采用有界最小修复，受自动目标原预算约束，不通过删除失败用例或降低验收条件冒充通过。修改文件、Spec 和测试/业务结果 SHALL 通过原有 SDK 工具记录、Files、请求/Evidence 与 Chat/CLI 结果可查，不新增开发账本或 Eval 引擎，不要求额外人工 Spec/Plan/Eval 审批。

Pi 开发维护的 Service SHALL 同时完成 WAF-001 至 WAF-009 的状态查询、Action/Job、必要 Event、反馈请求和验证路径；不能把观测及自动反馈留作下一阶段。第三方代码遵循 BRN-002 的外部观察范围。Service 代码修改 SHALL 保留恢复依据，代码/配置恢复与业务数据补偿分开。未指定技术栈的新 Web Service SHALL 默认采用 FastAPI + React + TypeScript + Vite；用户显式指定其他语言/框架、维护已有应用或部署第三方软件时沿用目标环境，不强制转换。当前默认模板和指导不得依赖 NiceGUI。

Skill SHALL 区分进程 readiness 与应用可用、Stop Service 的持久禁用与 Stop Work，并解释共享存储和可复现启动。agentd 内后台进程、Skill 加载或 create 接受不得被当作成功持久部署，修复不得清除共享业务数据。

应用代码/配置修改后，Skill SHALL 指导 Pi 自动执行必要 checks/build 与 Service update/restart，等待原 Operation 并核对实际运行 codeVersion 及受影响业务结果；不把保存文件或用户手动刷新当作部署步骤。默认模板 SHALL 按 WEBBASE-007 支持开发热更新及部署后的页面自动采用，保留支持恢复的草稿和路径；默认运行模式不得因逐个中间文件写入就发布未经检查的版本。刷新不新增模型 Run、不替代业务 Evidence、不绕过脑包显式 Apply。

Skill SHALL 说明 sqlite3 CLI 在 Agent/base 的执行位置以及仓库 `deploy/images/web-base/` 的维护职责。AI 可在已有授权 bash 中执行实际 sqlite3 做获准数据开发/诊断；普通业务操作沿原 Action/Query，不把 Service 有命令误当 Agent 有命令，也不要求宿主安装 sqlite3。

#### Scenario: User requests persistence
- **WHEN** 用户要求工作站在 Work 重启后持续使用
- **THEN** Pi 通过 SDK/MCP 完成代码与数据落地、服务部署和业务交互验证，状态与反馈路径一起交付

#### Scenario: Dependencies need installation
- **WHEN** 应用依赖不在已有镜像中
- **THEN** 使用 workspace 中固定可复现安装/启动流程或明确失败，不要求运行中的 Pi 构建镜像

#### Scenario: Tools are unavailable
- **WHEN** MCP 被移除、部署/业务工具被 deny 或脑包必要能力不可用
- **THEN** Pi 说明缺失能力及实际限制，不以本地后台进程、未接通事件或推测结果报告完整交付

#### Scenario: 创建 Service 先形成 Spec
- **WHEN** 用户通过自然语言要求创建可操作的 kanban
- **THEN** 实际 SDK 首次业务实现写入之前已有最小 SPEC.md，部署后 UI / Action 共享状态，受影响测试和真实查询结果提供验证依据

#### Scenario: 修改既有功能只更新影响范围
- **WHEN** 用户要求增加 kanban 的业务规则
- **THEN** Pi 读取并更新该规则的 Spec、Acceptance Criteria 和 Implementation Map 后修改相关实现，运行目标回归测试并实际查证，不要求用户逐步确认

#### Scenario: 重复创建不能覆盖已有应用
- **WHEN** 同名应用目录已有用户修改，Pi 再次执行模板初始化路径
- **THEN** 实际初始化入口在写入前拒绝，保留原 Spec、源码、依赖、数据和 Service，Pi 如实说明已有应用并按目标读取/修改，不继续覆盖式复制或用 create 幂等成功掩盖失败

#### Scenario: 测试失败如实收尾
- **WHEN** 受影响测试或实际业务验证失败且有界修复仍未解决
- **THEN** 结果说明已完成的变更与未验证部分，保留真实失败输出和旧验收依据，不报告 Verified 或提交有效失败经验

#### Scenario: 默认环境直接开发 Web 应用
- **WHEN** 用户未指定技术栈，要求 Pi 开发一个新的 Web Service
- **THEN** Pi 使用固定 Web 基础镜像和匹配模板，通过原 SDK/MCP 部署并实际验证，无需用户逐个决定环境或在 Work 内构建镜像

#### Scenario: 用户指定另一环境
- **WHEN** 用户明确要求其他技术栈或修改已有非默认应用
- **THEN** Pi 沿用目标环境及相同 Service/反馈/验证契约，不将默认技术栈变为强制条件

#### Scenario: 修改后无需用户手动刷新
- **WHEN** Pi 改变默认应用的前端或后端，用户保持业务页面打开
- **THEN** Pi 自动完成必要构建/部署并查询新的运行版本，页面自动采用新效果，用户不需重启或刷新

#### Scenario: 数据检查命令在正确容器执行
- **WHEN** 获准任务需要用 sqlite3 检查 workspace 的合成或应用数据库
- **THEN** Pi 在 Agent 的现有 bash 中执行实际命令并核对结果，不尝试 Docker exec 或临时安装，业务状态修改仍遵守原契约

### Requirement: Prove deployment with real SDK MCP containers and retained files

**Identifier:** ADEP-003

必需产品验收 SHALL 使用确定性模型、真实 Pi SDK、已加载脑包认知与 Skill、真实 MCP/gRPC 和 Docker 运行一个工作站示例。Pi SHALL 通过 SDK 工具生成/修改代码并调用既有服务工具，验证 HTTP、实际业务 Action、共享持久标记、页面路径和业务事件、Service→Pi 自动请求、异步导出 Job 续接、反馈和证据、下一次执行采用经验、脑包候选 Update/Apply/实际能力验证以及完整环境独立导入。参考示例采用的技术栈仅用于该验收。

测试 SHALL 覆盖 Work stop/start、Core 正常重启、agentd 在副作用附近中断、服务恢复及标记保留，恢复不靠新的模型 redeploy 调用。隔离、来源身份、过期身份、单 Run 门禁、未知结果不重提、部署失败与脑包加载失败恢复 SHALL 自动覆盖。部署期间不得 build/commit 镜像或发布宿主端口；验收使用预备镜像和固定依赖，不需要真实模型提供者凭据。真实浏览器的 Service 交互及现有网关 HTTP/WebSocket 行为必须验证。

副作用中断验收 SHALL 注入“Action 已被接受而 waitRef 尚未登记”的窗口，正式 ready 后通过原 Action/Job 只读核对，分别证明已终态进入原目标验证、仍执行登记原对象等待、无法证明进入 needs_attention，且旧 Run 保持 interrupted、原 prompt 和 mutation 不重放。等待期限等于原请求期限及停机跨过期限 SHALL 同样显示需处理，不把未证实结果宣称为业务失败或回滚。

脑包采用验收 SHALL 在准备时固定一个具体工具、输入和检查项，以真实 SDK 调用及检查证明可辨的新行为；读取 Skill、查看状态或无关工具成功不能替代。SHALL 同时覆盖加载成功而行为检查失败的候选与加载失败候选，分别验证真实 active 状态和原目标需处理、原有加载回退行为。独立导入的两份 Work SHALL 分别准备新的验收项并产生各自 SDK 调用证据，不复用源 Work 的采用证明。

已加载行为失败的验收 SHALL 锁定本次新候选的 live requestId，核对该请求的 needs_attention、关联实际 Run 和失败的 SDK checks/输出依据、仍属于该候选的 active/loaded，以及有效经验未因失败提交。仅找到任意 needs_attention 或 Work ready SHALL NOT 通过此验收；此前加载失败或其他目标的记录不得满足新候选断言。

#### Scenario: Complete the Python HTTP demo
- **WHEN** 验收在全新存储及兼容预备镜像上运行工作站参考示例
- **THEN** 真实 SDK/MCP 创建服务并验证业务，用户反馈触发 Pi 自动处理和异步结果验证，数据在 Work/Core 重启后保留

#### Scenario: Separate fixture from implementation shortcuts
- **WHEN** 确定性模型选择部署或脑包工具并处理反馈
- **THEN** 实际 SDK 工具、MCP、gRPC 和 Work 内交互执行调用，mock 直接调管理器或直接改数据库不能替代验收

#### Scenario: Share and continue independently
- **WHEN** 示例 Work 经过 Stop/Export/Download/Import/Start 被复制两份
- **THEN** 两份均保留业务、脑包、经验和证据，新反馈与带具体验收项的脑包更新分别处理，各自产生实际 SDK 行为证明，源事件及旧 Job 不回放且三份后续数据相互独立

#### Scenario: 中断后核对原操作
- **WHEN** 真实 agentd 在 Service 接受 Action 后、登记等待前中断
- **THEN** 正式 ready 后只查询原 Action/Job，已终态自动续接验证、仍执行等待原对象、无法证明则需处理，三种情况均不重放原 prompt 或提交第二个 Action

#### Scenario: 加载通过不替代行为验收
- **WHEN** 同版本异内容的候选能被真实 SDK 加载，但固定验收项返回失败检查，或只执行无关状态工具
- **THEN** 候选的真实 loaded 状态保留，原更新目标不能完成并需处理；只有匹配工具和输入且检查通过的新行为证据才允许完成原目标

#### Scenario: 旧失败请求不能满足新候选验收
- **WHEN** 已存在一个加载失败的 needs_attention 请求，又准备并加载新的坏行为候选
- **THEN** 测试只在新候选原 requestId 取得失败 SDK 依据及 needs_attention 后通过，同时确认该候选仍 active/loaded 且失败未提交有效经验；旧失败请求不能使断言成立
