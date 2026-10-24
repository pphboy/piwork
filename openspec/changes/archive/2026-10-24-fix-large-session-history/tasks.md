# Tasks

## 1. 协议、预算与合成夹具

- [x] 1.1 在 `proto/agent.proto`、contracts 源定义中增加独立历史能力、页/分片、同快照 messages/runs/result 范围、RunSummary/resultRef 和响应 profile，保持旧字段及幂等输入语义；执行 `make generate`，通过 contracts、`internal/contracts` 与 `internal/rpc` 的 Go/TS 编解码、非法字段及旧消息 golden 测试验证。
- [x] 1.2 定义共享的 50 条默认/100 条请求上限、512 KiB JSON、1 MiB 新 RPC 和 32 KiB UTF-8 分片预算及明确错误码，增加转义字符/中文/边界长度跨语言夹具；验证 TS 预算与 Go 最终编码一致，生成物可重复生成且原通用/图片预算未被放宽。
- [x] 1.3 在现有 SDK/Agent 测试夹具中加入可复用的合成长历史生成器：454 条消息/235 次工具调用形态、总量跨越 1/4/6 MiB、单条超过 6 MiB、超过 1000 个 Run/关联事件、无 SDK 最终消息的持久结果；通过夹具断言核对数量、公开正文预期、UTF-8 字节与原始历史摘要，不使用真实会话内容。

## 2. 历史源、快照与装页

- [x] 2.1 在 `pi-adapter` 实现 SDK 只读定位/增量索引及按页安全投影，复用全历史顺序、祖先 Run 标记、原用户文本安全处理与 64 KiB 工具预览；执行 pi-adapter 单元/跨进程测试，覆盖旧消息、分支、多块单消息、完整行损坏和并发未提交尾部，并断言连续热页不反复重建整份公开正文。
- [x] 2.2 为 WorkStore 新历史通道增加 Run 元数据/必要事件的稳定键分页与按需结果读取，补齐固定 1000 条窗口后的关联；执行 work-store 单元测试，证明超过 1000 Run、超过 1000 事件和无 SDK 消息的已接受 Run 都可枚举，原未知关联不被猜测。
- [x] 2.3 在 Agent Session 服务实现冻结源边界、公开输入投影、消息/图片逻辑身份、作用域游标及有界过期清理；通过 Agent 单元测试验证追加不改旧快照、私有输入释放后原快照仍一致、非法/跨对象游标拒绝、快照淘汰/重启明确失效，SDK 文件与历史 schema 不变。
- [x] 2.4 实现双向按需装页与正文分片，去掉新网络投影中的重复正文，支持同快照 Run 元数据与结果范围；执行 Agent 单元测试，逐页核对实际 JSON/protobuf 字节、游标推进、空文本/非文本/图片描述和完整重组结果，覆盖单条大消息、多块消息、极端转义及 64 KiB 预览标志。

## 3. Agent RPC 与 Core 转发

- [x] 3.1 接通独立能力查询和 ReadSessionPage RPC，Core 对新 RPC 显式设置单页接收保护并校验响应范围；通过真实 Go↔TS gRPC 契约测试完整读取超过 6 MiB 的合成历史，逐页验证预算且证明没有调用旧整份 ReadSession。
- [x] 3.2 为 Run 查询、活跃 Run、取消、受理重放与原键核对实现明确声明的轻量响应 profile 及同对象结果引用；通过 Agent/Go 契约测试验证大 finalText 不进入摘要、持久结果无 SDK 消息仍可读取、旧 profile 保持原表示，改变响应 profile 不改变原提交摘要或再次执行。
- [x] 3.3 为 WatchRun 实现有界终态/结果引用和同 sequence 文本分片帧，Core 事件预检使用摘要并保留慢观察者缓冲；通过 Agent、`internal/agentclient` 和 Core watch 测试验证大终态、大单事件、片中断线、重放去重和最后完整事件游标，观察关闭不触发取消。
- [x] 3.4 在 Core 增加严格校验的历史能力/分页 HTTP 路由、snapshot/过滤参数、明确 400/410/501 错误及写头前预算复核；执行 `go test -mod=readonly ./internal/agentclient ./internal/coreapp`，覆盖逐页授权、非所有者管理员、混用 Session/Run、旧实例晚响应、旧接口和图片能力兼容。

## 4. 共用客户端与 Desktop/托管后端

- [x] 4.1 在 `internal/client` 增加可复用的页/范围读取及 profile 支持，区分响应超限、不完整与非法 JSON；通过客户端 HTTP 测试验证单页及游标校验、失败类别和取消传递，同时证明其他 JSON 路由的 1 MiB 保护仍生效。
- [x] 4.2 在 Desktop control planner 只开放新契约规定的历史、快照与 profile 参数，保留 identity guard 并让托管模式复用相同路径；执行 CLI Desktop/hosted HTTP 测试，覆盖合法转发、重复/未知参数拒绝、注销和代次变化期间晚响应隔离，不暴露任意 Core URL/私有路径。
- [x] 4.3 将 Desktop 事件预检与代理切换到轻量 profile，支持同 sequence 分片帧和最后完整事件游标，保留 16 MiB 单连接窗口及授权撤销；执行事件代理测试验证跨窗口重连、片中断线和大终态可恢复，流累计超过 16 MiB 不成为永久不可读，也没有额外提交/取消。

## 5. CLI 完整输出与大结果恢复

- [x] 5.1 将 `session show` 接入同一快照的 messages/runs/result 全范围遍历及私有 0600 暂存，重建既有完整 `session/messages/runs` 输出；通过 CLI 测试对比合成预期 JSON，覆盖超过 6 MiB、超过 1000 Run、部分 Run 没有 SDK 消息和空历史，确认 stdout 恰一个值且未把全部正文同时聚合进内存。
- [x] 5.2 完成暂存失败/页超时/游标失效/Ctrl+C/输出管道失败处理与精确清理，维持帮助和语法检查先于 I/O；执行 CLI 测试验证中间页失败不发布半份成功 JSON、stderr 带原身份、退出类别正确、历史读取中断 exit 130 且无 CancelRun。
- [x] 5.3 将 Run show、chat/watch 完成确认、取消回读及可用的原键恢复统一接入摘要/结果 helper；执行 `go test -mod=readonly ./internal/client ./internal/cli`，验证大结果完整、原机器输出约定和显式取消语义保持，旧 Agent 明确降级且同键恢复没有第二次模型执行。

## 6. 工作台按需历史与全路径恢复

- [x] 6.1 在 models/adapter 建立按身份、实例、Session/profile 绑定的页状态和去重读取器，在 chat-projection 实现稳定片段/工具合并；通过现有 projection/adapter 测试验证重复和乱序页、跨页工具、字节缺口/冲突、相同文字的不同消息、图文落盘身份与结果引用合并。
- [x] 6.2 在 Chat 增加最近页首屏、Load earlier messages、未完整正文和局部失败/失效恢复提示，复用现有组件与阅读锚点；执行 Playwright 浏览器测试验证首屏不自动追全历史、重复点击去重、上滚锚点/Activity/草稿保持、部分 Markdown 安全且新事件不抢滚动。
- [x] 6.3 将首次打开、Session 切换、图片补读、完成刷新、原键恢复及 410 恢复全部切换到共享读取器和原 Run 范围；通过 recovery/continuity 测试断言支持新能力时这些入口不再请求旧整份 Session，运行中可恢复新增内容，终态结果完整后停止轮询且最终答案只出现一次。
- [x] 6.4 完成旧 Agent、停止 Work、鉴权失效及身份/Core/Work/Session/实例切换处理；执行 Desktop 浏览器测试与 typecheck，验证旧内容/草稿按现行身份规则处理、旧晚响应被丢弃、无自动镜像升级/Start/Run 重提，已有图片和模型控件行为保持。

## 7. 构建与跨组件验收

- [x] 7.1 执行受影响 workspace 单元测试与生成检查，再执行 `make build`、`make build-cli` 和 `make test`；核对 WebUI 同步后的嵌入资源、同版 Core/CLI 与协议生成物一致，测试报告不把跳过项写为通过。
- [x] 7.2 使用隔离安装、合成 SDK 历史和本次构建 Agent，经真实 Core 分别验证独立 CLI、独立 Desktop 与托管工作台：454/235 形态、跨 1/4/6 MiB、单条超过 6 MiB、1000 以上关联、运行中追加、超大终态与 410；沿用 `make test-integration-go` 和 WebUI `test:real-core` 入口增加对应场景，记录实际每页字节与无旧整份 RPC/重复执行证据。
- [x] 7.3 通过隔离 Core/Agent 集成场景核对 daemon/Core 重启、已知 history schema 输入、终态 Work 导出导入、旧 Agent 不支持与两身份越权/晚响应；对比公开历史重组与原始私有文件保留事实，证明只读恢复未触发模型/工具或隐式 Start，并仅清理本次 installation ID 的资源。
- [x] 7.4 执行 `node scripts/check-native-boundary.mjs`、`node scripts/check-repository-docs.mjs`、`git diff --check` 和 `openspec validate fix-large-session-history --strict`；核对全部八项新增 Requirement 的实际验收对应、必要证据归本变更而临时输出归 dist/，按功能依赖组织实现/生成物与后续规格归档，不执行对外推送或发行。

## 8. 核验 WARN 修复

- [x] 8.1 原提交键恢复和原 Run 重连在能力缓存清除后重新协商历史 profile，协商期间身份变化不继续旧读取；通过 adapter 回归证明只查询原键或原 Run、采用有界摘要且不重提 Run。
- [x] 8.2 通过服务端确认的结果引用目标映射 SDK 最终消息与持久结果项，跨快照、乱序旧页和部分正文均只展示一次最终答案；通过 Agent/projection 回归验证相同文字的其他消息保留、已读正文不因替代项未完整而消失。
- [x] 8.3 CLI 完整历史请求图片 profile 并保留同快照全部图片描述；通过 CLI 回归核对混合图文、分页、描述内容和无图片原始字节。
- [x] 8.4 旧 Agent 的 UI/CLI 降级明确提示历史能力限制与更新/Apply 方向，失败保留原对象且不循环读取或执行；通过 UI/CLI 回归覆盖旧小历史成功、旧大历史失败及 410 恢复中的容量错误停止自动读取，stdout 约定保持。
- [x] 8.5 执行相关 Go/Agent/UI 回归、真实 Go↔TS gRPC、类型检查和宿主构建，同步嵌入资源；核对可执行的跨组件验收、规格校验及源码边界，将本轮实际结果和未测边界更新到所属验收附件。

## 9. 再次核验的两项 WARN

- [x] 9.1 事件入口非 410 的预检错误保留安全错误码，旧 Agent 的容量/能力错误停止自动重连，保留原 Run、已读内容和更新/Apply 说明；回归同时确认临时网络错误仍可按原对象退避恢复。
- [x] 9.2 结果范围筛选 SDK 文本块时保持原 blockIndex/blockCount，与消息范围可重复合并；覆盖文本与工具混合的终态、双向分页和分片，验证完整正文不会退化为未加载完整。
- [x] 9.3 执行 Agent、adapter/projection、浏览器恢复、真实 Go↔TS gRPC 及相关 Go 回归，完成类型检查、宿主构建与嵌入资源核对，并更新所属验收附件。

## 10. 空结果与非文本终态

- [x] 10.1 区分 SDK 缺少文本块与真实空文本块；缺少文本块的空结果使用独立持久结果项，不向原 SDK 消息添加空块。通过真实 SDK 回归覆盖仅工具、无公开内容、空文本、混合空文本、无 SDK 最终消息及双向读取，保持只读与原块结构。
- [x] 10.2 验证消息/结果任意顺序与重复合并、空结果 helper、浏览器终态恢复及真实 Go↔TS gRPC，确认工具和已读内容不被标为未完整、不产生可见空回复或额外执行。
- [x] 10.3 执行相关 Agent/UI/Go 回归、类型检查与 Agent 构建，核对原大历史预算、嵌入资源、仓库边界及严格规格校验，将实际结果和验证范围更新到所属验收附件。
