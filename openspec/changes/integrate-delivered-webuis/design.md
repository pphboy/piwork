## 背景与授权

本变更执行用户直接给出的界面接入要求。两个 ZIP 已在本地检查并隔离解包，源码中的原型数据层不具备生产连接能力。以交付界面为视觉与任务组织来源，以仓库已有 API、主规格和 Go 服务实现为数据与权限来源。

## 设计决策

1. **保留 native DOM 与现有构建。** 不导入原型的 Vite 开发服务器；TypeScript 编译成浏览器 ES modules，并嵌入 Go。静态模块仅匹配允许的文件名且从 embed FS 读取。
2. **真实异步 adapter。** Desktop 覆盖会话、连接、Work/Service 控制、Operation、Session/Run、WebDAV、配置、包上传和 `.work` 迁移；Serve 覆盖管理员账号、运行时、默认 Work、Skills、Packages 和 Operation。未知结果必须查询已有对象或稳定 ID，不合成成功。
3. **Service iframe 保持。** 同一个 Work/Service/port 的 iframe 及祖先在聊天、弹窗和状态更新中原地更新，不能通过 detach/reinsert 保持外观而重新加载页面。首次进入使用短期 ticket，后续挂载使用已授权的独立 Service origin；Service 的嵌入策略保持原样，拒绝嵌入时提供独立应用入口。
4. **workspace 文件使用真实 WebDAV。** PROPFIND 携带本地 CSRF；上传保留 File 原始字节；文本以 UTF-8 严格解码且限制 1 MiB。写入丢失响应时保留草稿和未知结果，先刷新再决定后续操作；覆盖需要用户明确确认。
5. **配置事实分离。** 使用公开的 desired、active、pendingApply 及运行时 loaded/modelVisible；不展示内部 revision，不用版本一致推断已加载。不提供后端没有实现的单个 Skill 副本刷新；当前 Core 的 Skills 重选会刷新整个选择集，必须说明并确认。
6. **Serve 任务工作区。** 顶层为 Overview、User access、Work setup；Runtime 从 Overview 进入，Starting point/Skills/Packages 属于 Work setup，Find operation 为辅助入口。全部既有路由可直接打开和恢复。
7. **统一样式来源。** `apps/ui-shared/tokens.css` 定义公共颜色、字体、焦点和基础规则；两应用自己的 CSS 定义布局。构建时合并，Go 只服务完整静态资源。

## 风险及验证

- 原型是同步调用且整页重建：升级调用链，验证实际 Run 时 iframe 中未保存输入仍保留。
- 浏览器目录与 ZIP 的 multipart 契约不同：按既有 API 使用真实文件字段和相对路径，最终由 Core 验证。
- Go embed 加入模块：验证任意工作目录启动、深链接、模块读取和认证边界。
- 停止/导出/下载/导入是不同阶段：使用真实快照与 transfer，不下载占位 JSON，不自动启动导入 Work。
- 原导航规格需显式更新：本变更仅调整组织与文案，不移除管理能力。
