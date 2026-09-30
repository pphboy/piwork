# Desktop WebUI 本机验收记录

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

Export 的准入由真实 Core 的 [snapshot admission/preflight 测试](../apps/core/src/work-snapshots/admission.test.ts) 和 [preflight 测试](../apps/core/src/work-snapshots/preflight.test.ts) 覆盖：stopped 元数据过期、正在运行的容器、文件任务/控制任务/Run 占锁时均拒绝，且不留下半成品包。Desktop 浏览器模拟拒绝、损坏和空间不足；扩展真实 Core 浏览器链路另实际触发了首个 Export 未结束时的第二次 Export 锁拒绝，UI 保留明确错误与原 ID 恢复路径。
