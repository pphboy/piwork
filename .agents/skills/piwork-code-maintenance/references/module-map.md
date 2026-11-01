# 项目维护选择性导航

先选一个类别，再沿直接消费者扩读；不要默认读取本表全部源文件。需求以当前主 Spec 加未同步的有效 change 为准；`support-bilingual-webui`、`simplify-linux-delivery` 的有效 delta 保留双语及 Linux/统一 HTTP 语义。

## 代码与配置

| 要改什么 / owner | 权威源 / 窄接口 | 直接消费者 / 同步目标 | 最小检查 / Spec |
|---|---|---|---|
| Core 启动与生命周期：`internal/app` | `internal/app/run.go` 的 `parseStartup`、`startupOptions`、`Run`；三参数缺省与校验 | `cmd/piwork-core`；帮助；`scripts/docker-quickstart-content.mjs` 的 `nativeQuickStart`；双语部署 native-quickstart | `go test ./internal/app`，`run_test.go` 默认/显式/重复/旧键/秘密负例；`node scripts/check-docker-quickstart.mjs`；`core-service-startup`、`project-maintainability` delta |
| 构建时镜像默认：distribution | `internal/distribution/defaults.go`；`scripts/native-server-defaults.mjs` 输入身份校验 | `scripts/build-go.sh`、Core 运行依赖；发布候选身份与公开镜像引用 | `go test ./internal/distribution`；`node --test scripts/check-docker-quickstart.test.mjs`；不读取真实环境/凭证、不改已发布 hash |
| Work 配置：coreapp | `internal/coreapp/work_configuration_*.go`、`work_config_validate.go`，Save 与 Apply 分开 | Desktop configuration adapter；Core runtime materialization | `work_config_validate_test.go`；涉及生效范围才运行 `TestNativeWorkConfigurationOrderingScopeAndMixedStateRecovery`（integration，真实 Engine）；`work-configuration` |
| 浏览器/CLI → Core：client | 所属 `internal/client`、`internal/webapp`、`internal/cli` 消费接口 | HTTP/身份边界，不导入 Core 存储实现 | 所属 Go unit；`check-native-boundary.mjs` + `.test.mjs`；真实 Engine 仅相关行为变化时 |
| Agent/保留 TS 包 | `apps/agentd/src` 或所属 `packages/{contracts,pi-adapter,pi-package,work-store}` 公共导出 | 按 import 追踪实际调用方，不全读 harness | 所属 workspace build/test:unit；native-boundary；对应 capability |

## 协议与生成

`Makefile generate` 与 `scripts/check-generated.mjs` 中 `generatedChains` 是执行入口和输出清单；不是新的 schema 权威源。`node scripts/check-generated.mjs history|protocol|http|ui` 先快照当前输出，再运行原生成器并比较真实字节；发现陈旧输出以失败退出并保留再生成结果供审阅，**不 reset 用户改动**。`http` 按既有 `make generate` 执行三条链。

| owner / 源 | 消费者 / 输出 | 检查 |
|---|---|---|
| `internal/workhistory/*.sql`（保留 v4/v5/v6 与当前格式） | `packages/work-store/src/*schema*.ts`、Go `*-objects.json` | `node scripts/check-generated.mjs history`；work-store unit 与 `go test ./internal/workhistory` |
| `proto/agent.proto`、`work-services.proto` | `internal/rpc/{agentv1,servicesv1}`、descriptor、contracts generated TS | `node scripts/check-generated.mjs protocol`；`go test ./internal/rpc/...`、contracts wire tests |
| HTTP 冻结基座 `internal/contracts/schemas.json` 加 `packages/contracts/src` 当前公开 schemas | `scripts/generate-http-contracts.mjs` 合并；DTO、schema、golden、history limits、SDK model catalog | `make check-generated`；`go test ./internal/contracts` 与 contracts unit；不能只手修输出；schemas.json 同时含冻结基座/生成追加，不称单一可编辑源 |
| 两端 source/catalog/public + ui-shared | 各 workspace `scripts/copy-static.mjs` → `scripts/sync-{desktop,console}-assets.mjs` → `internal/{desktop,console}assets/static` | `make check-generated-ui`；两端 typecheck/browser；`make build-go` 后实际入口/CSP/Logo；生成不触碰冻结 prototype/发行身份 |

## 文档与部署

只修文案时从目标双语段落和对应命令源读取，不要求全仓、完整模型或 Docker 真实集成。

| owner / 源 | 消费者 | 检查 / Spec |
|---|---|---|
| `scripts/docker-quickstart-content.mjs` 的 `nativeQuickStart` / `quickStart` / `singleHostReadme` | `deploy/docker/README{,.zh-CN}.md`、`examples/single-host`、Compose；外部官网需单独授权 | `node scripts/check-docker-quickstart.mjs` + `.test.mjs`，命令语法/双语/默认值/发行身份；`repository-documentation-governance` 有效 Linux delta |
| 既有 README / 使用说明的真实本地链接 | 中英入口互链、产品随包 Markdown 的所属使用者 | `node scripts/check-repository-docs.mjs` + `.test.mjs`（缺失链接/anchor/冻结字节负例）；README 不回填教程 |

## WebUI（仅 UI 任务展开）

| 要改什么 / 状态 owner | 接口与共享源 | 直接消费者 / 测试 |
|---|---|---|
| 初始setup实际公开模块入口 | `internal/webapp/server.go` 的setup精确allowlist；Console onboarding实际imports与内嵌资源为消费者 | `internal/webapp/server_test.go` 的SetupModuleImportsArePublicAndTyped沿实际生产handler逐依赖请求；SharedAssets与HEAD/CSP测试保证纯模块公开、adapter/app/model-port和未知模块仍404；新增共享import必须同步，不改成目录通配 |
| 通知展示策略；业务状态仍属发起 feature | `apps/ui-shared/notices.js` 的 `NoticeStore` / `createNoticeHost`；`notices.d.ts` 的 `NoticeEvent`（identity/object/task/generation/key/tone/message/具名recovery） | 两端 app 接线；Desktop `feedback-notices.ts` / Console `feedback-policy.ts` 各自投影业务事件；`apps/ui-shared/notices.test.mjs` 直接 import；UIL-NOTICE-001；错误/unknown 关闭不能解锁或重放 |
| Desktop 显式通知文案与结果投影 | `src/feedback-notices.ts` 的 `noticeMessage` / `actionNotice` / `confirmedReadRecovery`；仅类型依赖 LocalizedMessage、ActionRecord、NoticeEvent | app装配；`feedback-message.test.ts` 直接测试当前语言、稳定事件key、聚合失败与原账本；`ActionRecord.resultTone` / `notificationProjection=ledger-secondary` 仅展示投影，不解除 UnknownFileLocks或改变原账本所有权 |
| Desktop 会话/默认Core偏好反馈 | `src/admission-feedback.ts` 的 `PreferenceFeedbackFacts` / `preferenceFeedback` / `sessionFeedback` / `signInFeedback` / `signInActionFeedbackVisible` → `AdmissionFeedback`；仅NoticeEvent类型依赖 | app只传只读事实/具名恢复；`admission-feedback.test.ts` 直接测试未知保护、原资源确认、语言与身份隔离；真实adapter会话契约见 `session-adapter.test.ts`（原未知登录不重放、畸形会话不当作已退出）；不把会话恢复当登录重放 |
| Desktop 默认Core偏好读取与写锁 | adapter `preferenceRevision` / `preferenceConfirmedRevision` / `sessionReadRevision` 只读代次；`loadPreferences` 用共享 readWithDeadline 包住GET；private preferenceRequest及savePreferences仍唯一拥有真实读取/写入 | `preferences-adapter.test.ts` 直接真实adapter测试有界读取、保留已确认默认、身份取消不清新读取、未知写不重放；区别于既有Playwright `preferences.test.ts`。不将该功能误当CoreRuntime配置 |
| 图标/等待外观；不合并业务 ActionState | `apps/ui-shared/feedback-primitives.js`、`controls.css`、`tokens.css` | 两端 `pending.ts` 及 copy-static；各自 action-state tests、browser几何；UIL-PENDING-001 / UIL-V13-CHROME-001 |
| 导出业务推进：ExportFlows | Desktop `src/export-flow.ts` / `export-admission.ts`，`ExportPort` | adapter 窄端口；`export-flow.test.ts` / `export-admission.test.ts`；DUL-009 / DWUI-009；真实导入导出不能由单测代替 |
| 导出布局（无业务写入） | Desktop `src/export-panel.ts` 只读模型/具名控制 | app仅装配；`export-presentation.test.ts` 及 action-hierarchy 导出断言直接 import；`ExportPanelInput` / `ExportPanelModel` / `ExportPanelControlPort`，`renderExportPanel` / `renderExportRecoveryPanel`；不读取 Files/Chat/Serve 或正则切 app |
| 导出手动保存控制 | Desktop `src/export-panel-controls.ts` 的 `ExportFilePort` / `saveExportFile`，6个具名成员 | app原 snapshot/transfer recheck；`export-panel-controls.test.ts` 直接测试相同对象/过期/原ID/identity epoch；不新增全adapter依赖 |
| Work Header / Service Toolbar / scope | Desktop `src/work-chrome.ts` 的 `MenuContext` → `menuCommands`，`WorkHeaderInput` → `workHeaderModel`，显式work/service事实 → `serviceToolbarModel`（0 import） | app装配、workspace-layout；`work-chrome.test.ts` 直接测试及 browser；DUL-NAVSCOPE-001 / WMB-003 |
| 已接受Operation的展示回执 | `src/operation-feedback.ts` 的 `OperationFeedbackRegistry` / `OperationFeedbackOwner` / `operationFeedback` / `operationFeedbackSource`；1运行依赖operation-recovery（kind匹配），2类型依赖models/notices | app只登记本UI明确接受的原id/work/kind/service/generation；`operation-feedback.test.ts` 直接验证checked身份、终态、unknown优先级及notice接纳后退役。无polling/请求/业务锁，不扫描历史，不把succeeded当Work ready |
| Chat Run展示及原观察证据 | `src/chat-run-feedback.ts` 中 `ChatRunFeedback` / `ChatRunTarget` / `RunFeedbackFacts` / `RunFeedbackObservations`；0运行依赖、2类型依赖models/notices；**没有独立run-feedback-observation.ts文件** | app只登记明确UI acceptance；adapter拥有真实观察，`getRunFeedback` / `forgetRunFeedback` 查询/退役投影，经过原Work/Session/Run验证后才record确认revision；`chat-run-feedback.test.ts` / `chat-run-observation-adapter.test.ts` 直接测试，重连清error不算确认、历史不广播、unknown不重发prompt |
| 原 Chat submission 确认后的展示移交 | `src/chat-submission-feedback.ts` 的只读 `OriginalChatSubmission` / `acceptedChatSubmissionOwns`；0运行依赖，仅ActionRecord类型依赖 | app在current identity/record guard后用原key/work/session与accepted receipt精确移交；`chat-submission-feedback.test.ts`直接验证错误key/session、其他unknown不变；不是重发prompt或解锁其他操作 |
| 初始Core状态 / 已知原任务读取 | `src/bootstrap-read-feedback.ts` 的只读 `BootstrapReadFacts` / `BootstrapReadFeedback`；仅运行依赖read-feedback | app传status/known-operations的真实receipt与错误；`bootstrap-read-feedback.test.ts`直接验证失败保持、确认恢复、身份与来源隔离；adapter拥有GET/deadline/provenance，零Work失败仍沿既有works-tasks/operations入口恢复，不创造任务中心 |
| 只读失败的展示episode | `src/read-feedback.ts` 的 `ReadFeedbackFacts` / `ReadNoticeOwner` / `ReadFeedbackEpisodes.observe` → `ReadFeedbackProjection`；0运行依赖、2类型依赖locale/notices | 以下Work/Settings/Service投影复用；`read-feedback.test.ts` 直接测试原confirmedVersion变化才恢复、清error/loading结束不作成功、失败重现及语言。只持展示episode，不持请求/业务锁 |
| Works / Work状态 / Service目录读取 | `src/work-read-feedback.ts` 的 `WorkReadFacts` / `WorkReadFeedback` / `workReadMatches`；只运行依赖read-feedback | app按works/status/services传身份、work、reading/error/checkedAt；直接测试归 `read-feedback.test.ts`，不是虚构独立work-read-feedback.test；只合并匹配read，不能吞修改回读失败 |
| Work配置 / Packages / Core catalog读取 | `src/settings-read-feedback.ts` 的 `SettingsReadFacts` / `SettingsReadFeedback` / `settingsReadMatches`；只运行依赖read-feedback | app按configuration/packages/catalog-skills/catalog-packages传窄事实；`read-feedback.test.ts` 直接验证catalog与Work区分、当前confirmedVersion；不改变Save/Apply/安装协议 |
| Service入口 / cleanup读取 | `src/service-read-feedback.ts` 的 `ServiceReadFacts` / `ServiceReadFeedback` / `serviceReadMatches`；运行依赖read-feedback与locale | app显式work/service/source/port与confirmedVersion；`read-feedback.test.ts` 验证原Service/入口端口、cleanup不可变返回对象与匹配read；不重挂iframe或创建网络请求 |
| 目录 / 文件预览读取反馈 | `src/file-read-feedback.ts` 的 `DirectoryReadFeedbackInput` / `PreviewReadFeedbackInput` / `fileReadFeedback` / `fileReadOwnsAction` / `FileReadNoticeOwners`；0运行依赖、2类型依赖locale/notices | app只传当前active Work/path与实际directory/preview事实；`file-read-feedback.test.ts` 直接验证首读/旧内容/错误/恢复、路径与身份隔离、草稿/未知锁不变；`file-directory-deadline.test.ts` 另验真实adapter读取deadline，不把展示weakset当文件锁 |
| About两端读取展示 | Desktop `src/about-read-feedback.ts` 的 `AboutReadFacts` / `AboutReadFeedback`；只运行依赖read-feedback，NoticeEvent类型依赖 | app分别传local/core只读确认对象；`about-read-feedback.test.ts` 直接测试两端独立、旧确认保留与失败恢复；准确文件名不是about-feedback.test.ts |
| Works失败原始归属 | Desktop adapter `listWorks` 局部捕获与 `readFailureResource`，private WeakMap保存错误对象+epoch+实际status/works/known-operations来源 | app只合并同次原read错误展示；`read-failure-origin.test.ts` 验证HTTP/畸形返回原对象、同文案不同对象不去重、身份切换失效、mutation不标记；不是通用transport wrapper |
| Logs / Run和Service cleanup有界读取 | Desktop adapter `readLogs` / `loadTemporaryCleanups` 原GET路由与共享deadline | `diagnostic-read-deadline.test.ts` 直接真实adapter验证headers/body预算、旧诊断保留、显式GET重试；不创建后台业务操作或改变cleanup协议 |
| 原导出Flow / Logs通知回执 | Desktop `src/export-feedback.ts` 的 `ExportFeedbackRegistry` / `exportFlowNotice` / `logExportNotice` / `logExportTargetAvailable` / `logExportReadRecovered`；1运行依赖locale，2类型依赖export-flow/notices | app仅登记本页明确接受的原Flow/log；`export-feedback.test.ts` 直接测试原对象/身份/目标与展示退役；ExportFlow可选feedbackIssue/feedbackError为读失败或交付失败的展示来源，不能推进协议、解除锁或将历史任务广播；浏览器handoff仍由ExportFlows及原交付路径所有；`confirmDelivery`只按原flow/snapshot/transfer/identity的已执行浏览器handoff回执清展示失败，`transferConfirmation`只记录实际验证的原transfer，不证明物理落盘 |
| Desktop Requests / 图像草稿 | adapter.ts 的 `requestPageReads` / `loadRequests` 按 Work+Service 去重；`images.ts` 的窄 decoder / identity 草稿接口 | `request-list-adapter.test.ts` / `image-drafts.test.ts` 直接测试；Requests 读回与消息结果独立，晚图像结果不 consume 新草稿；DWUI-V13-STATE-001 |
| Hosted Quick setup | Console `src/quick-setup-port.ts` 的 `QuickSetupPort` 仅 readSnapshot/readModels/createModel/bindRuntime/testModel；`setup-readiness.ts` 的 `PreparationSnapshot` / `preparationIsReady` 纯判定 | `quick-setup.ts` feature；`quick-setup-port.test.mjs` / `quick-setup-recovery.test.mjs` / `setup-readiness.test.mjs` 直接 import；真实modelform及6组件就绪不得伪造 |
| 模型读写/Test：ModelManagement | Console `src/model-port.ts` 的 `ModelPort`：identityEpoch、readModels/create/update/setEnabled/remove/chooseForFutureWork/test；ModelWrite/ModelTestInput限定输入；modelPort实现只委托所属adapter.modelRequest | `model-management.ts` 仅接ModelPort；直接 `model-management.test.mjs`，默认装配与会话错误类型仍依赖adapter，不声称完全无adapter模块依赖；Test≠Save/Enable/Choose，未来Work语义保留；后端 `internal/coreapp/runtime_work_isolation_test.go` 通过真实Runtime HTTP保存前后比较已持久化Work/config/context与未来default快照（不等于容器生效验收） |
| Administration 原登录/退出反馈 | Console `src/login-feedback.ts` 的只读 `LoginFailurePresentation` / `retireConfirmedLoginFailure`、`signOutFailure`；运行依赖adapter的ConsoleError与locale，不接整份adapter/view | app保留原login record/account/notice，实际session GET成功且确认signed-out或同account后精确退休展示；`login-feedback.test.mjs`直接用ActionState+NoticeStore验证旧代次/其他unknown保持、退出unknown分类与同error双语切换；不决定认证或重放凭据 |
| Administration 原创建用户失败恢复 | Console `src/user-recovery.ts` 的只读 `UserRecoveryDraft` / `createUserRecovery`，仅User类型依赖 | app只登记account/role与原record/identity/view判定，Details调用既有真实表单；`user-recovery.test.mjs`直接验证不保留password/FormData、不覆盖新dialog/不同身份、不发送写入；只有具备原恢复的detached已知失败省略普通重复行，unknown/readback保留 |
| Administration 异步视图准入 | Console `src/view-scope.ts` 的只读 `ViewStamp` / `ViewGuardOptions` / `captureViewGuard`；0 import，捕获path/load/identity/dialog，不读取或修改业务状态 | 唯一生产消费者 `src/app.ts` 的视图guard装配仅传窄快照；`test/view-scope.test.mjs` 直接import源码，验证每项隔离、原快照、显式豁免仍保留route/load与晚结果不覆新草稿；不是全adapter端口 |
| Administration 表单提交/关联回读 | Console `src/action-state.ts`、`model-management.ts` 及所属功能操作 | 各自 adapter 窄方法；`feedback-policy.test.mjs` / `model-management.test.mjs` / `adapter-feedback-contract.test.mjs` / `action-state-contract.test.mjs`（后者直接import构建后的ActionState，验证Users/Default Work/Skills/Packages/Runtime的写确认与回读失败分离、unknown原归属、旧identity账本隔离，以及About/Operation只读不造写锁；`npm run test:unit -w @piwork/console-webui`，先build）；浏览器 `feedback.spec.mjs`、`management-flow.spec.mjs`、`quick-setup.spec.mjs`；SUI-005/006；保存确认≠ready，旧Key回调受身份/视图约束 |

共享 JS 在构建时复制为原生 flat browser module；声明文件不是第二份实现。`check-webui-boundaries.mjs` 复用 ui-language 轻量词法扫描构建真实 import/export/字面量 dynamic import 图，检查共享→feature、feature→入口、跨应用与循环（包括 flat shared 映射）；不能证明动态非字面量加载、跨 owner 写入或接口内聚，后者必须结合类型/人工审查。单元须直接 import，不使用入口源码抽取/VM。

## 选择执行入口与风格

- `make check-maintenance` 聚合现有 native、WebUI依赖、docs、quickstart、i18n；纯文档可只选两项 docs，不默认运行全部。
- `make check-style` 只检查相对 HEAD 触达的 Go/TS/JS/CSS；Go 用 gofmt，TS/JS/CSS 使用空格缩进、无尾空格、末尾换行，新增 TS/JS 独立语句不压在同一行。保留未改的历史格式，不强制全仓重排；模板文字不是语句。可显式传文件给 `node scripts/check-source-style.mjs`。风格不是模块质量的替代。
- 规则负例由 `node --test scripts/*.test.mjs` 接入既有 `make test`。检查存在不等于执行；报告通过/失败/未执行，真实 Docker/Core 需求单列。
