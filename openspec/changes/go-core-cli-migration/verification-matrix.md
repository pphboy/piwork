# Go 平台迁移验证矩阵

规划基线：`23870cfbec6ad88a60eea008f9c5f106410c3fb5`，2026-09-30；主规格叠加本 change delta 后为 **36 个 capability、260 个 Requirement、970 个 Scenario**。本文件是覆盖索引，不表示测试已通过。

## 使用规则

- 每个 `capability/Rxx/Sxx` 都需关联实际断言、测试名称、执行命令与结果；实现时写入 `docs/go-migration-acceptance.md`。同一个测试可以覆盖多个场景，但必须可指出对应断言。
- 原 Requirement/Scenario 标题保留作精确引用；具体 WHEN/THEN 与数值边界以所链接规格为准，不通过此表重新定义。delta 条目链接本 change，其余链接现行主规格。
- 任务列给出负责交付的任务编号；L1=Go/SQLite/协议单元或契约测试，L2=真实 Docker/SDK/helpers，L3=CLI/浏览器，L4=发布与双安装迁移。UI 语言中无法可靠自动断言的视觉规则附人工复核，不能以视觉截图替代后端验证。
- “现有参照”用于迁移场景和断言，不能把旧 TS 执行结果记成 Go 通过。保留 Agent 测试可继续使用 TS，但最终产品链中的 Core、CLI、Web 服务端、Service MCP 和 package/file/snapshot 程序必须是 Go；完整 TS pi-agentd harness 及其依赖继续保留。
- Core gate 9.12 覆盖全部 Core/Agent/helper 条目；CLI gate 11.6、Desktop 12.9、Console 13.5 覆盖各入口；14.7 检查源码/镜像 TS 边界，14.9 汇总所有条目。任何未执行或环境受限项都保留未验证。

## 显式替换的历史要求

以下旧标题已由本 change delta 明确移除并承接，不要求执行旧 TS 发行版升级矩阵：

- `control-cli`：文件能力失败不得破坏既有 service 访问；替代内容见 [delta](specs/control-cli/spec.md)。
- `core-service-startup`：安全升级已有 Core 网络身份存储；替代内容见 [delta](specs/core-service-startup/spec.md)。
- `work-services`：新服务容器使用稳定可读名称；替代内容见 [delta](specs/work-services/spec.md)。

## 本次修订的原生程序边界

完整 TS harness（RPC、Session/Run、私有历史、资源/工具加载、MCP 客户端及其必要依赖）和浏览器 UI 按 design D4.1/D10 保留。平台检查包含源码、生产依赖、镜像入口/文件树和实际进程，用户 Service、用户文件及 Pi 包的语言不属于平台源码迁移检查。

| 交付/边界 | 负责任务 | 对应规格场景 |
| --- | --- | --- |
| TS harness 的完整保留与消费者清单 | 1.7, 5.1, 5.5, 14.2, 14.7 | NATIVE-004/R04/S04；NATIVE-007/R07/S04–S05 |
| Go MCP 的协议、schema、JSON、mTLS、回收 | 3.8, 3.9, 7.4, 9.12 | NATIVE-004/R04/S01；NATIVE-005/R05/S04；mcp-tool-access 全部相关场景 |
| Go package-helper 四入口及容器内 Pi 依赖 | 3.7, 3.9, 6.5, 6.10, 9.12 | NATIVE-004/R04/S03；NATIVE-005/R05/S05；Pi package 主规格 |
| 原生镜像能力和幂等接受顺序 | 3.9, 5.1, 6.5 | NATIVE-005/R05/S06；OPKG-003；runnable-work-runtime 镜像/readiness 场景 |
| 固定 Agent 镜像的静态 V1 检查 | 9.2, 9.7, 14.8 | NATIVE-005/R05/S07；portable-work 的固定环境与离线搬迁场景 |
| 七种 Go 程序、源码清理和镜像进程审计 | 14.1–14.4, 14.6–14.9 | NATIVE-007/R07/S01–S05 |

Go MCP/package-helper 在 3.7–3.9 先完成，真实 harness/Work 运行从 5.1 接入；四种 Go 辅助程序均是 Core gate 9.12 的前置条件。矩阵是计划覆盖索引，不能用场景总数替代逐项执行证据。

## 全量映射

### agent-conversation

负责任务：5.5, 5.6, 9.4, 9.12, 10.5。验证层级：L1/L2/L3。

现有参照：apps/agentd/src；packages/pi-adapter/src；scripts/product-acceptance.mjs。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Persist and restore Work sessions](../../specs/agent-conversation/spec.md)（CONV-SESSION-001） | R01/S01：Continue after daemon replacement<br>R01/S02：Restore the same Work context |
| R02 | [Durably accept idempotent Runs](../../specs/agent-conversation/spec.md)（CONV-RUN-001） | R02/S01：Retry after lost acknowledgment<br>R02/S02：Reuse key with another prompt |
| R03 | [Limit active execution per Work](../../specs/agent-conversation/spec.md) | R03/S01：Concurrent sessions in one Work<br>R03/S02：Separate Works run concurrently |
| R04 | [Execution survives observer loss](../../specs/agent-conversation/spec.md) | R04/S01：Disconnect during a tool call |
| R05 | [Explicit cancellation and terminal consistency](../../specs/agent-conversation/spec.md) | R05/S01：Cancel an active Run<br>R05/S02：Completion wins cancellation race |
| R06 | [Recover interrupted execution conservatively](../../specs/agent-conversation/spec.md) | R06/S01：Crash after an external side effect<br>R06/S02：Model unavailable |
| R07 | [Apply Work context to every Session](../../specs/agent-conversation/spec.md)（CONV-CONTEXT-001） | R07/S01：New Session sees applied context<br>R07/S02：Existing Run keeps its context<br>R07/S03：Reject cross-Work context access |
| R08 | [Restore private conversation history with scoped identity](../../specs/agent-conversation/spec.md)（CONV-SNAPSHOT-001） | R08/S01：Continue a copied Session<br>R08/S02：Keep a completed tool call historical<br>R08/S03：Reject hostile history metadata<br>R08/S04：Preserve an old context mismatch<br>R08/S05：Preserve an uninitialized empty history<br>R08/S06：Keep native control history without replay |

### agent-service-deployment

负责任务：3.8, 3.9, 6.2, 7.4, 7.9, 9.12。验证层级：L1/L2。

现有参照：apps/core/assets/skills；apps/service-mcp/src；scripts/product-acceptance.mjs。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Seed and select the deployment Skill through managed snapshots](../../specs/agent-service-deployment/spec.md)（ADEP-001） | R01/S01：Load the fresh default deployment Skill<br>R01/S02：Respect no-Skills<br>R01/S03：Do not reseed operator changes<br>R01/S04：Recover interrupted first seeding |
| R02 | [Guide deployments using persistent code and explicit verification](../../specs/agent-service-deployment/spec.md)（ADEP-002） | R02/S01：User requests persistence<br>R02/S02：Dependencies need installation<br>R02/S03：Tools are unavailable |
| R03 | [Prove deployment with real SDK MCP containers and retained files](../../specs/agent-service-deployment/spec.md)（ADEP-003） | R03/S01：Complete the Python HTTP demo<br>R03/S02：Separate fixture from implementation shortcuts |

### browser-service-access

负责任务：12.5, 12.6, 12.9。验证层级：L1/L3。

现有参照：apps/cli/src/desktop/service-access.ts；scripts/desktop-real-access-acceptance.mjs。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [逻辑域名与本地浏览器链接各有明确用途](../../specs/browser-service-access/spec.md)（BSA-001） | R01/S01：中文 Work 名称<br>R01/S02：链接被另一电脑或未授权浏览器打开 |
| R02 | [每个浏览器入口仍经 Core 实时授权与解析](../../specs/browser-service-access/spec.md)（BSA-002） | R02/S01：应用与平台同名路径<br>R02/S02：撤销活动连接<br>R02/S03：应用登录失败 |
| R03 | [应用视口与平台界面使用分离的浏览器源](../../specs/browser-service-access/spec.md)（BSA-003） | R03/S01：应用不能访问平台内容<br>R03/S02：两个应用使用相同 Cookie 名 |
| R04 | [转发保留应用路径与可支持的浏览器会话](../../specs/browser-service-access/spec.md)（BSA-004） | R04/S01：根路径应用与流式协议<br>R04/S02：应用登录和重定向<br>R04/S03：外部来源和不支持的应用配置 |
| R05 | [独立打开与不可嵌入回退保持真实边界](../../specs/browser-service-access/spec.md)（BSA-005） | R05/S01：应用禁止嵌入<br>R05/S02：独立窗口内 Work 停止 |
| R06 | [本地入口故障可恢复且不会扩大兼容承诺](../../specs/browser-service-access/spec.md)（BSA-006） | R06/S01：重新启动 CLI<br>R06/S02：文件能力缺失 |

### control-cli

负责任务：4.5, 6.9, 10.1–10.8, 11.1–11.6, 12.2。验证层级：L1/L3。

现有参照：apps/cli/src/*.test.ts；apps/core/src/cli.test.ts。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Resolve one Core endpoint consistently](../../specs/control-cli/spec.md) | R01/S01：Use the user client endpoint<br>R01/S02：Override the Core URL explicitly<br>R01/S03：Reuse the saved endpoint<br>R01/S04：Use the operator endpoint |
| R02 | [Report Core and Work-runtime status](../../specs/control-cli/spec.md) | R02/S01：Report an empty Core<br>R02/S02：Report a ready Core<br>R02/S03：Report unavailable Docker |
| R03 | [Log in and persist credentials safely](specs/control-cli/spec.md) | R03/S01：Scripted login through standard input<br>R03/S02：Failed login preserves an existing credential<br>R03/S03：Wrong command surface |
| R04 | [Show identity and perform server-side logout](specs/control-cli/spec.md) | R04/S01：Use whoami in a new process<br>R04/S02：Log out a valid session<br>R04/S03：Core unavailable during logout |
| R05 | [Create and control Works from the CLI](../../specs/control-cli/spec.md)（CLI-WORK-001） | R05/S01：Create from the current default<br>R05/S02：Create with explicit Skills<br>R05/S03：Create with per-Work context overrides<br>R05/S04：Create with no Skills<br>R05/S05：Reject invalid create context<br>R05/S06：Update one Work only<br>R05/S07：Set Skills and AGENTS independently<br>R05/S08：Apply pending Work configuration explicitly<br>R05/S09：Apply a pending Work configuration explicitly<br>R05/S10：Create and wait for a ready Work<br>R05/S11：Show a Work preparation failure<br>R05/S12：Stop and restart one Work<br>R05/S13：Clear Skills through the documented flag<br>R05/S14：Set Skills through configuration JSON<br>R05/S15：SDK-invalid creation is an Operation failure<br>R05/S16：Repeated apply key<br>R05/S17：Create from package defaults<br>R05/S18：Override package selection<br>R05/S19：Reject duplicate package flags before I/O |
| R06 | [Create and continue persistent conversations](../../specs/control-cli/spec.md)（CLI-CHAT-001） | R06/S01：Continue a Work conversation<br>R06/S02：Send one scripted message<br>R06/S03：Continue an existing Session<br>R06/S04：Chat while configuration is pending<br>R06/S05：Interrupt an active chat explicitly |
| R07 | [Inspect Sessions and Runs](../../specs/control-cli/spec.md) | R07/S01：Recover after an observation disconnect<br>R07/S02：Query a completed Run |
| R08 | [Provide stable output and failure behavior](../../specs/control-cli/spec.md)（CLI-OUTPUT-001） | R08/S01：Reject a command on the wrong CLI<br>R08/S02：Request JSON output<br>R08/S03：Order concurrent configuration writes<br>R08/S04：Return revision conflict safely<br>R08/S05：Reject obsolete revision options<br>R08/S06：Reject invalid command input<br>R08/S07：只展示本地临时密码 |
| R09 | [Retain CLI authentication and conversation access across Core restart](../../specs/control-cli/spec.md) | R09/S01：Continue after Core restart without logging in again |
| R10 | [Discover Skills from the user client](../../specs/control-cli/spec.md)（CLI-SKILL-001） | R10/S01：List Skills before Work creation<br>R10/S02：Reject Skill management on the user client |
| R11 | [Explain Skill state and durable failures through the CLI](../../specs/control-cli/spec.md)（CLI-DIAG-001） | R11/S01：See a saved but inactive Skill<br>R11/S02：See and revisit the root cause<br>R11/S03：Wait without losing the Operation<br>R11/S04：One machine-readable failure |
| R12 | [Expose commands for existing Work services](../../specs/control-cli/spec.md)（CLI-SERVICE-001） | R12/S01：Discover commands without a login<br>R12/S02：Reject definition mutations before authentication<br>R12/S03：Reject invalid syntax locally<br>R12/S04：Preserve explicit ID selection |
| R13 | [Inspect service lifecycle metadata safely](../../specs/control-cli/spec.md)（CLI-SERVICE-002） | R13/S01：Inspect an agent-created service<br>R13/S02：Return an empty collection<br>R13/S03：Protect service definition content<br>R13/S04：Inspect a failed service |
| R14 | [Control services using existing durable lifecycle semantics](../../specs/control-cli/spec.md)（CLI-SERVICE-003） | R14/S01：Persist an individual stop<br>R14/S02：Enable while the Work is stopped<br>R14/S03：Reject an invalid restart<br>R14/S04：Explicitly retry after recovery exhaustion<br>R14/S05：Remove without deleting workspace data<br>R14/S06：A Work stop overtakes service control |
| R15 | [Preserve service acceptance and observation results](../../specs/control-cli/spec.md)（CLI-SERVICE-004） | R15/S01：Accept without waiting<br>R15/S02：Reuse an accepted mutation<br>R15/S03：Observe success or terminal failure as JSON<br>R15/S04：Retain identifiers after an observation failure<br>R15/S05：Bound a stalled poll<br>R15/S06：Revisit a result after service removal |
| R16 | [Read bounded service logs](../../specs/control-cli/spec.md)（CLI-SERVICE-005） | R16/S01：Read the default tail<br>R16/S02：Preserve a truncated result<br>R16/S03：No log instance is available<br>R16/S04：Validate both log tail boundaries |
| R17 | [Preserve service authorization and error compatibility](../../specs/control-cli/spec.md)（CLI-SERVICE-006） | R17/S01：Administrator controls a service but cannot read its logs<br>R17/S02：Conceal another owner's service<br>R17/S03：No fallback after rejection |
| R18 | [Transfer complete Work packages from the user CLI](../../specs/control-cli/spec.md)（CLI-SNAPSHOT-001） | R18/S01：Export and share<br>R18/S02：Do not overwrite a destination<br>R18/S03：Inspect without login<br>R18/S04：Import an ordinary Work with only its file<br>R18/S05：Export without an output option<br>R18/S06：Recover after wait timeout<br>R18/S07：Inspect packages without executing them<br>R18/S08：Keep packages in the standard export command |
| R19 | [Keep snapshot output and existing commands compatible](../../specs/control-cli/spec.md)（CLI-SNAPSHOT-002） | R19/S01：One JSON result<br>R19/S02：Preserve service boundary |
| R20 | [Manage Core packages from the operator CLI](../../specs/control-cli/spec.md)（CLI-PKG-001） | R20/S01：Install each operator source<br>R20/S02：Update does not guess a source<br>R20/S03：Observe a Core preparation failure |
| R21 | [Manage independent Work packages from the user CLI](../../specs/control-cli/spec.md)（CLI-PKG-002） | R21/S01：Install locally and activate explicitly<br>R21/S02：Copy from Core after import<br>R21/S03：Reject source ambiguity |
| R22 | [Preserve package acceptance waiting and output semantics](../../specs/control-cli/spec.md)（CLI-PKG-003） | R22/S01：Preparation exceeds two minutes<br>R22/S02：Observation becomes unavailable<br>R22/S03：User interrupts package waiting<br>R22/S04：Observation cannot be authorized<br>R22/S05：Wait for failure in JSON mode<br>R22/S06：Verbose package wait without leaking output<br>R22/S07：Reject verbose without waiting<br>R22/S08：Reject a caller-supplied package idempotency key<br>R22/S09：Help with unavailable authentication |
| R23 | [启动有界的 CLI 本地服务代理](../../specs/control-cli/spec.md)（CLI-SERVICE-PROXY-001） | R23/S01：curl 使用默认域名<br>R23/S02：浏览器使用 PAC 和 WebSocket<br>R23/S03：无法启动代理<br>R23/S04：拒绝开放 CONNECT<br>R23/S05：同一监听器服务两种访问 |
| R24 | [在统一 proxy 上提供多个 Work 的本地 WebDAV](../../specs/control-cli/spec.md)（CLI-FILES-001） | R24/S01：两个自有Work与路径映射<br>R24/S02：service恰有同名路径<br>R24/S03：移动和复制的Destination<br>R24/S04：本地认证与进程重启<br>R24/S05：无须Docker和第二个代理 |
| R25 | [启动本地 Desktop WebUI](../../specs/control-cli/spec.md)（CLI-DESKTOP-001） | R25/S01：无登录的一键启动<br>R25/S02：打开浏览器失败<br>R25/S03：非法端口与端口占用<br>R25/S04：关闭窗口和退出 CLI<br>R25/S05：两种访问命令并存 |
| R26 | [文件能力独立降级并保持 service 代理](specs/control-cli/spec.md)（CLI-FILES-002） | R26/S01：文件能力入口不存在<br>R26/S02：缺少helper<br>R26/S03：文件错误和会话错误分别处理<br>R26/S04：写入响应断开 |

### core-admin-api

负责任务：4.3, 4.4, 6.4, 6.6, 6.9, 13.3, 13.4。验证层级：L1/L2/L3。

现有参照：apps/core/src/application/admin-http.test.ts；package-http.test.ts；packages/client-sdk/src/admin.test.ts。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [以登录管理员身份授权管理 API](../../specs/core-admin-api/spec.md)（CADM-001） | R01/S01：有效管理员访问<br>R01/S02：保持两种凭证隔离<br>R01/S03：上传期间撤销会话<br>R01/S04：接受后账号禁用 |
| R02 | [暴露完整且受限的管理资源契约](../../specs/core-admin-api/spec.md)（CADM-002） | R02/S01：未 ready 时管理用户<br>R02/S02：Scoped 包名与非法 JSON<br>R02/S03：公共错误和数据投影 |
| R03 | [管理用户时沿用身份与撤销规则](../../specs/core-admin-api/spec.md)（CADM-003） | R03/S01：两名管理员并发禁用<br>R03/S02：管理员创建普通用户<br>R03/S03：密码重置后撤销 |
| R04 | [区分全局运行时持久化和可用性](../../specs/core-admin-api/spec.md)（CADM-004） | R04/S01：保存成功但环境不可用<br>R04/S02：无效配置原子拒绝 |
| R05 | [原子合并默认 Work 管理字段](../../specs/core-admin-api/spec.md)（CADM-005） | R05/S01：并发修改不相交字段<br>R05/S02：整体拒绝无效默认<br>R05/S03：上传文件不产生路径依赖 |
| R06 | [保持 Core package 的管理员身份和 scope 边界](../../specs/core-admin-api/spec.md)（CADM-006） | R06/S01：上传不能跨管理员使用<br>R06/S02：幂等键隔离与共同门禁<br>R06/S03：按已知 ID 观察其他管理员任务 |

### core-service-startup

负责任务：2.1, 2.6, 4.1–4.6, 5.3, 5.4, 9.11, 9.12。验证层级：L1/L2。

现有参照：apps/core/src/application/core-application.test.ts；control-plane.test.ts；scripts/product-acceptance.mjs。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Bootstrap the first administrator explicitly](../../specs/core-service-startup/spec.md) | R01/S01：Bootstrap an empty installation<br>R01/S02：Bootstrap an empty installation online<br>R01/S03：Refuse repeated bootstrap<br>R01/S04：Refuse repeated bootstrap (offline command) |
| R02 | [Configure a usable local runtime profile](../../specs/core-service-startup/spec.md) | R02/S01：Configure the global default online<br>R02/S02：Configure an installation from standard input<br>R02/S03：Change defaults without changing existing Works<br>R02/S04：Detect an incomplete runtime profile |
| R03 | [Start one durable Core application](../../specs/core-service-startup/spec.md) | R03/S01：Start before initialization<br>R03/S02：Start a configured Core<br>R03/S03：Start a configured local Core<br>R03/S04：Reject a second Core owner<br>R03/S05：Refuse accidental remote plaintext binding |
| R04 | [Expose distinct health and readiness probes](../../specs/core-service-startup/spec.md) | R04/S01：Report a ready installation<br>R04/S02：Report a runtime dependency failure |
| R05 | [Authenticate HTTP clients with durable sessions](../../specs/core-service-startup/spec.md) | R05/S01：Log in and inspect identity<br>R05/S02：Revoke a login session |
| R06 | [Expose durable Work lifecycle control](../../specs/core-service-startup/spec.md) | R06/S01：Create a default configured Work<br>R06/S02：Retry a lost mutation response<br>R06/S03：Hide another user's Work |
| R07 | [Expose authorized Session and Run operations](../../specs/core-service-startup/spec.md) | R07/S01：Submit and observe a Run<br>R07/S02：Reject conversation on a stopped Work<br>R07/S03：Lose an observation connection |
| R08 | [Recover Core and Work state across restart](specs/core-service-startup/spec.md) | R08/S01：Continue after restart with changed defaults<br>R08/S02：Continue after Core restart<br>R08/S03：Recover an incomplete create operation<br>R08/S04：Recover before reopening access |
| R09 | [Shut down Core without destroying running Works](specs/core-service-startup/spec.md) | R09/S01：Stop Core and reopen its store<br>R09/S02：Bound a stalled shutdown<br>R09/S03：Preserve service selection through shutdown |
| R10 | [初始化并核验 Go Core 持久存储](specs/core-service-startup/spec.md)（CST-NATIVE-001） | R10/S01：空目录首次启动<br>R10/S02：同格式重新启动<br>R10/S03：拒绝旧开发目录或未知版本<br>R10/S04：初始化中断或第二个所有者 |

### desktop-ui-language

负责任务：12.1, 12.9。验证层级：L3/人工UI复核。

现有参照：apps/cli/src/desktop/browser.test.ts；docs/design/piwork-desktop-prototype.md。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Desktop 有独立且可追溯的语言基线](../../specs/desktop-ui-language/spec.md)（DUL-001） | R01/S01：设计后续功能<br>R01/S02：查找 Desktop 的规范来源<br>R01/S03：评审静态原型 |
| R02 | [Work 打开后直接进入 Service 与 Agent 工作区](../../specs/desktop-ui-language/spec.md)（DUL-002） | R02/S01：有可用 Service 的 Work<br>R02/S02：空 Work 或 Service 不可用<br>R02/S03：从 Service 聚焦对话再返回<br>R02/S04：查看详情后返回 |
| R03 | [对象和状态按真实能力表达](../../specs/desktop-ui-language/spec.md)（DUL-003） | R03/S01：保存配置但未应用<br>R03/S02：Operation 观察中断<br>R03/S03：Work 停止或 Core 不可达<br>R03/S04：读取失败与空列表<br>R03/S05：表单校验与重复提交 |
| R04 | [Service 在浏览器内和独立窗口一键可用](../../specs/desktop-ui-language/spec.md)（DUL-004） | R04/S01：打开正在运行的 Service<br>R04/S02：Service 拒绝嵌入<br>R04/S03：Service 无默认 Web 入口或已停止<br>R04/S04：禁止嵌入应用在停止后重新访问 |
| R05 | [文件是 Work 内的可操作主区域](../../specs/desktop-ui-language/spec.md)（DUL-005） | R05/S01：浏览器中管理 Work 文件<br>R05/S02：外部 WebDAV 客户端<br>R05/S03：Work 停止或部分失败 |
| R06 | [Agent 对 Service 数据的来源清晰](../../specs/desktop-ui-language/spec.md)（DUL-006） | R06/S01：用户操作 Service 后请求分析<br>R06/S02：Service 数据不可达 |
| R07 | [Desktop 视觉沿用 Serve 浅色令牌并保持主次](../../specs/desktop-ui-language/spec.md)（DUL-007） | R07/S01：宽屏 Service 与 Agent<br>R07/S02：Work 列表的对齐与独立动作<br>R07/S03：统一调整 Desktop 样式<br>R07/S04：窄屏与键盘<br>R07/S05：弹层关闭后的焦点与草稿<br>R07/S06：主次与长内容 |
| R08 | [Work 生命周期在列表和面板中可操作且可追溯](../../specs/desktop-ui-language/spec.md)（DUL-008） | R08/S01：列表中的运行与停止 Work<br>R08/S02：启动或停止已接受但尚未完成<br>R08/S03：Stop 取代未完成的 Start<br>R08/S04：停止失败<br>R08/S05：删除接受后列表不再返回 Work |
| R09 | [Work 导入导出是可恢复的分步传输](../../specs/desktop-ui-language/spec.md)（DUL-009） | R09/S01：运行中的 Work 申请导出<br>R09/S02：Stop 完成后 Export 被 Core 拒绝<br>R09/S03：快照完成而下载中断<br>R09/S04：省略或显式填写导入名称<br>R09/S05：导入进行中、成功或失败<br>R09/S06：重载后恢复本地已知操作<br>R09/S07：仅检查包与传输边界 |
| R10 | [产品语言以目标用户和任务场景约束后续功能](../../specs/desktop-ui-language/spec.md)（DUL-010） | R10/S01：评审 MVP 是否可以交付<br>R10/S02：增加一个文件分析功能<br>R10/S03：新增技术设置 |
| R11 | [连接、账号和创建具有完整基本流程](../../specs/desktop-ui-language/spec.md)（DUL-011） | R11/S01：首次创建一个工具<br>R11/S02：运行依赖不可用<br>R11/S03：登录过期后返回 |
| R12 | [Session 与 Run 的交互完整且不重复执行](../../specs/desktop-ui-language/spec.md)（DUL-012） | R12/S01：跨 Session 遇到忙碌<br>R12/S02：观察连接丢失<br>R12/S03：取消与成功竞争 |
| R13 | [Service 管理保留真实控制语义](../../specs/desktop-ui-language/spec.md)（DUL-013） | R13/S01：停止后重启 Work<br>R13/S02：运行中的非 Web Service<br>R13/S03：移除服务 |
| R14 | [Work 配置和 Pi Package 有完整保存与应用流程](../../specs/desktop-ui-language/spec.md)（DUL-014） | R14/S01：安装后尚未 Apply<br>R14/S02：编辑配置并离开<br>R14/S03：Apply 失败和后续编辑<br>R14/S04：能力目录与 Work 配置 |
| R15 | [文件表单、传输和外部客户端连接可完成任务](../../specs/desktop-ui-language/spec.md)（DUL-015） | R15/S01：编辑与覆盖<br>R15/S02：目录操作部分失败<br>R15/S03：使用外部文件工具 |
| R16 | [静态原型必须具有可追溯的基础能力覆盖](../../specs/desktop-ui-language/spec.md)（DUL-016） | R16/S01：审查 CLI 基础覆盖<br>R16/S02：单独评审一个模块<br>R16/S03：后续新增功能 |

### desktop-webui

负责任务：12.2–12.9。验证层级：L1/L3。

现有参照：apps/cli/src/desktop/*.test.ts；scripts/desktop-real-acceptance.mjs。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [连接与用户会话在本地入口内完整闭环](../../specs/desktop-webui/spec.md)（DWUI-001） | R01/S01：Core 可达但运行环境失败<br>R01/S02：过期后重新登录<br>R01/S03：切换 Core 或用户 |
| R02 | [以统一语言组织可操作的 Work 工作区](../../specs/desktop-webui/spec.md)（DWUI-002） | R02/S01：从列表进入并切换区域<br>R02/S02：错误不是空列表<br>R02/S03：列表与窄屏可操作 |
| R03 | [Work 创建与生命周期使用真实控制结果](../../specs/desktop-webui/spec.md)（DWUI-003） | R03/S01：默认创建和显式空集合<br>R03/S02：停止取代启动<br>R03/S03：停止失败与删除 |
| R04 | [Session 与 Run 的观察可恢复且不重复提交](../../specs/desktop-webui/spec.md)（DWUI-004） | R04/S01：忙碌时保留输入<br>R04/S02：断线与游标过期<br>R04/S03：取消与成功竞争 |
| R05 | [Service 管理与数据上下文清楚分离](../../specs/desktop-webui/spec.md)（DWUI-005） | R05/S01：非 Web 和禁用 Service<br>R05/S02：移除后文件仍保留<br>R05/S03：请求分析 Service 数据 |
| R06 | [浏览器文件操作覆盖共享 workspace](../../specs/desktop-webui/spec.md)（DWUI-006） | R06/S01：文件读写全流程<br>R06/S02：大文件、特殊项及越界<br>R06/S03：覆盖冲突和响应丢失<br>R06/S04：目录部分失败和后端缺失 |
| R07 | [配置、能力目录与应用形成独立步骤](../../specs/desktop-webui/spec.md)（DWUI-007） | R07/S01：安装与 Apply 分开<br>R07/S02：忙碌与失败回退<br>R07/S03：Apply 期间继续编辑 |
| R08 | [完整 Work 包可以本地检查和原子导入](../../specs/desktop-webui/spec.md)（DWUI-008） | R08/S01：离线检查后关闭<br>R08/S02：自动名称和显式冲突<br>R08/S03：导入完成或失败 |
| R09 | [导出与下载保持显式阶段及原快照恢复](../../specs/desktop-webui/spec.md)（DWUI-009） | R09/S01：运行中请求导出<br>R09/S02：状态显示停止但 Core 拒绝<br>R09/S03：下载断开或过期 |
| R10 | [已知操作恢复不形成隐式任务队列](../../specs/desktop-webui/spec.md)（DWUI-010） | R10/S01：删除后重载<br>R10/S02：提交响应丢失<br>R10/S03：多窗口观察同一任务 |

### mcp-tool-access

负责任务：1.2, 3.8, 3.9, 5.1, 6.8, 7.4, 9.12。验证层级：L1/L2。

现有参照：packages/pi-adapter/src/mcp-*.test.ts；apps/service-mcp/src/main.test.ts。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Discover and invoke configured MCP tools](../../specs/mcp-tool-access/spec.md) | R01/S01：Agent invokes an MCP fixture<br>R01/S02：Two servers expose the same tool name |
| R02 | [Distinguish required and optional dependencies](../../specs/mcp-tool-access/spec.md) | R02/S01：Required MCP is unavailable<br>R02/S02：Optional MCP is unavailable |
| R03 | [Bound tool calls and connection recovery](../../specs/mcp-tool-access/spec.md) | R03/S01：Tool call times out |
| R04 | [Own local processes and respect external lifecycles](../../specs/mcp-tool-access/spec.md) | R04/S01：Stop Work with local and remote MCP<br>R04/S02：Change MCP configuration |
| R05 | [Expose default Work service control through real MCP tools](../../specs/mcp-tool-access/spec.md)（MCP-SERVICE-001） | R05/S01：Discover and invoke deployment tools<br>R05/S02：Register provider-compatible tool identifiers<br>R05/S03：Respect denied deployment tools<br>R05/S04：Honor explicit MCP removal<br>R05/S05：Required adapter fails |
| R06 | [Separate tool call completion from durable deployment completion](../../specs/mcp-tool-access/spec.md)（MCP-SERVICE-002） | R06/S01：A slow registry does not exhaust the MCP call<br>R06/S02：Lost acceptance response<br>R06/S03：Stop the adapter<br>R06/S04：Reject a substituted built-in adapter |

### native-runtime-distribution

负责任务：1.1–1.7, 3.7–3.9, 5.1, 6.5, 7.4, 9.2, 9.12, 11.6, 12.9, 13.5, 14.1–14.9。验证层级：L1/L2/L3/L4。

现有参照：本 change 新增要求；现有产品和浏览器验收扩展到原生产物。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [以独立原生程序交付平台入口](specs/native-runtime-distribution/spec.md)（NATIVE-001） | R01/S01：在无解释器宿主上完成初始化<br>R01/S02：仅安装用户 CLI<br>R01/S03：保留命令身份边界 |
| R02 | [直接使用有明确目标的 Docker Engine](specs/native-runtime-distribution/spec.md)（NATIVE-002） | R02/S01：无 Docker CLI 的完整运行操作<br>R02/S02：显式目标无法使用<br>R02/S03：镜像拉取需要外部凭证程序<br>R02/S04：Engine 版本不兼容 |
| R03 | [随原生程序提供既有浏览器界面](specs/native-runtime-distribution/spec.md)（NATIVE-003） | R03/S01：从任意工作目录打开 Desktop<br>R03/S02：无代理配置访问 Service<br>R03/S03：Console 独立退出 |
| R04 | [保持与容器内 Pi 生态的当前契约](specs/native-runtime-distribution/spec.md)（NATIVE-004） | R04/S01：双向真实 RPC 部署<br>R04/S02：拒绝旧代次控制请求<br>R04/S03：包准备后离线恢复<br>R04/S04：保留完整 TS Agent harness |
| R05 | [平台辅助程序使用 Go 并保持执行边界](specs/native-runtime-distribution/spec.md)（NATIVE-005） | R05/S01：无 Python 或 Node 的文件访问<br>R05/S02：快照恢复既有 Agent 历史<br>R05/S03：helper 失败仍保持恢复边界<br>R05/S04：Go MCP 保持工具协议<br>R05/S05：Go package-helper 完成四入口<br>R05/S06：拒绝旧 TS helper 或虚假镜像能力<br>R05/S07：静态拒绝不支持的固定 Agent 镜像 |
| R06 | [原生交付覆盖完整的 Work 使用闭环](specs/native-runtime-distribution/spec.md)（NATIVE-006） | R06/S01：一个 Work 的日常工作流<br>R06/S02：完整包在两个 Go 安装间迁移<br>R06/S03：观察中断与未知写入结果<br>R06/S04：未完成场景的验收状态 |
| R07 | [发布产物与运行文档不再依赖旧平台实现](specs/native-runtime-distribution/spec.md)（NATIVE-007） | R07/S01：脱离源码运行发布包<br>R07/S02：删除旧实现后的完整构建<br>R07/S03：不自动接管开发安装<br>R07/S04：源码与镜像内平台程序一致<br>R07/S05：镜像内 Pi 生态继续可用 |

### online-pi-package-compatibility

负责任务：3.7, 3.9, 6.5, 6.8, 6.10, 9.12。验证层级：L2（含在线来源）。

现有参照：scripts/online-pi-package-acceptance.mjs；scripts/pi-web-access-acceptance.mjs。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [OPKG-001 接纳带私有运行时依赖的已发布包](../../specs/online-pi-package-compatibility/spec.md) | R01/S01：已发布包依赖 TypeBox<br>R01/S02：Pi 核心模块被声明为运行时依赖<br>R01/S03：声明的运行时依赖缺失或逸出产物 |
| R02 | [OPKG-002 匹配声明的 Pi 宿主 peer 版本](../../specs/online-pi-package-compatibility/spec.md) | R02/S01：所选镜像满足 peer 范围<br>R02/S02：所选镜像版本过旧<br>R02/S03：peer 范围格式错误<br>R02/S04：接受请求后镜像标签改变 |
| R03 | [OPKG-003 在接受请求前拒绝不兼容的 package-helper 镜像](../../specs/online-pi-package-compatibility/spec.md) | R03/S01：旧准备镜像缺少 helper<br>R03/S02：可信 helper 镜像缺少 helper<br>R03/S03：镜像删除后重放<br>R03/S04：区分失败类型 |
| R04 | [OPKG-004 在真实 Work 中验收固定版本的在线包](../../specs/online-pi-package-compatibility/spec.md) | R04/S01：已发布包运行前台子代理<br>R04/S02：已发布包运行后台子代理<br>R04/S03：registry 不可用<br>R04/S04：SDK 升级期间保留旧冻结包 |

### pi-package-activation

负责任务：1.4, 3.7, 6.3, 6.6, 6.8, 9.8。验证层级：L1/L2。

现有参照：apps/agentd/src/package-resources.test.ts；apps/core/src/configuration/*.test.ts。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Load only the captured enabled package resources](../../specs/pi-package-activation/spec.md)（PKGA-001） | R01/S01：A valid package extends the agent<br>R01/S02：A disabled package contains an invalid extension<br>R01/S03：Reject implicit discovery<br>R01/S04：Required extension fails during initialization |
| R02 | [Apply package changes at the established configuration boundary](../../specs/pi-package-activation/spec.md)（PKGA-002） | R02/S01：Update then restart without apply<br>R02/S02：Explicit apply activates the package<br>R02/S03：Roll back a broken candidate<br>R02/S04：Apply a stopped Work |
| R03 | [Reject ambiguous resources and enforce package tool policy](../../specs/pi-package-activation/spec.md)（PKGA-003） | R03/S01：A package conflicts with a standalone Skill<br>R03/S02：A denied package tool is registered<br>R03/S03：Two packages register the same native tool |
| R04 | [Bind headless extension events to isolated SDK sessions](../../specs/pi-package-activation/spec.md)（PKGA-004） | R04/S01：Execute a real registered tool and events<br>R04/S02：Isolate two SDK sessions<br>R04/S03：A session start hook fails<br>R04/S04：A runtime event hook fails<br>R04/S05：Shutdown hook fails after a terminal result |
| R05 | [Verify actual package readiness before routing](../../specs/pi-package-activation/spec.md)（PKGA-005） | R05/S01：Same name and version but wrong bytes<br>R05/S02：Adopt a container after Core restart<br>R05/S03：Old agent omits package support |

### pi-package-management

负责任务：3.7, 3.9, 6.4–6.10, 9.2, 9.8。验证层级：L1/L2。

现有参照：apps/core/src/packages/*.test.ts；packages/pi-package/src/*.test.ts；scripts/pi-package-fault-acceptance.mjs。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Normalize four sources into owned package artifacts](../../specs/pi-package-management/spec.md)（PKG-001） | R01/S01：Install the same package from each source<br>R01/S02：A client path differs from the Core host<br>R01/S03：Reject an ambiguous identity or archive<br>R01/S04：Freeze a mutable source<br>R01/S05：浏览器提供本地输入 |
| R02 | [Prepare executable dependencies outside the control plane](../../specs/pi-package-management/spec.md)（PKG-002） | R02/S01：An installation script attempts platform access<br>R02/S02：A script fails or exceeds its deadline<br>R02/S03：Distinguish source retrieval from dependency installation failure<br>R02/S04：Complete a compatible public npm install<br>R02/S05：A third preparation is accepted |
| R03 | [Validate and scope package input transfers](../../specs/pi-package-management/spec.md)（PKG-003） | R03/S01：Use another scope's upload<br>R03/S02：Preserve a valid dependency link<br>R03/S03：Reject a ZIP bomb or escaping link<br>R03/S04：Retain a leased upload<br>R03/S05：A remote source or install script exceeds preparation space<br>R03/S06：Core 上传隔离管理员 |
| R04 | [Manage the Core catalog separately from default selection](../../specs/pi-package-management/spec.md)（PKG-004） | R04/S01：Install without changing defaults<br>R04/S02：Atomically install a default<br>R04/S03：Protect a default reference<br>R04/S04：Future Works observe the new head<br>R04/S05：管理员和 operator 共享同一 Core 库 |
| R05 | [Distinguish install update and state-only mutations](../../specs/pi-package-management/spec.md)（PKG-005） | R05/S01：Duplicate install requires explicit update<br>R05/S02：Update a disabled package<br>R05/S03：Remove a currently active package<br>R05/S04：Copy explicitly from the current Core<br>R05/S05：Core head changes before Work acceptance |
| R06 | [Persist package operations and idempotent outcomes](../../specs/pi-package-management/spec.md)（PKG-006） | R06/S01：Retry an accepted request after a lost response<br>R06/S02：Retry a failed installation<br>R06/S03：Observe safe package preparation phase<br>R06/S04：Crash at publication<br>R06/S05：管理员按 ID 恢复 Core 任务<br>R06/S06：同键不串用管理员 |
| R07 | [Fence concurrency and merge unrelated desired edits](../../specs/pi-package-management/spec.md)（PKG-007） | R07/S01：Preserve a model edit during package preparation<br>R07/S02：Concurrent package mutations<br>R07/S03：Delete fences late completion<br>R07/S04：Preserve later desired state across apply |
| R08 | [Report installed desired active and loaded separately](../../specs/pi-package-management/spec.md)（PKG-008） | R08/S01：An installed package has not been applied<br>R08/S02：Stop a previously loaded Work<br>R08/S03：Read unauthorized package state |
| R09 | [Retain every referenced artifact until safe collection](../../specs/pi-package-management/spec.md)（PKG-009） | R09/S01：Retain a removed package for active and history<br>R09/S02：Artifact corruption is not an upgrade trigger |

### portable-work

负责任务：9.1–9.4, 9.7, 9.8, 9.12, 14.8。验证层级：L1/L2/L4。

现有参照：packages/work-package/src/*.test.ts；packages/work-store/src/snapshot.test.ts；scripts/work-snapshot-acceptance.mjs。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Define a versioned complete Work aggregate](../../specs/portable-work/spec.md)（PWORK-001） | R01/S01：A self-contained Work<br>R01/S02：Reject missing or unknown structure<br>R01/S03：Reject an incomplete reservation graph<br>R01/S04：Reject an incomplete storage graph<br>R01/S05：Reject a pre-package V1 file<br>R01/S06：Validate a package reference graph |
| R02 | [Preserve the full owned persistent content](../../specs/portable-work/spec.md)（PWORK-002） | R02/S01：Preserve development and business state<br>R02/S02：Platform credentials are not transferable authority<br>R02/S03：Preserve historical definitions<br>R02/S04：Preserve a reservation after failed disable<br>R02/S05：Export an imported Work again<br>R02/S06：Preserve every retained package version<br>R02/S07：Export again after removing the input file |
| R03 | [Transfer captured environments without substituting dependencies](../../specs/portable-work/spec.md)（PWORK-003） | R03/S01：Import without the original registry<br>R03/S02：Do not fabricate absent history<br>R03/S03：Reject another architecture<br>R03/S04：Move with all package origins offline<br>R03/S05：Reject incompatible native dependencies |
| R04 | [Instantiate independent identity with automatic platform resolution](../../specs/portable-work/spec.md)（PWORK-004） | R04/S01：Import twice independently<br>R04/S02：Resolve the recipient model without bindings<br>R04/S03：Report an unavailable model<br>R04/S04：Do not silently drop custom external MCP credentials<br>R04/S05：Keep arbitrary application content<br>R04/S06：Independent package state after importing twice |
| R05 | [导入后按目标身份重建默认服务域名](../../specs/portable-work/spec.md)（PWORK-SERVICE-ACCESS-001） | R05/S01：同一包导入两次<br>R05/S02：未启动的导入 Work<br>R05/S03：保持 V1 包字节契约 |

### runnable-work-runtime

负责任务：1.5, 3.2, 3.3, 3.7–3.9, 5.1, 6.5, 6.8, 9.12。验证层级：L1/L2。

现有参照：apps/core/src/runtime/*.test.ts；apps/agentd/src/*.test.ts；scripts/product-acceptance.mjs。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Build a compatible agentd image from the workspace](../../specs/runnable-work-runtime/spec.md) | R01/S01：Build and inspect the local image<br>R01/S02：Reject an incompatible image |
| R02 | [Materialize each Work into an isolated Docker runtime](../../specs/runnable-work-runtime/spec.md)（RUNTIME-MATERIALIZE-001） | R02/S01：Start one Work from its active context<br>R02/S02：Start one Work from an accepted configuration<br>R02/S03：Reconcile an existing instance<br>R02/S04：Restart after a Core Skill changes<br>R02/S05：Reject active context failure<br>R02/S06：Reject context materialization failure<br>R02/S07：Mount packages without their source |
| R03 | [Keep model credentials out of public and persisted conversation data](../../specs/runnable-work-runtime/spec.md) | R03/S01：Start agentd with a model credential<br>R03/S02：Model credential is missing or invalid |
| R04 | [Authenticate and verify Core-to-agent transport](../../specs/runnable-work-runtime/spec.md) | R04/S01：Route to the current generation<br>R04/S02：Reject a stale daemon |
| R05 | [Serve persistent Sessions from agentd](../../specs/runnable-work-runtime/spec.md) | R05/S01：Create and restore a Session<br>R05/S02：Reject a cross-Work Session request |
| R06 | [Execute Runs through the real Pi SDK](../../specs/runnable-work-runtime/spec.md)（RUNTIME-PI-001） | R06/S01：Receive a deterministic acceptance reply through the real stack<br>R06/S02：Use a real configured model<br>R06/S03：Load complete Skill directories from the Work<br>R06/S04：Isolate Session context<br>R06/S05：Session context is loaded from the Work<br>R06/S06：Retry a lost submit response<br>R06/S07：Execute package functionality in the real SDK |
| R07 | [Preserve Runs independently of transport lifetime](../../specs/runnable-work-runtime/spec.md) | R07/S01：Disconnect while a Run is executing<br>R07/S02：Restart during an active Run |
| R08 | [Drain and retain Work data on lifecycle operations](../../specs/runnable-work-runtime/spec.md) | R08/S01：Stop and start a Work with history<br>R08/S02：Stop cannot be confirmed |
| R09 | [Enable the full container tool set](../../specs/runnable-work-runtime/spec.md)（RUNTIME-TOOLS-001） | R09/S01：Default tools are available in a Work<br>R09/S02：Denied tools are excluded<br>R09/S03：Reject unsupported tool policy<br>R09/S04：Resolve package tool policy |
| R10 | [Verify the loaded context before routing](../../specs/runnable-work-runtime/spec.md)（RUNTIME-CONTEXT-001） | R10/S01：Verify the expected copied Skills<br>R10/S02：Reject stale or incomplete readiness<br>R10/S03：Reject an old agent protocol<br>R10/S04：Re-adopt after Core restart<br>R10/S05：Reject a stale package identity<br>R10/S06：Do not infer support from an empty package list |
| R11 | [Keep Skill data independent of the agent image](../../specs/runnable-work-runtime/spec.md)（RUNTIME-CONTEXT-002） | R11/S01：Complete the lifecycle with one image<br>R11/S02：A tag changes after capture<br>R11/S03：Candidate directory changes during apply<br>R11/S04：Use four sources with one compatible runtime image |
| R12 | [RUNTIME-PI-PKG-001 向包的子代理提供已捕获的 Pi 安装](../../specs/runnable-work-runtime/spec.md) | R12/S01：前台子代理使用匹配的 Pi 安装<br>R12/S02：后台子代理始终属于当前 Work<br>R12/S03：Work 停止时仍有活跃子代理<br>R12/S04：子代理无法发现其他上下文 |

### serve-control-plane

负责任务：4.1, 4.3, 4.5, 4.6, 6.9。验证层级：L1/L2。

现有参照：apps/core/src/application/control-plane.test.ts；env-file.test.ts；apps/core/src/cli.test.ts。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Provide a dedicated operator control plane](../../specs/serve-control-plane/spec.md)（SERVE-CTRL-001） | R01/S01：Operator controls an initialized Core<br>R01/S02：Operator manages a Skill path<br>R01/S03：Operator updates the default Work configuration<br>R01/S04：Default changes do not mutate existing Works<br>R01/S05：Operator client is not a user client<br>R01/S06：Read a Core package operation<br>R01/S07：Keep unrelated defaults on package edit<br>R01/S08：管理员使用稳定管理 API<br>R01/S09：面板未启动仍能使用控制面 |
| R02 | [Keep Core reachable before initialization](../../specs/serve-control-plane/spec.md)（SERVE-START-001） | R02/S01：Start an empty installation<br>R02/S02：Complete initialization while Core is running<br>R02/S03：Reject an invalid default Work configuration<br>R02/S04：Clear default Skills explicitly<br>R02/S05：Reject preparation before runtime setup<br>R02/S06：Clear package defaults independently |
| R03 | [Initialize selected environment files safely](../../specs/serve-control-plane/spec.md) | R03/S01：Bootstrap from `.env.test`<br>R03/S02：Preserve persisted state on restart |
| R04 | [Separate operator and user credentials](../../specs/serve-control-plane/spec.md) | R04/S01：Use operator credential for control commands<br>R04/S02：Reject unsafe operator credential storage |

### serve-ui

负责任务：13.1–13.5。验证层级：L1/L3。

现有参照：apps/console/src/server.test.ts；browser-security.test.ts；scripts/console-process-smoke.mjs。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [独立启动同机管理面板](../../specs/serve-ui/spec.md)（SUI-001） | R01/S01：独立运行两个进程<br>R01/S02：Core 暂时不可达<br>R01/S03：拒绝不完整或跨机配置<br>R01/S04：面板崩溃后重启 |
| R02 | [仅管理员获得浏览器管理会话](../../specs/serve-ui/spec.md)（SUI-002） | R02/S01：管理员登录<br>R02/S02：普通用户登录<br>R02/S03：会话容量已满<br>R02/S04：伪造管理请求<br>R02/S05：登录失败与限流 |
| R03 | [会话失效与注销有明确边界](../../specs/serve-ui/spec.md)（SUI-003） | R03/S01：管理员在另一客户端被禁用<br>R03/S02：只注销当前浏览器<br>R03/S03：连接中断后恢复 |
| R04 | [提供一致的管理员导航和表单状态](../../specs/serve-ui/spec.md)（SUI-004） | R04/S01：空列表与加载失败<br>R04/S02：保存失败保留编辑<br>R04/S03：恶意名称与窄屏操作 |

### serve-ui-configuration

负责任务：13.3, 13.5。验证层级：L3。

现有参照：apps/console/src/browser；apps/console/browser-tests；docs/serve-console.md。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [展示 Core 的真实管理状态](../../specs/serve-ui-configuration/spec.md)（SUI-CFG-001） | R01/S01：健康但未配置运行时<br>R01/S02：丢失 Core 连接 |
| R02 | [配置全局运行时并区分保存结果](../../specs/serve-ui-configuration/spec.md)（SUI-CFG-002） | R02/S01：首次配置<br>R02/S02：Docker 暂时不可用<br>R02/S03：缺少 credential 或提交失败 |
| R03 | [按编辑字段更新默认 Work](../../specs/serve-ui-configuration/spec.md)（SUI-CFG-003） | R03/S01：仅修改默认 packages<br>R03/S02：清空某一默认选择<br>R03/S03：选择在提交前被禁用<br>R03/S04：默认 Skills 为空<br>R03/S05：长名称与重复排序动作<br>R03/S06：已选 Skill 不再可用 |
| R04 | [从文件或编辑器保存 AGENTS 内容](../../specs/serve-ui-configuration/spec.md)（SUI-CFG-004） | R04/S01：选择后继续编辑<br>R04/S02：文件超限或无效<br>R04/S03：临界大小与清空 |

### serve-ui-packages

负责任务：13.4, 13.5。验证层级：L1/L3。

现有参照：apps/console/src/package-inputs.test.ts；apps/console/browser-tests。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [查看 Core package 库](../../specs/serve-ui-packages/spec.md)（SUI-PKG-001） | R01/S01：包已安装但未默认选择<br>R01/S02：空库或对象失效 |
| R02 | [安装和更新四种 package 来源](../../specs/serve-ui-packages/spec.md)（SUI-PKG-002） | R02/S01：四类来源均可安装<br>R02/S02：原子安装并加入默认<br>R02/S03：更新错误名称<br>R02/S04：ZIP 或目录不可用 |
| R03 | [区分上传、接受和持久 Operation](../../specs/serve-ui-packages/spec.md)（SUI-PKG-003） | R03/S01：响应丢失后恢复接受<br>R03/S02：停止观察<br>R03/S03：准备失败后显式重试 |
| R04 | [按 ID 找回 Core 包操作](../../specs/serve-ui-packages/spec.md)（SUI-PKG-004） | R04/S01：在另一台设备恢复查询<br>R04/S02：尝试查询 Work Operation |
| R05 | [控制 Core package 状态与默认关联](../../specs/serve-ui-packages/spec.md)（SUI-PKG-005） | R05/S01：移除默认包<br>R05/S02：Core 正在安装其他包 |

### serve-ui-skills

负责任务：13.4, 13.5。验证层级：L3。

现有参照：apps/console/src/browser；apps/console/browser-tests。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [浏览完整 Skill 管理状态](../../specs/serve-ui-skills/spec.md)（SUI-SKL-001） | R01/S01：查看禁用 Skill<br>R01/S02：列表为空或详情失效 |
| R02 | [通过本地目录添加和更新 Skill](../../specs/serve-ui-skills/spec.md)（SUI-SKL-002） | R02/S01：上传另一台设备上的目录<br>R02/S02：目录名称与内容名称不同<br>R02/S03：更新名称不符<br>R02/S04：无效目录或上传中断 |
| R03 | [执行 Skill 开关与移除](../../specs/serve-ui-skills/spec.md)（SUI-SKL-003） | R03/S01：默认引用保护<br>R03/S02：移除非默认 Skill |

### serve-ui-users

负责任务：13.2, 13.3, 13.5。验证层级：L3。

现有参照：apps/console/src/browser；apps/console/browser-tests。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [列出与创建管理账号](../../specs/serve-ui-users/spec.md)（SUI-USR-001） | R01/S01：创建默认普通用户<br>R01/S02：创建另一个管理员<br>R01/S03：无效或重复账号 |
| R02 | [安全执行用户状态与凭证操作](../../specs/serve-ui-users/spec.md)（SUI-USR-002） | R02/S01：禁用再启用用户<br>R02/S02：最后一名管理员<br>R02/S03：重置自己的密码<br>R02/S04：取消或并发删除状态 |

### service-network-access

负责任务：7.6–7.8, 11.1, 11.4, 12.6。验证层级：L1/L2/L3。

现有参照：apps/core/src/work-services/service-domain-resolver.test.ts；service-gateway.test.ts；apps/cli/src/service-proxy.test.ts。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [分配稳定且唯一的 Work 和 service 网络身份](../../specs/service-network-access/spec.md)（SNET-001） | R01/S01：中文 Work 和普通服务<br>R01/S02：前缀冲突<br>R01/S03：不合法的旧 service 名称 |
| R02 | [对声明的 TCP 端口提供明确的访问地址](../../specs/service-network-access/spec.md)（SNET-002） | R02/S01：HTTP readiness 使用其他路径<br>R02/S02：多端口显式选择<br>R02/S03：空端口或 UDP-only |
| R03 | [经 Core 网关传输 HTTP、SSE 与 WebSocket](../../specs/service-network-access/spec.md)（SNET-003） | R03/S01：浏览器与 curl 访问同一服务<br>R03/S02：SSE 与 WebSocket<br>R03/S03：禁止其他目标 |
| R04 | [生命周期变化及时撤销访问](../../specs/service-network-access/spec.md)（SNET-004） | R04/S01：Work 停止并重新启动<br>R04/S02：service 删除或用户登出<br>R04/S03：未确认容器 |

### skill-activation

负责任务：1.4, 6.2, 6.3, 9.12。验证层级：L1/L2。

现有参照：apps/agentd/src/skills.test.ts；apps/core/src/configuration/*.test.ts。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Activate only configured immutable Skills](../../specs/skill-activation/spec.md)（SKILL-001） | R01/S01：Configured Skill is usable<br>R01/S02：SKILL metadata cannot rename a configured Skill<br>R01/S03：Core-managed Skill changes<br>R01/S04：Skill source changes<br>R01/S05：Default Skills are copied once<br>R01/S06：Empty Skills remain isolated<br>R01/S07：Distinguish same-name copies<br>R01/S08：Reject a loader bound to another directory<br>R01/S09：Respect invocation controls<br>R01/S10：Load a Skill from an explicitly enabled package<br>R01/S11：Reject a duplicate Skill across resource owners |
| R02 | [Fail required Skill initialization explicitly](../../specs/skill-activation/spec.md)（SKILL-002） | R02/S01：Corrupted Work-owned Skill<br>R02/S02：Corrupted Skill artifact<br>R02/S03：Invalid AGENTS content<br>R02/S04：SDK-invalid content accepted by Core import<br>R02/S05：Incomplete or unsafe input<br>R02/S06：Pending load is not readiness |
| R03 | [Apply Skill changes at configuration activation](../../specs/skill-activation/spec.md)（SKILL-003） | R03/S01：Remove a Skill<br>R03/S02：Adopt updated managed content explicitly<br>R03/S03：Apply new AGENTS content<br>R03/S04：Preserve a later Skill edit |

### skill-management

负责任务：6.2, 6.9, 10.3, 13.4。验证层级：L1/L2/L3。

现有参照：apps/core/src/configuration/skill-*.test.ts；skills.test.ts。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Import a complete Skill directory into Core](../../specs/skill-management/spec.md)（SKM-001） | R01/S01：Import a valid directory<br>R01/S02：Reject an unsafe or malformed directory<br>R01/S03：Reject a duplicate Skill name<br>R01/S04：Ignore SKILL metadata when assigning identity<br>R01/S05：Reject non-operator import |
| R02 | [Manage a Skill by its directory name](../../specs/skill-management/spec.md)（SKM-002） | R02/S01：Update current content<br>R02/S02：Reject an update name mismatch<br>R02/S03：Protect the default selection<br>R02/S04：Remove an unreferenced managed Skill<br>R02/S05：管理员更新禁用 Skill 的上传内容 |
| R03 | [Discover selectable Skills without host details](../../specs/skill-management/spec.md)（SKM-003） | R03/S01：User lists selectable Skills<br>R03/S02：Operator lists all managed Skills<br>R03/S03：Show an unavailable Skill<br>R03/S04：管理员查看完整管理状态 |
| R04 | [接收客户端 Skill 目录内容](../../specs/skill-management/spec.md)（SKM-004） | R04/S01：远程目录内容成功添加<br>R04/S02：拒绝逃逸和重复内容<br>R04/S03：中断与限额<br>R04/S04：恰好达到上限<br>R04/S05：内容入口不读取宿主路径 |

### ui-language

负责任务：12.9, 13.5。验证层级：L3/人工UI复核。

现有参照：docs/ui-language.md；docs/product-language.md；apps/console/browser-tests。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [仓库分别提供可沿用的 UI 语言与产品语言](../../specs/ui-language/spec.md)（UIL-001） | R01/S01：后续新增浏览器页面<br>R01/S02：特殊场景需要例外<br>R01/S03：后续新增 Desktop 功能 |
| R02 | [Serve 管理面板呈现安静的技术工作台](../../specs/ui-language/spec.md)（UIL-002） | R02/S01：登录与主导航<br>R02/S02：语义状态与视觉强调 |
| R03 | [管理内容采用紧凑且统一的页面结构](../../specs/ui-language/spec.md)（UIL-003） | R03/S01：列表和编辑区并存<br>R03/S02：同页状态与配置卡片对齐<br>R03/S03：跨管理路由的页面轨道<br>R03/S04：登录窄表单与管理页面<br>R03/S05：长技术内容<br>R03/S06：桌面表单与窄屏折叠 |
| R04 | [各交互状态在键盘与窄屏下仍可辨识](../../specs/ui-language/spec.md)（UIL-004） | R04/S01：加载、空态与失败<br>R04/S02：键盘与窄屏 |
| R05 | [改动后的界面可按现有部署方式预览](../../specs/ui-language/spec.md)（UIL-005） | R05/S01：本地预览新版 UI<br>R05/S02：复核视觉交付 |
| R06 | [页面按管理对象和作用范围组织信息](../../specs/ui-language/spec.md)（UIL-006） | R06/S01：管理默认 Work 与运行时<br>R06/S02：查看包操作详情<br>R06/S03：页面 Content 与空态<br>R06/S04：长名称与技术标识 |
| R07 | [按操作对象与风险安排按钮](../../specs/ui-language/spec.md)（UIL-007） | R07/S01：同页有列表和创建表单<br>R07/S02：危险操作与窄屏 |
| R08 | [文案准确表达动作、状态与下一步](../../specs/ui-language/spec.md)（UIL-008） | R08/S01：空集合与读取失败<br>R08/S02：保存与运行状态不同<br>R08/S03：包安装结果尚未确定<br>R08/S04：界面语言与原始数据<br>R08/S05：字段错误与整体失败<br>R08/S06：草稿、提交与未知结果 |
| R09 | [容器层级与内容职责跨页面一致](../../specs/ui-language/spec.md)（UIL-009） | R09/S01：列表、表单与字段错误<br>R09/S02：技术详情与长内容<br>R09/S03：状态切换不改变容器位置<br>R09/S04：后续新增容器 |

### user-administration

负责任务：4.2, 4.4, 4.5, 13.3。验证层级：L1/L2/L3。

现有参照：apps/core/src/identity/user-administration.test.ts；apps/core/src/application/admin-http.test.ts。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Initial administrator bootstrap](../../specs/user-administration/spec.md) | R01/S01：Bootstrap through the control plane<br>R01/S02：Bootstrap an empty instance<br>R01/S03：Reject user-client bootstrap<br>R01/S04：Repeat bootstrap |
| R02 | [Administrator manages users](../../specs/user-administration/spec.md) | R02/S01：Manage users through the operator CLI<br>R02/S02：Create a normal user<br>R02/S03：Duplicate or unauthorized creation |
| R03 | [Disabling and resetting revoke access](../../specs/user-administration/spec.md) | R03/S01：Disable a connected user<br>R03/S02：Reset password and re-enable |
| R04 | [Preserve an enabled administrator](../../specs/user-administration/spec.md) | R04/S01：Disable the last administrator |

### user-authentication

负责任务：4.2, 10.1, 12.3, 13.2。验证层级：L1/L2/L3。

现有参照：apps/core/src/identity/sessions.test.ts；packages/client-sdk/src/index.test.ts。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Authenticate enabled users](../../specs/user-authentication/spec.md) | R01/S01：Successful CLI login<br>R01/S02：Invalid credentials |
| R02 | [Expire and revoke login sessions](../../specs/user-authentication/spec.md) | R02/S01：Logout one of two sessions<br>R02/S02：Session expires during observation |
| R03 | [Protect credential handling](../../specs/user-authentication/spec.md) | R03/S01：Browser request forgery<br>R03/S02：Credentials are not diagnostics |
| R04 | [Bound failed login attempts](../../specs/user-authentication/spec.md) | R04/S01：Repeated invalid login |

### work-access

负责任务：3.8, 4.4, 5.5, 7.4, 7.8, 8.6, 9.6, 11.2, 12.3。验证层级：L1/L2/L3。

现有参照：apps/core/src/work-access/policy.test.ts；work-files/access.test.ts；work-snapshots/access.test.ts。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Owner-scoped Work access](../../specs/work-access/spec.md) | R01/S01：Access another user's Work<br>R01/S02：List owned resources |
| R02 | [Separate administration from conversation access](../../specs/work-access/spec.md) | R02/S01：Administrator stops another user's Work |
| R03 | [Work runtime identity is limited and fenced](../../specs/work-access/spec.md)（WACC-SERVICE-001） | R03/S01：Cross-Work service creation<br>R03/S02：Replaced daemon sends a late request<br>R03/S03：Refuse daemon self-management<br>R03/S04：Reject unauthenticated sibling<br>R03/S05：Reject forged ownership metadata<br>R03/S06：Initialization cannot deploy |
| R04 | [Enforce resource and transport isolation](../../specs/work-access/spec.md) | R04/S01：Forbidden mount or runtime privilege<br>R04/S02：Direct unauthorized daemon access<br>R04/S03：Network boundary |
| R05 | [Authorize service content independently of control metadata](../../specs/work-access/spec.md)（WACC-SERVICE-002） | R05/S01：Read own application logs<br>R05/S02：Admin can repair without content access |
| R06 | [Authorize full packages as owner content rather than control metadata](../../specs/work-access/spec.md)（WACC-SNAPSHOT-001） | R06/S01：Administrator cannot export private content<br>R06/S02：Forge ownership in the manifest<br>R06/S03：Access a failed unpublished import<br>R06/S04：Imported agent controls only its new Work |
| R07 | [将应用内容访问限定为当前 Work 所有者](../../specs/work-access/spec.md)（WACC-SERVICE-ACCESS-001） | R07/S01：管理员不获得应用正文<br>R07/S02：伪造其他 Work 域名<br>R07/S03：登出撤销活动连接 |
| R08 | [隔离平台认证与应用认证](../../specs/work-access/spec.md)（WACC-SERVICE-ACCESS-002） | R08/S01：应用使用自己的 Bearer<br>R08/S02：应用返回 401 |
| R09 | [将 workspace 文件内容限定为当前所有者](../../specs/work-access/spec.md)（WACC-FILES-001） | R09/S01：管理员有控制权限但没有文件权限<br>R09/S02：猜测Work身份或存储目标<br>R09/S03：长上传期间撤销会话<br>R09/S04：原样传输用户文件 |
| R10 | [隔离本地 WebDAV 认证与 service 应用认证](../../specs/work-access/spec.md)（WACC-FILES-002） | R10/S01：同一proxy交替访问service与文件<br>R10/S02：错误本地密码<br>R10/S03：临时密码误投到service<br>R10/S04：Basic认证方案大小写变化<br>R10/S05：浏览器跨站访问本地文件入口 |
| R11 | [Desktop 浏览器授权不得泄漏平台身份](../../specs/work-access/spec.md)（WACC-DESKTOP-001） | R11/S01：任意网站探测本地入口<br>R11/S02：Service 试图借用平台身份<br>R11/S03：浏览器文件与外部 WebDAV 并存<br>R11/S04：本地会话失效 |

### work-configuration

负责任务：6.1–6.3, 6.6, 6.8, 9.8, 10.3。验证层级：L1/L2/L3。

现有参照：apps/core/src/configuration/*.test.ts；apps/core/src/work-snapshots/import-contexts.test.ts。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Select a complete Work environment](../../specs/work-configuration/spec.md)（WCFG-001） | R01/S01：Copy defaults at creation<br>R01/S02：Create with explicit Skills<br>R01/S03：Create a configured Work<br>R01/S04：Create with no Skills<br>R01/S05：Configure one Work<br>R01/S06：Reject host-path context references<br>R01/S07：Fail context copy atomically<br>R01/S08：Secret query<br>R01/S09：Copy package defaults once<br>R01/S10：Explicit package selection and empty selection<br>R01/S11：Reject implicit package installation by config set |
| R02 | [Validate environment compatibility](../../specs/work-configuration/spec.md) | R02/S01：Invalid reference before acceptance<br>R02/S02：Image fails during preparation |
| R03 | [Manage desired and active context without public revisions](../../specs/work-configuration/spec.md)（WCFG-002） | R03/S01：Update without implicit restart<br>R03/S02：Apply the desired context<br>R03/S03：Preserve a later edit during apply<br>R03/S04：Fail an invalid apply safely<br>R03/S05：Order concurrent desired updates<br>R03/S06：Initial Skill loading fails<br>R03/S07：Retry failed apply without changing Skills<br>R03/S08：Apply while a Run is active<br>R03/S09：Validate a stopped Work<br>R03/S10：Rollback also fails<br>R03/S11：Stop supersedes apply<br>R03/S12：Same declared version different package content |
| R04 | [Resolve reproducible artifacts](../../specs/work-configuration/spec.md)（WCFG-003） | R04/S01：Mutable tag changes<br>R04/S02：Managed Skill changes<br>R04/S03：Stable Skill and AGENTS revision<br>R04/S04：Source directory disappears<br>R04/S05：Preserve packages on an unrelated edit |
| R05 | [Expose and enforce supported resource policy](../../specs/work-configuration/spec.md) | R05/S01：Unsupported storage limit |
| R06 | [Distinguish selected active and loaded Skills](../../specs/work-configuration/spec.md)（WCFG-004） | R06/S01：Save without apply<br>R06/S02：Successfully apply a Skill<br>R06/S03：Stop or lose the daemon<br>R06/S04：Read another owner's Work |
| R07 | [Support current-format context without legacy reconstruction](../../specs/work-configuration/spec.md)（WCFG-005） | R07/S01：Fresh install and same-version restart<br>R07/S02：Unsupported historical context<br>R07/S03：Do not backfill packages into old contexts<br>R07/S04：Fresh empty package configuration |
| R08 | [Reserve deployment capacity separately from agent resources](../../specs/work-configuration/spec.md)（WCFG-SERVICE-001） | R08/S01：Deploy from a fresh default Work<br>R08/S02：Reject insufficient budget<br>R08/S03：Preserve customized defaults |
| R09 | [Restore owned contexts without recopying recipient defaults](../../specs/work-configuration/spec.md)（WCFG-SNAPSHOT-001） | R09/S01：No managed Skill exists on the recipient<br>R09/S02：Preserve unapplied changes<br>R09/S03：Preserve imported assets on an unrelated edit<br>R09/S04：No successful source initialization<br>R09/S05：Preserve built-in service tools across installations<br>R09/S06：Do not reintroduce removed service tools<br>R09/S07：Recipient catalog has a different package<br>R09/S08：Imported desired remains pending |

### work-connectivity

负责任务：5.1, 5.5, 5.6, 10.5。验证层级：L1/L2/L3。

现有参照：apps/agentd/src/runs.test.ts；packages/contracts/src/agent-proto.test.ts；scripts/product-acceptance.mjs。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Discover and connect by stable Work identity](../../specs/work-connectivity/spec.md) | R01/S01：Connect after instance replacement |
| R02 | [Route only to a verified ready instance](../../specs/work-connectivity/spec.md) | R02/S01：Connect to a stopped Work<br>R02/S02：Core recovers routing |
| R03 | [Observe ordered identifiable Run events](../../specs/work-connectivity/spec.md) | R03/S01：Stream failure after progress |
| R04 | [Resume observation within explicit retention bounds](../../specs/work-connectivity/spec.md) | R04/S01：Resume within window<br>R04/S02：Resume with expired cursor |
| R05 | [Bound slow observers independently](../../specs/work-connectivity/spec.md) | R05/S01：One of two observers stops reading |
| R06 | [Provide a minimal remote CLI](../../specs/work-connectivity/spec.md) | R06/S01：Login create and chat |

### work-diagnostics

负责任务：5.3, 5.7, 7.5, 9.11, 10.2, 10.6。验证层级：L1/L2/L3。

现有参照：apps/core/src/work-management/diagnostics.test.ts；apps/agentd/src/diagnostics.test.ts。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Log context and runtime stage outcomes](../../specs/work-diagnostics/spec.md)（WDIAG-001） | R01/S01：Observe successful creation<br>R01/S02：Observe failed copy before acceptance<br>R01/S03：Observe a missing required manifest |
| R02 | [Preserve actionable Operation diagnostics](../../specs/work-diagnostics/spec.md)（WDIAG-002） | R02/S01：Preserve the initial failure after rollback<br>R02/S02：Query after container removal and Core restart<br>R02/S03：Bound accumulated diagnostic data<br>R02/S04：Persistence fails |
| R03 | [Diagnose runtime exit before readiness timeout](../../specs/work-diagnostics/spec.md)（WDIAG-003） | R03/S01：Old image exits immediately<br>R03/S02：Container exits without useful logs<br>R03/S03：Docker log retrieval fails<br>R03/S04：Running daemon never becomes ready |
| R04 | [Authorize and sanitize diagnostic access](../../specs/work-diagnostics/spec.md)（WDIAG-004） | R04/S01：Reject a cross-owner diagnostic query<br>R04/S02：Redact hostile SDK or container errors |
| R05 | [Retain correlated service lifecycle diagnostics](../../specs/work-diagnostics/spec.md)（WDIAG-SERVICE-001） | R05/S01：Diagnose an invalid executable<br>R05/S02：Separate failure from log collection |
| R06 | [Read bounded application output as authorized Work content](../../specs/work-diagnostics/spec.md)（WDIAG-SERVICE-002） | R06/S01：Inspect application traceback<br>R06/S02：Cap noisy output<br>R06/S03：Do not substitute a sibling log source |

### work-file-access

负责任务：8.1–8.9, 11.2, 12.7。验证层级：L1/L2/L3。

现有参照：apps/file-helper/tests；apps/core/src/work-files/*.test.ts；scripts/work-files-acceptance.mjs。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [提供独立于 agent 的 Core 文件访问入口](../../specs/work-file-access/spec.md)（WF-001） | R01/S01：旧 agent 镜像的当前布局 Work<br>R01/S02：没有 service 或可选 service 失败<br>R01/S03：停止和未核验状态<br>R01/S04：文件后端不可用 |
| R02 | [提供有界且准确的目录与属性查询](../../specs/work-file-access/spec.md)（WF-002） | R02/S01：空目录和隐藏内容<br>R02/S02：部分属性不支持<br>R02/S03：无限深度请求<br>R02/S04：客户端尝试修改 mtime 或扩展属性 |
| R03 | [流式传输文件并明确条件与覆盖行为](../../specs/work-file-access/spec.md)（WF-003） | R03/S01：大文件和空文件<br>R03/S02：存在性条件避免覆盖<br>R03/S03：时间条件或缺少可匹配 ETag<br>R03/S04：单段读取与无效范围<br>R03/S05：数据流中后端失败 |
| R04 | [支持同 Work 的目录和命名空间修改](../../specs/work-file-access/spec.md)（WF-004） | R04/S01：创建并整理目录<br>R04/S02：覆盖与禁止覆盖<br>R04/S03：跨 Work 或外部 Destination<br>R04/S04：递归操作部分失败<br>R04/S05：根目录与文件锁 |
| R05 | [以明确的路径和文件类型边界访问 workspace](../../specs/work-file-access/spec.md)（WF-005） | R05/S01：编码与中文往返<br>R05/S02：路径穿越和替换竞争<br>R05/S03：开发目录含链接<br>R05/S04：硬链接文件被覆盖 |
| R06 | [对文件访问实行有界传输和可区分错误](../../specs/work-file-access/spec.md)（WF-006） | R06/S01：超限上传或目录<br>R06/S02：并发写入与资源占用<br>R06/S03：文件传输超时或磁盘不足<br>R06/S04：非法 XML |
| R07 | [文件执行资源由 Core 独立托管](../../specs/work-file-access/spec.md)（WF-007） | R07/S01：核验后端隔离<br>R07/S02：启动超时但容器迟到出现<br>R07/S03：文件功能未配置 |

### work-lifecycle

负责任务：2.3, 5.2–5.4, 7.3, 8.7, 8.8, 9.11。验证层级：L1/L2。

现有参照：apps/core/src/work-management/*.test.ts；apps/core/src/work-files/recovery.test.ts；scripts/work-files-crash-acceptance.mjs。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Durable asynchronous Work operations](../../specs/work-lifecycle/spec.md) | R01/S01：Create and observe |
| R02 | [Idempotent and ordered lifecycle mutations](../../specs/work-lifecycle/spec.md) | R02/S01：Lost creation response<br>R02/S02：Stop while starting |
| R03 | [Work readiness and partial service failure](../../specs/work-lifecycle/spec.md) | R03/S01：Optional service fails<br>R03/S02：Required initialization fails |
| R04 | [Stop the complete Work without losing data](../../specs/work-lifecycle/spec.md)（WLIFE-SERVICE-001） | R04/S01：Stop an active Work<br>R04/S02：Runtime cannot confirm shutdown<br>R04/S03：Stop orphaned application containers<br>R04/S04：Drain fails during stop |
| R05 | [Recover desired state and adopt existing instances](../../specs/work-lifecycle/spec.md)（WLIFE-SERVICE-002） | R05/S01：Core restarts after container creation<br>R05/S02：Host restarts with running and stopped Works<br>R05/S03：Old daemon is unresponsive<br>R05/S04：Graceful Core restart restores deployment<br>R05/S05：Recover an existing daemon with absent services |
| R06 | [Bounded recovery and explicit deletion](../../specs/work-lifecycle/spec.md) | R06/S01：Repeated crash and Core restart<br>R06/S02：Deletion interrupted |
| R07 | [Fence all Work mutations during a cold snapshot](../../specs/work-lifecycle/spec.md)（WLIFE-SNAPSHOT-001） | R07/S01：Start competes with export<br>R07/S02：Administrator tries an edit during export<br>R07/S03：Restore imported active context<br>R07/S04：Cleanup has not stopped a helper<br>R07/S05：Export during package preparation<br>R07/S06：Package edit during export<br>R07/S07：Stop fences a package operation |
| R08 | [将文件任务纳入 Work 状态切换与停止证明](../../specs/work-lifecycle/spec.md)（WLIFE-FILES-001） | R08/S01：上传过程中停止Work<br>R08/S02：已许可提交与停止竞争<br>R08/S03：apply切换而普通配置保存不切换<br>R08/S04：helper不可停止而agent可停止 |
| R09 | [恢复文件资源时不重放用户写入](../../specs/work-lifecycle/spec.md)（WLIFE-FILES-002） | R09/S01：Core在写入准备阶段崩溃<br>R09/S02：Core在提交后崩溃<br>R09/S03：迟到创建与未知容器<br>R09/S04：关闭本地proxy |

### work-services

负责任务：2.4, 3.8, 3.9, 7.1–7.6, 9.8, 10.6。验证层级：L1/L2/L3。

现有参照：apps/core/src/work-services/*.test.ts；apps/core/src/runtime/docker-service-runtime.test.ts。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Declare services through Work-scoped agent tools](../../specs/work-services/spec.md)（WSRV-001） | R01/S01：Agent adds a service<br>R01/S02：Observe an accepted deployment<br>R01/S03：Retry without model redeployment |
| R02 | [Persist a complete reproducible service definition](../../specs/work-services/spec.md)（WSRV-002） | R02/S01：Definition survives agent loss<br>R02/S02：Image resolution fails<br>R02/S03：Deploy existing Python image<br>R02/S04：Retag after deployment<br>R02/S05：Reject a build request |
| R03 | [Idempotent mutations and crash adoption](../../specs/work-services/spec.md)（WSRV-003） | R03/S01：Repeat a create request<br>R03/S02：Crash between instance creation and result recording<br>R03/S03：Concurrent definition updates<br>R03/S04：A new daemon repeats a lost request<br>R03/S05：Update overtakes an old worker |
| R04 | [Restore enabled services with their Work](../../specs/work-services/spec.md)（WSRV-004） | R04/S01：Restart a Work with application data<br>R04/S02：Configure services while stopped<br>R04/S03：Restore beside a retained stopped agent<br>R04/S04：Agent crashes independently |
| R05 | [Distinguish restart disable and removal](../../specs/work-services/spec.md)（WSRV-005） | R05/S01：Disable and restart the Work<br>R05/S02：Remove a service and recover Core<br>R05/S03：Stop one service persistently<br>R05/S04：Remove shared-workspace service |
| R06 | [Apply service changes with explicit availability and history](../../specs/work-services/spec.md)（WSRV-006） | R06/S01：New service image fails<br>R06/S02：Reject stale update before Docker |
| R07 | [Enforce quotas atomically](../../specs/work-services/spec.md)（WSRV-007） | R07/S01：Concurrent requests exceed remaining budget<br>R07/S02：Disable has not yet stopped the container<br>R07/S03：Use default deployment headroom<br>R07/S04：Share an existing workspace<br>R07/S05：Host budget exhausted elsewhere |
| R08 | [Report readiness and recover failures within bounds](../../specs/work-services/spec.md)（WSRV-008） | R08/S01：Container is running but not ready<br>R08/S02：HTTP refuses requests<br>R08/S03：Bound repeated application crashes<br>R08/S04：Docker becomes unavailable |
| R09 | [Lifecycle changes fence late service operations](../../specs/work-services/spec.md)（WSRV-009） | R09/S01：Stop races with service creation<br>R09/S02：Core shutdown races with service pull |
| R10 | [Provide stable Work-private service endpoints](../../specs/work-services/spec.md)（WSRV-010） | R10/S01：Reach HTTP from agentd<br>R10/S02：Reject duplicate or invalid names<br>R10/S03：Keep networks isolated |
| R11 | [Validate a bounded deployment request](../../specs/work-services/spec.md)（WSRV-011） | R11/S01：Reject incomplete deployment input<br>R11/S02：Normalize defaults for retry<br>R11/S03：Validate readiness reference<br>R11/S04：Deploy an image-native service |
| R12 | [Restore service definitions independently from source runtime state](../../specs/work-services/spec.md)（WSRV-SNAPSHOT-001） | R12/S01：Enabled and disabled services<br>R12/S02：Shared storage survives import<br>R12/S03：Preserve failed retry budget<br>R12/S04：Disabled service retains its reservation<br>R12/S05：Manage restored services through target Core MCP<br>R12/S06：Preserve imported tool policy |
| R13 | [同时返回私网端点和 CLI 可访问域名](../../specs/work-services/spec.md)（WSRV-ACCESS-001） | R13/S01：同一服务的两种地址<br>R13/S02：禁用后查询 |
| R14 | [以稳定可读名称管理当前安装的服务容器](specs/work-services/spec.md)（WSRV-ACCESS-002） | R14/S01：新容器的名称<br>R14/S02：崩溃后接管当前安装容器<br>R14/S03：名称被异物占用 |

### work-snapshots

负责任务：9.1–9.12, 10.7, 12.8, 14.8。验证层级：L1/L2/L3/L4。

现有参照：apps/core/src/work-snapshots/*.test.ts；apps/cli/src/work-snapshot.test.ts；scripts/work-snapshot-acceptance.mjs。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Export only a verified quiescent Work](../../specs/work-snapshots/spec.md)（WSNAP-001） | R01/S01：Export a stopped Work<br>R01/S02：Do not stop implicitly<br>R01/S03：Reject stale stopped metadata<br>R01/S04：Do not mutate unfinished history<br>R01/S05：Stopped Work with retained budget<br>R01/S06：Export a never-initialized stopped Work<br>R01/S07：Export unapplied package changes<br>R01/S08：Fail an incomplete package snapshot |
| R02 | [Validate complete bounded packages before installation](../../specs/work-snapshots/spec.md)（WSNAP-002） | R02/S01：A package exceeds JSON request size<br>R02/S02：Duplicate blobs cannot bypass restore limits<br>R02/S03：Tamper or truncate<br>R02/S04：A hostile file tree<br>R02/S05：Inspect has no execution side effects<br>R02/S06：Inspect a Work containing packages<br>R02/S07：Reject a missing package blob |
| R03 | [Install atomically as a stopped independent Work](../../specs/work-snapshots/spec.md)（WSNAP-003） | R03/S01：A complete installation<br>R03/S02：Reject insufficient recipient capacity<br>R03/S03：Resume normal use after moving a Work<br>R03/S04：Fail before publication<br>R03/S05：Concurrent automatic names<br>R03/S06：Explicit name conflict<br>R03/S07：No privilege bypass through a package<br>R03/S08：Import without source or catalog packages<br>R03/S09：Fail while restoring package data |
| R04 | [Retain durable snapshot operations and idempotency](../../specs/work-snapshots/spec.md)（WSNAP-004） | R04/S01：Lost acceptance response<br>R04/S02：Core crashes before publication<br>R04/S03：Core crashes after publication<br>R04/S04：Crash after package restore before Work publication |
| R05 | [Scope transfer lifetime and errors explicitly](../../specs/work-snapshots/spec.md)（WSNAP-005） | R05/S01：Retry a download<br>R05/S02：Expired content<br>R05/S03：Disabled user during observation<br>R05/S04：Expire the original Work upload |
| R06 | [冷快照核验文件写入者并保留 WebDAV 数据](../../specs/work-snapshots/spec.md)（WSNAP-FILES-001） | R06/S01：上传到迁移后的下载<br>R06/S02：假停止但仍有文件写入者<br>R06/S03：export与文件准入竞争<br>R06/S04：清理身份不确定<br>R06/S05：WebDAV限制不改变原导出范围 |

### work-storage

负责任务：2.2, 2.4, 2.5, 3.2, 5.1, 9.2, 9.3, 9.9。验证层级：L1/L2。

现有参照：packages/core-store/src/*.test.ts；apps/core/src/storage/retained-volumes.test.ts。

| 索引 | Requirement 与规格来源 | 必须验证的 Scenario |
| --- | --- | --- |
| R01 | [Persist Work and service data across replacement](../../specs/work-storage/spec.md) | R01/S01：Work and service restart<br>R01/S02：Temporary container modification |
| R02 | [Mount only authorized managed storage](../../specs/work-storage/spec.md) | R02/S01：Explicit read-only shared workspace<br>R02/S02：Escape the storage boundary |
| R03 | [Preserve deleted resource data unless explicitly purged](../../specs/work-storage/spec.md) | R03/S01：Delete without purge<br>R03/S02：Explicit retained data cleanup<br>R03/S03：Purge referenced data |
| R04 | [Report persistence failure honestly](../../specs/work-storage/spec.md) | R04/S01：Storage unavailable on submission<br>R04/S02：Volume missing during recovery |
| R05 | [Use one persistent workspace across agent tools and deployments](../../specs/work-storage/spec.md)（WSTOR-SERVICE-001） | R05/S01：Write then deploy without copying through Core<br>R05/S02：Share business data<br>R05/S03：Enforce a read-only grant<br>R05/S04：Protect private state<br>R05/S05：Reject missing storage on recovery |
| R06 | [Retain shared workspace independently of service removal](../../specs/work-storage/spec.md)（WSTOR-SERVICE-002） | R06/S01：Delete one of two workspace consumers<br>R06/S02：Restart current storage layout |
| R07 | [Preserve complete cold snapshot storage without dereferencing user links](../../specs/work-storage/spec.md)（WSTOR-SNAPSHOT-001） | R07/S01：Preserve a development tree<br>R07/S02：Do not follow an external link<br>R07/S03：Reject an unsupported entry honestly<br>R07/S04：Independent restore and WAL<br>R07/S05：Preserve a stale reference after failed removal<br>R07/S06：Do not silently omit another retained volume |
| R08 | [WebDAV 直接操作现有 workspace 持久数据](../../specs/work-storage/spec.md)（WSTOR-FILES-001） | R08/S01：文件双向共享<br>R08/S02：重启与service移除<br>R08/S03：执行权限与只读挂载<br>R08/S04：卷缺失 |
| R09 | [文件提交与失败清理保留真实结果](../../specs/work-storage/spec.md)（WSTOR-FILES-002） | R09/S01：上传中断保持旧文件<br>R09/S02：提交后响应丢失<br>R09/S03：临时名与用户文件冲突<br>R09/S04：部分目录失败 |
