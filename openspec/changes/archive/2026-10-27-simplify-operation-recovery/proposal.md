# Proposal

## Why

Desktop 账号菜单中的 Known operations 把用户引向独立的技术记录列表，任务进度和失败原因因而脱离实际操作位置；其 Operation 视图还丢失了后端已提供的结构化诊断。移除入口必须同时补齐对象内反馈和无对象任务的恢复，否则创建、导入或删除后的原任务可能无法再找到。

## What Changes

- 从托管工作台和独立 CLI Desktop 的账号菜单中移除 Known operations，以及指向该全局面板的界面入口和文案；不设置隐藏开关或新建操作中心。
- 整理 Works、Work、Service、Settings 和导入导出界面：在所属对象或任务旁展示真实进度、失败原因、可执行的只读检查，以及次级原 Operation 详情；技术 ID 默认折叠。
- 在 Works 列表提供仅针对尚无可见对象或对象已移除的临时任务提示，承接创建、导入和删除的原结果；对象出现后将可归属信息放回原对象，避免重复呈现。
- 保留 `known-operations` 记录与接口、身份隔离、已记录原 ID 的刷新/重新登录恢复和未知结果保护；关闭展示不取消任务、重提请求或解除保护。无原 ID 或记录保存失败时如实说明恢复限制。
- 在任务详情中呈现后端实际提供的安全错误码、阶段、修复建议、关联标识及有权限访问的相关日志；缺失的根因不推断、不伪造。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-webui`: 用任务内进度、详情及 Works 临时提示替代账号菜单的全局入口，并保留原操作只读恢复、导入导出和身份边界。
- `desktop-ui-language`: 规定任务反馈、临时提示、详情和诊断在所属上下文的视觉层级及交互，移除账号菜单 Known operations 的旧要求。

## Impact

- 主要涉及 `apps/desktop-webui` 的视图、状态映射、中英文文案及浏览器测试；WebUI 构建产物需重新嵌入 Go 程序。
- 需要核对 Desktop 本地/托管记录对 Work、Service、Operation、snapshot 的关联与只读恢复；不移除现有 Core Operation、`known-operations` 或 snapshot 查询接口，不扩大日志权限。
- 现行 `DWUI-002`、`DWUI-010`、`DWUI-011` 和 `DUL-007` 中的全局入口或列表描述需随增量规格修订；`DWUI-009` 原 snapshot 查询及 `DWUI-017` 的完成后对象同步仍须保留。
- CLI、Console 管理界面的独立 Operation 查询、业务执行协议和后端诊断产生机制不在本变更范围内。
