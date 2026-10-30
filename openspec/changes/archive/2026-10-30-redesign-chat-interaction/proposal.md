# Proposal

## Why

Chat 把消息、发送回执、Agent 进行中提示和 Run 结果分别铺在界面上，导致同一轮对话出现重复状态，工具详情与发送／停止也缺少连贯的操作路径。用户要求消息气泡、图标反馈和工具过程协调呈现，并把发送、独立停止、停止并发送及失败恢复纳入完整对话体验。

## What Changes

- 在现有 Piwork 工作区内统一消息区层级：右侧内容宽度的浅灰用户气泡、左侧正文与低权重执行详情；借鉴 ChatGPT 的气泡形式，不更换 Work 导航、Service 页面或整页设计语言。
- 用户消息以气泡外固定位置的图标表达发送中、明确失败和结果未知，不常驻 Sending 或 Message accepted。明确失败提供显式重试，未知结果仅核对原提交；保留新草稿和图片。
- Agent 生成中的全局三点紧跟已有正文末尾；工具执行时由所属工具摘要承接该轮进行中提示，正常完成自然收束，不常驻 Run succeeded／Run running 状态行。
- 工具活动默认收起，展开先显示真实调用及可取得结果，再按需查看原始内容；保持失败数量、调用归属、手动展开和阅读位置，缺少参数时如实回退。
- 输入区提供独立、无需新草稿即可执行的停止操作；有合法新输入时另行提供明确的停止并发送。复用服务端现有原子交接，保持旧 Agent、其他 Session／Service 来源、取消竞争和未知提交的安全规则。
- 将当前交互演示冻结为本变更的 `prototype.html`，作为视觉和体验评审附件；其模拟计时、工具样例和本地交接不是实际后端契约。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-webui`：消息级图标状态、正文与工具进度、轮次详情层级、明确失败重试、独立停止和停止并发送的入口与恢复。
- `desktop-ui-language`：Chat 范围内的图标状态例外、统一消息层级、工具分层展开与 Composer 停止控制；维持既有浅色令牌与其他页面规则。

## Impact

主要涉及 `apps/desktop-webui/src/app.ts`、`adapter.ts`、`models.ts`、`action-state.ts`、消息／历史投影、公开样式、本地化与对应浏览器测试。构建时同步 `internal/desktopassets/static/` 嵌入资源，并验证本机 Desktop 与托管工作台共用行为。

复用现有 Run 提交、取消、按提交键核对和工具公开预览，不新增 Core／Agent API、历史 schema 或镜像能力，不扩大工具数据暴露范围。正式实现不能把原型的“本地先取消、再发送”照搬为两个独立业务请求；仍以 CONV-CANCEL-SEND-001 的单次原子提交为准。本提案不包含 MicroVM 打包、发行或真实用户 Work 测试。
