# Design

## Context

动机及授权范围见 [proposal.md](proposal.md)。用户确认入口在聊天设置内，问题针对 SDK 未收录型号；`opus-5-5` 仅作为用户提供的型号例子，不是已核实的官方型号/协议声明。

规划阶段只读检查确认的变更前基线如下；最终行为见 Decisions 及后文的 schema 7、会话生命周期决策：

| 位置 | 变更前职责与限制 |
| --- | --- |
| `apps/agentd/src/run-models.ts` | `thinking()` 对未知定义返回 unknown、空档位、null 默认值；列表并未隐藏这些普通可执行模型 |
| `apps/agentd/src/pi-sdk-executor.ts` | 未知协议模型构造 `reasoning:false`，128k 上下文、8192 输出上限；普通 null 请求删除推理字段；SDK 初始化还核对实际档位 |
| `apps/agentd/src/sessions.ts`、`runs.ts` | 保存、受理、Cancel and send 二次准入均按档位列表拒绝未知非空 Thinking；自动 Run 单独选择默认 |
| `packages/contracts/src/chat-controls.ts`、`work-feedback.ts` | chat contract 3 区分 unknown/null 与旧 Off；完整设置目前仅含 modelRef、thinkingLevel |
| `apps/desktop-webui/src/app.ts`、`adapter.ts` | unknown 只提供 Normal，保存/发送判断也限制 null；完整设置比较和请求协调需一起扩展 |
| `internal/workhistory/brain_linux.go`、`rebuild_linux.go` | 私有模型描述按字段校验；导入重绑定模型时显式恢复 Thinking，需要同时保留新方式 |
| `apps/agentd/src/model-provider-errors.ts` | 在 SDK 持久化之前替换不可信供应商错误，现有专门分类主要是认证/权限 |

固定依赖为 Pi 0.86.1。规划阶段本机尚未安装 node_modules，通过 `npm pack --ignore-scripts` 将该版本 pi-ai 下载到被忽略的 `dist/support-compatible-thinking/` 只读检查，未修改依赖或锁文件。该版本 `getSupportedThinkingLevels` 在 reasoning=false 时只返回 Off；XHigh/Max 需显式映射，Responses streamSimple 会夹限档位；Messages 由 `forceAdaptiveThinking` 决定 effort 或预算分支，默认预算的 Medium/High 在未知模型 8192 输出上限下可能被压成相同预算。因此只放开 UI 或设 reasoning=true 都不足以满足契约。

变更前 AIM-006、CONV-MODEL-001、DWUI-MODEL-001 对未知档位的限制是明确规格，不当作实现疏漏绕过。本变更同时修改这些 Requirement；保留 SDK 已确认档位含义，另行表达兼容请求。

## Goals / Non-Goals

**Goals:**

- 同一解析策略产出展示选项、保存校验、受理快照和 SDK 请求定义；未知型号不依赖名称白名单。
- 保留“未请求”“SDK 已确认设置”“用户兼容请求”三种语义，以及受理后不变、同键重放和现有安全边界。
- 复用当前两个协议及已有 SDK 适配能力，允许后续 SDK 收录型号而不篡改已保存兼容选择。

**Non-Goals:**

- 不强迫远端真正不支持推理的模型接受参数，不通过 prompt 模拟推理，不暴露推理原文。
- 不开放任意请求 JSON，不新增 Chat Completions 等协议，不增加管理员配置、自动能力探测、SDK 升级或官方型号声明。
- 本轮不把已知非推理模型或已知模型所有未开放档位强行开放；用户最后澄清的目标是未收录模型。已有兼容配置在后续 SDK 收录后的延续是历史兼容例外。
- 不扩展为 UI 重写、全量无障碍审计或发行。

## Decisions

### 1. 兼容方式与档位共同保存，能力描述仍如实标为未知

chat controls 升至 contract 4，保留 0–3 reader。新增有界 `thinkingProfile` 字段，值为 `responses-effort-v1`、`messages-adaptive-v1`、`messages-budget-v1`；写请求中省略字段表示旧客户端，`thinkingProfile:null` 是新版客户端明确清除兼容方式，字符串选择该兼容方式；null 档位只能搭配字段省略或显式 null。兼容非空档位必须携带合法字符串 profile；未知非空档位无 profile 仍拒绝。持久快照及读取投影无兼容方式时省略 profile；SDK 已知模式不携带 profile。已有兼容偏好时，省略字段的旧设置请求必须原子拒绝，不能覆盖或清除该偏好；显式 null 才能清除。

新版目录在未知模型上保留 `thinkingAvailability:unknown`、空 SDK `thinkingLevels` 和 null 默认值，另提供 `compatibleThinkingProfiles`（方式标识、可请求档位、预算显示数据）。普通用户得到安全方式描述，不得到地址、Key、能力 JSON 或私有绑定。浏览器不猜协议或拼档位。

profile 对新选择仅向未知模型开放；已保存或已受理的合法 profile 在 SDK 后续收录时继续按版本化定义解释，不自动切 SDK 模式。用户在同一模型明确改选 SDK 档位时才清除 profile。版本化 profile 映射不可原地改变，后续行为变更新增版本并保留旧 reader。

替代方案：直接给 unknown 填通用 thinkingLevels 会伪造已确认能力；只存 high 会失去 Messages 自适应/预算差异，也无法在 SDK 升级后还原请求。

### 2. 按协议提供三个小型兼容定义，不借用某个旧型号

| Profile | UI 档位 | 请求规则 |
| --- | --- | --- |
| `responses-effort-v1` | Off、Minimal、Low、Medium、High、XHigh、Max | Off → effort=none；其余 → 同名小写 `reasoning.effort` |
| `messages-adaptive-v1` | Off、Low、Medium、High、XHigh、Max | 非 Off → thinking=adaptive + 同名 effort；Off → thinking=disabled，不带 effort |
| `messages-budget-v1` | Off、Minimal、Low、Medium、High | 依次无预算、1024、2048、4096、6144 tokens；非 Off → thinking=enabled + budget_tokens；Off → thinking=disabled |

预算是本产品兼容方式的请求约定，不声称是模型官方档位。采用有区别且低于现有未知模型 8192 输出上限的预算，避免沿用 SDK 的 8192/16384 后两档都被夹限成 7168。界面显示预算数。实际上下文导致输出上限不足以容纳预算和至少 1024 正文 tokens 时明确失败，不上调未经确认的模型最大容量，不静默缩减预算。普通 null 模式继续去掉 reasoning、thinking 和 output_config.effort。

OpenAI 官方 [Reasoning models](https://developers.openai.com/api/docs/guides/reasoning) 明确 effort 可取值依赖模型；这里的映射表示请求意图，不能证明任意模型均接受所有值。Messages 映射依据固定 Pi 0.86.1 的现有 adaptive/budget 执行分支；不由用户给出的 Opus 名称推断具体能力。Messages 两种方式均可显式选择，不从一次拒绝自动换另一方式重试。

替代方案：按 opus/gpt 前缀复制已知定义会把型号、图片、上下文等未经确认属性一起带入；仅选择预算方式无法覆盖只接受 adaptive 的新型号；仅选择 adaptive 不能覆盖仍使用预算的兼容服务。

### 3. 使用一份解析/校验规则覆盖整条执行链路

新增 Agent 内部集中策略模块（例如 `thinking-profiles.ts`），负责按 api/SDK 定义产生目录选项、检查完整设置及生成有效执行定义，供 `run-models.ts`、`sessions.ts`、`runs.ts`、`pi-sdk-executor.ts` 使用。

```text
Chat response settings
  -> {modelRef, thinkingLevel, thinkingProfile?}
  -> Session 原子偏好
  -> Run 受理快照（含版本化 profile）
  -> 同一策略生成临时 SDK model / 请求选项
  -> Responses 或 Messages 的原连接
```

仅对显式兼容执行生成临时 `reasoning:true` 定义和完整 `thinkingLevelMap`；保持 model/provider/api/baseUrl、input、contextWindow、maxTokens 与授权配置一致。Responses 为扩展档位显式映射，Messages adaptive 设置 `forceAdaptiveThinking:true`，budget 设置 false 并传入固定 `thinkingBudgets`。SDK 初始化前就使用正确定义，不能等 SDK 把 High 夹成 Off 后才改 payload。最终 payload 检查实际 effort/预算，与既有 null、DeepSeek、图片校验 onPayload 链可组合；工具续轮保持同样规则，预算空间不足提前失败。

会话 model-only 入口必须保留 profile，与原 Thinking 一起校验；跨协议无法继续时原子拒绝。Cancel and send 等等待后再次受理的路径需重验整组。自动 Run 不读手动 profile，未知默认继续普通模式。

`AgentRunModels.credential()` 与 Core 的执行绑定比较继续只验证管理员授权的模型描述；新增用户 profile 不伪装成管理员 capabilities，也不能因为多了字段而造成凭据匹配失败。分别保存原授权描述和运行用的临时定义；已有 `capabilities` 比较及停用/换 Key 边界不得放宽。

### 4. 同步公共投影、历史与快照，不改变旧记录解释

扩展 `chat-controls.ts` 的目录、设置、Session/Run view，`work-feedback.ts` 的私有快照，`proto/agent.proto` 和 `application.ts` 的 Session/Run 投影；检查 Go contracts/agentclient/Core 转发与历史 reader 的每一个明确字段拷贝。仅 profile 标识及安全选择元数据进入公共显示，生成入口仍为 `make generate`。

历史中的供应商工具调用 ID 是不透明关联值；Responses SDK 可使用 `call_id|item_id`，不能套用内部对象 `IdentifierSchema` 的字符白名单。`HistorySegment.toolCallId` 单独接受长度 1–1024 的字符串，原样关联调用与结果，保留页大小预算及内部对象 ID 校验。TS 源与生成 Go schema 同步，读取不改写 SDK 文件或 SQL 记录，无需历史迁移。

profile 与 thinkingLevel 保存在现有 modelPreferenceJson/actualModelJson 中，无需新增 SQL 列。仍需同步 work-history 语义版本与导入校验，防止旧 reader 静默忽略新执行含义；通过已有版本协商/兼容校验拒绝不支持的写入或继续。`brain_linux.go` 的白名单仅加入合法 profile，`rebuild_linux.go` 重绑定目标模型时保留它，目标协议不符时偏好不可用。检查 work-store、snapshothelper 的对应验证和生成入口。

旧字段缺省仍为 SDK/旧 Off，null 仍为普通模式；禁止回填历史 profile。提交幂等摘要不加入当前可变偏好，重放先查既有记录；受理快照固定 profile。新旧客户端只在已协商能力内操作：新版 UI 不向旧 Agent 发兼容字段；旧请求尝试改写已有兼容偏好而不能表达完整设置时，要求新版入口明确处理，不能丢掉 profile 后返回成功。

### 5. 在现有 Thinking 列表选择完整值

Response settings 保留 Model/Thinking 两行。未知 Responses 展示 Normal 和“兼容推理”档位组；未知 Messages 展示 Normal、自适应兼容、预算兼容分组，可在同一面板展开。浏览分组不保存，点击具体档位一次提交完整 profile+level；不增加必须先保存模式的中间状态或管理员页面。

适用组件是现有局部设置面板内的单值选择，沿用组件规范中的 Select/Listbox 与焦点语义，不另加确认弹窗。选择值等同性、串行保存、草稿、未知结果核对、跨 Session 晚响应隔离都包括 profile。摘要例如“兼容 · High”，Messages 在面板/详情明确方式；预算选项显示数值。中英文均保持简短，说明只出现在相关设置/结果中，不在产品流程展示协议字段名或 SDK 内部实现。

### 6. 使用受控失败及真实 SDK 请求验收

兼容请求被 400/422 拒绝时，沿现有错误清洗层提供安全说明“模型服务拒绝了请求，可检查兼容推理设置”，不能仅凭状态码断言一定是推理不支持。保留原 HTTP 类别或现有安全错误机制，认证/权限分类保持独立；不透传供应商正文，不触发平台退出。参数拒绝不自动重试为另一档位/方式，既有合法网络重试也不得改变参数。

主要验收使用 `model-providers.test.ts` 真实 SDK + 合成本地网关，以及 `internal/coreapp/model_providers_integration_test.go` 的真实 Core/Agent 链路。使用保证未收录的合成 ID、任意不含品牌的别名，并把 `opus-5-5` 作为未知别名用例而非真实能力证明。检查请求体而非只断言下拉或保存成功；覆盖工具续轮、Off/null、拒绝无变参重发、SDK 已知模型和既有 DeepSeek 映射回归。

## Risks / Trade-offs

- [远端只支持部分档位或特定 Messages 方式] → 用户显式请求，清楚标兼容，失败保留原设置并允许手动恢复；不承诺兼容参数能赋予模型新能力。
- [SDK 内部夹限或扩展修改 payload] → 初始化及最终外发均核对同一受理快照；用真实 SDK 请求捕获测试覆盖扩展档位和工具续轮。
- [未知模型容量并非官方能力] → 保留现有基础定义，预算限于既有上限，空间不足失败；不借本变更扩大容量或图片支持。
- [严格 DTO/历史 reader 遗漏字段] → 更新全部投影及生成产物，增加跨语言、重启和快照往返契约测试，不仅测试 Agent 内存状态。
- [旧 Agent/客户端无法理解 profile] → 明确版本门禁，不假装保存成功或把兼容值投影为普通/SDK 值。

## Schema 7 与版本升级

schema 7 删除 Session 的 active_context_identity 列，Run 的 context_identity 保留为受理事实。Memory 仍为 schema 1。旧 4/5/6 保留精确静态 reader 和导入，不作为新运行格式。受管 Apply 在完整备份后一次转换到 7：4 的 Memory 迁移在同一事务中创建当前结构，5/6 核验精确旧结构和 Memory 所有权后事务删除 Session 环境列并写入 7。失败通过既有备份恢复；重复初始化对已升级 7 只核验，不重做转换。旧镜像不能打开 7。不存在按镜像或 Session 创建版本选择的运行分支。

## Migration Plan

1. 实现契约、集中策略、历史及 UI，使用现有入口同步生成代码和嵌入资源；不改管理员 registry 配置，不迁移旧偏好含义。
2. 在独立测试安装构建同版 Core/CLI、Agent/helper，执行合成网关和浏览器验证。用户手动选择才启用兼容设置，旧安装/旧 Agent 保留原能力。
3. 需要新 Agent 的现有 Work 沿原更新/Apply 流程显式升级，不由浏览器自动替换容器。此处描述实现后的升级路径，不授权本轮发行或对外推送。
4. 回滚前停止测试/目标 Work 并保留完整配套备份；新版本写入的兼容历史不让旧 reader 忽略后继续，旧二进制仅恢复其配套备份。不得通过删除 profile、改写 Run 或重新执行来迁就回滚。

## 会话默认选择的恢复修正

首次进入/刷新且没有明确恢复选择时，先只读核对原默认用户会话的 chat-options，不可继续时按最近创建顺序查找发送资格明确 available 的会话；Service 会话不参与默认候选。显式选择的旧会话保持可读。发送资格单独保存在页面状态，历史快照中的模型 availability 不覆盖它；查询失败保持未确认。旧 Agent 缺少此能力时沿用原默认。现有接口合并环境与设置不可用，因此说明两种可能并提供 Sessions 入口，不伪称已确认模型失效或泄露内部 context。

schema 7 的发送资格按当前 Work 准入和完整模型设置核对，Session 创建时环境不参与判断。默认选择逻辑负责读取和恢复可用选择，不承担历史升级或原会话续聊修复；用户显式选择的会话不能被它自动切走。旧 Agent 的创建环境限制只描述旧运行行为，采用新 Agent 后按下述统一生命周期继续原 Session。

## 会话与执行环境分离（替代旧 context mismatch 继续约束）

Session 仅表示某 Work 的持续对话和稳定 SDK history，不保存活跃环境身份。Run 在受理事务前由当前 ready Agent 固定 active context，并由数据库原样保存；已接受 Run 和幂等重放使用原快照，设置读取/修改与历史读取不因 Session 创建时间拒绝。Apply 继续受单槽、代次和当前运行权限约束。资源加载器和工具来自该 Run 所在 active context，历史消息不能恢复旧工具权限。

schema 7 移除 sessions.active_context_identity，保留 runs.context_identity。旧 4/5/6 的 Session 环境列仅用于旧格式静态校验、导入映射与受管升级，升级后无运行分支；旧 Run 环境保持，导入按 Work-owned context 映射。保留既有历史版本静态读取以保护完整包，拒绝旧镜像写新格式。升级使用既有 Apply 备份/恢复边界，不直接修改预览数据。

已受理但未落 SDK 的图片输入按 Work、Session、Run 归属及 promptDigest 验证，作为同一对话上下文恢复；历史 Run 环境与当前不同不表示图片损坏，不重放旧模型或工具。取消后发送在等待前后核对当前代次/context 和完整设置，新 Run 固定二次准入时环境。

前述 5.4/5.5 的只读会话和默认切换是已发生的临时处理，不构成本修正完成标准。本轮以原 Session ID 跨升级继续为准。
