# Design

## Context

动机见 [proposal.md](proposal.md)。当前实现决定了本变更的接入方式：

- `internal/coreassets/brain.go` 把 `piwork-brain/` 全树嵌入 Go Core，`internal/coreapp/bundled_brain.go` 通过一次性种子准备默认包；已捕获包由 Work 自有 context 固定。修改模板不能自动更新既有 Work。
- `deploy-work-service` 已指导 Agent 先形成 `apps/<service>/SPEC.md`，经真实 MCP 部署已有镜像，代码放共享 workspace，数据放 `data/<service>`。Core 不接受 Work 内 Docker build/commit。
- 工作站模板的 `app.py` 使用 NiceGUI，`workstation.py` 保持独立业务逻辑，`piwork_protocol.py` 承担交互契约；`scripts/build-workstation-fixture.mjs` 目前只准备 Python/NiceGUI wheel 镜像，不能作为通用 Web 开发基础镜像。
- `internal/servicedefinition/definition.go` 将省略内存补成 128 MiB；`internal/dockerengine/resources.go` 再把零补成 64 MiB，并拒绝小于 16 MiB。Service runtime 强制 `10001:10001`，Docker 层使用只读根文件系统。
- Service 资源在 `corestore/quota.go`、`service_accept.go`、`work_config_validate.go` 和快照导入 admission/publish 中累计；仅删除 Docker 的 Memory 参数仍会被这些准入拒绝。
- `proto/work-services.proto` 的内存是无符号数值，HTTP schema 原始来源是 `internal/contracts/schemas.json`；`packages/contracts/src/index.ts` 只是导出入口，不能把它当作 HTTP schema 源。
- 当前浏览器 Service 入口使用独立 origin，保留根路径和 WebSocket，不需要为应用人为加子路径。单个声明 HTTP 端口同时承接浏览器和 Agent 业务协议最容易复用现有路径。
- `apps/desktop-webui/src/app.ts` 定期刷新 Work/Service 状态，但 reconcile 保留同一 Service iframe，不会因为状态更新而重新加载应用。因此后端重启或前端重新构建并不等于已打开页面采用新版。
- AI 的 SDK bash 在 Agent 容器执行；`Dockerfile.agentd` 当前 runtime 安装 git/ca-certificates，未安装 sqlite3 CLI。仅给 Web base 安装 sqlite3 不能让 Agent bash 获得该命令。

## Goals / Non-Goals

**Goals:**

- 一个可独立版本化的 `piwork-web-base` 同时支持直接部署和下游派生，标准应用无需临时联网安装基础环境。
- 接入原有 Service、业务/反馈、Memory 与快照机制，直接复用源码/数据边界。
- 真实取消所有受管应用 Service 的内存硬限制及内存预留，同时保留历史可读性、幂等结果和仍有效的配额。
- 默认模板具备可验证的业务与反馈，而非只证明进程监听端口。
- 使 AI 自动完成应用修改的生效过程，默认模板在用户不手动刷新的情况下采用新代码，并保留当前路径和支持恢复的草稿。
- 为 Agent 与 Web base 提供真正的 sqlite3 CLI，固定其环境版本并验证在实际执行位置可用。

**Non-Goals:**

- 不把基础镜像变成 agentd，不加入模型配置、脑包 Runtime、另一个调度器或新的开发控制后台。
- 不把 FastAPI/React 变成平台强制栈，不自动转换已有 NiceGUI 或其他应用。
- 不取消 CPU、PID、服务数、卷数、网络和权限边界，不调整 Agent/helper 的内存政策。
- 本版仅承诺 `linux/amd64`，不扩展为应用公网发布、生产编排平台或新增其他角色镜像；本次按追加授权发行现有五角色。

## Decisions

### 1. 通用镜像独立于业务模板和 Agent 镜像

镜像名称采用 `docker.io/pphboy/piwork-web-base`。本仓库的 `deploy/images/web-base/` 是长期维护源，使用 Git 维护 Dockerfile、环境/依赖锁、通用工具和双语 README；不放进某个 Work，也不把脑包内的镜像引用当作镜像构建源。通用工具安装到 `/usr/local/bin`，工具链、预置 Python 环境和离线依赖放 `/opt/piwork-web-base/`。业务模板保留在脑包的 `templates/` 中；提供通用 `web-app/` 起点，`workstation/` 继续承载现有待办/复盘/导出业务。

镜像环境包括 Python 3.13、Node 24、npm、FastAPI、Uvicorn、React、TypeScript、Vite、sqlite3 CLI 以及标准模板的后端/前端测试工具。基础 OS、工具链、Python wheel、npm lock 与 sqlite3 系统包均固定版本和完整性；精确 patch 版本在实施时从官方来源核对后写入锁文件。本版使用 Debian slim 的固定制品，避免把平台/二进制依赖差异留给每个 Work。

新增 `scripts/build-web-base.mjs` 和 `make web-base-image` 本机构建入口，使用受限构建 context；只纳入基础镜像材料和所需通用模板锁文件。产物落 `dist/web-base/`。基础镜像拥有自己的构建输入 hash、版本、源码身份和环境清单，不能误用五角色 Docker release 的 metadata。版本标签使用独立 semver 加源码/输入后缀以避免覆盖不同内容；脑包最终使用 `tag@sha256:...` 固定发布内容。

维护入口分工如下，基础镜像源码和版本以仓库文件为准：

| 位置 | 维护内容 |
| --- | --- |
| `deploy/images/web-base/` | 镜像源、锁文件、通用工具、环境清单、双语 README |
| `scripts/` 与 `Makefile` | 构建、验证和独立发布入口 |
| `internal/coreassets/piwork-brain/` | 使用认知、模板与固定 base 引用 |
| `dist/web-base/` | 被忽略的本地候选、构建输出和验证产物 |
| DockerHub `pphboy/piwork-web-base` | 已发布制品及 registry digest |

后续维护顺序是修改上述镜像源/锁文件、构建验证、发布新固定版本，然后更新 brain 的兼容引用；不在运行容器里安装补丁并冒充可复现的新版本。

其他项目可 `FROM docker.io/pphboy/piwork-web-base:<fixed-version>@sha256:<digest>`，在镜像构建阶段安装专用依赖，最终仍以 `10001:10001` 运行。Core 中执行的是预先构建镜像，Work 本身不获得构建权限。

备选：只往 agentd 安装 Python/前端依赖会混合执行与业务职责；发布单个工作站镜像会把通用环境绑在业务上。均不采用。

### 1.1. sqlite3 同时存在于 AI 和应用执行环境

Web base 与 `Dockerfile.agentd` 的公共 runtime 层均安装真正的 sqlite3 命令，Agent production/acceptance 两个 target 一致。命令在 PATH 可见，无需 root、联网安装或新增模型工具；AI 仍通过已授权的 SDK bash 使用。Python sqlite3 模块与 Node SQLite API 不替代 CLI 交付。

检验不仅是 `sqlite3 --version`：使用同一 UID/GID 和共享 workspace 的合成数据库，证明 Agent 真实 bash 可建表/写入/查询，Service 环境也能读取并产生 JSON 查询结果。只读根文件系统下数据库及临时文件仍写入 workspace。sqlite3 不访问或改写 Core、Memory 等受管状态；普通业务操作保持现有 Query/Action/expectedStateVersion 契约，直接 SQL 用于用户授权的数据开发、迁移和诊断。

增加 Agent 的系统命令需要新 Agent 镜像；包/Skill 更新本身无法给已捕获旧镜像补装命令。既有 Work 沿原镜像选择和显式 Apply 采用新 Agent；工具被 deny 或旧镜像没有 CLI 时，AI 如实说明，不偷偷 apt install 或授予 Docker 执行。Agent 镜像在本变更构建和验证，其对外发行沿既有角色发布流程；用户随后已追加授权现有五角色镜像的发布，Agent 新工具随本次新版 Agent 交付。

### 2. 只读基础环境与 Work 可写依赖分别保存

默认应用布局：

```text
/var/data/workspace/
  apps/<service>/
    SPEC.md
    backend/
    frontend/
      package.json
      package-lock.json
      node_modules/
      dist/
    .venv/
    .cache/
    .build/
    .tmp/
  data/<service>/
    ...business files and database
```

标准 Python 依赖在镜像中可直接使用；应用需要扩展时在自身 `.venv` 中用固定 wheel 集合离线准备。npm 在可写应用目录用匹配 lock 和镜像预置缓存执行离线准备，缓存需要更新的部分写到 workspace。不得把整个应用 node_modules 链接到只读镜像目录，造成后续编辑/安装不可用。

HOME、TMPDIR、npm cache、Python cache 均显式落到该应用的 workspace 子目录；不依赖只读 `/tmp` 或镜像层写入。固定环境与应用锁文件使用同一环境清单核对；新依赖缺少离线包时明确失败，用户可采用锁定依赖扩展或派生镜像。标准离线保证不扩大为任意依赖都已预装。

初始化由 Agent 从冻结脑包复制模板，保留执行位并让应用副本可写；显式初始化入口也不得覆盖现有目录。普通启动不复制模板、不重置业务库。Data 目录与代码/checkpoint 独立，恢复代码不恢复已提交业务事务。

核验后的修复采用部署 Skill 随包提供的共享安全初始化入口，使用 Agent 已有运行工具从授权 SDK bash 执行，不要求 Agent 或宿主新增 Python。通用模板、工作站、使用指导和确定性部署 driver 共用该入口，不能继续各自组合 `mkdir -p` 与覆盖式 `cp -R`。目标应用路径已存在时（包括空目录、文件或符号链接）在任何 SPEC.md、源码或注册信息写入前失败，保留业务数据和原 Service；检查与独占创建必须避免并发调用都通过后相互覆盖。首次初始化先落必要 SPEC.md，再复制其余模板文件，保留执行位并使独立副本可写；Agent 随后按当前任务维护 Spec，再开始业务实现。已有应用走读取/局部修改流程，不重跑初始化；失败只处理本次产生的临时产物，不清理已有应用或业务数据。

单元测试和真实 SDK 回归必须调用该实际入口：首次初始化成功后改写应用源码、SPEC.md、锁文件并写入合成业务数据，再次初始化应失败，所有原内容保持；重复初始化失败不能继续 service_create 或用幂等回执掩盖文件覆盖。普通 Service 重启保留数据的原回归继续执行，它不能替代重复初始化的反例。

备选：仅预装语言会留下依赖问题；每次联网安装不能满足离线恢复；把业务文件放镜像内会让 Work 编辑和分享失去唯一权威来源。

### 3. 通用命令和单端口运行方式

提供 `/usr/local/bin/piwork-web`，以清楚的子命令暴露 `prepare`、`check`、`build`、`serve`、`run`、`dev`。应用根默认是工作目录，也可用显式参数选择；Work 用法要求它处于获准 workspace 内。

- `prepare` 按应用锁文件准备依赖，失败停止；`check` 运行应用声明的后端测试、前端类型检查及测试，结果写 `.build/` 并返回真实退出码。
- `build` 完成前端构建，采用临时输出后成功发布，记录代码/锁文件/环境输入身份；不在构建失败后启动旧前端冒充本次代码已交付。
- `serve` 启动 FastAPI/Uvicorn，`run` 串联准备、所声明的 checks、构建和 serve。默认模板的 Service 显式选择 `run` 和 checks，不能依赖 Docker ENTRYPOINT 的隐式 shell。
- `dev` 显式启动带代码重载的 FastAPI/Uvicorn 后端与 Vite/React Fast Refresh；Vite 对外监听 8080 并把 API、`/pi/v1`、模板 UI 后端请求和 `/health` 代理至仅容器 loopback 的后端端口。重载监视限定应用源码，排除 data、依赖、缓存和构建输出，避免写库触发重启。开发模式正确传递终止信号，任一必要进程退出会终止组合进程，不新增持久进程管理系统。

默认交付只运行 FastAPI 的 8080 入口，提供前端静态产物与 API。SPA fallback 排除 API、协议及健康路由。前端使用根路径资源和同源 API；开发模式按实际代理 Host 配置允许列表，验证 HMR WebSocket，不通过关闭全部 Host/CORS 校验解决问题。

```text
Pi SDK --write/edit--> Work workspace
   |
   +--Service MCP--> Core --> piwork-web-base Service
                                   |
                                   +--> prepare/check/build
                                   +--> FastAPI :8080
                                          | API + /pi/v1
                                          | React assets
                                          v
Browser --> CLI service entry --> Core gateway
```

现有 Service MCP 没有通用容器 shell 工具，所以测试不能假设 Agent 可直接 `docker exec`。默认 runner 在启动流程运行应用 checks，把真实结果持久化，Pi 从共享文件和 Service 日志读取；随后再通过业务 Query/Action 验证。模板单元/组件测试使用独立临时数据根，不访问真实业务库、outbox 或交互身份；实际业务验证通过原有 API/Evidence 完成。测试失败退出由原 Service Operation 收尾，Pi 仍可修复可写源文件并用既有 update/retry/restart 流程重试。

readiness 只在检查和构建成功、后端及前端产物可服务后通过，使用现有 120 秒默认/300 秒上限；本变更不扩大就绪预算。验证超时不能视为成功或削弱已有检查。默认 250 CPU milliseconds 保持平台语义，首次构建缓存命中与冷启动耗时必须实测。

备选：两个默认 Service 会增加配额、生命周期和跨 origin 配置；始终启动 Vite 增加普通交付的进程与 WebSocket 依赖。默认单进程构建后运行，热更新只在 dev 模式启用。

### 3.1. AI 交付包括自动生效，页面依据真实版本自动更新

把这一责任写入现有 brain Verify 原则和部署 Skill：应用代码/配置改动后，Agent 自动完成必要 checks、构建及 Service update/restart，等待原 Operation 的实际结果并查询正在运行的 codeVersion 和业务结果。不得以“文件已保存，请手动刷新/重启”收尾，也不能仅因 Service Ready 或模型说完成而跳过版本核对。开发模式虽可即时热更新，交付仍需完成相关 checks。

默认运行方式继续显式部署经过检查的产物，不在每次文件写入中间状态自动重启。默认前端包含轻量版本客户端，后端提供同源只读 `GET /api/runtime-version`，返回当前进程实际加载的 codeVersion、frontendVersion 和 ready；这些是代码/产物身份，不包含 token、宿主信息或业务内容。frontendVersion 从前端源码/锁文件/环境输入派生并嵌入当前 bundle，不从首次轮询的服务器值冒充本页已加载版本，也不计算含自身版本字段的 hash 循环。只有 checks/build 成功并且新后端与前端产物匹配后才发布该版本；旧进程不能因为磁盘 marker 已变化就谎报自己加载了新代码。

核验确认当前 `version()` 只把环境摘要放在独立 environmentHash 字段，未将它纳入 codeVersion/frontendVersion；页面仅按 frontendVersion 判断是否需要新 bundle，因此修复须把实际镜像环境摘要与相应源码/锁文件摘要组合计算版本。相同源码、锁和环境得到稳定版本；仅后端源码变化时 frontendVersion 保持；基础环境改变时 codeVersion 和 frontendVersion 都改变。实际环境以镜像 `/opt/piwork-web-base/environment.json` 的受构建输入绑定内容为准，不接受应用环境变量伪造环境升级；生成的 marker、dist 和版本字段仍排除在源码摘要外。checks、build、serve、后端实际加载信息与 bundle 嵌入值使用同一算法。

增加版本组合的单元回归及仅环境变化的浏览器验收：应用源码和锁文件保持不变，使用开发机准备的两个真实可区分环境身份的受管镜像，经原 Service 更新流程完成检查、构建与启动；用户页面保持打开且有草稿及非根路径，自动采用新前端一次，恢复草稿/路径，不增加被动 Agent Run 或脑包 Apply。测试不得只改服务器磁盘 marker、只模拟客户端版本响应或手动 reload 充当真实环境升级；原前端修改、仅后端修改、失败构建及断线回归继续保留。

版本响应同时说明实际运行模式 development/static。页面从构建后运行切换到开发模式时自动加载 Vite 页面，开发模式切回普通运行时自动加载已检查的静态产物，即使两者源码版本相同也不能停留在旧模式。持续开发模式仍由 HMR 处理源码更新；模式不匹配仅触发一次页面采用，实际加载后去重。

已打开页面每五秒在可见时检查此端点，恢复可见/连接时立即检查；HTML 与版本响应不缓存，前端静态资源按构建 hash 定位。只有确认新版本已就绪且与本页版本不同时才更新页面；开发模式优先 HMR，默认模式在需要重新加载 bundle 时由应用自身执行一次 reload。保持当前路径，模板通过应用自己的草稿恢复接口保存/恢复可序列化非秘密输入；草稿保存失败则保留旧页面、呈现更新待完成并自动重试，不丢弃用户输入或伪称本页已更新。

草稿在编辑时持续保存到该应用 origin 内的恢复存储，并在页面初始化时恢复，不能等版本通知到达才首次保存。这样真实 Service 重启导致入口暂不可用或页面重建时也保留已有输入；普通轮询和布局切换仍保留原 iframe，不能为刷新主动重建它。

仅后端 codeVersion 改变、frontendVersion 未变时，使应用当前受影响的查询失效并重新读取，保持组件和草稿，不靠整页刷新取得新业务结果。默认模板为此暴露自己的数据重读接口，不要求 Desktop 跨 origin 控制应用。

构建失败、网络断开、短暂不可达或相同版本均不触发 reload；连接重建后重新读取真实版本。以 frontendVersion 约束已采用版本和去重，避免重载循环；后台标签页重新可见时自动跟进。每次成功版本观察也重读普通业务查询，使 Agent Action 后的实际数据自动出现在页面，并覆盖初始查询与版本观察之间的竞争；数据变化不作为代码版本变化，不触发重载或新 Run。

实际环境升级回归须保留同一 Work/Service/端口的已开 iframe：Work 仍运行、Service enabled 且暂时 Starting 时，Desktop 保留原文档并显示实际状态，使应用在连接恢复后自己检查版本；首次打开未就绪应用不创建 iframe。Service stopped/disabled/removed、Work 停止、入口或嵌入权限失效仍沿原边界撤下页面，不把临时保留解释为放宽授权。

此机制只属于 Pi 开发的应用模板，不由 Desktop 外壳强制重建 iframe，不向第三方页面注入脚本，不跨 origin 读 DOM。浏览器版本检查是普通应用读取，不投递 agent.requested，不启动新 AI Run，也不等待所有离线窗口回执才能完成 Agent 的部署验证。脑包/Work 配置的正式软件更新仍须原 Package Update/显式 Apply，不能借“自刷新”绕过。

```text
AI edits --> checks/build --> Service update/restart --> verify running version
                                                            |
Browser (already open) --> same-origin version check --------+
       |
       +--> preserve draft/path --> HMR or one reload --> new UI
```

备选：只加认知规则不能让旧浏览器 bundle 变新；每次状态轮询都重建 iframe 会丢输入；只提供手动刷新按钮不满足目标。采用 Skill 的主动部署与模板版本客户端配合，复用原平台运行语义。

### 4. Service 内存政策彻底退出准入与 Docker 限制

这是应用 Service 的全局语义变化，不能只为此镜像设例外。使用现有对象 kind 区分 Service 与 Agent/helper；Docker 创建 Service 时 `HostConfig.Memory=0`，不追加 memory reservation/swap 等间接上限。Docker normalize 对 Service 允许零且不补 64 MiB，其他对象继续原策略。

为了保持旧请求和 `.work` 可读：

- HTTP/DTO、MCP、gRPC 的 `memoryBytes` 字段保留并弃用；省略默认零，合法非负安全整数可读。历史或旧调用者提交的正数保留原请求/定义事实，但不设置有效内存上限，不参与 Service 配额。负数、非整数、溢出仍拒绝。
- 不把全部历史显式数值规范化成零并改写旧请求指纹。保留旧 receipt 指纹；对已接受的旧省略默认请求，幂等查询兼容原 128 MiB 默认规范化，只有匹配同 scope/key 与原内容才返回原 Operation。新请求省略和显式零按同一语义规范化，其他字段冲突保持原规则。
- `DeploymentContext` 增加明确的 `serviceMemoryPolicy=unlimited`，`defaultServiceMemoryBytes=0` 明确为无限制。Service 当前投影增加明确的 `memoryLimitMode=unlimited`；definition 中旧数值不得被 UI/CLI 描述为当前限制。旧 total/availableMemory 字段只代表非 Service 管理预算，不表示实时机器剩余内存。
- 新 Service 预留的 desired/occupied memory 为零；CPU 和 slots 正常更新。历史非零 Service 预留可保留审计/分享，但有效核算统一根据 subject kind 排除其内存，避免重写历史和扩大 store 格式迁移。
- Core 配额汇总、Work 配置容量校验、导入临时预留、导入发布重检使用同一 Service 内存排除规则。`import` 聚合预留必须在聚合前按原 subject kind 排除 Service 内存，不能只在最后过滤 kind=import。
- 历史 Service 容器与期望 runtime hash 不匹配时，走原受管替换/恢复和 fence 流程，验证新容器确实 Memory=0，不接管受限旧容器并伪称无限制。正常升级按 Core 停止/重启恢复实施，不逐个重写业务定义。

Work 的既有 memoryBytes/default 数值继续约束 Agent 等受管对象，配置及文档明确其新范围；CPU 仍计算 Agent 加 Service，数量政策仍原子执行。不限内存指 Piwork 不额外施加 Service 上限，实际可用内存仍受宿主及外层部署限制。

备选：把默认提升到 512 MiB/1 GiB 不符合用户移除限制的决定；只写 Memory=0 会被 Docker normalize 和配额拒绝；直接删除协议字段/历史列会破坏原请求、快照和重启数据。

### 5. 模板迁移保留完整业务与反馈闭环

工作站 backend 复用并适配现有独立 `workstation.py` 与 `piwork_protocol.py`，HTTP UI 路由提供业务操作、页面路径事件、反馈及安全原回执；React 只调用这些路由。保持 Query/Action/Job、expectedStateVersion、幂等 effect、事务 outbox、异步导出、中断与历史 origin 语义，交互 token/CA 仍只读 backend 私有挂载。

替换 NiceGUI 页面、锁文件、prepare 路径和当前 README，改写浏览器用例为真实 React 交互。当前 `brain.md` 的 Verify 原则补充“使修改实际生效并验证”的通用意识，具体环境、部署和自动刷新细节进入 `deploy-work-service` Skill/Reference 和模板文档；与原职责一致，不复制一套流程。通用模板与工作站均包含版本检查和草稿恢复接入，业务刷新不能要求用户手动 reload。

通用模板与工作站模板的基础依赖锁共享环境身份；构建/检查入口验证镜像声明与模板锁匹配。基础镜像不包含工作站业务，增加新 Work 应用无需维护一份派生镜像。

### 6. 独立发布和默认引用落地顺序

构建工具生成本地候选和验证材料，默认不 push。Web base 使用独立发布命令；用户在实施中明确选择同时构建并发布新版 Core/CLI/Agent/file-helper/snapshot-helper，并更新全部 Quick Start。五角色使用现有完整候选、发布预检、真实 registry digest 和匿名核验流程，不削弱要求当前源码一致的材料门禁。

发布顺序：锁定环境与输入 -> 构建候选 -> 离线/只读/派生/真实 Service 验证 -> 推送独立固定版本 -> 读取 registry digest 并以独立无凭据客户端匿名拉取/运行 -> 固定 brain/README 引用 -> 重新构建嵌入脑包的 Go 程序并执行引用与默认种子验证 -> 构建验证五角色完整候选 -> 发布并匿名核验全部五角色 -> 同步正式 Quick Start/Compose/安装材料。候选与发布制品必须是同一环境内容，最终脑包/README 的 digest 写回不改变镜像输入，避免构建 hash 自引用。

若远端不可访问，停留在候选状态且记录实际失败，不把无法拉取的 digest 写成可用默认。镜像环境 identity 只纳入 Dockerfile、通用工具、锁文件等真实构建输入，不含事后写回的发布 receipt。

发布记录保存源码 commit/modified 状态、输入 hash、平台、工具链/锁身份、镜像本地 ID、远端 digest、实际验证结果；不保存 DockerHub 凭证。已有固定 tag 指向其他 digest 时拒绝覆盖并选新版本，不强推。

本次核验后的修复会改变基础镜像工具输入及嵌入脑包/验收源码。已发布的旧 tag、digest、匿名核验和历史成功记录继续代表旧制品；修复版须使用新固定版本重新完成相关离线、实际初始化、仅环境变化自动采用及真实 Service 验收，再沿上述顺序发布 Web base、固定新引用、构建发布同源码五角色并更新全部 Quick Start。验收记录追加两个问题的复现、修复回归和新发布身份，不回填旧通过记录或手改源码哈希绕过门禁。

### 7. 文件与验证职责

| 模块/文件 | 本变更职责 |
| --- | --- |
| `deploy/images/web-base/` | 长期镜像维护源：Dockerfile、受限 context/锁文件、sqlite3、通用 runner、环境清单、双语 README |
| `scripts/build-web-base.mjs`、专用验证/发布入口、`Makefile` | 本机构建、离线/派生检查、独立发布、候选/发布记录 |
| `internal/coreassets/piwork-brain/` | 默认镜像信息、自动生效认知、Skill/Reference、带版本刷新/草稿恢复的通用和工作站模板 |
| `Dockerfile.agentd`、`scripts/check-native-image-boundary.mjs` | Agent 两个 target 预装 sqlite3，验证实际 CLI/SDK bash 可用及原运行边界 |
| `internal/contracts/schemas.json`、`proto/work-services.proto`、`internal/servicemcp/tools.json` | 内存兼容范围、显式 unlimited 投影、协议生成输入 |
| `internal/servicedefinition/definition.go`、`service_accept.go` | 新默认规范化与历史幂等兼容 |
| `internal/corestore/quota.go`、`work_config_validate.go`、`snapshot_import_admission.go`、`snapshot_import_publish.go` | 有效内存预算排除 Service，保留 CPU/slots/Agent 核算 |
| `internal/coreapp/service_runtime.go`、`internal/dockerengine/resources.go` | Service 无内存限制，旧容器匹配/替换，其他 kind 原政策 |
| `internal/workpackage/`、快照 capture/metadata/import 及相关测试 | 新零值与合法旧值完整校验，历史保留、目标无 Service 限制 |
| `scripts/build-workstation-fixture.mjs`、`scripts/native-host-acceptance.mjs`、`packages/pi-adapter/src/deterministic-workstation.ts` 及相邻 fixture | 用真实 base 构建/引用替换 NiceGUI wheel fixture，调整镜像导入及 SDK 测试调用 |
| `internal/coreapp/brain_workstation_integration_test.go` 及相邻测试 | 真实 React/SDK/MCP 闭环、恢复、反馈、Memory、Package Apply 和独立导入 |
| 根 README、`deploy/docker/`、`docs/testing.md`、新的验收记录 | 双语入口与当前操作语义一致，历史记录保留 |

关键验收包括：注册表不可达首次 prepare/check/build/run；真实 Service 的 Memory=0 与较大分配；Agent/helper 限制仍有效；CPU/数量超额仍拒绝；历史请求幂等、旧预留及导入不误拒；Agent/base 两侧 sqlite3 和真实 SDK bash；用户保持页面打开时前后端修改自动采用、草稿/路径保留、失败/相同版本不重载、断线恢复不循环；新栈完整工作站回路；独立镜像派生；发布后匿名 digest 拉取。全部采用独立安装和精确标签清理，禁止全局 prune。 完整工作站验收的测试驱动总上下文使用 30 分钟，以容纳实测约 1.23 GB 完整包的三次导出、两次导入和独立反馈/候选证明；该总上下文只约束测试等待，不修改生产 Service 的 120/300 秒 readiness、Run/Goal 或快照操作的既有预算，不减少包内容或原业务断言。

## Risks / Trade-offs

- [应用 Service 不再拥有平台内存隔离上限] -> 这是用户明确选择；文档准确说明使用宿主/外层可用内存，保留实际失败日志，不宣传资源独占或虚假的可用额度。
- [Python 与 Node 加离线依赖增大镜像] -> 限定标准环境依赖和支持平台，使用分层缓存，体积/拉取耗时在验收记录实测，专用依赖放派生镜像。
- [只读根文件系统与 npm/测试工具默认写目录冲突] -> runner 显式设置可写目录，用真实 Core Service 验证，不能只做 root Docker smoke。
- [默认 CPU 下首次构建耗时超过 readiness] -> 预置离线缓存，实测默认和冷启动；在原配额允许范围内显式选择 Service CPU，不扩大 readiness 或跳过检查。
- [历史默认值导致幂等冲突或旧内存从导入复活] -> 保留原指纹和字段，覆盖旧 key、正数预留及两次导出的回归，统一有效核算。
- [脑包更新与镜像发布失配] -> 环境清单校验、发布成功后固定 digest、新 Work 真实加载与部署验收；旧 Work 明确经 Apply 采用。
- [自动重载丢失输入或在故障时循环] -> 模板恢复草稿/路径，只对已就绪的新 frontendVersion 更新；失败、相同版本与断线不 reload，浏览器回归覆盖恢复与去重。
- [base 有 sqlite3 而 AI 的执行容器没有] -> Agent/base 两处安装并分别检验；真实 SDK bash 验证替代仅查看 Service 镜像清单，旧镜像采用边界如实说明。

## Migration Plan

1. 完成契约/配额/Docker 语义与回归，不修改历史 Work 的脑包或应用。
2. 在独立安装构建含 sqlite3 的新 Agent/base 和模板候选，完成真实 SDK bash、页面保持打开期间自动生效、业务/浏览器/导入验收。
3. 发布基础镜像并验证匿名 digest 可用，固定环境清单、README 和脑包引用；重建 Go 嵌入资源并复验默认新 Work。按追加授权再构建、验证并发布五角色完整候选，匿名核验所有远端身份后更新正式 Quick Start/Compose/安装材料，当前源码哈希门禁保持不变。
4. 现有安装按正常关闭 Core、启动新 Core 的流程采用 Service 内存政策；旧有限制容器由受管恢复替换，不能直接冒充匹配。已有脑包采用继续走明确的 Package Update/Apply；旧 Agent 镜像获得 sqlite3 需选择新兼容镜像并显式 Apply，旧业务不自动迁移。新默认模板自带页面更新机制，已存在的其他应用不会被注入。
5. 失败保持真实 Operation/候选状态及原数据。回退使用保留的源码、可读存储和已发布不可变镜像；旧 Core 不一定接受新增零值定义/字段，不能承诺直接降级读取。需要降级时使用升级前停止导出的完整包恢复到独立安装，避免覆盖已提交业务事务。已发布镜像不因本地失败删除或重写。
