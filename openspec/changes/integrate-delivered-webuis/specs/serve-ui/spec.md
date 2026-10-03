## MODIFIED Requirements

### Requirement: 提供一致的管理员导航和表单状态

**Identifier:** SUI-004

面板 SHALL 采用用户交付的三个顶层工作区：`Overview`、`User access`、`Work setup`。`Overview` SHALL 使用 `/`，运行时配置 SHALL 保留 `/runtime` 并可从 Overview 进入；`User access` SHALL 使用 `/users`；`Work setup` SHALL 将 `/default-work`、`/skills`、`/packages` 分别组织为 `Starting point`、`Skills`、`Packages`。`Find operation` SHALL 保留 `/operations` 和已有 Operation 详情深链接，作为辅助导航，不声称提供全局操作历史。以上既有路由 SHALL 继续支持直接打开、刷新及浏览器前进后退；窄屏 SHALL 通过可操作的导航菜单提供相同入口。

未经另行要求，UI 自有文字 SHALL 只使用英文；用户内容、资源名称、技术标识和错误码保持原样。管理页面 SHALL 仅显示当前功能所需的公开数据，所有服务器返回文本 SHALL 按纯文本显示。列表 SHALL 区分加载、空集合、成功和失败；错误 SHALL 提供英文可执行提示及可复制 correlationId（如有）。表单 SHALL 在提交中禁用重复提交，验证失败保留非敏感草稿并定位字段；成功后显示 Core 确认结果并刷新相关数据。

离开有未提交更改的页面或覆盖草稿 SHALL 提示丢弃确认。删除、禁用账号及密码重置 SHALL 有含目标名称与实际影响的英文确认步骤。未知结果的变更 SHALL 提示先查询当前状态；只有显式重试且具备稳定幂等键的包安装/更新可以重放原提交。控件 SHALL 有英文可访问名称、键盘操作及可见焦点；360px 宽屏下表单和主要动作仍可操作，宽表格可横向滚动。未知页面 SHALL 返回 404；不提供任意 URL/路径代理。

#### Scenario: 管理员按任务进入工作区
- **WHEN** 管理员完成登录并打开首页
- **THEN** 显示真实 Core 配置及 readiness，提供运行时配置、用户访问、默认 Work 与能力管理入口，不把未配置运行时表达为认证失败

#### Scenario: 深链接与移动导航
- **WHEN** 管理员直接打开任意既有管理路由、刷新或使用浏览器前进后退
- **THEN** 页面保持对应功能及当前会话检查，窄屏菜单能进入三个工作区和 Operation 查询

#### Scenario: 空列表与加载失败
- **WHEN** 列表尚未完成、返回空集合或请求失败
- **THEN** 分别显示英文加载状态、带创建入口的空态或错误重试入口，失败不能显示为没有数据

#### Scenario: 保存失败保留编辑
- **WHEN** 表单提交被 Core 拒绝或响应丢失
- **THEN** 保留非敏感草稿并提供修正或读回入口，不能把未知结果表示为已保存或自动再次提交

#### Scenario: 高风险变更经确认
- **WHEN** 管理员禁用账号、重置密码或移除资源
- **THEN** 确认步骤显示目标及真实影响，取消不发送变更请求

#### Scenario: 恶意名称与窄屏操作
- **WHEN** 数据含 HTML 字符，管理员通过键盘或窄屏访问页面
- **THEN** 字符按文本呈现，主要动作可聚焦和执行，不注入脚本或遮挡提交按钮
