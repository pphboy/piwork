# 实施与验证记录

基线：`efce08c228c12f10d18a968b69c3398bb0e783e1`，2026-10-20。此记录随最终测试结果更新，不将早期失败或未运行项目记作通过。

## 1. 范围与结果

- 四模块：首设界面、QuickStart、管理体验、共享Pending。具体31位置对应代码和测试见 [pending-map.md](pending-map.md#5-本次实际接入与复用验证)。
- D1：本次用户主动保存首设后，当前配置仍匹配且六项完整Ready，最多自动进入工作台一次；既有Ready、管理、刷新、离开、改稿、unknown不建立或继续导航意图。
- D2原生启动授权link移出本轮；D3仍创建后手动正常登录。没有Go/Core/后端认证或运行逻辑修改。
- 新空模型默认`deepseek-flash`、`anthropic-messages`、`https://api.deepseek.com/anthropic`，仅Key默认显露。自定义配置不覆盖；只用合成值，未调用付费模型。
- 两端资源经原copy-static/sync脚本生成；`internal/*assets/static`仅为对应UI嵌入资源。

## 2. 最终验证命令与结果

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
- 本地可运行验收完成；分模块提交、Draft PR与CI状态待发布后记录。未自动合并或部署；不自动归档本change。
