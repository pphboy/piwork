# Proposal

## Why

当前 Work Settings 的已运行实现缺少原型中的可点击“添加 Skill”入口和选择弹窗；Core 目录为空时既无法添加自己的 Skill，又显示“全部已添加”，用户无法开始使用。需要以本变更保存的 [v5 原型](prototype/index.html) 为界面与交互验收基准，补齐直接向 Work 导入 Skill 的闭环，并继续区分保存、应用和实际加载。

## What Changes

- Settings 按 v5 原型保留 Skills、Pi Packages、AGENTS.md 分类导航、可搜索的 Work 对象列表、编辑区及独立文件选择；对齐紧凑工具栏、对象菜单、局部反馈和窄屏对象选择，保留同 Work 返回与草稿。
- Skills 列表标题旁和 Work 空态内提供可点击的“添加 Skill”，打开原型同类选择弹窗；Core 候选不再常驻占据对象列表。分别表达目录为空、候选已全部添加、搜索无匹配和读取失败，不能把空目录当作“全部已添加”。
- 同一添加弹窗支持从启用 Core 目录勾选添加，或将本机包含 `SKILL.md` 的完整目录直接导入当前 Work。目录导入是针对已确认阻塞的必要补充，原型尚未模拟此来源；不要求管理员先建 Core 条目，不写入全局目录。
- 支持在 Settings 直接查看和编辑当前 Work 独立 Skill 的既有 UTF-8 文本文件，包括 `SKILL.md` 和配套文件；只修改该 Work 的 desired 副本，显式 Apply 后才采用。
- “添加 Skill”确认后立即捕获为该 Work 已保存、待应用的独立副本，随后可读取并编辑；只提交新增项，保留其他未保存编辑，不隐式 Apply。
- 增加必要的 Work 所有者编辑读取与原子保存接口，复用现有不可变 context 发布、权限和 Apply；添加或移除 Skill 时保留其他 Work 自有副本与未编辑文件，不隐式从 Core 刷新同名内容。
- **BREAKING（仅网页入口）**：移除 Work Settings 的 Advanced 及完整配置 JSON 编辑/导入，也移除“使用当前 Core 副本/替换为 Core 内容”入口；不迁移到其他网页菜单。现有 CLI/API 完整配置和显式重选能力保留，网页保存不覆盖未展示字段。New Work 的既有 Advanced 折叠项不在此范围。
- Skill 菜单明确绑定当前 Skill，只提供详情和从当前 Work 移除；AGENTS.md 导入直接呈现。可撤销的未保存移除沿用局部撤销，不增加文件创建、重命名或删除功能。
- 独立表达未保存、已保存待应用、Apply 及 Work/资源实际运行状态；正常一致状态保持轻量，等待属于原控件，必要失败与结果未确认就地保留。清除已确认解决的旧失败提示，不用草稿撤回或关闭提示确认未知写入。
- 保留 Pi Package 的既有来源、安装/更新/移除 Operation、启停配置、脑包详情和 Files 跳转，不将原型的内存演示当作真实包安装契约。

## Capabilities

### New Capabilities

无；在现有能力下补充 Work Skill 内容编辑与 Settings 行为。

### Modified Capabilities

- `work-configuration`：定义所有者目录导入、读取与编辑 Work Skill 的边界，保留未改动副本、非 UI 字段和原子 desired 更新；延续现有 Apply 捕获与运行隔离。
- `skill-management`：全局发现接口仍只返回名称，Work 私有导入不创建全局条目；仅显式的 Work 所有者内容接口可以读取自己的副本，不开放 Core 制品或他人 Work 内容。
- `desktop-webui`：按原型落实三分类、可操作的添加弹窗、直接目录导入、Skill 文件编辑、菜单范围、共享草稿与必要恢复。
- `desktop-ui-language`：将原型的导航、对象列表、添加入口和编辑区域作为布局及交互基线，保留真实状态与局部反馈规则。

## Impact

- Core：`internal/coreapp/work_configuration_*.go`、既有 Skill 目录上传校验、`internal/workcontext/`、`internal/workaccess/`；补充 Work 所有者目录上传并原子发布 desired，复用现有树限制与提交链，不改旧 CLI/API、active 快照或 Agent 只读挂载。
- 协议：`packages/contracts/src/` 的新增 Settings DTO 与 `scripts/generate-http-contracts.mjs` 生成链，以及生成的 Go DTO/schema/跨语言夹具；不新增 Agent RPC 或存储格式。
- 传输：`internal/cli/user_desktop_control.go` 的精确编辑与 multipart 上传路由，及托管工作台对同一 Desktop 入口的消费；既有会话、CSRF、上传预算和身份切换边界保留。
- Desktop：`settings-draft.ts`、`models.ts`、`adapter.ts`、`app.ts` 中 Settings 装配、双语文案和样式；复用 shared tokens/controls，按原构建入口同步 Go 内嵌资源，不恢复已移除的 `configuration.ts`。
- 验证：以原型逐项对照真实页面；必须从 Core 目录为空、Work 无独立 Skill 开始，经浏览器目录导入、编辑、保存、Apply，到真实 SDK 读取正文与配套文件。原有勾选任务仅代表前轮范围与证据，新增待办未完成前不得再宣称本变更完整交付。
