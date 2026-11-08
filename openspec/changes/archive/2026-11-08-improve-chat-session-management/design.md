# Design

## Context

`apps/desktop-webui/src/adapter.ts` 的 `acceptChatSession` 插入没有 `checkedAt` 的空会话；`app.ts` 的新建处理选择该会话后没有调用 `loadSession`，但正文用 `checkedAt` 判断初次读取。常规切换则会读取历史。合成检查复现了创建 POST 成功而骨架条件一直为真的状态，尚未做真实 Core 复现。

变更前的 `proto/agent.proto` 和 Core 会话路由没有持久标题或删除操作；`packages/work-store` 的 schema 7 保存 Session、Run 和幂等记录，Memory 通过 Request/Evidence 引用原 Run。原 DUL-012 只允许从首消息或时间/ID 派生标题，需要随本变更修订。

## Goals / Non-Goals

**Goals:** 在当前身份和 Work 内一致地创建、命名、选择与逻辑删除会话；新旧 Agent 能力明确区分；保留执行证据和跨重启数据。

**Non-Goals:** 永久擦除、回收站和恢复入口；改变 Work 文件或 Memory；自动停止 Run；全局 UI 重设计或外部发行。

## Decisions

### 创建受理与历史读取分离

创建和丢失响应后的原提交核对复用既有提交键。可靠受理后选择原 Session，并启动同一有界历史读取路径；只有真实读取或可靠空历史证据完成后退出骨架。读取失败只重试读取，不重新创建；旧响应不能覆盖用户后续选择。独立的创建受理与读取结果避免把成功创建误报为失败。Desktop adapter 将 Session 创建和 Run 消息提交保存为各自独立的原提交状态；新建 Session 不检查或覆盖消息提交状态，界面仅对本次创建的失败和未知结果提供恢复，消息仍按原 Run 提交键恢复。

### 标题归属 Agent 持久状态

Work 私有 Session 元数据保存标题、来源、修订代次与删除标志，由 Agent/WorkStore 唯一写入；Core 转发并校验 Work 归属，Desktop 读取投影。无持久标题时优先使用已加载首条用户消息摘要；没有摘要时按当前 Session 列表位置显示 Session 1、Session 2 等。编号仅用于显示，删除或插入后可以重排，不改变 Session 的真实身份，也不额外读取历史。旧 Agent 未声明能力时保留创建和读取，管理动作明确不可用。

责任与消费者：`apps/agentd/src/sessions.ts` 负责会话管理与命名任务协调，`packages/work-store/src/store.ts` 及 Work 私有数据库唯一持有名称、修订、删除标记和可核对的原写入结果；模型凭据继续经 `run-models.ts` 和 Work 私有通道解析，不进入 Desktop。`proto/agent.proto`、`packages/contracts` 是 Agent RPC 和 HTTP DTO 的协议源，`internal/coreapp/conversation.go` 按当前用户及 Work 转发，`apps/desktop-webui/src/adapter.ts` 拥有客户端读取、选择与原提交核对。持久格式以 `internal/workhistory/schema.sql` 及版本化历史为源，经 `make generate` 同步 TS 和 Go 生成物；浏览器资源由 Desktop 构建同步至 `internal/desktopassets/static`。每层只以明确的 Work/Session、修订和原操作身份通信，Run/Evidence/Memory 仍由其原所有者维护。

首个手动对话完成首轮回复后，按该 Run 已确认实际模型安排有界的文本标题请求，输入限于首轮必要用户文本和回复摘要，不附工具、图片、凭证或无关历史；不创建用户可见 Run、不执行工具、不改变会话模型设置或阻塞聊天。模型不可用、超时或结果无效保留回退名，用户可显式 Auto name 重试。并发结果携带 Work/Session、标题代次与请求身份，只有目标仍存在且代次匹配时提交；Rename 永久阻止后续隐式覆盖，但用户显式 Auto name 可更新名称。不同客户端写入采用条件版本校验，未知写入先只读核对，不盲目重放。

### 逻辑删除与保留证据

服务端在事务内核对目标及其 accepted/running/cancelling Run，忙碌则拒绝；删除只标记 Session，不级联移除 SDK 历史、Run、提交键、Request/Evidence 或 Memory，不隐式取消执行。涉及待续接请求时须保证删除不能让其随后向已删除会话隐式提交；若不能确认安全则拒绝并给出恢复方向。普通列表排除标记项，新的对话提交、重命名和自动命名拒绝；原有受授权证据链和幂等结果保持可核对。

当前会话删除可靠确认后发起一次新 Session 创建并读取历史；删除非当前会话不新建，不切换已有会话。创建失败保留已确认删除和空上下文并提供显式重试，结果未知只按原创建键查询；用户改变身份、Work 或会话后，迟到结果不得改变新选择。确认明确说明历史和文件保留；删除未确认时保留原对象状态并查询，不凭网络错误认定删除成功。

### 界面和可访问交互

沿用现有两个 Session 入口和非模态选择器，紧凑 New 在列表标题右侧；行选择与行菜单使用独立控件。菜单提供 Rename、Auto name、Delete；运行和命名状态分别表达。确认、取消、键盘焦点、长标题及列表滚动不丢失上下文。所有者选择 A 紧凑列表，并明确本次不处理窄屏；`dist/session-prototype/index.html` 为临时模拟原型，不将模拟结果视为产品验收。

原型此前用 Chromium 演练新建、空会话及行菜单；所有者选择了 A，并决定本次不处理窄屏。这些原型结果不代替真实 Desktop 验收。

### 格式演进与兼容

当前 Agent 写入 history schema 8，在 schema 7 基础上增加 Session 管理元数据、原管理回执及删除后的提交保护，Memory 保持 schema 1。更新 TS/Go 的结构、静态验证、快照/导入导出及生成链；保留既有会话、Run、幂等和 Memory 证据。schema 4–7 按各自精确定义静态读取和导入，离线导入保留源版本与固定镜像；只有用户显式 Apply 新 Agent 时，才在无活动执行、完整备份后升级到 8，失败恢复原备份。schema 4 同时完成 Experience 到独立 Memory 的转换，5–7 保留既有 Memory。新格式拒绝仅支持 4–7 的旧 Agent，不能让其忽略删除标志或覆盖标题。

### 规格与增量格式收口

验收发现实现已使用 schema 8，而主规格仍将 7 声明为当前版本。本变更通过 `agent-conversation`、`portable-work`、`work-memory` 的完整 MODIFIED Requirement 对齐当前版本、精确旧格式、受控升级与导出闭包；直接引用该版本的 `runnable-work-runtime` readiness 及 `native-runtime-distribution` 容器契约同步对齐。schema 7 的历史语义保留，不把旧版本说明全部替换为 8。主规格在后续显式同步或归档时应用这些 delta。

格式修改限定为本变更相对 HEAD 新增的 TS/JS 多语句行及 CSS 多声明行，按 `scripts/check-source-style.mjs` 的报告逐项修正；不修改业务状态、接口、测试断言或检查规则。责任仍属各源码模块，`apps/desktop-webui` 的构建负责同步 Go 内嵌资源；`internal/workhistory/schema.sql` 和协议源本轮不变，无需重生成 history 或 RPC。验证使用既有增量格式、类型、相关直接测试、Chromium 原生协议及生成资源检查，不使用 MCP/Playwright，不处理窄屏。

## Risks / Trade-offs

- 模型命名有额外延迟、费用及内容发送 → 使用当前 Run 实际模型、最小有界文本、超时和无工具调用；失败不影响对话。
- 删除保留底层历史，不等于隐私擦除 → 确认文案明确范围，永久清除不在本变更。
- 自动命名与 Rename/Delete、客户端切换、重启竞争 → 持久代次及身份校验、可查询写入结果和过期结果丢弃。
- 历史版本和旧 Agent 的混用可能丢失删除语义 → 明确能力协商、拒绝不兼容写入并测试导入、迁移、回退。
- 原型为模拟数据，未做真实浏览器验收 → 实现前确认视觉选择，之后执行实际浏览器与真实 Core 验证。

## Migration Plan

先冻结旧 schema 的已知输入与合成夹具，新增格式、迁移与 TS/Go 静态校验；再同步 Agent/Core 协议与 Desktop 消费者并生成嵌入资源。升级前按现行流程备份并核对无活动 Run；失败恢复原备份，成功后的新格式禁止不兼容旧 Agent 直接写入。导出导入和重启验证覆盖标题、删除标记及证据连续性。

创建状态与回退标题调整涉及 Desktop adapter 的创建/核对接口、app 的创建入口与替换状态、独立 Session 标题展示函数及对应测试；该阶段服务端协议和 history 不变。浏览器构建同步 Go 内嵌资源，并执行直接 adapter/展示单元、Chromium 原生协议与真实隔离 Core/Agent 回归。
