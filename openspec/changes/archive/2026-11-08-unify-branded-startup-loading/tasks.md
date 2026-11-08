# Tasks

## 1. 共享品牌画面与静态启动恢复

- [x] 1.1 在 `apps/ui-shared/` 建立构建期／运行期共用的轻量启动展示模板及必要类型，复用现有 Logo、三点、视觉令牌，落实固定品牌锚点、独立恢复区与窄屏安全布局；通过直接 import 的最小契约测试验证异常文字转义、状态／busy 名称和恢复描述输出，并通过静态入口浏览器场景核对中轴、唯一主要动效及恢复区出现时的位置稳定，不引入 adapter／请求依赖。
- [x] 1.2 将三个静态 HTML 的初始画面接入 `prepare-boot.mjs` 的共享模板展开，保留原生 GET 恢复表单注入标记；同步两端 `copy-static.mjs`、新增模块依赖及 setup 精确允许列表，重新生成对应内嵌资源。更新 `pending-dots.test.ts`、`boot-recovery.spec.mjs` 中原骨架断言与静态夹具的 Logo 响应／生产等价 CSP；用两端构建及 `go test ./internal/webapp` 中模块公开、HEAD、CSP 和资源正反例验证完整依赖可达，未列入路径继续拒绝。
- [x] 1.3 调整内联 `boot-watchdog.js` 的正常／异常展示标记：独立监测成功安装后隐藏正常恢复区，失败显示原生恢复；保留十秒监测、最多两次自动重载、原间隔和接管后停止。将禁用脚本、监测本身未执行、外部脚本／样式失败、连续失败耗尽、原 URL 恢复、旧信号失效纳入原 `boot-recovery.spec.mjs` 回归；验证键盘可达、真实 busy、静态回退及更新后的 CSP hash，不放宽安全策略。
- [x] 1.4 统一冷启动与运行期的“正在打开 Piwork…”／“Opening Piwork…”及异常恢复用语，维护共享语言入口和实际受影响的两端词条；运行 `node scripts/check-ui-language.mjs` 与两端现有语言测试的启动场景，验证保存偏好、浏览器语言、存储不可用和语言模块失败时的静态双语回退，减少动态效果下三点静态。

## 2. 各入口应用接管与首读状态

- [x] 2.1 将 Desktop 首次会话 pending／unconfirmed 分支接入共享展示，恢复委托现有 `retry-session`，成功后沿原身份、Core gate 与目标路由交接；在 Desktop 浏览器测试中加入托管和独立模式的静态接管、首读成功／超时／只读恢复、旧响应晚到和快速完成场景，验证位置连续、正常按钮隐藏、不人为延时、不显示虚假身份及不重放登录。保留 Core 恢复、Works 局部骨架和独立登录方向的现有回归。
- [x] 2.2 将 Console `startConsole` 的初始占位及首读错误接入共享展示，确认管理身份后立即进入原 `shell`／`PageReadState` 页面加载；在 `console.spec.mjs` 或相邻实际入口浏览器测试中暂停 session 和页面数据分别验证阶段边界，覆盖正常／失败恢复、会话失效和旧路由响应。确认管理外壳出现后页面 skeleton 为局部占位，已有表单、焦点和导航继续可用。
- [x] 2.3 将 onboarding 的初始 `loading` 及对应初读 `error` 接入共享展示，保留 administrator/login/waiting、凭据未知、创建／登录提交及后续局部读取的原责任；扩展现有登录／首次设置浏览器场景，验证 `/login`、`/setup` 的静态接管、十秒期限、重试、未初始化／已登录的真实目标交接及原跳转参数，已进入表单后的状态更新保持输入、焦点和敏感清理，网络恢复不自动重提凭据。

## 3. 集成、生成资源与视觉验收

- [x] 3.1 执行两端集成检查：`npm run typecheck -w @piwork/desktop-webui -w @piwork/console-webui`、`npm run test:unit -w @piwork/console-webui` 及两端 `test:browser`；在前两组各自测试已通过的基础上，确认跨入口交接、语言、初始恢复和已有局部加载没有集成回归，所有失败修复后再继续。
- [x] 3.2 通过两端正常构建／同步链生成 `internal/{desktop,console}assets/static`，执行 `make check-generated-ui`、`make build-go` 和 `go test ./internal/webapp`，核对真实嵌入的 HTML、共享模块、样式、Logo、原生恢复及 CSP hash 一致。生成资源与其实现一起交付，不手改生成文件或覆写历史原型。
- [x] 3.3 使用重建后的真实 Go UI 入口和现有隔离 Core/CLI 夹具检查托管工作台、独立 Desktop、`/login`、`/admin`、`/setup`。以合成账号和本次独立数据目录完成正常启动、合法跳转、资源失败及首读超时／恢复的浏览器冒烟，验证真实模块图和 Logo 可达、正常操作隐藏而异常可恢复，保留原路由；本项不要求创建或启动 Work，不扩展为 Docker 生命周期验收或发布。
- [x] 3.4 对上述入口完成桌面与 360px、中文与英文的正常／异常视觉核验，并补充减少动态效果、矮视口、长错误、Logo 失败、脚本禁用和键盘恢复检查；比较接管前后与恢复区出现前后的 Logo／提示锚点，确认正常视口无跳动、无横向溢出且矮屏操作可达。临时截图／日志放 `dist/`，必要证据归本变更，明确记录实际通过、失败和未测范围。
- [x] 3.5 执行 `node scripts/check-native-boundary.mjs`、`node scripts/check-webui-boundaries.mjs`、`node scripts/check-ui-language.mjs`、`node scripts/check-repository-docs.mjs` 和 `git diff --check`，核对共享模块依赖方向、未认证公开路径、双语和变更文件归属；在本变更设计／任务内补充实际触达范围和检查结果，不新增独立开发报告，不将规划或构建成功作为视觉验收通过。

## 4. Work Header 路由读取稳定性

- [x] 4.1 将共用 Work Header 的路由读取三点和慢读取文字改为不占视觉布局的可访问状态，保留实际 Work 状态、Service 首读骨架及错误恢复；更新现有 Header 回归，验证请求在途、超过十秒、结束和不同路由的展示与原状态一致。
- [x] 4.2 使用合成浏览器夹具延迟 Work 路由读取，在 Service、Files、Chat 和设置相关入口核对 Header 的名称、状态及相邻控件在读取前后不因路由反馈移动；确认 Service 内容骨架、失败原因与只读重试、原 iframe 和草稿的既有保护，执行相关 Desktop 定向浏览器测试。
- [x] 4.3 构建 Desktop 并同步 Go 嵌入资源，执行类型检查、相关测试、`make check-generated-ui`、宿主重建和适用维护检查；在本设计记录实际通过及未测事实，保留既有运行实例和用户数据。
- [x] 4.4 移除 Work Header 内其他等待三点的可视呈现，保留 Core 检查、状态同步与生命周期操作的真实文字及可访问 busy；模拟 Core 检查和实际 Work 生命周期任务，验证 Header 没有可见三点、几何稳定且其他区域反馈保留。
- [x] 4.5 重新构建同步嵌入资源和宿主，运行相关单元／浏览器回归、生成一致性及 OpenSpec 校验；更新验收事实并启动连接现有 Core 的新版远程预览，保持现有运行实例与数据。

## 5. 验证发现的 WARN 修复

- [x] 5.1 修正托管管理入口冷启动 Logo 的路径，并在隔离真实 Go handler 中核对各入口 HTML 引用的 Logo 均可按原权限返回 PNG；验证未认证访问仍受保护。
- [x] 5.2 Work Header 等待时保留原操作文字，同时隐藏三点；以延迟的真实只读检查验证按钮文字、busy、几何、重复请求限制及恢复，保留其他区域的等待反馈。
- [x] 5.3 补充 watchdog 正常运行而 Logo 请求失败时应用仍成功接管、不自动重载的浏览器场景；运行受影响的 Go、浏览器与资源生成检查，在设计中记录实测结果及未测范围。
