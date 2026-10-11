# 应用认知 Skill 验收

日期：2026-10-11。对应 change：`add-application-awareness`。本记录描述本地修改后的实际验证，不代表新的发行或 Fedora 部署。

## 输入与实现范围

- Git 基线 `cf48b0291c32c47357702b715d597eb7f97701c9`，工作区 modified=true；本轮内置脑包为 1.2.2。默认宿主构建报告 `0.1.0-dev`、Go 1.25.5、Linux amd64，不重标已发布 Core 0.0.4。
- Node 24.20.0、Pi SDK 0.86.1；使用独立临时安装、合成模型/业务数据及真实 Docker、Go Core/CLI、SDK 和浏览器。
- 完整五类中文认知位于 `skills/application-awareness/SKILL.md`；Brain 仅增加短路由，现有 deploy-work-service 原文保留。没有新增加载器、权限、协议、存储格式或运行依赖。
- 旧 1.2.1 输入为当前 Git 基线的完整 38 文件制品，ZIP SHA256 `e510f76cb74c8c453c9c29e5ce091d1c578d72672c7a29def4a8a901a19fb9f2`；来源见 [夹具说明](../internal/coreapp/testdata/piwork-brain-nicegui-1.2.1.md)。不是仅将新版清单版本改小的升级输入。

## 实际执行

| 检查 | 结果与证明范围 |
| --- | --- |
| Skill front matter 校验、Core 真实归档 | 通过；两个平级 Skill、五类正文/完成标准、短路由和 NiceGUI 环境材料实际交付 |
| SDK 正文读取与原 smoke，9 项 | 全部通过；真实 read 取得冻结包正文，未 Apply 的可编辑副本没有替换它；名称/描述发现与正文注入分开 |
| SDK 任务对照与复用 | 固定样本先执行 Query/Action，再读取应用认知并仅写原 Spec/业务模块；同上下文复用没有新 read。合成业务数值与修改后的模块实际运行结果均核对 |
| 禁用/空包与包间同名冲突 | 通过；不从工作区或禁用包补入认知，冲突仍按原规则拒绝，无生产加载器改动 |
| pi-adapter / agentd 单元 | 分别 18 / 104 项通过，0 失败 |
| Go coreassets / coreapp 单元 | 通过；Core 包耗时 60.883 s，包含旧 1.2.1 更新、旧制品保留、幂等、管理员选择及失败保护 |
| `make build` | 通过；harness、浏览器资源和 Go 程序构建完成，脑包随 Core 嵌入 |
| 新默认包与显式空包 Docker 回归 | 通过，20.80 s；实际 SDK 在新默认 Work 发现两个 Skill 与原四个工具，空包仍通过原协议 |
| Core 重启升级 Docker 回归 | 修正夹具后通过，45.31 s；旧 1.2.1 Work 仍加载一个 Skill/原包，原 context、数据和用户编辑源码保留；新 Work 发现两项平级 Skill |
| 既有 FastAPI 旧包升级回归 | 通过，44.39 s；共用的重启夹具仍保留旧 1.1.0 Work 的冻结内容、数据和编辑副本，并让新 Work 捕获当前包 |
| NiceGUI 主回路 | 通过；真实用户操作、Agent Action、代码自动采用与业务数据同步分别观察，无手动 reload；保留草稿/路径，新增断言确认 Agent 数据更新时焦点仍在且没有页面导航，数据 Action 未重部署或新增被动请求/Apply |
| 原生边界、Docker Quick Start | 通过；29 项合成 Quick Start 测试全部通过，已发布记录与引用未改写 |
| 本 change 严格校验、diff 空白检查 | 通过；规划与实现边界对应 |

主回路报告包含 17 类检查与 6 个显式 SDK Run 观察，checkedAt 为 `2026-10-11T05:32:52.491Z`。本次完整 `check-web-base-core.mjs` 入口及资源清理通过，后续可选依赖扩展亦通过：SDK 安装、离线重启与 Stop/Export/Import/Start 后实际依赖可用，快照 815989622 字节；合并报告为 21 类检查、8 个显式 SDK Run。后续仅验证本 change 主回路可使用已有 `--main-only` 参数，避免重复无关依赖验收。

## 规格与证据对应

| 要求 | 本轮依据 |
| --- | --- |
| BRN-002 平级路由 | 短认知与真实 SDK 工具读取，新 Skill 阅读前没有部署工具调用，原部署 Skill 正文保留 |
| BRN-010 完整认知与加载边界 | Core 归档、两个 Skill 的实际发现、SDK 返回全文与冻结文件逐字一致、可编辑副本隔离、禁用/空包/冲突及旧包保留 |
| BRN-011 交付主路径 | SDK 固定样本仅有 Query、Action、一次冻结 read 与两次受影响 Spec/源码写入，复用没有新调用；指导明示无额外设计阶段、逐项审批或无关 UI，原部署/业务检查仍执行 |
| BRN-012 业务同步 | 实际用户操作/Agent Action 的 Query 和页面观察，草稿/焦点/路径保留、不导航、不重部署、不新增被动 Run/Apply；同步失败原则的证明范围按下述限制保留 |

## 首轮失败与修正

- 新增测试初次编译分别暴露 TypeScript 自定义工具参数的 unknown 类型和 Go 包元数据版本的 JSON RawMessage 类型；已在测试中按实际类型修正，再完成构建、定向测试和整包单元测试。首轮诊断在会话工具输出中保留，后续构建日志为重跑结果。
- 第一次 Core 升级 integration 将覆盖已有脑包源码的 PUT 当作新文件创建，期望 201；实际契约返回 204。夹具现在分别严格检查新建 201 与覆盖 204；产品 HTTP 行为不变。初轮失败保留在 `core-integration.log`，定向重跑在 `core-upgrade-retest.log`，没有把整份失败批次标为通过。

## 证据与限制

本机证据位于被 Git 忽略的 `dist/application-awareness/`：`sdk-history.json` 保存合成 SDK 调用及完整消息，夹具路径替换为 `<fixture>`；`provenance.json` 保存实际 Core 二进制和 Skill 摘要、Git dirty 状态及固定测试镜像身份；其余测试/构建日志及 `core-main-validation.json` 保存真实执行结果。镜像和宿主状态不使用真实模型凭据。

确定性模型显式编排了工具调用，只证明资源发现、正文读取、SDK 分发和受控任务边界，不证明任意真实模型必定遵循五类认知。默认应用的 Query/UI 验证证明该样本的业务同步与交付行为，不将其泛化为所有技术栈或所有同步故障界面；失败/陈旧状态原则通过正文读取确认，实际应用仍需按受影响功能验证。

本轮没有真实外部模型调用、Windows 实机交互、视觉评分、性能提速对照或既有应用批量改造。现有 Work 采用新包仍需 Package Update 与显式 Apply；默认认知和元数据可见不能单独作为采用或业务完成证据。镜像、固定 base、已发布来源身份与远端 Fedora 安装没有因本次 apply 改变。

## NiceGUI 扩展复验

本节追加确认后的第 5 组实现与证据，上文保留首次 14 项的版本、运行结果和限制，不用本节结果回填历史。当前仍为未发布的脑包 1.2.2，两个平级 Skill；新增的 `application-awareness/references/nicegui.md` 属于原认知 Skill 的按需参考，不增加第三个 Skill。

| 检查 | 本轮实际结果与边界 |
| --- | --- |
| 条件 Reference 与冻结读取 | 定向 SDK 16 项通过，包含实际 read、可编辑副本隔离、普通业务不读 NiceGUI Reference，以及无浏览器/不可达/未授权/隐藏/资源失败/证据不足六类固定样本；未增加安装、权限或凭据读取工具调用 |
| 受影响 TS / Go | pi-adapter 18 项、agentd 111 项全部通过；coreassets/coreapp 通过，Core 用时 62.100 s，归档包含 Reference |
| 两个模板独立浏览器 | web-app 与 workstation 均通过现有完整入口；分别完成初始化、Python 检查、可见页面与操作、查询故障恢复及重启数据保留。prepared start 分别 6430 / 6648 ms，仅作本次运行事实，不代表性能对照 |
| 真实 Desktop Service 入口 | 通过现有 CLI 授权和 Service iframe 访问两个模板；用户操作及 Agent Action 自动呈现，沿用草稿、焦点、路径、不导航、不重部署及无被动 Run/Apply 断言 |
| Ready/200 对照 | 注入实际 `.nicegui-column/.nicegui-row` 隐藏后根节点 display=none、宽高为 0；注入遮罩后命中遮罩且试点击超时。两种情况下 Service 仍 Ready，说明后端状态不能证明 UI 可用；移除故障后原入口恢复 |
| 资源与连接证据 | 同一已授权 Desktop Service 网关入口的附加浏览器页面拦截实际 `/_nicegui/3.18.0/static/nicegui.js`，返回 503，业务 DOM 缺失并观察到浏览器错误；恢复资源后页面可见且观察到 `/_nicegui_ws/socket.io/` 连接。该对照允许修复资源后 reload，不用它证明业务数据无需刷新 |
| 两模板 Query 失败/恢复 | 实际页面已经采用代码后注入 Query 500；health 仍 200、codeVersion 不变，旧内容保留并显示可能陈旧/自动重试提示，草稿和焦点保留；故障期间 Action 成功，恢复 Query 后自动清除提示并显示新增数据，无页面刷新或重部署 |

Query 故障钩子只由测试脚本写入独立安装的夹具副本，产品模板没有故障开关。产品改动沿既有定时查询实现，异常消息不直接显示给用户。CSS 自定义类分别使用 `webapp-` 与 `workstation-` 前缀，选择器限定在各自根节点下；保留框架布局容器及原有页面结构。

规格对应：BRN-002、BRN-010、BRN-011 沿用独立路由、冻结资源与交付边界证据；BRN-012 原先缺少的 Query 失败实际页面证据由本节补充；BRN-013 由两模板类名/选择器检查与实际可见页面覆盖；BRN-014 由真实入口、Ready/200 反例及浏览器能力边界对照覆盖；BRN-015 由真实 DOM/样式/遮罩/资源/连接证据与 SDK 固定归因样本覆盖。确定性模型只能证明固定样本的读取和执行链路，不能证明任意模型的自主诊断能力。

### 失败记录与未验证项

本轮曾修正测试双未实现 `.classes()`、错误使用通用框架类名、innerText/textContent 断言差异、Playwright 隐式单页面上下文、Locator.evaluate 参数位置、故障样本新增数据后的旧条数期望，以及 Service remove 请求方法与真实 API 不一致。修正均在相应模板测试或验收夹具中，未放宽版本冲突保护、业务数据保留或用户入口要求。

另有一次真实 Desktop 首次页面加载超时，虽然后端 Ready/HTTP 正常，但未取得足以确认根因的证据。同代码的后续独立运行可继续完成页面检查；这不能证明该次超时根因已解决，也不能据此归因为架构不兼容。失败日志保留，不将失败批次写为通过。

新增安全证据位于本机被忽略的 `dist/application-awareness/nicegui/`，包括 SDK/Go/TS/构建日志、两模板浏览器结果、历次失败日志及 `page-evidence.json` 的 DOM/计算样式/尺寸、遮罩、资源状态和连接路径。该 JSON 不含 ticket/token；诊断仅使用合成数据。平台 Playwright 用于本次仓库验收，不代表任何 Work 自动拥有浏览器能力。没有新增浏览器产品工具、独立设计流程、审批门禁、自动 Apply、发行或远程部署。

最终 `--main-only` 回归完整通过（包括清理）：17 类原主回路检查、6 个显式 SDK Run，加上 `page-evidence.json` 的 8 类新增页面/故障检查。既有内存、派生镜像、Work 生命周期和 Core 正常关闭恢复断言仍通过；未重复首轮的可选依赖快照扩展。最终原生边界、Quick Start 检查及其 29 项测试通过。

本节单独的 `nicegui/provenance.json` 保存本轮实际浏览器 Core 二进制与最终宿主二进制的不同 SHA256。浏览器使用的构建之后，仅 Reference 补充了实际框架类名示例；两个模板实现相同。最终宿主已重新构建并通过最新资源归档检查，不将较早浏览器结果冒记为最终二进制的运行。首次 `provenance.json` 保持不变。
