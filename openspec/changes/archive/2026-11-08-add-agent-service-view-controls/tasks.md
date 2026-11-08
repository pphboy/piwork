# Tasks

## 1. Agent 工具与请求契约

- [x] 1.1 在 `packages/contracts/src/` 定义两个工具名称、严格参数和版本化请求契约，加入合法/非法 ID、端口、未知字段、版本、动作及大小的合成夹具；验证 contracts 单元测试通过，文本结果小于 1 KiB，不引入新的 proto、HTTP 顶层 Schema 或 history 字段（ASVC-001/002/003/007）。
- [x] 1.2 新增 `apps/agentd/src/service-view-tools.ts` 并接入 `application.ts` 的 Run customTools、active tools 和 resolvedTools，按 active allowed/denied 过滤并预留全部原生名称；同步工具模块及装配测试，验证禁止工具不可调用、包名称冲突被拒绝、非法输入/已取消 Run 不产生指令，原十二个 Service MCP 工具及七个 SDK 基础工具职责不变；同步 `internal/workruntime` 的原生名称准入，并运行旧 Agent、禁止工具及未知工具的 Go 正反例（ASVC-001/002/008）。
- [x] 1.3 在 `package-resources.ts` 增加简短平台使用指导，并为 `packages/pi-adapter/src/deterministic-model.ts` 增加真实 SDK 的视图工具探针；在同组 SDK 测试中验证有/无脑包、工具实际发现及调用、结果经过公开预览仍完整，并明确请求生成不代表浏览器或业务验证完成（ASVC-001/002/007）。

## 2. 原页面来源与事件消费

- [x] 2.1 新增浏览器 `service-view-controls.ts`，通过窄接口实现指令解码、页面内原 Run 资格和调用去重；直接 import 模块测试，验证两个页面的资格互不共享、错误/截断/未知版本/其他工具及 Assistant 文本不执行、忽略的请求不在后来重新执行，并验证工具调用 ID 按不透明字符串处理（ASVC-006/007）。
- [x] 2.2 在真实 `DesktopAdapter` 提交、原键只读查明及事件读取入口接线，确保原 Run 登记早于事件消费，并在身份变化、离开 Work、终态和页面失效时按设计清理；新增真实 adapter 单元契约测试，覆盖快速完成、接受响应丢失、只读查明、重连重复、历史恢复与外来 Run，确认观察行为不产生来源资格或新提交（ASVC-002/006/007）。

## 3. 定向选择与刷新

- [x] 3.1 为 `app.ts` 接入具名 Select 操作，复用当前 Work 的 Service 目录、端口、普通 Services 导航及未保存保护；同步目标解析单元测试和 Playwright 用例，验证 A/B/C 中准确选择 B、同一目标不重载、默认/显式多端口、刚创建对象的一次目录读取、不可用原因、草稿保护及晚到准备结果不覆盖新选择（ASVC-003/004/007/008）。
- [x] 3.2 接入 Refresh 操作，开始和异步返回时都检查原挂载目标与访问资格，只重载已展示的准确 Service/端口，沿当前合法入口处理来源隔离，不重用已消费 ticket；同步真实 iframe 的 Playwright 用例，以文档标记和加载次数验证 B 刷新、A 不刷新、未展示目标被忽略、无新增确认框或工作台重载，Chat/Activity/Session 与 Run 观察保持（ASVC-003/005/007/008）。
- [x] 3.3 增加同一 Work 双页面、页面重载、离开后返回、身份变化、重复事件、历史读取及 CLI/Service 来源的浏览器负例；通过可见 Service 名称、iframe 文档标记及请求记录确认只原发起页面至多执行一次，不自动补发、打开外部窗口或提交生命周期操作（ASVC-002/006/007/008）。

## 4. 构建与跨模块验收

- [x] 4.1 执行对应 contracts / pi-adapter / agentd 单元测试和三个受影响 workspace 的 typecheck，运行 Desktop 浏览器测试及与 Service 选择、Focus 保留和导航草稿相关的回归；验证 `check-native-boundary.mjs`、`check-webui-boundaries.mjs`、`check-ui-language.mjs` 和触达源码风格检查通过；新增模块测试不得通过正则抽取 app/adapter 源码运行。
- [x] 4.2 通过 Desktop workspace 构建与 `scripts/sync-desktop-assets.mjs` 同步嵌入资源，执行 `make check-generated-ui` 和 `make build-go`；若契约实际触及生成链则执行 `make generate` 及对应检查。核对源码/内嵌模块完整一致，无无关 Console、部署说明或发行材料改动。
- [x] 4.3 在既有真实 Core/Docker/Playwright 验收入口增加定向场景，以确定性模型经真实 Pi SDK 调用两个工具，覆盖两个 Service、双页面和一次刷新；分别验证托管路径入口与独立 CLI Desktop 来源隔离入口。复用 `apps/desktop-webui/test/real-core.mjs` 等现有安装夹具并给出可复跑入口，确认请求沿原工具事件链抵达、只有原页面改变、无需新 RPC/队列/回执；仅用独立安装和合成数据，临时证据放 `dist/`，精确清理该安装资源，并在本变更现有产物中记录真实通过/失败/未测范围。
