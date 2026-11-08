# Design

## Context

动机见 `proposal.md`。已确认的产品选择是两个独立、按需调用的视图能力，只作用于原发起页面，尽力执行，不等待浏览器回执；具体行为见 `specs/agent-service-view-controls/spec.md`。

当前实现有可复用的路径，但尚未连接为视图控制：

| 实际读取的来源 | 当前职责与发现 |
| --- | --- |
| `apps/agentd/src/application.ts:258–278,644–650,696–744,780–814` | 装配 SDK/MCP/包工具，按 active toolPolicy 过滤并公布 resolvedTools；支持按 Run 创建 customTools，包工具已有原生名称冲突检查 |
| `apps/agentd/src/pi-sdk-executor.ts:31–93`、`packages/pi-adapter/src/event-mapper.ts`、`tool-preview.ts` | 真实 SDK 的工具完成结果转为有界公开文本预览，保留 toolName、toolCallId、错误及截断事实 |
| `apps/agentd/src/application.ts:883–909`、`internal/coreapp/conversation.go:493–505`、`internal/agentclient/client.go:344–353` | 原工具事件通过 gRPC 和 Core HTTP 投影传递，公开预览已有类型与大小校验 |
| `apps/desktop-webui/src/adapter.ts:2133–2159,2248–2318` | 本页创建 submissionKey、确认原 Run 并消费事件；观察其他 Run 和历史恢复也会走附近通道，不能把“看到 Run”当作“本页发起” |
| `apps/desktop-webui/src/app.ts:1647–1684,3088–3103,3324–3338,5411–5435` | Service ID/端口确定 iframe 身份；选择器与 Open Service 提供现有导航/入口逻辑；普通渲染刻意保留同一 iframe 文档 |
| `apps/agentd/src/package-resources.ts:35–45,89–96` | 已有独立于脑包的简短平台使用指导入口，可按相同职责补充视图工具说明 |

现行约束继续适用：`CONV-RUN-001` / `CONV-SUBMISSION-001` 保持原接受与只读恢复；`DWUI-005` 定义 Service 选择和状态说明；`DWUI-FOCUS-001` 保持布局切换不重载；`BSA-001` / `BSA-002` 负责真实目标与访问资格。新 Refresh 是明确的应用重载动作，普通状态轮询、Focus 和布局重绘不因此获得重载权。`MCP-SERVICE-002` 的十二个生命周期工具不增加视图指令。

## Goals / Non-Goals

**Goals:**

- 以一个小的版本化请求，连接原生 SDK 工具和现有浏览器视图操作，不新增服务端控制通道。
- 由提交 owner 证明本页来源，由视图 owner 修改选择及 iframe；协议解码模块不持有整个 adapter 或应用 state。
- 在多 Service、多页面和重连下准确定位并至多尝试一次，保留现有 Chat、访问和草稿保护。

**Non-Goals:**

- 不提供任意 URL 导航、浏览器操作、DOM 读取、操作系统窗口聚焦或外部标签控制。
- 不增加浏览器回执、等待超时、持久待执行队列、跨页面接管或历史操作恢复。同一 Run 连续 Select 不提供最后一次请求必定生效的保证。
- 不自动部署、启停或更新 Service，不把视图操作替代为业务验证，不要求修改各 Service 接入新的 SDK。
- 不重新设计现有工作台布局、拆分整个 app/adapter 或新增常驻提示和操作按钮。

## Decisions

### 1. 两个 agentd 原生工具，独立于 Service MCP 和可选脑包

模型与策略使用 `service_select`、`service_refresh` 两个原生名称。新增 `apps/agentd/src/service-view-tools.ts` 定义参数、策略过滤和按 Run 创建的工具；`application.ts` 只负责装配，将允许的工具加入 SDK customTools、SDK active tools 与 daemon resolvedTools。

全部视图工具名称都加入包工具冲突检查的 reserved 集合，包括被策略禁止的名称，防止包用同名工具绕过禁用。MCP 工具继续使用自己的模型名称投影，不能冒充原生工具。现有 `BUILT_IN_WORK_TOOLS` 仍仅代表 SDK 的七个基础工具，不把新 customTools 塞进 SDK 基础工具解析列表。

每次调用只接受 `{serviceId, port?}`，拒绝未知字段、非法 ID/端口，在生成结果前检查原 Run 的取消信号。Work、Session、Run 身份来自执行上下文和原事件外层，不接受模型指定。存在性、声明端口和是否已经展示由浏览器按当前 Service 目录与视图核对，工具不请求浏览器状态。

平台使用指导附于 `package-resources.ts` 的既有资源加载入口，说明如何通过获准 Service 目录能力取得准确 ID，以及“展示”“刷新”和“请求已生成”的差异。它只解释实际可用工具，不授予被禁止的能力。

备选是在 Go Service MCP 增加工具，需要扩展本来负责生命周期的 gRPC/MCP 链；或放在 piwork-brain 中，使基础视图能力依赖可选包。两者都增加了本需求不需要的耦合。

### 2. 使用小型工具结果承载请求，保持现有 wire 与 history

工具正常结果的唯一文本内容为一个有界 JSON 对象，例如：

```json
{"kind":"piwork.service-view","version":1,"status":"requested","action":"select","serviceId":"service-example","port":3000}
```

`port` 可省略；结果不包含 URL、凭据、容器地址、Work 或运行身份。工具说明和结果仅表示“已生成请求”，不是浏览器已接收或已完成。

`packages/contracts/src/service-view-controls.ts` 负责约定的名称、类型及必要的生产端校验，并从既有 index 导出。Agent 使用该契约，浏览器独立的纯解码函数检查收到的 JSON 形状、版本、字段和大小，以同一组合成消息验证一致性；不向浏览器引入 Node 或 TypeBox 运行时。请求文本设置 1 KiB 上限，远小于现有 64 KiB 工具预览上限。

```text
Pi SDK service_select / service_refresh
                  |
                  v
    tool-end + complete text preview
                  |
                  v
 existing Run event / gRPC / Core HTTP
                  |
                  v
 origin-page gate + command decoder
                  |
                  v
  Service view owner selects or reloads
```

不从 Assistant 文字寻找指令。只识别原生工具的成功 `tool-end`，要求 `result.kind=text`、错误标志均为 false、`truncated=false`，动作与工具名一致。`details` 是 SDK 私有信息，当前公开预览会移除它，不能把指令只放在 details。

备选为新增 RunEvent 分支和浏览器命令 RPC，会牵动 proto、HTTP DTO、历史和旧客户端的兼容处理。现有成功工具预览已能容纳小型请求，无需新 wire 类型。新增的类型不注册新的顶层 HTTP Schema，既有 Go 投影不变；仍通过跨链契约测试确认请求未被丢弃或改写。

### 3. 提交 owner 维护页面内的原 Run 资格

新增 `apps/desktop-webui/src/service-view-controls.ts`，以窄接口持有原发起资格、解码及去重状态。它只接收明确的提交/接受事实、身份与页面范围快照，以及具名 Select/Refresh 操作端口，不读写其他 feature 状态。

adapter 在本页提交之前登记原 submissionKey，并在确认原 Work/Session/Run 受理时关联 Run。响应丢失后，只有本页仍保留原键的只读查明确认可以完成关联；`resumeRun`、loadSession、历史恢复或查询到活跃 Run 本身都不能新增来源资格。登记和关联必须早于开始消费该 Run 的事件，覆盖 Run 很快完成的情况。

资格只在 JS 内存保存，不写 localStorage、sessionStorage、服务端或 Run 请求内容。页面卸载或重载自然清空；身份变化、离开 Work 时显式撤销并推进本页范围代次，返回原 Work 不复活旧资格。当前 Work 内普通模块切换不撤销，才能从 Chat 通过 Select 展示应用。事件同时核对原身份、Work、Session、Run；不能只比较当前选中 Service。

按原 Run 和不透明 toolCallId 去重，不能用名称、参数或显示文字去重。调用 ID 沿现行历史契约处理，不能套用 Service ID 的字符规则。通过来源和完整性检查后，在尝试前记录消费，包括因目标未展示而忽略的请求。终态和页面失效后释放 Run 资格；重复事件不会重新登记。已经交给视图 owner 的一次异步尝试继续依靠页面范围和目标快照校验，不因正常 Run 终结把尚在准备入口的合法展示误判为新请求。

备选为服务端保存 clientId 和投递队列，可以追踪接收端及确认结果，但用户已选择不需要这项保证；也不能依赖同源存储识别原页面，否则另一标签页或设备可能执行。

### 4. 视图 owner 复用选择与入口，只为显式 Refresh 重载

`app.ts` 通过具名 `selectServiceTarget` / `refreshDisplayedService` 操作端口接线；可在本批触达范围抽取重复的选择逻辑，但不把整个 view、adapter 或 DOM 根作为万能上下文交给新模块。

Select 的流程：核对本页范围和 Work，必要时进行一次现有 Service 列表读取以发现刚创建的对象，按 ID 及端口解析；同一 Service 默认保留当前合法端口，另一 Service 默认使用现有首个声明 Web 端口。通过原导航/未保存保护后进入普通 Services 区域，沿既有入口准备与状态占位显示目标。已展示同一目标时不触碰 iframe；从已有专注布局调用时沿既有退出路径回普通区域，不把 Select 映射成 Focus。入口准备每个 await 后核对原范围及用户选择代次，不能覆盖更晚的手动选择。没有合法目标时忽略；没有循环等待 readiness，也不自动提交 Start。

Refresh 的流程：在开始时核对实际展示的 `Work + serviceId + port` 和挂载 iframe，并验证当前入口资格。若不匹配立即消费并忽略；不先切换、等待挂载或保留以后执行。匹配时只重载该应用文档：浏览器允许时可以重载当前应用地址；来源隔离等情况下使用 adapter 确认的当前合法入口重新挂载该目标，不重放旧 src 中已消费的授权 ticket，不拼接任意 URL或缓存破坏参数。再次读取或准备入口后必须检查 iframe/目标是否仍为原对象。Chat 和工作台根节点不重载。

这是同一目标 iframe 保留规则的显式例外；普通 `reconcileHTML`、Focus、列表刷新仍保持原文档。嵌入被拒绝或 Service 失去资格继续走原占位/手动独立打开入口，不能为了工具请求自动弹新窗口。

备选为每个 Service 缓存一个后台 iframe，会改变现有资源生命周期；或 Refresh 隐式 Select，会改变已确认的独立动作语义。均不采用。

### 5. 兼容采用与验证范围

托管工作台与独立 CLI Desktop 使用同一前端实现，分别验证同源路径入口和本机来源隔离入口。没有原页面资格的 CLI/Service 自动 Run 只留下普通工具 Activity。旧 UI 不理解指令时只显示结果，旧 Agent 不具备工具时保留原能力；不得以此抬高基础 Chat 准入或自动换镜像。

直接模块测试覆盖工具策略、协议正反例、来源资格、去重和目标解析；真实 adapter 测试覆盖提交/查明/事件消费的实际接线。Playwright 用双页面、应用文档标记和加载次数验证选择、刷新及 Chat 保留。确定性模型通过真实 Pi SDK 调用新工具，并沿已有真实 Core/Docker/浏览器验收入口验证端到端链，不能只注入前端假事件便声称 SDK 路径通过。

## Risks / Trade-offs

- 请求被生成但页面未执行 → 这是确认的尽力执行语义，指导与工具结果不宣称浏览器成功，不加回执或模型重试。
- 刷新丢失 Service 未保存内容，或入口回退回到应用首页 → 用户已选择直接刷新；第一版不承诺应用内输入、路由和滚动恢复，不新增通用应用草稿检测协议。
- 历史或连接恢复重复触发 → 只认本页内存资格和真实工具完成事件，并在尝试前按原调用去重；历史展示不授予执行资格。
- 页面很快切换或入口读取延迟 → 原身份、Work 范围、Service/端口与选择代次在异步完成前再次核对，失效立即丢弃。
- 新工具名称与已有用户包冲突 → 沿现有 reserved 名称冲突机制给出真实加载错误，不静默把包工具变成平台指令。

## Migration Plan

1. 实现并验证新工具、使用指导及浏览器接线；本批生成物仅同步 Desktop 浏览器嵌入资源。契约若触及既有生成源，执行原 `make generate`，不手改生成文件。
2. 构建对应 Agent 验证镜像和 Core/CLI，使用独立安装与合成 Service 执行验收。临时结果放 `dist/`，只清理该安装的精确标签资源。
3. 用户沿原 Agent 镜像选择和 Apply 采用能力；本变更不发布镜像或自动迁移已有 Work。
4. 回退到原 Agent/前端即可停止新指令生成或消费。没有新数据库状态或待执行队列需要迁移；旧工具结果继续作为普通历史保留。

端口默认、一次目录读取和内部路由不作保存承诺是简化实现的明确假设；没有影响已确认范围的待决问题。实现及验证事实见下文。

## 实现中的责任核对

- 实际沿 runtime 报告追踪到 `internal/workruntime/runtime.go:706–746` 的严格工具来源检查，需明确接纳受当前策略约束的两个原生名称；继续拒绝未知、重复或被禁止工具，并允许旧 Agent 不报告新能力。这是 SDK 注册的直接消费者同步，不新增 RPC 或运行权限；对应 `internal/workruntime/runtime_test.go` 增加兼容及策略负例。

## 验证事实

- 已实现两个原生工具、独立于脑包的指导、原页面内存资格、严格结果解码、精确目标选择与重载；Core 只增加现有 runtime 报告校验的两个可选名称，不增加 wire 字段或 RPC。
- 真实链路揭示现有状态投影会把已终态 Run 的较早事件也表示为终态。前端在流结束并确认状态后再退役资格，不能在遇到第一个终态投影时丢弃后续工具结果；adapter 回归已覆盖终态投影先于 tool-end 的顺序。
- contracts / pi-adapter / agentd 单元测试分别为 52 / 22 / 212 项，共 286 项通过；新增浏览器模块与真实 adapter 测试 7 项通过。Playwright 模块及相关 iframe/Focus/草稿回归 11 项通过，覆盖 1920×1080 和 390×844、重复请求、多端口、不可用目标、原页面、身份变化及迟到入口。
- `go test ./internal/workruntime ./internal/agentclient`、三个受影响 workspace 的 typecheck，以及 native-boundary、webui-boundaries、ui-language、source-style、repository-docs 与 `git diff --check` 通过。
- `make generate` 完成，已有 238 个 Go DTO schema / 8112 个 oracle 夹具未产生额外协议差异；`make check-generated-ui` 通过，Desktop 新模块已嵌入；`make build-go` 构建 Core/CLI 通过。本工作树的 Go 构建需显式传入实际 `GIT_DIR` 以取得 VCS 状态。
- 真实确定性模型经 Pi SDK、gRPC、Core HTTP、浏览器执行，在独立 CLI Desktop 和托管同源工作台两种入口均通过：两 Service、双页面、重复 Select 保留文档、Refresh 更换应用文档、非目标 Refresh 与没有原页面资格的 API Run 被忽略。每次安装的容器、网络和卷均由原 fixture 按精确 installation ID 确认清空。
- 初次真实验收因执行环境 `umask=077` 使合成脑包 source 对 helper 不可读；以合成 bind 探针确认后，使用测试进程 `umask=022` 完成验收。临时诊断代码已移除。没有修改产品的存储权限约定。
- 当前环境没有 Playwright MCP，使用仓库既有 Playwright/Chromium 自动化入口；PC 和移动端截图已查看。日志保存在被忽略的 `dist/service-view-acceptance/`；截图为 `/tmp/piwork-asvc-{desktop,hosted}-success.png`、`/tmp/piwork-asvc-select-mobile-success.png` 和 `/tmp/piwork-asvc-settings-pc-confirm.png`。
- 验证 Agent 镜像为 `piwork-agentd:service-view-controls-acceptance`，本地 image ID 为 `sha256:4763bfc04ab0821b68d880ec5281d800afd68f30e2fc4122933fda0b7dc34c8a`。未运行全仓 `make test` / 完整 Docker 场景矩阵，未进行外部发布、自动升级或归档。

真实验收复跑入口（先构建对应验证 Agent 镜像和 Core/CLI）：

```sh
umask 022
PIWORK_TEST_SERVICE_VIEW=only \
PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:service-view-controls-acceptance \
node apps/desktop-webui/test/real-core.mjs
```

归档前边界确认：用户选择维持尽力执行，不增加连续 Select 的最后一次必定生效保证；先前基于该额外保证提出的警告已撤销，验证结论为 0 CRITICAL、0 WARNING。
