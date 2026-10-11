# Tasks

## 1. 留存可比基线与旧环境输入

- [x] 1.1 在改实现前，使用当前固定 FastAPI/React base 和现有工作站入口取得准备、首启、同输入重启、导出导入及完整回路耗时，记录机器/Engine、缓存条件、源码/image ID/digest/input hash 与 workspace/快照体积；将原始输出保存到 `dist/`，验证每个数字对应实际阶段，失败或不可比项明确标记（WEBBASE-009）。
- [x] 1.2 留存当前 `1.1.0` FastAPI 脑包的必要完整合成迁移输入，并在本次新验收记录中说明基线命令、场景和旧固定制品身份；验证输入可通过原包准备校验，记录不覆盖旧发布或历史验收事实（BRN-008、WEBBASE-005）。

## 2. 构建 NiceGUI base 与 Python 运行命令

- [x] 2.1 更新 `deploy/images/web-base/` 的 Dockerfile、requirements.in/lock 和 environment.json，固定兼容 Python 3.13 的 NiceGUI/pip/标准测试依赖，采用环境 contract 2 与新版本并移除 Service 镜像独立 Node/npm/frontend 资源；运行锁文件生成和 `make web-base-image`，核对非 root 身份、精确环境清单、实际输入 hash、NiceGUI 导入和 sqlite3 命令（WEBBASE-001）。
- [x] 2.2 调整 `scripts/lock-web-base.mjs`、`build-web-base.mjs`、相关测试和构建输入清单，使其不再读取 frontend lock，也不把完整基础锁复制给应用；执行对应 Node 测试，证明候选绑定所有新 Python/工具/页面脚本输入且旧制品身份未被覆盖（WEBBASE-005、WEBBASE-006）。
- [x] 2.3 改造 `tools/piwork_web.py` 的 prepare/check/serve/run/dev，标准应用直接使用 base 环境、必要检查按有效输入复用、源码/依赖/环境变化使旧结果失效；用小型合成应用验证首次检查、相同输入重启复用、错误源码拒绝就绪和实际加载版本固定，不运行 npm 或 Vite（WEBBASE-002、WEBBASE-003）。
- [x] 2.4 将 Python-only 运行器检查接入 `scripts/check-web-base.mjs`，在断网、UID/GID 10001:10001、只读根和可写 workspace 下验证基础导入、离线本地资源、缓存/临时路径、sqlite3 及无完整基础依赖副本；核对失败检查不能被复用为 ready（WEBBASE-001 至 WEBBASE-004）。
- [x] 2.5 同步镜像双语 README 的环境契约、base 概念、命令、直接运行/派生示例及候选状态，核对互链与示例在本地候选中执行；明确 Agent 与 Service 的工具执行位置，不把候选写成已发布版本（WEBBASE-005）。

## 3. 追加 Python 依赖与持久复用

- [x] 3.1 在运行器实现空额外声明直接复用 base、显式 `--install-deps` 解析/获取、base 固定约束、额外依赖精确锁与 wheels 保留、版本化 workspace venv 和有效环境选择；通过受控合成包实际导入与 console command 验证使用同一选定环境（WEBBASE-008）。
- [x] 3.2 完成准备串行化、输入变化核对、完整性/依赖一致性检查、失败保留原有效环境及旧材料；增加冲突版本、下载失败、损坏 wheel 和并发准备的有意义失败用例，验证不发布部分候选、不改镜像标准包或业务数据（WEBBASE-008）。
- [x] 3.3 用 base 镜像和受控本地包注册表验证明确联网安装，再断开注册表验证重启/容器替换复用、删除可再生环境后的离线重建、镜像身份失配重新校验及两个应用的依赖独立性；每项核对真实导入结果和依赖身份，不以目录存在替代（WEBBASE-004、WEBBASE-008）。
- [x] 3.4 更新镜像双语依赖扩展说明，提供声明、同一 base 内 pip/准备命令、锁与本地材料位置、失败恢复和系统依赖派生边界；按文档完成一次合成包安装及断网复用，确认无需宿主 Python、root、Docker exec 或 Work 内 build（WEBBASE-005、WEBBASE-008）。

## 4. 切换模板、脑包与确定性部署路径

- [x] 4.1 将 `templates/web-app/` 改为 app.py/ui.py/独立业务模块的 NiceGUI 应用，提供单一 8080 入口、health、原 `/pi/v1`、空额外依赖声明和本地页面资源；更新模板 SPEC/README 与对应 Python 契约测试，验证 UI 与 Agent Action 共享状态和缺失 API 保留错误（WEBBASE-001 至 WEBBASE-004）。
- [x] 4.2 将 `templates/workstation/` 页面切回 NiceGUI，保留当前 workstation.py/piwork_protocol.py 的 Todo/复盘/异步导出、outbox、反馈和来源身份语义；同步 Spec、实现坐标、README 与测试，验证复盘修复 fixture、原 Action/Job 身份及历史不重放（BRN-006、ADEP-002）。
- [x] 4.3 保留 `initialize.mjs` 的共享安全入口并适配新模板文件；执行已有初始化测试和实际 SDK 重复初始化检查，覆盖已有空目录、文件、符号链接和并发目标，确认拒绝发生在 Spec/源码/注册写入及后续部署前（WEBBASE-004）。
- [x] 4.4 更新部署 Skill/Reference、脑包模板引用和包版本至 `1.2.0`，说明 NiceGUI 默认、标准环境复用、通过 Service 命令追加 Python 包、当前候选与正式引用区别；执行脑包归档/资源加载测试，确认不残留独立 React/Vite 默认要求，不移除 Pi SDK 或 NiceGUI 必要传递依赖（BRN-008、ADEP-002）。
- [x] 4.5 更新 `internal/coreassets/brain_test.go`、内置包更新/采用单元与集成测试的版本/栈断言，使用任务 1.2 留存的旧输入验证 Core 只更新原内置 catalog、新 Work 加载新指导、旧 Work/管理员定制及一次性默认选择保持；重复启动不增长无关 generation（BRN-001、BRN-008）。
- [x] 4.6 适配 `packages/pi-adapter/src/deterministic-workstation.ts`、`build-workstation-fixture.mjs` 和必要的 schema-4 验收夹具，令真实 SDK 按 Python 页面/业务坐标修改并沿原 MCP 部署；执行对应适配器测试和短部署回归，确认工具调用、原 Operation 与实际 codeVersion 匹配（ADEP-002、ADEP-003）。
- [x] 4.7 更新 `docs/piwork-brain.md`、`docs/testing.md`、根目录中英文 README 的当前默认栈、镜像入口、命令及测试材料说明；核对双语对应内容、现行源码和链接，不将旧 NiceGUI 历史记录当作本次验证依据（BRN-008、WEBBASE-005、DUL-BRAIN-001）。

## 5. 页面版本与自动采用

- [x] 5.1 将 `piwork_web_runtime.py` 和版本计算适配到 Python 页面/业务源、额外锁及实际 base 环境，固定进程加载身份；增加相同输入稳定、仅业务变化页面版本不变、页面/依赖/环境变化和 marker/未加载源码不能冒充的版本测试（WEBBASE-007）。
- [x] 5.2 提供不依赖 React/npm 的本地版本脚本并接入两个 NiceGUI 模板，完成同源版本核对、业务查询更新、页面自动采用及重连/可见性恢复；用真实浏览器核对相同版本、失败和断线无刷新循环，实际新版本只采用一次（WEBBASE-007）。
- [x] 5.3 完成模板明确支持的非秘密草稿与非根路径保存恢复，覆盖 NiceGUI 原生 reconnect/reload 与更新脚本的交互；浏览器验证草稿恢复成功、保存失败保留输入、无秘密字段持久化、无重复 Action，也不刷新 Desktop 外壳或重建未改变 iframe（WEBBASE-007）。
- [x] 5.4 完成显式 dev 模式的 Python 重载、页面重新连接及业务数据/cache/环境目录排除；真实修改页面和业务文件验证生效，修改数据库验证不触发源码重载，默认模式仍在原 Service 部署后采用（WEBBASE-003、WEBBASE-007）。
- [x] 5.5 同步两个模板 SPEC/README、部署 Skill 和镜像双语说明的页面/业务版本、自动采用及受支持草稿范围；按示例验证源码已写、运行已更新和页面已采用各自有实际依据，不要求用户手动刷新收尾（BRN-009、ADEP-002、WEBBASE-005）。

## 6. 跨组件验收与候选交付

- [x] 6.1 在最终候选上运行 `node scripts/check-web-base.mjs` 的 workstation 与 web-app 两套入口，验证离线标准应用、只读根、扩展依赖、检查失败恢复和持久化；记录实际 image ID/input hash 与 NiceGUI 检查集合，拒绝沿用旧栈的验证文件（WEBBASE-001 至 WEBBASE-008）。
- [x] 6.2 运行适配后的 `node scripts/check-web-base-core.mjs`，以真实 SDK/MCP/Core/CLI/浏览器验证 NiceGUI HTTP/WebSocket、UI/Agent 共享状态、依赖安装原 Operation、页面/业务/环境自动采用、草稿/路径、失败恢复、安全重复初始化、派生镜像及现有内存政策；核对无额外 Run/Apply（ADEP-002、ADEP-003、WEBBASE-003、WEBBASE-007）。
- [x] 6.3 运行工作站完整 brain 回路、候选成功/加载失败/行为失败及 Action 接受窗口中断回归，保留 Memory 与原 Job 续接、Work/Core 恢复及两个导入副本各自的新反馈/SDK 证明；额外验证带合成 Python 包的 stopped 导入在断网显式 Start 后可运行，不借删用例或改超时缩短周期（BRN-006、ADEP-003、WEBBASE-004）。
- [x] 6.4 运行 `scripts/native-host-acceptance.mjs` 对应 gate，核对 NiceGUI base/Agent 的工具职责、受管资源和宿主无解释器边界；执行相关 Go/TS 回归、`make build`、`make test` 及 `node scripts/check-native-boundary.mjs`，新失败按实际影响修复并保留结果（ADEP-003）。
- [x] 6.5 将当前需要变化的安装/Compose/单机示例/打包材料与双语入口一并核对，执行 `node scripts/check-docker-quickstart.mjs`、`node --test scripts/check-docker-quickstart.test.mjs` 和 `git diff --check`；确认候选不伪装成已发布新默认，未受影响的既有 Core/CLI 发布身份保留（WEBBASE-005、WEBBASE-006）。
- [x] 6.6 适配 `publish-web-base.mjs` 的验证集合与测试，证明旧栈记录、失配 image ID/input hash、未完成依赖/浏览器验证及远端 tag 冲突不能通过；交付真实本地候选与后续授权发布的衔接说明，不执行 push 或伪造 registry digest，正式默认引用仅在后续发布验证后更新（WEBBASE-006）。
- [x] 6.7 按 1.1 相同条件汇总候选各阶段耗时、workspace/快照体积与差异，新增本次验收记录并列出不可比、失败或退步项；核对覆盖未减少、资源只按本次 installation ID/精确标签清理，明确本地验证状态与公开默认镜像可用状态（WEBBASE-009）。

## 7. 处理验证发现的页面身份与证据引用问题

以下任务承接 verification.md 的 W1/S1；第 1–6 节保留此前执行事实，新增修复完成后再重新验证。

- [x] 7.1 扩展 `piwork_web.py` 的页面输入集合：保留默认入口文件，支持应用根目录 `page-files.json` 的附加相对文件列表，将辅助模块、本地资源和有效集合变化纳入 frontendVersion；无清单沿用默认集合，无效格式、缺项、越界或符号链接明确拒绝。同步两个模板的清单、SPEC/README、部署 Skill 和镜像双语说明，指导维护页面清单并保持独立业务模块与缓存/数据排除（W1，WEBBASE-007、WEBBASE-005、ADEP-002）。
- [x] 7.2 增加有意义的版本回归，覆盖 ui.py 导入辅助模块后的实际修改、本地资源内容及清单增删、稳定输入、仅业务修改页面版本不变、无清单兼容与无效输入不能复用旧检查；重建本地候选和受影响的嵌入模板程序，执行工具、双模板标准检查、扩展依赖及真实 Core/SDK/浏览器检查，在辅助模块更新场景核对实际页面自动采用、草稿/路径保留和无额外 Run/Apply。所需 validation 及 no-push 发布预检均绑定新 image ID/input hash；其他回归按实际影响选择，保留原覆盖与执行事实，不推送镜像（W1，WEBBASE-002、WEBBASE-006、WEBBASE-007）。
- [x] 7.3 将 `docs/nicegui-default-environment-acceptance.md` 的最终预检引用改为实际当前候选的 `publication-current-preflight.log`，保留旧 `publication-preflight.log`；核对候选、release、脑包引用及被引用验证材料的身份与结论一致。按 7.2 的实际结果记录新候选及已重跑范围，历史测量/未重跑检查保留原身份与适用范围；执行文档一致性、`git diff --check` 与严格 OpenSpec 校验，并重新验证 W1/S1 后更新验证结论（S1，WEBBASE-005、WEBBASE-006、WEBBASE-009）。
