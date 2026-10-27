# Design

## Context

动机见 [proposal.md](proposal.md)。本设计针对现行受支持存储格式，不把用户提供的真实磁盘副本或凭证纳入仓库验收材料。

当前源码中的相关事实：

- `internal/coreapp/work_start.go:capturedContextSpec` 从 Work-owned context 与固定 runtime profile 取得执行定义，再从模型目录获取当前 `credentialRef`；它目前同时承担 context 校验和凭证解析。
- `work_coordinator.go:selectAgentGeneration` 对 stopped/starting/ready/recovering/failed/draining 代次复用 generation/instance；`work_recovery.go` 及文件任务清理后的 `file_lifecycle.go` 都可能以原代次恢复。
- `internaltls/config.go:WriteModelCredential` 将规范化凭证保存在 `tls-generation-N/model-credential.secret`；不同字节与安全路径/权限错误都返回 `ErrMaterial`。`safefs.OpenDirectory` 会创建目录，不能直接用于纯检查。
- `workruntime.Runtime.Start` 在容器确保/接管前先发布 TLS、运行配置和凭证；`internaltls.AgentClientConfig` 也会进入可能发布证书的 generation 路径。新增接管分支需要明确读取现有材料，不能只跳过一条写 Key 语句。
- `coreapp/service_access_policy.go` 以持久最新 ready generation 和 instance 授权 Agent 私有 RPC；`startCapturedWork` 目前先将代次设为 starting。接管合法运行实例时提前新增代次或降级其 ready 状态，都可能影响已有执行。
- `apps/agentd/src/run-models.ts` 经私有通道取 Run 凭证，`model_bindings.go` 已固定执行定义及凭证引用。启动材料与 Run 绑定具有不同职责。
- `corestore/runtime_generation.go` 持久保存重试计数、窗口和退避。现有 `control_metadata` 可承载内部版本化记录；不需要为本修复建立另一套配置版本体系。

现行约束见 `ai-model-management/AIM-002`、`runnable-work-runtime` 的凭证和 readiness 要求，以及 `work-lifecycle` 的恢复、快照、文件任务和实例日志要求。

## Goals / Non-Goals

**Goals:**

- 将 context 选择、启动凭证绑定、运行实例接管分开，使所有恢复入口采用同一决定。
- 让切代的身份发布、启动重试及资源收尾在崩溃后有确定目标，并保留既有预算和准入边界。
- 默认通过 Go Core 修复，兼容现有受支持 Agent 镜像；不改变其公开协议或使用者操作流程。

**Non-Goals:**

- 不热覆盖只读挂载，不在轮换 API 内主动重启所有 Work，不给 Key 更新附加 Apply。
- 不扩展为凭证全面回收、历史数据迁移、UI 离线历史模式或运行时 TLS 策略重设计；无法核验的既有材料继续安全失败。
- 不改写已接受 Run，不自动重放模型请求或工具动作。

## Decisions

### 1. 先决定接管还是启动，再决定启动凭证

在现有每 Work 锁内共享一个恢复协调入口，先读实际 Docker 实例、持久身份、所选 context 及操作目标，不以数据库 state 单独推断实例已退出。

```text
recover desired-running Work
          |
          v
inspect exact managed instance
          |
          +-- running + identity valid --> verify existing mounts/TLS/readiness
          |                                  |
          |                                  v
          |                              adopt same instance
          |
          +-- stopped / confirmed absent --> resolve fixed launch credential
          |                                  |
          |                                  +-- same --> reuse generation
          |                                  |
          |                                  +-- changed --> durable replacement
          |
          +-- unknown / unsafe -----------> fail without another Agent
```

运行实例接管从已捕获 context 和现有挂载构造预期配置，复用现有容器 spec hash/资源检查与完整 readiness 校验，不发布当前 Key、Agent 配置或挂载中的 TLS 证书。为现有有效 TLS 身份提供读取/校验通路，避免通过会补建或轮换材料的方法完成接管；不支持的证书状态按现行安全失败处理。

接管既有 ready 实例不先把持久 ready 状态降为 starting，也不预先插入较大 generation；路由仍必须在本次实际握手成功、控制版本再核对后发布。失败时撤销路由并走现有恢复诊断。这样已有执行可继续通过当前身份授权，新请求依然受每 Run 准入保护。

备选方案是所有恢复都重建 Agent；它会在 Core 异常退出后中断有效执行，违背既有接管契约，因此不采用。

### 2. 安全检查差异，保持同代次材料不可变

`internaltls` 提供只读的现有凭证检查，校验完整 scope、目录归属、普通单链接文件、模式、长度、非空和 NUL 约束；读取期间不创建缺失目录或修复文件。输入与文件按 `WriteModelCredential` 现有规则去掉末尾 CR/LF 后比较。

检查结果区分未发布、相同、凭证变化及真实错误；凭证变化可用专用内部类型/哨兵表达，错误不携带值、hash 或宿主路径。`WriteModelCredential` 本身继续拒绝同代次不同材料，作为最后防线。预检查必须先于写 Agent 配置或其他目标代次材料，不能在部分改写后再发现差异。

新增绑定存在时，还核对材料与原绑定 secret 一致；首次尚未发布则允许正常发布，已发布却缺失或无法核验则失败。对未记录新绑定的现行旧代次，从实际受保护材料和资源发布事实进行判断，不把 runtime profile 中旧 `credentialRef` 当成实际启动凭证；不批量重写 context 或给所有旧代次猜测绑定。

现行旧材料没有独立的完整性摘要，无法证明任意格式合法的字节历史上未被更改；本修复保证已有安全校验及新绑定一致性，不新增历史材料取证能力。

备选方案是允许覆盖旧文件，或无条件使用旧 Key 启动；前者破坏代次不可变及挂载语义，后者可能给初始化/子代理错误凭证，两者均不采用。

### 3. 持久固定一次启动，保持 context 与凭证绑定独立

在现有 `control_metadata` 中增加版本化的内部启动绑定和单 Work 在途切换记录，复用已有事务/锁，不修改公开 DTO、proto、Work 配置或 context 文件。记录包含：

- Work、控制版本、所选 context 和固定 image identity；显式操作可附 operation ID，自动恢复无需制造用户 Operation。
- 源 generation/instance、保留的目标 generation/instance 及阶段。
- 精确模型引用、固定启动 `credentialRef`，需要时保存私有凭证版本；秘密仍来自既有只写 secret 存储，不将 Key 明文放入控制记录。
- 材料是否已发布的事实，用于区分首次发布和异常缺失。

新的一次启动在解析当前模型准入及 secret 后固定绑定。同一在途启动重试、Core 续行及 Apply 候选重试使用该绑定，不再次把目录最新 Key 填入已发布材料。绑定不是通用 Run 授权；每 Run 仍经原通道取得其固定凭证，模型停用仍阻止未获准执行。

新绑定须与 secret 的发布/轮换事务安全排序，所引用 secret 继续保守保留；事务结果未知先读回记录，不重复生成目标。启动期间发生 B 到 C 的再次轮换时，原在途启动继续 B，新 Run 使用 C；后续独立停止/启动再按当前 Key 判定。

### 4. 用在途目标协调切代，不提前取代当前身份

持久切换分为以下可重复阶段：

1. **prepared**：核对 control version、desired-running、快照/文件/临时任务栅栏和预算；保留 `max(generation)+1` 及随机 instance，固定启动绑定。只写在途记录，此时不插入目标 runtime generation，以免提前使源身份失效。
2. **old-removed**：确认源停止；复用 `removeApplyAgent` 中的精确身份、归档、删除及删除意图核对能力，必要时抽取共享 helper，保留卷/网络/context。源已不存在时须结合既有确认记录及移除意图确认，不能因一次列表为空就认定安全。源本已不存在且无待释放绑定时正常进入下一阶段。
3. **starting / published**：在同一事务中将源标记停止并取消其重试、登记目标 generation/instance/启动绑定、移交预算及保存阶段，然后才创建目标容器。目标通过完整 readiness 后按原激活事务发布。成功终结在途记录，保留代次启动绑定供后续核验与日志脱敏。

每个外部动作前及激活前重新核对目标，事务不跨 Docker RPC 持有。旧实例删除前后的崩溃均依据同一切换记录续行；容器创建已发生但结果未提交时按目标身份接管。新控制目标使记录失效时，收尾源/已记录目标和迟到资源，不继续启动旧目标。Stop/Delete 必须看见尚未进入 runtime 表的保留目标及已登记资源意图；Apply 沿其原 candidate/rollback 选择规则，不能被普通恢复抢占。

保留原 active context；active 为空时使用原 Operation 捕获 context。与旧初始化失败后改选 context 的现有逻辑共享身份清理与分配规则，不把 pending desired 当作凭证切代输入。

备选方案是捕获任意 `ErrMaterial` 后临时 `generation++`；它无法区分损坏，也缺少崩溃目标及控制版本证明，因此不采用。

### 5. 在事务中移交预算，并按实际目标记录失败

切代前检查原预算及退避。登记目标时复制 `retry_count`、`retry_window_started_at` 和有效退避约束，目标 `ready_since` 清空；源转为 stopped 且清除 `next_retry_at`，旧代次不再进入 due 队列。失败写回只更新同一控制目标的当前恢复代次，防止调用方仍拿旧 generation 计数或同时重试源/目标。

Start、显式 Retry、Core 恢复、定时恢复，以及 `file_lifecycle.go` 的清理后恢复都经同一协调入口。显式 Retry 只在接受该操作后按现有规则重置一次预算；普通 Start、Key 轮换、切代和 Core 重启不重置耗尽状态。10 分钟稳定 ready 的现有重置规则继续生效。

### 6. 精确实例日志与验证复用现有入口

旧容器移除前继续执行有界日志归档，失败记录缺口而不扩张关闭预算。`log_archive.go` 按 source 的 generation/instance 读取实际启动绑定，补充该实例启动 Key 的脱敏输入，保留原 config revision 的其他敏感上下文；不能以当前模型 Key 或 desired 替代原凭证。没有新绑定的来源继续按现有可证明上下文处理，无法核验则保留缺口。

验收复用 `model_providers_integration_test.go:nativeModelGateway`，扩展为按当前允许 Key 校验，使轮换后旧 Key 返回认证失败。该 fixture 使用真实 Agent/Pi SDK 与合成 HTTPS 模型服务，无需真实外部 Key。现有只拒绝固定 `synthetic-invalid-key` 的逻辑不能独自证明停止恢复已切换到新 Key。

进程级沿 `work_recovery_process_integration_test.go` 的 SIGKILL/重启模式验证运行实例接管和切代断点；单元测试注入事务/材料发布/删除/创建边界故障。记录容器 ID、代次、历史和请求次数，只使用合成材料，不输出秘密。普通单元及定向 integration 通过后执行原恢复/Apply/日志回归，所需镜像及 Go 构建由现有 Makefile 入口准备。

## Risks / Trade-offs

- [预检查和发布之间再次轮换] → 每次在途启动固定 secret 引用，发布保留最终不可变校验；Run 自行取当前绑定。
- [增加 generation 导致旧 Agent 提前失去授权] → 在途记录先保留目标，确认旧实例停止/移除后才登记新代次；接管不降级现有 ready。
- [调用链重复加 Work 锁或失败写回旧代次] → 抽出单一加锁入口及 locked helper，所有调用方使用实际恢复目标；定向测试 Start/定时/文件恢复交错。
- [新绑定与启动材料丢失] → 区分首次发布和已发布事实；可核验错误安全失败，不无限切代或猜测旧凭证。
- [旧 Key 或当前 Key 经新记录/日志暴露] → 控制记录仅存私有引用，归档按原实例绑定脱敏，公开投影与错误扫描两种合成 Key。
- [切换后新 Agent 启动失败] → 不回退已轮换旧 Key，保留 Work 数据和具体诊断，沿继承预算恢复或显式 Retry。

## Migration Plan

1. 通过现有 `control_metadata` 保存内部版本化记录，不改存储格式版本、不扫描迁移旧 Work/context；未记录绑定的有效旧代次按安全检查按需处理。
2. 完成单元与合成模型集成验收后，由后续实施交付新的 Core 二进制；原兼容 Agent 固定镜像继续使用。此规划不执行部署或发布。
3. 正常升级沿 Core 优雅关闭和重启流程恢复 desired-running Work；已耗尽预算的 Work 由用户显式 Retry，desired-stopped 保持停止。
4. 回滚不擦除 secret、代次或 Work 数据。旧 Core 不理解新恢复记录；有未完成切换时先由新 Core 完成精确收尾，不能用旧二进制抢占该过程。回滚后的旧凭证恢复缺陷可能重现；回滚不是数据修复手段。
