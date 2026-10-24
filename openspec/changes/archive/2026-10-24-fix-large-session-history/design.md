# Design

## Context

动机见 [proposal.md](proposal.md)。本方案对应 `agent-conversation` 的 CONV-HISTORY-*、`desktop-webui` 的 DWUI-HISTORY-* 与 `control-cli` 的 CLI-HISTORY-* 增量。

源码确认的边界如下；用户提供的 454 条消息、235 次工具调用及 93% 工具结果占比是问题样本描述，本次规划没有读取该私有会话或完成运行复现。

| 当前入口 | 与本问题有关的实现事实 |
| --- | --- |
| `internal/client/http.go` | `Request` 对所有 JSON 正文应用 1 MiB 限制，超限及不完整响应共用 `MALFORMED_RESPONSE`。 |
| `internal/cli/user_desktop_control.go`、`hosted_desktop.go` | 独立 Desktop 和托管工作台均通过共用客户端读取完整 Session。 |
| `internal/coreapp/conversation.go`、`internal/agentclient/client.go` | Session 一次返回全部消息与 Run；ReadSession 沿用 gRPC 默认 4 MiB 接收限制。 |
| `apps/agentd/src/application.ts` | gRPC 服务发送上限为 6 MiB；读取时生成所有消息、扫描所有已列出 Run 的事件，并同时返回文本、内容块及 Run.finalText。 |
| `packages/work-store/src/store.ts` | `listSessionRuns` 固定 `LIMIT 1000`，`readEvents` 默认一批 1000；现有历史归属推导未遍历后续事件批次。 |
| `packages/pi-adapter/src/session-persistence.ts`、`tool-preview.ts` | SDK 消息树、祖先 Run 标记、安全正文和 64 KiB UTF-8 工具预览已经存在，需复用语义。 |
| `apps/desktop-webui/src/adapter.ts` | loadSession、完成刷新、图片补读、原键恢复、recoverRunHistory 仍会整份读取；chat-projection 当前重建整个数组。 |
| `internal/coreapp/conversation_watch.go`、`internal/cli/user_desktop_events.go` | 观察有 1 MiB 有界缓冲/单事件保护，Desktop 单连接最多转发 16 MiB；终态事件和 GetRun 又携带完整 finalText。 |

## Goals / Non-Goals

**Goals:**

- 历史总量不再决定任何一跳的单次响应大小；同一次交付完成源头分页、客户端消费和恢复路径切换。
- 正常长历史和超大单条公开正文都可完整读取，同时保留单页、单事件、连接缓冲和授权保护。
- 复用 SDK 历史语义、公开安全投影、既有 UI 阅读锚点及 CLI 输出，不用清空会话或重新执行来恢复。

**Non-Goals:**

- 不提供临时放大通用 JSON/gRPC 上限的交付阶段，不通过降低工具预览上限解决总量问题。
- 不改 SDK 私有历史格式、Work history schema 5/已知 schema 4 导入、`.work` 格式及模型上下文压缩策略。
- 不新增原始工具全文公开能力、历史搜索、跨页永久缓存、后台预取全部会话或全量 UI 虚拟化项目。
- 不改全局 Session/Work 列表；仅改本历史通道依赖的 Run/事件遍历。不自动升级现有 Work 镜像或推送发行。

## Decisions

### 1. 源头分页，保留旧接口

新增独立 `session-history-v1` 能力与 `ReadSessionPage` RPC，HTTP 入口为 `GET /api/v1/works/<workId>/sessions/<sessionId>/history`，Desktop 使用同路径结构的 `/_desktop/api/` 入口。独立能力查询使用 `GET .../works/<workId>/history-capabilities`，返回版本及固定预算，不绑到 Thinking 的 chat contract 3。

请求只允许 `direction=older|newer`、`limit`、`cursor`、可选 `runId`、可选 `content=messages|runs|result`、可选 `snapshot` 和已支持的 `imageProfile`。无游标的 older 从最新内容开始，无游标的 newer 从最早开始；有游标时方向和过滤条件必须与游标绑定范围一致。`content=result` 必须指定并核验同一 Session 的 Run，供大最终结果引用读取。`snapshot` 只接受本入口发出的有效句柄，使 CLI 的消息、全部 Run 元数据及结果引用绑定同一快照；`content=runs` 独立分页，覆盖尚无 SDK 消息的已接受 Run。

响应包含 `contractVersion`、安全 `session` 元数据、`snapshotId`、有序 `segments`、当前页所需 `runs` 摘要、`nextCursor`、`hasMore`；页内一律按历史正序排列。`content=runs` 的 limit 限制 Run 数量并应用相同编码预算。空历史返回已确认的空集合；预算不足不能返回不推进的空页。游标重放允许返回同页，客户端根据页与分片身份去重。

```text
SDK JSONL + WorkStore
         |
         v
agentd: scoped snapshot + bounded page
         |
         | ReadSessionPage (bounded protobuf)
         v
Core: owner/generation check + bounded JSON
         |
         +--> Desktop / hosted backend --> shared UI page reader
         |
         +--> CLI page reader --> private spool --> complete output
```

选择分页是因为它同时解决首屏、失败重试与按需阅读。完整 JSON/NDJSON 流仍传输全部内容，只改代理也不能消除旧整份 gRPC 的边界；本变更不另建全量流导出协议。

### 2. 按实际编码预算装页，并允许同一消息跨页

公共常量统一定义并生成到 Go/TS：默认最多 50 条不同逻辑消息、可请求 1–100 条；最终 HTTP JSON 正文不超过 512 KiB；新增 RPC 的 protobuf 编码不超过 1 MiB，Core 对该 RPC 显式应用对应接收保护；单段正文最多 32 KiB UTF-8。既有全局 gRPC/JSON 和图片专用预算保持各自职责。

`segment` 由逻辑 `entryId`、role、可确认的 runId、稳定 blockId/blockIndex、内容类型和类型元数据构成。文字内容另带 `byteOffset`、`totalBytes`、`text` 及完成描述；工具结果的 kind/truncated/isError 与调用身份保留，图片只带原有描述。空正文与非文字块有明确表示。分片边界不切断 UTF-8；offset/total 使用跨语言可精确表达的整数。

装页先生成安全片段，再按候选页的真实 JSON 和 protobuf 编码核算，包含所有 envelope、摘要、游标和转义；必要时减少片段或缩短文本，返回位置指向下一未读字节。以 Go 的 HTTP 编码转义行为作为最终 JSON 标准，TS 使用相同规则预算，Core 在写响应头前再次验证；不能按 32 KiB 原文字节推定实际响应一定合规。任何固定 envelope 违反自身有界契约时明确拒绝，不循环返回空页。

新页不同时返回 `message.text` 和重复的 text/result block。64 KiB 工具预览按现行方法先生成，随后也可跨页传输；“预览被原契约截断”和“还有分片未读”使用独立字段。CLI 在本地重建旧输出需要的重复字段，不在网络上重复传输它们。

`content=result` 只返回匹配 SDK 最终消息的文本块时，仍沿用该消息原有的 `blockId`、`blockIndex` 和 `blockCount`；筛选范围不重新编号或改变同一消息的块结构。结果页自身的游标按筛选后的文本遍历，客户端按原始块身份与已读消息范围合并。

匹配 SDK 结果必须存在真实公开文本块，文本块内容可以为空。仅工具、仅非公开内容或空内容数组不因拼接文本与持久结果同为空就认作 SDK 文本结果；此时复用该 Run 的独立持久结果项，零字节正文仍有明确完成分片。不能向原 SDK 消息另加 `empty` 块，也不改变原工具或其他公开块的完整状态。

### 3. 冻结源边界，使用受范围约束的游标

agentd 为一次遍历创建轻量快照记录，固定已提交 SDK 文件边界、消息顺序、读取时的 Run 元数据与尚未写入 SDK 的已接受输入的公开投影。快照不持有整份 SDK 正文或图片 Base64，不持有跨请求数据库事务。游标是不可猜测的服务端快照/位置句柄，绑定 Work、Session、profile、Run/content 范围、方向、块和字节位置；客户端不能传入路径或内部身份。

快照记录及派生索引受内存/数量和空闲期限约束，淘汰时返回明确 `HISTORY_CURSOR_EXPIRED`。同一有效游标重试不消费位置；daemon 替换、文件替换/截断、快照淘汰可使旧游标失效，重新开启快照可继续读取原历史。正常追加不使旧快照失效。每页由 Core 重新授权并检查实际代次，游标持有并不授予权限。

`pi-adapter` 增加只读定位索引，冷读允许扫描一次 SDK 文件，保存 entry/parent/Run 与文件偏移等派生信息，随后按页解析相关 entry，正常追加增量更新。保留现有 getEntries 的全历史顺序、祖先 Run 标记、安全文本和旧历史语义，不擅自仅展示当前分支。完整行损坏明确失败；并发追加未提交的尾部不能被解析成完整消息。不让每一页重新构建全部公开正文与所有 Run.finalText；冷扫描及单条源记录解析成本不等于传输页预算，不承诺无限存储或恒定冷启动时间。

WorkStore 为该通道增加按稳定键分批读取的 Run/事件查询，避免 `SELECT * ... LIMIT 1000` 成为总量上限；大结果列按实际需要取得。旧无 Run 标记历史的工具归属仍按可靠事件证据解析，必须遍历必要批次，未知保持未知。

已接受图文输入和后续 SDK 用户消息使用同一可确认 Run 下的逻辑用户身份与图片索引；SDK entryId 保留为来源映射，不使同一用户消息因落盘换 ID。其他消息按 SDK entry/block 身份定位；工具合并使用同一 Work/Session/Run/toolCallId。跨快照合并不按同名工具、相似时间或全局文字相等推断身份。

### 4. 配套 Run 摘要与事件 profile，完整结果复用历史通道

新增 `history-v1` 响应 profile：Run 查询、活跃 Run、取消、受理/幂等重放、原键查询及 WatchRun 在明确声明该 profile 时返回 `RunSummary`，含真实状态、原身份、模型/Thinking/来源、时间和事件序号，以及 `resultRef`；HTTP 不伪造 `finalText:""`。未声明的旧请求和原 RPC 字段语义保持。

结果引用绑定同一 Session/Run 的 `content=result` 分页范围，不接受任意 URL/路径。SDK 中可靠关联的最终消息可直接作为结果内容来源；只有持久 Run 结果而没有对应 SDK 消息时，提供该 Run 的稳定结果项。UI 依赖明确的消息/结果归属合并，不能把正文相等的其他轮回复当成该 Run 的最终结果。完整 CLI 输出需要的 Run.finalText 从引用分片重建。

当本页已经确认 SDK 最终消息与持久结果的对应关系时，利用 `resultRef.entryId` 明确提供该结果的消息目标。UI 只依据同一 Run 的明确目标关联保留的持久结果项；替代消息正文未完整时继续显示已加载表示，完整后切换为 SDK 表示。旧快照的持久结果项不得覆盖已确认的 SDK 目标，同字正文的其他消息仍保留。原提交键恢复即使能力缓存被实例切换清除，也须在原键查询前重新协商，协商期间继续执行身份和原提交意图校验。

新 WatchRun profile 在 agentd 序列化之前移除终态中的整份 finalText，返回有界状态及 resultRef。极大的已保留文本事件按同一 sequence 的多个有界分片帧返回，携带字节位置与完成标志；分片帧也应用编码预算。客户端仅在原事件全部分片验证后推进事件游标，不能制造额外持久事件序号。断开时从最后完整 sequence 恢复，部分帧重放按范围去重，不丢失尚未写入 SDK 的原事件正文。工具结果沿用既有有界预览。Core 观察预检和 Desktop 本地事件预检也使用摘要，避免在连接事件之前通过旧 GetRun 失败。

保留既有慢观察者缓冲。Desktop 的 16 MiB 单连接窗口可以继续有界结束，新客户端从最后确认 sequence 恢复或读取历史；累计窗口不是 Run/Session 总量上限。profile 是响应表示，不参与 prompt digest、提交幂等内容或 Session 配置。

### 5. UI 共享范围读取器，合并而不替换全部数组

在 `adapter.ts` 建立按 identity epoch、Work、Session、运行实例及 profile 绑定的读取状态：最近页、older cursor、加载/错误、快照与已读片段范围；在 `chat-projection.ts` 建立可重复调用的分片/工具合并器。重复分片不得追加文字；重叠分片字节冲突明确失败；正文区间存在缺口时不伪装完整 Markdown。

首屏只请求最近页，不自动追 nextCursor。顶部使用现有按钮/等待/局部错误样式提供 Load earlier messages；若页边界切开一条大消息，标明未完整加载并允许加载其余部分。读取更多保持 `app.ts` 已有消息锚点与展开键，只有原本在底部或显式跳到最新才跟随事件。

首次打开、Session 切换、图片补读、完成刷新、原键恢复和 410 恢复统一进入该读取器。完成或 410 恢复使用原 Run 范围，优先拉取尚未取得的内容并保留其他已读消息；运行中已有范围发生补齐时用新快照按稳定身份更新，不能清空整个 Session 或反复从最早页扫描无关历史。状态先到不代表正文恢复完成；结果引用全部读完后才确认完整恢复并停止终态观察。

切换身份/对象时取消相应请求并校验 epoch；权限失效按既有内容清理规则处理。游标失效保留已读范围与锚点，显式只读恢复时从新最近快照建立边界；正在阅读的旧范围继续保留并标明需重新确认，不自动跳走或补拉整份历史。

### 6. CLI 完整输出使用私有暂存，错误保持可恢复

`session show` 使用 newer 方向固定快照并遍历全部 messages、runs 范围及结果引用，重建旧 `session/messages/runs` 形状；全部 Run 范围独立遍历，不能只收集消息页附带的摘要。创建本次私有临时目录与 0600 分片/输出文件，逐页校验与拼装；所有页和引用完成后才把一个完整 JSON 值复制到 stdout。暂存可保存重复的旧字段表示，客户端不在内存同时持有全部历史正文。文本模式复用相同完整结果。

消息范围显式携带既有 `chat-images-v1` profile，遍历各页保留公开图片描述，不读取图片原始字节。旧 Agent 的能力限制在 UI 局部状态及 CLI stderr 表达，并说明更新 Core/CLI 与显式 Apply 兼容 Agent 的方向；成功的旧小历史输出形状不变，失败不反复请求旧整份接口。

兼容提示复用工作台既有弱化说明文字样式，以 `small` 和 `role=status` 提供持久状态，位于消息滚动区外，不新增模态、操作锁或瞬时提示，也不混入模型/Thinking 状态。会话创建原键查询只返回 Session 元数据，保持原读取行为；只有可能返回大 Run 结果的原键恢复需协商历史 profile。旧 Agent 在 410 恢复中遇到容量或能力限制时停止自动整份读取，保留已读内容与原 Run，并提供显式更新方向。

事件连接建立前的非 410 预检失败也保留原安全错误码；旧 Agent 的容量或能力错误与 410 保存历史恢复采用相同停止规则，不因错误被转换为普通连接失败而继续退避重试。临时网络或服务不可用错误仍按原 Run 重连，读取失败不修改 Run 执行状态。

中途失败、游标失效或中断不发布暂存 JSON，结束本次遍历，清理本次文件并在 stderr 提供原 Work/Session/Run 的只读恢复指引。Ctrl+C 结束历史读取 exit 130，不触发 CancelRun；chat/watch 的既有显式取消操作保留。已开始最终 stdout 复制后遇到管道断开只能按写失败结束，不能承诺下游得到完整字节。

Run show、chat/watch 的完成确认及取消回读采用同一摘要/结果读取 helper，保持各命令既有机器输出与终态/取消语义。默认 HTTP 客户端仍保护其他 JSON 路由，新增页也受同一保护。错误拆分为 `RESPONSE_TOO_LARGE`、`RESPONSE_INCOMPLETE`、非法 JSON 的 `MALFORMED_RESPONSE`；历史参数错误、能力不支持和游标失效分别映射安全的 400、501、410。客户端超时和网络错误仍沿用现有恢复边界，不自动重放业务请求。

### 7. 兼容与模块职责

旧 Agent 的能力查询返回不支持，新客户端可保留旧小会话基本读取；旧路径失败时停止并说明需更新运行环境，不用扩大预算或无限重试冒充修复。新版 Core、CLI、Agent 和嵌入 UI 是同次实现的交付组成；既有 Work 使用固定 Agent，需用户通过已有运行环境更新流程采用新能力。读取旧 context 的历史仍允许，续聊资格不自动改变。

| 模块 | 修改职责 |
| --- | --- |
| `proto/agent.proto`、`packages/contracts/src/` | 独立能力、页/分片、摘要与 profile、错误契约；生成字段与跨语言 golden。 |
| `packages/pi-adapter/`、`packages/work-store/` | SDK 定位/安全投影与无静默截断的范围查询，不改变私有格式。 |
| `apps/agentd/src/sessions.ts`、`application.ts` | 快照、游标、编码预算、结果引用与序列化前的轻量观察。 |
| `internal/agentclient/`、`internal/coreapp/conversation*.go` | 明确单页 RPC 保护、范围/归属验证、HTTP 路由与事件预检。 |
| `internal/client/`、`internal/cli/user_conversation.go` | 页读取、明确错误、私有暂存与兼容输出。 |
| `internal/cli/user_desktop_control.go`、`user_desktop_events.go`、`hosted_desktop.go` | 只开放已定义查询/profile，保留 identity guard 与托管浏览器边界。 |
| `apps/desktop-webui/src/{adapter,chat-projection,models,app}.ts` | 按需读取、分片合并、阅读锚点与所有恢复入口切换。 |
| 现有构建/生成入口 | `make generate`、WebUI 静态资源同步及 Core/CLI 重建，必要源码与生成物同行交付。 |

## Risks / Trade-offs

- [JSON/protobuf 编码与 Go HTML 转义开销不同] → 使用实际编码装页与跨语言极端字符夹具，Core 写头前复核，不放宽总预算。
- [私有输入释放、SDK 保存与 Run 终态并发] → 冻结公开投影、保持逻辑身份、使用范围/内容版本合并，分别验证已保存正文与终态。
- [游标和索引可能因重启/资源压力失效] → 快照状态有界且可重建，明确 410；不承诺旧游标跨进程恢复，不丢失持久历史。
- [冷索引扫描和单条源记录解析仍有成本] → 记录实际冷/热请求与扫描次数，只按页公开投影，避免每页重扫全文；容量测试不声称无限资源。
- [旧工具关联依赖保留事件，跨页补读可能晚到] → 查询批次不成为总上限，缺证据保持未知，已确认结果不被晚到开始覆盖。
- [CLI 完整兼容输出需要本机磁盘] → 私有暂存、页级处理、失败退出和精确清理；不将暂存上传或写入长期状态。
- [新版端点存在但旧固定 Agent 未采用] → 能力明确协商，交付/验收包含新 Agent，更新是用户显式运行环境操作，不伪造已修复的旧组合。

## Migration Plan

1. 在同一变更内完成契约/生成物、历史源与 Agent、Core/客户端、UI/CLI 及整链路验收；可按依赖拆提交，但不将抬高旧上限作为独立交付。
2. 本地构建同版 Agent 与宿主程序，验证独立 Desktop 和托管工作台均读取新页。已有 Work 仅在显式采用兼容 Agent 后确认新能力，不自动修改模型/context。
3. 使用合成历史验证 454 条消息/235 次工具调用的形态，以及跨越 1/4/6 MiB、单条超过 6 MiB、超过 1000 Run/事件窗口、正常完成、410、追加、图片与权限变化；重启和完整包往返只读还原一致。实际验收结果归本变更，临时输出放 dist/。
4. 回退只回退程序/镜像，不迁移或重写历史；旧程序会恢复其原有容量限制，旧进程游标不沿用。对外推送与发布不属于本次规划授权。
