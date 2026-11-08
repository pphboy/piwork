# Design

## Context

动机和用户确认的范围见 [proposal.md](proposal.md)。本设计跨静态 HTML、共享控件样式、三种应用入口及 Go 资源交付，满足需要独立设计的条件。

以下为实施前的源码定位事实；实施后的检查与截图记在文末验证状态：

| 来源 | 已验证事实与责任 |
| --- | --- |
| `apps/ui-shared/controls.css:108,263–284` | `.app-loading` 为横向 flex，只有 96px 最小高度与 24px 内边距；冷启动骨架有独立宽度和内边距，未形成居中品牌布局。共享层负责样式，不持有业务状态。 |
| `apps/desktop-webui/public/index.html:2`；Console `public/index.html:2`、`public/setup.html:2` | 三个静态 HTML 载有独立骨架和原生恢复表单；`/login` 与 `/setup` 使用同一 setup 入口。 |
| Desktop `src/app.ts:4556–4567`、`src/adapter.ts:927–965` | 应用将首次会话读取渲染为三点＋文字；adapter 拥有读取、十秒期限、身份和有限恢复。 |
| Console `src/app.ts:3170–3241,952–985` | 初始会话另有无管理外壳的骨架；会话确认后的页面首读由 `PageReadState` 管理，在管理外壳中展示局部占位。 |
| Console `src/onboarding.ts:11–16,83–97,195–240,267` | `loading` 阶段会绘制 setup 顶栏、标题和骨架；初始读取失败进入 `error`，已进入凭据或准备阶段后的失败保留原页面。 |
| `apps/ui-shared/boot-watchdog.js:28–41,59–127` | 内联监测独立于应用模块，十秒检测、最多两次自动重载、1s/3s 间隔；接管后停止该启动周期的自动重载。 |
| 两端 `scripts/copy-static.mjs`、`apps/ui-shared/prepare-boot.mjs` | 构建时复制 Logo 和共享模块、合并样式、内联监测并生成 CSP hash，再同步 Go 内嵌资源。 |
| `internal/webapp/server.go:331–368`；`server_test.go:477` | setup 的未认证静态资源采用精确路径允许列表，已有专属 Logo 路径；真实 handler 测试追踪生产模块依赖。 |

有效约束采用 `ui-language` 的 UIL-PENDING-001、UIL-I18N-001/004、启动依赖有界恢复要求，以及 `desktop-webui` 的首读期限／局部恢复、`serve-ui` 和 `web-onboarding` 的读取恢复要求。组件选择沿用 `desktop-ui-language/ui-component-adoption.md` 与 `ui-component-spec-v1.0.md`。

`serve-ui` 当前“应用接管后立即提供管理外壳”与中性整页品牌阶段存在表达冲突；本变更的 delta 明确为管理身份确认前显示品牌页、确认后立即显示管理外壳。普通页面数据首读仍属于后者。

## Goals / Non-Goals

**Goals:**

- 让静态入口与应用首次读取共用展示来源，避免只改 CSS 后仍发生结构切换。
- 明确展示与状态责任，复用现有请求、超时、重试、身份和合法导航，不引入第二套启动状态机。
- 将恢复操作的正常显隐与静态兜底一起设计，保证样式或脚本自身失败时仍可操作。

**Non-Goals:**

- 不把管理页面轨道或表单网格统一到 Desktop；品牌布局仅用于 UIL-BOOT-001 的整页启动阶段。
- 不改变 Core readiness 门禁、Service 启动、已知内容刷新、凭据提交、准备阶段和未知写入协议。
- 不修改部署默认值、API、历史数据、发布材料或增加运行时依赖；不执行对外发布。

## Decisions

### 1. 共享纯展示模板，同时用于构建期与运行期

在 `apps/ui-shared/` 增加轻量的启动画面展示模块及必要类型声明，复用现有三点原语，统一 Logo、提示、状态、恢复区的 DOM。输入仅包括当前显示阶段、已本地化文字、当前模式的 Logo URL 和恢复动作描述；输出只负责展示。模块不读取整个 adapter/view、不访问网络或存储、不决定认证、跳转或重试。

`prepare-boot.mjs` 在构建静态 HTML 时使用同一模板展开启动画面，保留内联监测和 `PIWORK_BOOT_RECOVERY` 原生表单注入位置。Desktop、Console 和 onboarding 在各自初始读取分支调用同一展示模块，事件仍绑定到原有具名操作。两端 `copy-static.mjs` 复制实际新增模块及其依赖；setup 精确公开列表同步必要路径。

备选为分别修改四处模板或只修改共享 CSS：改动较少，但静态和运行期 DOM 继续分叉，难以保证交接一致。选用共享纯展示，不额外引入组件框架或通用启动协调器。

### 2. 主要品牌区域有固定锚点，恢复区独立向下展开

正常画面示意如下，框线仅表示视口，不作为产品边框：

```text
+----------------------------------------+
|                                        |
|                                        |
|                 [Logo]                 |
|            Opening Piwork...           |
|                 . . .                  |
|                                        |
|          [recovery area if needed]      |
|                                        |
+----------------------------------------+
```

主要品牌组以可用视口中心定位；恢复说明和操作在其下方的独立区域展开，避免将全部内容一同居中而在出现按钮时推移 Logo。布局采用共享令牌，初始细节按 Logo 48px、提示 14px 和 16px 主间距设计，属于可在视觉验证中微调的默认值。正常文案统一为“正在打开 Piwork…”／“Opening Piwork…”。当前入口类别不作为大标题重复展示。

样式作用域限定为启动画面。360px 窄屏保留安全内边距，文案居中自然换行；矮视口或长异常说明切换为可滚动的纵向布局，确保 Logo 和操作可见。Logo 显式预留尺寸，缺图不触发整页启动失败；状态文字保证图片不可用时仍能理解当前画面。只播放既有 1.2s 透明度三点，减少动态效果时静态。

备选为恢复区出现后重新居中全部内容：实现简单，但会再次制造用户要解决的跳动，因此使用固定主锚点。矮视口允许安全重排，优先保证操作可达。

### 3. 三个运行期入口分别决定何时退出品牌阶段

```text
Static HTML --> App-owned first read --> Confirmed target
     |                  |                       |
     v                  v                       v
Boot recovery     Read-only recovery      Target page shell
                                          + local reads
```

- **Desktop**：首次会话尚未确认时使用共享 pending／unconfirmed 展示，恢复委托原 `retry-session`；确认 signed-out 后进入当前模式的正常登录方向，确认 signed-in 后继续原 Core gate、目标路由及 Work 读取。Core checking/recovering 的专用画面不并入品牌阶段。
- **Console**：`startConsole` 的初始会话占位采用共享画面和原只读恢复；`adapter.initialize()` 确认当前身份后由 `loadPage()` 进入管理外壳，后续 `PageReadState` 的 skeleton 保持为页面局部加载。
- **登录／首次设置**：`stage === loading` 及由其初读失败形成的 `error` 使用共享画面；真实初始化和会话事实确定后，进入原 administrator/login/waiting 或合法跳转。已呈现凭据表单后的读取和提交仍由原阶段管理，不回到品牌页。

静态 HTML 到各自首读阶段沿用同一尺寸、提示和中轴。合法跨文档导航可能重新创建 DOM，但新入口视觉一致，不额外引入导航遮罩、延时或跨页面状态持久化。旧请求有效性仍由原 identity/view/generation 规则检查。

初始会话读取错误由品牌区持久说明统一承接，原会话读取通知和该初读重试的临时通知不重复显示；已进入页面后的读取及未知凭据提交继续由原通知 owner 呈现。该选择只调整展示，不退休未确认任务、解除锁或将错误标为已恢复。

备选为等全部页面数据取得后再退出品牌页：会延长整页等待并阻挡安全导航；因此在目标页面可确定时立即交接。

### 4. 先保证静态恢复可达，再由独立监测隐藏正常操作

静态 HTML 默认具备原生 GET 恢复表单和合法返回链接。内联监测成功安装事件和十秒检测后才设置可辨的“正常监测中”标记，CSS 仅在该状态隐藏恢复区；资源失败或接管未完成时改为异常状态并显示恢复。禁用脚本或监测本身不能执行时不产生该正常标记，保留静态中英文说明及可达操作；无外部样式时原生 HTML 恢复也可用。静态无脚本回退停止暗示仍有脚本读取进展的动效。

运行期恢复区由入口根据已有读取事实决定显隐，单次十秒读取失败立即可恢复。异常后的真实自动恢复仍使用原预算和间隔；实际请求在途可显示真实 busy，但不能因背景重试丢失失败后的恢复方向。手动读取恢复继续是原读取操作；应用接管前原生重新加载保持原路径、查询和目标，接管后不能把读取重试改为自动整页重载。独立 Desktop 的返回方向按已有模式能力提供。

备选为静态 HTML 直接给恢复区 `hidden` 再等应用显示：所有脚本失败时无法解除，违反已有启动恢复契约。也不为隐藏按钮新增外部依赖。使用内联监测时更新构建生成的 CSP hash，保留现行 CSP 策略，不添加任意 inline script/style 许可。

### 5. Work Header 的路由读取反馈

`apps/desktop-webui/src/app.ts` 的 `workRouteFeedback` 在共用 Header 中动态插入三点，超过十秒再加入文字；这会推移相邻元素。将该路由读取反馈改为不占视觉布局的可访问状态，保留当前对象、忙碌语义和慢读取文字；读取账本及原先超时、失败和恢复由原 owner 管理。Service 内容区的首次骨架、已确认 iframe、其他 Work 真实状态及生命周期反馈不由此替换。

对 Service、Files、Chat 和设置共用的 Header 验证路由读取前、中、后的几何；模拟未确认 Service 首读和失败／恢复，确认没有假空态或隐式重试。复用 Desktop 的构建链生成 Go 嵌入资源，并重新构建宿主；当前预览连接真实既有 Core，验证使用隔离合成夹具。

用户复测发现 Header 的 Core 检查槽和 Work 状态同步／生命周期状态也各自可能显示三点，原先只覆盖路由读取不完整。对 `.work-header` 内的装饰性三点统一隐藏并保留几何槽及真实文字／busy 语义；不改变请求、状态机及 Header 之外的进度反馈。验证须实际保持 Core 检查在途，并覆盖生命周期状态，不能只断言路由读取节点。

验证发现托管管理冷启动 HTML 的 Logo 仍指向根路径，需由管理入口转换到现有 `/admin/piwork-logo.png`；独立静态路径和权限规则保留。Header 隐藏三点时，同步恢复原操作标签的不透明度，避免等待期间按钮成为空白；保留固定尺寸、disabled 和 busy 语义。缺图回归另覆盖 watchdog 正常运行及应用成功接管。

### 6. 生成物与验证沿现有链路交付

维护影响按以下边界收口：

| 层／状态 owner | 来源与输入／输出 | 直接消费者与同步 | 检查 |
| --- | --- | --- | --- |
| 共享展示 | 新启动模板、`controls.css`、现有 Logo／三点；只接窄展示输入 | 三个静态 HTML、Desktop app、Console app、onboarding | 直接 import 的模板最小契约测试；两端浏览器中核对实际几何 |
| 静态恢复 | `boot-watchdog.js`、`prepare-boot.mjs`；监测标记与原生恢复表单 | 两端 HTML、内联脚本 hash、boot recovery | 原有失败／禁用脚本／样式失败／预算和旧信号回归 |
| 初始读取 | 各 app 原 session／stage／error 和原恢复操作 | 仅各自启动画面，页面数据 owner 不变 | 首读超时、成功交接、迟到结果和未确认身份浏览器回归 |
| 本地化 | `apps/ui-shared/i18n.js` 与两端实际启动词条 | 冷 HTML、本地化恢复、运行期画面 | `check-ui-language.mjs`、两端语言回归；不以译文判断状态 |
| 资源交付 | 两端 `copy-static.mjs` → `sync-*-assets.mjs` → Go 嵌入 | `internal/{desktop,console}assets/static`；setup 允许列表和 CSP；`scripts/build-cli.mjs` 两端输入 hash 包含新共享模板 | `make check-generated-ui`；真实 Go handler 的模块、HEAD、CSP 和图片检查 |

协议、数据库、镜像初始化、默认端口和生产部署材料不受影响，无需新增协议生成链、部署文档修改或真实 Docker Work 生命周期验收。

## Risks / Trade-offs

- [共享样式波及业务区域] → 使用独立启动作用域；保留管理页面和 Work 列表局部占位的回归。
- [接管前后短暂露出另一套布局] → 构建和运行期复用模板，以暂停初始读取的浏览器场景比较 Logo、提示和三点的位置；不以人为延时掩盖。
- [隐藏按钮导致无脚本无法恢复] → 原生恢复默认可达，独立监测正常安装后才隐藏；覆盖脚本全禁用及监测失败负例。
- [异常说明变长或按钮出现推移主元素] → 独立恢复区与固定主锚点，双语、360px、矮视口分别核对；空间不足时允许纵向滚动。
- [新增共享模块在 setup 真实入口返回 404 或 CSP 不匹配] → 同步精确公开列表、传递依赖、两端复制和 hash；使用真实 handler 核验，静态测试服务器不能替代。
- [展示重构误接管认证或导航] → 原 adapter／onboarding owner 决定状态和操作，模板不引入请求或状态机；恢复不重放写入，旧响应仍按原上下文丢弃。
- [仅凭源码判断视觉问题] → 本轮事实限于源码和规格，实施时进行真实浏览器视觉核验；规划完成不等于验收通过。

## Migration Plan

1. 按任务完成共享展示、三个静态入口及三种运行期接管，生成和提交对应嵌入资源。
2. 先运行相关类型、契约和浏览器检查，再用重建后的真实 Go 入口确认所有模式的资源和交接。对源码样式或文案的后续修改也须重新构建 WebUI 和宿主。
3. 本地预览使用独立 `dist/` 数据目录及未占用的 UI/Core 端口：先 `npm run build -w @piwork/desktop-webui -w @piwork/console-webui`，再 `make build-go`，以 `dist/go/piwork-core --data-dir <独立目录> --ui-port <空闲端口> --core-port <空闲端口>` 启动；通过网页用合成账号初始化，核对登录、管理、首次设置与工作台。沿用现有真实 Core/CLI 测试夹具检查独立 Desktop，不读取用户凭据。
4. 用桌面与 360px、中文与英文、减少动态效果完成正常／异常画面对比。临时截图和日志写入忽略的 `dist/`，必要验收附件归本变更并仅记录真实已测／未测结果。
5. 无数据迁移。回退时将源模板、启动样式、入口、复制／允许列表与对应生成资源作为完整变更回退后重建宿主，避免新旧资源混用；不自动执行外部发布。

## 当前验证状态

原整页启动的 12 项任务已完成，以下记录适用于原范围。新增 Work Header 任务和其验证单独记录在任务列表及本节末尾。应用接管前后共用 `startup-shell.js`；正常启动隐藏恢复操作，失败在品牌区说明并停止等待动效，首读失败不额外重复通知；恢复按钮沿用现有共享 Button 样式。原读取、身份、未知提交和自动恢复预算继续由原 owner 持有。

| 检查 | 实际结果 |
| --- | --- |
| 两端 build、typecheck | 通过 |
| Console 单元 | 163 项通过 |
| 共享单元／受影响构建与边界契约 | 67 项通过，包含新共享模块的逆向依赖／循环负例及两端 startup 输入 hash 变化 |
| Console `test:browser` | 最终 276 项通过 |
| Desktop `test:browser` 全量 | 执行 1625 项：1620 通过、4 失败、1 项可选真实 Engine 场景跳过；4 项均已修复并在下列最终定向复测通过 |
| Desktop 最终定向复测 | `local-auth`、`pending-dots`、`workspace-hierarchy`、`admission-feedback` 共 80 项通过；真实 `onboarding` 的两项失败场景另行复测通过，覆盖全量中的全部 4 项失败 |
| 真实 Go / CLI 冒烟 | 重建的 Go 入口与生产 CLI Desktop，五种入口 × 中英文 × 1920/360px 共 20 组 pending／失败／只读恢复通过；Logo 实际可达、主锚点稳定、恢复不产生写请求 |
| 补充视觉／恢复 | 390×844 与 360px 的中英文、减少动态效果、正常／异常位置、脚本禁用及键盘原 URL 恢复、模块失败、Logo 失败、矮视口长错误通过 |
| Go 与生成 | `go test ./internal/webapp`、`make check-generated-ui`、`make build-go` 通过；内嵌 HTML、共享模块、样式、CSP 与源一致 |
| 维护检查 | native-boundary、webui-boundaries、ui-language、repository-docs、source-style 与 diff whitespace 检查通过 |

Desktop 全量中的两项失败依赖旧的启动错误标题／Sign in 链接，已改为品牌区原因和只读恢复契约；另两项是 HEAD 中已有的 `workspace-hierarchy` VM 夹具漏接 `thinkingName`，只补齐现有生产辅助函数的测试接线，产品聊天逻辑未修改。最终微调后采用上述 82 项定向复测与 Console 完整回归，未再次执行整个 Desktop 全量。可选真实 Engine／Work 生命周期不属于本变更验收，未启用；未声称真实移动设备、其他浏览器或完整读屏矩阵已测。

执行环境使用本机已有 Node 24.20 和缓存 Chromium；默认 Node 24.2 的嵌套测试提前关闭浏览器问题经最小用例核实。Go 构建使用当前 worktree 的精确 `GIT_DIR`／`GIT_WORK_TREE`，避开上级 `/home/p/.git` 空目录的误识别，不更改用户 Git 配置。初次并行资源再生成曾影响测试编译目录，之后固定先生成／构建再执行完整测试；最终结果不采用受影响的那次输出。

实施追加核对的边界为 Desktop app 的首读分支、`syncNotices` 与 `startupSessionVisible`，Console app 的 `startConsole`／首读展示与 locale 回调，onboarding 的 loading/error、`tell` 和 `updateLocks`，共享 template／watchdog／prepare-boot／控件 CSS，`scripts/build-cli.mjs` 的两端输入清单及其直接合成测试消费者，以及 Go setup 精确资源公开与模块图测试。没有引入外部依赖或需要全量重构的状态所有权变化；唯一被迫涉及的其他功能是上述已有 Run 详情测试夹具。

代表性实际截图如下，均来自隔离 Go 安装和合成账号；临时完整矩阵、日志和检查输出在忽略的 `dist/startup-loading/` 与 `dist/startup-*.log`，Core 数据和 CLI 凭据在冒烟结束后已清理。

- [桌面英文正常启动](evidence/startup-desktop-en.png)
- [360px 中文正常启动](evidence/startup-mobile-zh-CN.png)
- [独立 Desktop 中文恢复](evidence/startup-recovery-mobile-zh-CN.png)
- [无脚本及矮视口恢复](evidence/startup-no-script-short.png)

## Work Header 扩展验证

第一轮扩展将 `workRouteFeedback` 改为现有 `sr-only` 的可访问状态，并移除不再需要的 `.work-read-feedback` 视觉样式；Work 状态、Service 入口、读取账本及恢复仍由原模块负责。新增 UI 规格明确该路由读取反馈是通用可视三点及十秒提示的局部例外；真实超时和失败仍显示所属原因和只读恢复。

- Desktop 受影响定向检查 14 项通过：Service、Files、Chat 和设置在 1920px 与 360px 的读取前后 Header 几何一致；覆盖慢读取的可访问标签、Service 初读骨架、失败及只读重试、已有 iframe 的稳定性。
- 另外执行保留 Service iframe、Session、文本／图片草稿和阅读位置的浏览器回归，1 项通过。
- 两端 typecheck、`make check-generated-ui`、`make build-go`、`go test ./internal/desktopassets ./internal/webapp`、native-boundary、webui-boundaries、ui-language、repository-docs、source-style、OpenSpec strict 和 `git diff --check` 通过。Go 构建继续使用当前 worktree 的 `GIT_DIR`／`GIT_WORK_TREE` 以避开上级空 `.git`。
- 截图为隔离合成夹具：[桌面 Header](evidence/work-header-1920-pending.png)、[360px Header](evidence/work-header-360-pending.png)。未另做真实读屏器或其他浏览器验证。
- 保留既有 17891 Core 及 17892 预览，另以本地 17893 的新 CLI Desktop 连接同一 Core；验证入口和新版脚本均为 HTTP 200。未停止用户 Work、读取其内容或重启原 Core。

### 用户复测后的补充修正

用户反馈 Work Header 仍有三点。复核发现 Core 检查槽和 Work 状态同步／生命周期反馈均可独立显示三点，第一轮只验证路由读取而遗漏了这些来源。现在只在 `.work-header` 内隐藏装饰性三点并停止其动效，保留原固定槽、状态文字、busy 和错误恢复；Header 之外的反馈不受此样式影响。

- 15 项定向回归通过，包括真实进行中的 Core 检查、Work Stop 生命周期任务、Service 首读／入口失败、iframe 保留，以及 Service、Files、Chat、设置在 1920px／360px 的 Header 位置。
- 两端 typecheck、`make check-generated-ui`、`make build-go`、`go test ./internal/webapp` 和 native-boundary、webui-boundaries、ui-language、repository-docs、source-style、OpenSpec strict、diff 检查通过。此次未重新运行 Desktop 全量浏览器套件，也未声称真实读屏器已测。
- 重编译后的托管预览运行于 `100.64.0.7:17895`，连接现有 Core；使用独立浏览器会话目录，未停止 17891 Core、原预览或用户 Work。登录入口和启动模块返回 200，已核对新版 Header 样式包含在该预览二进制中；未读取用户 Work 内容。


## WARN 修复验证

- 管理冷启动 HTML 的 Logo 由托管 Console 转换为 `/admin/piwork-logo.png`，权限继续通过真实管理路由判定。真实 Go handler 回归先复现 `/admin` 的 404，修复后检查 `/setup`、`/login`、工作台及管理入口实际 HTML 引用的 PNG 均返回 200，匿名管理 Logo 请求仍被重定向。独立合成 Core/托管入口和真实浏览器确认管理冷启动 Logo 的尺寸与图片加载成功：[管理冷启动截图](evidence/warn-admin-cold-logo.png)。
- Work Header 的 `action-pending-label` 在等待时恢复可见，三点继续隐藏；只改变展示层，不改变 busy、disabled、请求锁或待确认状态。真实浏览器中的延迟 `check-work` 回归在修复前测得透明度 0，修复后在 1920px 和 360px 均测得 1，按钮和邻近布局不移动、不可重复触发：[360px 截图](evidence/warn-header-check-360.png)。
- watchdog 已安装且 Logo 请求失败时，Desktop、管理和 setup 三种入口均可正常交给应用且不自动重载；相关完整启动恢复测试 27 项通过。Desktop Header、生命周期和 Service 相关定向回归 14 项通过。`go test -count=1 ./internal/consoleapp ./internal/webapp`、两端 typecheck、`make check-generated-ui`、`make build-go`、共享启动单测及 native-boundary、webui-boundaries、ui-language、repository-docs、source-style、OpenSpec strict、diff 检查均通过。
- 本次未重跑整个 Desktop 浏览器全量或使用真实读屏器。17891 现有 Core 进程保持运行；重建的宿主尚未替换运行中的进程。上次验证的共享 `feedback-primitives.js` 输入哈希建议不属于本轮用户指定的 WARN，仍待后续处理。
