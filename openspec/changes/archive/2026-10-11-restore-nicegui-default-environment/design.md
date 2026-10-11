# Design

## Context

动机见 [proposal.md](proposal.md)。本设计基于当前源码，而非历史 NiceGUI 验收记录：

- `deploy/images/web-base/Dockerfile` 将 Node/npm、前端 node_modules/npm cache 和 Python wheels 放入镜像；`tools/piwork_web.py` 又为每个应用准备完整 `.venv` 和 node_modules。`run` 执行 Python/前端检查和 Vite 构建后才服务。
- 脑包当前版本为 `1.1.0`，两个模板均为 FastAPI/React。`workstation.py` 与 `piwork_protocol.py` 已将业务状态、Action/Job 和反馈协议独立出来，可以保留其职责。
- `packages/pi-adapter/src/deterministic-workstation.ts` 按前端/后端文件坐标修改并通过真实 SDK/MCP 重启和验证；`internal/coreassets/brain_test.go`、内置包升级测试明确排除 NiceGUI。现行 BRN-008、WEBBASE-001 至 WEBBASE-007、ADEP-002 和 DUL-BRAIN-001 均有旧栈约束，本 change 的四份 delta 同步替换。
- `internal/coreapp/service_runtime.go` 固定以 `10001:10001` 执行公开 Service command，`internal/dockerengine/resources.go` 设置只读根。Service MCP 没有任意 exec/build 工具；生产 `Dockerfile.agentd` 不预装 Python/pip，SDK bash 在 Agent 执行。
- 工作站长测包含三次导出、两份导入和各自后续反馈/候选验证，当前 30 分钟 driver 预算不是实际性能结果。基础环境复制会进入完整 workspace 分享，切换框架需要同时消除这部分重复。

## Goals / Non-Goals

**Goals:**

- 让未追加依赖的标准应用直接使用已安装 NiceGUI，冷 workspace 无需包注册表、CDN 或独立前端构建。
- 在同一 base 内完成额外 Python 包准备，保留精确身份、失败恢复依据和离线重建材料，沿用现有 Service 生命周期。
- 用可比执行证明准备/运行/分享开销变化，保留既有真实业务验收和无需用户手动刷新的交付行为。

**Non-Goals:**

- 不新增平台包管理服务、任意远程执行工具、Docker build/socket 权限或依赖安装 UI。
- 不重写 Agent harness、Desktop/Console 自身的 React 资源、历史分支、Work 快照格式或公共 proto/HTTP/MCP 契约。
- 不自动转换旧 Work，也不保证任意含系统库/编译要求的 PyPI 包都能在精简 base 内安装。
- 本 change 的实现与本地验收不自动执行对外发行；正式默认镜像可用性须经过下述发布衔接。

## Decisions

### 1. 原维护入口产出新契约的 NiceGUI base

保留 `deploy/images/web-base/`、`pphboy/piwork-web-base`、`dist/web-base/` 和现有构建命令，环境契约提升为 `2`，使用新的 `0.2.0` 系列固定版本。Python 继续采用当前 3.13 系列、首个平台继续为 linux/amd64；实施时选择并锁定与它兼容的 NiceGUI 精确发布版本、pip 与完整依赖，记录实际环境清单和构建输入 hash，不复制历史锁文件冒充已验证。

使用受固定 digest 约束的 Python slim 构建源，安装 NiceGUI、标准测试工具、sqlite3 CLI 和必要系统运行库；生产 Service 镜像取消 Node/npm、React/Vite 工程及其 cache。NiceGUI 的 FastAPI 等传递依赖和自带浏览器资源保留。通用工具与环境清单位于 `/opt/piwork-web-base`，继续提供 `piwork-web`；镜像不内置示例业务。

替代方案是直接沿用 NiceGUI 上游 Docker image。自有精简构建更容易固定本项目的身份、只读根、workspace 和工具契约，避免依赖上游网站示例与初始化行为；也无需为了换栈重命名全部维护路径。旧固定 tag/digest 继续存在，不覆盖不同内容。

### 2. 默认复用 base，扩展依赖才创建应用环境

默认模板的 `requirements.in` 是空的额外依赖声明；base 的完整标准锁文件保留在镜像和仓库，应用不再复制整份标准包。无额外依赖时，检查与运行直接使用镜像 Python。

有扩展依赖时，应用在 `apps/<service-name>/.deps/` 下创建基于 base Python 的 `venv --system-site-packages`，继承预装包，仅安装额外包及必要的额外传递依赖。由 base 完整锁文件生成约束，禁止悄悄覆盖固定 NiceGUI 及其基础依赖。Python 官方文档说明这一模式可以读取 system site-packages，且虚拟环境带绝对路径，不应搬动后假定可用；因此采用固定位置的版本化环境目录，并用锁定材料重建不匹配的环境。[Python venv 文档](https://docs.python.org/3.13/library/venv.html)

新增或更改依赖时，通过 Service 启动命令显式启用 `piwork-web run --install-deps`，或者在 base 内调用 `prepare --install-deps`。Pi 在 Agent 写入精确的顶层声明，通过既有 service_create/update/restart 和 Operation 观察让命令在 Service 内执行；不尝试在 Agent 调 pip 或 Docker exec。该选择是当前应用开发任务中的依赖准备，不增加人工审批步骤。

依赖准备遵循以下流程：

1. 按声明、base 固定约束、目标 Python/平台，在明确允许联网时取得所需包；本地 wheel 输入也可使用。将额外依赖的最终版本和 SHA256 写入候选 `requirements.lock`，保存可完整离线重装的 wheels；有源构建需求时只能使用 base 已有能力构建 wheel，缺工具或系统库明确失败。
2. 根据 base 环境摘要、Python/平台、声明和已解析锁定内容计算环境身份，在最终固定路径 `.deps/envs/<identity>/` 创建候选，避免重命名 venv 导致 shebang 路径失效。
3. 在同一候选环境进行完整性、依赖一致性及必要导入检查，成功后原子更新有效环境选择记录。声明、锁文件和选择记录需要一致；普通启动拒绝未完成或不匹配的候选，不静默选择旧依赖运行新代码。
4. 安装失败保留上一有效环境、锁定材料和代码/数据供恢复；不宣称旧容器一定保持运行。后续普通启动只复用或从保留 wheels 离线重建，不再次联网解析。即使定义仍带 `--install-deps`，相同已满足输入也不重复下载。

`HOME`、pip cache、TMPDIR、日志和环境目录均位于获准应用 workspace。环境更新串行化并在切换前确认输入未变化，防止并发准备相互发布不完整结果。镜像环境变化必须重新确认兼容性；不能仅因同名 `.deps` 存在而使用旧环境。

相较复制整套标准 venv，这个方案减少标准 Work 和快照体积；相较直接写全局 site-packages，它适配当前只读根和多应用独立性。需要改动 base 基础依赖或增加系统库时仍可 `FROM` 派生，但不把构建镜像设为普通 Python 包安装前置。

### 3. 保留命令入口，取消独立前端构建

`piwork-web` 提供 `prepare`、`check`、`serve`、`run` 和 `dev`，新模板不再调用 `build`：

| 命令 | 新环境中的职责 |
| --- | --- |
| prepare | 校验应用位置、选择/恢复依赖环境；仅明确安装模式允许获取缺失包 |
| check | 在选定 Python 环境运行应用测试与必要源码检查，保存与实际输入绑定的结果 |
| serve | 拒绝缺失/失配检查，启动匹配环境的 NiceGUI 应用 |
| run | 准备、缺失或失配时检查、再启动；相同输入重启复用有效检查 |
| dev | 显式 Python 重载及页面自动重新连接，排除业务数据库、cache 和环境目录 |

检查身份包含应用源码、测试与配置、依赖锁、base 环境及检查工具身份。跳过的是已经对相同输入通过的检查，不是新输入的验收。开始运行前核对检查输入，在启动中固定实际加载版本；后续查询不得读取新磁盘 marker 冒充运行版本。

普通模式关闭逐文件自动重载，Pi 完成一组修改后经原 Service Operation 启动经检查的新版本。依赖准备和应用启动继续遵守现有 readiness deadline，不通过增加新状态机或延长产品预算完成下载。

### 4. NiceGUI 页面与业务/协议共用一个 Service

通用模板和工作站采用同一布局职责：`app.py` 作为运行/路由入口，`ui.py` 实现页面，独立业务模块保持权威状态，`piwork_protocol.py` 继续承接原 `/pi/v1`、Action/Job、反馈身份与 outbox。在 NiceGUI 的应用中注册必要业务/协议路由和启动/停止回调，维持单进程和 `0.0.0.0:8080`。

```text
Agent SDK --files--> workspace/apps/<service>
    |
    +--MCP--> Core --Service command--> NiceGUI base
                                          |
                                          +--> installed standard packages
                                          +--> workspace extra environment
                                          +--> app.py / ui.py / business
                                                     |
Browser --authorized HTTP + WebSocket-----------------+
                                                     |
                                                     +--> workspace/data/<service>
                                                     +--> /pi/v1 + feedback
```

保留当前业务和协议模块已有的幂等、expectedStateVersion、查询与检查、异步 Job、来源身份及历史不重放语义；UI 调用同一业务方法，不复制一套状态。数据库使用 `data/<service-name>`。页面反馈和用户操作的可见结果由真实浏览器测试验证，不能用 HTTP health 替代 WebSocket 或 UI 检查。

`initialize.mjs` 继续唯一创建新的可写副本，先创建 Spec、拒绝所有已有目标；模板路径仍为 `web-app` 和 `workstation`。替换模板内容而不删除安全初始化边界。

### 5. 使用 Python 页面身份保持自动采用和草稿恢复

保留 `/api/runtime-version`、`codeVersion`、`frontendVersion` 和 `environmentHash` 的可查语义。`codeVersion` 覆盖应用有效源码与配置；`frontendVersion` 覆盖 `ui.py`、页面辅助代码及本地浏览器资源。两者同时包含实际 base 环境和额外依赖锁定身份；独立业务模块修改不影响页面版本，环境变化同时影响两者。

页面输入使用可扩展的显式文件清单，避免仅按四个固定文件名计算而漏掉拆分后的页面模块。运行器保留现有 `app.py`、`ui.py`、`page-client.js`、`style.css` 的默认输入（文件存在时），并读取应用根目录可选的 `page-files.json`，其中 `files` 数组列出附加页面辅助模块与本地资源的应用相对路径。两个新模板交付该清单；Pi 新增或拆分页面代码、引入资源时同步维护清单和模板 Spec，独立业务模块不加入页面清单。没有清单的现有应用继续使用默认集合，不重新初始化或自动改写源码。

版本算法对有效页面路径排序去重，绑定路径与文件内容；附加文件内容或有效文件集合变化必须改变页面版本，清单同样属于应用检查输入。清单格式错误、声明文件缺失、路径越界或符号链接明确失败，不能静默忽略或发布旧检查对应的就绪状态。业务数据、缓存和依赖环境不进入页面输入，检查、运行与页面版本查询继续共用同一算法。测试覆盖辅助模块内容、本地资源与清单增删、相同输入稳定、仅业务修改页面版本不变，以及无清单兼容和无效清单拒绝。

将当前前端 `version-client.ts` 的必要行为转换为无 React/npm 依赖的小型本地浏览器脚本，在 NiceGUI 页面中加载：同源读取实际运行版本、重连/恢复可见性后重新核对、新页面版本自动采用一次、业务版本变化重读查询。版本由已加载进程固定，不根据尚未重载的源码重算。

对模板明确支持的非秘密输入，输入变化时及时保存到该 Service origin 的 sessionStorage，记录稳定字段标识和路径，在页面重新建立后恢复；排除密码、token 等秘密字段。这样在 NiceGUI 自己因连接重建而刷新时也有恢复依据。草稿准备失败时保留输入并显示未完成，断线或检查失败不主动重载。需要验证框架原生 reconnect 与脚本同时存在时不会重复刷新或重复业务动作。

替代方案是仅依赖 NiceGUI 原生 reload/reconnect，但它本身不能作为既有草稿、路径与实际新版本采用的证明；继续要求 React HMR 又会恢复本次要移除的构建链。

### 6. 默认脑包采用新环境，旧 Work 保持捕获内容

将脑包版本从当前 `1.1.0` 提升至 `1.2.0`，同步部署 Skill、Reference、模板 SPEC/README 及 `references/web-base.json` 的环境身份。沿 `ensureBundledBrain` 现有路径更新仍为原内置来源的 catalog；保留管理员替换/禁用/移除、一次性默认选择和重复启动幂等，既有 Work 保持已捕获包，显式 Package Update/Apply 才采用新指导。

更新当前测试中旧版本/旧栈硬断言，并以完整旧 FastAPI 脑包作为隔离迁移输入验证新建/既有 Work 分离。历史 NiceGUI 包不是新版内容的权威来源，也不直接恢复历史整份实现覆盖当前 Memory、协议或权限行为。

### 7. 测量与真实验收沿现有入口进行

实施修改前用旧固定环境和当前场景取得基线，记录 image ID/digest、输入 hash、机器/Engine、镜像是否已预备、缓存和失败条件。改造 `scripts/check-web-base.mjs` 与 `check-web-base-core.mjs` 的阶段记录，在 NiceGUI 候选复测相同场景：准备/首启、同输入重启、源码更新、导出导入、workspace/快照体积和完整工作站耗时；准备镜像成本单列。

`build-workstation-fixture.mjs` 继续将实际候选变为显式验收镜像；更新 deterministic driver 的 Python 页面/业务文件坐标，不以 mock 取代 SDK 工具。标准无网络镜像检查与本地受控包注册表检查分开：后者提供合成额外包，证明明确联网安装、锁定/保留、实际导入与命令、冲突/损坏/下载失败保留、断网重启和离线重建，不依赖公网实时包版本。

长测保留反馈修复、异步原 Job 续接、Memory 采用、候选成功/加载失败/行为失败、副作用窗口恢复和两个导入副本的新反馈与新 SDK 验收项。真实 Desktop 网关测试包含 NiceGUI HTTP/WebSocket、非根路径与草稿、页面/业务/环境三种更新、失败/断线恢复及无多余 Run/Apply。不因缩短周期而删除上述覆盖；没有可比基线时只报告已观测事实。

验收记录对每项候选检查引用实际对应的日志及机器可读材料，能够核对 image ID/input hash；最终候选的发布预检使用 `publication-current-preflight.log`，原 `publication-preflight.log` 保留其旧候选事实。修复运行工具后重建候选，所需验证材料重新绑定实际新身份，不能只更新文档中的 tag/hash 或沿用旧镜像的通过记录。尚未重跑的历史检查明确标注原身份与适用范围，不转写为最终候选已通过；对外发布仍需另有明确授权。

### 8. 本地候选与正式默认引用分阶段衔接

`build-web-base.mjs` 的 inputHash 改为覆盖新的 Python 环境、锁文件、运行工具和本地页面脚本；不再引用已删除的 frontend lock。`publish-web-base.mjs` 及测试改为核对 NiceGUI 检查集合，继续绑定实际 image ID、输入 hash、版本和远端 tag 冲突，不接受旧前端检查记录作为新版证据。

本地阶段使用 `state=candidate` 的真实身份与显式 acceptance 镜像；新版脑包不得把旧 FastAPI digest 当作 NiceGUI 占位引用。正式引用尚未发布时，默认部署明确报告候选不可作为正式环境使用。本地实现/验收完成与公开默认可用是两个可辨状态。

只有后续明确要求发布，才执行推送、匿名 digest 拉取和实际运行检查，再同步正式脑包引用、镜像 release 记录及双语文档。保留原发布的 commit、dirty、input hash 和 digest，不为后续提交改写它们；Core/CLI 发布材料只在确有本次输入变化时沿原机制更新，不自动扩大为整套发行。

## Risks / Trade-offs

- [NiceGUI 依赖持续连接，页面更新可能先触发框架重载] --> 在真实受保护网关中测试重连及早保存的草稿，明确以已就绪版本为采用依据。
- [继承标准包的应用环境可能与新包冲突] --> base 完整约束与一致性检查拒绝冲突，系统库或基础版本变更由显式派生镜像解决。
- [venv 绝对路径或 Python/环境身份变化使分享副本不可直接运行] --> 使用固定容器路径、版本化环境和完整离线材料，失配时原地重建，不移动后假设可用。
- [依赖安装耗时超过 Service 就绪预算] --> 相同输入只准备一次、保留已取得材料且失败可诊断；沿原预算报告失败，不新增无限等待或自动重复 mutation。
- [替换 Service 时新环境失败导致暂时不可用] --> 保留旧环境与源码/配置恢复依据，代码恢复不承诺撤销业务事务。
- [标准依赖缩小了 workspace，但长测还有固定 Docker/业务成本] --> 分阶段记录同条件测量，准确说明改善与退步，不承诺未经实测的倍数。
- [公开默认镜像需要额外发行步骤] --> 本地候选与远端已发布身份分别记录，正式引用在实际发布验证后衔接，未发布不伪称可用。

## Migration Plan

1. 先留存旧固定环境的可比基线与旧脑包迁移夹具，再构建 contract 2 的 NiceGUI 本地候选。
2. 完成镜像、依赖安装、模板、版本采用与实际 SDK/浏览器/分享验收；将候选、原始测量和本次新验收记录交付审阅。
3. 获得后续明确发布要求后，发布新固定版本并验证匿名读取，更新正式默认引用，构建包含新版脑包的 Core。未到这一步不得报告公开默认环境交付完成。
4. Core 启动仅更新受管内置 catalog，新 Work 取得新指导；旧 Work 的升级仍由用户显式 Package Update/Apply，既有应用是否迁移是独立维护任务。
5. 回退时选择原固定包/镜像和相容源码/配置，通过既有 Service/Apply 路径验证。保留当前业务数据；不改写历史制品或声称源码回退补偿了业务事务。
