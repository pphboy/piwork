# Agent 会话 · 消息内提问

## ADDED Requirements

### Requirement: Agent 用消息表单收集用户输入

**Identifier:** CONV-CHAT-FORM-001

Piwork Agent 的实际模型执行上下文 SHALL 指导 Agent 在 Chat 需要用户答复才能继续时默认使用消息内表单，单题同样适用，并尊重用户明确要求的纯文字提问。表单按提问顺序组合单选、多选和自由文本问题。实际问题置于表单字段，选择题 SHALL 提供可读选项。提问后结束本轮并等待，回答通过同一 Session 的普通用户消息交给 Agent。

#### Scenario: 根据任务组合问题

- **WHEN** 用户要求安排周计划，Agent 需要收集目标、任务和时间限制才能继续
- **THEN** Agent 按默认规则声明一个表单，把目标单选题、任务多选题和时间限制文本题直接放进表单，结束本轮等待回复。只欠一个决定时也可发单题表单

#### Scenario: 答案进入原对话上下文

- **WHEN** 用户在 Desktop 确认表单且普通聊天提交被受理
- **THEN** Agent 在提问所属 Session 的下一轮收到一条用户消息，正文包含用户作答的问题和答案；用户随后仍可发送普通文本补充
