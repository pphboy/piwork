# 项目级维护实施证据

## 范围与事实来源

授权：2026-11-01 用户要求执行本 change 并提供 PR；不含主规格同步、归档或发行。实现基线 `7c2325552a6db6e6777120c24135c16e458adcd5`。本记录只覆盖项目治理责任，不代表全部 UI 或真实 Core 链通过；任务勾选由集成者在全部条件满足后完成。

- 代码：`internal/app/run_test.go` 补充三参数默认/显式值不被弃用环境键改变、三个重复键与非法输入不回显合成秘密；不改变生产默认或解析。
- 配置：现有 `internal/coreapp/docker_initialization_test.go` 的 `TestInitializationIgnoresAllLegacyModelAndImageEnvironment` 保留旧 model/image 键忽略规则；`work_config_validate_test.go` 保留非法/重复 MCP、未知 tool、失效 Service 关系负例。真实 Work Save/Apply/未来范围由 `work_configuration_scope_integration_test.go` 验证，不把解析单测冒充该链。
- 协议/生成：`scripts/check-generated.mjs` 明确 history、protobuf、HTTP、UI 四类实际输入/输出及旧格式读者。运行原生成入口前后比较字节，不依赖工作树是否 dirty，也不恢复/覆盖用户编辑来造 clean。`http` 运行既有 `make generate`；生成结果变化会失败并留下输出供审阅。冻结 prototype、历史发行记录不在输出清单。
- 文档：复用 repository-docs/quickstart/ui-language；repository-docs 增加仅本次安装的 maintenance Skill 引用检查，缺失目标与锚点有合成负例；不扫描或改写生成 OpenSpec workflow Skill。
- UI 边界：复用 ui-language 词法扫描解析静态/type-only/re-export/字面量 dynamic import/require；建立生产 source 图及共享 flat-copy 映射，检查 shared→feature、feature→entry、跨应用与循环。外部包/非字面量动态加载不由此证明；完整 view/adapter 透传、跨 owner 写入和语义内聚须 typecheck/人工审查。
- 风格：仅触达 Go/TS/JS/CSS；Go 既有 gofmt。新增 TS/JS 可词法识别的独立语句及 CSS 声明不压一行，空格缩进、无尾空格、末尾换行；保留未改历史违规，不全仓重排。生成文件与冻结原型排除；模块质量不由行数证明。
- 入口：Makefile 现有 `test` 关联 `check-maintenance` 与 `scripts/*.test.mjs`；新增选择性 `check-generated`、`check-generated-ui`、`check-style` targets。未发现/未声称执行 CI。
- 导航：`.agents/skills/piwork-code-maintenance` 安装获批候选并更新为实际 owner/source/interface/consumer/tests；AGENTS 仅短触发。依据所属类别选源，不要求全仓上下文。

## 实际执行（2026-11-01 UTC）

| 检查 | 结果与范围 |
|---|---|
| `node scripts/check-generated.mjs history` | 通过：原 SQL 生成链执行，当前/旧格式 TS 与 Go objects 输出无字节差异 |
| `node --test scripts/check-generated.test.mjs` | 2/2 通过：陈旧/缺失/多余/接口文字变化输出，冻结身份不变；这是同步机制负例，不是 Go/TS wire 执行 |
| `node scripts/check-native-boundary.mjs` | 通过：当前代码/配置/scripts/主规格平台边界 |
| `node scripts/check-repository-docs.mjs` | 通过：加入 Skill 后 60 current documents、1 migration manifest |
| `node --test scripts/check-repository-docs.test.mjs` | 5/5 通过：含新安装 Skill 失效目标/锚点负例 |
| `node scripts/check-docker-quickstart.mjs` | 通过：当前双语部署/Compose/defaults 来源一致，无修改发行身份 |
| `node --test scripts/check-docker-quickstart.test.mjs` | 30/30 通过（含嵌套测试）：配置/命令/双语/当前输入漂移、合成秘密不回显与冻结发行身份 |
| `node scripts/check-ui-language.mjs` | 通过（此时工作树） |
| `node --test scripts/check-repository-docs.test.mjs scripts/check-native-boundary.test.mjs scripts/check-ui-language.test.mjs` | 初始基线 23/23 通过，之后 docs 增加一项并单独通过 |
| Skill `quick_validate.py` | 通过 frontmatter/name/scaffold 结构，不冒充行为验证 |
| `node --check` 新三个 checker；`git diff --check` | 通过语法/空白；不代表依赖可执行 |

## 尚待集成执行，不能勾选为完成

- 早期 AST 方案曾尝试执行两个测试文件，均在加载时以 `ERR_MODULE_NOT_FOUND: typescript` 失败（0通过/2文件失败）。后续核对锁定的 TypeScript 7 native compiler 不应假设旧 JS API；未新增第二套 compiler，改为复用既有 ui-language 词法基础。此失败历史保留；当前词法依赖/风格及语言负例已26/26通过，真实依赖图通过。
- Go unit/gofmt、完整 `make generate` 的 protobuf/HTTP 与 wire/golden：当前 `go` 不是真实 Go CLI，等待 Go 1.25.5 工具准备。
- WebUI 再生成与 Go 嵌入验证：等待 UI 功能修改稳定、锁定依赖和 Go 工具。
- 真实 Work 配置范围与 Docker/Core/Agent/helper 导入导出链：当前无 Docker runtime/socket；必须在支持环境执行，不能由本脚本或 mock 代替。
- 四类维护样例（通知/导出/配置/双语命令）的实读范围、直接测试与扇出：待实际模块稳定后记录；Skill 导航本身不证明局部维护验收。

此处的环境限制是待完成条件，不是删除需求、假勾任务或豁免生产链的依据。

## 选择性维护演练：配置与双语命令

2026-11-01 本批实读并复核下列局部范围（行号随后续编辑可能移动，以符号为准）。这是维护影响判定与合成反例演练，**没有实际更改端口默认或发行命令**。

| 样例 | 本次最小源/接口读取 | 消费者与检查选择 | 范围结论 / 结果 |
|---|---|---|---|
| 调整配置默认值的影响判定；本批实际只增加保护默认值的测试 | `internal/app/run.go:52–97` 的 `parseStartup`；`run_test.go:367–407` 新默认/重复/隐私负例；`scripts/docker-quickstart-content.mjs:51–63` 的 `nativeQuickStart` | 直接消费者为 Run/start、帮助、双语 native-quickstart；选择 app unit + quickstart contract。若真的改端口，还需沿 browser/CLI 默认入口消费者扩读，不假定三文件足够完成产品默认变更 | 本批测试不改运行默认、不触及 Files/Chat/Serve；Go unit 尚未执行，不能宣称配置样例完整通过。Work Save/Apply 不因启动参数测试而要求全套真实集成；其独立范围仍保留 |
| 修正双语启动命令的维护入口 | `docker-quickstart-content.mjs:51–63`；`check-docker-quickstart.test.mjs:69–81`；对应 `deploy/docker/README{,.zh-CN}.md` 的 native-quickstart 区段与 app `parseStartup` 三参数 | 模板函数为 owner；同步两份手册，根 README 不回填教程；选择 quickstart + docs 的命令语法/双语/链接测试，不读取完整前端、不要求模型/Docker 执行 | 现有模板与两份手册一致，quickstart 30/30、docs 5/5 通过。实际本批纯文档改动是 Skill 的选择性导航与 AGENTS 链接；新失效 Skill 引用负例已证明 docs 检查失败。无生产命令/发布身份修改 |

每条样例只沿实际消费者扩读；上表不声称更改真实默认时可以不审查所有受影响调用方。全项目治理不等于本批触及全部 Go/TS、默认值、文档或运行环境。

### 独立 Skill 前向读取演练

集成代理独立执行并回传：读取 `SKILL.md` → `module-map.md` 的文档/部署行 → `scripts/docker-quickstart-content.mjs:35–77`（`nativeQuickStart` 从51行）→ `deploy/docker/README{,.zh-CN}.md` 标记区42–66 → `internal/app/run.go:32–98` 核对真实命令。选择 repository-docs、docker-quickstart 及其负例、diff-check；不要求 UI app、付费模型或 Docker 真实链。本次未改运行值。代码样例选择 run.go:32–98 / run_test.go:359起，真正默认改动须扩到 Go app unit、帮助与双语模板消费者，未声称执行 Go。由此确认渐进入口能选择相关类别，而非默认全仓读取。

### 导出布局维护样例（导出责任代理回传）

迁移基线实际读取：app.ts 1703–1724 的 exportPanel、575–579 progressText、677–680 downloadProgressMarkup、2041–2059 容器及3412–3476 handlers；export-flow.ts 1–180 的接口/状态机入口和原测试；export-admission.ts、overlay-role.ts；style.css 3186–3207。该迁移读量是提取成本，不冒充局部布局所需量。

迁移后局部布局最小读取：`export-panel.ts` 公共 `ExportPanelInput` / `ExportPanelModel` / `ExportPanelControlPort`（初稿1–43），`transferProgress` / `renderExportPanel`（初稿72起）；直接 `export-presentation.test.ts`。运行依赖3项：locale、pending、export-admission；类型依赖2项：export-flow、models。无 Files/Chat/Serve 或整份 adapter 输入。app只装配窄事实，布局修改不迫改其他功能；独立恢复入口移动仍合理涉及所属 modal/action 导航与浏览器断言，不能谎称零集成影响。

导出代理实际执行 Node24 内置类型转换的临时 dist 预检：panel 5/5、flow+admission 87/87；这是直接真实模块的预检，不是标准 tsc/typecheck、Playwright 或真实 Docker 链。后者仍待工具/环境。最终行号随格式整理变化，以符号为准，不计算未经测量 Token 节省。


### 检查实现修正与最新结果

TypeScript 7.0.2 锁定包为 native compiler；[官方 staging README](https://github.com/microsoft/typescript-go/blob/main/README.md) 说明其 API 未就绪，因此不新增 compiler 依赖、不依赖旧 createSourceFile。新增 `scanSourceTokens` 复用既有 ui-language 的字符串、模板、注释和正则跳过器，依赖边与循环算法保持；声明为词法检查而非 AST。非字面量/模板插值内动态加载、完整类型正确性与跨 owner 写入仍由 typecheck/人工审查承担。

2026-11-01 08:35 UTC：`node --test scripts/check-webui-boundaries.test.mjs scripts/check-source-style.test.mjs scripts/check-ui-language.test.mjs` 26/26 通过；含 multiline、type-only、re-export、side-effect、注释/字符串假 import、循环及 flat-shared 映射反例。`node scripts/check-webui-boundaries.mjs` 当前实际生产图通过。9个本批治理 JS 源/测试通过增量 style；UI 各 owner 尚有本批新/修改压缩行，已发送所属代理整理，没有扩大为未改历史全仓格式化。Go gofmt 仍等工具。

### 通知策略维护样例与接口人工审查

治理代理实际读取 `apps/ui-shared/notices.js` 的 `NoticeStore`（setIdentity/publish/resolve/dismiss/items/schedule/destroy）及 `notices.d.ts` 的事件与宿主接口、`notices.test.mjs`；策略无 import 依赖，直接消费为两端 app 的 NoticeStore/createNoticeHost 接线，构建消费者为两端 copy-static。只调策略不需要 Files/Chat/Serve 状态、完整 adapter 或 app；接口变化才追踪这两个装配点。共享策略的测试无需启动页面或几十个 stub。

`node --test apps/ui-shared/notices.test.mjs` 7/7 真实通过：去重含关闭后、未知不被无关成功覆盖、代次隔离、语言延迟求值、失败/未知无超时、身份撤销、原owner只读恢复。此证据不替代两端 DOM/keyboard/360px/模态与真实业务状态测试。

人工阅读新边界：work-chrome 仅接显式 identity/scope/target/permission 事实并返回模型；export-panel 接 export 只读事实；export-panel-controls 的 ExportFilePort 只含原 snapshot/transfer 查询与交付6个具名成员；feedback-policy 只投影事件；共享 notices/feedback-primitives 不 import 应用或持有业务提交锁。未发现这些新增接口透传整份 view/adapter、任意字段 setter 或展示关闭解锁逻辑。此结论限于所读新模块，不是依赖检查对全仓状态所有权的形式证明；完整 typecheck/浏览器接线与身份竞争仍待集成。

2026-11-01 08:36 UTC：`make check-maintenance` 全部通过；generated/boundary/style/i18n/docs/native/quickstart七组测试合计64/64通过，`git diff --check`通过。Desktop state责任代理4个触达文件与export责任代理5个触达文件的增量style已分别通过；Go工具、完整协议生成及真实链仍未执行。

2026-11-01 08:44 UTC：按 Administration 责任代理新增的真实直接测试入口，将 `npm run test:unit -w @piwork/console-webui` 接入现有 `make test`（由 build 前置保证 dist/browser 正式输出），并接入 `node --test apps/ui-shared/*.test.mjs`；后者实际14/14通过。没有以临时语法转换目录代替标准构建。人工读 `quick-setup-port.ts`：5个具名读/创建/绑定/Test操作，无整份adapter/context，接口导航已同步。整个 make test 尚未执行。

## 7.4 四类样例的复测量表（08:47 UTC）

以下范围已用实际源读取/符号定位复核；不是预估 Token 比例，也不是声称只读这些文件即可实施任何同名变更。旧 app 提取时的额外读量已在上方单列。

| 样例 | 此次局部必读范围（当前行号） | 实际依赖/同步扇出 | 被迫无关修改 / 检查 |
|---|---|---|---|
| 调整通知策略 | `notices.js:2–88`（NoticeStore），`notices.d.ts` 事件接口，`notices.test.mjs:1–84`；只有DOM行为变化才读宿主 `notices.js:90–149` | policy 0 import；2个app装配消费者；2个copy-static交付消费者；恢复由事件里的具名回调承接，不访问功能state | 没有 Files/Chat/Serve 读取或改写；直接测试7/7、共享总计14/14；DOM/browser另验 |
| 调整导出布局 | `export-panel.ts:8–46` 输入/输出/具名控制，`:80–120` progress与渲染；`export-presentation.test.ts:17–103` 直接模型断言，`:105–187` 浏览器布局断言 | 3 runtime import（locale/pending/export-admission）、2 erased type import（export-flow/models）；app一个装配消费者；独立手动交付控制在export-panel-controls，不因布局改动读取其完整协议 | 无 Files/Chat/Serve；从旧入口移动恢复需要所属导航与原浏览器断言，已如实记录。直接预检通过但标准构建/浏览器未过，不据此勾完整完成 |
| 调整配置默认值的维护判定 | `run.go:32–98` 帮助/parseStartup；`run_test.go:334–407` 校验/新增默认与隐私负例；`docker-quickstart-content.mjs:51–63` 默认文案消费者 | 解析直接消费者Run/start；帮助与nativeQuickStart为同步事实；实际端口改变还须沿Core/CLI默认来源扩读，不把此表当忽略消费者的许可 | 本批只增保护测试、不改默认；无UI app上下文。Go unit/gofmt未执行，**样例相关检查未完整通过** |
| 修正双语命令 | `docker-quickstart-content.mjs:51–63`；两份手册`:42–66`；`run.go:32–98`；quickstart test`:69–81` | nativeQuickStart直接消费者4个脚本文件：sync-docker-quickstart、sync-docker-website、check-docker-quickstart及其test；仓库2份手册与官网生成函数输出由同源生成；官网部署仍需另授权 | 没有UI app/真实模型/Docker运行要求；quickstart30/30、docs5/5；本次未改生产命令、未部署官网 |

因此四类选择性读取与依赖测量已具备具体证据；7.4仍不完整，阻点是相关配置Go测试/标准UI验证尚未执行，不按“文件更小”或导航存在勾选。

`check-source-style` 的 gofmt 缺失现在以精确所需动作和非零退出报告，不抛无上下文堆栈：需要经批准的 Go 1.25.5 在 PATH，再执行；未取得 Go 格式结果。新增隔离 PATH 负例真实通过，style规则单测现在5/5。

## 当前交接复核（2026-11-01 08:55 UTC）

- `make check-maintenance` 全部通过。
- 七组治理/既有负例共65/65通过（相比08:36增加缺失gofmt的非零失败诊断负例）。
- 本批触达 UI TS/JS/CSS 53文件增量style通过；`git diff --check`通过。该结果不含Go格式检查。
- `internal/app/run_test.go` 的gofmt检查仍因工具缺失而以exit1报告，尚无Go结果；新增Go测试、完整protobuf/HTTP make generate、wire/golden、标准UI构建/嵌入以及真实Core链均没有借此宣称通过。
- 未修改任务复选框、未commit/push、未同步主Spec/归档/发布。等待已请求的工具授权/可用环境后继续相关检查。

## 集成后导航与维护范围复核（2026-11-01 09:01 UTC）

本次仅更新已安装 Skill 导航与本证据，未改生产语义、任务复选框或运行Go。

新增实际边界已经定位：

- `admission-feedback.ts`：`PreferenceFeedbackFacts` → `preferenceFeedback` / `sessionFeedback` → `AdmissionFeedback`，只有 NoticeEvent 类型依赖；app 传只读事实和具名恢复，不传完整adapter/view。对应 `admission-feedback.test.ts`。
- adapter 保持偏好真实读写所有权；`preferenceRevision`、`preferenceConfirmedRevision`、`sessionReadRevision` 仅暴露只读代次，`loadPreferences` 的GET受共享 readWithDeadline 约束；`preferences-adapter.test.ts` 是直接真实adapter测试，不与原Playwright preferences.test混称。Desktop state代理已报告这4项native-transform预检通过，非标准tsc或浏览器证据。
- `feedback-notices.ts` 中实际存在的 `noticeMessage` 保存文案对象直到显示时求值，未新建feedback-message源模块；直接测试文件是 `feedback-message.test.ts`。`actionNotice` / `confirmedReadRecovery` 仍只投影 ActionRecord；新 `resultTone` 和 `notificationProjection=ledger-secondary` 是展示字段，不改变原未知锁或每路径账本责任。

四类维护样例的有意义行号变化：通知纯策略现在 `notices.js:2–96`，宿主 `:98–157`，直接策略测试 `notices.test.mjs:1–116`；其0运行时import、2个app消费者和2个copy-static消费者不变。只调显式双语文案再渐进读 `feedback-notices.ts` 的 `noticeMessage`（34行起）与 `feedback-message.test.ts`，该模块3项类型依赖、无运行时import，不需要全app/Files/Chat状态。导出布局 `export-panel.ts:8–46` 与 `:80–120`、presentation tests范围未发生实质变化；配置和双语命令源/消费者范围不变。新增admission/偏好边界不意味着普通通知布局必须读取整个adapter。

实际重新执行：生产WebUI依赖图通过；boundary/style/shared测试25/25通过（4+5+16，shared已从14更新为16）；当前触达UI59文件增量style通过；repository-docs 60文档/1manifest、Skill quick_validate、diff-check均通过。style测试包含隔离PATH的缺失gofmt非零诊断负例，不代表运行Go/gofmt成功。

集成代理报告已取得真实Desktop 360px人工检查，具体来源与范围以本change中央验收证据为准；此处不把该结果扩写为完整标准浏览器/跨端/typecheck/真实Core链通过。Go配置、完整generate/wire及其他仍缺环境的验收保持未执行，7.4不因导航复核完成而自动勾选。

## 新增功能所有者导航复核（2026-11-01 09:35 UTC）

本轮只编辑既有 maintenance module-map 与本证据，未改app/生产语义/任务勾选。已实际读取并加入原接口、运行/类型依赖和直接测试：

- `OperationFeedbackRegistry` / `operationFeedback` / `operationFeedbackSource`（operation-feedback.ts）：原已接受id/work/kind/service/generation的展示回执，1运行依赖operation-recovery、2类型依赖；不poll、不发请求、不持业务锁。直接operation-feedback.test。
- admission新增 `signInFeedback`，真实session-adapter.test验证未知登录不重放与畸形会话拒绝；preferences测试与既有Playwright项明确区分。
- `ChatRunFeedback` 与 `RunFeedbackObservations` **同在chat-run-feedback.ts**，没有run-feedback-observation.ts独立文件。0运行依赖、2类型依赖；adapter验证原Run读/事件后记录revision，app只登记UI明确接受的目标；直接chat-run-feedback/chat-run-observation-adapter测试，不扫描历史或复用Operation registry。
- `ReadFeedbackEpisodes`（read-feedback.ts）：只持展示episode和原confirmedVersion，不持请求或锁。work/settings/service-read-feedback分别用各自窄facts引用该模块；三者的直接测试实际集中在read-feedback.test.ts，没有虚构三个同名测试文件。
- file-read-feedback独立投影active Work/path与实际directory/preview事实；FileReadNoticeOwners仅weakset合并同次read展示。file-read-feedback.test验证归属/草稿/未知锁，file-directory-deadline.test另验真实adapter有界读。

最新真实执行：`make check-maintenance`全通过；七组治理负例与shared测试合计81/81通过（含shared16项）；Skill结构、docs60文档/1manifest及diff-check通过。当前UI增量style有3条新未过，均在feedback.test.ts:3316/3320/3322的同一行多语句，已通知集成者，不改其他owner文件也不宣称style全过。本轮未执行Go、正式npm构建、完整生成或真实Docker链；安装未授权/Docker缺失的阻点仍保持。


09:36复核：集成者已修复上述3处新增浏览器测试压缩行；治理代理重跑当前触达UI增量style通过（不含Go）。81项测试的组成明确为治理65 + shared16，没有重复累计两次执行。任务仍为集成者报告的14/31，本次不改复选框；Draft PR不能替代缺失正式构建/嵌入/真实链证据。

## Administration视图边界导航复核（2026-11-01 09:40 UTC）

实际读取 `src/view-scope.ts`、`test/view-scope.test.mjs`、`test/action-state-contract.test.mjs` 并核对唯一生产消费者 `app.ts` 的guard装配。导航新增只读 `ViewStamp` / `captureViewGuard`（0 import，path/load/identity/dialog快照），以及ActionState跨Users/Default Work/Skills/Packages/Runtime的写确认、回读失败、unknown原归属、替换identity账本直接契约；未将具名例外扩写为任意全adapter访问。另核对Service读取投影现有locale运行依赖并纠正索引。

本轮实际执行：`make check-maintenance`全部通过；治理65 + shared16 = 81/81通过；新增view-scope源码直接测试4/4通过；Skill quick_validate和git diff --check通过。Administration聚合105/105由所属代理报告，本轮没有重新执行该聚合或将临时转换视为正式构建。仍无Go/正式npm构建/资源嵌入/真实Docker链通过证据。本轮仅导航与证据编辑，无任务勾选、暂存或提交。

## Desktop最后一轮窄导航（2026-11-01 09:55 UTC）

实际读取About/export展示模块、diagnostic/read-origin测试及adapter/export-flow对应符号后，补入module-map：准确测试名 `about-read-feedback.test.ts`；Works错误对象+epoch来源仍属于adapter.listWorks局部，不是全局transport包装；Logs和Run/Service cleanup的headers/body deadline直接测试；原已接受Flow/log的ExportFeedbackRegistry仅持展示回执。ExportFlow可选feedbackIssue/feedbackError的读/交付错误来源明确为展示事实；正在集成的confirmDelivery handoff清理未因索引存在而声明完成或验证。

本轮实际重新执行 `make check-maintenance`、治理65+shared16（81/81）、Skill校验及diff-check均通过。功能代理报告About5、read-origin4、diagnostic6、export-feedback13通过；本轮只核对源码和测试入口，没有重新执行这些功能测试，也没有把这些报告累计进81。正式npm构建、Go/嵌入及真实Docker链仍未执行；无任务勾选、app语义修改、生成资源替代、暂存或提交。

## 依赖获准后的真实配置与生成检查（2026-11-01 12:32 UTC）

用户12:28–12:29已授权安装所需工具；集成者安装并校验官方Go1.25.5及锁定npm依赖。治理使用显式workspace Go PATH、GOTOOLCHAIN=local、CGO_ENABLED=0、workspace GOCACHE/GOPATH和-mod=readonly，不改go.mod/go.sum。以下结果取代此前“工具缺失所以未执行”的对应项，而不改写历史失败：

- `gofmt -l internal/app/run_test.go` 输出为空；无需格式改写。
- `go test -mod=readonly -json ./internal/app ./internal/distribution ./internal/contracts ./internal/rpc/... ./internal/workhistory` 成功：67个顶层测试，含子例/DTO oracle共8590条pass；两个rpc生成包无测试，不计成功测试数。包括新增默认/显式值/弃用环境/秘密不回显测试、DTO wire roundtrip与canonical descriptor及history兼容。
- coreapp配置定向测试成功：5顶层/12含子例，分别为InitializationIgnoresAllLegacyModelAndImageEnvironment、InitialWorkConfigurationRejectsUnsafeRelationships、SavedWorkConfigurationCanReferenceExistingService、DefaultWorkConfigurationMatchesPublicContract、DefaultWorkPatchPersistsSelectionWithoutChangingEarlierConfig。真实Docker-tagged Work作用域链仍未被这组单元代替。
- contracts正式 `npm run test:unit -w @piwork/contracts`（包含tsc build）49/49通过。
- history原生成器执行成功；HTTP原生成器在正式contracts build后生成238 DTO schemas及8128 TS oracle fixtures，checkGenerated字节比较无变化。
- 完整 `node scripts/check-generated.mjs http` 两次在protoc36.2官方GitHub下载的5秒proxy tunnel timeout失败，未通过完整协议生成检查；集成者正使用官方来源较长传输超时获取相同固定版本。未手改输出、替换版本或绕过安全限制。
- maintenance全套和治理65+shared16=81测试再次通过。全触达style暂发现临时compiler产出的3个src/*.js问题，已交所属集成者清理；不因Go可用而宣称全style通过。全Go unit命令仍在运行，后续单列终态。

12:35终态与修复：

- 固定protoc36.2经集成者从官方同一asset较长超时下载并核对SHA256后，完整 `node scripts/check-generated.mjs http` **通过**：history、protobuf、contracts正式tsc、HTTP全链输出字节一致。前述短超时失败保留作历史，但不再是当前生成阻点。
- 全Go标准unit命令实际运行后exit1：40 package pass、5 fail、16无测试；顶层802 pass /57 fail /1 skip，含子测试12066 pass /69 fail /1 skip。skip为SELinux宿主条件。失败不能统称Docker缺失：Unix socket创建与netlink访问返回operation not permitted，CLI子进程另有control-channel不可用/launch缺失症状；未绕过权限、改测试skip或伪报成功。
- 其中真实代码回归为 `TestSetupModuleImportsArePublicAndTyped`：官方已嵌入notices.js，却未列入setup公开精确allowlist，HTTP404。获集成者授权后仅在 `internal/webapp/server.go` 增加notices.js、feedback-policy.js、feedback-primitives.js三个实际纯模块。测试增加GET类型、HEAD/CSP以及adapter/app/model-port/未知同名前缀404，不放宽目录或鉴权。最终 `go test -mod=readonly -json ./internal/webapp` 20顶层/26含子例全部通过；完整Go失败运行的历史计数不被抹去。重新构建宿主由集成者接续。
- 全Go中已实际通过ModelHTTPTestProtocolsDraftsAndNoWrites、ModelHTTPTestErrorsBudgetsAndFailureDoesNotGateSave、DefaultWorkPatchPersistsSelectionWithoutChangingEarlierConfig、RuntimeCatalogRetainsIndependentProfileRevisions、CapturedModelIDSurvivesCurrentHeadAndLabelEdit、PreparationConfigurationSaveCancelsOldGenerationAndKeepsAdminDTO，支持模型Test非写入与未来配置隔离；不替代真实Docker Work生效链。
- 临时src JS编译产物经所属代理清理后，实际全触达增量style（112文件，含Go）通过，git diff --check通过。Go配置样例现具备正式执行证据；7.4其余UI类型/浏览器条件由集成者整体判定，此处不自动勾选。

12:36扩大脚本回归：集成者全脚本运行发现documentation-archive临时仓库夹具仅复制旧目录，AGENTS新合法Skill链接因此缺目标。仅修夹具复制并纳入合成Git快照的 `.agents/skills/piwork-code-maintenance`（含navigation），不弱化docs checker、不改真实归档/发行。随后实际执行 `node --test scripts/*.test.mjs apps/ui-shared/*.test.mjs` **165/165通过**，无skip；这是全脚本+shared总数，包含此前治理65/shared16，不能重复相加。当前113个触达文件style通过，Skill结构及diff-check通过。

12:40有限Runtime作用域补证：新增 `internal/coreapp/runtime_work_isolation_test.go`，使用既有modelManagementFixture、真实HTTP创建模型及Runtime PUT A/B、既有corestore InsertWork/InsertConfiguration/InsertContext。A之后将已捕获配置及active/desired context持久化，B之后读取实际Store验证完整Work、Configuration及context字节/image identity、配置/context行数均未改变；未来DefaultWork快照ModelRef与revision确实更新。测试不调用Docker、不伪造启动成功，不证明已有运行容器内进程行为。新测试单独运行通过，随后与既有Runtime catalog/managed selection/default patch/ModelHTTP no-write和Test failure non-gating共6顶层15含子例全部通过（-mod=readonly -count=1），gofmt/style及docs/diff检查通过。已加入局部导航，无生产语义修改。
