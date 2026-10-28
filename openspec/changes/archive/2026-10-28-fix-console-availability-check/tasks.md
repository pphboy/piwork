# Tasks

## 1. 补齐真实 Go 可达性接口与回归

- [x] 1.1 在 `internal/webapp` 复用真实 Core 和浏览器 Cookie 登录夹具，新增请求 `/console/api/availability` 的回归，断言 Runtime 未配置时仍为 HTTP 200 且 `reachable === true`；先执行对应 `go test -mod=readonly ./internal/webapp -run Availability`，确认当前实现因 404 失败，临时输出放 `dist/`。
- [x] 1.2 在 `internal/consoleapp/console_api.go` 实现受保护的 GET 路由及最长 5 秒 Core `/healthz` 只读探测，返回明确布尔值；同时添加管理处理器测试覆盖健康成功、非 200、断连、受控超时/取消及合法 CSRF 的非 GET 405，断言无业务写请求，执行 `go test -mod=readonly ./internal/consoleapp -run Availability` 及 1.1 回归通过。
- [x] 1.3 在真实 `webapp` 路由补充匿名/失效会话 401、普通用户 403 和前置身份验证临时断连后原会话仍可恢复的测试；执行 `go test -mod=readonly ./internal/consoleapp ./internal/webapp`，确认权限、会话和健康读取的失败分类保持，不泄漏上游错误或合成秘密。

## 2. 约束前端响应并验收交付页面

- [x] 2.1 在 `apps/console-webui/src/adapter.ts` 核验 `reachable` 必须是布尔值，沿用现有连接错误和未确认反馈；在现有 Console 浏览器测试中覆盖 false/缺失/错误类型、只读 Retry 成功清除提示、保留草稿与焦点及无新增写请求，运行对应 Playwright 用例和 `npm run typecheck -w @piwork/console-webui` 验证。
- [x] 2.2 在 `apps/console-webui/test/real-core.spec.mjs` 新增名称含 `availability` 的真实服务回归：登录后直接打开和刷新管理页，监听实际 URL 并断言 HTTP 200、布尔 true 及连接提示不存在；成功路径不模拟该接口，不要求配置模型或启动 Work。先在 Node 24 执行 `make build` 同步嵌入资源并重建宿主，构建完成后执行 `npm run test:real-core -w @piwork/console-webui -- --grep availability`，确认实际运行且未跳过，使用独立数据目录及合成凭据。
- [x] 2.3 在构建完成后的资源上执行 `npm run test:browser -w @piwork/console-webui`，核对启动恢复、有限重试、身份/视图归属及双语状态回归全部通过；测试期间不并行执行清理同一产物目录的构建。

## 3. 集成检查与实际结果核对

- [x] 3.1 执行 `node scripts/check-native-boundary.mjs`、`node scripts/check-repository-docs.mjs`、`node scripts/check-ui-language.mjs`、`git diff --check` 和 `openspec validate fix-console-availability-check --strict`；核对差异仅含本变更实现、测试、必要嵌入资源及规划，保留无关未提交内容，检查通过后在本 tasks 内记录真实验收结果和未测边界。

## 4. 修复 verify 发现的两个 WARN

- [x] 4.1 修正各层管理会话解析的错误分类：只将真实身份失效投影为 401，临时 Core 读取失败保留 502，权限不足保留 403；将内层断连复现加入真实 `webapp` 路由测试，验证原会话在恢复后可继续使用，并覆盖各层解析失败类型。执行相关 Go 全量测试及 Availability race 回归。
- [x] 4.2 将可达性读取、自动重试与当前视图代次绑定，离开后返回同一路由也必须丢弃旧成功、旧失败和旧定时器；以当前视图的新只读检查收敛连接状态。补充普通导航和浏览器历史重入、迟到成功/失败及草稿焦点保留的浏览器回归，并验证取消读取不影响新请求。
- [x] 4.3 在 Node 24 完成类型检查、`make build` 与嵌入资源同步后，顺序运行 Console 浏览器完整回归和隔离网络中的真实 Core 中英文可达性回归；复测 verify 的两个故障场景，执行原生边界、文档/语言、差异格式及 OpenSpec 严格校验，记录实际结果和未测边界。

## 验证事实（2026-10-28）

- 修复前新增真实 Go 会话路由回归，`go test -mod=readonly ./internal/webapp -run Availability -count=1` 实际以 `404 NOT_FOUND` 失败；日志为 `dist/console-availability-before.log`。补齐路由后的相同回归通过。
- `go test -mod=readonly ./internal/consoleapp ./internal/webapp` 通过；`go test -race -mod=readonly ./internal/consoleapp ./internal/webapp -run Availability -count=1` 通过。覆盖有界健康探测、取消、非 GET 拒绝、匿名/普通用户/撤销会话、临时 Core 连接失败及原会话恢复。
- Node 24 下 Console 类型检查及 `make build` 通过，前端响应校验已同步到 Go 嵌入资源；构建结束后才运行浏览器测试。
- Console 完整浏览器套件 229 项全部通过，无跳过；新增五种可达性响应/恢复用例覆盖自动重试上限、显式 Retry、草稿、焦点及只读行为。
- 使用同次构建的 `dist/go/piwork-core`，在 `unshare -Urn` 创建的独立网络命名空间内启用 loopback，以 `PIWORK_TEST_NATIVE_CORE` 指定真实宿主，运行 `npm run test:real-core -w @piwork/console-webui -- --grep availability`。中英文两项均实际执行并通过，无跳过：独立数据目录、普通 Cookie 登录、Runtime 未配置，首次打开和刷新均收到真实 `200 {"reachable":true}`，应用处理后无连接告警。成功路径未模拟该接口。
- 原生源码边界、文档归属、UI 语言检查、差异格式和本变更 OpenSpec 严格校验通过。原有未提交文件未纳入本变更。
- 验收边界：本轮真实浏览器为 Linux Chromium；未执行 Windows GUI 验收。原有 `27991` 预览有运行中的 Work，仍保持旧进程，尚未重启加载本修复；隔离验收不使用该预览的凭据或数据。

### verify 两个 WARN 的修复复测（2026-10-28）

- 内层断连的正式 Go 回归在修复前实际返回 `401 AUTHENTICATION_REQUIRED`（`dist/console-availability-warn-auth-before.log`）；修复后返回安全的 502，原浏览器登录能够恢复。各层解析器对网络、超时、意外错误及真实 401/403 的分类均有正式测试；相关 Go 完整测试及 Availability race 检查通过。
- 可达性读取复用页面 `loadId` 校验归属，每次新视图建立自己的检查并取消旧读取和定时器。普通链接、浏览器历史、迟到成功/失败、HTTP 取消和旧重试回归均通过；定向可达性浏览器测试 11 项通过。
- Node 24 类型检查、`make build`、Go 嵌入资源与 workspace 产物字节一致性检查通过；构建结束后运行完整 Console 浏览器套件，235 项全部通过、无跳过。随后以同次构建宿主在独立网络命名空间运行真实 Core 中英文可达性回归，两项均通过、无跳过。
- 复测 verify 时保留的实际 Transport 内层断连测试已通过（`dist/console-availability-warn-auth-recheck.log`）；同一路由离开/返回的浏览器复现中，新视图共执行三次各自的检查，旧失败返回后无告警（`dist/console-availability-warn-view-recheck.log`）。
- 原生边界、文档归属、UI 语言、差异格式及 OpenSpec 严格校验通过。已知验收边界不变：未测 Windows GUI；27991 原预览仍有运行中的 Work，本轮未重启它，未读取其凭据或数据进行测试。
