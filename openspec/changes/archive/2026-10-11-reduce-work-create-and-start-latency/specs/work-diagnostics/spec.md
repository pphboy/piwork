# Spec Delta

## ADDED Requirements

### Requirement: 安全计量创建请求及启动关键阶段

**Identifier:** WDIAG-LATENCY-001

Core SHALL 从创建 HTTP 请求进入开始建立性能计时和关联信息，覆盖受理前的镜像解析 / 检查、共享等待、环境探测、上下文捕获和持久受理；启动阶段 SHALL 分别计量资源准备、容器启动、有效 readiness 响应确认、诊断收集和激活。结构化性能事件 SHALL 包含 UTC 时间、固定事件 / 阶段名、结果、非负耗时和 correlationId，Work / Operation 标识只在真实分配并可用后加入；缓存状态 SHALL 区分命中、实际准备和共享等待。

单阶段耗时 SHALL 使用单调时钟计算。RPC 核验成功、诊断收集完成及最终激活 SHALL 有可区分的时间边界；不得把转存 Agent 日志的时间当作 Agent 原始初始化发生时间，也不得把 Operation.createdAt 解释为 HTTP 请求起点。计时 SHALL 作为独立的安全进程日志，不新增公共 Operation / HTTP / RPC 字段，不改变既有持久诊断阶段、错误投影及容量上限。

事件 SHALL 仅包含允许的标识、固定安全枚举和计量值，不记录镜像引用 / digest、内部 context 身份、宿主路径、配置、凭据、包内容或会话。共享准备的实际耗时与各调用者等待耗时 SHALL 分别关联，不能把一次共享工作计成多次执行。

#### Scenario: 受理前发生慢镜像检查
- **WHEN** 创建请求需要首次完整镜像准备，尚未生成 Work / Operation
- **THEN** 同一 correlationId 下可以观察请求开始、准备等待及结果耗时，未分配的业务 ID 缺省，受理前等待不会从端到端记录中消失

#### Scenario: Agent 已就绪但 Core 尚在收集诊断
- **WHEN** Core 已取得有效 readiness 响应，之后继续拉取并持久化安全初始化诊断
- **THEN** RPC 确认耗时、诊断收集耗时及最终激活时间能够分别识别，Agent 原始事件和转存时间不混用

#### Scenario: 多请求共享准备且一个取消
- **WHEN** 多个创建请求共享一次镜像准备，其中一个取消
- **THEN** 性能记录包含一次实际共享执行、各自等待 / 取消结果及各自请求关联，不输出跨 Work 内容或内部镜像身份

#### Scenario: 性能事件不扩张公共诊断
- **WHEN** 创建或启动成功、失败、被取消或被 superseded
- **THEN** 公共 Operation 和错误响应继续符合既有 schema，新增性能日志只含安全枚举、计量值和已允许的关联标识
