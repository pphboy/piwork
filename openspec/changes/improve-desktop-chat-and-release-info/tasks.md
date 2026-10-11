# Tasks

## 1. 图片契约、能力与边界校验

- [x] 1.1 在 `packages/contracts` 定义图片输入/描述、独立 `chat-images-v1` 能力与限额，增加 Go/TS 共用的 PNG/JPEG/WebP 结构、MIME、Base64、数量/字节/尺寸边界夹具；以 contracts 单元测试及 `go test -mod=readonly ./internal/contracts` 验证合法、伪造、截断和各上限两侧一致。
- [x] 1.2 增量扩展 `proto/agent.proto` 的 SubmitRun、按 profile 请求的 Session 图片块及独立能力/原图 RPC，运行 `make generate`，同步 Go/TS 与 HTTP 生成契约；以协议往返测试验证原图 bytes、空文字、稳定引用及缺省旧文本请求，确认不改变基础/chat_controls 既有版本。
- [x] 1.3 在 Agent 模型解析中提供 supported/unsupported/unknown 图片能力，检查实际有效 Session context 而非全部归档图片；以 `run-models.test.ts`、`application.test.ts` 覆盖显式/SDK/未知模型、摘要后上下文及旧 RPC unimplemented，文字模型继续可选可用。

## 2. 原子图文受理、SDK 执行与私有历史

- [x] 2.1 扩展 `RunManager` 和 `WorkStore.acceptRun`，在原受理事务写入私有 `run.input`，图文 requestDigest/promptDigest 覆盖原内容及顺序，纯文本保持旧算法；以 runs/store 测试验证同键复用、字节/MIME/顺序冲突、事务回滚、单槽及受理后 SDK 写入前崩溃恢复。
- [x] 2.2 将图片传入固定 Pi SDK 的 `PromptOptions.images`，守住 input handler 的 handled/transform 与执行 preflight 的真实图片上下文；下一次显式 Run 前按原分支/Run 补全缺失的已接受用户历史；以 `pi-sdk-executor.test.ts` 和 `model-providers.test.ts` 的本地供应商夹具验证纯图/图文、新续聊收到中断前原图、旧 Run 不重放、图片顺序、扩展丢图/改图拒绝及供应商失败原 Run，不用真实 key。
- [x] 2.3 在 Pi adapter/Agent Session 投影中以 Run/图片索引合并 SDK 消息和受理输入，验证真实 JSONL 落盘及同步后才允许压缩删除唯一 input；以 session-persistence、sessions/store 测试验证首个 assistant 前内存未落盘、重复恢复/再次崩溃只保留一条输入、已摘要历史图不被重新插入、部分消息损坏拒绝、取消/失败/重启、压缩前后原图一致及连续游标，SSE/日志无图片正文。
- [x] 2.4 同步 TS/Go 对新 `run.input` 的形状、内容摘要、长度及 Session/Run 归属冷校验，沿用 schema 5、schema 4 兼容及原 SDK JSONL 不执行传输；以共享合法/损坏图片历史夹具验证 `snapshot.test.ts`、`internal/workhistory` 和 `internal/snapshothelper` 一致，补图文 Memory promptDigest 证据回归，并更新 `docs/work-package-format.md` 的图片保留说明。

## 3. Go CLI/Core 图片请求与只读原图链路

- [x] 3.1 在 CLI/Core 为 SubmitRun 接入专用 16 MiB body 读取、认证后有界校验与纯图准入，保留普通 JSON 限额；以 `user_desktop_control_test.go` 和 Core conversation 测试验证 10 MiB 图文通过、超限拒绝、非字面携图拒绝、无图原请求及 unauth/CSRF/Host/Origin 拒绝，拒绝不受理 Run。
- [x] 3.2 在 `internal/agentclient` 与 Agent server 配置图片调用所需 transport 限额，串接独立能力 RPC；以 Go/TS RPC 测试验证超过默认 4 MiB 的合法图片、超上限拒绝、旧 Agent 局部降级及其他方法原校验，能力不影响现有 Work readiness/聊天设置。
- [x] 3.3 实现按 Work/Session/Run/索引的原图 RPC、Core GET 和 Desktop 二进制代理，按需验证原图来源和摘要；以 agentclient/Core/CLI 测试核对字节、MIME/长度/no-store、跨对象/用户拒绝、停止 Work 不隐式启动、损坏/缺失/临时不可用及取消读取，普通 client 1 MiB JSON 响应限制不放大。
- [x] 3.4 为图片历史读取接入 `imageProfile=chat-images-v1` 的明确协商，缺省保留旧文字/工具投影；以契约/路由测试验证旧调用者无未知图片块，新调用者只得 metadata，多个图片消息不使 Session 响应包含累计原图，并在 `docs/testing.md` 记录对应测试入口。

## 4. Desktop 图片草稿、发送与历史交互

- [x] 4.1 实现图片草稿、粘贴/drop/文件选择、缩略图和移除动作，接入 Work/Session/身份修订归属及受限 Blob CSP；以 Desktop 浏览器测试验证三种来源、混合批次逐项反馈、容量/类型、普通文字粘贴、读取晚返回隔离、预览资源清理和无隐式上传/Session/Run。
- [x] 4.2 接入纯图/图文显式 Send、能力提示、slash 携图拒绝、原键核对与提交快照清理；以延迟/丢响应/busy/受理前模型拒绝/受理后执行失败测试验证一次提交、新草稿保留、没有静默删图或换模型及没有新 Session 重复创建。
- [x] 4.3 扩展 `historyMessages`、`activityGroups` 与消息渲染，以稳定引用展示图片并按需只读取图/较大预览；以投影及浏览器测试验证纯图片不消失、不成为工具、重开/重连不重复、两并发读取、局部失败恢复、焦点与阅读位置保持。
- [x] 4.4 验证普通 Chat、辅助栏、Focus chat 与 360px 的键盘、配置摘要/Send 可达及 Service iframe 保持；运行 Desktop typecheck/build/browser 测试并同步嵌入资源，更新 `docs/desktop-webui.md` 的三种添加方式、限额、支持模型与失败/未知恢复说明，核对文档与实际界面一致。

## 5. Create Work 按钮与状态区域稳定

- [x] 5.1 在创建弹窗建立显式状态容器和稳定外框，公共 ActionState 渲染尊重状态容器并避免把反馈作为按钮同排 Flex item；以 ActionState/feedback 浏览器回归验证即时反馈、busy、重复提交锁、Close 和未知结果语义保持。
- [x] 5.2 在宽屏/360px、普通/Advanced、长名称、立即提交/十秒等待/长错误/未知状态下比较 Create/Cancel 的位置和宽高，误差最多 1 CSS px；Playwright 同时确认一次 POST、完整可读状态、无横向溢出及焦点正常，回归其他使用公共弹窗反馈的入口并重建 Desktop 嵌入资源。

## 6. 版本、About 与内置更新日志

- [x] 6.1 创建 `internal/releaseinfo` 的共用 buildinfo 组合、结构化内置日志与精确组件/版本查找，以及共享 About DTO/生成契约；以 Go/契约测试核对 --version 一致、不同组件、dev/unknown/缺失、重复键、空正文、64 KiB 上限及固定 Releases URL；本次未发行内容以明确 Unreleased 维护，不伪造旧版发布事实。
- [x] 6.2 实现 Core 用户可读 About、本机已授权但无需 Core 登录的 Desktop About、独立远端 core-about 及 Console 管理代理；以 Go HTTP 测试验证 user/admin/失效身份、本地 Host/Origin/Cookie、非 ready/离线、远端慢查询、旧 Core 404 和切换后晚返回，不取得 Work/operator 内容。
- [x] 6.3 实现 Desktop About dialog 与 Console `/about` 页面/导航/shell 白名单，按组件展示版本及 Release notes/All releases；以两端浏览器测试核对本机先显示、精确日志、缺失态、离线、恶意正文纯文本、固定 URL、键盘/360px 及原草稿/Service iframe 保持，重新构建两端 Go 嵌入资源。
- [x] 6.4 将内置日志纳入实际构建输入及来源追踪，保留 desktopUIHash 原义；接入普通构建结构检查及 `make check-release-info` 显式严格候选检查；以 `build-cli.test.mjs`、`build-docker-release.test.mjs` 和打包测试验证日志变化影响相关输入身份、开发缺失可构建、候选精确版本缺失失败及无联网探测，不改写旧发行记录。
- [x] 6.5 更新 `docs/desktop-webui.md` 的 About/离线阅读说明及 `docs/docker-release.md`、`docs/cli-platforms.md` 的日志维护/候选检查入口，README 中英文对应导航或说明同组更新；以链接、命令/界面核对和 `git diff --check` 验证，不把开发记录写成已发布或缺少证据的平台验收。

## 7. 跨组件集成与交付核对

- [x] 7.1 使用相关 native Agent/helper 镜像和独立安装，新增真实 Go Core→TS Agent→Pi SDK 合成图片供应商集成场景，并执行终态 Work Stop→export→源 Core 下线→import→显式 Start→原图读取/续接；按 `docs/testing.md` 的 integration 入口验证图文字节、原 Session/Run、旧 Agent 文字兼容、跨用户拒绝与无自动重放，验收记录只写实际结果。
- [x] 7.2 执行 `make generate`、`make build`、受影响 Go/TS 单元及两端浏览器测试、`node scripts/check-native-boundary.mjs` 和相关构建输入/候选检查的合成测试；核对源码、生成契约、内嵌资源和文档一致，按图片链路、布局修复、产品信息及使用文档组织可独立审阅的提交范围，真实 Windows 交互只记录实际证据，不进行对外发布；根目录已发布 hash 与未发行源码的检查差异见对应验收记录，合成材料检查通过。
