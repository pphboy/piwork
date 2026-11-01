# Administration 实施与验收证据

本附件属于 `standardize-webui-feedback-modules`。源码基线 `7c2325552a6db6e6777120c24135c16e458adcd5`；以下不是原型通过声明，也不是任务完成清单。真实浏览器、Go 嵌入与 Core 链在实际执行前一律记为未执行。

## 责任与实现

- `apps/console-webui/src/feedback-policy.ts`：只读身份/对象/动作/代次到通知事件的投影。pending/background 不生成结果通知；恢复是具名回调，策略不写请求锁。
- `apps/ui-shared/notices.js` 为单一宿主与展示策略权威源；Console 平铺复制为浏览器模块。`app.ts` 负责装配与 modal reparent，不复制通知策略。
- `ActionState` 保留 Console 自身在途、确认、未知与关联回读语义；成功通用状态块移除，错误保留无框对象恢复。普通页级回读不插入成功条。
- `model-management.ts` 保留模型草稿、Test 版本和提交所有权；跨层只使用 `model-port.ts` 的七个具名操作及身份只读值。可靠修改确认先于关联目录回读显示；旧回调只清原提交 Key。未知修改锁按身份和模型页面保留，离开/返回不释放，显式读回再核对。
- `quick-setup-port.ts` 对外只给 readSnapshot/readModels/createModel/bindRuntime/testModel 五个具名操作；`setup-readiness.ts` 是 Quick setup 完成准入唯一谓词：status、preparation 和六组件必须 ready，且当前读取无错误。Quick setup GET 加入既有十秒 read deadline；写入不增加超时自动重放。
- 图标、三点与紧凑 Header token 由共享源提供；Admin 为 Administration/管理，Workbench 仍为真实顶栏导航。PW PNG 未改字节。

## S01–S12 实际入口与恢复映射

逐族可观察状态、当前 owner、读生命周期、协议不适用依据及测试入口见 [administration-coverage.json](administration-coverage.json)。完整来源状态名称核对 `prototype/source-coverage.json` 的 `serveFamilies`，下表不是缩小到示例。每族的读状态按实际持有的数据、错误、请求和代次分别处理；DTO 不存在的 `Operation.unknown/cancelled` 不被新增。下述测试是执行入口，尚未运行的不能作为通过证据。

| 来源 | 实际入口、状态所有者 | 原对象恢复与不变量 | 直接/浏览器验证入口 |
| --- | --- | --- | --- |
| S01 Overview | `/admin`; `app.ts`: readPage/statusPage/refreshHealth | status/readiness 与配置独立；旧 health 保留，当前失败降级，只读刷新；后台不成功 toast | `management-flow.spec.mjs` 的 S08 five states / stale Ready / polling focus；`feedback.spec.mjs` availability |
| S02 Users | `/admin/users`; app create/userActionDialog + ActionState；adapter 用户方法 | 原账号、禁用/密码危险确认；未知先 Users 读回；自身撤销优先；确认与列表回读分开 | `console.spec.mjs` user confirmation；`feedback.spec.mjs` committed create/lost reply/S03 mutation variants |
| S03 Default Work | `/admin/default-work`; app defaultDraft/defaultConflicts/saveDefaults/readback | 草稿冲突独立确认；仅提交改动；unknown 不重发；AGENTS 文件预检旧选择受版本保护 | `console.spec.mjs` default draft；`feedback.spec.mjs` Defaults newer draft/S02 AGENTS；`management-flow.spec.mjs` S11 retained nodes |
| S04 Skills | `/admin/skills[/name]`; app uploadChooser/submitSkill/catalogActionDialog + adapter.inspectSkillFiles | 原目录/名称、SKILL.md、实际 multipart；每次预检原选择版本；未知按原 Skill 查询；确认与 catalog/defaults 回读分开 | `console.spec.mjs` Skill directory；`feedback.spec.mjs` S04 add/update/toggle/remove + S02 |
| S05 Packages | `/admin/packages[/name]`; app submitPackage/packageIntent + adapter.intents | npm/Git/directory/ZIP，原 actor/source/key 幂等 Resume；acceptance 非发布；无假取消或百分比 | `console.spec.mjs` four source variants/lost acceptance；`feedback.spec.mjs` catalog changes |
| S06 Models | `/admin/models[/id]`; ModelManagement + named ModelPort | model id/ref 分开；保存/启停/删除/default 各原按钮 pending；未知锁；关联回读不重写；旧 Key 隔离 | `model-management.test.mjs`；`feedback.spec.mjs` model variants；`management-flow.spec.mjs` S10 |
| S07 Model Test | model form 与 Test details；ModelManagement/model-form | Test revision、原 target 与实际结果；失败/未运行/inflight 不统一门控 Save；不隐式保存或启停 | `model-management.test.mjs` optional Test；`feedback.spec.mjs` reason categories/stale/closed dialogs |
| S08 Runtime | `/admin/runtime`; app saveRuntime/runtimeDraft + adapter.saveRuntimeSelection | 保存影响未来 Work；配置确认与 readiness 分开；无通用 Operation；只读恢复；晚回调不清新草稿 | `console.spec.mjs` runtime reference；`feedback.spec.mjs` W3/S05/S01；`management-flow.spec.mjs` S09 |
| S09 Package Operation | `/admin/operations[/id]`; app operation/rememberedOperation/interruptedOperation + package-phase | 原 ID 串行读；中断不伪造 DTO 状态；只读 Resume observation；新提交须显式授权 | `console.spec.mjs` serial observation/R6 enum；`management-flow.spec.mjs` S13 |
| S10 About | `/admin/about`; app productInfo/readPage | 真正 build/version/notes，不虚构；刷新保留旧版本，错误可恢复 | `console.spec.mjs` About text safety；`management-flow.spec.mjs` S14 |
| S11 Quick setup model | `/admin/setup`; mounted QuickSetup own draft/revision/view/readLock | 部分模型保存与 Runtime binding 分离；unknown 只读唯一公共身份；离开/新草稿/身份阻断旧回调 | `quick-setup.spec.mjs` unknown model/runtime/late/read errors；`setup-readiness.test.mjs` |
| S12 Preparation | `/admin/setup?step=prepare`; QuickSetup snapshot/autoEnter + setup-readiness | 六组件及 status/preparation 全真；当前错误阻断；仅原有效首设意图跳转；轮询不写 | `setup-readiness.test.mjs`；`quick-setup.spec.mjs` six components / auto-enter invalidation |

### 原型外的入口

- 独立 Console `/login`：app signingIn/loginOutcomeUnknown/loginRecoverySequence；ConsoleAdapter session/read deadline。密码在原提交清理，unknown 先检查 session，不自动重复 POST。
- logout：身份撤销仍归 ConsoleAdapter；pending 附着原账号动作；失败不假称已退出。
- 初始壳：startConsole 的有界读取与两次安全重试，失败保留明确 Retry/home；首读改为骨架而非空集合。
- 独立 onboarding：`onboarding.ts` 既有读取预算/创建/手动登录/未知读回保持，公共组件与构建资产改变后须跑 `controlplane-compat.spec.mjs`、`boot-recovery.spec.mjs` 与 `language.spec.mjs`；没有将其当 Launcher 排除。

## 已执行

- `node --test apps/console-webui/test/feedback-policy.test.mjs apps/console-webui/test/setup-readiness.test.mjs`：7/7 通过（直接导入实际 TS 纯模块，含后加读错误去重）。
- 以 Node 内置 `stripTypeScriptTypes` 将实际 Console 源码转换至 `/tmp/piwork-console-syntax`：所有实施 TS 文件语法解析通过。仅语法检查，不是 tsc/typecheck 或生产构建。
- `PIWORK_CONSOLE_MODULE_DIR=/tmp/piwork-console-syntax node --test apps/console-webui/test/model-management.test.mjs`：4/4 通过（直接导入实际转换模块，窄 ModelPort，无入口源码切片/VM）。
- `PIWORK_CONSOLE_MODULE_DIR=dist/admin-ui-preflight/browser npm run test:unit -w @piwork/console-webui`（环境变量为绝对路径）：112/112 通过。使用实际源码的临时 Node 转换入口；正式 dist 默认入口待 tsc 构建。
- `node scripts/check-ui-language.mjs`：通过。
- `node scripts/check-source-style.mjs <本批 Console 文件>`：通过，只整理触达行。
- `node scripts/check-webui-boundaries.mjs`：通过（自动依赖图，不替代状态所有权人工审查）。
- `git diff --check -- apps/console-webui`：通过。

## 当前未验证 / 阻点

- 锁文件依赖安装尚待父任务确认，tsc、正式 WebUI build、Playwright 和 Go 资源嵌入尚未运行。
- 浏览器旧断言中对普通 Alert/Checked 状态条的依赖须按新行为修正并实际回归，不以静态编辑测试冒充通过。
- 历史 `quick-setup-recovery.test.mjs` 对 HEAD 和实施源码均复现 38 项中 24 通过、14 失败（缺失双语全局等 VM fixture 漂移）；已改为直接导入实际 mountQuickSetup、窄 Port 与小型 DOM surface，32/32 通过，另有 7 个真实 transport 合同测试。该测试不再读取入口源码或使用 VM；旧失败日志保留在临时 `/tmp/piwork-console-baseline-recovery.log`，不隐去基线事实。
- ModelManagement/QuickSetup 仍有既有密集格式；本次新文件采用可读多行，不能据新增文件数宣称整个 Administration 已模块化。
- 360px/宽屏 Header 实测、长中英文、模态共存、焦点、刷新节点保留和 reduced-motion 待真实浏览器执行。
- Docker/Core 真链不在上述任何模拟/纯模块测试中；不能以本附件勾选该项。

## 浏览器反馈修复

父任务真实浏览器运行源码预览（合成 HTTP，并非 Core）发现 Runtime 重试出现三个通知。现将同一身份/路由/view 的读失败按 read owner + 稳定错误码归并，陈旧内容摘要只保留无框原对象信息；成功只解除对应 read notice，未知 mutation 锁和通知保持。新增直接联测验证多次读失败只有一个通知、只读恢复不清原未知。Header 外框包括 border 为 56px 的修正已交父任务复测；中心浏览器证据由父任务维护，不在此重复宣称结果。

## 后续入口审查

- 清除四处用户/目录/技能上传确认在 `refreshConfirmed` 前后的双重 success 发布；普通页面结果不再推断并借用旧 blocked mutation owner。tracked error 已有 ActionRecord 通知时，页面只保留无框恢复。
- 独立 onboarding 接入单一 shared host；凭证未知结果保留原对象恢复和禁用提交，即使关闭 toast 也不解除；只读错误独立归并，只有完整对应读取成功才清除。已保留 identity/view 旧回调检查、写入不重放、密码清理。首读骨架，Refresh/Sign out 待定状态附着固定按钮槽。
- `controlplane-compat.spec.mjs` 新增两个实际 onboarding 源码浏览器场景：重复读取失败/关闭/重新失败/双语更新、未知登录关闭通知后的锁/只读恢复/单次写入。已语法解析；尚未运行 Playwright，不能当通过。既有 Quick setup 浏览器断言已改为 owned-feedback 与按钮 pending 槽，未删减恢复或身份要求。
- 父任务已实测 Runtime 重复失败仍一条通知、恢复后清除、旧内容保留、Header 外框 56px；合成 HTTP 浏览器证据在中心附件。
- Console clipboard 回调补充原身份/视图检查；复制完成提示采用懒翻译，失败不再使用 success toast，而是 sticky error 和当前对象 Retry。独立 Console 登录错误/限流展示改为无框 OwnedFeedback，错误通知仍由既有 ActionRecord 发布。上述补充后直接模块合集仍 55/55，增量源格式 14 个已跟踪文件通过；浏览器专属新增路径仍需实际执行。
- 360px 浏览器发现 Header 被内容撑成约 90px：已改 <=900px 两行固定布局，引用共享 96px token；展开导航悬浮，不改变 Header 高度，宽屏规则不变。账号菜单旧语言由稳定 DOM patch 跳过 subtree 导致，现 locale-change/open 时局部重绘菜单。新增实际 `language.spec.mjs` 用例验证 360px 高度/展开不变/中文菜单与选择/原账号/focus/宽屏 56px；仅语法验证，等待父浏览器复测和正式 Playwright。
- 实际 HTML 冷启动（JS 尚未执行）两模板改为共享 boot-skeleton，保留可见 data-boot-loading、CSP/watchdog 和原手动恢复标记。boot-recovery 增加 `/admin`、`/setup`、`/login` 挂起入口资源时的真实模板断言；既有 fixture CSS 改读实际构建样式。未执行浏览器，不声称冷启动验证完成。

- Model Test 详情只删除与阶段标题完全相同的本地化前缀，保留全部恢复文字；新增直接导入渲染模块的英中回归用例，当前合计 56/56。父合成浏览器已检查 360px Test unknown 模态、内部滚动、Escape、Add 仍可用且未写配置；不替代正式 Core Test。

## Draft 阶段仍有独立验证缺口

6.1 要求逐所有者直接契约测试。随后独立工作已补 Users/defaults/Skills/Packages/About/Package Operation 的实际 ConsoleAdapter 方法、实际 ActionState、实际共享 view-scope admission 直接测试；不是读取/切片 app.ts。它们证明 transport、确认/回读分离和旧回调拒绝，不能冒充 app DOM 编排的端到端证明。app 内逐页面 DOM 编排仍依赖真实入口浏览器套件，该套件尚未完整运行，因此此附件不支持宣称 6.x 完成。

Quick setup 既有 API Protocol selector（OpenAI Responses / Anthropic Messages）与手动 Base URL 保留；切换协议只更新 placeholder/help，不覆盖用户 URL。保存和 Test 使用所选 api/baseUrl；未知创建读回测试分别拒绝 api/baseUrl 不匹配。未新增 provider 功能范围。

## 独立契约补充（当前 105/105）

- 六族读请求：已确认 transport 快照在失败后保留，错误是只读可恢复且不回显任意服务端诊断；decode 后身份变化拒绝原结果。五类 Users/defaults/catalog 写入：丢失回执为 unknown、无自动重放、已知拒绝与 unknown 区分。用户创建和默认 Work PATCH 的已确认事实不因关联读取失败而丢失。
- 实际 ActionState 每族测试 confirmed + failed readback 分离、未知锁不被另一读/错误/展示文案解除、原身份清理后的晚回读不能改新 ledger；About/Operation 只读不制造写锁。
- `view-scope.ts` 为 app `currentView` 的只读事实接口：path/load/identity/dialog 与两个原有显式豁免，直接测试各事实独立改变、快照复制、豁免边界和晚结果不覆盖新草稿；不拥有请求或 HTML，不改变原 admission 语义。
- 新直接测试先失败，定位并修复 `operation(originalID)` 接受其他 operationId 的缺陷：现在使用既有 INVALID_RESPONSE，原快照保持。红测日志 `/tmp/piwork-console-operation-red.log`。
- XHR 实际上传方法测试先失败，发现 late progress 可跨身份；现在 adapter 依 epoch 阻止，app Skills/Package 回调另依原 view/dialog 拒绝。红测日志 `/tmp/piwork-console-upload-red.log`。保留真实字节进度，完成字节不表示服务端确认。ZIP Package unknown Resume 只复用原 uploadId/key/source，不重新上传；旧身份上传完成不会在新身份下提交 acceptance 请求。
- 以上模块测试使用 Node 临时实际源码转换，未使用 VM/入口提取；不能替代 tsc、实际浏览器、生产构建或真实 Core。导航新增 view-scope / action-state-contract / view-scope tests 需由集成方同步。

## 两个有限客户端证明缺口补齐（当前 112/112）

- `model-management.test.mjs` 新增 Test not-run / failed / success × Enable / Choose 六例：运行真实 ModelManagement.test/action，测试之前无写入；检查实际渲染 action button 未 disabled，然后只执行对应窄 port 动作，不影响其他配置。不是入口源码提取。
- `quick-setup-recovery.test.mjs` 新增 `a confirmed original first-setup intent enters only after its new complete readiness read`：实际 mount、一次 create + bind、挂起新的 readiness read 时不导航，读回同模型/镜像及 status+preparation+六组件 ready 后仅导航一次。使用既有 fixture/port，无生产编排改动，无新增 fake DOM。与已有 already-ready/no-intent 负例构成正负对照。
- 本轮只增测试，合计 112/112。Core 同 actor 幂等约束、既有 Work 不受 Runtime 配置影响的服务端行为仍非客户端测试所能证明；真实 Core 和正式构建/浏览器阻点继续单列。

## 12:30–12:32 正式工具链恢复后的 Console 检查

用户明确批准 Go/npm 安装后，集成方完成锁定依赖安装及 Console 正式构建/copy-static/sync-console-assets。此处实际执行：

- `npm run typecheck -w @piwork/console-webui`：tsc `--noEmit` exit 0，无新增源修复。
- `env -u PIWORK_CONSOLE_MODULE_DIR npm run test:unit -w @piwork/console-webui`：**124/124、0失败、0跳过**，默认实际 dist 导入，无临时模块路径覆盖；纯策略用例仍按既定设计直接导入实际 TS。日志 `/tmp/piwork-console-official-units.log`。
- `node_modules/.bin/playwright test --list -c apps/console-webui/playwright.config.mjs`：成功发现 8 个浏览器文件中 258 项；仅收集/解析，未启动浏览器、未运行这些用例。日志 `/tmp/piwork-console-browser-list.log`。没有重试或绕过先前 shell Chromium socket 限制。

这解除 Console tsc/正式模块 unit 的环境阻点，不等于全浏览器或真实 Core 验收。6.3 的服务端 Test/Runtime 合同可另由 Go 的现有 coreapp 单元/HTTP 测试证明；6.4 的 Native Administrator Package actor/scope 测试带 integration tag，仍须对应真实运行环境。任务勾选归集成方，本附件不自动宣称 6.x 完成。

### 12:39 S01 逐来源直接契约补齐

仅新增测试，无生产代码/构建资源变化：`adapter-feedback-contract.test.mjs` 的 Overview 四例直接导入正式 dist 的 ConsoleAdapter，验证 process healthy 与 status ready 各自保留、checks true/false/unknown，任一 GET 失败保留完整 lastHealth 且不合成 Ready，以及旧身份延迟 body 不覆盖新身份快照。正式默认入口全套 **128/128、0失败、0跳过**；命令 `env -u PIWORK_CONSOLE_MODULE_DIR npm run test:unit -w @piwork/console-webui`，日志 `/tmp/piwork-console-official-units-final.log`。增量 style 和 diff 检查通过。

据 S01–S12 映射逐族检查，6.1 的源码接入/各实际 owner 直接契约/确认修改与回读失败区分/晚回调与新 Key、草稿隔离/导航和覆盖表条款已有对应证据；Overview/About 的写入确认条款不适用，因为其所有者只读。可建议集成方按该任务字面完成 6.1；完整浏览器 DOM 状态矩阵仍明确归 8.1，不能由这 128 项或部分 CUA 代替。6.2 身份入口整链与 6.3/6.4 额外服务端约束继续分列，不因本建议被自动完成。

## 16:52 已知失败原dialog恢复与普通receipt去重

父任务在正式Console148资源、合成HTTP实际复现三种原Details缺口：Users非自己账号Disable400、Skill Disable400、npm Package Install400，关闭原dialog后notice Details都只聚焦Refresh，不能复核原错误。每种只有一次原POST，Details没有重放。Default Work另实际复现Review changed fields→Keep my draft后相同普通说明同时占main与toast；草稿保留、Save可用、零PATCH。

最小实现沿现有dialog factory：新增无运行依赖`dialog-recovery.ts`只接原identity/view与当前/已知failed/其他dialog事实、恢复/聚焦两个具名动作，不持request、File、FormData、uploadId或新intent。app仍拥有ActionRecord与业务恢复；只有原current且非pending、有error无result、非unknown/blocked记录可恢复。其他新dialog已打开时不替换它，旧Details只聚焦Close。User action恢复原不可变account/target但密码为空；catalog Remove确认重新输入；Package已知拒绝恢复继续locked并提供既有Edit as new intent，Details不创建key或发送POST。只保留canonical纯npm名称加数字semver；URL、userinfo/query/token、范围/tag、本地路径一律不作为新增恢复草稿保留，原unknown Resume权威不变。标题与错误继续按当前语言求值。

普通success/info现在只由单一notice host承接；Keep my draft从warning归回info。逐个现有resultFeedback调用检查后，保留的warning/error是确认写后读失败、会话准入、原Operation观察中断/Resume、Runtime不ready/读值不同、Defaults未保存草稿冲突、文件校验及剪贴板/连接失败恢复等独有事实，不能当普通receipt删除。已知远端失败独立factory包括既有Create user和本次User action/catalog action/uploadChooser；ModelTest保留其自己只读结果dialog，本地危险/冲突确认不是新远端任务。

正式Console typecheck/build/embed与152/152直接测试通过（包括过时record/identity/view、其他dialog隔离、pending/success不能恢复失败、npm安全保留反例）；Go webapp实际通过12.67秒，consoleassets无测试，不计测试数。新helper只由authenticated app导入，未扩张setup公开资源allowlist。对应A/B/C/D修复后实际CUA尚待父任务核验，不能以这些直接测试提前声明所有浏览器路径通过。

任务6.4另在既有Package真实phase浏览器用例追加明确断言：queued/source/prepare/validate/publish及未知future-phase都没有虚构Cancel、确定进度值或百分数；保留原真实phase/raw detail断言。仅语法/style检查通过，尚未在browser执行，不把它算入152或声称CI已有此断言。

16:53正式152资源实际CUA修复后通过（app SHA256 `850c99772b1fa5aa9468b3d1f4a7af1ba7ee5735e2af01b5231ff9312a434801`）：A Disable Details恢复原target/error；另开Create user并输入new-unsaved-draft后旧Details不替换新form/草稿。Reset credential已知400后两密码清空，关闭→Details恢复原account/error而两个DOM value长度仍0。B Skill Disable恢复原target/error。C npm fixture-package@1.0.0原拒绝恢复locked表单与Edit as new intent，点击后只开放新意图编辑而没有POST。D未解决的真实冲突仍可见；Keep draft后只有浮动普通receipt、main无重复，原草稿保持。该identity ledger精确四次POST400（disable/reset/Skill/npm），Details和new-intent动作无重放、零配置PATCH；没有创建实际账号或安装实际包。

结合此前两端真实360px、长中英文、键盘关闭/焦点返回、模态单宿主共存、通知关闭不改业务锁及此次有限factory/callsite复核，任务2.2完成，累计26/31。这个判断不把警告一概删掉，也不声称未运行的全量浏览器、真实Core或所有File输入路径通过；8.1/8.2等剩余集成条件仍独立保持。
