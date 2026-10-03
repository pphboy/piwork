# Design

## Context

动机与范围见 [proposal.md](proposal.md)。本变更承接 `integrate-delivered-webuis`，只处理已确认的 7 项，不重新接入或重新设计两套界面。现有 `desktop-webui` 与 `serve-ui-packages` 已定义主要约束；本次 delta 保留原场景，补充实际状态转换及可执行验收。

### 复核证据与影响边界

以下复核使用当前浏览器构建模块与源代码对应检查。浏览器复现启动隔离静态入口并拦截本地 API；adapter 复现替换 fetch 后断言实际请求及状态。它们确认 UI 缺陷，不计为真实 Docker/Core 全链路验收，也没有改动项目实现或真实用户数据。

| 编号 | 定位 | 已确认的观察 | 影响与证据等级 |
| --- | --- | --- | --- |
| R1 | Desktop adapter 的 saveFile / upload | 有修改时间的保存 PUT 不带 If-Unmodified-Since；HEAD 404 后的上传 PUT 不带 If-None-Match | 请求断言成立；Go file helper 已处理这些条件并返回 412。存在并发覆盖窗口，不表示每次保存都会丢失数据 |
| R2 | Desktop app 的 saveConfig、页签切换与 adapter 的 saveConfiguration | 浏览器编辑 Advanced 的 skills/agentsMd，切到 Skills 保存，捕获到旧 skills/agentsMd 与新 modelRef 的混合提交，并显示成功 | 实际浏览器操作复现；两个表单表示不一致，保存入口决定谁覆盖谁 |
| R3 | resumeRun 的 410 分支与 loadSession 活跃流判断 | running 与 succeeded 两种响应都没有发 Session GET；running 仍安排失效游标重试 | adapter 状态/请求断言成立；终态缺最终历史，活跃态反复错误重连 |
| R4 | acceptSession / clearIdentity | 同 Core signed-out generation 0 到 authenticated generation 1 后 inspection/transfer ID 被清空 | adapter 状态断言成立；Go login 会增加 generation，但 transfers.revoke(false) 特意保留匿名 inspect |
| R5 | closeModal / inspectWork | 浏览器两次选包再关闭，无 work-packages/:id DELETE | 实际浏览器请求断言成立；Go 默认一小时到期回收，也会在适用的撤销/进程退出路径回收，并非永久磁盘泄漏 |
| R6 | Console operationView 与 phase-list | queued/source/prepare/validate/publish/succeeded/cleanup-pending 在标题化阶段数组中均得到 -1 | adapter 与真实 Core 枚举核对成立；阶段条失效，顶部实际成功/失败 state 并未因此变成假终态 |
| R7 | checkCatalog 与目录禁用条件 | 成功返回 Skills/Packages 后 scenario 仍为 catalog-unavailable | adapter 状态断言成立；后续 session/checkConnection 可能重新置 normal，不能表述为永久卡死；目录刷新本身没有正确恢复 |

### 已存在的接口能力

- `internal/coreapp/file_http.go` 转发 If-Unmodified-Since、If-None-Match，`internal/filehelper/conditions.go` 实际检查修改时间/存在性。`apps/desktop-webui/src/files.ts` 的旧实现仍有这些请求头，但新界面未调用旧挂载实现；修复应进入当前 adapter。
- Run GET 已返回 state、finalText 等公开事实，Session GET 返回已保存消息。事件过期后不需要增加 Pi SDK 或 RPC 功能。
- `internal/cli/user_desktop_transfers.go` 已提供同一本地会话的 inspect GET/DELETE；登录前本地检查不需要平台凭证，首次登录保留匿名暂存。DELETE 只释放本地暂存，不是远端 Import 取消 API。
- Core Package Operation 的 phase 枚举来自公开契约；不改 Core 的阶段生产方式。

## Goals / Non-Goals

**Goals:**

- 写入以用户实际读取/确认的版本为条件，冲突恢复不暗中重新授权覆盖。
- 配置只有一份可提交事实，原文编辑期间可以暂时非法，但非法内容不能被旧表单悄悄覆盖。
- 恢复、清理和显示成功均对应实际读取/响应，旧异步结果不能越过身份或检查对象边界。
- 将每项缺陷、规格场景、执行任务和回归断言关联起来。

**Non-Goals:**

- 不新增 Core API、数据库迁移、CLI 命令、网络配置、外部依赖或 Pi Agentd 行为。
- 不增加锁服务、ETag 版本体系、自动合并、目录 ZIP、后台任务队列或自动重新提交。
- 不改变交付视觉语言、导航、`.work` 格式、Stop/Export/Import/Start 的既有分步语义。

## Decisions

### 1. R1：保留编辑基线与覆盖意图

编辑状态保存正文、读取版本修改时间和独立草稿。正文 GET 的有效 Last-Modified 优先作为基线，缺失时使用该次读取已有的 PROPFIND 修改时间；不能从后续自动目录刷新取得时间再替换脏草稿基线。saveFile 接收该编辑基线并发送 If-Unmodified-Since。成功后更新已保存正文及可确认的基线；未取得新修改时间时重新读取元数据，再允许后续带版本的保存，不能继续声称旧时间仍是新版本。

上传仍串行使用原 File 字节。HEAD 404 的 PUT 带 If-None-Match: *；HEAD 2xx 的路径和 Last-Modified 存入该次覆盖意图，待明确同意后使用 If-Unmodified-Since。确认后再次核对时若发现可辨别的版本变化，先重新确认，不能把新时间直接当作旧同意。HEAD 的鉴权、网络或其他失败不构造新文件意图。

412 时保留草稿/File 和读取版本，显示冲突与重读入口。重读取得的正文作为另一个只读保存版本展示；明确的“覆盖重读版本”确认后才把它作为下一次保存基线。仅刷新不 PUT、不清空草稿。网络响应未知保持 unknown 及原意图，不自动重发。没有可用修改时间时显示无法进行版本保护和显式覆盖确认，不能构造假时间。

选择已有日期/存在性条件是因为后端已经支持；仅依靠提交前 HEAD 仍有竞态，新增锁或 ETag 超出本次范围。日期比较为秒级，不能声称防止同一秒内的一切并发写入；测试跨秒安排变化以验证已承诺保护。

### 2. R2：有效配置对象与 JSON 编辑原文

Settings 保存一个完整的有效公开配置对象，普通页签编辑同一个对象；Advanced 保留未提交的 JSON 原文及其有效性状态。进入 Advanced 从当前对象生成 JSON；退出 Advanced 前解析并验证可用的配置形状，将有效对象更新为统一草稿。解析失败保留原文、阻止转换并定位错误，允许修正或明确 Discard。

所有保存入口先完成相同的 JSON/字段同步和验证，再提交一个完整 configuration；不根据当前页签选择覆盖方向。空 Skills/Packages 与空 agentsMd 保持显式含义，其他公开字段原样保留；同一字段后一次有效显式编辑覆盖前一次。导入 AGENTS/JSON 文件也进入同一草稿逻辑。成功读回 desired 后才重置草稿基线；失败与未知结果不清空草稿、不 Apply。

选择统一对象而不是两份表单在保存时临时合并，是为了消除“当前页签决定最终值”的错误。不引入新的 UI 框架或隐藏全局保存流程。

### 3. R3：410 进入只读历史恢复模式

常规 NDJSON 流、sequence 去重和断流按原游标恢复保持现有行为。收到 410 后将本次 observer 标记为历史恢复模式，退出流专用的 loadSession 跳过条件，实际查询原 Run 与原 Session；finally 不再给这次失效游标安排事件重连。

已终态：按保存历史替换对应 Session 的消息，必要时使用 Run finalText 呈现尚未在历史中出现的最终回答，避免追加重复回答；停止自动查询。仍活跃：首轮立即查询，之后约每 2 秒串行查询原 Run 和 Session，以保存历史替换消息并显示正在恢复；终态再取最终历史后停止。查询失败保留最后内容并标记恢复未完成，按 2/4/8/16/30 秒退避，成功后恢复正常只读节奏。401/403 或 404 停止自动查询；身份变更、当前恢复对象切换和页面卸载释放本地观察。

Run 与 Session 请求都受身份 epoch 及 observer 身份保护，晚到结果不能更新新的 Run/Session。最终历史读取失败时不声明恢复完成，并保留显式读回入口；终态不因此变成失败或重发 prompt。任何恢复路径只有 GET，取消仍由用户独立执行既有 cancel。

选择历史查询降级而不是重置到 0 或猜测新游标，是因为前者直接满足历史恢复契约，不引入重播合并和二次过期的风险；不承诺降级期间仍有逐 token 输出。

### 4. R4/R5：明确本地检查的持有与放弃

当前匿名检查保存 transfer ID、summary、原 Core 地址、本地会话上下文、检查请求身份及 import 状态（未提交/提交中/未知/已接受）。仅从匿名到同 Core 首次认证且已完整 ready、未提交的状态转移允许保留本地检查；登录失败仍持有匿名检查。clearIdentity 对平台内容的清理保持不变，通过显式保存/恢复合格本地检查处理这一例外，不能把其他 caches 或草稿一同保留。

Sign in to import 是暂停检查弹窗而非 abandon；登录成功回到原摘要，确认按钮使用原 transfer ID。切 Core、已认证账号切换、登出和本地会话失效不适用保留例外：界面移除旧检查，不将包发往新 Core，已有 Go 撤销继续生效。

普通关闭（包括取消按钮、Escape）、换包和取消上传走专用 abandon：停止本地观察、abort XHR，按已记录 transfer ID 调用 DELETE；活跃上传从请求开始就记录 ID，而不是成功后才持有。删除 2xx 或 404 表示清理确认；网络/其他失败保留独立的清理项及显式重试入口，不将旧项重新设为当前检查。检查请求自身的代次标识防止晚到回调覆盖新检查，即使平台 epoch 没有变化也必须生效。

替换文件先释放旧未提交意图并使其回调失效；若清理未确认，保留旧清理信息再进行新的独立检查，不能依靠丢 ID 忘掉它。后台已有 TTL 仅作为兜底。关闭网页后不承诺可靠发送清理请求，进程撤销/TTL 仍适用；弹窗内显式关闭必须可验证清理请求。

Import 提交中暂禁替换；响应未知保存原 ID 与未知状态并引导核对已知操作，不将 unknown 当成可新提交。已接受时操作弹窗关闭只停止观察，保留 Operation 身份；不调用远端取消，不在该路径执行未提交包的 abandon。选择单独的 inspection 状态而不是直接复用平台 generation，避免匿名升级被误认为账号内容复用。

### 5. R6：原始阶段与显示标签分离

Console adapter 保留 Core packagePhase 原值，视图以一个显式映射生成标签与阶段索引：

| 实际 phase | 显示 |
| --- | --- |
| queued | Accepted |
| source | Resolving |
| prepare | Preparing |
| validate | Validating |
| publish | Publishing |
| succeeded | Published |
| cleanup-pending | Cleanup pending（独立警示，不当作成功步骤） |
| failed / superseded | 对应实际终态及安全诊断，不点亮未来步骤 |
| 未识别 | Unrecognized phase，旁边显示原值 |

首次 acceptance 只确认 Operation ID，显示 Submission accepted，尚无真实查询时详情的 packagePhase 表达为尚未取得，不能将本地合成的 accepted 冒充后端枚举。阶段条只表达已确认的阶段位置，不保证每个阶段都被轮询捕获或提供百分比。真实 state 决定轮询是否终止；unknown phase 不改变 state，失败阶段仅在安全诊断能确认时定位。

选择视图映射而不是把后端字段直接改写为标题，是为了保持诊断与未来兼容，并修复刷新/按 ID 找回页面的相同问题。

### 6. R7：独立目录错误与有效恢复

将 Skills/Packages 的 loading/error/confirmed 状态放到目录自己的状态，保留旧目录内容及成功读取时间；checkCatalog 检查响应包含有效数组，失败或不完整响应不能清空目录。分别更新各目录，实际成功就清除该目录错误；有效空数组也是成功。按可用性恢复对应动作，错误时保留 Work 的保存副本和选择。

全局 Core/readiness、Work 列表状态继续表达各自事实，目录查询不将其改写为正常或离线。check-catalog 的提示根据真实成功/部分失败生成，不无条件 toast Core catalog available。不以无关的 session 刷新作为目录恢复机制。

选择独立目录状态而不是将 scenario 一律置 normal，避免修复按钮卡住时又掩盖环境未就绪或空 Work 列表。

## Risks / Trade-offs

- 秒级时间条件不能保证所有并发变化均被识别 → 明示条件能力边界，测试使用可区分的修改时间，不新增锁/ETag。
- JSON 原文与有效对象同步可能改变格式 → 内容字段保持，原文非法时不自动重写，合法转换只规范格式；保存验证跨页签双向路径。
- 历史降级期间回答只随保存历史更新 → 显示恢复模式，直到确认终态，不伪装持续 token 流。
- 暂存删除可能丢响应 → 留 ID、unknown 清理状态与显式重试，后端 TTL 兜底；不宣称立即释放已确认。
- 真实 Core 测试涉及文件修改和导入 → 使用隔离 Core/CLI、测试目录与安装标签，不能操作当前开发 Work，也不输出私密配置或 token。

## Migration Plan

1. 按 tasks 实现并补齐 7 项回归，不修改原接入变更的完成记录来伪装修复已完成。
2. 构建两套浏览器资源、同步 Go embed，并重新构建 Go CLI/Console，避免源码修复而运行二进制仍携带旧 UI。
3. 执行定向浏览器、Go 条件/传输测试及隔离真实链路，记录范围与结果；逐项验证后才勾选 tasks。
4. 验证通过后可将修复单独 commit，或与尚未提交的接入代码共同提交；提交说明区分接入、已修复问题及实际测试。当前 proposal 完成不代表实现完成。
5. 回滚修复只回退该次前端源码和配套 embed 资源；无需数据迁移，但会恢复本次已记录的缺陷，不声称回滚能还原曾被覆盖的文件。
