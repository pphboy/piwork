# fix-large-session-history 验收

日期：2026-10-23。使用 Go 1.25.5、Node 24、Linux amd64 和本地 Docker；全部会话、图片、账号及凭证均为合成夹具。

## 结果与边界

历史使用 `session-history-v1` 能力和独立分页 RPC/HTTP 通道。JSON 页预算为 512 KiB，新 RPC 接收保护为 1 MiB，正文分片为 32 KiB UTF-8；原 JSON 控制响应、图片、工具预览及 Desktop 单连接事件窗口预算保留。Run 控制响应和终态帧使用 `history-v1` 摘要，完整结果通过历史范围读取。SDK JSONL 与 Work history schema 没有增加迁移。

| 验收 | 实际结果 |
| --- | --- |
| 真实 Go↔TS gRPC | 454 条 SDK 消息、235 次工具调用；74 页，最大最终 JSON 为 515,575 字节；单个 7 MiB 文本事件为同一 sequence 的 224 帧；旧整份 RPC 在夹具中直接拒绝，读取仍成功 |
| 真实 Core / mTLS Agent / CLI | 1459 条公开历史项、1006 个 Run；94 页，最大 JSON 为 515,679 字节；包括 1005 个没有 SDK 消息的持久结果；CLI 输出为一个完整的 `session/messages/runs` JSON |
| 独立 Desktop / 托管工作台 | 两种入口均读取最近页，只有显式操作才请求更早游标；原 Run 的 7 MiB 结果完整；观察请求没有旧整份 Session 读取、提交或取消 |
| 所有者与实例 | 普通非所有者得到 404，非所有者管理员得到 403；能力、消息、原 Run 结果三个范围都通过真实 Core/Agent 安装核对；旧实例和账户晚响应隔离另有单元/浏览器回归 |
| SDK 保留与包往返 | 读取前后原 SDK 文件 SHA-256 相同；停止 Work 后导出、导入以及真实 Core 重启后，7 MiB 结果仍完整；导入保持 stopped，读取不隐式 Start |
| 快照与恢复 | 运行状态下追加不改变旧快照；新快照可见新内容；跨范围/Session、淘汰、TTL、进程重建及重启的旧游标明确失败；已加载内容保留 |
| CLI 失败处理 | 中间页失败、空历史、取消、stdout I/O 失败均覆盖；真实子进程 Ctrl+C 为 exit 130、无 CancelRun；关闭 stdout 管道产生 I/O 失败并清理私有暂存 |
| 事件窗口 | Desktop 保留 16 MiB 窗口；片中截断不推进原事件游标；UI 经保存的 Run 范围恢复；Core 有界缓冲允许健康读取者消费大分片回放 |
| 浏览器回归 | 全量运行 947 通过、0 失败、1 项既有跳过；新增用户身份合并、分片投影、恢复与阅读锚点用例另外复核通过 |

完整构建检查执行 `make build`、`make build-cli`、`make test`。协议重新生成后的 10 个协议/DTO/预算/编码夹具文件 hash 保持一致。最后的小范围修改另外执行 CLI/client、Core、history/projection/recovery 检查并重新构建嵌入资源和宿主程序。

浏览器全量中的跳过项是已有的 “real Engine prepares fixed release dependencies and permits one explicit Work from the IP workbench”，没有计为通过。本变更的真实 Core 历史验收另行执行。

## 八项 Requirement 对应

| Requirement | 主要实现与检查 |
| --- | --- |
| 会话历史通过有界分页完整读取 | `SessionHistoryIndex`、`SessionHistoryReader`、WorkStore keyset；Agent history、Go↔TS wire、Core 集成及 CLI 大输出测试 |
| 历史游标固定读取范围并保持逻辑身份 | 快照源边界、作用域游标、受理输入投影；追加/TTL/淘汰/跨 Session/图文输入释放与用户身份测试 |
| 历史观察的控制响应与完整结果分离 | Run profile/resultRef、事件分片、Core observer buffer；大结果重放、同键单次执行及 16 MiB 窗口测试 |
| 分页历史能力独立协商且保留原始历史 | 独立能力、旧 RPC/字段兼容、原文件摘要；已有 schema 4/5、旧能力及完整包往返测试 |
| 长会话按需读取且保持阅读状态 | `HistoryProjection`、分页控制与部分 Markdown 提示；浏览器最近页、阅读锚点及草稿测试 |
| 全部会话恢复入口使用有界历史读取 | adapter 共享读取器、原 Run 范围及大结果 helper；410、终态、详情、图片和身份切换检查 |
| CLI 透明遍历会话历史并保持完整输出 | 固定快照 messages/runs/result 遍历、0600 暂存与延迟发布；大输出、1000+ Run、取消、失败清理测试 |
| CLI 的大结果查询与观察使用有界响应 | 共用客户端范围与流重组、Run show/watch/chat/cancel；真实大结果、旧能力、退出与显式取消回归 |

## 复现入口与本机条件

常规环境先运行 `npm ci`、`make build`，再使用 `make test`、`make test-integration-go` 和 `npm run test:real-core -w @piwork/desktop-webui` 的现有入口。新增独立场景可以单独运行：

```sh
go test -mod=readonly -tags=integration -run TestRealTSHistoryWire -v ./internal/agentclient
# Agent/helper 镜像变量沿用 Makefile 的集成入口
go test -mod=readonly -tags=integration -run TestNativeLargeSessionHistory -timeout=12m -v ./internal/coreapp
PIWORK_TEST_HISTORY=only npm run test:real-core -w @piwork/desktop-webui
```

本机 Docker 的默认 IPv4 地址池已耗尽。本次验收使用临时 Engine API 转发，仅对测试安装标签的 NetworkCreate 填入未占用的 `10.233.x.0/24` 子网，其他业务 API 保持原样；Docker exec 通过实际 socket 访问。浏览器验收用 Go overlay 选择该测试 socket 与随机 Agent listener 端口，未修改产品运行配置。该本机适配、构建产物和临时日志位于被忽略的 `dist/history-validation/`，不作为产品交付入口。

安装资源按本次生成的 installation ID 清理；没有全局 prune、清理其他安装、对外推送或发行。主规格同步与归档由后续 OpenSpec 归档流程承接。

最终资源核对涵盖本次 13 个测试安装：遗留容器、网络和卷均为 0；临时 Engine API 适配进程已停止。

## 2026-10-24 WARN 修复复验

本轮处理 verify 发现的四项 WARN，继续使用合成历史和独立测试安装。

| WARN | 实现与实际验证 |
| --- | --- |
| 原键恢复在能力缓存清除后回到旧响应 | 原 Run 提交键查询、事件重连及保存历史恢复在必要时先协商历史能力；adapter 测试核对原键、`history-v1`、接受事实、分页恢复和协商期间的身份切换，所有请求均为原对象的读取，无再次提交 |
| 跨快照重复最终答案 | Agent 通过已有 `resultRef.entryId` 明确指向已确认的 SDK 最终消息；投影按同一 Run 的目标关联持久结果项。旧快照重放、部分 SDK 正文、反向到达和同字其他消息均有回归；原复现中的最终答案数量由 2 变为 1，未完整的替代表示不覆盖已有完整正文 |
| CLI 完整历史漏图片描述 | 消息范围显式请求 `chat-images-v1`；CLI 单元测试跨两页保存两张图的索引、MIME、字节数和 SHA-256。真实 Core/Agent/CLI 另验证 SDK 图文输入在私有输入释放后仍输出正确图片描述，无图片原始字节 |
| 旧 Agent 缺少更新方向 | UI 在消息滚动区外显示独立的持久说明，CLI 写入 stderr；旧小历史 stdout 保持原 JSON，旧大历史明确失败且保留原身份。旧 Agent 的 410 恢复遇到容量/能力限制后停止自动整份读取，不改变 Run 状态或取消执行。草稿、阅读锚点、Service 反馈和模型/Thinking 控件分别回归 |

本轮相关 Go 包测试通过：`internal/client`、`internal/cli`、`internal/agentclient`、`internal/contracts`、`internal/coreapp`。历史源/Agent/contracts 的 14 项测试通过；adapter/projection/continuity/组件的 86 项测试和受影响的 40 项 Playwright 恢复/布局/设置测试通过，均无失败或跳过。

真实 Go↔TS gRPC 再次取得 454 条消息、74 页，最大最终 JSON 为 515,575 字节；7 MiB 原事件仍为同一 sequence 的 224 帧。真实 Core/mTLS Agent/CLI 验收通过，用时 210.94 秒：1459 条主会话历史项、1006 个 Run、94 页，最大 JSON 为 515,679 字节；7 MiB 结果及 Watch、SDK 原文摘要、图片描述、重启 410、停止后包往返和真实 Core 重启均通过。

交付构建后的独立 Desktop 与托管工作台再次通过 454 条消息、最近页首屏、显式加载更早页及 7 MiB 结果检查，没有旧整份 Session 读取、提交或取消。执行了 `make build`，最终 UI 调整后重新构建工作台、`make build-go` 与 `make build-cli`；28 个嵌入浏览器/公共资源逐字节一致。workspace 类型检查通过，`make generate` 前后 10 个协议/DTO/预算/编码夹具文件 hash 相同。

本机仍采用上节所述的隔离 Engine API 网络适配与测试 Go overlay，产品运行配置未改变。临时输出归 `dist/history-warn-fixes/`。本轮 3 个安装的容器、网络和卷均已核对为 0，临时代理进程已停止并移除其 socket；没有清理其他安装、推送或发行。

## 2026-10-24 第二轮 WARN 修复复验

再次 verify 发现的两处偏差已分别修复，并先通过新增回归复现原错误。

- 非 410 事件预检失败保留安全错误码，旧 Agent 的 `RESPONSE_TOO_LARGE`（502/503）、`RATE_LIMITED`、`HISTORY_UNSUPPORTED` 与 410 保存历史恢复共用停止条件。原复现中 1.5/3/6 秒反复读取的连接现在只读取一次，不再安排重连；原 Run 状态、游标、已知正文和草稿保留，并显示更新/Apply 方向。网络和临时服务不可用错误仍按原 Run 退避，测试确认首次重连在 1500 ms，1499 ms 时不会提前读取。
- SDK 结果范围筛选文本时保留原消息的 `blockId`、`blockIndex`、`blockCount`，游标仍遍历筛选后的正文。真实 SDK 的“文本—工具—文本”取消终态用例保留原索引 0/2 和块总数 3；660,000 字节 UTF-8 正文经双向分页与游标重放完整还原。消息与结果范围按任意顺序、重复合并后仍完整，工具只显示一次，Markdown 不会退化为局部未加载提示。

本轮 10 项 Agent 历史测试、95 项 adapter/projection/continuity/组件测试及 10 项 Playwright 恢复测试通过，无失败或跳过。真实 Go↔TS gRPC 再次通过（9.28 秒）：454 条消息、74 页、最大最终 JSON 515,575 字节，7 MiB 原文本事件为同一 sequence 的 224 帧；新增混合 SDK 终态检查确认两方向的结果块位置经 Go/TS 链路保持一致。

相关 Go 包 `internal/client`、`internal/cli`、`internal/agentclient`、`internal/contracts`、`internal/coreapp` 测试通过；workspace 类型检查通过。已重新构建工作台、`make build-go` 和 `make build-cli`，28 个嵌入浏览器/公共资源逐字节一致；源码边界、仓库文档边界、`git diff --check` 与严格 OpenSpec 校验通过。本轮没有修改协议/schema 定义。

本轮针对这两处修复运行上述回归与真实 gRPC，未重复全量测试或 Docker/Core 包往返验收；前文相应记录保留其实际执行范围，不作为本轮重新执行的结果。临时日志和原复现的修复后输出位于被忽略的 `dist/history-warn-followup/`；没有创建 Docker 安装资源、提交、归档、推送或发行。

## 2026-10-24 空结果终态 WARN 复验

SDK 最终消息没有公开文本块时，空字符串相等不再构成结果匹配证据；结果通道使用该 Run 的独立持久结果项，返回零字节、已完成的 `run-result` 分片。真实空文本块与空白字符正文继续绑定原 SDK 文本块并保留其位置和数量。原“仅工具、空结果”的复现现在保持工具 `historyIncomplete=false`，没有向 SDK entry 增加 `empty` 块。

真实 SDK 的 14 个新增终态子用例覆盖 cancelled/succeeded 与仅工具、仅非公开 Thinking、空内容数组、显式空文本、空文本混合工具、空白正文、无 SDK 最终消息七种形态；每种均核对双向读取、同快照重放、私有内容不外露及 SDK 文件不变。消息/结果先后到达和重复合并、空结果读取 helper、浏览器 410 后取消态恢复均通过；已读工具保持完整，草稿保留，没有可见空回复、重连循环或再次提交。

实际通过 30 项 Agent/历史源/contracts 测试（含上述 14 个子用例）、97 项工作台单元测试和 11 项 Playwright 恢复测试，无失败或跳过。真实 Go↔TS gRPC 用时 8.77 秒，额外核对四种空结果形态的双向范围身份；原 454 条消息仍为 74 页，最大最终 JSON 515,575 字节，7 MiB 原事件仍为同一 sequence 的 224 帧。

Agent 已重新编译，workspace 类型检查通过；相关五个 Go 包测试命中通过缓存。28 个嵌入浏览器/公共资源逐字节一致，源码边界、文档边界、`git diff --check` 与严格 OpenSpec 校验通过。本轮实现修改位于 Agent 结果源选择，宿主和浏览器实现沿用前一轮构建；未修改协议/schema，也未重复全量测试或 Docker/Core 包往返验收。临时输出归 `dist/history-empty-result/`，没有创建 Docker 安装资源、提交、归档、推送或发行。
