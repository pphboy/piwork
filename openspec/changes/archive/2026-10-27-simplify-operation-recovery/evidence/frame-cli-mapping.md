# Desktop 原型与 CLI 能力的当前映射

本表满足 DWUI-002 对 36 帧及 CLI 能力映射的要求。画面名称和编号取自[历史原型索引](../../2026-10-12-remove-docs-dir/evidence/legacy-docs/design/desktop-review/README.md)；该原型仅用于定位，不作为当前实现或测试通过的证据。当前交互以本变更规格和源码为准，尤其是 01、29 中的 Operation 查询现已回到所属任务，不再提供账号菜单全局入口。

表中入口对应当前 [Desktop 视图](../../../../../apps/desktop-webui/src/app.ts)、[适配器](../../../../../apps/desktop-webui/src/adapter.ts)和 [Files 实现](../../../../../apps/desktop-webui/src/files.ts)。验证列指向当前测试及其代表性场景：F 为 [feedback.test.ts](../../../../../apps/desktop-webui/test/feedback.test.ts)，R 为 [recovery.test.ts](../../../../../apps/desktop-webui/test/recovery.test.ts)，B 为 [browser.test.ts](../../../../../apps/desktop-webui/test/browser.test.ts)，A 为 [final-acceptance.test.ts](../../../../../apps/desktop-webui/test/final-acceptance.test.ts)，L 为 [lifecycle.test.ts](../../../../../apps/desktop-webui/test/lifecycle.test.ts)，E 为 [export-adapter.test.ts](../../../../../apps/desktop-webui/test/export-adapter.test.ts)，N 为 [native-auth.test.ts](../../../../../apps/desktop-webui/test/native-auth.test.ts)，P 为 [export-presentation.test.ts](../../../../../apps/desktop-webui/test/export-presentation.test.ts)，G 为 [user_proxy_test.go](../../../../../internal/cli/user_proxy_test.go)。这些引用是具体场景的追踪关系，不表示一项测试覆盖该画面的每个状态。真实 Core 路径由 [real-core.mjs](../../../../../apps/desktop-webui/test/real-core.mjs) 独立验证；模拟错误、权限和旧记录不能写成真实故障复现。

| 帧 | 原型评审对象 | 当前入口或实现 | 当前测试线索 |
| --- | --- | --- | --- |
| 01 | Work 列表 | `works`、行内控制和无对象任务提示 | F：Work 控制及无对象任务；A：Works 刷新 |
| 02 | Service 与 Agent | `workPage`、`services`、`agent` | A：Hide/Show 保留 iframe 与草稿 |
| 03 | Service 独立窗口 | Service 的 Pop out 与独立视图 | B：Service iframe 与独立标签 |
| 04 | Files 与 Agent | `files`、文件路径与编辑器 | R：R1 文件读取、保存和冲突 |
| 05 | stopped Work | `workState`、Start、Settings、Export | B：Work 生命周期；F：Stop 与准备状态 |
| 06 | Export 就绪 | `export` 面板及原 snapshot 下载 | F：stopped Export 单次交付；P：原 ID 详情 |
| 07 | Import 审核 | `import`、Inspect 和确认 | R：R4 匿名 Inspect 与显式 Import |
| 08 | Import 成功 | 原 Operation 详情与显式 Start and open | F：C03 Import 的 close/view/start；真实 Core 导入 |
| 09 | 连接和账号 | 会话、登录、Core 连接与账号菜单 | N：重新登录、失效与恢复 |
| 10 | New Work | `new-work`、高级配置与提交反馈 | F：D02 Create；R：创建名称冲突 |
| 11 | 空 Work / 新 Session | `agent` 和无 Service 的 Chat | F：C01 无 Service 的 Chat |
| 12 | Session 列表与切换 | Session 选择器和创建动作 | F：Session chooser 键盘、草稿与读取失败 |
| 13 | Run 执行与取消 | `agent`、Run 状态和显式取消 | F：D07 Send；R：取消与原 Run 恢复 |
| 14 | Run 恢复与失败 | 原 Run 检查与历史恢复 | R：R3 终态、断线和退避 |
| 15 | Service 管理列表 | Service 菜单及管理区域 | A：Service picker；R：多 Service 失败 |
| 16 | Service 详情和日志 | `serviceDetails`、有限日志和只读检查 | R：Service details；F：对应 Service 恢复 |
| 17 | Service 入口与失败回退 | `serviceViewport`、独立入口及失败说明 | B：iframe 与独立标签；F：被阻断预览回退 |
| 18 | 文本文件编辑 | `textEditor`、保存、丢弃及读回 | R：R1 草稿和条件冲突 |
| 19 | Rename/Move/Copy | Files 表单及逐路径结果 | F：D11–D13 rename/move/copy |
| 20 | 文件传输与删除结果 | 上传、删除确认和逐路径反馈 | F：D11–D13 upload/delete；R：混合结果 |
| 21 | 外部 WebDAV | Files 更多菜单与 `webdav` 指引；CLI proxy | A：Files 菜单键盘；G：proxy WebDAV 授权与路径 |
| 22 | Settings | `settingsPage`、保存与独立 Apply | R：R2 草稿；F：Apply 原任务恢复 |
| 23 | Skills | `skillsSettings` 和 catalog | F：skill-copy；真实 Core 的 Skill 目录与选择 |
| 24 | Pi Package 安装 | `packagesSettings`、`install-package` | F：D16 五种来源安装与更新 |
| 25 | AGENTS.md | Settings 的 AGENTS 编辑与导入 | R：R2 草稿；真实 Core 保存与 Apply |
| 26 | 高级配置 | Settings 的 Advanced 编辑与导入 | R：R2 Advanced 与表单共享草稿 |
| 27 | Work 生命周期 | Work 菜单、Stop 和状态投影 | F：D02/D03；L：较新目标与终态同步 |
| 28 | Work 删除 | Delete 确认与无对象清理提示 | B：Delete Operation；F：删除后重载 |
| 29 | Operation 查询和详情 | Work/Service/Settings/传输各自的详情与按 ID 查询 | F：原任务、诊断和跨 Work 查询；L：身份匹配 |
| 30 | Import 进行中和失败 | Import transfer、原 Operation 和临时提示 | R：R5 未知/已接受防重复；F：原 transfer 恢复 |
| 31 | Export 恢复 | 同一 snapshot 的检查、暂停与下载 | E：原 snapshot 与 transfer；F：暂停和恢复 |
| 32 | 360px 工作区 | 窄屏 Service、Chat、Files 切换 | R：360px Focus 保留 iframe 与草稿 |
| 33 | Service 危险操作 | Service Stop/Restart/Retry/Remove 控制 | F：D08 五种 Service 控制及原 Operation |
| 34 | 文件表单与确认 | New folder、覆盖、删除与未保存确认 | F：D11–D13；R：R1 和文件结果 |
| 35 | Pi Package 详情与更新 | Package 详情、状态、更新与移除 | F：D16 更新/移除；R：Package 详情 |
| 36 | Apply 进行中和结果 | Settings 的 Apply 状态与原 Operation | F：Apply/Package 恢复、草稿及读取失败 |

## CLI 命令组与画面

命令组按本次构建的 `piwork-cli --help` 核对；映射描述用户可通过 Desktop 完成的相关任务，不把终端参数或独立 CLI 进程伪装成网页控件。

| CLI / 协议能力 | 对应帧 | 当前 Desktop 入口或边界 |
| --- | --- | --- |
| `status`、`login`、`whoami`、`logout`、`--core` | 01、09 | Core 状态、登录、账号菜单及切换身份 |
| `work create/list/show/start/stop/retry/delete` | 01、05、10、27–29 | Works、Work 菜单、对象状态和原任务详情 |
| `session create/list/show`、`chat` | 02、11–14 | Chat、Session 选择、显式发送 |
| `run show/watch/cancel` | 13、14、29 | 原 Run 状态、恢复与显式取消 |
| `work service list/show/start/stop/restart/retry/remove/logs` | 15–17、29、33 | 对应 Service 管理、控制和授权日志 |
| `proxy` 的 Service 与 WebDAV 访问 | 02、03、17、21 | 浏览器 Service 入口；Files 中提供 CLI proxy 指引 |
| WebDAV 读取、写入、建目录、移动、复制、删除 | 04、18–21、34 | Files 当前 Work 路径和逐项反馈 |
| `skills list/show`、`work config skills` | 10、23、36 | Skills catalog、Work 选择与 Apply |
| `packages list/show`、`work packages` | 10、24、35、36 | Package catalog、安装、更新、启停与移除 |
| `work config show/set/agents/packages/apply` | 22–26、35、36 | Settings 编辑、保存和独立 Apply |
| `work package inspect`、`work import` | 07–09、30 | Inspect、Import 和原任务结果 |
| `work export`、`work snapshot download` | 05、06、31 | Export、原 snapshot 查询和下载 |
| `operation show` | 01、08、10、24、27–31、36 | 所属 Work、Service、Settings 或传输任务内查询原 ID |
| `logs export/show/download` | 09 | 有权限的账号菜单日志导出；不等于 Service 日志授权 |
| `desktop`、`desktop open/logout` | 09 | CLI 管理独立 Desktop 生命周期；网页使用同一用户身份与会话边界 |

本次验证的实际命令、结果和未覆盖事实记录在本变更 [tasks.md](../tasks.md)。36 帧的对应关系是导航与证据索引，不表示本次重新人工查看了 36 张画面，也不表示所有模拟故障都在真实 Core/Docker 中重现。
