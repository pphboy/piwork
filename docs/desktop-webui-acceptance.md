# Desktop WebUI 本机验收记录

## improve-desktop-workspace-ux（2026-10-05）

本次规则以 [Desktop 规范](../openspec/specs/desktop-webui/spec.md)、
[聊天规范](../openspec/specs/agent-conversation/spec.md)、
[Service 访问规范](../openspec/specs/browser-service-access/spec.md) 和
[界面语言规范](../openspec/specs/desktop-ui-language/spec.md) 为准。
以下仅记录验收证据，不另定义产品规则。

### 第 9–12 组补充验收

第 1–8 组初版的 37 项证据保留在下一节。本节独立核对用户确认的 SDK 来源、Focus 返回
和 UIUX 一致性，不沿用旧完成标记。

| 补充范围 | 新执行证据 |
| --- | --- |
| CONV-MODEL-001、CONV-RUN-001：第 9 组 | Agent 83 项、Pi adapter 18 项与 Go 模型转发回归通过；额外 6 项 model 单测核对 SDK 名称仅用于公开展示，不改 Run descriptor。固定 SDK 0.86.1 的 DeepSeek Anthropic-compatible 受控 HTTP fixture 逐档验证 Off/Low/High/Max、SDK 实际档位、Run 快照、extension 后最终 payload 与子 Agent 能力重载。Off 无 effort/budget 冲突，官方端点严格匹配，未知能力明确拒绝。 |
| DUL-002、DUL-WORKSPACE-002、DWUI-FOCUS-001、BSA-FOCUS-001：第 10 组 | 新 `UX revision` 浏览器场景验证四种布局、重复放大、Files/普通 Chat 来源、明确 Service/Session 新选择、直接退出、与 Open/More 的几何及 aria 一致。完整往返保留 iframe 与所有祖先、文档加载计数、应用表单、同一 Chat/Session/草稿、阅读锚点误差小于 2px、Activity 展开，布局没有新增业务请求。菜单/全屏/恢复/覆盖层/退出逐层处理；全屏双向拒绝、跨源按键、Work/预览失去资格及独立窗口零 Chat 请求通过。Go CLI/Core Service/Gateway 回归通过。 |
| DUL-WORKSPACE-001/002、DWUI-MODEL-001、DWUI-COMMAND-001、DWUI-ACTIVITY-001：第 11 组 | 本轮 23 项 UX 浏览器回归通过。宽屏 Model/Thinking/Input options/Send 的真实高度与中心一致；360px 长名称菜单换行、发送与错误恢复可达。点击与网页命令打开同一实际档位列表；打开不写、取消保留、IME 不执行、串行保存、丢回复只 GET、改写草稿不被旧确认清除、当前 Run 不变。失败 Activity 摘要直接可见；Service identity 保留开关和参数边界；Session/Run 技术身份按需展开。首次 Work 读取迟到时保留已明确选择的 Service 和 Focus 下未保存 Files 编辑；原未知 Start 锁与 Session 局部读取反馈保持可见。 |
| 本次补充 CONV、DUL、DWUI、BSA：第 12 组 | 最终 Desktop Go embed + 新 Agent 的隔离 `test:real-core` 通过：目录→实际菜单→完整设置→SDK 资源命令→Activity→Focus/Focus chat/Restore layout/Exit focus 与直接退出→Files/Apply→Stop/Export/Inspect/Import/Start→继续原 Session。Focus 往返无业务修改，Session/Run 历史、desired/active 配置逐项相同，iframe 及所有祖先与草稿不变、文档加载计数为 0。Go conversation 与模型真实 SDK 集成通过；Agent 受控 HTTP fixture 完成真实能力→Session 设置→各档实际请求。 |

受控结果日志：`/tmp/piwork-ux-revision-agent-unit.log`、
`/tmp/piwork-ux-revision-adapter-unit.log`、`/tmp/piwork-ux-revision-model-label.log`、
`/tmp/piwork-ux-revision-browser-allux.log`、`/tmp/piwork-ux-revision-service-access.log`。
测试代码分别见 [SDK fixture](../apps/agentd/src/pi-sdk-executor.test.ts)、
[交互回归](../apps/desktop-webui/test/recovery.test.ts)；复现 UX 场景需先构建 Desktop，
然后编译 `tsconfig.test.json`，执行 `node --test --test-name-pattern=UX apps/desktop-webui/dist/test/recovery.test.js`。

最终 Desktop 全套浏览器回归为 192 项：191 通过，1 项需要实际等待五分钟的旧票据到期
用例按原环境开关跳过。Chrome 154.0.8037.97、Edge 154.0.4258.53 各通过全部 23 项 UX
场景，包括新增的完整 Focus 返回和真实菜单。日志为
`/tmp/piwork-ux-revision-browser-full.log`、`/tmp/piwork-ux-revision-chrome.log`、
`/tmp/piwork-ux-revision-edge.log`。受影响 workspace typecheck、Agent 83 项单测及 Go
client/contracts/Core/CLI/history/RPC 回归通过。

Desktop 生成资源已同步进 Go embed，验收二进制位于 `/tmp/piwork-ux-revision-bin/`。
隔离 Agent 镜像 `piwork-agentd:desktop-ux-revision-production` 的 ID 为
`sha256:4200aea3f321f64b68019b7bc19f25251cb8c0c6d23c5eae1d99bda881aab5c4`；
`piwork-agentd:desktop-ux-revision-acceptance` 为
`sha256:6cbbc2bf42ef6d1eae44c7c78b04c4a1a89b14ec0ce0a4aa6fb81188c638287e`。
生产镜像另在 `--network none` 下确认 SDK 0.86.1、SDK 名称 `DeepSeek V4.1 Flash` 与
Off/Low/High/Max 能力；证据在 `/tmp/piwork-ux-revision-image-capabilities.log`。
依赖锁文件、SQL schema 4、协议 v2、存储版本 2 与 `.work` 版本 1 均未变。

最终真实 Core 使用安装 `installation-036057fa9dbd8d53330f0ebf0e6bbbdb`；主文档重载
计数为 0，测试安装的容器、网络、卷清理后均为 0。日志：
`/tmp/piwork-ux-revision-real-core.log`、`/tmp/piwork-ux-revision-go-integration.log`，截图：
`/tmp/piwork-ux-revision-real-screens/02-focused-chat.png` 与 `02-service-and-chat.png`。
复现使用本节的 Agent 标签及配套 `piwork-snapshot-helper:desktop-ux-acceptance`，
`PIWORK_TEST_NATIVE_CORE`/`PIWORK_TEST_NATIVE_CLI` 指向新 Go 二进制；
`PIWORK_TEST_DATA_ROOT` 指向有足够空间的隔离磁盘目录。
受控 fixture、实际浏览器和真实 Core 证据分别记录，不将确定性模型当作外部 DeepSeek
服务调用。`openspec validate improve-desktop-workspace-ux --strict` 与 `git diff --check`
通过；第 9–12 组十项全部完成，没有重启用户运行中的 Work。

### 第 1–8 组初版验收

| 覆盖范围 | 执行证据 |
| --- | --- |
| DWUI-011/014/019：局部读取、授权开场、原锁和显式核对 | `test:browser` 的 feedback/local-auth 用例通过；打开 Work 立即进入目标外壳，受控延迟下仅局部等待。Cookie-first、票据移除、CSRF、未知写入恢复保持通过。 |
| DWUI-ACTIVITY-001、CONV-TOOL-HISTORY-001 | chat-projection 单元测试验证正文边界、Run/toolCallId 合并、历史键和重复正文；浏览器验证插入先前消息后阅读锚点误差小于 2px、两层展开保持、恶意文本仅作文本、360px 可达。Pi adapter 验证非文本、缺失结果、UTF-8 64 KiB 边界与完整私有 SDK 文件。 |
| DWUI-MODEL-001、CONV-MODEL-001、CONV-RUN-001 | recovery 浏览器验证完整 pair 串行保存、最新 revision、default-only、丢响应后只读核对、草稿保留；真实 SDK 本地 API fixture 验证 Off/High 的实际请求参数、Run 快照和两个独立凭据。 |
| DWUI-COMMAND-001、CONV-COMMAND-001、CONV-SUBMISSION-001 | 浏览器验证 Enter/Tab 填入、再次提交、既有参数、IME/Shift+Enter/Esc、网页入口、参数拒绝、字面 slash、原键恢复和 not-found 保持未知；恢复 Session 后保留原完整设置，未自动 PATCH/Run。真实 SDK 验证 Skill/Prompt 展开及不执行任意扩展 handler。 |
| DWUI-FOCUS-001、DUL-002、BSA-FOCUS-001 | Chromium 与真实 Chrome 154.0.8037.97、Edge 154.0.4258.53 各通过 Focus/Fullscreen 两项浏览器用例：同一 iframe/Chat 节点、未保存表单/草稿、展开保持、360px、原生全屏与退出、请求拒绝时保留 Focus。全量 Go 测试包含原 Service 准入、授权撤销和连接关闭回归。 |
| CONV-CHAT-CAPABILITY-001、CONV-CHAT-HISTORY-001 | TS contracts/pi-package/work-store/pi-adapter/agentd 单元测试分别为 13/8/40/18/79 项，全部通过；Go contracts/wire/client/history 和全量 `go test -mod=readonly ./...` 通过。新/旧/未知可选 Readiness 契约不改变原全局准入。 |

Desktop 全套浏览器回归：180 项，179 通过、1 个依赖显式真实环境的用例跳过；
包含阅读锚点、运行恢复后的能力/命令目录重读，以及不兼容 Session 的草稿与网页入口保留。所有 workspace `npm run typecheck`、
`openspec validate improve-desktop-workspace-ux --strict` 与 `git diff --check` 通过。

已构建隔离标签 `piwork-agentd:desktop-ux-production`、`piwork-agentd:desktop-ux-acceptance`、
`piwork-snapshot-helper:desktop-ux-acceptance` 及 Go Desktop embed。
旧 `piwork-agentd:brain-go-acceptance` 的真实 Go/SDK 模型集成通过：capability 0
仅使三个新增读取端点返回 501，原模型/Session/Run 流程继续正常。

Go `TestGoCoreHTTPToRealTSAgentConversation`、`TestNativeChatModelSelectionRunsThroughGoAndRealSDK`
通过；使用本次 Helper 后 `TestNativeSnapshotHistoryRebuildContinuesRealTSSDKSession` 通过。
旧 Helper 的严格校验会拒绝新增 Thinking JSON 字段，发布需配套更新 Helper；
回退边界见 [包格式说明](work-package-format.md#可选聊天元数据schema-4)。
协议 v2、schema 4、存储版本 2、`.work` 版本 1 和 SDK 0.86.1 未改变。
所有真实测试使用独立安装和安装标签清理，未重启用户运行中的 Work。

`npm run test:real-core -w @piwork/desktop-webui` 本轮在 Chromium 140.0.7339.186
通过完整真实 Go Core/CLI/Docker 链路：上传并加载 Skill→读取目录→完整 pair→资源命令参数→
两次 read 合并 Activity→Focus/Hide/Show/原生全屏→Files/Save/Apply→显式 `/new`→
Stop/Start/Stop/Export/Inspect/Import/Start→按原 Session ID 选择并继续资源命令→Delete。
Apply 前的 Session 仍为历史且设置不可用；当前上下文的原 Session 在导入后保持 Thinking Off
并成功继续，两个 Run 的同名工具各自形成 Activity。浏览器主文档重载次数为 0；
启用/禁用 Service、38 字节 sentinel、二进制 WebDAV、写入回复丢失与 390/1024/1440px
回归通过。清理确认测试安装的容器、网络、卷均为 0。

复现使用 Node 24，先构建 Desktop embed 和配套 Agent/Helper，再设置
`PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:desktop-ux-acceptance`、
`PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE=piwork-snapshot-helper:desktop-ux-acceptance`、
`PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE=piwork-file-helper:go-migration-acceptance`。
用 `PIWORK_TEST_DATA_ROOT` 指向足够空间的磁盘目录，用 `PIWORK_TEST_SCREENSHOT_DIR`
保存截图。真实 Chrome/Edge 的 Focus/Fullscreen 验证可对 `recovery.test.js` 设置
`PIWORK_TEST_BROWSER_BIN`，运行 `--test-name-pattern="UX full screen|UX Focus"`；
该部分使用受控 HTTP fixture，完整真实 Core 结果对应本节的 Chromium 链路。

## 当前 Go 后端验收

2026-10-02，桌面 Chrome 154.0.8037.57 与 Edge 154.0.4258.37 均通过 `npm run test:real-core -w @piwork/desktop-webui`。使用真实 Go Core/CLI、Docker Engine、完整 TS Agent/Pi SDK 及 Go 文件/快照 helper；覆盖 Service 内嵌和独立打开、文件编辑与回复丢失、Save→Apply、Chat、Stop→Export→Inspect→Import→Start、历史恢复和加载/空/错误状态。完整命令、日志和 UI Review 见 [Go 迁移验收记录的 12.9](go-migration-acceptance.md)。

执行时设置 `TMPDIR` 为至少可用1GiB的磁盘目录；用 `PIWORK_TEST_BROWSER_BIN` 指定实际浏览器，用 `PIWORK_TEST_SCREENSHOT_DIR` 保存截图。原有三个 fixture 浏览器测试继续由 `npm run test:browser -w @piwork/desktop-webui` 运行。

## 迁移前历史记录

> 以下记录属于迁移前 TS Core/CLI 的历史验收，所列旧脚本和旧测试路径已随 Go 平台迁移移除，不是当前发布 gate。Go CLI Desktop 的自动浏览器测试及真实 Go Core 证据见 [Go 迁移验收记录](go-migration-acceptance.md)；当前 Chrome/Edge 真实 Go 后端记录见上节。

2026-09-29 在隔离目录启动本地真实 Core 和 CLI Desktop，Core 使用本机 Docker、`piwork-agentd:local`、File Helper 与 Snapshot Helper 镜像。该真实 Core 验收使用 Playwright Chromium 140.0.7339.186。模型凭据使用无效测试值，未提交 AI 请求，因此未创建真实 Service。

同日另以本地隔离的模拟 Core 和真实桌面浏览器稳定版运行 Desktop 浏览器套件。Chrome 154.0.8037.57 与 Edge 154.0.4258.37 各 3 个用例均通过。Service 用例覆盖根路径、应用内登录、SSE、WebSocket、嵌入预览、独立标签页、Cookie/storage 跨 Service 隔离及停止后的访问状态；Work/迁移用例覆盖停止失败、快照锁拒绝、校验后下载、损坏/空间不足/过期恢复、离线 Inspect、导入重名、stopped 结果页。浏览器二进制来自 Google 官方 Chrome 包与 Microsoft 官方 Edge 稳定仓库，解包于 `/tmp`，未修改系统浏览器配置。模拟 Core 的结果不替代真实 Service 和真实 Agent 验收。

| 链路 | 实际结果 |
| --- | --- |
| Work 创建 | 浏览器默认表单提交得到 Operation；真实 Core 使 Work 从准备状态达到 `ready`。 |
| Files | 浏览器上传 `real-note.txt`，用内置文本编辑器修改为 `real Core edited\n`，经 Core 文件接口重新读取后字节一致。 |
| Stop 与 Export | 浏览器 Stop 后确认 `desiredState=stopped` 且 `observedState=stopped`；随后单独 Prepare package，等待原 Export Operation 完成，浏览器下载的 `.work` 包为 908,091,903 字节。Operation 与 snapshot ID 用于该次观察与下载；未完成跨 Desktop 重启恢复。 |
| Inspect 与 Import | 浏览器对该包离线完整校验；明确提交 Import 后原 Operation 成功，新 Work 的 `observedState=stopped`。当前结果页另经模拟 Core 验证：核实 stopped 后才显示分开的 Open/Start。 |
| Start 与数据比对 | 浏览器对导入 Work 单独 Start，达到 `ready`；从其 Files 重新读取同名文件，字节仍为 `real Core edited\n`。 |
| 清理 | 两个测试 Work 的 Delete Operation 均完成；Desktop/Core 进程、对应安装的四个 Docker 卷、隔离 Core 数据、CLI 凭证和导出包均已清理。 |

同日，在 `npm run acceptance` 创建的另一套隔离真实 Core、Docker Service 和确定性 Agent 中启用 Desktop 扩展验收。Node 24.20.0、Chrome 154.0.8037.57 和 Edge 154.0.4258.37 的真实单 Work 流程通过；本轮完整产品验收也通过并清理资源。两种浏览器均验证 Service 根页面、应用自身登录（`/private` 先返回 401，经表单登录后 200）、SSE、WebSocket、嵌入与独立标签页、Files 上传，并从 Desktop 提交真实 Agent Run 收到 `skill-read:` 回答。测试 Service 的登录仅是独立的应用 Cookie，不使用 Core Bearer。

扩展脚本 [desktop-real-acceptance.mjs](../scripts/desktop-real-acceptance.mjs) 随后在隔离 Core 上创建第二个普通用户及其 Work/Service。Chrome 与 Edge 都通过双 Work/双 Service 浏览器检查：普通用户 Work List 仅有自己的 Work，直接读取管理员 Work 得到 404；两侧 Service 可独立预览，管理员文件不出现在普通用户的 workspace。两种浏览器均在普通用户 Work 建立新 Session、运行真实对话、保存 AGENTS.md 后独立 Apply 并观察原 Operation 成功；登出后，原本可用的本地 Service 应用链接返回 401。管理员可见普通用户 Work 符合其管理员角色，不被误判为普通用户数据泄漏。第二用户测试 Work 在每次验收结束时删除，隔离 Core 与 Docker 资源由产品验收统一清理。

同一真实 Core 的 Chrome 迁移链路已验证：在普通用户 Work 上传 `migration.txt`（`migration bytes\n`）后独立 Stop，Core 确认停止；首个 Export 获得 Operation/snapshot ID，未完成时 UI 的第二次 Prepare 被 Core 快照锁拒绝，界面显示已知拒绝原因且不产生下载入口。首个 Operation 成功后关闭 Desktop，再启动新 Desktop，用**原 snapshot ID**在 Work List 找回并下载原包；浏览器下载文件的 SHA-256 与 Core snapshot digest 相同。随后浏览器离线 Inspect、显式 Import，等原 Import Operation 成功并确认新 Work stopped，单独 Start；新 Work Files 中 `migration.txt` 字节仍为 `migration bytes\n`。Edge 也用原 snapshot ID 完成下载校验、Inspect、Import、Start 和 workspace 字节比对，并验证页面重载、登出后本地 API 401、重新登录，以及 CLI 退出后旧本机链接不可达。不曾隐式 Stop/Apply/Cancel/Start，也没有通过重新 Export 修复下载。

2026-09-30 在隔离真实 Core、Docker Service、Node 24.20.0 上新增访问验收。Chrome 154.0.8037.57 和 Edge 154.0.4258.37 均通过：两个**普通用户**各自创建 Work/Service，各自 Work List 仅有自己的 Work，双向直接 Work、Service 入口与 workspace Files 请求均返回 404，另一用户文件不出现在 Files 中。脚本结束删除测试 Work；隔离 Core、CLI 进程和测试资源由产品验收清理。

同轮使用真实 rclone v1.60.1-DEV，经现有 CLI proxy 的 WebDAV 写入同一文件，再由浏览器 Files 编辑、由 rclone 读回比对；随后 rclone 覆盖写入，浏览器 Files 重新读取并核对字节。两种浏览器均通过。WebDAV 临时密码只由 proxy 打印到终端，不出现在 WebUI；proxy 重启后旧密码请求返回 401，新密码可继续读文件，浏览器 Files 全程无需该密码。

两种浏览器均在 Service SSE/WebSocket 和 Files 长 GET/PUT 活跃时由管理员异步重置当前普通用户凭证：Service 两条连接在 2 秒边界内断开，Files 请求关闭，长 PUT 未获得成功响应且 Desktop 不自动重放，旧本地 Service 链接返回 401，WebUI 进入登录状态；使用新凭证登录后可重新签发 Service 入口。之后对仍有活动连接的 Work 发起 Stop，Service SSE/WebSocket 同样在 2 秒内断开，Files 长 GET/PUT 关闭。两轮中首个 Stop Operation 均由 Core 标为 failed，尽管随后 Service/agent 容器退出且文件任务清理完成；Desktop 显示 `failed · target stopped` 和“Stop was not confirmed”，不提供 Export。确认清理后，显式提交的第二个 Stop Operation 成功，旧 Service 链接返回 503，Work 页面显示 stopped；随后显式 Start 成功。这一结果保留了 Core 对停止未确认时的保守判定，没有将连接断开误报为 Stop 成功。

同日完整 `npm run acceptance` 在磁盘临时目录下以退出码 0 通过：上述 Chrome/Edge 新增访问脚本、原快照恢复、Inspect/Import/Start、workspace 字节比对及后续产品回归全部完成。大 `.work` 包需要足够的本地暂存空间；内存盘 `/tmp` 空间不足时，浏览器会明确显示包准备或 Inspect 失败。隔离验收目录与 Docker 测试资源在脚本退出时清理。

浏览器模拟 Core 测试覆盖 Service HTTP/WS 转发、双 Service 存储隔离、Chat Run 断线/取消/过期恢复、ZIP Work 范围上传、离线 Inspect 和 360px 切换；CLI 进程测试覆盖 Service 停止或登出后的流关闭、暂存0700/文件0600、容量和并发拒绝、取消/退出清理、接收中阶段与字节进度、写入中 ENOSPC、32 MiB/96 MiB 流式接收的内存增长、恶意或损坏包拒绝、另一实例隔离以及替换快照文件后不跟随符号链接。真实浏览器的重载/登出/CLI 退出与模拟 Core 的断线分支共同构成跨模块恢复验收；模拟结果不冒充真实 Core 的断线演练。

Settings 的模拟 Core 浏览器验收逐一覆盖五种 Pi Package 来源：Core/npm/Git 来源先拒绝后更正并接受；ZIP 坏包被本地拒绝后用有效 ZIP 安装；本地目录先因未选择而拒绝，再选择目录上传并提交 Work 范围安装。Skills 的未知名称、Pi Packages 的未安装选择、AGENTS.md 超 1 MiB、Advanced 的无效 modelRef 均先显示错误、保留输入，再更正保存。Save 与 Apply 分开；Apply 的 Run busy、成功、验证失败与回退失败均按原 Operation 检查，随后刷新 active/runtime。真实 Core 的 Chrome/Edge AGENTS.md 保存→Apply→Operation succeeded 已通过；真实 Core 的其他配置字段错误仍由分层测试覆盖。

Export 的准入由真实 Core 的 [原生 snapshot 准入及预检测试](../internal/coreapp/snapshot_preflight_integration_test.go) 覆盖：stopped 元数据过期、正在运行的容器、文件任务/控制任务/Run 占锁时均拒绝，且不留下半成品包。Desktop 浏览器模拟拒绝、损坏和空间不足；扩展真实 Core 浏览器链路另实际触发了首个 Export 未结束时的第二次 Export 锁拒绝，UI 保留明确错误与原 ID 恢复路径。
