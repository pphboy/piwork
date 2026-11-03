# Proposal

## Why

模型 Test 面向自定义端点，用户需要依据所选标准协议验证连接，并能区分请求失败与实际聊天能力。现有实现已有基本协议请求及边界，但缺少对标准兼容性、供应商无关行为和真实错误表达的系统核验；不能仅凭某个网关失败断言请求违反官方协议。

## What Changes

- 核验并在发现偏差时修正 Anthropic Messages 和 OpenAI Responses 的 Test 请求、地址规范化、实际文本解析和安全错误反馈。
- 将 Test 定义为基于所选协议、Base URL、Model ID 和 Key 的单次真实消息检查，不按供应商、域名或模型名称添加专有请求行为。
- 核对 Test、保存和实际聊天的协议、地址、模型与凭据绑定，明确短消息 Test 不证明流式、工具或完整聊天可用。
- 使用合成兼容端点与官方协议样例验证正负场景；真实服务验证仅在可用凭据和环境具备时执行并如实报告。
- 本变更只覆盖现有 Anthropic Messages 和 OpenAI Responses，不新增 Chat Completions 或供应商专用配置。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `ai-model-management`: 明确 Test 以所选标准协议为依据、独立于供应商特例，并限定结果的证明范围和安全错误事实。

## Impact

- Core 模型 Test 请求、响应和错误处理及其单元/契约测试；按核验结果调整相关代码。
- 核对模型输入、保存、Test 与 Agent 实际执行的地址和绑定；若需改变公开 DTO 或 Console 呈现，仅在确有契约偏差时同步消费者及生成物。
- 保持当前模型配置、用户凭据、保存及选择语义；不改变生产运行或对外发布。
