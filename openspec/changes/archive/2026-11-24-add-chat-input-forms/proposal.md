# Proposal · Chat 消息内输入表单

## Why

Agent 收集几项相关信息时，用户现在需要对照提问逐项打字。用户选定原型 A，希望直接在 Agent 消息里作答，确认后在同一会话看到自己发出的完整回复。

## What Changes

- Agent 在 Chat 需要用户答复才能继续时默认在一条回复里按任务组合单选、多选和文本字段，自行给出问题及选项。
- Desktop Chat 在该条回复内展示表单。用户既可以填写并确认，也可以照常用聊天输入框直接回答。
- 一次确认把答案合并成一条普通文本用户消息，沿用当前 Session 的发送、受理和历史展示。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-conversation`：约定 Agent 如何用 Assistant 消息声明三类问题，并以普通用户消息接收答案。
- `desktop-webui`：在 Chat 消息内展示、填写和确认表单，保留现有文本回复入口与提交语义。

## Impact

涉及 agentd 提供给模型的会话指导、Desktop 的 Assistant Markdown 渲染、表单输入和现有发送入口。使用现有消息正文和 Run 接口。验收以用户指定的周计划三问为例，题目与选项由 Agent 提供。
