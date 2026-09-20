# Tasks

## 1. 项目骨架与 SDK 适配验证

- [x] 1.1 建立 Node 24 / TypeScript npm workspaces，创建 apps/core、agentd、cli、console 及 design 中列出的 packages，保留 demo 独立样例；验证 workspace 安装、typecheck 和 build 成功。
- [x] 1.2 锁定 pi SDK 的实际版本并在 pi-adapter 中验证 create/load Session 的持久路径和 ID 行为；通过跨进程保存、退出、重载同一历史的 SDK 集成用例证明可恢复。
- [x] 1.3 验证 SDK 的指定 Skill 加载、工具注册和 abort 接口，建立确定性模型及 stdio/HTTP MCP fixtures；通过真实 SDK 加载 Skill、调用 fixture 工具、取消受管执行的 smoke 用例并记录接口选择。
- [x] 1.4 建立根级 typecheck/build/test/test:integration 命令及隔离测试资源规则；验证普通测试不需要真实模型凭证，Docker 测试只创建和清理本次 installation_id 资源。

## 2. 协议和持久数据模型

- [x] 2.1 在 contracts 定义用户、WorkConfig、ServiceDefinition、Operation、配额和错误码的控制/内部 API schemas；验证合法样例通过、非法字段和未支持限制被拒绝，生成类型可编译。
- [x] 2.2 定义 Session、SubmitRun、GetRun、WatchRun、CancelRun Proto，包含幂等键、游标和终态；生成客户端/服务端类型并通过序列化往返测试。
- [x] 2.3 建立 Core SQLite 初始迁移、单实例锁和 design 中的持久实体；验证空库升级、重复迁移、重开数据库和第二 Core 拒绝启动。
- [x] 2.4 实现 Core 幂等记录、期望版本、Operation 和 tombstone 的事务接口；通过并发提交与中途失败测试确认同键不重复、异内容冲突且不会部分提交。
- [x] 2.5 建立 Work Store 的 Session 索引、Run、事件和活动槽；通过数据库重开及事务测试确认一次接受只产生一个 Run，SDK 历史只由适配器维护。

## 3. 用户初始化、登录与权限

- [x] 3.1 实现本机 bootstrap-admin、密码摘要和账号唯一性；测试空实例初始化、重复拒绝、无公共默认密码以及凭证不进入日志。
- [x] 3.2 实现登录、注销、会话绝对过期和失败登录限流；通过有效/错误/禁用账号及虚拟时钟测试验证 24 小时与 5 次/分钟默认值和可配置行为。
- [x] 3.3 实现用户创建、列出、启用、禁用、密码重置和最后管理员保护；验证普通用户被拒绝、旧会话撤销以及重新启用不恢复旧 token。
- [x] 3.4 实现 Work 所有者、管理员控制权限和会话正文权限区分；对 Work、Run、服务、Operation、留存卷执行表驱动授权测试并验证跨用户查询不泄漏资源。
- [x] 3.5 实现浏览器安全 cookie、Origin/CSRF 检查以及查询和日志脱敏；通过伪造来源、缺失 token 和诊断输出测试确认拒绝与脱敏。

## 4. 环境配置、目录与 secret 引用

- [x] 4.1 实现兼容镜像、Skill 制品、模型配置和 secret 引用的管理员 API，普通用户仅选择获准条目；测试权限、重复标识、秘密写入及查询不返回明文。
- [x] 4.2 实现 WorkConfig 不可变 revision、expected_revision 校验和 desired/active 查询；测试并发更新冲突及运行配置修改不直接重启 daemon。
- [x] 4.3 实现镜像 tag 初次解析后绑定 digest、兼容入口校验和 Skill 摘要验证；使用受控制品 fixture 验证来源 tag 改变不改变原 revision。
- [x] 4.4 实现配置结构、模型可用引用、MCP 参数、资源上限和 secret 归属验证；验证无效引用及 UNSUPPORTED_LIMIT 拒绝不会创建运行实例。
- [x] 4.5 实现配置物化和按需 secret 注入，隔离 /var/data、/var/session、/var/cache、/run/piwork；用测试镜像核对文件权限、实际路径和无宿主 Skill 隐式加载。

## 5. 容器运行时与持久卷

- [x] 5.1 实现 Runtime Adapter 的镜像准备、容器创建/检查/停止/删除以及确定标签；在 Docker 集成测试中验证按逻辑 ID 重试不会重复创建实例。
- [x] 5.2 实现 Work 私有网络、服务别名、禁止宿主端口暴露及跨 Work 隔离策略；在两个真实 Work 网络中验证内部访问成功、跨网访问和非法宿主访问被拒绝。
- [x] 5.3 实现受管卷创建、归属、挂载权限和重挂载；测试数据在容器替换后保留、只读挂载写入失败、跨 Work/路径越界被拒绝。
- [x] 5.4 实现非特权容器和实际 CPU/内存限制，下发禁用 runtime 自动重启策略；检查容器配置并验证 socket、host network、任意 bind mount 请求被拒绝。
- [x] 5.5 实现留存卷记录、引用检查、显式 purge 和卷数量核算；测试删除保留数据、引用中 purge 冲突和重启后的清理继续。
- [x] 5.6 实现资源缺失、Runtime 不可达、卷不可写和磁盘不足的错误映射；验证不会用空卷替代丢失数据或将未知容器报告为已停止。

## 6. Work 生命周期协调

- [x] 6.1 实现 Work create/list/show/start/stop/retry/delete 和 Operation 查询 API；通过真实 HTTP 往返验证授权、幂等、立即返回操作 ID 和异步结果。
- [x] 6.2 实现每 Work 协调队列、期望/观察状态与 superseded 语义；使用 fake Runtime 验证 start/stop/delete 竞争最终遵循最新持久目标。
- [x] 6.3 实现网络/卷准备、daemon 启动、代次注册和 readiness 状态，预留附属服务协调接口；测试未就绪不开放连接、有效主实例数量不超过一个。
- [x] 6.4 实现 Core 启动扫描与接管、孤立资源报告和未完成 Operation 恢复；在“资源已创建、结果未写回”故障点终止 Core，验证重启接管且不重复创建。
- [x] 6.5 实现健康检查、持久重试预算和显式 retry；通过虚拟时钟和 Core 重启测试验证退避、次数上限及稳定运行重置。
- [x] 6.6 实现 Work drain/停止/删除顺序和超时升级，Core 正常退出保留容器；验证未知停止状态不报成功、停止的 Work 在控制服务/宿主恢复后不被拉起。

## 7. 持久 agent 执行

- [x] 7.1 将 SDK 封装和事件映射移植到 pi-adapter/agentd，提供身份校验、readiness 和 drain 接口；验证模型凭证状态与用户登录字段分离。
- [x] 7.2 实现 Session create/list/read/continue 与历史重载；真实 SDK 用例验证 daemon 重启后同一 Session ID 包含先前历史。
- [x] 7.3 实现 SubmitRun 的持久接受、提交键和 Work 活动槽；并发测试验证同 Work 不同 Session 最多一个 Run，不同 Work 可并行，相同提交重试复用结果。
- [x] 7.4 实现后台执行、进度事件、最终结果和失败持久化；测试提交/观察连接断开不 abort，以及模型失败不停止 Work。
- [x] 7.5 实现显式 CancelRun、cancelling 状态和受管工具收尾；测试完成/取消竞争只有一个终态，未结束任务不提前释放活动槽。
- [x] 7.6 实现启动时将旧活动 Run 转为 interrupted，保留部分结果与 SDK 历史；在外部副作用 fixture 后终止 daemon，验证恢复不重复执行该副作用。
- [x] 7.7 实现持久事件序号、有界保留及最早游标查询；测试最近 10,000 条/终态后 24 小时策略、游标过期与最终结果可查询。

## 8. Skills 与 MCP 实际接入

- [x] 8.1 实现固定制品 Skill 物化、SDK 加载及实际加载状态报告；验证正常指令进入上下文，摘要/格式/名称错误阻止 ready。
- [x] 8.2 实现下次启动应用新的 Skill 集合；通过先加载后移除再重启测试确认旧缓存和隐式宿主 Skills 不生效。
- [x] 8.3 实现 stdio MCP 连接、工具发现、参数验证及 server 命名空间；调用两个同名 fixture 工具验证路由正确。
- [x] 8.4 实现 Streamable HTTP MCP、secret 引用和 required/optional 语义；通过可用/断开 fixture 验证必需失败阻止 ready、可选失败不阻止对话。
- [x] 8.5 实现 MCP 调用超时、有限重连和本地进程组回收；验证超时不自动重复工具调用，Work 停止后本地进程无泄漏且远程服务仍在运行。

## 9. agent 自主管理容器服务

- [x] 9.1 实现 ServiceDefinition revision、名称唯一性、幂等接受和 Operation API；测试先提交定义再启动 Runtime、重复请求不重复占用配额。
- [x] 9.2 实现 Work/宿主预算的原子预留、实际释放和服务/留存卷数量限制；测试竞争创建不会超额，禁用未停止时预算不提前释放，stopped Work 保留启用服务预算。
- [x] 9.3 实现服务实例协调与 Work 启停集成，保留 enabled 并恢复卷；真实 Docker 用例验证停止后重启恢复同一服务身份和数据，无 agent 重复创建调用。
- [x] 9.4 实现服务 update/restart/enable/disable/remove、版本历史和失败查询；测试禁用不误拉起、更新失败不回滚数据、stopped/disabled 的 restart 返回前置条件错误。
- [x] 9.5 实现服务 readiness、健康检查、降级和有界恢复；测试进程存活但未就绪不报成功，非必需服务失败仍允许 agent 连接。
- [x] 9.6 将服务管理工具注册到真实 pi SDK，通过 Resource Client 携带 Work 运行身份提交；使用确定性模型驱动工具创建 fixture 服务并验证 agent 得到可用端点。
- [x] 9.7 实现 Work stopped 时预配置服务，以及 required MCP 对本 Work 服务的显式启动依赖；测试服务先于 required MCP 就绪，不存在/循环依赖被拒绝。
- [x] 9.8 实现 stopping/deleting 期间拒绝新服务操作及晚到实例收尾；在创建服务中途停止 Work，验证最终所有容器停止且已接受定义保留。

## 10. 连接网关与运行身份

- [x] 10.1 实现外部 TLS 入口、安装 CA 与 Core/Work mTLS 身份的签发和持久保存；验证 Core 重启后可认证接管原 daemon，错误主体和旧代次被拒绝。
- [x] 10.2 实现内部 API 与 daemon 转发身份校验、Work 归属和有效代次检查；测试跨 Work、伪造 user_id、直接访问及旧实例迟到修改被拒绝。
- [x] 10.3 实现登录 discovery、按 Work ID 定位当前 ready 实例和 gRPC 转发；真实 gRPC 用例验证实例地址变化无需修改 Client、stopped/unknown 不触发隐式启动。
- [x] 10.4 实现 WatchRun 的游标重放和每流 1 MiB 背压；验证一个慢观察者断开不阻塞其他观察者或 Run，过期游标返回 CURSOR_EXPIRED。
- [x] 10.5 接入用户禁用/注销/会话到期的观察连接撤销；测试连接关闭而 Run 继续，另一个仍有效登录会话不受单会话注销影响。
- [x] 10.6 验证 HTTP、gRPC status 和业务终态的映射；通过部分事件后传输故障用例确认 Client 不把观察失败显示为确定的 Run 失败。

## 11. 最小 CLI

- [x] 11.1 建立 client-sdk 的控制与 Agent API 封装、凭证保存及 discovery；通过本地用户权限与 TLS 集成用例验证不持有容器管理凭证。
- [x] 11.2 实现 login/logout 和 work create/list/show/start/stop/retry/delete；脚本化验收登录、指定配置创建、等待 Operation、查询和停止完整链路。
- [x] 11.3 实现 chat、Session 选择、run show/watch/cancel 和 Ctrl-C 显式取消；验证续接历史、流式显示和取消状态。
- [x] 11.4 实现连接中断后的状态查询、游标重连和过期回退提示；模拟断网验证不自动重复提交 prompt 且无需配置容器地址。

## 12. Core 控制面板

- [x] 12.1 建立 Console 登录、当前身份和管理员用户管理页面；浏览器验收创建、禁用、密码重置与普通用户拒绝。
- [x] 12.2 建立镜像、Skill、模型与 secret 引用管理表单；验证可录入基础运行配置且保存后 secret 不重新显示。
- [x] 12.3 建立 Work 创建、配置 revision、启停、Operation 和失败状态页面；浏览器验收待重启应用、创建失败重试以及管理员控制权限不开放会话正文。
- [x] 12.4 建立服务列表、定义编辑、启禁用、重启、删除与留存卷清理页面；验证状态与 API 一致，默认删除保留数据，明确 purge 才清除指定卷。

## 13. 故障恢复与完整闭环验收

- [x] 13.1 建立完整自动验收：bootstrap → 用户管理 → CLI 登录 → Work 配置 → 对话 → agent 创建服务 → 写入数据 → 停止/启动；验证身份、配置版本和数据校验值均符合 specs。
- [x] 13.2 在 Core 接受定义前后、容器创建后结果写回前、删除中途注入进程退出；验证 Operation 可恢复、资源不重复、删除不误恢复。
- [x] 13.3 覆盖 daemon 崩溃、Core 单独退出、宿主重启等效恢复及 Runtime 不可达；验证单主实例、旧 Run interrupted、running/stopped 期望状态保持。
- [x] 13.4 使用至少两个用户和两个 Work 执行跨 Work API、网络、卷和运行身份拒绝用例；验证普通用户无法读取他人状态，管理员控制权不等于对话访问权。
- [x] 13.5 覆盖磁盘/卷不可写、镜像失败、Skill 无效、MCP required/optional 故障、重试预算耗尽和慢观察者；验证可观察错误及故障边界符合对应 scenario。
- [x] 13.6 将 11 份 capability 的 requirement/scenario 对应到已有自动用例或明确人工验收记录；执行完整 typecheck、build、测试与独立 demo 回归，报告任何未覆盖场景。

## 14. 单机交付与运行文档

- [x] 14.1 提供兼容 agent 镜像、Core 服务启动配置、Console 制品和最小配置示例；在干净 Linux/Docker 环境按文档完成启动并验证 readiness。
- [x] 14.2 编写首次管理员初始化、TLS/CA 信任、模型 secret、镜像/Skill 录入及最小 MCP 示例；由空数据目录完成首次用户登录和真实 SDK 对话 smoke，验证全程不需要未记录的手工配置。
- [x] 14.3 编写启停、Core 恢复、服务失败、磁盘不足、留存数据清理及备份/回退指南；演练指定安装资源的停止与恢复，确认无全局 Docker 清理和无 demo 自动迁移。
- [x] 14.4 将实际实现与架构文档核对并更新实现状态和验证记录；运行 OpenSpec 严格校验，确认所有任务有完成证据后再进入后续归档流程。
