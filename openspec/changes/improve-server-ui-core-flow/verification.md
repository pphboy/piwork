# 实施与验证记录

当前适配基线：v0.0.8 main `9a40d4443fee559335485744d0aabbf186e24b38`。初版 PR 基线为 `efce08c228c12f10d18a968b69c3398bb0e783e1`。下文初版结果保留为历史证据；本次上游适配以本节新结果为准；初版结果仅保留为历史证据。

## 1. 范围与结果

- 四模块：首设界面、QuickStart、管理体验、共享Pending。具体31位置对应代码和测试见 [pending-map.md](pending-map.md#5-本次实际接入与复用验证)。
- D1：本次用户主动保存首设后，当前配置仍匹配且六项完整Ready，最多自动进入工作台一次；既有Ready、管理、刷新、离开、改稿、unknown不建立或继续导航意图。
- D2原生启动授权link移出本轮；D3仍创建后手动正常登录。没有Go/Core/后端认证或运行逻辑修改。
- 新空模型默认`deepseek-flash`、`anthropic-messages`、`https://api.deepseek.com/anthropic`，仅Key默认显露。自定义配置不覆盖；只用合成值，未调用付费模型。
- 两端资源经原copy-static/sync脚本生成；`internal/*assets/static`仅为对应UI嵌入资源。

## v0.0.8 适配验证（2026-10-20）

实现提交：本地 `148c716e2dcf1a96d4e74e3d3b6339c121423c1a`，已发布同内容的远端 `058a96090f86fca1db956bdb9020a59b5358d28f`，实现 tree `f0afb0db3a32c45813b61b1ffdb88b854b297794`。合并保留原 PR 与 main 两个父提交；相对 main 的所有产品改动仍仅为 UI、对应测试与生成 UI 资源，Core/CLI/后端认证/contracts/scripts/deploy 字节与 main 完全一致。

- 采用 v0.0.8 普通 `state/session`、CSRF 与自动浏览器 Cookie 确认；旧 `#setup` / `#ticket` 只清除，不调用已移除的设置授权或浏览器授权端点。
- 创建管理员后仍清空密码并手动登录；未知创建、并发 409 只读回，不自动重发。补齐 CSRF 恢复、state/session 失败、pagehide/pageshow 后旧创建/登录/退出响应不清除新草稿或解新锁的合成回归。
- 补充一条实际前端导航 `/setup → /login → /admin/setup` 的合成链路：创建、手动成功登录、Key-only 保存、六项分别非 ready 均阻止完成、全部 ready 仅一次导航回调。断言仅四次明确写入，密码/Key 不进入浏览器存储；不是原生 Core 端到端验收。
- Desktop 保留上游 sessionCreated 的 Cookie 读回与中断重试，并沿原身份代次将 Core 检查归属本次接受的会话，旧响应不终止新等待。
- 独立审查确认上述归属与恢复逻辑；发现的旧 Console 授权夹具已改为普通会话，未回滚产品契约。视觉复核另修正初次 Core 检查期间页脚把未知列表显示为 `0 Works`：现在显示 `Works not yet read`，确认空列表后才显示 0，并在同一延迟 Core 浏览器测试断言两阶段。

| 最终不重复计数的检查 | 结果 |
|---|---|
| Console QuickStart / 首设 / 会话及完整合成链路 | 44/44 通过 |
| Console feedback + management | 94/94 通过 |
| Desktop 六个可运行 browser suite | 338/338 通过，0失败/跳过 |
| Desktop 24个非浏览器 unit/渲染契约 | 524/524 通过，0失败/跳过 |
| 两端 typecheck/build、Desktop 测试编译 | 通过 |
| OpenSpec strict、repository-docs、native-boundary、diff空白 | 通过（最终复查） |
| UI嵌入资源逐文件hash | Console browser12/public4、Desktop browser23/public4，全部相等 |

最终 Console 命令与初版相同，但一次执行 `quick-setup.spec.mjs feedback.spec.mjs management-flow.spec.mjs`，总计138。最终 Desktop 浏览器使用相同六个文件，`--test-concurrency=3`；unit仍为下文24文件、`--test-concurrency=2`。本轮日志位于忽略目录 `dist/ui-review/*-upstream*.log`。此前一次 Desktop 338/338 与 Console137/137是中间验证，不与最终结果相加。

发布核对（2026-10-20 04:32 UTC）：GitHub connector发布的实现tree与本地Git tree完全一致，保留父提交 `8b271841` 与 `9a40d444`；`git ls-remote`确认分支已指向 `058a9609`。PR #3仍open、Draft、未合并，GitHub报告mergeable=true。最终规格/截图作为单独文档提交，不改变已测试产品代码；未部署或归档。

最新普通首设页面（390px，真实构建前端+合成API）：

<p align="center"><img src="evidence/create-administrator-narrow.png" alt="普通会话创建管理员：合成API，真实UI" width="390"></p>

未测边界保持：没有 Go 编译器或原生 Core/CLI 二进制，`/usr/bin/go` 是同名棋类应用而非 Go 工具链；没有运行原生认证/Core/Engine/Docker集成、Go宿主重建或付费模型请求。本 PR 不以 mock 的138/338结果替代这些未测项。当前仓库没有 `.github/workflows`；远端实现commit的查询返回 `statuses: []`、`workflow_runs: []`，没有CI通过结论或可等待的运行。

## 2. 初版验证命令与结果（8b271841）

执行环境：Node 24.19、npm 11.9、云桌面原生Chromium。exec环境无法建立Chromium单实例socket，浏览器测试在同一云桌面Terminal正常执行，没有关闭安全机制或发布公网fixture。API均由测试夹具提供，使用真实构建的前端页面。

| 检查 | 最终结果 |
|---|---|
| 两端typecheck/build、Desktop测试TypeScript编译 | 通过 |
| Console QuickStart合成浏览器 | 28/28通过 |
| Console既有feedback及新增management-flow | 94/94通过（65+29，不含重复轮次） |
| Desktop全部可运行浏览器suite | 6个文件，335/335通过，0失败/跳过 |
| Desktop全部非原生unit/渲染契约 | 24个文件，525/525通过 |
| OpenSpec strict、文档归属、native-boundary、diff空白 | 通过（最终复查） |
| UI嵌入资源逐文件hash相等 | Console browser12/public4、Desktop browser23/public4，全部相等 |

构建：

```sh
npm run typecheck -w @piwork/console-webui -w @piwork/desktop-webui
npm run build -w @piwork/console-webui -w @piwork/desktop-webui
npx tsc -p apps/desktop-webui/tsconfig.test.json
```

Console的云环境只读测试配置沿用`apps/console-webui/playwright.config.mjs`，仅将`use.channel`置空、`launchOptions.executablePath`设为`/usr/bin/chromium`，testDir保持原目录；临时配置位于被忽略的`dist/ui-review/playwright.config.mjs`。标准安装可直接使用原配置与其已安装Chromium。

```sh
PIWORK_TEST_BROWSER_BIN=/usr/bin/chromium PIWORK_UI_EVIDENCE=1 \
  npx playwright test -c dist/ui-review/playwright.config.mjs quick-setup.spec.mjs --reporter=line
PIWORK_TEST_BROWSER_BIN=/usr/bin/chromium PIWORK_UI_EVIDENCE=1 \
  npx playwright test -c dist/ui-review/playwright.config.mjs feedback.spec.mjs management-flow.spec.mjs --reporter=line
PIWORK_TEST_BROWSER_BIN=/usr/bin/chromium PIWORK_UI_EVIDENCE=1 PIWORK_PENDING_EVIDENCE=1 \
  node --test --test-concurrency=2 \
  apps/desktop-webui/dist/test/{feedback,local-auth,preferences,recovery,final-acceptance,pending-dots}.test.js
```

最终unit命令（24个文件）：

```sh
node --test --test-concurrency=2 \
  apps/desktop-webui/dist/test/action-hierarchy.test.js \
  apps/desktop-webui/dist/test/action-state.test.js \
  apps/desktop-webui/dist/test/chat-markdown.test.js \
  apps/desktop-webui/dist/test/chat-projection.test.js \
  apps/desktop-webui/dist/test/compact-work-controls.test.js \
  apps/desktop-webui/dist/test/completion-exits.test.js \
  apps/desktop-webui/dist/test/continuity-adapter.test.js \
  apps/desktop-webui/dist/test/control-adapter.test.js \
  apps/desktop-webui/dist/test/control-rules.test.js \
  apps/desktop-webui/dist/test/draft-revision.test.js \
  apps/desktop-webui/dist/test/export-adapter.test.js \
  apps/desktop-webui/dist/test/export-admission.test.js \
  apps/desktop-webui/dist/test/export-flow.test.js \
  apps/desktop-webui/dist/test/file-admission.test.js \
  apps/desktop-webui/dist/test/file-results.test.js \
  apps/desktop-webui/dist/test/lifecycle.test.js \
  apps/desktop-webui/dist/test/modal-presentation.test.js \
  apps/desktop-webui/dist/test/navigation-review-regressions.test.js \
  apps/desktop-webui/dist/test/overlay-role.test.js \
  apps/desktop-webui/dist/test/pause-projection.test.js \
  apps/desktop-webui/dist/test/pending-adapter.test.js \
  apps/desktop-webui/dist/test/work-navigation.test.js \
  apps/desktop-webui/dist/test/workspace-hierarchy.test.js \
  apps/desktop-webui/dist/test/workspace-layout.test.js
```

上述浏览器组与unit组不重叠，不以多轮测试计数相加冒充覆盖量。详细临时日志保留于`dist/ui-review/`并包含在恢复包。

## 3. 独立审查与失败修复

真实实现问题均修复后增加针对回归，未用删除断言掩盖：

1. Quick setup首次目录读取失败后恢复重建表单，丢Key/焦点：只对未编辑首次基线重建；编辑过原位更新，断言同DOM、Key、焦点、选区。
2. 管理unknown保存后普通Refresh抹掉只读恢复入口但仍锁住Save：保留原未确认状态、锁及读回入口，覆盖成功/失败刷新。
3. 独立Console自身401递增identityEpoch，被旧响应guard丢弃：先正确处理本会话失效，同时旧请求不得登出新管理员；覆盖Runtime、Default Work、Operation、Model与新身份。
4. Desktop同浏览器session generation更新中断Core检查：本请求接受的新会话继续检查；外部身份/认证变化仍淘汰旧请求。
5. Activity混合失败与运行工具没有动画、或读取失败的旧Run仍动画：按当前有效观测显示唯一主等待，保留错误与恢复，覆盖mixed工具和独立Run证据。
6. 同Dialog body/footer出现重复等待：限定同一Dialog与原action归属，新增两个Dialog隔离回归。
7. 完整模型管理的Test缺10秒说明：复用记录时间、局部刷新和view/identity清理；虚拟时钟验证摘要与打开弹窗，终态不继续动画。

扩大回归首次500例中29失败分类：19项为源码提取测试未注入新纯渲染helper；6项为原skeleton/固定icon结构断言与新局部三点不符；4项为浏览器旧等待文案/位置选择器。夹具改为提取真实helper，保留原锁、焦点、布局、独立对象和晚响应断言；浏览器新增唯一三点、开始/结束与不污染新Modal的断言。修正后已在最终完整6个浏览器suite（335/335）与24个unit文件（525/525）分别验证，未将中间定点重跑加总。

## 4. 明确未验证

- 当前无可用Go编译器或已构建原生Core/CLI。`browser.test.ts`、`native-auth.test.ts`、`onboarding.test.ts`及Console `console.spec.mjs`依赖原生二进制，本轮未运行。
- 未执行真实Core/Docker初始化、镜像拉取、Work容器生命周期、后端认证集成、`make build/test`或生产部署；没有为本次UI扩大环境建设。
- 未配置真实Key或发送真实模型请求。provider路径测试使用既有Messages SDK注入合成fetch，仅验证`/anthropic/v1/messages`和默认序列化。
- 静态壳只在HTTP已监听后存在；没有声称浏览器能在Core监听前显示启动页。
- UI嵌入资源已同步，但无Go宿主重建；PR/CI应在既有具备Go/Docker的环境运行原生集成。此限制不是本地通过记录。

## 5. 图示证据

以下均为本次真实构建UI、合成API；无真实Key/密码/个人数据。截图用于观察布局，状态正确性依赖测试断言。

### S04 · Key-only Quick setup（1440px）

<p align="center"><img src="evidence/quick-setup.png" alt="Quick setup：合成API，真实UI"></p>

### S07 · 准备主状态与折叠六项（390px）

<p align="center"><img src="evidence/preparing-narrow.png" alt="Preparing：合成API，真实UI" width="390"></p>

### S08 · 管理入口与返回工作台

<p align="center"><img src="evidence/overview.png" alt="Overview：合成API，真实UI"></p>

### S09 · 当前Runtime维护（360px）

<p align="center"><img src="evidence/runtime-narrow.png" alt="Runtime：合成API，真实UI" width="360"></p>

### D02 · Core请求等待（非启动器）

<p align="center"><img src="evidence/core-checking.png" alt="Core connection：合成API，真实UI"></p>

### 共用三点 · 真实Chromium录帧

<p align="center"><img src="evidence/shared-pending.gif" alt="共享三点：真实Chromium录帧"></p>

共享测试通过真实requestAnimationFrame采样校验1.2秒opacity、固定24×16槽及邻居几何不移动；GIF由同一浏览器截图序列编码，仅作视觉佐证，不是设计生成图。

## 6. Verify总结与交付

- Completeness：8项Requirement/64个Scenario均有实现或明确保留契约，31位置接入完整；任务仅按最终结果勾选。
- Correctness：合成UI和单元边界以最终测试为准；真实Core/认证/Docker集成未验证，原因见上。
- Coherence：复用ActionState和既有代次/对象锁，纯UI渲染helper；不引入新的全局Pending状态框架或导航状态机。
- 本地可运行验收完成；[Draft PR #3](https://github.com/pphboy/piwork/pull/3)已发布，未合并。未自动合并或部署；不自动归档本change。


### 发布核对（2026-10-20 03:09 UTC）

- 普通git push因本地无HTTPS凭据失败，改用已连接GitHub connector发布，没有创建或配置凭据。
- 四个功能/规格提交的每棵远端tree均与本地测试提交相同；最终实现tree为`42b9f370d5874379feafd3b3f05253c27cf6ee75`，发布HEAD为`1d9925db42781060d8e3814a4c7fbc4130f5c648`。connector生成作者/时间元数据，因此commit SHA与本地不同，不是内容差异。
- 远端基线仍为`efce08c228c12f10d18a968b69c3398bb0e783e1`；独立复核PR open、Draft、未合并，63文件范围仅UI/test/generated UI assets/OpenSpec。
- GitHub首次核对返回`statuses: []`及`workflow_runs: []`，当前仓库也没有`.github/workflows`目录。没有CI通过结论或正在运行的CI可监控；真实Go/Core/认证/Engine仍未验证，继续保持Draft。
- 本节与task 4.8的收尾为后续纯文档提交，不改变已测试实现tree中的任何产品或测试文件。没有合并、部署或归档。

## 7. 同日页面收敛与重建验收（2026-10-20）

### 来源与范围

此前未发布工作区（最后记录为0fba29e）及其本地bundle已不可取得。本次重新克隆并核实 PR 基线 `3fe9f14975850de1015eaaa65ccc3acd72e123f9`，main仍为 `9a40d4443fee559335485744d0aabbf186e24b38`。这是按原需求和新反馈重新实现，不是原未发布提交的逐字恢复，不能引用旧测试数字证明新代码。

当前功能提交：`d0206b7`（Quick setup安全回读）、`5943020`（菜单连续性）、`db70b3e`（Works加载/错误）、`d552ccb`（导出明细）。与main相比不含Go/Core、后端认证/运行、contracts、scripts或deploy修改；仅UI源码、前端测试、已有生成UI资源及本change。

- Quick setup模型页移除常驻 Read current state、Manage AI models 和 Runtime diagnostics，准备页/完整管理原入口保持。未知结果及目录失败由原五秒更新走完整只读核对；正常读取仍轻量。仅未解决unknown警告有 Review saved models，不在普通错误/目录错误/正常页面重加入口。Test与写入保持锁，不重发修改，不恢复自动导航。
- Works首次未确认采用立即可见的静态骨架，保留Core局部等待。首次失败只留中间原因和Retry loading；已确认行/确认空集合刷新失败仍有反馈。初始Core检查失败而从未读取Works时显示Works have not been read，不冒充空列表或搜索无结果。
- 同页状态读取保留Console账户/窄屏导航展开、DOM、焦点和ARIA；新视图或身份仍关闭。Overview未完成项不写成已完成。
- Starting export明细的操作链接曾被通用复制图标样式限制为27×27px；仅导出明细恢复全宽、自适应高度，长ID可换行且行高增长，Snapshot/原链接与状态完整保留。补状态与说明间的空格。Details默认折叠、Pause/Hide、下载及原Operation语义不变。

### 复核发现及对应回归

1. 新模型unknown恢复后不可借用另一个旧Runtime直接进入准备，多个匹配仍要求明确选择；VM契约和浏览器覆盖。
2. 读取失败不得覆盖保存拒绝，随后健康读取只清除自己的错误；单独读错误槽及连续失败/恢复回归。
3. SVG被DOM规范化会使字符串比较失效，重复相同失败导致恢复链接重建丢焦点；按节点身份与生成markup缓存，真实浏览器和序列化契约验证。
4. 重复unknown警告、未知状态下可触发Test、菜单ARIA重置、初始Works未确认误显搜索空态均有对应断言，不调整Core状态机。
5. 导出长UUID及192字符token在1440/360px逐行核对文字/按钮边界、不重叠、不横向溢出。滚动后Check status和Pause完整处于正文可视区、位于footer之上、中心点命中原按钮，聚焦后仍无遮挡；截图回到顶部，不代表下方控件不可到达。

### 当前重新执行的验证

- Console最终不重叠浏览器覆盖：feedback/management 97项（完整150项运行中的该分组）+最后Quick setup/onboarding/session 54项，共151项；全部通过，无失败/跳过。追加初始读失败保留原因的回归后，Quick组已单独完整重跑，不把150和54相加。
- Console生产函数恢复契约38/38通过；Desktop24个非浏览器文件531/531通过。
- 导出呈现专用文件2/2通过（1个生产渲染契约、1个浏览器宽/窄布局与可达性场景），包含最终文字分隔及滚动命中断言。
- Desktop原有六个可运行浏览器suite最终完整运行341/341通过，0失败、取消或跳过；于2026-10-20 11:04:12 UTC完成，包含最终导出样式/文字。
- 两端typecheck/build、Desktop测试编译、43个嵌入资源逐文件manifest/hash、native-boundary、repository-docs、OpenSpec strict、git diff --check通过。所有当前可运行组已完成，不把开发过程的重复运行累加为覆盖量。

实际命令沿既有入口：`npm run typecheck -w @piwork/console-webui -w @piwork/desktop-webui`，`npm run build -w @piwork/console-webui -w @piwork/desktop-webui`，`npx tsc -p apps/desktop-webui/tsconfig.test.json`；Console运行quick-setup/feedback/management-flow三文件，Desktop运行feedback/local-auth/preferences/recovery/final-acceptance/pending-dots六文件和新增export-presentation。浏览器指定系统Chromium；直接执行器启动遇到socket限制，使用正常云端Terminal运行，未绕过被拒绝的文件或发布操作。开发中被新导出修复替代的中间运行被停止，不算通过或累计覆盖。

### 明确未测与发布边界

当前没有可用Go编译器（PATH中的`go`并非Go语言工具链）、原生二进制或Docker。依赖它们的Desktop browser/native-auth/onboarding与Console console.spec、真实Core/后端认证/Docker/付费模型和Go宿主重建仍未运行；未建立额外集成环境。所有截图是实际构建UI与合成API/生产渲染fixture，不是真实Core任务、真实密码/Key或付费请求。

GitHub只读核对确认[PR #3](https://github.com/pphboy/piwork/pull/3)仍open/Draft、未合并，HEAD仍为3fe9f149。发布暂停，本轮没有GitHub写入、推送、合并、部署或OpenSpec归档。本地提交与最终可恢复bundle另行交付。


### 本轮最终图示

均于本轮重新构建后在真实Chromium生成，使用合成API或真实生产渲染函数fixture；不是原生Core集成结果。宽屏为1440px，Quick setup窄屏390px，Works/Export窄屏360px。

- Quick setup移除三个常驻底部入口：[宽屏](evidence/review-20261020/quick-setup-wide.png)、[窄屏](evidence/review-20261020/quick-setup-narrow.png)。异常unknown恢复链接未出现在正常页中。
- Works首次检查骨架：[宽屏](evidence/review-20261020/works-skeleton-wide.png)、[窄屏](evidence/review-20261020/works-skeleton-narrow.png)。
- Works首次失败只留中间错误/重试：[宽屏](evidence/review-20261020/works-error-wide.png)、[窄屏](evidence/review-20261020/works-error-narrow.png)。截图等待原有临时toast自然结束，未隐藏页面元素。
- Starting export展开明细：[宽屏](evidence/review-20261020/export-starting-wide.png)、[窄屏](evidence/review-20261020/export-starting-narrow.png)。底部控件位于可滚动正文内，可达性由实际滚动/命中/焦点断言确认。
- Preparing export展开明细：[宽屏](evidence/review-20261020/export-preparing-wide.png)、[窄屏](evidence/review-20261020/export-preparing-narrow.png)。
- 同页后台读取保留菜单：[账户菜单](evidence/review-20261020/account-menu-wide.png)、[窄屏导航](evidence/review-20261020/navigation-menu-narrow.png)。

### 本轮Verify结论与恢复交付

- Completeness：当前8项Requirement / 72个Scenario，新增页面收敛与导出场景均有实现和定向回归；历史契约保留，不把原生未测记作通过。
- Correctness：最终Console浏览器151项、恢复契约38项；Desktop六组浏览器341项、24个unit文件531项、导出专用2项，均通过。导出2项中的1项是浏览器、1项是生产渲染契约，各分组无重复计数。
- Coherence：保留原页面代次、对象锁和读回模式，没有新增全局状态框架或Core行为。独立只读终审未发现阻塞问题或越界修改。
- 本地功能分四个提交，文档和本轮截图另行提交；完整Git bundle包含当前分支历史、源码、测试、生成资源及OpenSpec证据，可独立恢复。临时测试日志不在Git bundle内，另随验证记录压缩附件提供，避免将工作目录日志误说成Git内容。
- 恢复附件仅交回用户保存，不能视为GitHub已更新。线上PR仍为3fe9f149，发布权限问题仍待确认；不合并、部署或归档。本地bundle校验值与恢复命令在随附manifest中给出。
