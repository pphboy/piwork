# Spec Delta

## MODIFIED Requirements

### Requirement: 安装和更新四种 package 来源

**Identifier:** SUI-PKG-002

安装与更新表单 SHALL 支持 npm spec、Git spec、本地目录和本地 ZIP 四种互斥来源；npm/Git 以文本输入，目录/ZIP 由浏览器选择并上传内容，不发送客户端路径作为 Core 路径。切换来源 SHALL 清除不适用的选择并在放弃已选文件前确认。安装 SHALL 提供默认关闭且按所选界面语言显示的“Add to Default Work after installation”对应选项；更新 SHALL 显示不可编辑的目标 name、要求显式新来源，保持 enabled 和默认引用，不提供该选项。

包身份 SHALL 由 Core 校验 package.json.name 决定，不能从目录或文件名猜测；目录模式要求根 package.json。ZIP 沿用根 manifest 或唯一外层目录规则，不能把 .work 文件当作 Pi package。目录选择只传浏览器提供的普通文件，不承诺空目录、执行位或符号链接；页面 SHALL 提示需要保留执行权限或链接时使用 ZIP。ZIP 上限 256 MiB、展开内容 1 GiB、单文件 64 MiB、100,000 条目、64 层和 manifest 1 MiB SHALL 按实际来源由客户端预检可知部分，Core 完整重验。不得提供私有源交互登录或把明文凭据拼入 npm/Git URL。

#### Scenario: 四类来源均可安装
- **WHEN** 管理员分别选择有效 npm、Git、本地目录或单根 ZIP
- **THEN** 各流程最终由 Core 返回 manifest name 和 Operation，文件来源不要求 Core 拥有浏览器机器的目录

#### Scenario: 原子安装并加入默认
- **WHEN** 勾选加入默认并提交安装
- **THEN** 成功终态后新包与默认选择同时可见；失败时两者都不新增该包

#### Scenario: 更新错误名称
- **WHEN** 更新 tools 所提供来源的 manifest name 是 other
- **THEN** 显示 PI_PACKAGE_NAME_MISMATCH，原 tools 内容、enabled 和默认引用不变

#### Scenario: ZIP 或目录不可用
- **WHEN** 输入超限、多根 ZIP、非法结构、目录缺 manifest，或浏览器不支持目录选择
- **THEN** 显示对应错误或建议改用 ZIP，不能回退为填写服务器路径

### Requirement: 区分上传、接受和持久 Operation

**Identifier:** SUI-PKG-003

本地来源 SHALL 依次显示浏览器上传进度、服务端校验/传送、提交接受和后台准备；上传成功不等于安装成功。每次新的安装/更新意图 SHALL 生成稳定幂等键；同一次提交在等待响应时禁用重复按钮。得到 acceptance 后 SHALL 显示并可复制 Operation ID，转到可刷新和直接访问的操作详情 URL，串行每 2 秒查询一次，非终态始终沿用同一 ID。显示 state、packagePhase、可用的包名、时间、result 及安全 stage/code/message，不显示原始脚本日志。

观察失败 SHALL 保留 ID 和最后已知状态，标记连接失败并提供恢复查询，不提交新安装。关闭页面、会话到期或面板重启 SHALL 不取消 Core 已接受任务。收到明确 failed/superseded 后，用户可返回表单以新幂等键显式重试；重新选择本地内容后才可重新上传。接受响应丢失时 SHALL 提供所选界面语言的“Resume this submission”对应入口，在当前页保存的同一 actor、source 和 key 下重放，不能自动换 key。本版不提供取消包任务或伪造整体百分比。

阶段展示 SHALL 根据真实 `packagePhase` 映射并以所选界面语言呈现（以下为英文版本）：`queued` 为 Accepted、`source` 为 Resolving、`prepare` 为 Preparing、`validate` 为 Validating、`publish` 为 Publishing、`succeeded` 为 Published。SHALL 保留可读取的原始阶段值，阶段条明确当前步骤；仅提交接受时可显示 Submission accepted，但不能捏造 Core 尚未报告的 packagePhase。终态以真实 state 为准，失败或被取代不能标记后续发布步骤成功；`cleanup-pending` 显示 Cleanup pending 及安全说明，不视为 Published。未知阶段 SHALL 显示所选界面语言的未识别提示及原值，按真实 state 决定是否继续观察，不猜测完成比例或成功。

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
