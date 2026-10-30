# Proposal

## Why

发送完成后，旧 Agent 返回的 SDK 消息 ID 与工作台实时显示使用的 Run/事件 ID 不同，兼容合并把已保存消息和实时副本同时留下，导致用户输入和 Agent 回复重复。已在原会话的只读回放中确认：持久历史投影为 13 条，合并后变成 15 条，新增的两条分别是同一轮的一问一答；需要修复身份衔接，而非按相同文字删除消息。

## What Changes

- 为已确认 Run 关联的用户输入统一逻辑身份，文本与图片输入采用一致规则，SDK 内容块变化不产生第二个用户气泡。
- 为实时正文与旧协议保存正文建立有作用域、可验证的来源映射；按 Run、事件序列、真实工具调用边界和字节覆盖范围归并，历史接替已覆盖的实时内容，不重复展示。
- 保留不同轮次、工具前后及独立 SDK 消息的合法同文；无法证明覆盖的取消、失败、中断正文继续保留，并沿用消息外状态图标说明实际限制。
- 让完成、手动刷新、重连和游标失效恢复使用同一合并规则；身份切换后的晚响应不能复用旧映射。
- 在修复旧协议兼容行为后，通过已有受管 Apply 将本次报告的 Work 升级到匹配的新 Agent，并在原 Session 核验历史保留。升级不作为旧协议修复的替代品，不由登录、读取或普通发送隐式触发。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-webui`：补充旧协议实时消息转为保存历史时的身份衔接、覆盖确认和重复读取行为。
- `agent-conversation`：明确能力降级不取消消息身份约束，区分 Core 更新、Work 固定 Agent 与显式受管升级。

## Impact

- 主要涉及 `apps/desktop-webui/src/legacy-history-projection.ts`、`adapter.ts`、`models.ts` 及相邻投影、历史和浏览器测试；复用 `chat-projection.ts` 的基础合并，现有 `history-projection.ts` 与 Agent `session-history.ts` 的范围校验作为实现依据。
- 沿用已有 HTTP/RPC、history schema 7、SDK 原始历史和传输预算，不为 UI 合并新增数据库格式、公开协议版本或宿主运行依赖。
- 重新构建并嵌入工作台资源到 Linux Core/CLI，使用原项目数据、原账号运行修复版；受管 Agent 升级沿用既有备份、迁移和恢复机制。
- 不包含 MicroVM、Windows 打包、宿主重启、界面重设计、账号密码变更或对外发布。验收以合成夹具和必要的一次原会话检查为主，不重复大批量性能采样；真实凭据、正文和私有历史不进入变更附件。
