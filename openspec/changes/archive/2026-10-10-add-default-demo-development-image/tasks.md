# Tasks

## 1. 内存兼容契约与默认规范化

- [x] 1.1 更新 `internal/contracts/schemas.json`、`proto/work-services.proto` 和 `internal/servicemcp/tools.json`：Service memoryBytes 默认零、合法旧正数可读，增加显式无限制投影；执行 `make generate` 并验证 DTO/proto/schema/golden 一致及负数、非整数、溢出拒绝（WSRV-002/011）。
- [x] 1.2 修改 `internal/servicedefinition/definition.go` 和 RPC/HTTP 适配，使省略/零内存均通过且默认规范化一致；以对应契约及 Core 测试证明不存在 128 MiB 补值，不放宽其他定义校验。
- [x] 1.3 在 Service 受理与原幂等路径兼容升级前省略内存的请求，保留原 scope/指纹/结果；测试旧 key 重试返回原 Service/Operation、新省略与零等价、其他字段和历史显式数值冲突仍拒绝（WSRV-003）。
- [x] 1.4 更新 deployment_context、Service 当前投影及使用这些字段的 CLI/浏览器适配，明确 unlimited 和旧预算字段范围；真实序列化/跨语言测试证明零不被描述为零可用内存，历史正数不显示为有效限制。
- [x] 1.5 在当前 Service/基础镜像文档中说明内存字段弃用兼容及有效无限制含义；核对中英文描述和公开协议一致，不删除历史字段或改写已接受回执。

## 2. 配额与导入的有效内存核算

- [x] 2.1 调整 `internal/corestore/quota.go`：应用 Service 新预留内存为零、历史内存不进入 Work/宿主有效汇总，CPU/slots 保持原子与延迟释放语义；配额测试覆盖并发、旧非零占用、Agent 内存不足及 CPU 超额仍拒绝（WSRV-007）。
- [x] 2.2 调整 `service_accept.go` 与 `work_config_validate.go`，移除 Service 内存准入，保留 Agent 内存和合计 CPU/数量检查；测试 Work 内存满足 Agent 但小于历史 Service 合计时仍可配置和创建（WCFG-SERVICE-001）。
- [x] 2.3 调整 `snapshot_import_admission.go`、`snapshot_import_publish.go` 的临时聚合预留和发布时宿主复检，在聚合前排除 Service 内存；测试历史大内存包不误拒、Agent/CPU/slots 不足仍拒绝且失败清理完整。
- [x] 2.4 调整 snapshot/`internal/workpackage` 校验以接受新零值并完整保留合法旧定义/内存来源字段；用导入映射回归证明 stopped 目标不启动、disabled/tombstone 不复活、CPU/slots 和再次导出来源记录保留（WSRV-SNAPSHOT-001）。
- [x] 2.5 同步当前资源配置和导入说明，解释 Work 内存字段的非 Service 范围及 Agent/helper 原政策；检查说明与配额测试和恢复结果一致。

## 3. Docker Service 无内存上限

- [x] 3.1 修改 `internal/dockerengine/resources.go` 和 `service_runtime.go`，仅对应用 Service 创建 Memory=0 且不补 64 MiB 或间接内存上限；Docker 参数测试同时证明 Agent/helper 继续原限制、CPU/PID/只读根/身份保持。
- [x] 3.2 处理旧受限 Service 容器的 runtime 匹配与受管替换，使恢复后真实 Memory=0；集成测试证明不错误接管旧限制容器，不新增 Service 定义/身份，不丢失 workspace。
- [x] 3.3 在独立安装经真实 HTTP 和 SDK/MCP 部署省略/零/旧正数内存定义，inspect 容器并执行超过旧 128 MiB 的有界内存分配；验证服务实际响应、CPU/数量准入仍有效，测试资源按精确 installation ID 清理。
- [x] 3.4 更新 Docker 安装/运维双语材料的 Service 内存语义与正常 Core 升级恢复方式；运行 `node scripts/check-docker-quickstart.mjs` 和 `node --test scripts/check-docker-quickstart.test.mjs`，不把本地构建误写成全部镜像已发布。

## 4. 可复用 Web 基础镜像

- [x] 4.1 在长期维护源 `deploy/images/web-base/` 建立 Dockerfile、受限 context、环境清单和锁文件，从官方来源核对并固定 Debian/Python 3.13/Node 24/FastAPI/React/TypeScript/Vite/sqlite3/测试依赖的实际版本和完整性；构建检查证明 linux/amd64、非 root、sqlite3 可直接建表/查询且环境身份正确（WEBBASE-001）。
- [x] 4.2 准备标准模板所需 Python 离线 wheel 与 npm 离线缓存，定义可写扩展目录；禁用注册表网络且删除应用依赖后，证明首次安装/测试/构建无需下载，缺少新增依赖时明确失败（WEBBASE-002）。
- [x] 4.3 新增 `scripts/build-web-base.mjs` 与 `make web-base-image`，在 `dist/web-base/` 输出真实输入身份和本地候选记录；验证默认无 push、精确输入改变会失效、context 不带 Work 数据/凭据，镜像不纳入五角色发布集合。
- [x] 4.4 编写基础镜像双语 README 的概念、环境、直接使用、FROM 派生及维护位置，明确仓库源/scripts/脑包引用/dist/DockerHub 分工并增加根 README 双语入口；按 README 构建派生应用并部署，证明通用 base 不含工作站业务，维护者可定位权威锁文件与发布入口（WEBBASE-001/005）。
- [x] 4.5 在 `Dockerfile.agentd` 公共 runtime 为 production/acceptance 预装固定 sqlite3 CLI，更新 `scripts/check-native-image-boundary.mjs` 与当前工具说明；分别验证非 root、只读根下的版本/合成 workspace 查询，构建新 Agent 镜像并由真实 SDK bash 完成建表/写入/JSON 查询，证明仅 Service 有命令不能替代 Agent 验收且宿主无新依赖（RUNTIME-TOOLS-SQLITE-001）。

## 5. 离线命令、启动与只读运行

- [x] 5.1 实现 `piwork-web prepare/check/build/serve/run`，显式设置 HOME/TMPDIR/依赖/缓存/输出到应用 workspace；以 UID/GID 10001:10001、只读根文件系统的实际运行证明准备、测试、构建可用且 Agent 可编辑生成文件（WEBBASE-002/004）。
- [x] 5.2 使 checks 结果持久可读、失败返回真实非零，前端构建成功后才发布对应产物和启动；失败用例证明不启动旧页面冒充本次成功、不触碰真实业务数据/outbox，Service Operation 和日志可诊断。
- [x] 5.3 完成 FastAPI 单端口 8080 的静态资源、SPA 页面回退、API/协议/health 路由边界；浏览器和 HTTP 测试覆盖直接刷新业务路由、同源 API、未知 API 真实 404、前端产物缺失不能就绪（WEBBASE-003）。
- [x] 5.4 实现显式 dev 模式的前后端启动、前端 Fast Refresh、后端源码重载、端口代理与信号/退出处理；经真实授权入口验证前后端修改无需手动刷新/重启、HMR WebSocket/停止撤销有效且无遗留进程，数据/缓存写入不触发重载，不关闭 Host/CORS 校验。
- [x] 5.5 补齐基础镜像双语 README 的命令、自动生效/刷新、sqlite3、workspace、依赖扩展、只读身份、数据持久化和故障说明；执行文档默认/开发命令，证明重复初始化拒绝覆盖、正常启动保留内容，区分应用自动刷新与脑包显式 Apply。核验时因重复初始化路径可覆盖已有文件重新打开；现由 10.1/10.2 的实际入口与回归补齐，不以普通重启替代重复初始化反例。
- [x] 5.6 在通用/工作站模板后端提供 `/api/runtime-version`，仅报告实际已加载的 codeVersion、frontendVersion 和 ready，前端嵌入真实自身版本且 HTML/版本响应不缓存；测试旧进程/失败构建/只有磁盘 marker 更新不能谎报新版，版本 hash 无自引用且无平台凭据泄漏（WEBBASE-007）。
- [x] 5.7 实现模板前端的同源版本检查、编辑时持续保存及初始化恢复草稿/路径、去重和后端版本变化的数据重读接口；浏览器测试证明新前端自动采用、后端单独更新自动显示新结果，实际重启/页面重建仍保留草稿，断线/相同版本/失败不循环 reload，恢复可见后自动跟进，Desktop iframe/外壳不因普通轮询被强刷。

## 6. Brain 默认环境与工作站模板

- [x] 6.1 增加脑包通用 `templates/web-app/` 起点，使用与 base 匹配的锁定环境、版本刷新/草稿恢复及必要 Service/反馈接口；验证标准模板可离线构建运行、自动采用新版且环境清单匹配，修改模板副本不改变冻结包。
- [x] 6.2 将 `templates/workstation/` 改为 FastAPI backend 和 React frontend，复用业务逻辑/协议 helper 并去除 NiceGUI 依赖；保留 Query/Action/Job、预期版本、幂等、outbox 和反馈安全，后端及前端测试证明相同业务结果和状态（BRN-008）。
- [x] 6.3 更新 `deploy-work-service` Skill/Reference、service-contract 及模板 README，默认选用 base 并显式调用 runner/checks，说明修改后自动部署/版本验证、页面更新、Agent/base sqlite3 执行位置及仓库维护入口；包资源测试证明指导实际加载，其他栈/已有应用/第三方不被强制转换。
- [x] 6.4 更新 `packages/pi-adapter/src/deterministic-workstation.ts` 及引用旧 fixture 的 kanban/相关验收路径，使用真实 SDK 写模板和调用 Service MCP；确认工具执行/测试结果不是 fixture 直接改库或调用管理器伪造。
- [x] 6.5 更新 `scripts/build-workstation-fixture.mjs`、`scripts/native-host-acceptance.mjs` 的预备镜像及导入清单，移除 NiceGUI fixture 路径；在被测无解释器宿主上证明 Web 工具链与 sqlite3 各自在预定 Agent/Service 容器中而非宿主依赖，更新 `docs/testing.md` 当前说明并保留历史记录。
- [x] 6.6 在 brain Verify 原则加入“修改后使内容实际生效”的意识并路由具体步骤到部署 Skill；真实 SDK 回归证明保存文件后自动进行必要 checks/build、原 Service 更新/重启和实际新版本/业务验证，不要求用户刷新、不增加 Agent Run 或自动 Apply 脑包，失败保留真实未完成结果（BRN-009）。

## 7. 真实业务与环境分享验收

- [x] 7.1 更新 `brain_workstation_integration_test.go` 的真实浏览器操作为 React，验证 Todo/复盘反馈、自动修复、Job 续接、Evidence、Memory 后续采用及候选 Apply/实际行为成功与失败；原检查条件全部保留（ADEP-002、BRN-008）。
- [x] 7.2 在真实 Core/CLI/Service 入口测试单端口静态/页面/API 和显式 dev 模式，测量默认 CPU 下首次准备/构建及恢复耗时；在原 120/300 秒 readiness 范围验证，失败如实报告，不延长预算或跳过检查。
- [x] 7.3 验证 Work stop/start、Core 正常关闭重启、Service 重建及两份完整包独立导入后，代码/数据/锁依赖保留、Service Memory=0、新反馈独立、旧事件/Job 不重放；相邻 Memory 升级/候选/交互回归保持通过。
- [x] 7.4 新增本次验收记录，填写真实命令、环境身份、耗时/镜像体积、Agent/base sqlite3 与自动更新结果和未通过项，关联新双语使用入口；不得把历史 NiceGUI 成功替换成新栈证据，未执行项明确标识。
- [x] 7.5 经真实 Core/CLI/SDK/MCP 保持业务页面打开，在有草稿和非根路径时分别让 AI 修改前端、仅后端并交付；测试不调用 page.reload 或重新 goto，证明页面自己采用新内容、路径/草稿保留，并覆盖失败构建、断线恢复、无刷新循环及没有额外模型 Run/脑包 Apply。

## 8. DockerHub 独立发布与默认引用

- [x] 8.1 提供 base 专用发布预检/入口，检查候选身份、验证结果、平台及目标 tag 冲突，默认不推送；用合成记录测试不完整候选/不同 digest 同 tag 拒绝，更新基础镜像 README 的版本与发布说明（WEBBASE-006）。
- [x] 8.2 在实施阶段按用户要求将已验证候选推送到 `docker.io/pphboy/piwork-web-base` 的独立固定版本，记录实际 registry digest；失败保留候选状态，不覆盖已有不同内容版本；现有五角色按追加授权在 8.5/8.6 独立完成完整发行。
- [x] 8.3 用独立无凭据 registry 客户端/配置匿名拉取该 digest 并运行检查，确认与本地验收的环境内容一致；将真实远端信息和通过依据写入发布记录，不记录 DockerHub 凭据。
- [x] 8.4 发布验证通过后，将固定 tag@digest 和环境清单同步到默认 brain 与双语 README，重新构建嵌入资源；新安装默认 Work 经真实 SDK 部署该 digest，既有 Work 仍保留原包并经 Update/显式 Apply 采用，候选发布信息不进入镜像输入造成 hash 循环。

- [x] 8.5 按用户追加授权，以最终已固定 base 引用的同一源码/输入构建并验证 Core/CLI/Agent/file-helper/snapshot-helper 五角色完整候选，沿现有 collect/materials 与绑定清单的 push 预检发布；核对全部本地 image ID、源码/协议/CLI 资源及远端冲突，不单独绕过预检推送。
- [x] 8.6 匿名读取/拉取全部五角色，核对 registry digest、image ID、标签及版本；生成正式 published-materials 并同步中英文 README、Core-only Compose、单机示例、安装手册和打包清单，执行 Quick Start 两个检查入口并保留真实发布/匿名运行记录。

## 9. 最终集成核对

- [x] 9.1 执行 `make generate`、`make build`、`make test`、`node scripts/check-native-boundary.mjs` 和本变更涉及的真实 integration/native-host gate，确认生成产物可重复、宿主运行依赖边界及新默认流程一致；记录实际失败与未执行项。
- [x] 9.2 核对主 README/安装材料/维护目录/模板/发布引用一致，执行 Quick Start 两个检查入口、OpenSpec 严格校验与 `git diff --check`；验收文件证明 base 已远端可用、Service 无内存上限、两侧 sqlite3 可用、修改后无需手动刷新且当前模板/认知无 NiceGUI 依赖，检查并清理仅本次测试资源。

## 10. 核验后修复与新版交付

本节跟踪 openspec-verify-change 发现的两项偏差。此前已发布镜像及通过记录保留其实际版本与范围；5.5 的重复初始化验收在核验时重新打开，本节按实际修复与回归重新确认；其余历史勾选不作为本节修复已完成的证明。

- [x] 10.1 在脑包部署 Skill 内提供可从 Agent 现有授权 SDK bash 调用的共享安全初始化入口，供 web-app/workstation 使用；写 SPEC.md、源码或注册信息之前拒绝已有目标（空目录/文件/链接亦拒绝），以独占创建或等效方式阻止并发覆盖。首次初始化先落必要 Spec、保留执行位及可写副本，失败不清除已有应用/数据；单元测试覆盖首次成功、重复拒绝、内容保持和并发/链接目标（WEBBASE-004、ADEP-002）。
- [x] 10.2 更新部署 Skill/Reference、两模板 README、基础镜像双语手册及 deterministic-workstation 的实际 SDK 部署路径，共用 10.1 入口，删除先覆盖 SPEC.md 再 cp -R 的初始化顺序；driver 遇到初始化失败真实收尾，不继续 create/update/restart。真实 SDK 回归在首次初始化后修改 Spec/源码/锁并写入合成业务数据，重复调用失败且内容、原 Service/Operation 身份保持；随后普通重启仍保留内容，补齐 5.5。
- [x] 10.3 修复 deploy/images/web-base/tools/piwork_web.py 的版本组合，使实际镜像环境摘要进入 codeVersion/frontendVersion，统一 checks/build/serve 和 bundle/后端加载身份；单元回归证明相同输入稳定、仅环境改变两版本变化、仅后端修改不变前端版本、marker/生成产物不构成自引用或冒充加载（WEBBASE-007）。
- [x] 10.4 扩展真实 Core/CLI/浏览器验收，在应用源码/锁不变时经原 Service 流程切换两个实际环境身份不同的受管镜像并成功交付；不手动 goto/reload，证明已打开非根页面自动采用新 bundle 一次并保留草稿/路径，不新增被动 Run/Apply。保留两模板离线、前端修改、仅后端修改、失败构建及断线恢复回归，不只改 marker 或模拟版本响应替代实际环境变化。修正 Desktop 在同 Service/端口暂时 Starting 时移除已开 iframe 的路径，补浏览器回归证明原文档保留、恢复后由应用自己采用版本；首次打开未就绪、停止/停用/删除及权限失效仍保持原边界，重新构建嵌入宿主资源。
- [x] 10.5 为修复后的 Web base 构建新固定候选，重新完成离线/只读/标准模板/派生/真实 SDK Service 及本节回归，沿专用预检推送并匿名拉取核对新 digest；保留旧固定版本和旧验收事实，验证通过后更新 brain 固定引用与双语手册，重建并验证全新默认 Work 实际部署新 digest。
- [x] 10.6 按既有发布授权，以修复后最终源码及新 base 引用构建验证 Core/CLI/Agent/file-helper/snapshot-helper 五角色完整候选，沿绑定清单预检发布并匿名执行版本核验；重新生成 published-materials，同步全部 Quick Start/Compose/双语安装材料和打包清单，保留当前源码哈希门禁，不覆盖旧固定 tag。
- [x] 10.7 对最终修复源码执行相关单元/契约/脚本、make generate/build/test、native boundary/image boundary 和受影响的真实 SDK/浏览器/工作站/导入/native-host gate；更新验收记录中的问题复现、实际修复回归与新发布身份，明确未执行项，保留旧记录范围。完成 Quick Start 两入口、OpenSpec 严格校验、git diff --check 与精确测试资源清理，并重新 verify 两项警告闭环后再标记本节完成。 完整工作站总测试驱动采用 30 分钟，覆盖大包多次往返；产品 readiness、Run/Goal 与各操作预算保持原值，全部业务/分享断言保留。
