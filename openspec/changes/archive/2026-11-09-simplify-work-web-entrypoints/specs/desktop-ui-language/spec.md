# Spec Delta

## MODIFIED Requirements

### Requirement: 连接、账号和创建具有完整基本流程

**Identifier:** DUL-011

原型与规范 SHALL 呈现有效登录直达 Works、Core 地址/账号登录、当前身份、退出和登录过期恢复，分开表示 Core 可达与运行环境可用；切换 Core/用户不得复用另一身份的记录。关闭页面/详情或退出登录 SHALL 不隐式取消 Run、停止 Work 或删除数据；本地 CLI 进程退出导致入口不可用时 SHALL 提供恢复方向。

New Work SHALL 默认只要求名称并使用 Core 默认配置。Advanced SHALL 在新的创建表单及整页刷新后默认折叠，用户显式展开后仅提供 Skills、Packages、AGENTS.md 内容/文件。默认继承、显式选择、显式空集合 SHALL 区分；网页不提供镜像、完整配置 JSON、配置合并摘要或手动 Operation ID 查询。表单 SHALL 具有字段错误、取消、提交中、接受后准备、就绪与失败修正/重试路径，已发布的失败 Work SHALL 不要求再次创建。空列表 SHALL 提供 New Work/Import Work。

连接与创建表单 SHALL 以单列主要内容呈现，标签在输入上方，帮助与错误紧随字段；Advanced 收纳低频配置。Skills/Packages SHALL 以 Use defaults、Choose、None 或等价清楚表达区分省略与显式空集合；选择结果通过所属字段表达，不能双重提交。退出登录不改变 Work/Run 运行目标，本地入口恢复后先查询真实状态。

New Work SHALL 采用本变更所属紧凑版 A：桌面单列内容宽度约 480px，高度随内容自适应，不保留旧大弹窗的固定高度/空白；标题约 18px，字段输入正文保持约 13px。减少字段间留白，AGENTS.md 初始约三行且可滚动/调整高度，Cancel 与 Create Work 紧凑右对齐。窄屏按可用宽度收缩；字段选择增加、长名称、错误或长指令时允许主体滚动，主要按钮与必要反馈仍可达，不将示例高度作为内容上限。已有连接表单和其他浮层不随之改版。

#### Scenario: 首次创建一个工具
- **WHEN** 已登录用户使用默认配置创建命名 Work
- **THEN** 先看到被接受与准备状态，真实就绪后进入空 Work 对话，能从同一面板访问 Files/Settings

#### Scenario: 运行依赖不可用
- **WHEN** Core 可达但 runtime 无法准备 Work
- **THEN** 连接不被误写为全部 Ready，创建失败给安全原因和原 Operation；用户可检查或修正，不出现假成功

#### Scenario: 登录过期后返回
- **WHEN** 用户观察中的登录失效并重新登录同一 Core
- **THEN** 原已知操作按 ID 查询，未自动重发；另一身份的本地活动不混入

#### Scenario: 紧凑且默认折叠
- **WHEN** 用户在桌面或 360px 窄屏打开 New Work
- **THEN** 高级配置初始折叠；名称和创建/取消动作直接可达；展开后保持单列且无页面横向溢出，长内容通过主体滚动访问

### Requirement: Work 配置和 Pi Package 有完整保存与应用流程

**Identifier:** DUL-014

Settings SHALL 覆盖配置 show/set、Skills 目录与 Work 选择、AGENTS 内容/文件编辑、Pi Package 目录/安装/更新/启停选择/移除和 Advanced 完整配置。In use、Saved changes、Not applied SHALL 分别映射 active、desired、pendingApply；runtime loaded/modelVisible SHALL 单独表示，不把历史 active 当成当前加载。目录只显示真实可读元数据。Advanced SHALL 覆盖 modelRef/mcpServers/resources/tools 等允许编辑的公开字段，JSON 编辑/导入可作为高级入口；网页不提供 agentImage 编辑，提交保留 Work 已加载 desired 基线的原镜像，显式不同镜像输入须在保存前定位错误。其他字段的完整保留、错误定位及不暴露平台 secret/内部 revision 的规则继续适用。

Settings SHALL 使用行与分隔组织能力项，状态条说明已保存未应用，Apply 为独立主动作；编辑页的 Save changes 与整体 Apply 不同时争夺主动作。Skills SHALL 支持查看、选择和清空，区分重选 Core 副本与保留 Work 副本；Core Package catalog 仅是可复制来源，不代表 Work 已安装。AGENTS.md SHALL 展示当前/待应用内容并支持文件导入、编辑、保存与放弃；目录数据不得编造说明、评分或当前加载状态。

Package 来源 SHALL 包含 Core、npm、Git、本地目录和 ZIP，本地使用选择器上传；Update 明确新来源或当前 Core 副本，普通配置选择不得隐式安装/刷新包。所有 Package 改动只影响 desired，移除不得声称当前 active/历史引用立即物理删除。Apply SHALL 独立显示接受、进度、成功/失败/被取代和恢复；Run busy 不暗中取消；失败保留 active，回退失败明确 Work 故障；接受后的新编辑继续待应用，stopped Work 验证后仍保持 stopped。

#### Scenario: 安装后尚未 Apply
- **WHEN** 用户安装 Pi Package 成功
- **THEN** Settings 显示其 Saved/Not applied，当前运行 loaded 不凭安装成功改变，提供独立 Apply

#### Scenario: 编辑配置并离开
- **WHEN** 用户修改 AGENTS 或 Advanced 尚未保存并尝试返回
- **THEN** 可 Save changes、Discard 或 Keep editing；保存只改变 desired，不暗中 Apply

#### Scenario: Apply 失败和后续编辑
- **WHEN** Apply 正在运行时用户又保存新配置，随后原 Apply 失败或成功
- **THEN** 新 desired 保留；成功只激活原接受候选，失败保留 prior active，真实回退结果可查看

#### Scenario: 能力目录与 Work 配置
- **WHEN** 用户浏览 Core 的 Skills/Packages 并修改当前 Work 的选择
- **THEN** 目录来源、Work 已有副本和当前运行加载分别表达；可显式清空 Skills，AGENTS 可导入/编辑，选择不暗中安装、刷新或 Apply

#### Scenario: 设置 JSON 的镜像边界
- **WHEN** 用户在网页编辑或导入 Work 配置
- **THEN** 可编辑 JSON 不出现 agentImage；其他公开字段仍可编辑；导入不同镜像时有字段错误且不提交，普通保存不把原镜像改成默认或 active 镜像
