# Proposal

## Why

New Work 将镜像、完整配置 JSON、覆盖规则摘要和按 ID 找任务混在创建表单内，使只想创建 Work 的用户承担实现细节；现有弹窗也偏大。所有者已选择紧凑版 A，并确认高级配置默认折叠、网页不再提供镜像修改及手动 Operation ID 查询。

## What Changes

- New Work 使用约 480px 宽的单列弹窗，名称为唯一必填项；高级配置默认折叠，仅保留 Skills、Pi Packages、AGENTS.md 文本及文件导入。缩减留白和指令框初始高度，底部按钮紧凑右对齐。
- **BREAKING（网页入口）**：移除 New Work 的 Base image、完整配置 JSON、配置合并摘要与优先级说明。创建请求省略镜像及完整配置覆盖，由 Core 使用已保存默认值。
- 网页 Work Settings 的 Advanced JSON 保留其余公开字段编辑，但不再提供 `agentImage` 编辑或导入覆盖；保存其他字段时保留该 Work 原镜像。
- **BREAKING（网页入口）**：移除 Desktop、New Work、管理导航和辅助页面中的手动 Operation ID 查询。已知任务的进度、详情深链接、刷新、只读恢复及既有失败处理继续保留；移除独立 Find Operation 页面及指向它的链接。
- 同步中英文文案、直接受影响的浏览器/配置契约测试和内嵌 WebUI 资源。将已评审原型保存在本变更附件中。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-webui`：简化 New Work、保护网页配置中的镜像保留语义，移除手动 Operation 查询并保留已知任务恢复。
- `desktop-ui-language`：确定紧凑版 A、默认折叠、剩余配置项及 Settings 的镜像编辑边界。
- `serve-ui`：移除 Find Operation 辅助导航/页面，保留任务详情深链接和状态观察。
- `serve-ui-packages`：移除按 ID 手动找回 Core package Operation 的要求，继续通过已知任务/详情 URL 观察原任务。
- `ui-language`：消除对 Find Operation 入口的保留约束，相关返回路径和双语文案遵循现存任务上下文。

## Impact

- Desktop：`apps/desktop-webui/src/app.ts`、`adapter.ts`、`configuration.ts`、`models.ts`（如草稿类型需要）、`src/i18n/app.js`、`public/style.css` 及对应测试；变更局限于创建、配置编辑和手动查找入口，不重构整个应用。
- 管理端：`apps/console-webui/src/app.ts`、双语资源、仅服务已移除入口的样式及对应测试。任务详情返回 Packages，继续使用既有 Operation API。
- 构建：通过已有两端 WebUI 构建/同步入口更新 `internal/desktopassets`、`internal/consoleassets`，重建宿主嵌入资源。
- Core/CLI/API、浏览器代理协议、镜像发行来源、Work 配置存储、active/desired、导入导出及历史 Work 镜像均保持；本变更不迁移数据，不增加任务中心、历史发现、存储或恢复协议，不发布制品。
