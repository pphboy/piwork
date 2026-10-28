# Proposal

## Why

当前 Import Work 弹窗把完整检查 JSON、技术身份和恢复入口放在主要操作中，用户难以判断接下来应输入名称、等待进度还是查看结果。用户已经确认改用更直接的弹窗原型，并要求保留已有上传、命名和导入路径。

## What Changes

- 按对话中已确认的原型重排 Import Work 弹窗，保留选择并上传 .work、输入 WorkName、显式提交、查看真实进度和成功或失败结果的顺序；不增加必经步骤。
- 完全移除弹窗内的检查 JSON 展示，包括折叠展示；文件名、必要的安全说明、名称、进度和结果使用面向用户的简洁表达。
- 检查完成且名称输入框出现时自动聚焦；保持既有名称留空、冲突和失败恢复语义。
- 从该弹窗移除 “Find an original Import task”，不新增必经 Import List；仍保留已有 Operation 身份和安全恢复能力。
- 用适当的 MB/GB 单位展示已知字节；仅在分子和分母可靠时展示百分比，其他阶段展示真实状态。
- UI 和导入性能属于独立变更；本变更不以重写 Core、改变包格式或新增导入流程为前提。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-webui`: 更新 Work 导入弹窗的内容、焦点、进度和结果呈现，同时保持原有身份与任务恢复约束。

## Impact

主要涉及 apps/desktop-webui/src/app.ts、adapter.ts、样式和中英文文案，以及对应浏览器测试和嵌入资源构建。若现有 transfer 状态不能支撑界面真实反馈，只扩展已有状态观察所需的最小适配；Core 导入性能优化在 optimize-work-import-performance 中独立规划。
