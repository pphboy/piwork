# 再次复验：manage-multi-provider-model-lifecycle

日期：2026-10-09。使用 openspec-verify-change；本节为最新结论，下方保留上轮实现与测试证据。复验后按用户要求修正任务说明中的过期状态；未改实现或任务勾选，未归档。

| 维度 | 结果 |
| --- | --- |
| 完整性 | 66/66 任务完成，全部跟踪和上下文文件可读；10 ADDED + 5 MODIFIED 需求均有实现，无 REMOVED/RENAMED 要求。 |
| 正确性 | 15 项需求、72 个 Scenario 的实现/测试映射成立；W1 名称边界与 S1 默认实际型号展示已修复，未发现新功能偏离。 |
| 一致性 | 实现遵循设计及仓库模式；任务文档状态残留已修正。 |

**CRITICAL：0。WARNING：0。SUGGESTION：0。**

## S2 已修正

复验发现 `tasks.md:106` 曾保留“当前仅更新规划”“不提前关闭 W1/S1”的过期说明。用户要求直接调整后，已改为第 11 节六项任务完成、W1/S1 已消除、总计 66 项完成的事实说明，保留 SDK 升级等范围边界。仅修正文档状态，不改变功能或任务完成记录。

## 本次检查与证据范围

- 重新核对 OpenSpec status/apply 上下文、任务聚合、需求/场景数量及 W1/S1 相关契约、兼容投影、UI 和测试源码。
- 本次实际执行：OpenSpec strict validation、git diff --check，均通过。
- 本次实际执行：模型管理契约测试 4/4 通过，含新名称 Unicode/256 边界与旧名称限制；Core 的 TestFlatModelLongNamesRoundTripAndLegacyProjection、TestCapturedModelIDSurvivesCurrentHeadAndLabelEdit 使用 -count=1 通过。
- 完整 Go/浏览器、真实 Core/SDK、包往返、构建与部署结果沿用下方同源码的既有证据，没有将其描述成本次重新运行。Desktop 原有范围外长时认证跳过项仍不作为模型场景通过证据；所有适用的变更检查均有证据，无未验证检查。

结论：无严重问题、警告或未解决建议；可以进入归档流程。本轮未执行归档、部署、提交、推送或发行。当前 SDK 仍为 0.86.1，Opus 5.5 完整 Thinking effort 支持不属于已交付范围。

---

# W1/S1 修复后的最新复验

变更：`manage-multi-provider-model-lifecycle`。日期：2026-10-09。Schema：spec-driven。本节覆盖用户确认的第 11 节，优先于下方保留的历史发现和结论。

| 维度 | 结果 |
| --- | --- |
| 完整性 | 66/66 任务完成；全部跟踪文件可读，15 项 ADDED/MODIFIED 需求均有实现；无 REMOVED/RENAMED 要求。 |
| 正确性 | 72 个 Scenario 已核对实现和测试映射；新增四个长度/兼容/窄屏/捕获身份场景有专项证据；W1、S1 已消除。 |
| 一致性 | 256 字符新契约与 128 字符旧兼容投影分开；复用既有公开 model 字段展示捕获身份，不修改 Work/Session/Thinking/历史；目录、组件、生成入口和 native boundary 一致。 |

**CRITICAL：0。WARNING：0。SUGGESTION：0。** 适用检查均执行，没有将未验证检查计为通过。完整 Desktop 批次仍有 1 项原有五分钟票据长时认证测试按原开关跳过，属于模型变更范围外，不作本轮通过证据。

## W1 已修复

- `packages/contracts/src/ai-model-management.ts:6` 独立定义新模型名称 256 字符；新 Create/Patch/ModelConfig 使用一致限制，旧 Provider/ManagedModel 输入仍为 128。默认名称采用完整 Model ID，未通过截断新名称规避校验。
- `internal/coreapp/model_registry.go:154` 的 legacyModelDisplayName 只在旧兼容 DTO 投影处使用，以 rune 生成有效 UTF-8、最多 128 字符的显示别名。原始名称、Model ID、管理 id、modelRef 和 Key 均不因此回写。
- `apps/console-webui/src/model-management.ts` 以 Unicode 字符校验 256 上限；HTML 的 512 UTF-16 单元缓冲上限配合 data-model-max-length=256/setCustomValidity，不代表允许 512 个字符。新模型专用 name 错误说明也使用 256 和可留空语义；旧接口的 128 提示保持。
- 契约测试覆盖 ASCII/中文/Emoji 的 129/256 接受、257 拒绝、默认名称输出合法性与旧输入限制。Core HTTP 回归覆盖创建/编辑/清空/新旧读取/重启，不变引用及原始值。Console 窄屏验证 256 Emoji、257 ASCII 拒绝和写入次数；真实 Go Core/Console 回读完整长名称与默认名称通过。

## S1 已修复

- `apps/desktop-webui/src/app.ts:446` 的 capturedDefaultName 从现有公共描述读取真实 model，保留友好 label 并附加捕获的 Model ID。Work default 菜单、响应设置和聊天输入区域使用该显示；普通目录菜单也显示自己的 Model ID，能与旧捕获区分。
- 没有改公共 DTO、私有模型定义、执行引用或 SDK 选择；没有自动 Apply 或修改已保存偏好。历史 Run 仍使用原有模型显示路径，不根据目录改名重写数据。
- Core 回归验证 old-id 引用在当前 head/名称改成 new-id 后仍解析为 old-id；浏览器验证 256 字符 old-id 在三个表面可辨认，目录 new-id 单独显示，360px 不横向溢出，草稿/选择/Thinking/消息不变且没有写入请求。

## 本轮实际检查

| 检查 | 结果 |
| --- | --- |
| make generate | 通过，生成 204 Go schemas 和 6674 TS oracle fixtures。 |
| contracts 单测 | 19/19，通过新名称边界与旧兼容约束。 |
| Core/Contracts 长名称与捕获专项 | 通过，含 Unicode、HTTP CRUD、旧 DTO 投影、重启与 old-id/new-id。 |
| Core/contracts/consoleapp/CLI 回归 | 全部通过。 |
| Console 完整浏览器 | 74/74；后续 Unicode/字段错误精确回归 2/2。 |
| Console 真实 Go Core | 新长模型 ID/256 Emoji 名称保存、回读、清空恢复 1/1。 |
| Desktop 完整浏览器 | 235 通过、1 项已有范围外长时认证跳过；初次旧标题断言未含新增实际型号而失败，更新该行为断言后完整重跑通过，未把失败批次计为通过。 |
| 全 workspace typecheck | 通过。 |
| Go 宿主、Windows/Linux CLI | 构建通过，Windows 源/目标 SHA256 与 build.json 一致。 |
| 本机部署 | Core 在无 active Run 时更新，保留私有备份和数据；仍为 tmux 12 单 window 四 pane。Core 与依赖 READY；实际 Windows Desktop 17891 已确认默认实际 Model ID 可见，Console 已确认 256 字符输入校验。没有向用户模型发送检查消息。 |
| 边界/规格/格式 | 源码 native boundary、OpenSpec strict validation、git diff --check 通过。 |

本轮只改管理名称、兼容显示投影及浏览器身份展示，没有改 Agent/helper 协议、SDK 或执行源码，无需为本轮重建其固定镜像；此前两协议、未知普通模式、Key pinning、包往返与镜像边界的同版本证据继续适用。当前 SDK 仍为 0.86.1，Opus 5.5 完整 effort 支持/SDK 升级不属于第 11 节，未宣称交付。

详细日志位于忽略目录 dist/model-direct-evidence。报告不复制真实 Key、密码、token 或工作区数据。适用检查全部通过，可以归档；本轮未自动归档、提交、推送或发行。

---

# 以下保留修复前各轮历史报告

# 变更验证报告

变更：`manage-multi-provider-model-lifecycle`。日期：2026-10-09。Schema：spec-driven。

## 最新复验结论

再次复验时间：2026-10-09 13:49:03 UTC。本次重新读取 status/apply 跟踪和全部 10 份上下文，确认 60/60 任务、10 ADDED + 5 MODIFIED 需求、68 个 Scenario，无缺失跟踪文件。W1 的 129 字符默认名称边界已再次只读复现；S1 的显示路径仍存在。复用同一源码/构建的既有测试证据，没有把它们描述成此次重新执行的完整批次；OpenSpec strict validation 与 git diff --check 本次重新通过。结论仍为 0 CRITICAL、1 WARNING、1 SUGGESTION，未实施 W1/S1、未归档。


本节覆盖当前平铺模型规划及用户手动测试后的修复，优先于下方历史报告。依据 apply instructions 的全部 contextFiles、当前源码、契约校验、浏览器与真实 SDK/迁移/重启证据核对；未因任务勾选而直接判定通过。

| 维度 | 当前结果 |
| --- | --- |
| 完整性 | 60/60 任务完成记录可读：52 项历史任务、8 项当前修订任务；15 项 ADDED/MODIFIED 需求均找到实现，无 REMOVED/RENAMED 要求。 |
| 正确性 | 15 项需求、68 个 Scenario 已做映射；发现 W1 名称长度边界与契约不一致，其余列出的业务场景有源码/测试证据。 |
| 一致性 | 单模型表单、两协议、私有凭据、不可变捕获、unknown/null 与既有架构一致；S1 建议加强旧默认模型的实际身份展示。 |

代码模式一致性已检查：Go/TS 文件与包命名遵循仓库约定，模型持久化继续复用事务/secret 发布，UI 复用现有组件和状态管理，契约走既有生成入口；源码及镜像 native boundary 通过，没有新增模式偏离。

**CRITICAL：0。WARNING：1。SUGGESTION：1。** 本轮适用检查均执行，没有将未验证的检查计为通过。完整 Desktop 批次另有 1 项原有五分钟票据长时认证测试按原开关跳过，属于本变更场景范围外，不作模型证据。没有自动归档、提交、推送或发布。

### CRITICAL

无。

### WARNING

**W1 — 新模型的名称长度和默认名称投影不一致。**

- 规格位置：`specs/core-admin-api/spec.md:19`（CADM-MODEL-001）要求 Model ID/名称最多 256 字符；AIM-001 要求名称省略时采用 Model ID。
- 实现位置：`packages/contracts/src/ai-model-management.ts:5` 的名称上限为 128，而 `:6` 的 Model ID 上限为 256；新 Create/Patch 名称在 `:34`、`:35` 同样只允许 128，输出 ModelConfig 在 `:36` 复用 128 限制；`apps/console-webui/src/model-management.ts:57` 的输入上限为 128。
- 关联路径：`internal/coreapp/model_config.go:128` 把省略名称设为完整 Model ID，没有与输出名称契约协调。
- 只读复现：129 字符 Model ID、不填 name，CreateModelConfigSchema 接受；按默认名称规则构造的 ModelConfig 输出被同一包的 ModelConfigSchema 拒绝。显式 129 字符名称也被创建契约拒绝。未向用户安装写入该边界数据。
- 影响：合法的长 Model ID 可以被保存，却产生不符合公开 DTO 的默认名称；名称编辑限制也偏离规格。现有短名称模型不受此边界影响，但不能据此记为零问题。
- 建议：统一新平铺模型的创建、编辑、读取及 UI 名称为规格要求的 256；同时妥善处理仍保留 128 限制的旧 Provider 兼容投影，避免默认名称再生成非法旧 DTO。补充 129/256 长度的省略名称、显式名称、编辑及兼容读取测试，再执行 make generate 与 Go/TS oracle。

### SUGGESTION

**S1 — 明确显示 Work 默认实际捕获的 Model ID。**

- 位置：`internal/coreapp/model_bindings.go:49` 使用当前管理名称给旧捕获引用生成 label；`apps/desktop-webui/src/app.ts:442` 优先展示该 label。
- 当同一管理条目改了名称/Model ID，而 Work 保留旧不可变引用时，公开 model 字段仍正确，但默认项标题可以变成新名称，容易让用户以为已切换型号。这不构成已接受历史被重写，属于展示可理解性问题。
- 建议：在 Work default 选项与响应设置中同时展示实际 `model`，用合成 old-id/new-id 的场景验证目录编辑后旧捕获身份仍可辨认，不显示端点或秘密。

## 需求与实现映射

| 需求 | 源码依据 | 验证依据 |
| --- | --- | --- |
| AIM-001 | model_config.go:34/38；model_registry.go:66/600；ModelConfig DTO | model_config_test.go 两项；迁移失败、重启、旧定义、兄弟模型独立、无子模型夹具；W1 是已识别的长度例外。 |
| AIM-002 | model_config.go:38；model_bindings.go:73/96 | 独立 Key、发布回退、旧授权 pinning、轮换后真实 SDK 请求。 |
| AIM-003 | model_test_http.go:27；model_test_errors.go:29/56 | 两协议 HTTP fixtures、真实 Console Modal、失败仍可保存、大小/超时/安全错误。 |
| AIM-004 | model_registry.go:508/538；modelConnection | 删除依赖、启停、既有执行准入、历史保留及真实重启测试。 |
| AIM-005 | model_runtime.go:45/126；Console Runtime 选择器 | 未收录 ID 进入 Runtime/Chat，保存/Test 不改默认；真实四配置默认初始化。 |
| AIM-006 | run-models.ts thinking/chatList；pi-sdk-executor.ts resolveProductionModel；sessions.ts setChatOptions | 已知 Off/high、未知普通请求、旧非空偏好显式 Normal；客户端建议值与创建设置对新增回归。 |
| CADM-MODEL-001 | model_admin_http.go；ai-model-management.ts；console_api.go | 完整模型单请求保存、Test 编辑覆盖、权限/方法/未知字段；W1 长度边界。 |
| CADM-004 | model_runtime.go:45；settings.go LoadRuntime；runtime_preparation.go | 配置保存和 readiness 分离、引用初始化、现有 Work 不改绑。 |
| CADM-005 | default_work_patch.go:62；defaultModelSelectionTx | 默认字段原子合并、不可用引用拒绝、无关字段保留及管理 API 回归。 |
| SUI-MODEL-001 | Console model-management.ts 单表单/list/Test/Modal；app.ts 导航 | Console 72 项完整浏览器与字段/窄屏专项，真实 Core 两协议 Test。 |
| SUI-CFG-002 | Console app.ts Runtime 页面；adapter.modelRequest | 选择项不可用原因、引用式保存、未知写入读回、实际本机 READY。 |
| CONV-MODEL-001 | Desktop adapter.ts:521/600/805/812；Agent sessions/runs；Go conversation | 同 Session 切换、原子设置、nullable 事实、不重放；新增刷新恢复 Cancel、忙状态、新会话建议值及丢失受理回归。 |
| WCFG-MODEL-001 | work_binding.go、model_bindings.go:19、run_models.go | 捕获身份、端点/Key 管理隔离、自动执行默认、未知默认真实初始化。 |
| PWORK-MODEL-001 | snapshot_bindings.go:64/173；workhistory；work-store snapshot | 两安装已知 High 与未知 null 往返、目标 Key、stopped 导入、再导出与不重放。 |
| runnable-work-runtime 修改项 | 私有模型/RPC/credentials、SDK 共用解析、child default 材料 | scoped 凭据与授权、真实两协议、普通定义、子代理默认授权材料测试。 |

## 本轮修复与实际证据

- 刷新/重新进入 Chat 从 Session history 恢复原 active Run，显示 Cancel run、恢复原事件观察；不重新提交 prompt，保留草稿。
- Core 将明确 WorkBusy 的 ResourceExhausted 分类为已有 WORK_BUSY/409，真实配额/限流仍保留 RATE_LIMITED/429。客户端兼容旧 Core 的忙状态响应，读回原 Run 并给出取消方向，不自动重发。
- 未触碰的新会话草稿使用 SDK 已确认建议值；显式创建时确认完整模型/Thinking 对；丢失创建受理读回保留原对，需显式确认而不自动重发。旧 Session/Run 不被新默认改写。
- Desktop 完整浏览器：234 通过、1 项原有范围外长时票据测试跳过；新增取消恢复、旧 429 恢复、延迟能力、新会话创建及丢失受理子场景全部通过。
- `go test ./internal/coreapp ./internal/cli` 通过；Conversation 单测通过；`TestGoCoreHTTPToRealTSAgentConversation` 通过（88.94s），实际验证第二个 active Run 被 WORK_BUSY 拒绝、显式 Cancel 与终态/重放行为。旧夹具的 Chat version 1 断言改为当前 version 3 后重跑通过，失败批次未算通过。
- 固定 Agent/历史/契约上一轮同版本证据分别为 Agent 93/93、contracts/work-store 61/61；本轮未改 SDK/历史契约相关源码。两协议未知 ID、四配置默认、跨安装包与在途/重启联合证据仍适用，细节见 model-direct-verification.md。
- Windows/Linux CLI 构建通过；Windows exe 版本、源/目标 SHA256、build.json/UI hash 及实际 17891 所服务资源一致；真实 Windows Desktop 已验证 active Run 的 Cancel 可见。Core 只在 idle 检查通过后重启，活动任务存在时曾明确暂缓；部署后 Core/必要依赖恢复 READY，完成 Run 没有重放。
- 原生源码边界、镜像边界、OpenSpec strict validation、git diff --check 通过。完整日志保留在忽略目录 dist/model-direct-evidence，报告不复制真实 Key、密码、token 或工作区内容。

Python 国内源/缓存是另行授权的现有服务运维修复：已采用 HTTPS 国内镜像、持久缓存与依赖 hash；健康检查 200，再次准备约 0.1s。它不代表新增平台全局 Python 源，也不作为模型规格的实现证据。

## 范围和最终评估

当前设计仍固定 Pi SDK 0.86.1。未收录型号按 unknown/普通模式支持符合本 change；Opus 5.5 的完整 effort 能力及 SDK 1.1 升级尚未纳入此规划，本轮未把该探索当成已交付。

适用检查均已执行。无 critical，1 warning、1 suggestion；建议修复 W1 后再归档，S1 可作为展示改进。本轮未自动实施验证中新发现的问题，也未归档。

---

# 以下为此前各轮历史报告

# 变更验证报告

变更：`manage-multi-provider-model-lifecycle`。日期：2026-10-09。

首次报告使用 `openspec-verify-change`，依据 delta specs、design、tasks、源码、测试与实际验收日志。随后按用户要求修复以下发现；原始验证内容保留在“首次验证结果”之后。

## 当前模型直接配置增量

当前范围为 tasks 第 10 节：平铺模型管理、未知 ID 普通执行与 Thinking unknown/null。实现和逐项验收见 [模型直接配置增量验收](model-direct-verification.md)。当前 60/60 任务完成，15 项需求、68 个场景核对通过；CRITICAL 0、WARNING 0、SUGGESTION 0。Go 全部测试、相关 TS/浏览器/真实 SDK/跨安装/重启与边界检查通过。下面第 9 节及更早结论仅代表历史范围。

## URL 兼容与错误反馈增量复验（2026-10-09）

本节对应第 9 节用户确认范围，为该轮历史结论；下文旧范围与历史事实保留，不将其测试数混为本轮执行。

| 维度 | 当前结果 |
| --- | --- |
| 完整性 | 52/52 任务完成；15 项 ADDED/MODIFIED 需求有实现，新增 7 项任务均有代码及测试证据 |
| 正确性 | 75 个场景核对；Messages URL 等价、具体字段/失败原因、恢复与独立保存有新增回归，原生命周期/捕获/Thinking 边界保留 |
| 一致性 | 协议规范化共用、保留既有捕获事实，Test 失败使用安全严格契约；界面区分错误来源，不把只读 Test 当成未知配置写入 |

CRITICAL：0。WARNING：0。SUGGESTION：0。适用检查没有因证据缺失跳过。当前增量通过，未归档。

### 代码与需求映射

- **AIM-001/AIM-003/CADM-MODEL-001 URL 兼容**：`internal/contracts/model_endpoint.go` 新增 `NormalizeProtocolModelEndpoint`，Messages 根地址、末尾 `/v1`、尾斜杠规范化为相同连接并保持非版本前缀；Responses API base 不删除 `/v1`。`model_registry.go` 保存/编辑/Test 共用该规则，`settings.go` 对新的目标协议 Runtime 初始化应用同一规则。保留旧 `NormalizeModelEndpoint` 用于既有捕获事实，不原地重写旧 Work。等价 URL 不产生新 modelRef。
- **安全契约与字段定位**：TS 定义具名 Test 输入变体及必需的失败 reason/message/recovery（说明各 512 字符上限），生成 Go DTO/schema/oracle。`readModelTestInput` 在严格 JSON、大小/Content-Type/超时边界内选择明确变体验证，保留已知 field；未知字段仍拒绝而不反射字段值或 Key。
- **AIM-003/CADM-MODEL-001 请求错误**：`model_test_errors.go` 以稳定映射、标准 code/type/param 白名单和类型化 DNS/TLS/连接/超时事实生成安全说明；不能确认时通用分类，不复制原始 Go error 或上游 message/body。`model_test_http.go` 分开供应商错误、结构不兼容与空回复，保留 HTTP 状态和有界检查事实，失败不写目录或默认。
- **SUI-MODEL-001 恢复**：ConsoleError 保留 field/correlationId；adapter 给出字段指导，并将 Test 的丢失结果独立表达为 TEST_RESULT_UNAVAILABLE，不锁定成未知配置写入。Modal 区分 Test 未开始/请求失败/结果未确认/收到回复，安全展示原因和建议；返回表单定位字段、修正清除旧错误，供应商 401 不注销管理员，真正会话失效清理敏感内存。
- **WCFG/CONV/Thinking 边界**：SDK 联合回归确认管理 URL 表示或外部 Test 失败不重写 Work active/desired/pendingApply 或 Session 选择/High Thinking；实际 SDK 与 HTTP Test 使用同一规范化端点。

### 本轮实际执行

- `make generate`、Console build、`make build-go` 通过。模型管理 schema 与 Go 冻结 schema、Console JavaScript 与 Go 嵌入资源一致。日志 `dist/model-errors-generate.log`、`model-errors-web-build-final.log`、`model-errors-host-build-final.log`。
- Go Core/contracts/coreoperator/consoleapp/agentclient **包全量通过**，日志 `dist/model-errors-go-full.log`；随后增加实际拒绝连接与空白 Model ID 的边界断言，最终 URL/错误专项再次通过（`model-errors-url-tests-latest.log`）。
- TS 模型管理契约 **3 项通过**，Go/TS oracle 全量通过；覆盖失败原因/说明限制、未知字段及伪造回复拒绝。
- Console 全量浏览器 **72/72** 通过（`model-errors-browser.log`）；最终构建后相关专项 **25/25** 通过（`model-errors-browser-final.log`）。覆盖 12 种安全失败反馈、失败后保存、草稿/Key 内存保留、管理员会话区分、未知 Test 与未知写入区分、字段定位/修正及窄屏/晚到结果。
- 真实 Core/Console 与两协议受控服务器专项 **1/1** 通过（`model-errors-real-core.log`）。实际使用 `/v1/` 直接 Test/保存；404 后仍保存供应商，随后供应商 401 在 Modal 显示安全错误而管理员保持登录，原始上游文本不回显。
- `TestNativeModelURLNormalizationAndErrorRecovery` **PASS，60.82s**（`model-errors-sdk-integration.log`）：独立 Core/Agent + 固定 Pi SDK 验证根地址、`/v1`、`/v1/` 等价；保留 `/prefix` 并仅请求 `/prefix/v1/messages`，Key 与 High Thinking 实际生效。远端 404 不阻止保存，旧 Session 偏好失效但保持原引用/Thinking，Work 配置不被隐式更新。
- SDK fixture 按本次精确 Work 标签核对，containers/networks/volumes 均 **0**；没有全局清理。该集成使用受控 TLS 服务与临时可信 CA 派生镜像，未绕过证书验证。
- OpenSpec strict validation、native boundary、`git diff --check` 通过。没有重跑与本增量无关的完整 Docker 包往返或 Desktop 全量。

### 本机更新

tmux `12:0` 保持 1 个 window，仅更新既有 Core/Console pane，Desktop 不重启。停服后在被忽略且受保护目录保留私有 Core 数据副本，沿用原数据目录和管理员凭据。部署后实际浏览器验证两协议、三种 Messages URL 表示、字段定位与供应商认证反馈；临时草稿不保存，现有供应商/模型/Work 数量保持。安全证据：`dist/model-preview/errors-deployment-verification.json`，错误 Modal 截图 `dist/model-preview/model-error-modal.png`。没有向旧远程服务器部署、推送或发行。

## 消息 Test 与操作布局增量复验（2026-10-09）

本节对应用户后续确认的第 8 节新范围，作为该范围的当前结论；下文 39 项任务/62 个场景的历史结论保留。

| 维度 | 当前结果 |
| --- | --- |
| 完整性 | 45/45 任务完成，15 项 ADDED/MODIFIED 需求有实现；新增 6 项任务均有独立实施证据 |
| 正确性 | 15 项需求、68 个场景复核；新增消息/回复/Modal/标题栏场景均有对应测试，原生命周期与 Thinking 边界沿用既有验证且未改动执行路径 |
| 一致性 | 消息仍通过 Go HTTP 单次请求，Modal 复用现有 Console dialog，安全成功/失败 union 严格生成到 Go，页面操作复用 PageHeader/header-actions |

CRITICAL：0。WARNING：0。SUGGESTION：0。本次适用检查没有因证据缺失跳过。当前增量通过；未归档。

### 实现映射

- **AIM-003/CADM-MODEL-001**：`packages/contracts/src/ai-model-management.ts` 定义包含固定 testMessage 的严格成功/失败结果，只有成功允许非空 replyText 和 replyTruncated。`internal/coreapp/model_test_http.go` 从 Responses assistant output_text / Messages assistant text 提取实际正文，接受合法的 `error:null`，拒绝空文本、仅推理/工具、错误角色与畸形文本。已知本次 Key 在截断前屏蔽，8 KiB UTF-8 边界截断，保留 20 秒/64 KiB/无重试/二次授权/无业务写入边界。
- **SUI-MODEL-001**：`apps/console-webui/src/model-management.ts` 记录不含 Key 的目标和草稿版本，Modal 展示发送消息、进行中、实际回复/失败、时间/耗时及过期/截断。关闭不会自动重开，查看旧结果不会发新请求。`apps/console-webui/src/app.ts` 为现有 dialog 增加只读结果模式与按目标更新的句柄，保留关闭、焦点和键盘约定；晚到结果不能替换新目标或其他确认弹窗。
- **操作布局**：列表与两级详情使用 PageHeader/header-actions 放置 Read current data / Configure runtime，All providers 使用返回导航。`public/style.css` 使用既有窄屏标题栏换行，并为有界回复提供纯文本换行与滚动布局。
- **其余需求**：供应商 CRUD/Key/准入/默认/执行绑定/历史/可移植协议/Thinking 的实现路径未在本增量改变；对应主映射见下文需求表。新增 Test 不创建 Work/Session/Run、不写默认配置、不将测试结果作为执行准入。

### 实际执行与证据

- `make generate`、Console workspace build、`make build-go` 通过，日志 `dist/model-message-generate.log`、`dist/model-message-console-build.log`、`dist/model-message-host-build.log`。所有模型管理 schema 与冻结 Go schema 一致，Console JavaScript/CSS 与 Go 嵌入资源逐字节一致。
- Go Core/contracts/consoleapp/agentclient 包全量通过，日志 `dist/model-message-go-full.log`；Core HTTP/消息专项及单独 contracts 全量亦通过。`model_message_test.go` 的两协议 16 个子场景覆盖正文顺序、空/推理/工具/用户角色/畸形回复、已知 Key 屏蔽和 UTF-8 截断；既有 HTTP Test 的认证/超时/大小/并发/无自动保存继续通过。
- TS 模型管理契约 3 项通过，日志 `dist/model-message-contracts-ts.log`；生成的成功/失败结果均经过 Go/TS oracle 对照，失败不能附带回复，成功不能缺少正文/截断字段。
- Console 全量浏览器 **58/58** 通过，日志 `dist/model-message-browser.log`。覆盖两协议实际回复和转义、360px/长文本、关闭/Esc/焦点恢复、查看不重发、过期、身份失效、新目标与无关 discard dialog 的晚到结果隔离，以及原管理功能。
- 真实 Go Core/Console + 两协议受控 HTTP 服务器专项 **1/1** 通过，日志 `dist/model-message-real-core.log`；同一 Model ID 分别用两种协议及各自 Key，在草稿和已保存供应商路径共发送 4 次请求，实际请求消息与 Modal 正文一致。该专项没有使用 mock Core API 或付费供应商，也不记作原 3 项 real-core/Docker 全量重跑。
- 首次浏览器专项有 1 项测试在窄屏找不到折叠的主导航；修正该测试的桌面视口后全量通过。首次失败日志 `dist/model-message-browser-focused.log` 保留，不将其当作通过证据。
- OpenSpec strict validation、native boundary、`git diff --check` 通过。

### 本机测试部署

按用户既有本机部署要求，仅重启 tmux `12:0` 的 Core/Console pane，保持 1 个 window 和既有数据目录，Desktop 进程保留。实际部署页面通过两协议临时草稿消息测试及 Modal/标题栏验证，前后 providers/models/works 数量一致；未保存临时测试供应商，未创建 Work。安全结果位于被忽略的 `dist/model-preview/message-deployment-verification.json`，截图 `dist/model-preview/model-test-modal.png`。未推送或发行，未触碰旧远程服务器。

## 正式复验结论（2026-10-09）

本节为用户再次执行 `openspec-verify-change` 后的当前结论。未修改业务代码或任务状态，未归档。

| 维度 | 当前结果 |
| --- | --- |
| 完整性 | apply 聚合 39/39 任务完成；15 项 ADDED/MODIFIED 需求均有实现；无 REMOVED/RENAMED 项；追踪及规划文件全部可读 |
| 正确性 | 15/15 需求完成实现映射，62 个场景核对实现及测试证据；W1/W2/S1 的修复通过本轮重新执行的回归，无新增问题 |
| 一致性 | 8 项设计决定与当前实现一致；安全契约、私有授权、SDK 解析、生成资源及源码目录约定符合现有模式 |

CRITICAL：0。WARNING：0。SUGGESTION：0。没有因证据缺失而跳过上述检查；既有完整实现映射与本轮复查共同构成本次结论。全部检查通过，可以进入归档流程。

### 三个发现的关闭依据

- **W1 已关闭**：`apps/console-webui/src/model-management.ts:35` 在读回开始时更新 Test revision，`:46` 更新模型详情的供应商副本，`:114` 仅在有可见供应商表单时使用连接草稿；模型详情由 Core 读取当前连接/Key。`apps/console-webui/test/feedback.spec.mjs:101`、`:114` 的三个回归本轮全部通过，覆盖地址/Key 保存项变化、模型草稿保留、旧检查晚到和无自动保存。
- **W2 已关闭**：`internal/coreapp/run_models.go:101` 不再把默认失效且候选为空转成读取错误；`:231` 继续对旧私有契约明确拒绝不可用默认。`apps/agentd/src/run-models.ts:98` 返回契约 2 的真实空目录；`apps/desktop-webui/src/app.ts:463` 展示原因。Core 停用/重新启用、停用后拒绝执行、Agent 真实空集合与失败区分，以及 Desktop 草稿/历史/偏好/High Thinking 保留与恢复均有通过的回归证据。
- **S1 已关闭**：`packages/contracts/src/chat-controls.ts:28` 为安全 unavailableModels 定义严格结构；`apps/agentd/src/run-models.ts:14`、`:90` 输出有界能力/SDK 原因与恢复指引；`apps/desktop-webui/src/app.ts:472`、`:479` 显示旧契约升级方向与不可执行模型说明。TS 契约、Go Agent client、Agent 及 Desktop 测试通过；Key、端点、私有能力和 executionBindingId 仍不能进入公开恢复项。

### 本轮重新执行

- Go Core/Agent client 模型管理、HTTP Test、执行绑定、空目录及安全 Chat 恢复投影测试通过（`-count=1`），日志 `dist/model-reverify-go.log`。同一过滤命令中的 contracts 包未匹配测试，未将其计作验证；随后单独执行 `CGO_ENABLED=0 go test -mod=readonly ./internal/contracts -count=1`，全量通过。
- Agent model-providers/run-models 与 TS 管理/Chat 契约 **19/19** 通过，日志 `dist/model-reverify-agent.log`；包含实际固定 SDK 的 Responses/Messages Thinking HTTP fixture 请求。
- Desktop 本次相关浏览器回归 **6/6** 通过，日志 `dist/model-reverify-desktop.log`；Console 读回与在途 Test 浏览器回归 **3/3** 通过，日志 `dist/model-reverify-console.log`。
- Chat schema 与冻结 Go schema 比较一致；当前 Console/Desktop 构建 JavaScript 与 Go 嵌入文件逐字节一致。
- OpenSpec strict validation、native boundary 与 `git diff --check` 通过。

Docker 在途/重启及包往返使用既有测试源码与实际日志核对，本轮没有重跑；`model-native-integration-final.log` 只把其中在途用例的独立 PASS 计为证据，包往返以 `model-package-roundtrip-final.log` 后续最终 PASS 为准。没有把历史失败批次或未执行命令计为本轮通过。公网供应商真实账户与用户服务器部署不在本次本地验证范围。

## 修复后复验（2026-10-09）

| 原发现 | 当前状态 | 修复与证据 |
| --- | --- | --- |
| W1 | 已修复 | 模型详情 Test 仅提交 providerId 与当前模型草稿，由 Core 取当前保存端点/Key；仅可见供应商表单覆盖连接。读回在等待响应前递增检查版本，使已有及在途结果过期；可见草稿保留。Console 跨会话端点/Key 变化、在途结果晚到 3 项回归通过。 |
| W2 | 已修复 | Core 成功读取零候选时保留 defaultUnavailable 与空数组；新 Agent 返回契约 2 的空目录与恢复说明。停用的默认/覆盖仍拒绝执行；旧私有契约仍明确拒绝不兼容的默认投影。Core 停用/恢复单测、Agent 空目录/读取故障单测、Desktop 历史/草稿/偏好/High Thinking 保留与恢复测试通过。 |
| S1 | 已修复 | Chat 契约 2 可附带严格安全 unavailableModels，区分 capabilities-unconfirmed 与 sdk-unsupported；Response settings 展示配置能力或更新 Agent image 并 Apply 的说明，不提供为可选模型。旧 Chat 契约 0/1 展示升级方向。TS schema、Go Agent client、Agent 与 Desktop 测试通过，私有字段仍被拒绝。 |

本次修复范围内无剩余 WARNING/SUGGESTION，新增跟踪任务 7.1–7.4。Thinking 的档位、映射与保存行为保持原实现；能力解析错误只转换为有界安全原因，不透传 SDK 原始错误。

复验命令与结果：

- `make generate`、Agent/Console/Desktop workspace 构建、`make build-go` 通过；最终 Go 宿主包含最新嵌入资源。
- `CGO_ENABLED=0 go test -mod=readonly ./internal/coreapp ./internal/contracts ./internal/agentclient ./internal/cli ./internal/consoleapp` 全部通过，日志 `dist/model-followup-go-final.log`。首次批次有一条旧测试要求“全停用时查询失败”，已改为断言真实空目录并独立拒绝执行；首次失败日志保留在 `dist/model-followup-go.log`。
- Console 全量浏览器 53 项通过，日志 `dist/model-followup-console.log`；最终过期提示文案重建后另外重跑 3 项读回/在途回归，日志 `dist/model-followup-console-regression.log`。
- Desktop 本次相关浏览器专项 6 项通过，日志 `dist/model-followup-desktop.log`。未将专项执行描述为 Desktop 全量重跑。
- Agent model-providers/run-models 与管理/Chat 契约共 19 项通过，日志 `dist/model-followup-agent.log`，包含真实 SDK 的两协议 Thinking HTTP fixture 请求。
- OpenSpec strict validation、native boundary 与 `git diff --check` 通过。

本轮没有重新执行 Docker 包往返或部署到用户服务器；它们的前次事实仍在原验证记录中。本次修复由各层回归和 Go client 严格契约验证覆盖。未归档变更。

## 首次验证结果（保留）

| 维度 | 状态 |
| --- | --- |
| 完整性 | 35/35 任务勾选完成；15 项新增/修改需求均找到实现；无缺失需求实现的 CRITICAL |
| 正确性 | 15/15 需求有实现映射；62 个场景按条件、实现与测试证据检查；发现 2 处规格偏差及对应回归覆盖缺口，详见 W1/W2 |
| 一致性 | 8 项设计决定的主要实现结构符合；兼容性原因/恢复提示有 1 项改进建议，详见 S1 |

无 CRITICAL，2 WARNING，1 SUGGESTION。没有跳过上述检查维度。依据验证流程，可以带已记录改进归档；建议先处理 W1/W2，再复验。此结论不表示已经部署，也不表示所有场景均无缺陷。

## WARNING

### W1：读回供应商变化后，Test 仍使用旧端点并把旧结果视为有效

- 关联：AIM-003、SUI-MODEL-001；设计决定 4 的配置绑定与过期规则。
- 位置：`apps/console-webui/src/model-management.ts:35`、`:43`、`:57`、`:95`、`:113`。
- 模型详情首次加载时把供应商连接复制进 `providerDraft`。`Read current data` 调用 `load(path,true)`，更新供应商列表，却保留已经填充的连接副本，也不递增 Test revision。
- 复现：在模型详情 Test 成功；另一个管理会话修改所属供应商 Base URL；点击 Read current data。列表已读到新地址，但旧成功结果没有过期；再次 Test 仍发送旧地址。模型详情没有连接表单，用户不能在该页看到或修正这个隐藏的旧连接副本。Key 轮换的读回同样需要使旧检查失效。
- 本轮使用已构建 Console 模块、合成供应商和替换的 API adapter 执行复现：读回的地址为 `https://new.invalid/v1`，`oldTestStillCurrent=true`，再次 Test 的地址仍为 `https://old.invalid/v1`。未调用真实供应商。
- 建议：模型详情的 Test 从最新保存的供应商读取连接；仅供应商编辑表单使用显式连接草稿。比较供应商/模型读回版本或保守地在读回时使旧 Test 过期，同时保留用户可见的非敏感草稿。补充另一会话修改地址/轮换 Key 后读回及再次 Test 的浏览器回归。
- 现有浏览器测试覆盖本页输入变化使 Test 过期，未覆盖保存项在另一会话变化后的读回。

### W2：默认不可用且候选为空时，被映射为列表读取故障

- 关联：CONV-MODEL-001 的“空列表、读取故障与不可用偏好”场景。
- 位置：`internal/coreapp/run_models.go:156`。
- `DefaultUnavailable && len(Models)==0` 直接返回 `MODEL_LIST_UNAVAILABLE`。当管理员停用所有模型/供应商时，数据库读取实际成功，结果却与存储或网络故障使用同一种失败表达；Agent 随后提示重试 Work readiness，不能如实区分“当前没有启用模型”和“列表读取失败”。
- 建议：支持新契约的调用返回可用性事实、空候选和默认不可用原因；仅真实读取故障返回 list unavailable。旧契约仍可返回明确的不兼容/不可用响应。补充 Core → Agent → Desktop 的“全部停用 → 空列表 → 重新启用恢复”回归，断言草稿、偏好及 Thinking 保留。
- 现有 `TestManagedModelUnavailableDefaultDoesNotHideOtherCandidates` 只覆盖默认不可用且仍有一个候选；Agent 的空列表测试使用有效默认，未覆盖这个组合。

## SUGGESTION

### S1：为 SDK/旧镜像过滤补充可执行的恢复提示

- 关联：CONV-MODEL-001、设计决定 6、任务 3.7。
- 位置：`apps/agentd/src/run-models.ts:83`、`:91`；`internal/coreapp/run_models.go:235`。
- SDK 不支持的候选被过滤；默认描述失败后仅给出通用 unavailable 文案。旧私有契约接收去掉新能力字段的投影。文档提供升级说明，但当前列表缺少针对被过滤模型的安全兼容原因，用户难以判断应配置能力还是升级 Agent 镜像。
- 建议：提供安全的不兼容摘要或具体恢复提示，区分能力未确认、SDK 不支持和需要更新镜像，并以旧镜像/未知能力夹具验证提示；保持 Key、端点及私有能力字段的投影边界。

## 需求与场景证据

以下映射覆盖全部 15 项需求和 62 个场景。场景数量表示审查范围，不将测试通过当作所有细分条件均自动成立。发现的反例和缺口已单列。

| 需求 | 场景数 | 主要实现 | 对应测试证据 |
| --- | --- | --- | --- |
| CONV-MODEL-001 | 13 | `internal/coreapp/run_models.go`、`apps/agentd/src/run-models.ts`、Desktop Response settings、Session/Run 设置与幂等路径 | `run-models.test.ts`、`model-providers.test.ts`、`model_providers_integration_test.go`、Desktop recovery/browser；空目录组合见 W2 |
| AIM-001 | 3 | `model_registry.go`、`model_admin_http.go` | `TestModelManagementProviderModelsLifecycleAndSafeViews`、`TestModelManagementEditsPublishNewBindingsAndPersist`、非法输入及重启集成 |
| AIM-002 | 3 | Provider secret 版本发布、`model_bindings.go` | Key failure、fixed execution binding 单测；真实 SDK 轮换；Console 未知写入/Key 清除测试 |
| AIM-003 | 3 | `model_test_http.go`、Console Test 与 revision | HTTP 协议/预算/无写入测试、Console 草稿 Test；读回偏差见 W1 |
| AIM-004 | 3 | registry 生命周期及依赖检查、执行前准入 | 删除默认/live Work/历史引用单测；固定绑定撤销；在途生命周期集成 |
| AIM-005 | 2 | `model_runtime.go`、runtime adoption、default-work patch | adoption 保留启停及引用；runtime/default 独立测试；初始化回归 |
| AIM-006 | 3 | SDK 模型解析、能力模板、Thinking 共用定义 | Agent `model-providers.test.ts`、`pi-sdk-executor.test.ts`；真实 Responses/Messages 请求参数；Console 无默认 Thinking |
| CADM-MODEL-001 | 3 | `model_admin_http.go`、HTTP 路由、二次授权 | 管理员/非法输入单测、Console proxy 路由、独立 HTTP Test fixture |
| CADM-004 | 3 | `model_runtime.go`、`settings.go`、runtime 输入 union | runtime/default 独立测试、既有 runtime 保存/readiness 测试、真实 Console |
| CADM-005 | 4 | `default_work_patch.go`、事务合并默认配置 | 默认配置 patch/并发测试、runtime/default 独立测试、Console 默认配置测试 |
| PWORK-MODEL-001 | 4 | `snapshot_bindings.go`、snapshot metadata、Go/TS history 严格校验 | `model_snapshot_test.go`、`model_providers_test.go`、work-store snapshot 测试；两安装实际冷包往返 |
| runnable-work-runtime 凭据与执行边界 | 6 | `model_bindings.go`、私有 RPC、Agent 凭据解析和子代理配置 | execution pin/revocation 单测、Agent 子代理刷新测试、两协议真实 SDK/Key 轮换集成 |
| SUI-MODEL-001 | 4 | Console models 导航/路由、`model-management.ts` | Console 两协议多模型、360px、依赖冲突、未知写入及会话失效浏览器测试；读回偏差见 W1 |
| SUI-CFG-002 | 4 | Console Runtime 目录引用式表单 | Console contract/real-core Runtime 测试及旧初始化路径 |
| WCFG-MODEL-001 | 4 | `work_binding.go`、`capturedDefaultModelTx`、Work 创建/Apply 事务准入 | 捕获定义及不相关编辑单测；真实端点/Model ID/Key 编辑、Apply 与在途集成；既有自动 Run 与 Session 偏好隔离测试 |

## 设计一致性

1. Provider/管理模型稳定 ID 与 immutable modelRef 分离；名称编辑保留历史，执行字段编辑发布新选择引用。
2. 使用现有 control_metadata/catalog_entries、事务发布和先写 secret 后发布引用；旧 published secret 保守保留符合设计允许的首版策略。
3. 默认捕获、显式覆盖、Key 轮换、启停及删除依赖分别处理；固定执行绑定保留受理事实。
4. HTTP Test 使用 Go net/http，单次请求、20 秒预算、64 KiB 上限、禁止重定向；UI 配置读回有 W1。
5. 固定 Pi SDK 0.86.1，明确 Responses/Messages，能力复用/模板/显式定义与 Thinking 解析共用，没有管理员默认 Thinking。
6. 私有模型能力握手与 Chat 增量契约分开，旧投影保留；具体恢复提示见 S1。
7. 初始化、默认与 Work 包沿用同一模型授权体系，协议/模型/端点/能力匹配，不迁移源 Key 或源执行授权。
8. Core 管理/HTTP Test、Console HTTPS proxy、Desktop Chat 与容器 SDK 职责符合设计；源码路径、Go 命名及生成资源方式符合仓库约定。

## 本轮执行与既有验收证据

- 本轮重新执行 Core 模型管理、HTTP Test、managed execution/snapshot、Console 及 history 对应 Go 单元测试，通过；snapshothelper/workpackage 初次过滤命令没有匹配用例，未将其计作对应测试通过。
- 本轮 Node 24 重新执行 Agent run-models 和管理契约测试，8/8 通过。另执行 managed provider/Thinking 专项和 helper/history/package 单测，结果见本轮终端。
- 本轮 `openspec validate manage-multi-provider-model-lifecycle --strict`、`git diff --check` 通过。
- 已检查本次实施日志：`dist/model-package-roundtrip-final.log` 的两协议真实 SDK/Thinking/轮换/包往返 PASS（258.01s）；`dist/model-native-integration-final.log` 的在途/重放/重启用例独立 PASS（82.41s）。后者整个批次曾 FAIL，不将整个批次宣称通过，失败包用例以后续最终日志为准。
- `verification.md` 记录 build/test、Console 50 项、真实 Console/Desktop 及包历史测试。Docker 集成本轮核对测试源码和实际日志，没有重新运行；这些供应商为受控协议服务器，未验证公网供应商真实账户。
- 未部署到用户服务器，未归档变更，未修改任务勾选状态。
