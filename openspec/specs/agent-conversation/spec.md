# Agent Conversation Specification

## Purpose

定义用户在 Work 内与 agent 交互的持久会话和执行契约，使提交、并发、结果、取消和进程中断都具有稳定身份与可查询状态，并在重新连接或 daemon 替换后保留历史而不重复执行未知副作用。

## Requirements

### Requirement: Persist and restore Work sessions

**Identifier:** CONV-SESSION-001

系统 SHALL 允许 Work 所有者创建、列出、读取和继续 Session，保存与 Work 绑定的稳定 Session ID 和历史。daemon 重启后 SHALL 能按同一 ID 加载已保存历史，不能要求用户仅因进程替换而新建会话。每个 Session SHALL 绑定创建时验证的内部 immutable Work active context identity；公开 Session data MUST NOT expose numeric configuration revisions, Skill import or storage paths, AGENTS host paths, internal digests, or secrets.

#### Scenario: Continue after daemon replacement
- **WHEN** 一个已完成对话的 daemon 被替换，用户继续原 Session
- **THEN** 系统恢复原历史并在同一 Session 接受新 Run

#### Scenario: Restore the same Work context
- **WHEN** a daemon restarts with the same Work-owned active context
- **THEN** the restored Session uses the same copied Skills, AGENTS content, and tool policy without importing Core or host context or exposing a revision

### Requirement: Durably accept idempotent Runs

**Identifier:** CONV-RUN-001

每次提交 SHALL 携带 Session 标识和提交键；系统 SHALL 在持久接受后返回稳定 Run ID，并支持查询 accepted/running/cancelling/succeeded/failed/cancelled/interrupted 状态。相同提交键和内容 SHALL 返回原 Run，异内容 SHALL 返回冲突。

#### Scenario: Retry after lost acknowledgment
- **WHEN** Client 未收到接受响应并用相同提交键重试
- **THEN** 系统返回同一 Run，不再次触发模型或工具执行

#### Scenario: Reuse key with another prompt
- **WHEN** Client 使用既有提交键发送不同 prompt
- **THEN** 系统返回冲突，原 Run 不被修改

### Requirement: Limit active execution per Work

第一版每个 Work SHALL 最多有一个 accepted/running/cancelling Run，不同 Work 可以并行。不同提交与现有活动 Run 冲突时 SHALL 返回 WORK_BUSY；相同键的幂等重试不受此错误替代。

#### Scenario: Concurrent sessions in one Work

- **WHEN** 两个 Session 同时在同一 Work 提交不同 Run
- **THEN** 最多一个被接受，另一个返回 WORK_BUSY，不进入隐藏队列

#### Scenario: Separate Works run concurrently

- **WHEN** 两个获准 Work 分别提交 Run 且资源允许
- **THEN** 二者可同时执行而不共享活动槽或会话状态

### Requirement: Execution survives observer loss

已接受 Run SHALL 独立于提交和观察连接执行；观察取消、网络中断、用户注销或 Core Gateway 中断 MUST NOT 被隐式解释为 CancelRun。Run 终态及最终结果 SHALL 可通过后续授权查询获得。

#### Scenario: Disconnect during a tool call

- **WHEN** Client 观察连接在工具调用期间断开
- **THEN** Run 继续，重连后用户能查询同一 Run 的结果或仍在执行的状态

### Requirement: Explicit cancellation and terminal consistency

系统 SHALL 提供显式取消；取消请求被接受后，在确认执行及受管任务结束之前 SHALL 保留 cancelling 和活动槽。取消与完成竞争时 SHALL 保留唯一已提交终态，不把已成功结果改写为取消；重复取消终态 Run SHALL 返回既有终态。

#### Scenario: Cancel an active Run

- **WHEN** 用户显式取消正在运行的 Run
- **THEN** 系统请求停止执行，确认停止后记录 cancelled 并释放活动槽

#### Scenario: Completion wins cancellation race

- **WHEN** Run 成功终态先于取消请求持久提交
- **THEN** 取消返回已成功状态，不重复执行、不覆盖结果

### Requirement: Recover interrupted execution conservatively

daemon 启动恢复时 SHALL 将旧进程未终结的 accepted/running/cancelling Run 标记为 interrupted，保留历史及部分结果，不自动重新执行。模型或工具错误 SHALL 形成明确 Run 失败/工具错误，不自动停止 Work。

#### Scenario: Crash after an external side effect

- **WHEN** daemon 在工具已产生外部副作用但尚未提交 Run 终态时崩溃
- **THEN** 恢复后 Run 显示 interrupted，系统不自动重复工具调用，用户可查看已保存历史

#### Scenario: Model unavailable

- **WHEN** 一个 Run 的模型请求失败
- **THEN** 用户可以查询具体失败原因，Work 仍保持可连接以便修复和再次提交

### Requirement: Apply Work context to every Session

**Identifier:** CONV-CONTEXT-001

系统 SHALL 在每个新建或继续的 Session 中使用所属 Work 的 active owned context，包括固定 copied Skills、`AGENTS.md` 内容、base image runtime context 和最终工具策略。Apply 成功后创建的新 Session SHALL 使用新 active context；已接受的 Run SHALL 继续使用开始时的内部 context identity。配置更新、Session history、Run events 和错误响应 MUST NOT expose secrets, host paths, managed-storage paths, internal digests, or configuration revisions.

#### Scenario: New Session sees applied context
- **WHEN** an owner applies desired context containing new Skill and AGENTS content, then creates a Session
- **THEN** the Session uses the new active owned context and public metadata reports configuration state without a revision, file content, path, digest, or secret

#### Scenario: Existing Run keeps its context
- **WHEN** Work configuration is applied while a Run is active
- **THEN** the active Run continues with its original internal context identity and only later Sessions or Runs use the newly active context

#### Scenario: Reject cross-Work context access
- **WHEN** a Session or Run request attempts to use a context identity belonging to another Work
- **THEN** Core or agentd rejects the request without returning the other Work's Skills, AGENTS content, history, or tool policy
