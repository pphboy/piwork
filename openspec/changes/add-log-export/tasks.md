# Tasks

本轮为已批准的规划整改，不代表实现已修复。`[x]` 仅保留上一轮确有执行证据的既有子范围；历史通过不能替代下列重开项和新增矩阵。修复后须对最终输入重新执行相关检查，8.1/8.3 的汇总完成依赖对应矩阵全部有真实结果，8.4 的历史门禁须在交接前重跑；未跑项保持未勾选。证据只记录合成内容、实际程序/镜像身份、命令结果和路径，临时产物放被忽略的 dist/；单元、故障注入、真实进程、Engine、浏览器分别注明，不互相冒充。

交付范围确定为 GUI 下载 ZIP 后由用户手工发给维护者，无上传接收端。后续由用户单独触发 apply；本分支完成修复与 verify 后交 main 合并，主规格同步和归档由 main 按阶段执行，本轮不提前执行。

## 核验问题追溯

R1–R7 对应上一轮独立核验的七项问题，以下是待修复/待证明事实，不是本轮复测结果。已有复现输入位于被忽略的 `dist/verify-add-log-export-round2/`，不作为已提交或跨机器可用证据；apply 须将有意义回归纳入对应正式测试。

| 问题 | 独立核验事实 | 约束规格 | 重开与新增任务 / 必要证明 |
| --- | --- | --- | --- |
| R1 严重：回滚脱敏上下文错绑 | 候选配置 2 失败后恢复配置 1，generation 3 的来源却绑定 desired 2，旧已知凭据未脱敏 | LOGEXP-002；WLIFE-LOG-001 | 1.3、3.3、3.4、9.5、8.6；按实际捕获 Context 绑定，真实回滚且新旧凭据不同的回归 |
| R2 严重：辅助元数据丢失抹除缺口 | 持久归档为 partial，删除 metadata.json 后导出却 complete=true、warningCount=0 | LOGEXP-003、LOGEXP-005 | 4.2、4.3；缺失/损坏/不可核验元数据均保留持久缺口，不升级完整性 |
| R3：同键 ready 恢复卡住 | POST 恢复已完成任务后未 GET 详情，文件名为空，自动/手动下载无效 | DWUI-LOG-001 | 7.3、8.10；详情暂失保留 ID，恢复后单次交付与同包重下 |
| R4：Core 边界取得过晚 | 接受后、worker 固定边界前轮转，T 前标记被清理却返回完整 | LOGEXP-001、LOGEXP-003 | 2.3、4.2、8.1；接受阶段 pin 文件身份/上界，轮转竞争与失败释放回归 |
| R5：容量事后检查 | 4 KiB 注入区域预算下，尚未 ZIP 已写 144396 字节；缺独立 ZIP 硬限 | LOGEXP-006 | 5.2、5.3、8.8；准入预留与逐次写入限制，raw/ZIP/元数据分别验证 |
| R6：损坏结果仍标 ready | 同尺寸损坏下载虽 503，后续查询仍 ready/result 非空/error 空 | LOGEXP-004、LOGEXP-007、LOGEXP-008；CLI-LOG-002 | 4.4、5.1、8.8；持久 failed/result=null、重启/同键不重采，普通取消不误伤 |
| R7：任务勾选超过证据 | 8.1/8.3/9.5 和全部移除路径的矩阵未完整执行；9.7 代码已去掉 LogReference，design 仍称持久引用 | WLIFE-LOG-001；LOGEXP-006/007；WACC-LOG-EXPORT-001；DWUI-LOG-001/002 | 3.4、5.2、8.1、8.3、8.5–8.10、9.5、9.7；补部署/生命周期/故障/GUI 矩阵及进程内租约原子协调证据 |

## 1. HTTP 契约与受管存储

- [x] 1.1 在 packages/contracts 定义日志创建/接受、状态、范围、进度、结果、缺口和错误契约，接入 HTTP 生成入口并同步 Go DTO/夹具。验证：`make generate`、contracts 单元测试和 `go test -mod=readonly ./internal/contracts` 通过，覆盖未知/重复字段、非法 ID、正文及安全投影上限。
- [x] 1.2 为 Core 受管 logs 目录及 runtime/log-exports 增加安全访问入口，使用版本化 control_metadata 保存任务、幂等、分项来源、归档及密封结果，不改变既有 schema 版本。验证：corestore/safefs 单元测试覆盖现有格式数据目录升级、重启、权限、链接拒绝和半发布恢复，原 Work/身份/凭据不变。
- [ ] 1.3 实现来源预登记、精确实例绑定、保留归属和任务/幂等/来源接受事务，采用满足 controlKey 限制的固定前缀及分项记录；按实际捕获 Context 绑定不可变配置版本，不猜用 desired/active/generation（R1）。验证：事务回滚、并发接受、无 Work/已删除 Work、来源绑定中断和大小限制测试通过；候选失败后恢复旧配置时登记正确，无法核验上下文不输出未确认脱敏正文，未持久受理不返回虚构 ID。

## 2. Core 进程日志保存

- [x] 2.1 实现 Core 持有的日志管理模块：JSONL、bootId/seq、安全字段、控制台与文件独立双输出、16 MiB 分片、256 MiB/7 天保留及同步策略。验证：新模块单元测试覆盖并发完整行、轮转/重启不覆盖、定时/边界同步、文件写失败仍输出控制台，以及已知/未知缺口标记。
- [x] 2.2 接入业务诊断、性能事件、受管标准 log 和启动/退出事件，保持当前 stdout/stderr 对外格式与原有诊断投影。验证：diagnostics、coreapp、app 相关测试通过，检索业务直写 stderr/标准 log 的剩余点并逐项证明接入或属于已声明边界；全局文件不含合成 Work 正文/秘密。
- [ ] 2.3 在接受阶段、202 返回及 worker 开始前同步并固定 Core 分片身份/字节边界，原子协调收集引用与 GC，接入共享日志生命周期（R4）。验证：暂停 worker 后轮转/清理仍保留 T 前标记且排除 T 后记录；拒绝、重放、异常退出释放正确；app/process 测试证明 help/非法参数/第二实例不修改日志，最终关闭诊断落盘且不超关闭预算。
- [x] 2.4 在既有双语 Docker 部署手册及其生成源说明日志路径、挂载保留、默认轮转、覆盖起点和启动/原生崩溃边界，同步需要的模板/单机示例说明。验证：实际路径与二进制/Docker 数据目录一致，`node scripts/check-docker-quickstart.mjs`、`node --test scripts/check-docker-quickstart.test.mjs` 及文档路径检查通过，不向根 README 加教程。

## 3. Docker 全量读取与生命周期归档

- [x] 3.1 为精确绑定 Agent/Service 增加完整日志流读取，使用 stdout/stderr/timestamps/tail=all/until 和有界取消，保持旧 200 行/64 KiB/2 秒 Logs 不变。验证：dockerengine 单元/真实 Engine 测试覆盖大量输出、跨帧/跨块及极长行、时间上界、驱动不支持、异常帧、同名替代实例和取消；其他资源 kind 不被扩大读取。
- [x] 3.2 为新 Agent/Service 设置 json-file 的 16m/4 文件策略，登记实际日志策略版本并兼容已有绑定/adoption。验证：真实 Engine inspect 确认新策略；已有不同驱动/旧 spec hash 实例不因该默认变化强制重建，旧来源能力如实返回。
- [ ] 3.3 按精确实例实际捕获 Context 固定敏感值上下文，实现流式脱敏、归档私有暂存、文件/目录同步、完整发布和 archived 提交（R1）。验证：跨块秘密、旧配置、非法 UTF-8、断电窗口及源消失回归；新旧凭据不同的失败候选/回滚实例分别正确脱敏，上下文缺失不猜配置、不泄密并持久反馈缺口，内部索引不保存敏感值，半归档不当成功。
- [ ] 3.4 将有界归档接入全部 Agent/Service RemoveContainer 路径，逐项覆盖 Apply、Work 删除、Service Restart、定义更新、初始化失败、候选失败/回滚和恢复（R1、R7）。验证：生命周期/故障注入逐路径断言归档先于删除、失败仍继续原操作及其他容器收尾；队列计入 5 秒/剩余预算，重启仍追踪已删除源缺口；真实 Engine 路径证据依 8.6，不能以共享钩子推断全部已测。
- [x] 3.5 建立现存实例来源索引和旧归档/缺口恢复，补充既有双语部署材料中的 Docker 保留、归档容量、升级前不可回填边界。验证：升级/恢复测试保留旧实例与 owner，Work 删除后归档仍按原用户授权，双语材料及 quickstart/路径检查通过。

## 4. Core 导出任务、清单与打包

- [x] 4.1 接入独立 log-exports 三类 API、当前管理员/任务 owner 授权、幂等重放优先、全局单任务及容量/来源预检。验证：coreapp HTTP 测试覆盖普通用户 403 且零来源/暂存 I/O、operator/Agent 拒绝、另一管理员 403、同键并发原 ID/T、新键 busy、严格输入和持久接受失败。
- [ ] 4.2 在接受阶段固定 T/范围及 Core 文件边界，完成无 Work 业务锁的流式收集、实时/归档原实例衔接、去重及真实状态/进度（R2、R4）。验证：接受后轮转不会遗失已引用 T 前内容，失败/重放释放引用；运行中无 Stop/Apply/Run cancel；替换/删除、归档含 T 后记录、Docker/模型未就绪、无 Work、全源不可用和预算行为回归，持久缺口参与结果。
- [ ] 4.3 实现 manifest v1、受管 ZIP、完整密封、长度/hash、ready 原子发布和真实缺口；辅助元数据缺失/损坏不得抹除持久来源/归档事实（R2）。验证：DB 为 partial 且 metadata.json 缺失、损坏或不可核验时仍 complete=false/有 warning，安全可读内容为 partial 否则 unavailable；实际解包核对时间/脱敏/hash，路径注入、磁盘/压缩器故障及半包不能发布，原日志/归档不误删。
- [ ] 4.4 完成 worker/关闭恢复及损坏结果状态持久化：核验确认缺失/损坏先提交 ready→failed、LOG_EXPORT_CONTENT_UNAVAILABLE、result=null，再拒绝内容；保留原 ID/T/幂等和 cleanupPending（R6）。验证：查询、重启及同键重放保持原失败且不重采；普通取消/网络中断不误标损坏；CLI 回归确认服务端 503 时 download exit 5 且无最终文件，show 原 failed/result=null 仍 exit 0；覆盖 collecting、packing、seal 后 ready 前、ready 后故障窗口，无模型/Docker 就绪依赖或隐式改 T。

## 5. 授权下载、保留与清理

- [ ] 5.1 实现不可变 ZIP 流与 attachment/长度/hash/no-store，复核当前会话/角色/owner，下载引用在长内容核验前原子取得并覆盖取消、撤销与并发预算（R6）。验证：慢 hash、阻塞写和发送期间降权/禁用/撤销均在至多 2 秒开始断流；不被截止时间续期覆盖，取消释放槽位；另一管理员拒绝，损坏先持久失败再 503，普通断线不损坏 ready，原包可重下。
- [ ] 5.2 采用 design 已确定的进程内收集/下载租约与容量预留模型，和来源/结果发布、下载准入、过期及 GC 原子协调；持久任务/来源/seal 支持恢复，不伪称持久引用。验证：确定性并发证明检查/取引用/删除无窗口，长 hash 受保护；24 小时后拒绝新下载而有效旧租约可完成，取消无泄漏；清理失败保留 cleanupPending 重试，重启不恢复虚构 FD/租约，不清理其他安装（R5、R7）。
- [ ] 5.3 落实默认来源数、读取并发、单源/总字节、总时间和全区域预算；准入预留 raw/manifest/ZIP/seal，逐次写入前扣减容量，单 ZIP 独立硬限（R5）。验证：小阈值覆盖收集、不可压缩 ZIP 和元数据写入，不能越限完整写完再检查；容量/取消/发布/清理核销一致，内存不随总日志量增长，剩余源明示缺口，不删除有效 ready 包或其他安装资源。

## 6. Linux CLI 导出与恢复

- [x] 6.1 增加 logs export/show/download 语法、帮助、地址/凭证选择、默认目标及幂等键规则，不复用 work export 路由。验证：CLI 测试覆盖所有层级 help 无 I/O、非法/重复/额外参数及 output=- 拒绝、显式/保存 Core 的 origin 隔离、普通用户 exit 3，以及旧业务命令/默认 Desktop 行为保持。
- [x] 6.2 实现单次提交、原任务观察/安全进度、暂时故障退避、真实终态、Ctrl+C 和未知接受恢复。验证：CLI 契约测试覆盖创建响应丢失保留原键、无新键自动重提、超 120 秒仍正常观察、认证失败保留 ID、Ctrl+C=130、show 查询 failed 仍 exit 0。
- [x] 6.3 实现日志 ZIP 二进制下载、同目录 0600 临时文件、长度/hash 校验和无覆盖发布，完成稳定 JSON/文本及部分结果退出行为。验证：下载损坏、截断、同名并发创建、链接路径、传输/发布中断、complete=false 单值 JSON、原 ID 重下/410 不新建等测试通过，不调用 .work Inspect 或把 ZIP 写 stdout。
- [x] 6.4 在既有双语部署手册/单机示例说明管理员登录、远程 Core logs export、logs show/download、缺口、期限及本地保存语义，更新命令帮助。验证：示例以合成账号/地址和实际返回 ID 可执行，与 exit/JSON/API 契约一致；链接及 Docker 材料检查通过，不增加根 README 教程。

## 7. Desktop 同源适配与管理员入口

- [x] 7.1 为独立 Desktop/HostedDesktop 增加显式创建/查询/content 适配，保持当前会话、Host/Origin/CSRF 和选定 Core，纯流式转发 ZIP。验证：Go 适配测试覆盖三条路由、token 不进浏览器/URL、伪造 owner/路径/上游拒绝、普通用户 403、头部及取消传播；后端没有第二份 ZIP 或快照 Inspect 暂存。
- [x] 7.2 在管理员账户菜单增加唯一 Export logs，接入真实 scope/ID/T、收集/打包阶段、缺口/失败/过期及原 ID 查询。验证：DesktopUI 浏览器测试覆盖普通用户不显示、伪造直接请求拒绝、无当前 Work/无自有 Work可用、360px/键盘/焦点与现有组件语义，以及无隐式 Stop/Apply。
- [ ] 7.3 完成身份交付意图和最多一次自动下载；POST 返回 ready（含原键恢复）先 GET 原 ID 详情，详情失败保持已知 ID/原键，只读恢复（R3）。验证：浏览器回归覆盖响应丢失后同键 ready、详情暂失重试、filename/hash/expiry/缺口齐全后交付、原包 Download again；刷新/重新登录只读、切换身份撤销、晚/重复响应不重下，不自动新键提交或宣称本地保存。
- [x] 7.4 构建 DesktopUI 并同步 Go 嵌入资源，维护既有双语使用材料中的管理员 UI 入口、阶段及浏览器下载说明。验证：`npm run typecheck -w @piwork/desktop-webui`、`npm run test:browser -w @piwork/desktop-webui`、workspace build 与宿主重建通过，实际新 UI 可见；双语入口/边界和源码一致。

## 8. 集成闭环验收

- [ ] 8.1 以隔离安装在 Linux 二进制和 Core 容器数据挂载两种部署分别完成真实 Agent/Service 输出、轮转、归档、CLI 导出、校验与重启保留（R4、R7）。验证：矩阵逐部署列实际程序/镜像身份及结果，ZIP 字节/hash/manifest 对应来源，超过旧 tail 仍完整；容器行依 8.5，未跑不勾选，历史二进制结果不能替代容器证明。
- [x] 8.2 用真实浏览器完成托管和独立 Desktop 导出下载，托管客户端网络仅允许 UI 17891；并发管理员 A/管理员 B/普通用户，覆盖只导出 A 自有内容和 Core 安全日志、B 拒绝 A 任务、普通用户拒绝、下载中撤销。验证：真实浏览器下载文件与 Core/CLI hash 相同，请求记录无浏览器直连 17871、token 泄漏、重复自动交付或其他用户正文。
- [ ] 8.3 完成受控网络、磁盘、超时、收集期替换/删除、进程重启和过期竞争的跨组件验收（R7）。验证：逐项依 8.6–8.10 记录真实过程或注入边界，核对状态、清单、幂等、清理/租约、有界关闭及旧 Service tail/.work 回归；未跑行保留限制且本项不完成，清理仅针对本次精确安装。
- [x] 8.4 完成适用集成构建和仓库门禁，逐项核对契约、默认预算、部署生成材料及嵌入资源。验证：`make build`、`make build-cli`、相关 Go/跨语言/浏览器及 integration 检查、`node scripts/check-native-boundary.mjs`、`node scripts/check-repository-docs.mjs`、两项 Docker quickstart 检查、`openspec validate add-log-export --strict` 与 `git diff --check` 均有实际结果；不将本机验收扩展为推送/发行或默认归档。

- [ ] 8.5 Core 容器部署矩阵：真实持久数据挂载、Agent/Service 输出和日志轮转、导出后重启/重建。验证：独立于二进制行记录镜像/程序身份，重启后 Core 分片及 Work 归档保留；实际 ZIP 解包、hash、权限与原来源匹配，不以原生进程替代容器结果。
- [ ] 8.6 真实生命周期矩阵：Service 定义更新、初始化失败、失败候选回滚、恢复实例后续移除和归档失败继续。验证：新旧合成凭据不同，逐路径核对实际 Context/配置版本、sourceId、归档先于删除、脱敏及有界失败继续/重启缺口；与 3.4/9.5 共用证据但每行独立结论。
- [ ] 8.7 真实收集与替换/删除竞争矩阵。验证：收集被控暂停时替换 Agent/Service 或删除 Work，按原实例/归档衔接且只纳入一次、不含 T 后内容、不换取新实例；Work/其他服务保持既有运行行为，无法确认内容明确缺口，确定性并发回归与真实 Engine 证据分别记录。
- [ ] 8.8 存储/网络/时间与重启矩阵：小磁盘/写入故障、raw/ZIP 容量、慢源/超时/断网，以及 collecting、packing、seal 后 ready 前、ready、cleanupPending 的进程重启窗口。验证：逐行区分注入、真实文件系统和进程证据；预算不事后越限、原 ID/T/幂等不变、损坏持久失败、半包不可下载、清理失败可追踪重试且关闭有界。
- [ ] 8.9 下载许可与 GC 矩阵：慢完整性核验、发送中及阻塞客户端的撤销，下载准入/过期/GC 同时发生，取消和超时。验证：至多 2 秒开始撤销，保护有效原引用，禁止过期新许可且无槽位泄漏；普通断线保留原 ready/原字节，确认损坏才持久失败；记录真实 HTTP/进程与确定性并发测试各自边界。
- [ ] 8.10 真实 GUI 闭环矩阵：托管与独立 Desktop 均仅通过 GUI 完成唯一入口、故障 Work 导出、部分清单、创建响应丢失后原键 ready 恢复、详情暂失、刷新/身份切换及原包重下。验证：用户无需命令即可得到可交维护者的 ZIP，同意图最多自动一次、重下 hash 相同、权限隔离且托管浏览器仅连 UI；截图、网络、下载文件/hash/manifest 路径和实际版本记于本 change 证据，临时产物置 dist，不声称自动上传。

## 9. 验证整改

- [x] 9.1 归档来源存在无法解析 Docker 时间戳的记录时，`copyArchiveFile`/`copyArchivedSource` 返回 unknown，来源标记 partial 并在 manifest/任务 warning 说明，确保 complete=false。验证：畸形时间戳归档测试断言 partial、warning 和 complete=false。
- [x] 9.2 下载发送响应头和包体前校验任务结果记录、seal、文件长度与 SHA-256 一致；同尺寸替换或损坏返回 LOG_EXPORT_CONTENT_UNAVAILABLE。验证：测试夹具生成 seal/result，覆盖同尺寸损坏拒绝和原文件重下。
- [x] 9.3 `Manager.Boundary` 在冻结分片身份和字节上界前同步 active shard。验证：边界调用触发 sync hook，导出边界包含已同步尾部。
- [x] 9.4 增加 Docker 不可用、收集期实例替换回退归档、pack/磁盘故障注入、慢读取请求取消，以及活动下载与过期 GC 竞争测试。验证：任务状态、缺口清单、临时文件清理和下载槽释放符合契约。
- [ ] 9.5 补齐真实 Engine 的 Apply、Service Restart、Service 定义更新、初始化失败、候选失败/回滚及恢复实例移除矩阵（R1、R7）。验证：每路径观察原 sourceId 归档先于删除，新旧配置凭据不同仍正确脱敏；归档失败继续且缺口跨重启保留，与 3.4/8.6 共享实际证据，不能用相同钩子代替未执行路径。
- [x] 9.6 增加 CLI 取消映射 exit 130 的测试；真实浏览器覆盖 partial 结果缺口与 `Download again` 原包重下。验证：取消保留原 ID，重复下载字节一致且不新建任务。
- [ ] 9.7 按现有实现已删除 LogReference/LogReferenceKey 的事实修正记录模型，明确持久任务/来源/结果与进程内有界引用/预留的区别（R7）。验证：design、任务与代码无持久租约的虚假声明，5.2 的准入/核验/GC 原子竞争及重启回归实际通过后才完成；本轮只完成规划描述，未据此勾选实现。
