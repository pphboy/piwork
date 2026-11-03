# Proposal

## Why

用户需要只填写 Base URL、Model ID 和 Key，即可用一次 `Reply OK` 最小推理请求确认接口可用。当前 Test 的消息体符合基本协议，但缺少目标端点要求的客户端会话信息；同一用户端点经 Claude Code 或附加匿名会话头可返回真实 `OK`，现有 Test 却返回 HTTP 400，之前的回复解析修复没有解决这条连接。

## What Changes

- Test 使用所选 Anthropic Messages 或 OpenAI Responses 协议，发送一次、非流式、小输出预算的固定 `Reply OK` 请求，展示真实 assistant 文本。
- 传输层自动生成临时匿名请求上下文，并为已确认需要该信息的兼容端点添加必要会话头；用户不填写供应商、请求头或 SessionID。
- 明确修订 AIM-007 中禁止端点兼容请求头的约束：允许窄范围、预先确定的客户端会话兼容处理，保持协议、鉴权、模型和一次请求语义。
- **BREAKING**：新 Test 结果的 `testMessage` 改为 `Reply OK`，同步升级配套 DTO 与 UI；新 reader 兼容已有 `Reply with OK.` 结果，不改写旧结果的原消息事实。
- 模型管理及 Quick setup 均沿原入口进行 Test，不创建 Work/Session/Run、不启动 Agent、不保存草稿、不因失败自动重试。
- 将用户已提供的端点及 `deepseek-v4.1-flash` 纳入必做真实验收：从新版本页面点击 Test，取得 HTTP 200 和真实 `OK`，不能用 curl 成功或合成测试替代。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `ai-model-management`: 将 Test 固定消息改为 `Reply OK`，规定最小调用、自动匿名请求上下文和真实端点验收；修订供应商无关的用户输入边界及已有请求头限制。

## Impact

- Core `model_test_http.go` 的消息和传输层请求上下文；既有响应解析、鉴权、超时和脱敏机制继续使用。
- `packages/contracts/src/ai-model-management.ts`、相关生成 DTO/schema/golden，以及 Console `model-form.ts` 的请求消息与结果校验；模型管理与 Quick setup 共用消费者。
- 需要扩充标准协议与端点匹配负例、双语浏览器测试和真实服务验收；不增加宿主 Node/Python 依赖、用户配置字段或持久存储迁移。
