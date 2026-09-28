# 验收记录

- `openspec validate piwork-ui-language-refresh --strict`：通过；变更内四份既有能力的 delta spec 均为中文，并明确英文界面约束。
- `npm run build -w @piwork/console`、`npm run typecheck -w @piwork/console`：通过。
- `npm run test:browser -w @piwork/console`：42/42 通过，包括真实 Core 的管理员登录、创建用户及 Skill 上传。现有表单、上传、危险确认、草稿、未知结果和 Operation 观察行为仍通过。
- `npm run test:console-process`：通过。Core、独立 HTTPS 面板、操作员 CLI 与用户 CLI 进程可启动；面板停止后 Core 与 CLI 仍可用。未修改 Core/API/CLI 实现。
- 浏览器几何断言在 1440px 与 360px 覆盖所有已登录管理路由及 Skill、Package、Operation 详情；跨路由页标题、说明和一级 section 共享最大 1100px 轨道，两侧边界一致。用户创建和密码重置、运行时、默认 Work、Skill 上传与更新、Package 的 npm/Git/本地目录/ZIP 来源及 Operation ID 查询继续沿用内部表单网格，标签、控件、帮助、错误、字段组和动作对齐。登录使用相同外层轨道和最大 420px 居中单列。长账号、表格和 Operation 技术内容不产生整页横向溢出，主要动作保持可达。
- 浏览器测试核对英文登录、七个导航名称、页面和详情；已知错误码呈现英文解释，未知中文服务端消息使用中性英文说明并保留安全的 code、field 与 correlationId。原始中文 `AGENTS.md` 文件内容按原文显示，浏览器标题及无障碍名称使用英文。
- 页面结构测试核对当前事实先于表单、技术详情位于摘要之后；现有测试覆盖加载、空态、读取失败、写入结果待核实、上传阶段与最终 Operation 状态。已删除 Packages 页重复的范围说明。
- 1440px 与 360px 的登录、七个管理路由、Skill／Package／Operation 三类详情共 22 张新截图生成在 `test-results/ui-preview/`；已抽查 Runtime 桌面和 Default Work 窄屏截图。截图只使用临时 fixture，不含真实密码、API Key 或生产数据。
- 两份中文语言文档现按容器角色分别规定几何与内容职责；逐项对照 UIL-001、UIL-003、UIL-006 至 UIL-009，覆盖加载、空、字段／整区错误、草稿、提交中、结果未知、异步恢复、英文 UI、原始内容及后续新容器的归属规则。本轮仅调整面板静态界面、文档和浏览器验证，没有更改 Core/API/CLI 实现。

限制：截图使用临时 Core fixture，不能代替部署环境的证书信任或数据检查。自签证书需要本机浏览器信任。面板样式或文案修改后需重新构建并重启面板进程。
