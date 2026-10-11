# Design

## Context

动机见 [proposal.md](proposal.md)。初始基线内置 `piwork-brain@1.2.1` 只有 `deploy-work-service` 一个 Skill。原 14 项任务已在本地实现 1.2.2 和两个平级 Skill，尚未发布；本次修订增加 7 项待办，补充 NiceGUI 样式、真实页面验收与排障认知。`brain.md` 继续保持 Understand / Specify、Act、Verify、Remember 四项常驻认知。

`apps/agentd/src/package-resources.ts` 已把启用的冻结包交给真实 Pi SDK；包清单的 `pi.skills=["skills"]` 已允许目录内多个 Skill。加载器通过 `brain-resources.ts` 读取 `brain.md` 并追加至系统上下文，Skill 的名称、描述和位置可发现，但正文需经原 SDK read 工具读取。新目录不是自动全文注入点。

现有 `templates/web-app/ui.py` 已在用户 Action 后刷新，并以定时 Query 和 `stateVersion` 观察 Agent 写入；`scripts/check-web-base-core.mjs` 已验证用户操作、Agent Action 的页面自动更新、草稿保留和普通 Action 不重部署。代码版本自动采用由另一路现有机制完成。无需再设计实时子系统。

当前两个模板仍有 `.navigation`、`.description` 等通用自定义类，且定时业务查询没有显式失败/陈旧反馈。平台验收脚本已有真实 Desktop Service iframe 和 Playwright；默认 Work 七个 built-in 工具没有独立浏览器工具，不能将平台测试能力当作 Work 已获授权的运行能力。

Core 内置包更新只在版本变化时发布新版；只添加文件但沿用 1.2.1 会让已有 catalog 跳过更新。现有包升级、管理员定制保护和 Work 显式 Apply 路径可复用。

## Goals / Non-Goals

**Goals:**

- 用一个独立 Skill 保存完整五类认知，Brain 提供简短平级路由，新增后脑包共两个 Skill。
- 区分常驻注入、SDK 发现和正文读取，验证实际读取的是当前冻结包；旧 Work、禁用和空选择边界保持。
- 将产品体验判断融入原任务，保留原有必要 Spec、部署及业务验证，控制新增阅读和返工成本。
- 补充按需 NiceGUI 指导，并让默认示例的样式命名、查询失败反馈与真实入口验收符合该指导。

**Non-Goals:**

- 不提取或重构整个 deploy-work-service，不把五类认知放进它，也不为通用正文新增必读 Reference 中转；NiceGUI 专项 Reference 仅用于相关任务。
- 不新增 Agent、Run、审批、设计平台、视觉评分、运行时路由器、提示词全文注入机制或 Memory 自动维护。
- 不重做模板视觉、不自动改造既有应用、不重建 NiceGUI base；不调整协议、数据库或权限。
- 不安装浏览器、引入浏览器 MCP 或创建新平台验收工具，不读取用户机器的凭据来绕过实际入口授权。
- 不执行 Git 推送、镜像发布或 Fedora 部署；本设计的实现/验证步骤属于后续 apply。

## Decisions

### 1. 一个完整认知 Skill，与部署 Skill 平级

新增 `internal/coreassets/piwork-brain/skills/application-awareness/SKILL.md`，含明确的 front matter、适用/排除范围、用户提供的五个章节和完成标准。正文保留用户给定中文认知与英文术语；开头明确应用在 Work 工作空间中运行，一个 Work 可有多个 Service。

选择一个 Skill 是因为五类原则共同指导同一个应用任务，按当前影响适用；拆成五个 Skill 会增加读取和串行检查，也容易丢失 Engineering Judgment 对其他原则的约束。将全文放在 Brain 会让普通业务 Run 也承担完整上下文；将其挂在部署 Skill/Reference 下则把应用认知错误绑定到部署入口。

本次不改造部署 Skill 的全部历史职责。它继续提供现有必要 Spec、Service 契约、环境、持久化、部署与验证规则，新 Skill 不复制这些流程。

通用 UI 部分增加自定义样式隔离，完成标准增加实际用户入口和证据归因。具体 NiceGUI 类名示例、连接/资源/遮罩排查内容放在 `skills/application-awareness/references/nicegui.md`。Skill 正文明确何时读取该文件：使用 NiceGUI 创建/修改页面，或排查该框架页面异常；其他栈和普通业务操作无需加载。当前上下文已有同一有效包内容时复用。目录仍只有两个 Skill，Reference 不成为第三个 Skill，不全文注入 Brain。

### 2. Brain 提供两个独立阅读入口

在 `brain.md` 原 Understand / Specify 中增加简短指令：创建应用、开发功能或修改交互前读取 application-awareness；持久 Service 创建/代码变更仍读取 deploy-work-service。相关正文已经在同一有效包上下文中时可以复用，不每次调用工具都读一遍。

```text
active piwork-brain
    |
    +--> brain.md --> system context: short principles + routing
    |
    +--> SDK skill discovery: name + description + frozen location
              |
              +--> application task --> read application-awareness/SKILL.md
              |                                  |
              |                                  +--> NiceGUI task --> read references/nicegui.md
              |
              +--> persistent Service task --> read deploy-work-service/SKILL.md
```

两个入口各自由 Brain 路由，同一任务可需要两者；不以先调用部署工具为新认知的准入条件。普通 Query/Action、仅启停服务、未改造第三方镜像的部署不会进入产品设计。仅后台任务按适用原则工作，不主动增加 UI。

保持 `package-resources.ts`、`brain-resources.ts` 及 SDK 工具执行机制不变。路由属于模型指令，不声称加载器会强制所有模型服从；正文读取证据来自原 SDK 工具历史，不创建额外认知账本。

### 3. 五类判断不能成为新的交付关卡

新 Skill 明确把这些原则放在原实现过程中应用，达到“功能可用、操作直观、状态正确、界面整洁”后交付。

- 延续必要 Service Spec，局部变更只更新受影响条目；不另建 Product/UI/UX 报告或强制追加五个 Spec 章节。
- 不要求逐项自评、独立设计审批、固定截图审核、视觉分数、重复润色或额外模型 Run。
- 主要操作不可达、反馈误导、业务状态错误属于本次功能问题；细微装饰不阻塞交付。用户明确的视觉目标按实际请求实现。
- 不删除原必要检查，不把“最短路径”解释为仅进程 ready 即完成。Memory 仍是按需独立学习。

### 4. Reactivity 复用共享业务状态，区别代码版本更新

完整认知描述“何时需要自动反映、哪些输入必须保留”，不硬编码轮询周期或框架。默认 NiceGUI 沿原 Query/Action、定时观察与状态版本进行局部更新；其他明确技术栈采用其现有简单机制。

加载认知不会遍历并修改所有旧应用。要求针对新应用或当前改动影响范围，避免给仅后台或业务操作任务附加 UI 重构。数据查询失败时应表达观察限制；原代码版本自动采用不能被当作数据最新的证据。正常同步不能清掉无关未提交输入或触发重部署/新 Agent 目标。

默认复用模板的 Query、状态版本和定时刷新实现；仅补充最小的查询失败/陈旧提示和成功恢复，不引入第二套刷新机制。失败时保留最近确认的数据但明确其非最新状态，不清空未提交输入或重部署/发起新目标；恢复后重读权威状态并清除错误。正常路径和故障路径分别验证，不再用“已读取失败原则”替代故障页面实际行为。

### 4a. 默认样式使用业务前缀与局部作用范围

两个模板的自定义类及相应选择器成组调整为各自业务前缀，并尽量放在应用根容器范围内；`ui.py` 与 `style.css` 保持一致。保留 NiceGUI 自带的框架布局类，不定义无范围的 `.column`、`.row`、`.card` 来覆盖它们。确有目标的框架组件样式调整限定在应用内；有意的文档级背景/字体主题不视为误改内部容器。

本次只改变命名、选择器范围和必要错误反馈，不改现有业务对象、主要操作、布局结构及视觉风格。`style.css`/`ui.py` 已在默认页面版本输入中，继续沿原检查及自动采用机制；无新增 CSS lint 门禁或 base 工具。用源码选择器检查与真实页面的框架容器可见性/主要操作验证，避免只检查类名字符串而未发现框架布局被隐藏。

### 4b. 真实入口验证与浏览器能力边界

对受影响的应用页面，有可用且获准的浏览器能力时，从用户实际 Desktop Service 入口检查：内容可见、主要操作可用、用户/Agent 数据变化自动呈现。直接 Service 地址、Ready、HTTP 200 或 Query 成功各自只证明一层，不能替代该入口的页面结果。平台夹具继续复用 `scripts/check-web-base-core.mjs --main-only` 的实际 CLI 授权入口和 iframe，不将直接打开 Service 地址当成用户入口验收。

工作中的 AI 必须依据当前实际工具/访问能力决定能验证到哪一层。没有获准浏览器、无法连接真实入口或授权不足时，保留已证实的后端结果，明确“页面未验证”及原因，不宣称完整 UI 交付，不借机安装浏览器、扩大工具权限或读取用户凭据。平台 Playwright 回归仅证明平台测试中的页面行为，不证明任意 Work 已具备浏览器能力。

这属于基本可用性验证，融入原交付路径；不新增设计审批、固定截图审核、视觉评分或全页面巡检。无需 UI 的后台变更不附加无关浏览器任务。

### 4c. 白屏按可观察证据定位

NiceGUI Reference 按现象选择检查点：资源请求及实际返回、浏览器错误、HTTP/WebSocket 连接、内容 DOM、计算样式与尺寸、遮罩/层叠关系。诊断资料保留必要事实，不泄漏 ticket、token、私有 URL 参数或用户内容。

DOM 存在但被 CSS/遮罩隐藏，与资源缺失、连接/授权失败、脚本异常分别处理；只修复有证据支持的原因，不把“iframe 中白屏”直接判定为架构不兼容，也不默认换技术栈。用可控样式隐藏/遮罩及资源或连接故障的夹具证明相关证据可取得、页面验证能发现 Ready/200 之外的问题；合成模型只能证明认知读取与固定诊断分发，不包装为任意模型都会自动归因。

### 5. 递增包版本，保持安装和采用边界

以初始 1.2.1 为基线，内置脑包递增为 **1.2.2**；这是包版本，不是新的 Core 镜像发行。若 apply 开始前该版本已被其他正式制品占用，沿实际基线选下一个未占用版本并同步同组测试/文档，不复用已发布的同版本身份。

本轮 1.2.2 仍为该 change 的未发布本地实现，新增认知与模板修正可继续在同一 change 中补齐；若后续发现该包版本已经对外发布或被目标安装正式采用，再沿实际版本状态递增，不改写已有制品身份。

`package.json` 继续通过 skills 目录发现资源，无新增依赖。Core archive 测试确认新文件随 go:embed 真正交付；SDK 测试把固定 skills=1 改为两个明确名称的集合检查，保留原四个工具。升级测试从旧 1.2.1 验证新 head、幂等、旧 immutable 制品保留和管理员定制保护，不能只把原期望版本数字换掉。

新 Core 源码构建启动后，原内置且启用的 catalog 可更新；既有 Work、可编辑源码、active 和已捕获镜像不自动改写。采用仍走现有包更新与显式 Apply。显式 packages=[]、禁用和原同名资源冲突语义保持。

### 6. 按资源、读取链路与业务事实分层验证

| 层级 | 现有入口与必要验证 |
| --- | --- |
| 包交付 | `internal/coreassets/brain_test.go`：真实归档包含新 Skill、五类正文/完成标准、短路由和递增版本；NiceGUI 固定引用与现有模板保留 |
| SDK 资源 | `apps/agentd/src/brain-resources.test.ts`：发现两个 Skill，常驻 prompt 不复制全文；冻结来源、工作区编辑尚未 Apply、禁用/空选择及碰撞规则保持 |
| 正文读取 | 同一 SDK 测试及必要 `packages/pi-adapter/` 合成夹具：通过真实 read 调用读取新 Skill 全文；应用任务可直接读，普通业务样本不增加设计/部署工具调用或额外目标 |
| Core 升级 | `internal/coreapp/bundled_brain_test.go` 与 `bundled_brain_integration_test.go`：旧 1.2.1 catalog 更新，新默认包实际包含两个 Skill，旧 Work 的捕获不变 |
| 默认业务同步 | 复用 `scripts/check-web-base-core.mjs` 已有用户操作、Agent Action、页面自动变化与草稿保留段；保留不重部署、不新增被动请求的断言，不做像素美观评分 |
| NiceGUI Reference | SDK 对 NiceGUI 样本读取同一冻结包中的 Reference；非 NiceGUI/普通业务样本不新增 Reference 读取，两个 Skill 的数量不变 |
| 样式与真实入口 | 两个默认模板的业务前缀/作用范围、框架容器和主要操作经实际 Desktop Service 页面验证；Ready/200 但内容隐藏不能算通过 |
| 故障与能力限制 | 业务 Query 失败/恢复、草稿保留、白屏证据及缺少浏览器能力时的部分验证说明分别检查，不与正常同步或平台工具可用混为一谈 |

合成模型只用于确定性地验证工具链、资源和过程，不将脚本化结果包装为任意真实模型必然理解或遵循五类认知。是否显示最新业务数据以 Service Query 与页面观察为依据，不能只读 marker 或最终模型文字。

## Risks / Trade-offs

- [模型可能只发现名称而未读正文] → Brain 明确适用范围和读取入口，检查真实 SDK read 历史，文档区分发现、读取和行为证明；不新增强制运行时门禁。
- [产品体验要求变成额外工作流] → Skill 正文明示成本边界，普通业务/小改动加入负向回归；不创建五阶段报告或视觉评分。
- [只有更新文件而版本未变，Core 不更新 catalog] → 同组递增版本并验证从 1.2.1 升级与重复启动幂等。
- [新增 Skill 改变列表顺序，使夹具误读第一项] → 按名称选择和断言集合，真实读取路径绑定当前包，不依赖目录遍历顺序。
- [现有测试与固定历史记录混淆] → 当前测试采用新版本，旧 fixture/归档保留原事实；已发布 base/Core 引用不随本次源码变化重新标记。
- [业务同步与代码采用被混为一谈] → 分别观察业务 Query/UI 和运行代码版本；不能以其中一个的通过替代另一个。
- [样式命名指导与默认示例不一致] → 同步修改两个模板的类名和选择器，真实入口检查框架布局/内容与主要操作，不增加美观评分。
- [平台测试可用被误当 Work 浏览器授权] → 认知明确读取当前工具边界，能力缺失样本只能报告部分验证，不自动安装/扩权。
- [以 Ready/200 掩盖白屏，或因白屏无依据换栈] → 增加可控故障和浏览器证据检查，归因与修复必须关联实际观察。

## Migration Plan

1. 在 apply 中新增 Skill、短路由并递增包版本，更新相关加载/交付测试；通过定向 SDK 和 Core 回归。
2. 沿现有独立安装/唯一标签执行默认 Service 的相关浏览器业务验证，保存实际结果及未验证范围。
3. 更新 `docs/piwork-brain.md`、测试说明与 README 中英文对应说明，明确两个 Skill、实际加载机制、旧 Work 采用和主路径边界。文档现有“base 仅本地候选”的陈述与正式固定引用不一致，同次说明按真实引用纠正，发行记录身份保持。
4. 后续用户明确要求构建/发布部署时，新 Core 才进入目标安装；本 change 的规划或代码修改本身不更新 Fedora。包回退同样经原选择/显式 Apply，不恢复或清空业务数据。
5. 原 1–4 组任务及验收记录保留为首次实现事实；新增第 5 组完成前，当前扩展范围不能据原 14 项完成或旧正常路径报告为全部通过。完成后补充本轮认知、样式和故障证据，再重新 verify。
