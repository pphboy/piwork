# Proposal

## Why

目前仓库唯一的浏览器界面 `apps/console` 已有初版色彩、表单网格和英文文案，同页卡片也已对齐；但管理路由仍分别使用 1100px 和 760px 页面轨道，使标题与卡片在跨页导航时左右跳动。现有两套语言也尚未系统覆盖列表、表单、详情、技术内容与反馈等容器的尺寸和内容职责。补齐跨页共用的容器规则，才能让整个 Serve UI 在不同任务与状态下保持稳定的工作台布局。

## What Changes

- 完善中文 `docs/ui-language.md`：所有已登录管理路由采用同一个最大 1100px 页面轨道，页标题、说明与同级一级 section 左右边界一致；仅登录的单任务表单保持最大 420px 的窄容器。按容器层级规定表单、字段组、列表、表格、详情、技术文本、反馈和操作区的内部宽度、响应式与溢出方式。
- 完善中文 `docs/product-language.md`：按页面、section、表单、列表行、详情、技术披露、反馈、异步进度和确认等容器角色，定义各自承载的对象、事实、动作、异常与恢复入口；硬性规定未经明确要求，浏览器 UI 自有文字只使用英文。两份文档各有可逐页核对的检查清单；例外须在对应变更中说明。规范文档仍使用中文。
- 将 Serve 管理面板的登录、顶栏、导航、状态、用户、运行时、默认 Work、Skills、Packages 和 Operation 页面同时统一到这两套规则：视觉上沿用冷白淡蓝顶栏、浅蓝灰页面、白色 section、小圆角和单一亮蓝强调；所有管理页共享页面宽度和一级卡片边界，桌面表单的标签、控件、帮助／错误文字和按钮仍按卡片内部的同一网格对齐；产品表达上按“管理对象、当前事实、可修改内容、操作、结果或恢复”组织 Content。
- 统一各页面的加载、空、错误、警告、禁用、焦点与窄屏呈现；将七个导航入口及其页面的 UI 自有文字改为英文，保留七条路由、管理能力、安全、会话、上传和 Operation 语义。原始用户内容、资源名称和技术标识不翻译。
- 提供实施后的本地预览说明和桌面、360px 窄屏的可复核截图；构建后仍使用现有 `piwork-console serve` 通过 HTTPS 预览。

## Capabilities

### New Capabilities

- `ui-language`：在同一浏览器 UI 契约中分别定义独立的 UI 语言和产品语言要求，以及现有 Serve 管理面板对两套规则的实现和验证。

### Modified Capabilities

- `serve-ui`：现有 SUI-004 规定默认中文与中文导航名称，须与英文 UI 硬约束和七条原有路由保持一致。其余认证、安全和表单行为不变。
- `serve-ui-users`、`serve-ui-packages`：仅将直接引用的中文界面文案改为英文表达，保留用户会话影响、Package 来源与 Operation 恢复语义。
- `serve-ui-configuration`：除将直接引用的中文界面文案改为英文，还补充 Default Skills 长名称、无选择、不可用引用和排序操作的呈现约束；保留运行时 readiness、默认 Work 的局部提交与配置语义。

功能规格中的中文叙述仍作为中文规范保留；delta 只修订指向实际 UI 文案的条款，不把文案翻译误作功能变更。

## Impact

- 规划实施将涉及 `docs/ui-language.md`、`docs/product-language.md`、`docs/serve-console.md`、`README.md`、`apps/console/public/style.css`、必要的 `apps/console/public/index.html` 与 `apps/console/src/browser/app.ts`、面板自有错误展示及浏览器视觉和产品表达验证。
- 两套语言适用于当前和未来的仓库浏览器 UI；不要求终端 CLI 使用浏览器布局或 CSS 令牌，也不在只有一个浏览器 UI 时新增运行时 UI 包。
- Core、公开 API、认证边界、持久化格式、Operation 生命周期和 CLI 行为保持不变；不新增产品运行依赖。
