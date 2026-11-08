# Tasks

按依赖顺序执行。实施任务已完成；实际候选身份、验证结果与未测范围见 [本地验收记录](evidence/local-validation.md)。第 7 组由用户随后明确的“推送”指令授权，仅发布本 Service 基础镜像。

## 1. 独立基础环境与共享依赖准备

- [x] 1.1 将现有应用额外依赖准备器抽取到 `deploy/images/web-common/`，保留 NiceGUI 的调用/目录语义并同步 Docker 构建上下文及消费者；验证：运行现有依赖工具测试及两栈输入下的精确锁定、离线重建、冲突和失败保护用例，确认只有一份权威实现。（WEBBASE-014）
- [x] 1.2 新增 FastAPI 镜像目录、Dockerfile、环境清单和完整 Python hash 锁文件，固定本地 htmx/Bootstrap 5 CSS 及来源/版本/SHA256/许可材料；验证：构建候选后核对安装版本、UID、sqlite3、无业务内容和浏览器资源完整性，在只读根下运行普通 FastAPI 合成应用。（WEBBASE-010）
- [x] 1.3 增加 Makefile 与 scripts 的锁定/构建入口、独立候选输出和发布前身份核验，全部实际输入包含共享工具及 vendor；验证：针对单文件内容变化、缺失资源、旧候选检查记录和发布状态伪造的负例测试失败，真实候选的 commit/dirty/input hash/image ID 可核对，不执行外部推送。（WEBBASE-015）
- [x] 1.4 在新镜像目录交付互链的双语 README，并同步原镜像目录的并列入口；验证：按文档执行通用启动/FROM 合成用例，核对标准离线环境、额外依赖和发布边界说明与实际命令一致，运行文档链接检查。（WEBBASE-010、014、015）

## 2. 共享业务与模板安全装配

- [x] 2.1 将两份相同的工作站业务、协议及契约测试收敛到 `templates/common-workstation/`，保留业务和恢复语义，导出路径使用实际 serviceName；验证：直接运行共享业务/协议测试，覆盖原 workstation 名和其他 Service 名的真实导出文件及 Action/Job/事件结果。（BRN-017、ADEP-005）
- [x] 2.2 扩展 initializer 支持 common + 栈模板装配及 `--template fastapi-htmx`，保持原 web-app 默认、Spec 先行和独占目标，更新原直接复制模板的夹具；验证：三种初始化均得到自足可写副本，已有空目录/文件/链接、并发初始化和装配文件冲突均被正确拒绝，失败不继续部署。（WEBBASE-014、BRN-016、017）
- [x] 2.3 建立 FastAPI starter 的实际路由/业务/模板/静态文件/tests 坐标，装配 FastAPI lifespan、既有 Agent JSON 协议和单 worker Uvicorn；验证：pytest/httpx 验证能力发现、业务 Action、原 Job 查询及启停线程收尾，启动配置不隐式启用多 worker，旧 NiceGUI 业务回归通过。（WEBBASE-012、BRN-017）
- [x] 2.4 随模板交付 Spec、README、依赖声明与页面输入清单，并同步旧模板初始化说明；验证：每个 Implementation Map 条目指向实际文件/职责，模板副本离开冻结包仍可加载，不含 ORM/迁移设施或 npm 前端准备要求。（BRN-017）

## 3. 检查与运行内容一致

- [x] 3.1 实现 FastAPI 源码/页面输入枚举及版本算法，支持完整 templates/static 目录与显式附加输入；验证：覆盖增删文件、纯业务/页面/环境变化、稳定版本、缺失文件、链接/越界和生成物排除，旧 NiceGUI 清单与算法契约保持通过。（WEBBASE-011）
- [x] 3.2 实现应用级准备锁与 `.build/releases` 候选复制、检查、激活和复用，依赖环境保留在原应用根；验证：并发准备、复制/检查期间编辑、损坏副本和旧 marker 均不产生虚假 ready，同输入复用检查且不复制标准依赖。（WEBBASE-011、014）
- [x] 3.3 提供 piwork-fastapi prepare/check/run/serve，检查 Python、Jinja2 及所有约定测试目录，从实际已检查副本启动并提供 /health 与运行版本；验证：有意失败的 tests/ 用例能阻断启动，测试不触碰业务库，运行中编辑未加载的模板/include/CSS/业务源不改变旧进程内容，部署后正确采用新版本。（WEBBASE-011）
- [x] 3.4 实现当前/上一有效副本及匹配依赖的恢复依据、只回收未使用生成材料，并补充双语启动/恢复说明；验证：Service 替换、位置变化后离线重建和代码恢复保留业务数据，旧有效副本可查，普通启动不重新联网解析包。（WEBBASE-011、014）

## 4. 真实入口的页面与交互

- [x] 4.1 实现 Jinja2 完整页面、独立片段及 Bootstrap CSS 布局，提供按请求生成的 URL/context helper，覆盖静态资源、表单、hx-*、下载和导航响应；验证：路由测试覆盖前缀/根入口、深层刷新、尾斜杠和未知协议路径，模板 autoescape 正确，浏览器全部资源本地取得。（WEBBASE-010、012）
- [x] 4.2 将 htmx 表单接入共享业务方法，保留 Action ID/expectedStateVersion，展示 400/409/422 和未知结果，提供 multipart 合成检查；验证：重复提交只产生一次副作用、丢响应后按原 ID 核对、旧版本冲突和校验错误保留输入，UI 与 Agent 查询一致，上传临时写入使用 workspace。（WEBBASE-012）
- [x] 4.3 实现展示区状态轮询、读取序列/版本拒旧及查询失败恢复，稳定保留编辑区；验证：真实浏览器覆盖 Agent 修改时正在输入、请求乱序、成功提交后的旧轮询、同版本恢复、焦点与草稿保留，不新增模型 Run 或重启。（WEBBASE-013）
- [x] 4.4 实现 FastAPI 页面版本采用、草稿与路径恢复、反馈进度展示，保持每个会话/Service 独立；验证：页面修改自动采用、纯业务修改只更新查询、失败检查/断线无 reload 循环、存储失败/不可恢复输入得到保护，以及两个同时打开的 Service 不串状态。（WEBBASE-013）
- [x] 4.5 将页面运行/错误/更新行为写入模板 README 和 Spec 验收项，使用现有 Playwright 入口增加受影响页面验证；验证：表单、按钮、导航和状态反馈符合组件语义，Bootstrap CSS 不依赖未交付 JS 插件，页面成功证据来自真实入口操作。（BRN-017、ADEP-004）

## 5. brain 能力接入与采用边界

- [x] 5.1 增加 FastAPI 环境身份 Reference、按需应用指导和部署 Skill 分支，描述实际初始化、运行、版本副本及依赖执行位置；验证：真实包读取路径可达，默认请求仍指向 NiceGUI，指定 FastAPI 可取得完整指导，普通 Query/Action 不增加开发流程，未发布/不匹配环境不会被当作可用。（BRN-016、017、ADEP-004）
- [x] 5.2 更新 brain 包版本、embed 内容和包更新测试，并重建宿主程序；验证：`go test ./internal/coreassets`、相关 bundled brain 单元/集成用例与 `make build` 通过，新 Work 捕获新包，旧 Work/管理员定制保持原样，显式 Apply 后才采用新能力。（BRN-016）
- [x] 5.3 完成双语有效导航与所有运行命令/资源引用一致性维护；验证：`node scripts/check-repository-docs.mjs`、`node scripts/check-native-boundary.mjs`、`node scripts/check-docker-quickstart.mjs`、`node --test scripts/check-docker-quickstart.test.mjs` 及 `git diff --check`，确认宿主安装命令/Compose 无需改动，产品使用说明与源码一致。（WEBBASE-015、BRN-017）

## 6. 跨组件交付验证

- [x] 6.1 在现有工作站确定性 SDK driver 和集成夹具中增加 FastAPI 栈选择及浏览器适配，登记现有 integration plan/resources/prepared 输入检查；验证：新增用例出现在真实运行清单，缺失或身份陈旧的候选前置失败，沿原 runner 执行，目标子集明确报告 partial。（ADEP-005）
- [x] 6.2 执行绑定最终候选的镜像/依赖/前缀浏览器验证及 NiceGUI 默认回归；验证：离线首次运行、普通应用/FROM、只读根、额外包离线重建、失败保护、页面交互和默认模板均通过，记录精确 image ID/input hash，候选变更后重跑受影响检查。（WEBBASE-010 至 015）
- [x] 6.3 执行真实 SDK/MCP/Docker 的反馈改进、异步导出、Evidence、Memory、候选 Update/Apply/实际行为和失败恢复回路；验证：通过当前 FastAPI 应用的实际业务结果、原 Action/Job/请求身份及日志证明，覆盖 Work Stop/Start、Core 重启和副作用窗口中断，不以旧请求或旧候选结果满足断言。（ADEP-004、005）
- [x] 6.4 通过 SDK 完成纯页面修改与独立业务规则修改两个回合，并执行 Stop/Export/Import 两份副本；验证：Spec 坐标、检查、运行及页面版本变化正确，各副本显式 Start 后独立处理新反馈及采用验证，业务/依赖保持且源历史不重放。（BRN-017、ADEP-005）
- [x] 6.5 核对最终代码、锁文件、脑包、候选与验证结果身份一致，将必要验收事实归本 change、临时输出归 dist，并运行 OpenSpec 严格校验；验证：结果明确已测/未测与本地/已发布状态，正式引用在未获发布指令时保持未发布，本次不报告外部发行完成。（WEBBASE-015、ADEP-005）

## 7. 获准发布当前镜像

- [x] 7.1 核对当前候选、全部所属验收证据及远端固定 tag，提供发布前检查和冲突负例；验证：本地 preflight 和负例测试通过，保留实际 commit/dirty/input hash/image ID。（WEBBASE-015）
- [x] 7.2 推送精确候选并用无凭据配置按 digest 拉取与运行；验证：匿名拉取的 image ID 匹配候选，离线 HTTP、sqlite3、启动器和本地浏览器资源通过，保存真实发布记录。（WEBBASE-015）
- [x] 7.3 更新 brain 的正式固定引用及软件版本、双语镜像说明和本变更发布事实，重建宿主；验证：引用/发布记录/匿名结果一致，相关脑包测试、构建、文档与严格校验通过，不扩展为 Core/MicroVM/官网正式发行。（BRN-016、WEBBASE-015）

## 8. 按用户确认的简单行为修复两个 WARN

第 4 组保留首次验收时的完成事实；本组以用户随后确认的简单表单行为替代旧的失败/跨页恢复要求，历史验收不改写。

- [x] 8.1 同步 proposal/design/specs 及当前产品说明的简单表单边界，并确认 owner/消费者；验证：严格校验通过，NiceGUI 既有草稿契约不变，历史发布身份保留。
- [x] 8.2 简化 FastAPI 网页：htmx 请求互斥/按钮禁用、发送后清空、不存输入或未决提交、不自动重发，请求结束后页面升级继续；验证：真实浏览器覆盖成功、失败/超时、导航、版本更新和重复点击，更新对应回归入口及说明。
- [x] 8.3 让 run/serve 复用检查记录指向的有效副本；验证：损坏标准副本后恢复、相同输入后续不再检查/复制，非法记录/错误身份不被采用，保留旧恢复依据。
- [x] 8.4 构建新候选、更新脑包版本并执行对应单元/镜像/浏览器/真实 Core/SDK 验证；验证：最终证据绑定实际候选，原验收中仍适用的业务、导入及恢复回路保持，目标子集保留 partial。
- [x] 8.5 核对修复候选与已发布版本、记录本轮交付事实并完成相关构建/文档检查；验证：旧 tag/digest/发布记录不覆盖，新引用只在对应发布与匿名验证完成后采用，明确实际已发布/未发布状态。

## 9. 修复慢提交期间轮询提前启用按钮

范围为 FastAPI starter 的页面刷新与现有浏览器验收入口；请求状态继续由 htmx 管理，业务状态继续由 Service 管理。模板通过 brain embed 和现有更新机制交付，基础镜像输入、固定引用及部署配置不变。

- [x] 9.1 表单 HTTP 请求进行时暂停业务列表刷新，请求结束后恢复；验证：真实浏览器将提交保持超过两个轮询周期，全部业务提交按钮持续禁用、重复触发仍被丢弃，结束后列表与按钮恢复，既有输入清空及不重发行为保持。（WEBBASE-012、013）
- [x] 9.2 更新 brain 包版本及相关更新测试、重建本地宿主，记录修复证据；验证：相关 Go/工具测试、浏览器回归、文档/风格与 OpenSpec 严格校验通过，基础镜像身份保持，不把既有 SDK 子集报告冒充本轮重跑。（BRN-016、017）
