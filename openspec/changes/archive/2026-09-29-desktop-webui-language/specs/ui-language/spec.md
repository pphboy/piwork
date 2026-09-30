# Spec Delta

## MODIFIED Requirements

### Requirement: 仓库分别提供可沿用的 UI 语言与产品语言

**Identifier:** UIL-001

仓库 SHALL 分别提供中文 `docs/ui-language.md` 与 `docs/product-language.md`。前者 SHALL 定义视觉适用范围、色彩角色与具体令牌值、跨页统一的页面轨道、同级一级卡片的左右边界、各类容器的内部宽度与表单对齐网格、长内容溢出、字阶、间距、圆角、边框、控件外观、响应式和可访问性；后者 SHALL 按页面、section、表单、字段组、列表行、详情、技术披露、反馈、异步进度及确认的容器角色定义 Content 的信息组成与取舍、页面信息顺序、按钮位置与主次、稳定术语、UI 自有文字的语言、按钮和帮助文案、长名称与技术标识、选择与排序、草稿与提交、各级错误、设置作用范围、反馈、确认及异步恢复方式。两份文档 SHALL 各有后续新建或调整浏览器 UI 的检查清单及一致性检查方法。后续 Serve 管理界面变更 SHALL 同时以两份文档为依据；不适用的规则 SHALL 在对应变更中记录偏离项、理由和替代方式。CLI Desktop WebUI SHALL 沿用其中的共享语义颜色与产品表达原则，并以中文 `desktop-ui-language` Spec 统一规定产品语义、工作区结构、容器、视觉和交互；该能力在变更期间由 delta spec 表达，同步后位于 `openspec/specs/desktop-ui-language/spec.md`；Serve 管理页的 1100px 页面轨道、固定管理表单网格与七项导航 SHALL 只约束 Serve，不直接约束 Desktop。后续 Desktop 变更 SHALL 引用该 Spec 的需求编号，并记录有理由的偏离项及替代方式；仓库文档只提供导航和说明，不要求额外维护三份 Desktop 规范文档。终端 CLI 的字符界面不受浏览器布局或 CSS 视觉令牌约束。

#### Scenario: 后续新增浏览器页面
- **WHEN** 仓库后续新增或调整一个浏览器管理页面
- **THEN** 设计与实现能分别按两份文档选取视觉令牌，以及页面、按钮、文案和反馈规则；评审可逐项核对，未说明例外的页面不另起一套视觉或操作表达

#### Scenario: 特殊场景需要例外
- **WHEN** 新界面的具体使用场景不能沿用一项视觉规则
- **THEN** 对应变更明确记录属于哪套语言的偏离项、原因和替代方式，其余规则继续适用

#### Scenario: 后续新增 Desktop 功能
- **WHEN** 后续变更为 CLI 本地 Desktop WebUI 增加界面或流程
- **THEN** 评审核对 `desktop-ui-language` Spec 的对应需求与共享颜色、文案原则；不会把 Serve 管理页的 1100px 轨道、表单网格或七项导航当作 Desktop 默认结构
