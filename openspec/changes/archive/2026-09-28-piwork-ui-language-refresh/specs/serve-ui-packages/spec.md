# Spec Delta

## MODIFIED Requirements

### Requirement: 安装和更新四种 package 来源

**Identifier:** SUI-PKG-002

安装与更新表单 SHALL 支持 npm spec、Git spec、本地目录和本地 ZIP 四种互斥来源；npm/Git 以文本输入，目录/ZIP 由浏览器选择并上传内容，不发送客户端路径作为 Core 路径。切换来源 SHALL 清除不适用的选择并在放弃已选文件前确认。安装 SHALL 提供默认关闭的英文“Add to Default Work after installation”选项；更新 SHALL 显示不可编辑的目标 name、要求显式新来源，保持 enabled 和默认引用，不提供该选项。

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

观察失败 SHALL 保留 ID 和最后已知状态，标记连接失败并提供恢复查询，不提交新安装。关闭页面、会话到期或面板重启 SHALL 不取消 Core 已接受任务。收到明确 failed/superseded 后，用户可返回表单以新幂等键显式重试；重新选择本地内容后才可重新上传。接受响应丢失时 SHALL 提供英文“Resume this submission”，在当前页保存的同一 actor、source 和 key 下重放，不能自动换 key。本版不提供取消包任务或伪造整体百分比。

#### Scenario: 响应丢失后恢复接受
- **WHEN** Core 已接受但浏览器未收到 acceptance，当前页面仍保留原提交信息
- **THEN** 用户显式恢复提交使用同一 key 和语义来源，取得原 Operation 且不再次安装

#### Scenario: 停止观察
- **WHEN** 已取得 ID 后关闭页面或网络中断
- **THEN** Core 继续任务，面板再次按 ID 查询显示同一任务的持久状态

#### Scenario: 准备失败后显式重试
- **WHEN** Operation failed，管理员返回表单并重新提交
- **THEN** 新意图使用新 key，旧失败记录保持可查，不将旧 key 的 failed 重放误报为新的尝试

### Requirement: 按 ID 找回 Core 包操作

**Identifier:** SUI-PKG-004

“Find Operation”页 SHALL 接受 Operation ID，查询 Core package Operation 并复用同一详情视图。空或格式无效 ID SHALL 在本地提示；不存在及属于 Work scope 的 ID SHALL 返回相同不可用提示。任一启用管理员可以查询已知 ID 的 Core package 操作，包括其他管理员或 operator 创建的操作，不读取其上传内容。查询非终态可恢复轮询，终态停止轮询。复制功能失败时 SHALL 提供可选中文本。页面 SHALL 不宣称能自动找回未保存的 ID，也不维护跨设备最近任务列表。

#### Scenario: 在另一台设备恢复查询
- **WHEN** 管理员在另一浏览器登录后粘贴保存的 Core Operation ID
- **THEN** 显示持久状态，进行中任务继续观察，完成任务显示原结果

#### Scenario: 尝试查询 Work Operation
- **WHEN** 输入 Work Operation ID 或不存在的 ID
- **THEN** 两者显示相同不可用结果，不泄露 Work 身份、内容或包元数据
