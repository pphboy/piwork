# Spec Delta

## MODIFIED Requirements

### Requirement: Persist and restore Work sessions

**Identifier:** CONV-SESSION-001

系统 SHALL 允许 Work 所有者创建、列出、读取和继续 Session，保存与 Work 绑定的稳定 Session ID 和历史。daemon 重启后 SHALL 能按同一 ID 加载已保存历史，不能要求用户仅因进程替换而新建会话。每个 Session SHALL 绑定创建时验证的 Work active configuration identity，且不得将 Skill 文件路径、AGENTS 主机路径或任何 secret 写入历史。

#### Scenario: Continue after daemon replacement
- **WHEN** 一个已完成对话的 daemon 被替换，用户继续原 Session
- **THEN** 系统恢复原历史并在同一 Session 接受新 Run

#### Scenario: Restore the same Work context
- **WHEN** a daemon restarts with the same Work storage and active revision
- **THEN** the restored Session uses that revision's Skills, AGENTS content, and tool policy and does not import host context

### Requirement: Durably accept idempotent Runs

**Identifier:** CONV-RUN-001

每次提交 SHALL 携带 Session 标识和提交键；系统 SHALL 在持久接受后返回稳定 Run ID，并支持查询 accepted/running/cancelling/succeeded/failed/cancelled/interrupted 状态。相同提交键和内容 SHALL 返回原 Run，异内容 SHALL 返回冲突。

#### Scenario: Retry after lost acknowledgment
- **WHEN** Client 未收到接受响应并用相同提交键重试
- **THEN** 系统返回同一 Run，不再次触发模型或工具执行

#### Scenario: Reuse key with another prompt
- **WHEN** Client 使用既有提交键发送不同 prompt
- **THEN** 系统返回冲突，原 Run 不被修改

## ADDED Requirements

### Requirement: Apply Work context to every Session

**Identifier:** CONV-CONTEXT-001

系统 SHALL 在每个新建或继续的 Session 中使用所属 Work 的 active configuration，包括固定 Skills、`AGENTS.md` 内容、base image 运行上下文和最终工具策略。`work config apply` 成功后创建的新 Session SHALL 使用新 active revision；已接受的 Run SHALL 继续使用其开始时的 context identity。配置更新、Session history、Run events 和错误响应不得包含 secret 或宿主路径。

#### Scenario: New Session sees applied context
- **WHEN** an owner applies a Work revision containing a new Skill and AGENTS content, then creates a Session
- **THEN** the Session is initialized with the new active context and its public metadata identifies the active revision without exposing file contents or secrets

#### Scenario: Existing Run keeps its context
- **WHEN** a Work configuration is applied while a Run is active
- **THEN** the active Run continues with its original context identity, and only later Sessions or Runs use the newly activated context

#### Scenario: Reject cross-Work context access
- **WHEN** a Session or Run request attempts to use a context identity belonging to another Work
- **THEN** Core or agentd rejects the request without returning the other Work's Skills, AGENTS content, history, or tool policy
