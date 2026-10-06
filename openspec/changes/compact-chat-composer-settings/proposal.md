# Proposal

## Why

Chat 的 Model 与 Thinking 属于低频配置，当前却以带字段标签、均分底栏宽度的两个常驻控件呈现，削弱了文本输入与发送的视觉优先级。将它们归组为一个可读的配置摘要入口，可以减少 Composer 的表单感，同时保留发送前核对配置的能力。

## What Changes

- 用一个按内容占宽的轻量摘要入口呈现当前模型与 Thinking，例如 `Work model · Medium`；移除 Composer 常态中的两项字段标签与独立选择按钮。
- 摘要打开同一个 `Response settings` 面板，在面板内将 Model 与 Thinking 相邻编组，提供当前值、真实选项、Work default 与能力限制说明。
- 沿用现有原生 dialog、轻量按钮、菜单选中态、英文文案及焦点返回规则；`/model` 与 `/thinking` 直接展开面板中的对应选项。
- 保留完整设置对的自动保存，以及输入附近持续可见的保存中、失败、未知结果和只读恢复；模型切换导致 Thinking 调整时给出明确说明。
- 明确 Agent 辅助栏、常规 Chat、Focus chat 与 360px 窄屏的一致布局和行为，增加视觉层级、键盘、长名称与状态切换验收。
- 在设计中逐项核对已有 UI/UX 规则；修改旧规范中底栏并列选择器的描述，使规范与合并摘要入口保持一致。

目标是让 Composer 的常态突出输入与发送，低频配置可发现、可核对、可恢复。此次不合并现有 Input options / Service identity，不改变文本输入、命令执行、Session/Run 语义或 Work Settings，不增加后端配置接口、保存主动作、全局设置页面或新的视觉系统。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-ui-language`：调整 DUL-WORKSPACE-001，明确合并摘要、按需编辑和输入优先的层级；继续满足 DUL-003、DUL-007、DUL-WORKSPACE-002 的反馈、视觉与可访问性要求。
- `desktop-webui`：调整 DWUI-MODEL-001，定义统一设置面板、命令定位、自动保存、未知恢复、焦点与窄屏的可观察行为，保留完整设置对与下一次手动 Run 的现有契约。

## Impact

- 影响 `apps/desktop-webui/src/app.ts` 的 Composer、设置面板、命令入口和焦点处理，以及 `apps/desktop-webui/public/style.css` 的局部布局；视觉角色继续来自 `apps/ui-shared/tokens.css`，无需全局修改令牌。
- 复用 `apps/desktop-webui/src/adapter.ts` 已有模型目录、能力、设置对保存和原 Session 核对；Core/CLI/Agentd 接口、持久化、授权和跨身份隔离保持现有契约。
- 更新 `apps/desktop-webui/test/recovery.test.ts` 中针对两个常驻选择器的辅助函数及布局断言，并复用延迟、失败、未知、跨 Session 和 iframe 保持的回归场景。
- 实施后通过既有 Desktop 构建同步 Go 内嵌资源，不手工编辑 `internal/desktopassets/static` 的生成副本。
- UI/UX 对齐在本阶段落实为设计依据和验收条件；新界面的实际视觉与浏览器行为需要在实施后的宽屏、辅助栏、Focus chat 和窄屏验收中确认。
