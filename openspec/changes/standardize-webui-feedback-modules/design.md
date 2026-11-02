# Design

## Context

动机见 [proposal.md](proposal.md)。源码基线为 `7c2325552a6db6e6777120c24135c16e458adcd5`；V13 来源是独立原型仓库 `ea80fa4c8e46d96ba91dce298f06e9d79c036c7c`。原型只含代表性合成状态，具体hash及范围见 [scope manifest](prototype/scope-manifest.json)，不作为真实Core测试结果。

当前 Desktop `app.ts` 的分发覆盖多个功能，展示还直接读写全局view和adapter；导出展示测试读取整份入口再正则抽函数。现有 `export-flow.ts` 的 `ExportPort` 与独立测试、共享 `tokens.css`/`controls.css` 是有效基础，不能因“防腐”整体重写。两端ActionState业务存在差异，不能按同名强并。

CLI确认三个旧change任务已完成但未归档。冲突协调表如下；只写本change，不代替它们归档：

| 已有要求/变更 | 本次协调 |
|---|---|
| `support-bilingual-webui` | 使用其所选语言/稳定key方向；复制重叠完整requirement时保留双语语义，不恢复英文限定。语言切换不重挂iframe、不丢草稿、不发新动作。 |
| `simplify-linux-delivery` | Logo/资源按当前统一Linux Core及CLI交付，不恢复Windows原生或独立Console产品。 |
| UIL-010 与原型Work内Logo | 明确单个紧凑身份栏内保留原PW标记；禁止的是第二层品牌顶栏，不再保留“Work内不新增Logo”旧冲突。 |
| UIL-009、DWUI-019、DUL-OPREC-001 | 临时结果Alert转浮动宿主；正常读取无success toast，首读/准入持久原因、字段与恢复仍归对象。 |
| DUL-009、DWUI-009、DWUI-OPREC-001 | Export Details及所有既定仅进度drawer只展示进度；技术诊断/按原ID找回转到同Work独立恢复上下文，不删除身份、私有提醒或必要控制。 |
| UIL-SETUP-001 与导航修正 | Administration只在全局账号；Quick setup从Admin内部进入；Admin Header直接返回Workbench；行/头scope显式。 |
| DWUI-OPREC-002/003、SUI-006 等未改业务规则 | 无可见Work的固定恢复入口、安全诊断、确认结果与读回失败、幂等例外继续生效。 |

## Goals / Non-Goals

**Goals:** 建立代码、配置、文档和界面每次变更共同触发的维护与同步规则；让本批状态/通知、导出面板、Header/menu调整可在所属模块独立理解、直接测试；覆盖真实Desktop/Serve状态而不继承原型缺口；将导航、共享样式及恢复规则变成可核验契约。

**Non-Goals:** 不新增框架、全局任务中心/后台队列、通用代理API、全仓重构、读屏认证矩阵或发行；不改第三方Service页面内部或Launcher；本轮规划不安装Skill、不改AGENTS/业务代码。

## Decisions

### 0. 项目级规则按实际影响触发，不以全仓扫描代替责任

`project-maintainability` 是项目级约束，WMB 是本批 WebUI 的具体落点。每次获批变更先在已有设计/任务中写明受影响类别、权威源、责任模块、消费者和检查；简单变更可以一段完成，不新增固定报告。只沿真实依赖扩读，不能因为用户要求防腐就改动所有历史文件。

| 影响类别 | 当前责任与源 → 消费者/产物 | 实施阶段必要验证入口（本轮未执行） |
|---|---|---|
| Go/TS 功能 | `cmd/`/`internal/` 的所属包；`apps/agentd` 与必要 `packages/`；浏览器/CLI 经 Core HTTP，不绕到 Core 存储域 | 所属 Go unit/TS unit；`node scripts/check-native-boundary.mjs` 及 `.test.mjs`；真实 Engine 仅在相关行为变化时验证 |
| 配置与默认值 | `internal/app/run.go` 三参数/缺省/校验，`run_test.go`；`internal/distribution/` 与 `scripts/native-server-defaults.mjs`；Work 配置由 `internal/coreapp/work_configuration_*`/校验及原合同所有者管理 | 默认/显式/非法/重复/旧键/优先级、缺省与兼容负例；保留 ADMIN 成对初始化、秘密不回显；配置生效范围与 UI/帮助/部署材料核对 |
| 协议与生成 | `proto/*.proto`、`packages/contracts/src`、HTTP 冻结基座 `internal/contracts/schemas.json` 各自负责不同输入；history 的 SQL 在 `internal/workhistory/`；不是一个万能 schema | `make generate` 的三条生成链、再生成差异和 Go/TS wire/golden 正反例；不手修 generated 文件，不删有效旧 history/DTO 读者 |
| 文档/部署 | RDOC 与有效 delta 管归属；`scripts/docker-quickstart-content.mjs`/`build-docker-release.mjs` → 双语部署、`examples/single-host`/Compose 与既有官网同步输出；README 仅项目入口 | `node scripts/check-repository-docs.mjs`、`node scripts/check-docker-quickstart.mjs` 及对应 `.test.mjs`；链接/锚点/语法/默认值/固定发行引用与中英文含义；不改发布身份 |
| UI/交付 | `apps/ui-shared` 与两端 source/catalog → workspace build/copy-static → `scripts/sync-{desktop,console}-assets.mjs` → Go 嵌入资源 | `node scripts/check-ui-language.mjs` 及 `.test.mjs`；typecheck、相关浏览器、构建后实际 Go 入口/CSP/资源核对；直接 UI 边界测试见下文 |

上述是源码中的既有入口，不是本轮执行结果。`make test` 已串联 docs、i18n、scripts 负例、Go wire、TS harness 和 WebUI typecheck；`make acceptance` 还关联 native/image 边界及真实集成，不能因其存在就称 CI 或全部验收通过（当前未发现 `.github/` 配置）。新检查接入既有入口与其测试；反例至少能使所宣称规则失败。配置/命令默认值或文档漂移不是仅凭观察名称就已成立的缺陷，实施时在触达范围复现再修复。

对失效配置、无消费者分支、重复说明和悬空入口，先判断现行兼容契约、历史证据与产品随包 Markdown 的职责，再在本批授权内删除/迁移；不能删除唯一有效来源或恢复被弃用入口。外部官网同步/部署、真实环境与发布仍遵守单独权限；不可执行项明确为未验证或阻塞。

### 1. 唯一状态所有权；展示不控制任务

```text
app composition --> feature controller --> narrow adapter/flow port
                           |
                    read-only view model --> shared presentation
```

通知事件只携带原身份/对象/任务代次、稳定key、等级、当前语言文案与具名恢复描述。展示关闭/替换无业务副作用；恢复由原功能重新准入。拒绝“一个全局TaskStore替代所有协议”：原型TaskStore是fixture，生产继续使用实际操作/文件账本/导出协调器。未知锁与动画谓词分开，不能把 `pending=false` 当解除保护。

### 2. 首批模块边界

| 责任 | 现有/拟定位置与公开边界 | 独立验证 |
|---|---|---|
| 共享icon/token/pending/notice | `apps/ui-shared/`；语义图标、固定等待槽、纯通知策略＋单宿主；不接完整adapter/view | 策略直接import、图标定义与尺寸、事件去重/unknown优先级、依赖负例 |
| 导出协调 | 保留Desktop `export-flow.ts`/`export-admission.ts`及其窄端口 | 原ID、一次交付、Pause≠Close、Check≠Resume、身份撤销 |
| 导出展示/控制 | 从app抽取只读`ExportPanelModel`与具名check/pause/resume/save操作；独立Work诊断不回塞Details | 直接import面板，无正则切入口；非模态/重开同任务/私有提醒 |
| Work Header/Service Toolbar/菜单 | 只读视图模型；`scope=global-account|work-row|work-header|service`显式输入；目标与权限一起验证 | row无Admin/Requests，header只当前Work，旧菜单不串目标，iframe不重挂 |
| Serve表单/对象 | 各自controller持有草稿/提交版本；窄adapter子集，确认修改与关联回读分开 | Login/unknown、晚回调、新Key、Save/Test/readiness及Package幂等恢复 |
| app入口 | 路由/装配/生命周期；功能事件分发给所有者 | 不继续新增跨功能决策；清理调用所有者，不到处清全局字段 |

具体文件拆分随内聚性确定，不固定文件数/层数。V13 `bridge.mjs` 仅冻结为原型实现说明，通用getter/setter和全局函数包装不是生产接口。两端重复pending图形可共用；ActionState策略仅抽出真正同义部分，不强行共享不同协议。

### 3. 单一视觉来源与菜单scope

PW图形使用现有PNG字节；记录附件hash用于核对，不将hash硬编码进业务。Open、外链、Start使用不同语义图标key；Refresh单圆18px固定slot，保留热区。Header采用V12最终有效CSS层级：Desktop首页/Admin/Work身份栏56px，首页与Admin等高对齐，Service Toolbar39px；首页B控件icon-only，Work行Open图标加文字，窄屏必要时96px双行，不用旧较高默认值反覆盖。图标/控件token在共享源，页面排版局部维护。

菜单生成器必须显式scope，不默认读取上次选中Work；行点击/行菜单与按钮动作隔离。Admin入口的权限由真实会话决定；语言入口保留，不因删越级菜单丢失。

### 4. 全部来源族，而不是原型按钮数

[来源索引](prototype/source-coverage.json)有23个Desktop、12个Serve族；[冻结覆盖记录](prototype/coverage-manifest.json)含277个场景条目并明确代表性限制。实施逐族映射实际入口/源状态/恢复/测试；表中 `deferred` 只记录原型未实现，不转化为生产延期。

明确补齐：Console登录/退出/未知受理、Desktop会话与Core准入、独立模型/文件/表单、本地预检、初始壳依赖失败/有界恢复、真实读回和稀有失败。托管Quick setup属于Serve；独立首设不新增视觉改版，但共享模块依赖、加载/失败/身份回归必须覆盖。不存在的API/枚举或任意笛卡尔组合标为不适用并说明依据，不能编造能力。

### 5. Skill与检查是实施任务，不是现在安装

[Skill候选](skill-proposal/piwork-code-maintenance/SKILL.md)只保存在本change。获批实施时才在项目 `.agents/skills`安装并给AGENTS短触发入口，触发范围为所有相关代码/配置/文档/UI变更；不改生成的OpenSpec工作流Skill。模块导航按 Go/TS、配置、协议/生成、文档与 UI 分类，只列实际owner/interface/tests和现行Spec，不复制源码或另建docs；WebUI任务才展开对应详细条目。

Go沿既有package与gofmt；TS/JS/CSS在本批确定一种既有兼容格式规则，禁止压成巨型单行或全仓无关重排。边界检查覆盖反向/循环依赖与公共参数大context；可自动识别部分用负例证明，跨owner写入和“万能接口”须结合类型/代码审查，不谎称简单grep能证明全部架构性质。

### 6. 直接测试和上下文验收

新单元直接import真实模块；fake port只含实际所需操作，浏览器/真实Core测试保留。通知策略、导出布局、一个配置默认值和一组双语命令四类维护样例记录实际必读文件/行范围及为何扩读调用方，若仍需全app或几十个无关stub则边界未完成。不承诺未经测量的Token百分比，不设置任意行数阈值。

## Risks / Trade-offs

- [迁移丢失复杂恢复] → 每批先固定原ID/锁/晚响应测试，再抽取，再改视觉；按责任边界可回退，不接受两份活动逻辑。
- [通知替代后错误消失] → 首读/准入原因、字段与原对象恢复常驻无框；浮动通知只承接合适结果，不做全局历史。
- [全量复制旧Spec覆盖已完成delta] → 保留完整场景，针对上表冲突逐句合并；验证前检查标题/场景损失与双语/Linux方向。
- [原型误当生产] → 冻结精确版本/hash，明确mock与缺口；真实测试/权限/下载证据单列。

## Migration Plan

先完成规划审阅并取得新apply授权。先接入项目级影响分类、配置/生成/文档检查与合成负例，再逐功能做共享展示、导出、Header/menu、Desktop其余族、Serve与登录/首设依赖回归；每批同时交付测试和所属导航更新，未通过不进入下一批集成。保留生成/嵌入资源一致性，按AGENTS构建与验证。回退以责任批次为单位，保留用户数据和已接受操作；不回滚数据格式，因为本变更不改它。主Spec同步、归档、commit/push/release须按相应授权另行处理。

## 2026-11-02 实际截图后的视觉纠偏

用户查看正式构建的实际截图后，明确要求重新对齐冻结 V13 的 Chat 输入区、Desktop 首页/WorkList、Administration 首页，并新增 Services、Files、Chat 的 SVG 图标。冻结 V13 文件保持不变：其最终 tab 规则实际隐藏 SVG，因此新增三个 tab 图标属于这次明确的用户覆盖要求，不能伪称原型已有。图标由同一共享源维护，统一 24 viewBox、18px 显示和 currentColor 线性样式。

- **Chat 输入区**：按 V13 最终有效样式收为白色紧凑框、正常 42px 多行输入、左侧附件及相邻的模型、Thinking 两个独立触发入口（各自 chevron）、右侧蓝色发送与同框展开。两个入口复用原响应设置与成对自动保存所有者，Thinking 直接展开对应选择，toolbar 入口不冒充斜杠命令来源。保留现有只支持图片的真实上传限制、模型/思考成对自动保存、输入选项、斜杠命令、Stop/Send、未知受理锁、草稿及焦点所有权；展开只属于当前草稿的本地展示，不新建提交或第二个输入框。
- **Desktop 首页与 WorkList**：共享同一个 Works 所有者，按最终原型的内容宽度、列表密度、图标尺寸和顶栏控制顺序对齐；56px/96px 身份栏规则不变。行高是正常内容最小值，不裁掉真实失败、未知任务及恢复控制；账户名和连接事实来自真实会话，菜单 scope 不改变。
- **Administration 首页**：采用紧凑页头、真实 Core/Runtime/Model 事实区和两列主要入口；不复制原型的固定模型或模拟状态。Quick setup、Skills、Find operation 和已有未结束操作仍在 Administration 自身导航或明确的次级区可达，不移入 Work 行或全局 Account。首读失败、陈旧数据、原任务恢复及权限判断继续由既有所有者负责。
- **验收**：正式构建与生成资源同步，直接回归验证展示边界；复用现有真实浏览器用例生成 Desktop 首页、Work 页面、Administration 首页各 1440/360 两种宽度的六张截图。代码测试通过不替代原型对照和用户视觉审阅，截图标注真实资源与合成业务数据的边界。本轮完成前不再宣称视觉验收已完成。


## 2026-11-02 V14 最新批准视觉基线

用户在 05:13 UTC 明确恢复 V14 项目实现及 PR。最新视觉参考为 [冻结 V14 单文件](prototype/Piwork_UI_Review_V14.html)，SHA-256：`8526e2670e0275337f594d482d6376932ac88ead325435fedcba5d34edda4868`。V13 附件字节保持不变；以上 V12/V13 的 56px/96px 与此前截图纠偏记录是历史基线，以下明确覆盖其相冲突视觉数值，不撤销业务、安全及状态契约。

- Desktop 首页、Work 身份栏、Administration 宽屏统一 52px；必要窄屏双行 88px，Service/Files/Agent 次级工具栏 39px。52/88 使用共享 token，正常行高不是裁剪真实长错误、未知任务或恢复入口的许可。
- Administration 保留四个短主导航与对应 18px SVG（Overview、Users、Setup、Models；当前语言对应短名），及原 Overview 主要入口结构；Setup 下 Defaults/Skills/Packages 次级导航保持 39px。Quick setup、Skills、Find operation 和已知 Operation 仍通过所属明确入口可达。不可用原型固定模型、健康值或假任务替代实际来源；Account 与 Work 菜单 scope 保持。
- Chat 白色输入框正常最小高度 83px，文本区 42px，附件与发送槽 28px；模型与 Thinking 为相邻但独立的具名触发入口，各自 chevron，仍使用同一成对自动保存所有者。Services/Files/Chat 使用 V14 批准的 18px SVG。保留展开、真实图片限制、IME、草稿、焦点、Stop/Send、未知受理锁与原恢复，不复制原型模拟控制器。
- 冻结 HTML 仅用于视觉对照，不编译进产品，不视为真实模型、Engine/Core 或状态覆盖证据。验收使用正式构建、资源同步及真实浏览器，分别记录 1440px/360px、双语、长错误、等待/陈旧/未知与交互；当前仅记录批准参考，不宣称 V14 产品视觉验收已通过。历史任务勾选不代表新增 V14 验收，见任务组 9。

### V14 选择浮层纠偏（2026-11-02）

用户实际截图指出：两个独立触发按钮仍打开同一大型双字段 Response settings 面板，未满足 V14 的紧凑选择浮层。本次仅修正展示和对应入口：Model 锚定原模型按钮，正常宽度 225px，仅显示真实模型、必要搜索与 Work default；Thinking 锚定原思考按钮，正常宽度 180px，仅显示当前模型实际支持的等级。去掉重复双字段摘要、大型标题及 Footer Close；窄屏裁界、列表内部滚动、外部点击/Escape 与原触发器焦点返回继续保留。

业务仍由原 modelSelection 单一所有者负责，沿用成对 PATCH、原设置读回、未知/错误锁及身份/会话守卫；异常时保留紧凑原因和检查原状态入口，不自动重放，不消费输入草稿或冒充斜杠命令。影响范围限响应选择展示、锚点/尺寸装配、对应直接/浏览器回归和正式生成资源；无后端或协议变更。验收必须实际分别打开两个浮层检查，不能用关闭态截图替代。用户截图及其中内容不纳入仓库。

本批核验：正式 Desktop 构建与嵌入资源字节一致；62 个非浏览器测试文件共 1001 项通过，生产/测试类型检查、增量风格、maintenance 与本 Change strict 检查通过。现有恢复测试 171 个声明保留，迁移旧双字段面板定位并保留成对写入、原设置检查、草稿、身份隔离及无重放断言；完整浏览器和真实 Core 测试须由后续精确提交 CI 验证，不把本地直接测试当作浏览器通过。

实际浏览器使用正式资源与合成业务数据分别打开 Model/Thinking：225px/180px 两个浮层、真实模型与受支持等级、原按钮 Escape 返回及外部关闭已核验；没有大型双字段摘要或页脚。未知设置验证为单次成对 PATCH、两次显式原设置 GET（首次失败、第二次成功），关闭/重开不自动写或读取，失败保留发送锁和草稿，成功才恢复所读等级与发送准入。首次合成错误的响应包裹不符合 Desktop 顶层错误协议，因此作为已知失败展示验证记录，不冒称未知结果；修正夹具后单独完成上述未知结果路径。用户图片及聊天内容未纳入仓库。

最终正式资源复核还覆盖同一未关闭浮层内原 Check 失败后成功：原 503 与 unknown 文案均消失，实际读回 High 选中、草稿逐字保留、Send 恢复，原路径仍恰一 PATCH 与两 GET，无其他写。500×435 CSS 视口下 Thinking 为 180×176、Model 为 225×152.781，均完整处于视口内；这是该实际尺寸的有限证据，不冒称全部设备或精确 360px 浏览器矩阵已经执行。
