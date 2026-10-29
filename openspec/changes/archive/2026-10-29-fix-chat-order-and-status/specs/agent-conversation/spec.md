## ADDED Requirements

### Requirement: 保留取消和失败前已输出的 Agent 正文

系统 SHALL 为新 Run 持久保留已经向观察者发出的 Agent 正文，使显式取消、执行失败、进程中断及事件游标过期后，获准用户仍可通过原 Session/Run 历史读取已保存部分，并区分部分内容和完整成功结果。正文、工具活动及终态 SHALL 保持原有身份与顺序，不能因空最终结果或事件压缩抹去已输出正文；同一内容不得因历史恢复重复。记录只有此前已经保存的数据时 SHALL 如实展示，不承诺恢复未保存或未生成的历史内容。

对旧 Agent 或旧记录 SHALL 保持原能力兼容，不隐式升级、重发 prompt 或重放工具。新保存和读取沿用现有 Work 授权、私有数据与历史传输预算，Run 成功和取消竞争仍遵循现行终态约束。

#### Scenario: 输出正文后取消
- **WHEN** Agent 已输出正文增量，随后 Run 被显式取消且执行收尾发生异常
- **THEN** 原 Run 为其真实终态，已输出并持久保存的正文仍可通过历史读取一次，并标明它是部分内容

#### Scenario: 事件压缩后重连
- **WHEN** 长 Run 的文字事件已被压缩或客户端游标过期，随后客户端读取原 Run 历史
- **THEN** 已保存正文仍能按原顺序恢复，不依赖已删除的事件，不重复生成或执行

#### Scenario: 历史没有保存正文
- **WHEN** 旧 Run 的可用历史和事件均没有正文
- **THEN** 表达没有可恢复正文，不虚构内容或覆盖其他轮次

#### Scenario: 失败和重启
- **WHEN** Run 输出部分正文后模型失败或 daemon 中断并恢复
- **THEN** 对应失败或 interrupted 状态及已持久正文可被原 Session 授权读取，不自动重执行


## MODIFIED Requirements

### Requirement: Restore private conversation history with scoped identity

**Identifier:** CONV-SNAPSHOT-001

完整包 SHALL 保留 Session/Run 行、全部已保留 events、SDK history 文件、幂等记录和上下文关系，不要求重新对话。导入仅映射结构化 work_id/context_identity 及声明的事件身份字段；Session/Run 局部 ID、时间、文本、工具结果和 SDK 消息树不变。历史控制 Operation 使用新全局 ID 保存为只读历史，不进入执行队列；用户正文中的原 ID 保持原样。

控制历史 SHALL 复用现有 OperationRecord 归档，requestJson/resultJson/errorJson 字符串原样保存，不实现逐 kind 的递归字段迁移；仅新查询身份及归属重新分配。未知历史 kind SHALL 作为标签保留，不能分派执行，也不能仅因没有对应迁移器而丢弃或阻止完整导出。原生 create-work 即使 work_id 为 NULL，也 SHALL 按控制幂等 resourceId 关联纳入。历史控制幂等记录只读归档，源主体匿名化，不恢复源权限或 live 幂等命中。再次导出 SHALL 同时包含已导入和本实例新增的历史。

已终态 Run SHALL 保持终态，导入不执行工具、不调用模型、不重放提交键；非终态历史使包校验失败。Session 继续仍遵循原有 active context 匹配约束：源上可继续的 Session 在相应 active context 导入启动后可继续，源上因旧 context 不匹配而不能继续的 Session 不被静默迁移到新 context。读取与继续均按新 Work 所有者授权。存在受管 sqlite 时，其 schema/path/外键必须验证，不能执行包携带 SQL、触发器或任意宿主路径；active=null 且主文件/WAL/SHM 全部缺席表示尚无私有 Session/Run 历史，导入保持缺席，首次显式 start 按正常路径初始化。

所有者 SHALL 能通过 import-provenance 查询导入包 digest、import Operation ID 和源到目标历史 Operation ID 映射，再用既有 operation show 读取映射后的终态安全投影。此历史查询不触发执行，非所有者管理员也不得读取该 provenance；源用户/平台 secret 信息不在响应中。

系统 SHALL 完整保留 schema 4 的现有模型选择、实际模型、安全执行来源、反馈关联与采用经验版本；新 harness 使用 history schema 6，保留 schema 5 的独立 Memory 绑定与新 Run 实际提供的 entryId/截断信息，并保存部分回复检查点。已知 schema 4 和 5 的导入按原格式静态校验并保留固定运行镜像，不在导入时升级；采用新 harness 的受控迁移遵守 WMEM-005。新增反馈图及导入历史的执行边界遵守 PWORK-BRAIN-001。平台派生身份不从源环境恢复为 live 权限。

#### Scenario: Continue a copied Session
- **WHEN** 同一个包被导入两份，分别启动并继续其匹配 active context 的同一局部 Session ID
- **THEN** 两份各自从相同历史继续且后续消息独立，源 Session 不增加消息

#### Scenario: Keep a completed tool call historical
- **WHEN** 包内已完成 Run 的历史含发邮件或服务创建记录
- **THEN** import 不重放这些动作，新 Run 只有显式提交才执行

#### Scenario: Reject hostile history metadata
- **WHEN** 私有数据库包含非预期 schema/trigger、错误 Work scope 或指向 /etc 的 SDK history path
- **THEN** 导入整体失败，不把数据库作为可信脚本打开，也不访问该路径

#### Scenario: Preserve an old context mismatch
- **WHEN** 源 Session 绑定旧 context，与当前 active 不一致
- **THEN** 历史保留，导入不隐式改绑或承诺该 Session 可继续

#### Scenario: Preserve an uninitialized empty history
- **WHEN** 未初始化 Work 的 active=null，私有卷没有 Work SQLite 主文件或 sidecar，控制面仍有已完成的 Work 操作历史
- **THEN** 导出导入保留控制历史和空私有会话状态，不制造源会话或拒绝合法包；首次显式启动后再正常创建受管数据库

#### Scenario: Keep native control history without replay
- **WHEN** 一条终态控制历史的 request/result/error 含旧 ID、用户原文或当前没有执行处理器的 kind
- **THEN** 原始记录内容完整保留，导入和再导出均不执行它、不递归替换其内容；查询只返回经过校验的安全投影

#### Scenario: Go 版本恢复反馈及模型历史
- **WHEN** 本版完整包被 Go Core 导入并显式启动
- **THEN** 原 Session/Run、模型描述和反馈关联可查询，旧目标为 historical 且不执行，新目标使用接收方权限

#### Scenario: 两种已知格式保留采用事实
- **WHEN** 分别导入合法 schema 4 历史或 schema 5 与 Memory schema 1 的历史
- **THEN** 旧版本号不改写成新 head，新 Run 的实际提供条目引用保持，均不恢复旧请求的执行权限或替换固定 agent 镜像

### Requirement: 新聊天设置保持现有完整包格式与安全恢复

**Identifier:** CONV-CHAT-HISTORY-001

新增 Session Thinking、Run 实际 Thinking 和输入解释模式 SHALL 随原模型选择、实际模型、幂等记录及 SDK history 持久保存，daemon 重启和完整包导出导入后保持同一含义。系统 SHALL 使用 CONV-SNAPSHOT-001 的现行 history schema 6 并静态兼容已知 schema 4 和 5、storage layout 2 和 .work formatVersion 1，不为图片新增 SQL schema、存储卷、导入迁移、自动回放或 SQL 执行入口；可选结构化字段缺省按前述旧行为解释，未知字段和非法值仍拒绝。

导入后保持原 Session/Run 局部身份、工具历史和终态，按原 Work/context 映射恢复，只在接收方权限与原继续约束下接受新执行。已有 SQL/schema/path/外键、非终态历史拒绝、空历史及历史控制操作只读归档规则继续适用；新字段不能扩大 live 权限或作为隐式创建、调用模型和工具的依据。

图片原始内容、消息顺序、所属 Run 及幂等关系 SHALL 随原私有会话历史和完整包保留，包括尚未写入 SDK history 的已接受终态输入。用户显式在兼容原 Session 续聊时，尚缺 SDK 消息的原已接受图文输入 SHALL 作为历史参与正确上下文，不重新执行旧 Run 或伪造旧回答；只读历史查看和重启本身不调用模型。导入后按新 Work 所有者读取，不依赖原 Desktop 缓存、源 Core、公网 URL 或共享 workspace 文件。新图片记录的合法性与摘要一致性 SHALL 在 TS/Go 冷历史验证中保持一致；未声明新图片记录的旧历史继续原静态兼容，不重写历史正文。

#### Scenario: 新设置完整包往返
- **WHEN** 包含模型/Thinking、资源命令 Run 和工具历史的终态 Work 完成导出、导入、再导出
- **THEN** 新字段、原幂等及工具关联保持，未执行任何历史命令或工具，导入后显式新提交才执行

#### Scenario: 旧包与非法设置
- **WHEN** 导入合法 schema 4 包缺少新字段，或包带有非法 Thinking/输入模式
- **THEN** 前者按旧行为读取并保留原历史，后者校验失败，不执行迁移或以猜测值修复

#### Scenario: 图片包离线往返
- **WHEN** 含 SDK 图片消息及受理后中断图片输入的终态 Work 导出后，源 Core 下线，再导入目标安装
- **THEN** 原图片字节和对应 Session/Run 保持，目标 Work 为 stopped，用户显式 Start 后可读取原图，导入不调用模型

#### Scenario: 图片持久记录损坏
- **WHEN** 新图片受理记录的 MIME、长度、内容摘要或 Run/Session 归属被破坏
- **THEN** TS/Go 对对应记录一致拒绝，不以空图片修复、跨对象查找或执行输入来绕过验证

#### Scenario: 中断输入后的显式续聊
- **WHEN** 已接受图片在 SDK 保存前中断，用户重启后在兼容原 Session 明确发送新消息
- **THEN** 新 Run 的上下文包含原图片输入，旧 Run 保持 interrupted，不重放旧模型/工具或生成虚构旧回复
