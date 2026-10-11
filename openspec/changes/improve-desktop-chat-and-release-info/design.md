# Design

## Context

动机与已确认范围见 `proposal.md`。本变更包含跨 Go/TypeScript 的图片链路、私有历史和两个浏览器入口，因此需要设计；不跳过该文档。

已核对的当前实现：

| 模块 | 现状及影响 |
| --- | --- |
| Desktop `app.ts` / `adapter.ts` | 草稿与发送只有文字；空白文字被拒绝；slash 分支先执行网页动作或资源命令 |
| Desktop `chat-projection.ts` | 非文字内容块被当作工具处理，纯图片会被空消息过滤；不能只增加 `<img>` |
| CLI `user_desktop_control.go` / Core `conversation.go` | 严格字段列表、空白 prompt 校验；普通本机 JSON 上限 1 MiB、Core 控制 JSON 2 MiB |
| `proto/agent.proto` / Agent `application.ts`、`runs.ts` | SubmitRun 只有 prompt；图片无能力协议；当前聊天设置契约为 v3；gRPC 默认接收大小无法承载本次图片 |
| `pi-sdk-executor.ts` / `session-persistence.ts` | 现有 SDK prompt 调用未传图片；历史投影只提取文字/工具；SDK JSONL 本身随私有历史交付 |
| `packages/work-store/src/store.ts` | 受理事务存 Run/幂等/活动槽，未持久保存 prompt；执行前崩溃会缺少用户输入副本；事件压缩删除旧序号前缀 |
| `packages/work-store/src/snapshot.ts` / `internal/workhistory` | 当前精确 schema 5，保留 schema 4 验证；事件正文有每行 64 MiB 限额；SDK JSONL 作为不执行的原字节保留 |
| `action-state.ts` / `.modal-footer` | 状态按最近祖先插入 footer；footer 的 Flex 默认拉伸使同排按钮随多行提示增高 |
| `internal/buildinfo` | 各程序版本命令已有真实版本、commit、modified、平台；Desktop 来自 CLI，可包含 desktopUIHash |
| 构建与交付 | 普通 Go 构建默认版本与独立 CLI/Docker 构建来源不同；Docker sourceInputHash 包含 internal，未扫描 docs |

现行 CONV-SNAPSHOT-001 和源码采用 schema 5；CONV-CHAT-HISTORY-001 尚写“继续 schema 4”。本次 delta 将后者对齐到既有 schema 5/4 兼容事实，不借图片引入新数据库版本。

## Goals / Non-Goals

**Goals:**

- 图片在原 Run 受理模型中有稳定身份、内容和持久恢复依据，模型输入与用户可查历史一致。
- 控制图片传输和内存占用，历史列表不随图片累积无界增大；所有新增路径继续现有对象授权。
- 让按钮反馈、版本来源和日志交付有明确可验证的行为，便于分模块实施与审阅。

**Non-Goals:**

- 不增加通用附件中心、预上传后台、公共图床、workspace 隐式写入、图片编辑/OCR 管线或第三个持久卷。
- 不处理网页自动截图、剪贴板远程 URL 抓取、工具输出图片及模型生成图片；本次图片是用户主动发送的输入。
- 不自动切模型、Apply、升级 Agent、在线查新版本、拉取 Releases 或对外发布。

## Decisions

### 1. 沿用原 Run 提交，图片专用边界独立限额

`POST /api/v1/works/{workId}/runs` 增加可选 `images` 数组，HTTP 条目为 `{mimeType, data}`，其中 data 为规范 Base64；协议层转换为 `ImageInput { mime_type, bytes data }`。字段缺省/空数组按旧文本请求处理；图片请求要求显式 `inputMode: text`，文字可为空，文字和图片都空仍拒绝。

选择内联是因为一次显式 Send 就能原子受理完整输入，不需要孤立上传、过期清理或上传 ID 跨身份绑定。独立上传可支持更大附件，但会扩大本次状态机及持久存储范围，因此暂不采用。

| 边界 | 本次决定 |
| --- | --- |
| 图片 | PNG/JPEG/WebP，最多 4 张，单张原始字节 5 MiB，总量 10 MiB |
| 尺寸 | 单边不超过 8192 像素，单图不超过 40,000,000 像素 |
| 文字 | 继续最多 64 KiB UTF-8；不改普通文本默认值或旧摘要 |
| 图文 JSON | 仅 SubmitRun 路由最多 16 MiB，覆盖 Base64 膨胀和现有字段 |
| gRPC | Agent server transport 接收上限 16 MiB；SubmitRun 的 Go 调用显式限长，原图读取接收上限 6 MiB；其他方法继续原校验/大小边界 |
| 原图 HTTP | 单次最多 5 MiB 二进制，准确 Content-Type/Length，Cache-Control:no-store、nosniff |

CLI/Core 先认证再读取大 body，按规范 Base64、解码后大小、实际类型和尺寸校验；Agent 再复核原始字节，拒绝 MIME 欺骗、容器非法/截断、超限及外部路径。共同的有效性规则为完整 PNG chunk 结构/CRC 和终止标记、JPEG 标记/帧尺寸及结束标记、WebP RIFF 长度/图片 chunk 及尺寸；不执行解压、全尺寸像素解码或重采样。使用同一组合成边界夹具核对 Go/TS 接受/拒绝一致，浏览器另要求能够生成实际预览。压缩像素流或供应商后续拒绝形成原 Run 失败，不以结构校验承诺供应商接受；在现有代码中新增所需的小型校验模块，不引入宿主运行工具。以上容量是本次规划默认值，已写入规格与测试边界。

本机 `desktopControlInput` 与 Core `readControlJSON` 需要 SubmitRun 专用有界入口；`internal/client/http.go` 的普通 1 MiB JSON 响应限制保持。图片读取用单独流式代理，禁止借普通 JSON client 将所有响应限额放大。Agent transport 必须放宽，普通 RPC 仍受各自 DTO/处理器限制。

```text
[Paste / Drop / Picker]
          |
          v
[Work+Session draft] -- Send --> [CLI] --> [Core] --> [SubmitRun RPC]
                                                              |
                                                     [accept transaction]
                                                              |
                                                     [Pi SDK image input]

[ReadSession metadata] --> [image reference] --> [authorized image read]
```

### 2. 独立图片能力协议，不挤占已有聊天设置版本

新增 `GetChatImageCapabilities(AgentContentRequest)` 和 `ReadSessionImage` RPC，保持现有基础协议及 chat_controls v1/v2/v3 行为。Core/CLI 提供 `GET works/{workId}/chat-image-capabilities`，返回 `profile: chat-images-v1`、类型、限额、默认及各可选 modelRef 的 `supported/unsupported/unknown` 图片状态。旧 Agent RPC unimplemented、旧 Core 404 映射为图片不支持，不能误判整个 Work 不可用。

图片能力使用 `resolveProductionModel()` 的 SDK 模型 `input` 及既有显式能力定义；不看名称、协议或 Thinking。未知模型目前可按 text-only fallback 正常聊天，本次保持这一行为，图片能力标为 unknown；目录不隐藏此模型，携图发送说明需要兼容模型或管理员确认定义。模型已明确仅文本时标 unsupported。受理重新解析本次实际模型并校验输入；通过 SDK 的有效 Session context 读取确认当前仍包含的图片块，不用全部归档条目判断。SDK 已摘要移出有效上下文的旧图片仍可看历史，但不永久阻止文本模型；有效上下文含图而模型不支持时，在新受理前拒绝，并在执行 preflight 复核。

图片提交先尝试原幂等命中，再作新受理的模型能力/单槽校验；重放原请求不受目录后来变化影响。网页 slash 与资源命令携图统一拒绝，用户明确切到 Send as text 才作为普通图文发送，不改变原命令展开及 Service identity 参数规则。

### 3. 受理事务保存私有输入，SDK 历史承载正常续接

`RunManager` 构造规范图片描述：有序 MIME、字节数及服务端 SHA256。无图片时沿用原 `submissionDigest()` 和 `digest(prompt)`，有图片时使用带 profile 的规范对象计算 requestDigest/promptDigest，覆盖文字、顺序与图片内容；不接受客户端声明摘要作为事实。实际输入摘要仍供既有 Memory 证据引用，`brain-flow.ts` 已从持久 Run 读取 promptDigest，回归测试核对图文来源一致性。

`WorkStore.acceptRun()` 对携图请求在同一事务写入一个私有 `run.input` 事件，包含版本、文字、图片原字节的规范 Base64 及描述，并更新事件游标。事务失败不发布 Run；成功响应前已有唯一完整输入。旧纯文本请求不增加新记录或改变摘要。图片执行将原数组转换为 SDK ImageContent，通过 `session.prompt(text, { images, expandPromptTemplates: false, ... })` 传入，保留空文字的纯图片语义；SDK 保存原图文消息。已从固定 0.86.1 包源码核对 PromptOptions.images 及 emitInput 调用；图片路径需检查输入处理器的 handled/transform，扩展消费或修改原图片/文字时明确失败原 Run，不能静默丢图后返回成功。

图片引用固定为 `(workId, sessionId, runId, imageIndex)`，不依赖 SDK 稍后才分配的 entryId。`ReadSession` 发现同一 Run 的 SDK 用户消息时使用 SDK 历史；尚未保存时从私有 input 形成一条受理输入消息。投影按 Run 关联与图片摘要合并，同一输入只出现一次；message 和图片 block 身份在两种来源间保持稳定。

SDK 写入前中断的 input 也需要进入后续显式续聊上下文：先用全部原始 SDK entries 的原 Run 标记及完整输入摘要确认是否真正缺消息，不能把被摘要移出有效 context 的旧图当作缺失再次插入。模型准入时只读合并当前分支真正缺失的终态已接受用户输入及有效 SDK context；用户明确的新 Run 受理后，在单 Work 执行槽内、创建 SDK AgentSession 前，按原 Run 标记与接受顺序将缺失用户消息一次性补入 SessionManager，时间取原 acceptedAt，不生成 assistant/tool 记录或调用旧 Run，且排除当前新 Run 的输入。

只读 ReadSession、重启恢复和包导入仅作投影，不触发历史补全或模型执行。已存在完整匹配的 SDK 用户消息直接复用；同一 Run 出现部分/不匹配消息视为损坏，不猜测补图。补全后再执行新消息并按上述身份去重，SDK 尚未将补全消息真正写入文件并同步时仍保留私有 input；重复恢复/再次崩溃不制造重复消息。输入不属于当前兼容分支时拒绝/保留原历史，不越过 context 约束。

私有 input 不进入普通日志或 SSE 原文。`eventMessage()` 对该类型只投影有界状态，直接分支而不为每个观察者解析/转发大图片。图片 bytes 不进入 tool result preview 或已知操作记录。

事件压缩只有在确认同一 Run 的 SDK 用户消息已经落盘、内容/顺序匹配并完成文件同步后才能删除 `run.input`；固定 SDK 在首个 assistant 前可能只保存在内存，不能只检查 session.messages。由 Pi adapter 核对真实 JSONL 副本并完成 sync 后发出可压缩确认；之前保留连续事件前缀，不能只钉住 sequence 1 却删除中间序号。若 SDK 没有保存，该 Run 的 input 继续作为原图来源。重启中断、模型失败或取消均不自动回放；相应历史的最后一份图片不被清理。

私有 input 在事件与 SDK 中可能短暂双份，选择此成本是为了同时取得原子受理和 SDK 原生续接。另建附件数据库或先写 SDK 文件再提交 SQLite 会增加跨存储原子性/孤儿清理问题，暂不采用。

### 4. 原图按需读取并随原私有历史完整交付

新增 `GET /api/v1/works/{workId}/sessions/{sessionId}/runs/{runId}/images/{imageIndex}` 及本机对应入口。Core 验证 Work 所有者和当前 admitted Agent，Agent 逐项验证 Session、Run 与图片索引，读取 SDK 保存内容或尚有效的私有 input，复核 MIME、字节和摘要；不存在返回缺失，损坏返回明确损坏，不从附近消息或另一 Session 猜图。

`ReadSessionImage` 返回单张原始 bytes 与安全 metadata，Core/CLI 转为 binary response；本机使用 Cookie 认证，浏览器没有 Core bearer。前端仅在图片进入可视区域或用户打开较大预览时取得，最多两个并发读取，离开时取消本地读取并释放预览资源。Work 停止沿用现有历史读取准入，不暗中启动。

`SessionContentBlock` 增加图片描述，公开历史没有 Base64；新的历史读取通过 `imageProfile=chat-images-v1` 查询参数及 ReadSession 的增量 profile 字段明确请求图片块，缺省调用继续旧文本/工具投影，旧客户端无需识别新块。Desktop 明确处理 text/image/tool 三种类型，不能将 image 当作 tool 或过滤纯图消息。初次发送乐观展示与后续历史用原 Run/索引合并；图片暂时失败只更新该块。

沿用 schema 5 的事件行、SDK JSONL 与现有私有卷/完整包。`run.input` 的版本、输入形状、长度、MIME、摘要和所属 Run 由 Go/TS 同步验证；既有未知事件规则保持，不借图片让其他事件变成可执行内容。SDK JSONL 仍按现有不执行原字节规则传输，在图片读取/续接时有界校验。新增契约及生成文件通过 `make generate` 同步，SQLite 表结构、Work 包 formatVersion、storageLayout 及 schema 4 兼容不变。

### 5. 图片草稿有独立身份和本次发送快照

扩展现有 Work/Session draft 为文字、图片条目及修订号；每张图片有本地稳定 ID、原 File/bytes、MIME、校验状态和预览。尚无 Session 的草稿保留 `new` 归属；只有显式 Send 才按原流程创建一次 Session、确认模型设置并迁移该草稿。

三种输入统一走有界检查。粘贴只消费图片 File，混合内容保留普通文字处理；drop 只在 Composer 区域拦截可支持文件，不拦 Service iframe 或应用文件操作；文件选择器提供相同筛选与反馈。混合批次逐项反馈，异步操作绑定身份 epoch 和草稿归属；失败不改已有合法条目。

提交固定输入快照及原键。在途锁只保护本次发送，允许编辑下一条草稿；确认只消费快照中仍未改变的内容，不能用回调清空后来的图片。未知/新 Session 创建未知沿用已有只读 lookup，核对成功只关联原对象，不自动发送尚未受理的草稿。受理前模型拒绝保留未发送草稿；受理后执行失败保留历史和原 Run，不把已发送内容自动还原成草稿。

预览使用本机 Blob URL 并明确把 `blob:` 加入 Desktop 的 img-src；其他 CSP 不放宽。移除、注销、身份失效和卸载时释放；历史二进制转为 Blob 供同一预览组件使用，不把 Base64 写到 localStorage、缓存文件或公开记录。所有布局共用草稿与原 Session，图片条目可换行/滚动，配置摘要和 Send 保持既有层级。

### 6. 创建状态与按钮行分离，弹窗外框稳定

在 `modalMarkup()` 为 Create Work 建立专用状态容器，与可滚动正文分开、位于正文和纯动作 footer 之间，使 Advanced 长表单也能立即看到反馈；状态区域有独立最大高度和滚动，不覆盖输入。`renderActionStates()` 优先写入显式状态容器，对其他弹窗 footer 的反馈放入独立整行状态区，不作为按钮同行 Flex item。创建弹窗外框按视口采用稳定尺寸，header/footer 不随状态增高，正文和状态内部滚动；Advanced 配置也遵守同一框架。

按钮继续既有英文 label，等待仅改变 disabled/aria-busy 和状态槽，不替换为更长文本；明确 align-items、按钮不伸缩与高度边界。仅加 `align-items:center` 可以修复高度，但多行提示仍会挤动按钮，因此同时分离状态区域。

Playwright 在初始、立即提交、十秒等待、长错误/未知状态间比较 Create/Cancel 的 bounding box，宽高及位置误差至多 1 CSS px，并检查 360px 下不溢出、焦点与一次 POST。失败/未知锁继续由原 ActionState 管理，状态容器本身不持有第二份动作状态。

### 7. 产品信息共用运行身份，读取本机与远端分开

新增 `internal/releaseinfo/`，组合 `buildinfo.Read(program)` 与嵌入日志，响应 DTO 建议为：

```text
aboutApiVersion: 1
build: { program, version, commit, modified, os, architecture, ... }
releasesUrl: https://github.com/pphboy/piwork/releases
releaseNotes: null | { version, component, title, publishedAt?, sections }
```

sections 采用标题及文字条目，安全按文本渲染；publishedAt 无真实日期则省略。保留 buildinfo 已有字段的原语义，不读取 package.json 构造运行版本。

| 入口 | 来源与访问 |
| --- | --- |
| Core `GET /api/v1/about` | bearer 认证后、admin 分支前；普通已登录用户/admin 可读；不依赖 runtime readiness |
| Desktop `GET /_desktop/api/about` | 本机 CLI build/notes；通过 Host/Origin/Cookie 与 identityBound=false 的本地 guard，不要求 Core 登录 |
| Desktop `GET /_desktop/api/core-about` | 独立走当前平台身份及原请求归属保护，代理 Core about；慢请求不阻塞本机 |
| Console `GET /console/api/about` | 既有管理员会话下读取其连接 Core；不使用 Console build 冒充 Core |

Desktop topbar 的已授权登录页和工作区提供 About，复用原生 dialog/焦点返回。Console 增加 `/about` 及已有导航入口，同步 Go shell 白名单。界面为英文 `About Piwork`、`Desktop (piwork-cli)`、`Core`、`Release notes`、`All releases`；日志正文采用当前英文产品文案，可逐条标明 Core/Desktop 适用内容。

Core 读取中、不可达、旧版不支持与同身份最后已知分别展示；切换 Core/账号清理远端缓存和旧请求，本机数据无需重新请求。仅记录当前页面内最后已知数据及时间，不新增跨身份持久缓存。旧 Core 404 只降级 About，不触发自动登出。

### 8. 日志资源纳入真实发行输入，不推断发布事实

以 `internal/releaseinfo/` 内的结构化版本目录及正文作为可执行资源权威源，按 `{version, component}` 精确查找。它进入现有 Go embed 和 Docker sourceInputHash 的 internal 范围；独立 CLI 的源码身份/构建输入也需显式核对，若其输入清单不能反映日志，则补入该资源及测试。desktopUIHash 继续只表示浏览器输入，不重定义成全部客户端输入。

增加可在本地执行的资源校验：键唯一、类型/长度合法、每版正文最多 64 KiB、Releases HTTPS 链接固定合法、版本精确匹配，不通过联网探测 GitHub。提供 `make check-release-info` 显式严格候选入口，按候选的真实版本与角色核对记录，文档中的正式候选流程在打包审阅前执行该入口；现有普通 Go/CLI/Docker 构建及本地 `make release` 只检查资源结构，不因缺当前条目而改变开发入口。开发缺失显示 `Release notes are not available for this build`。

在用户确定下一正式版本前，本次未发行功能记为独立 `Unreleased` 维护条目，不能伪装成旧 package.json 版本已经发布的内容，About 不把该条目匹配为当前版本。正式候选检查仅在有实际版本条目时通过；这不阻止本次本地实现、开发构建与合成资源测试。已有旧版日志若有可靠来源可补录已证实内容，不填假日期或借验收记录推定发布。

同步普通 Go、独立 CLI 和 Docker 打包入口及必要输入 hash 测试，保留现行发行 commit/dirty/hash/digest。读取 About 和编写日志都不运行发布脚本，不修改已发布引用来匹配后来的提交。

## Risks / Trade-offs

- 图片 Base64 和受理事件暂时增加内存/磁盘占用：固定 16 MiB 请求、5/10 MiB 图片上限、按需读取及一次发送锁约束；不用全部历史内联图像。
- SDK 落盘时机晚于接受：事务内私有输入保存原内容，只有验证 SDK 持久副本后才允许压缩；崩溃注入覆盖两个边界。
- 中断输入可见但未进入 SDK 上下文：下一次显式 Run 前只补全已接受用户历史，保留旧终态与分支/context 约束，测试新请求实际含原图片且不执行旧请求。
- 未知模型被错误当作支持：独立 unknown 状态，明确阻止携图新受理，文字模型目录及普通执行保持原能力。
- 图片历史导致上下文负载增长：保留 SDK 原上下文管理，不改自动摘要策略；实际模型必须能够处理有效图片上下文，失败保留历史并说明。
- 图片原始内容属于用户历史：只走原所有者及本机授权，no-store、Blob 清理、跨对象拒绝，不进入日志/SSE/工具摘要。
- 版本与日志容易混淆组件：精确 buildinfo 来源及组件/版本匹配，缺失明确显示，不以 package.json 或最新日志兜底。
- 在途发行工作改动相同脚本：以当前源码接入日志输入检查，独立功能提交，保留既有验收缺口与已发布制品身份。

## Migration Plan

1. 先完成增量 DTO/proto、独立图片能力和私有输入/读取链路，生成代码及跨语言验证与实现同组；旧文本请求、chat_controls v3 及旧 Agent 基础能力持续可用。
2. 接入 Desktop 三种图片输入和历史，再完成创建布局与 About/日志。两端浏览器资源重新构建并嵌入 Go，不手改生成副本。
3. 更新后的图片能力由新 Agent 镜像提供；旧 Work 固定镜像只显示升级方向，用户显式更新/Apply 后才采用。Core/Desktop 的 About 新能力可独立采用。
4. 无数据库迁移、无新增卷。回退客户端只失去新 UI；回退到旧 Core/Agent 后新增图片读取能力可能不可用，须保留原私有历史和升级恢复方向，不能承诺旧客户端展示图片或静默删除数据。
5. 通过定向测试、真实 SDK 合成图片请求、独立安装的终态 Work 包往返和发行输入检查后记录实际结果；本提案和本地候选检查不构成对外发布。
