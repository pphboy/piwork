# 历史实施验证记录

当前单模型增量证据见 [模型直接配置增量验收](model-direct-verification.md)。本文件以下各轮结果保留其当时范围，不作为 tasks 第 10 节已完成的依据。

日期：2026-10-09。使用 Go 1.25.5、Node 24.20.0、Playwright Chromium 与本机 Docker Engine。全部供应商请求使用本地协议服务器及合成凭据，没有调用付费模型或更新用户服务器。

## 已通过

| 范围 | 实际执行与结果 |
| --- | --- |
| 生成、构建、基础测试 | `make generate`、`make build`、`make test` 通过；生成公开/私有 proto 与 Go DTO，保持 CGo 关闭。日志位于被忽略的 `dist/model-build.log`、`dist/model-test-final.log`。 |
| Core 管理与执行绑定 | 对应 Go 单元测试通过，覆盖两协议供应商共享 Key、同模型跨供应商、只写/轮换、head 发布与失败回退、启停、默认/Work 删除依赖、重启、固定执行绑定、撤销和默认失效后其他候选可用。 |
| HTTP Test | 两协议真实 HTTP fixture 请求通过，验证路径、认证、请求体、成功/失败分类、2xx 错误、大小/超时/并发预算、重定向不跟随，以及失败不阻止保存/启用。 |
| 真实 SDK 与 Thinking | `apps/agentd/src/model-providers.test.ts` 四项通过：固定 SDK 能力继承、未知/错协议拒绝、默认失效恢复、子代理默认授权材料刷新、Responses effort、Messages budget/adaptive 及 Off/非 Off 实际 payload。 |
| Console 浏览器契约 | `npm run test:browser -w @piwork/console-webui` 50 项通过。含两协议管理、Test 草稿与过期状态、Key 不持久化、启停/删除依赖、360px、未知写入读回、会话失效，以及晚到保存不清除新视图 Key/锁。 |
| Desktop 浏览器契约 | 原完整批次 222 项通过、1 项已有长时票据测试跳过；新增聊天契约 2 的默认失效/Thinking 和资源命令/明确文字输入专项均通过。完整批次日志 `dist/model-desktop-browser.log`；该跳过不作为模型功能通过证据。 |
| Console 真实 Core | `npm run test:real-core -w @piwork/console-webui` 3 项通过，包括在 AI models 建立连接后由 Runtime 引用、默认配置和真实包操作。日志 `dist/model-console-real-core.log`。 |
| Desktop 真实 Core | `npm run test:real-core -w @piwork/desktop-webui` 通过，覆盖真实 Run、资源命令、完整设置、Save/Apply、文件、Service、Stop/Export/Import/Start 和继续原 Session/Thinking。精确安装资源清理后 containers/networks/volumes 均为 0。日志 `dist/model-desktop-real-core-final.log`。 |
| 真实多供应商界面链路 | `model-provider-browser.mjs` 在真实 Console 添加 SDK 模板别名并 HTTP Test，再由原生 Desktop 在同一 Session 选择 Responses 与 Messages、High Thinking，容器内 SDK 实际请求匹配；已实际通过。截图位于 `dist/model-browser-evidence/`。 |
| 在途、编辑及重启 | `TestNativeManagedModelEditsInflightReplayAndRestart` 通过（82.41s）。验证在途实际模型/Thinking 不变、名称/端点/Model ID/Key 编辑、新选择引用、幂等重放无第二次请求、独立启停、Core/Agent 重启不重放、历史引用删除后仍可读取。日志 `dist/model-native-integration-final.log` 中该用例独立 PASS。 |
| 完整模型包往返 | `TestNativeMultiProviderLifecycleThinkingAndPackageRoundTrip` 最终通过（258.01s），实际完成两协议 HTTP Test、界面选择、SDK Thinking/轮换、默认撤销覆盖、两安装导出/导入/显式启动、原 Session/Thinking 与目标 Key、再次导出。使用更新 snapshot helper，日志 `dist/model-package-roundtrip-final.log`。 |
| 原模型契约 | `TestNativeChatModelSelectionRunsThroughGoAndRealSDK` 通过（50.40s），保持原模型切换、忙拒绝、固定活动模型和失效后的幂等重放。日志 `dist/model-legacy-chat-integration.log`。 |
| 包和历史单元验证 | Go/TS 历史校验、目标协议/能力匹配、凭据变化重验、唯一/歧义偏好重绑及源执行授权移除通过；`@piwork/work-store` 61 项通过。新增空能力声明持久化回归和 snapshot helper 的明确协议/能力白名单测试通过。 |
| 边界与材料 | `node scripts/check-native-boundary.mjs`、`node scripts/check-docker-quickstart.mjs` 与 quickstart 26 项测试通过；`openspec validate manage-multi-provider-model-lifecycle --strict`、`git diff --check` 通过。 |

## 验收中修正

- 当前模型描述的空能力值在 JSON 省略/反序列化后从空 slice 变为 nil，导致已受理导入的精确比较错误失效；改为保持 nil 的复制，并用持久化往返单元测试验证。
- snapshot helper 的旧描述白名单只允许 baseUrl，拒绝新的 api/capabilities；现明确验证这两类已知字段，继续拒绝 Key、源执行授权和未知字段。
- 新 Chat 契约的资源命令入口仍仅识别版本 1；已同步支持版本 2，并由专项浏览器测试及真实 Desktop 入口验证。

## 最终状态

全部 35 项任务完成。此前失败批次保留为问题修正事实，不记为整体 PASS；上表明确区分最终通过命令与包含独立通过用例的旧批次。OpenSpec 严格校验和 `git diff --check` 通过。Docker 资源仅按各测试精确 installation ID 清理；临时 CA 派生镜像由测试精确删除。没有推送、发布、部署或全局 Docker 清理。

## 验证报告修复与复验（2026-10-09）

按用户要求处理 `verify-report.md` 中的 W1/W2/S1：模型详情 HTTP Test 使用当前保存连接，读回使旧及在途结果过期；全部停用返回真实空目录；Chat 提供安全能力原因和配置/升级/Apply 方向。保留 Session 偏好、Thinking、草稿和历史，不增加管理员默认 Thinking。

- Go Core/contracts/agentclient/CLI/Console 包全量测试通过；新增跨 Go client 的安全恢复投影验证，继续拒绝 Key、端点、能力及执行绑定外泄。
- Console 浏览器 53 项通过；最终文案重建后读回/在途专项 3 项通过。Desktop 本次专项 6 项通过；Agent 与管理/Chat 契约 19 项通过，含真实 SDK 两协议 Thinking 请求。
- `make generate`、三 workspace 构建、最终 `make build-go`、native boundary、OpenSpec strict validation 及 `git diff --check` 通过。
- 增加任务 7.1–7.4 跟踪这次修复。具体证据和首次失败的旧语义断言说明见 `verify-report.md` 的修复后复验及 `dist/model-followup-*.log`。
- 本轮没有重新执行 Docker 联合集成、推送、部署或归档。

## 消息 Test、Modal 与页面操作增量（2026-10-09）

第 8 节已实施：固定消息通过指定协议/Model ID 发送，Core 提取实际 assistant 文本，成功/失败契约严格区分；Modal 显示目标、消息、回复或失败、时间/耗时、截断及过期。页面操作移入统一标题栏，详情返回导航单列。没有新增管理员默认 Thinking 或改变 Session 设置。

- `make generate`、Console build、`make build-go`、native boundary、OpenSpec strict validation、`git diff --check` 通过，生成 schema 与嵌入资源同步。
- Go Core/contracts/consoleapp/agentclient 全量测试通过；消息 Test 两协议 16 子场景与 TS 契约 3 项通过。
- Console 浏览器 **58 项通过**；真实 Go Core/Console + 两协议 HTTP 服务器专项 **1 项通过**，验证草稿/保存项实际发送与 Modal 回复。
- tmux 12 保持 1 个 window，仅更新现有 Core/Console pane。部署后通过实际页面两协议草稿 Test，目录及 Work 数量保持，临时草稿没有保存；本机登录信息未更换。没有新建窗口、推送或发行。
- 本节没有重新执行 Docker 包往返或完整 real-core 批次，前次事实保留；详见 `verify-report.md` 的增量复验及 `dist/model-message-*.log`。

## URL 自动兼容与安全错误恢复增量（2026-10-09）

第 9 节已实施。Messages 根地址、`/v1`、尾斜杠在保存、Test 和新执行定义中规范化一致，Responses API base 不变；既有捕获事实不被原地改写，同一有效地址不产生无意义新 modelRef。Test 失败返回有界安全 reason/message/recovery，已知本地校验保留字段，Modal 提供阶段与恢复提示；供应商认证失败不注销管理员，也不阻止保存有效配置。

- Go Core/contracts/coreoperator/consoleapp/agentclient 全量通过，新增 URL/拒绝连接/空白 Model ID/字段/网络/错误边界专项及 TS 契约 3 项通过。
- Console 全量浏览器 72 项通过，最终构建后相关专项 25 项通过；真实 Core/Console 两协议及失败恢复专项 1 项通过。
- 真实 SDK URL/失败恢复集成通过（60.82s），实际端点无重复 `/v1`，Key/High Thinking 与选定模型一致，Work 配置及 Session 历史设置不被管理动作重写。本次精确 fixture Work 范围的容器、网络、卷清理后均为 0。
- 生成、浏览器/Go 宿主构建、嵌入资源一致性、native boundary、OpenSpec strict validation 及 diff 检查通过。
- 已更新本机 tmux 12 的现有 Core/Console pane，保持一个 window 和现有供应商数据；部署后通过真实页面 URL/反馈检查，临时草稿没有保存，登录信息未改变。未部署旧远程服务器、推送、发行或归档。
- 详细文件映射和执行范围见 `verify-report.md` 的第 9 节增量；日志位于 `dist/model-errors-*.log`，不记录用户真实 Key 或供应商原始错误正文。
