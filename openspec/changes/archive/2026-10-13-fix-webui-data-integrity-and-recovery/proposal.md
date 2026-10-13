# Proposal

## Why

交付 UI 接入真实 API 后，复核确认了 7 项数据保护、草稿及异常恢复问题，其中无条件文件写入和 Settings 跨页签保存存在覆盖数据的风险。需要将修复与验收独立列入 OpenSpec，补充原规格中未明确的状态转换，再通过 apply 实施，避免以已通过的正常流程验收代替异常路径覆盖。

## What Changes

- **R1：文件条件写入。** 编辑保存使用读取版本的修改时间；新建上传使用存在性条件；覆盖同意绑定已展示的目标版本，冲突与未知结果保留草稿且不自动重发 PUT。
- **R2：统一 Settings 草稿。** Skills、Packages、AGENTS.md 和 Advanced JSON 共享一个配置事实；切换页签或从不同入口保存不丢弃修改，非法 JSON 阻止提交并保留原输入。
- **R3：Run 游标过期恢复。** 410 后实际读取原 Run 与 Session，停止使用失效游标重连；活跃 Run 改为只读状态/历史观察，直到终态或本地观察结束。
- **R4：匿名检查后登录继续导入。** 同一本地会话、同一 Core 的首次登录保留已完整检查且尚未提交的本地包；账号/Core 切换继续遵守隔离规则。
- **R5：检查暂存可释放。** 取消或替换未提交的检查释放本地上传、观察和暂存；登录继续导入保留该暂存；已接受 Import 不被关闭弹窗取消或重发。
- **R6：Serve 显示真实包阶段。** 将实际 packagePhase 映射到英文显示阶段，保留原始值；失败、清理待完成和未知阶段不伪装发布成功。
- **R7：目录可用性独立恢复。** 成功读取目录后清除该目录的错误并恢复动作，部分失败保留可用数据，不掩盖 Core/readiness 状态或丢弃 Work 草稿。
- 为上述 7 项分别增加请求断言、状态转换和必要浏览器验收，重新构建并同步 Go embed，检查原有 Service iframe 保持、文件及迁移流程。

## Capabilities

### New Capabilities

无。沿用现有 Desktop 和 Serve 能力。

### Modified Capabilities

- `desktop-webui`：细化 DWUI-004、006、007、008 的游标失效恢复、写入条件、草稿一致性、目录恢复、匿名检查延续及暂存释放行为，并保持现有场景。
- `serve-ui-packages`：细化 SUI-PKG-003 的实际阶段显示、终态、清理待完成及未知阶段场景。

## Impact

- 主要影响 `apps/desktop-webui/src/adapter.ts`、`app.ts`、`models.ts` 与 Desktop 浏览器测试，以及 Console 的 adapter、Operation 视图与浏览器测试。
- 使用已有 WebDAV 条件头、Run/Session GET、`work-packages/:id` DELETE 和公开 Package Operation 字段；不新增 Core API、存储结构、CLI 命令或运行时依赖。
- 构建后更新两套 `internal/*assets/static` 嵌入资源，并按现有 Go CLI 路由和认证契约验收。
- 更新 `docs/webui-integration.md` 的对应接入说明，区分修复承诺、接口限制及已执行验收。
- 无破坏性协议变更；保留 Go Core/CLI、TS Pi Agentd、`.work` 格式、Work 生命周期、Service 独立 origin、CSRF 和用户隔离。
- 本变更承接 `integrate-delivered-webuis` 的接入结果，独立记录尚未完成的修复；不重设计界面、不扩大文件锁/ETag/自动合并、模型或 Service 功能范围。
