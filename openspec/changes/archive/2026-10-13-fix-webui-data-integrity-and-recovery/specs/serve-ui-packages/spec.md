## MODIFIED Requirements

### Requirement: 区分上传、接受和持久 Operation

**Identifier:** SUI-PKG-003

本地来源 SHALL 依次显示浏览器上传进度、服务端校验/传送、提交接受和后台准备；上传成功不等于安装成功。每次新的安装/更新意图 SHALL 生成稳定幂等键；同一次提交在等待响应时禁用重复按钮。得到 acceptance 后 SHALL 显示并可复制 Operation ID，转到可刷新和直接访问的操作详情 URL，串行每 2 秒查询一次，非终态始终沿用同一 ID。显示 state、packagePhase、可用的包名、时间、result 及安全 stage/code/message，不显示原始脚本日志。

观察失败 SHALL 保留 ID 和最后已知状态，标记连接失败并提供恢复查询，不提交新安装。关闭页面、会话到期或面板重启 SHALL 不取消 Core 已接受任务。收到明确 failed/superseded 后，用户可返回表单以新幂等键显式重试；重新选择本地内容后才可重新上传。接受响应丢失时 SHALL 提供英文“Resume this submission”，在当前页保存的同一 actor、source 和 key 下重放，不能自动换 key。本版不提供取消包任务或伪造整体百分比。

阶段展示 SHALL 根据真实 `packagePhase` 映射：`queued` 为 Accepted、`source` 为 Resolving、`prepare` 为 Preparing、`validate` 为 Validating、`publish` 为 Publishing、`succeeded` 为 Published。SHALL 保留可读取的原始阶段值，阶段条明确当前步骤；仅提交接受时可显示 Submission accepted，但不能捏造 Core 尚未报告的 packagePhase。终态以真实 state 为准，失败或被取代不能标记后续发布步骤成功；`cleanup-pending` 显示 Cleanup pending 及安全说明，不视为 Published。未知阶段 SHALL 显示英文未识别提示及原值，按真实 state 决定是否继续观察，不猜测完成比例或成功。

#### Scenario: 响应丢失后恢复接受
- **WHEN** Core 已接受但浏览器未收到 acceptance，当前页面仍保留原提交信息
- **THEN** 用户显式恢复提交使用同一 key 和语义来源，取得原 Operation 且不再次安装

#### Scenario: 停止观察
- **WHEN** 已取得 ID 后关闭页面或网络中断
- **THEN** Core 继续任务，面板再次按 ID 查询显示同一任务的持久状态

#### Scenario: 准备失败后显式重试
- **WHEN** Operation failed，管理员返回表单并重新提交
- **THEN** 新意图使用新 key，旧失败记录保持可查，不将旧 key 的 failed 重放误报为新的尝试

#### Scenario: 真实包阶段顺序推进
- **WHEN** Core 依次报告 queued、source、prepare、validate、publish 和 succeeded
- **THEN** 当前步骤按真实值依次推进，只有确认成功才显示 Published，详情继续显示原始 packagePhase；始终查询同一 Operation

#### Scenario: 失败及清理待完成
- **WHEN** Core 报告 failed、superseded 或 cleanup-pending
- **THEN** 界面展示实际状态与安全诊断，不点亮尚未完成的发布步骤，不提交重试或取消原操作

#### Scenario: 接受后尚无阶段或返回未知阶段
- **WHEN** 仅收到 acceptance，或后续查询返回 UI 尚未识别的阶段
- **THEN** 前者只确认提交已接受，后者保留原值并说明未识别；均不伪造发布成功，非终态仍按原 Operation ID 观察
