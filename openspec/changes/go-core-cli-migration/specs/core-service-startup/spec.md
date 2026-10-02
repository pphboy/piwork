## MODIFIED Requirements

### Requirement: Recover Core and Work state across restart

Core 重启时 SHALL 恢复用户、登录会话、Work 和每个 Work 的 desired/active 配置版本。恢复过程 MUST 使用 Work 保存的配置，不得用新的全局默认配置替换已有 Work。Go 安装使用自身支持的持久格式进行恢复；不要求接管旧 TS 安装。Core 优雅退出后的重启 SHALL 按保留的 desired 状态恢复受管容器；异常退出后 SHALL 先核验残留资源和当前代次，再接管或恢复，不能创建第二个有效主 daemon。

#### Scenario: Continue after restart with changed defaults
- **WHEN** Work A 使用 model-a，Core 停止后全局默认改为 model-b，再次启动并恢复 Work A
- **THEN** Work A 继续使用 model-a，原有 Session 可继续，且不会创建第二个实例

#### Scenario: Continue after Core restart
- **WHEN** Go Core 完成优雅退出并确认受管容器停止，随后使用同一数据目录启动
- **THEN** 原有有效登录 token 仍有效，desired-running Work 及 enabled 服务恢复，用户可继续原 Session；desired-stopped Work 保持停止

#### Scenario: Recover an incomplete create operation
- **WHEN** Core 在 Docker 创建 agentd 容器之后、create Operation 终态之前异常退出并重启
- **THEN** recovery 识别并核验对应资源，接管或安全协调原 Operation，不创建重复 Work 实例

#### Scenario: Recover before reopening access
- **WHEN** 新进程正在核对 Agent 代次、Service 容器或残留文件 helper
- **THEN** 未完成核验的路由与写入入口保持关闭，安全查询可显示恢复中或具体故障

### Requirement: Shut down Core without destroying running Works

Core 收到 `SIGINT` 或 `SIGTERM` 后 SHALL 关闭 HTTP/runtime mutation 与文件准入、将 readiness 置为不可用，并按 `work-lifecycle` 有界 drain 和停止受管 Agent、Service 与平台 helper。正常退出前 SHALL 确认停止结果；持久 desired 状态、service enabled、配置、会话与卷数据 MUST 保留，不将进程退出解释为用户 Stop 或 Delete。

默认 drain 30 秒、终止确认 10 秒，跨 Work 并发停止时进程总期限为 45 秒。存在未确认资源、超时或清理失败 SHALL 保留恢复记录、输出安全诊断并非零退出，不得报告干净停止。一个 Agent 无法 drain MUST NOT 跳过其他 Service/helper 的停止。最后 SHALL 关闭传输和存储并释放 listener 与存储锁。

#### Scenario: Stop Core and reopen its store
- **WHEN** Core 收到 SIGTERM 并完成优雅退出
- **THEN** 受管运行容器已确认停止，卷和 desired 状态保留，新 Core 能打开同一目录并按 desired 恢复

#### Scenario: Bound a stalled shutdown
- **WHEN** HTTP、Agent、Docker 或 helper 操作在退出期限内仍无法完成
- **THEN** Core 有界关闭剩余连接并非零退出，保留未完成诊断供下次恢复，不谎报 Work stopped

#### Scenario: Preserve service selection through shutdown
- **WHEN** 一个 Work 含 enabled 服务和 disabled 服务，Core 优雅退出后再次启动
- **THEN** 只恢复 desired-running Work 中的 enabled 服务，退出过程不改写这些选择或删除数据

## REMOVED Requirements

### Requirement: 安全升级已有 Core 网络身份存储

**Reason**: 产品尚未发布，本次不迁移历史 TS Core 安装；主规格要求 schema 8→9 的规则也与现有 TS schema 10 不一致。

**Migration**: 由“初始化并核验 Go Core 持久存储”取代；使用独立空数据目录。旧开发数据保留，不自动升级、清空或接管。

## ADDED Requirements

### Requirement: 初始化并核验 Go Core 持久存储

**Identifier:** CST-NATIVE-001

Go Core SHALL 为全新安装建立明确标识为 `piwork-go-core`、schemaVersion=1 的存储，并原子初始化所需业务表、安装身份和约束。该版本标识与 TS Core schema 8/9/10 及 Agent history schema 3 分离。已支持的 Go 存储 SHALL 保留安装、用户、登录、Work、Operation、网络身份、文件任务及快照/包状态并按现有规则恢复。

不支持的格式、未知版本、损坏 marker 或无法识别的非空目录 SHALL 在执行数据库迁移、创建 Docker 资源和开放业务路由前明确失败，不静默重建、清空、降级或猜测转换。首次初始化中断只允许从可证明属于本次 Go 初始化的未完成记录恢复，不能据此接受任意非空目录。存储锁 SHALL 保证单一 Core 所有者，未持锁进程不得修改存储。

Work 与 service 的稳定网络身份 SHALL 在对应创建/导入事务发布时分配并持久化；Core 完成 recovery 与容器核验之前不得开启网关。业务重启恢复与 `.work` V1 导入仍为必要能力，不因取消历史安装升级而省略。

#### Scenario: 空目录首次启动
- **WHEN** Core 指向新的空数据目录
- **THEN** 初始化合法 Go 存储并启动健康接口，未初始化管理员/runtime 时显示相应状态，不创建默认用户或 Work

#### Scenario: 同格式重新启动
- **WHEN** Go Core 重启并读取支持的完整 Go 存储
- **THEN** 使用原安装身份和网络身份恢复，不重新分配 Work 域名、不清空 Operation 或配额

#### Scenario: 拒绝旧开发目录或未知版本
- **WHEN** 目录含旧 TS 数据、未知 Go schemaVersion 或无合法 marker 的非空库
- **THEN** 启动非零退出并说明应使用独立支持的数据目录，原数据及 Docker 资源不被修改

#### Scenario: 初始化中断或第二个所有者
- **WHEN** 初始化事务中断后重试，或另一进程已持有目录锁
- **THEN** 前者仅恢复可证明属于 Go 的未完成初始化，后者拒绝；两种情况均不产生部分可用的业务库或并行写入者
