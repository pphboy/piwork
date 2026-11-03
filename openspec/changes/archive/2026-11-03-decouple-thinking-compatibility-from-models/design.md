# Design

## Context

动机和范围见 [proposal.md](proposal.md)。本次基于现行源码及 AIM-006、CONV-MODEL-001、CONV-THINKING-COMPAT-001、DWUI-MODEL-001 的有效契约规划；规格增量将原先“只向未知模型开放兼容”的边界改为按协议提供。

| 位置 | 当前实现及本次需要处理的限制 |
| --- | --- |
| `apps/agentd/src/thinking-profiles.ts` | 已有三个版本化 profile；`validThinkingSelection()` 只允许 SDK 档位为空或保留旧 profile 时使用兼容方式 |
| `apps/agentd/src/run-models.ts` | 只有 `defaultThinkingLevel === null` 时发布兼容选项；目录全为 SDK 已知模型时回落 contract 1 |
| `packages/contracts/src/chat-controls.ts` | contract 4 的已知模型是严格结构，不能同时携带 `compatibleThinkingProfiles`；现有 `thinkingProfile` 与档位已足够表示新选择 |
| `apps/agentd/src/sessions.ts`、`runs.ts` | 保存用 `retain` 特例放行旧兼容偏好；受理与停止后发送仍读取 SDK 档位并校验，需分开处理 SDK 模式和兼容模式 |
| `apps/agentd/src/pi-sdk-executor.ts` | 已能为 profile 构造临时 reasoning 定义、档位映射、预算并检查最终请求；但 DeepSeek Messages 专用 payload 转换会再次改写 `thinking.type` 等字段 |
| `apps/desktop-webui/src/{app,adapter}.ts` | 兼容列表嵌在 unknown 分支内；SDK 只有 Off 时整个 Thinking 入口可能禁用；能力识别只接受 0–4 |
| `internal/agentclient/`、`internal/coreapp/conversation.go` | 可选能力及控制路由显式识别 1–4，模型列表还有生成 schema 校验 |

固定依赖和锁文件使用 Pi 0.86.1；已有真实 SDK 合成网关测试覆盖三种 profile，且验证过已保存 profile 在 SDK 后续收录型号后仍能执行。新行为需要放开首次选择和目录展示，并补全已知模型的执行回归，不以更新依赖代替兼容层。

探索阶段的线上只读观察另显示：目标 Work 当时报告 chat contract 3，未知默认模型没有兼容目录。这证明该运行实例尚未声明现有兼容能力，不能证明源码中的兼容实现被删除；初始探索不假定其具体 SDK 版本；用户后续明确要求本机实际交付，部署及页面验证归属追加任务 5／6。

## Goals / Non-Goals

**Goals:**

- 将“SDK 对模型的能力资料”和“Piwork 按协议能构造的兼容请求”作为两种独立信息；合法兼容设置不再读取 SDK 档位作为准入依据。
- 保留 SDK 模式的默认、能力事实和原映射，并让显式兼容设置从展示到实际外发具有一致含义。
- 以可选契约升级表达新目录，复用 profile 和历史结构，保持旧 Agent 原能力及既有 Session/Run 的含义。

**Non-Goals:**

- 不增加 Chat Completions、供应商品牌专用协议、自由输入等级、任意 JSON、模型探测或模型名称白名单。
- 不声称任何模型都接受所有兼容参数，不新增未来等级，也不修改现有 `*-v1` 映射。
- 不给 SDK 已知模型额外增加普通 null 模式，不改变 Work 默认、自动 Run 或子 Agent 的原设置语义。
- 不升级 SDK、扩张上下文/图片能力、重写历史、增加管理员设置或重做聊天界面；不执行外部发布，用户授权的本机入口更新按任务 5／6 执行。

## Decisions

### 1. 协议定义始终可用，SDK 资料只约束 SDK 模式

继续以 `thinkingApi()` 解析的连接 API 查询 `THINKING_PROFILES`。显式 api 优先，旧记录缺少 api 时沿用现有 provider 回退；不能以显示名称、Model ID 或端点猜测兼容等级。

| API | Profile | 固定等级／映射 |
| --- | --- | --- |
| `openai-responses` | `responses-effort-v1` | Off → `none`；Minimal、Low、Medium、High、XHigh、Max → 对应小写 `reasoning.effort` |
| `anthropic-messages` | `messages-adaptive-v1` | Off → `thinking.type=disabled`；Low、Medium、High、XHigh、Max → `adaptive` 和对应 `output_config.effort` |
| `anthropic-messages` | `messages-budget-v1` | Off → `disabled`；Minimal、Low、Medium、High → `enabled` 和 1024、2048、4096、6144 token 预算 |

Off 不带矛盾的 effort／预算；未知模型的普通 null 设置仍删除额外推理字段。预算值沿用既有 profile，实际输出空间必须留足预算与至少 1024 正文 tokens，不缩减预算、不扩大模型容量。

兼容校验只检查支持的 API、profile、非空合法等级及原模型执行准入，不要求 SDK 档位为空，也不要求旧偏好已有 profile。`allowSavedProfile`／`retain` 不再作为新兼容设置的必要例外。SDK 模式继续按真实 SDK 档位校验；无 profile 的非法 SDK 等级仍拒绝，不能借新增兼容目录隐式放行。

目录查询和保存／受理要先区分这两条路径：兼容设置不应为了取得无关 SDK 等级而被能力查询错误挡住；真正无法构造所选协议执行定义、无授权或无凭据仍按原准入失败。沿用同一 helper 进行保存、普通提交和停止后发送的二次校验，避免各处重新推断条件。

替代方案：向 SDK 的 `thinkingLevels` 填入通用值会伪造能力；只删除界面条件仍会被保存校验阻断；仅保留已有 profile 特例无法支持新 Session 的首次选择。

### 2. 使用 chat contract 5 表达新目录，保持旧版本读取

在 `chat-controls.ts` 新增独立的 v5 模型及列表结构：SDK 已知模型保留非空 `thinkingLevels` 与建议值，未知模型保留 unknown／空列表／null；两种支持协议的合法模型均附带后端生成的 `compatibleThinkingProfiles`。生产目录不因全部型号已知而回落 contract 1，默认模型独自可用时也必须保留兼容方式。

保留现有 v1–v4 结构及解释，扩展 Readiness、`ChatCapabilitiesSchema`、Go Agent client、Core 控制路由和 Desktop 的版本识别到 5。protobuf 的版本字段和既有 profile 字段可复用，不增加新 wire 字段；按 `make generate` 同步受影响的 Go DTO/schema 和相关生成物。Cancel and send、图片及分页历史各自的可选能力版本不随之改变。

新版 Desktop 对 v4 只使用目录实际声明的兼容方式，继续支持未知模型和合法旧偏好，不臆造已知模型的新选择；v0–v3 沿用原聊天／SDK／普通能力。缺少用户所需兼容能力时提示更新 Work Agent，而不是让用户更新模型目录、改名或重新配置管理员能力。未知未来版本不能通过数值大小直接当作已支持。旧 Core／客户端不理解新版可选契约时继续原基础聊天能力，不承诺旧客户端能编辑新兼容选择。

替代方案：原地扩大 v4 的严格已知模型对象会改变旧 schema 的解释，跨语言校验和客户端行为不一致；增加另一套平行能力发现机制会重复现有版本协商。

### 3. 兼容 profile 是实际请求的映射来源

```text
Connection API --> versioned profiles --> available compatible choices
SDK catalog   --> SDK facts          --> existing SDK choices/default
                                  |
                                  v
          {modelRef, thinkingLevel, thinkingProfile?}
                                  |
                                  v
                   atomic Session preference
                                  |
                                  v
                      accepted Run snapshot
                                  |
                                  v
              selected mapping --> actual SDK request
```

复用现有临时模型定义，让显式 profile 在 SDK Session 初始化前就获得 `reasoning:true`、完整 `thinkingLevelMap`、选定 adaptive 标记及预算设置；不改持久模型目录，不替换模型、连接或凭据，不覆盖 input、contextWindow、maxTokens 等其他能力。

模型专用 Thinking 转换只用于无 profile 的原 SDK 路径。当前 `isDeepSeekAnthropicEndpoint()` 触发的 `deepSeekThinkingPayload()` 会把 adaptive／budget 改成另一种请求，显式 profile 时必须跳过该 Thinking 改写；无 profile 的既有 DeepSeek 行为保持。其他安全／包扩展／图片 payload 链继续组合，最终断言检查所选方式和精确等级／预算，首轮、合法网络重试及工具续轮保持一致；矛盾参数在外发前失败，不把错误请求发给服务端再纠正。

服务拒绝沿现有安全模型错误处理形成原 Run 的可查失败，保留 profile 和输入。不自动改方式、降档或删除参数重发，成功也不把兼容选择转为 SDK 认证能力。

替代方案：只在 payload 最后补字段无法保证 SDK 初始化未提前夹限等级；继续运行模型专用转换会让相同 profile 随模型改变含义。

### 4. 单份 Thinking 等级列表，内部保留请求映射

用户纠正了此前的多组来源展示：界面只显示 Normal、Off、Minimal、Low、Medium、High、Extra high、Max 等由后端实际声明的等级，每个值只出现一次。选项、Composer 和 Run 详情不展示 Compatible、SDK 来源、Adaptive、Budget、token 预算或能力未确认说明；真正的加载、保存和服务拒绝仍有正常反馈。

使用一个纯 `thinking-options.ts` 模块归一现有后端目录，供渲染和设置写入共同消费。已有 contract 4／5 的 SDK 档位及 profile 元数据保持原格式：同级优先采用 SDK 已声明映射，其余按后端 profile 顺序取首个声明；当前协议定义的 Messages 顺序是自适应、预算，因此 Minimal 由预算提供，其他缺失等级使用自适应。前端只合并已经声明的值，不猜测模型名称、协议能力或新增等级。无需新增 API 版本或重复迁移 Agent。

同一等级若当前完整设置有效且已保存其他合法 profile，重复选择该等级保留原 profile 且不产生 PATCH；旧偏好不可用或缺少有效映射时，同等级确认按当前目录真正保存有效映射，不能仅比较等级文字。保存中的相同有效选择继续合并，不发送重复请求。切换模型后需要确认时，只有目标目录声明该 profile 才保留，否则采用目标的唯一映射。显式选择另一个等级使用归一选项的映射，保存／发送仍协调完整三元组，不修改已接受 Run 或历史。

未知模型的 Normal 继续表示未追加推理参数，Off 继续请求关闭，二者没有合并；SDK 已知模型仍保留原默认语义。界面把内部映射隐藏，不把任何一次成功当作模型能力认证。内部 profile 继续用于持久化、校验、实际请求和旧记录读取。

替代方案：只去掉 Compatible 字样仍会重复；按标签随意去重会让请求映射取决于渲染顺序或覆盖旧偏好；新增版本化协议字段对这次展示与归一修正并非必要。

### 5. 复用历史格式，以真实请求验证解耦

`thinkingProfile`／`thinkingLevel` 已持久化于 Session 与 Run 模型 JSON。当前 TS/Go history reader 已按 profile、API 和等级组合验证，没有依赖当前 SDK 型号名单；本次不新增字段、SQL schema 或 profile 版本，继续 history schema 7、Memory schema 1 及原静态历史兼容规则。

在现有测试上增加两种协议的已知／未知／SDK 仅 Off 矩阵，特别覆盖新 Session 首次兼容选择、SDK 未列出的 XHigh／Max、Messages 两种方式及模型专用转换冲突。使用固定 Pi 0.86.1 和合成网关捕获实际请求，不使用生产 Key；对 Off、Normal、工具续轮、预算不足、拒绝不变参重发、重放和自动 Run 做回归。

跨语言契约校验 v5 的已知模型同时包含两类选项，旧 v4 严格样本继续通过；非法版本、错误 profile／协议和无 profile 越界等级仍拒绝。Core/Agent 集成核对原 Session 续聊、重启以及 stopped 完整包冷导入后 profile 原样保留。Playwright 验证现有选择器、真实受控请求和恢复，桌面 1920×1080、移动 390×844，并补现行规格要求的 360px 可达性；中英文文案沿既有测试入口验证。

## Risks / Trade-offs

- [服务端并不接受全部兼容等级] → 选项明确为请求意图；按真实结果失败，保留设置，用户明确调整，不自动探测或重发。
- [已知型号的 SDK 或专用适配仍改变请求] → 初始化和最终 payload 双重核对，以 known／Off-only 真实 SDK 网关用例验证，特别覆盖 DeepSeek 原映射与兼容映射隔离。
- [contract 5 漏更新版本判断或严格生成 schema] → 契约、Go client/Core、Desktop 同步变更，检索所有显式 0–4 判断并增加新旧版本矩阵；可选版本不改变强制 readiness。
- [旧 Agent 仍只提供 v3／v4] → 新界面保留其原能力并准确提示；一次更新运行器以获得兼容执行能力，与持续追赶 SDK 模型目录是两件事。
- [保存来源被同等级等同性比较吞掉] → 比较完整三元组，覆盖同级保留旧映射、快速选择及晚响应测试。

## Migration Plan

1. 实现契约、Agent、Core 与 Desktop 后同步生成物及嵌入资源，在独立安装和合成网关完成验证。此步不调整依赖、当前发行引用或线上 Work。
2. 由后续部署／升级指令采用同版 Core/CLI、Agent；现有 Work 通过原受管更新与显式 Apply 获取新版 Agent。复用既有备份和历史升级机制，本次不额外迁移 Session 数据，不回填或改变 Thinking 设置。
3. 首次使用新版已知模型兼容选择由用户明确操作。验证当前实例实际声明 contract 5，原 Session 可读且设置与真实请求一致，不能用浏览器版本代替运行器能力证明。
4. 回退沿原配套数据／镜像和备份边界处理；既有 v4 reader 能表达旧 profile 并不代表所有旧版本可写新版设置。遇到不支持的运行器保留历史并明确拒绝相关修改，不剥除 profile、改写 Run 或重放执行以迁就回退。


## 验证 WARN 的收口

等级与内部映射逻辑适用于工作台既有布局。原工作分支保留组合摘要及双行面板，实际部署基底 e8fe7a6 使用分别触发的轻量列表；此变更不再要求某一种布局，二者共用同一等级去重与原子保存语义。预算只按内部 profile 定义保存和请求，不由界面展示数值声明。
