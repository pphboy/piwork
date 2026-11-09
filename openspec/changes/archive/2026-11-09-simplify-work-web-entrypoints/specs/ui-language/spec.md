# Spec Delta

## MODIFIED Requirements

### Requirement: 页面按管理对象和作用范围组织信息

**Identifier:** UIL-006

Serve 管理面板 SHALL 遵循当前 serve-ui 管理导航及保留的详情深链接，在每个页面按“管理对象与范围、当前可确认事实、可修改内容、操作、结果或恢复”组织 Content。一个 section SHALL 对应一个清楚的管理目的；页面标题、section 标题、字段标签和帮助文字 SHALL 各司其职，帮助文字仅补充作用范围、限制或后果，不重复标题或标签。状态与列表 SHALL 优先显示做决定所需的摘要；时间、ID、来源及原始配置 SHALL 作为可访问的次级信息。缺少当前事实时 SHALL 明确标记加载、空、失败或未知，不展示装饰性占位值；设置页的首次读取也 SHALL 给出对应对象的加载状态。标题和帮助文字 SHALL 说明关键设置影响 Core 全局、后续新 Work 或当前条目，不能暗示已有 Work 因默认配置改变而自动更新。有列表的详情页 SHALL 提供返回列表的明确入口；已知 Operation 详情 SHALL 提供刷新原任务及返回 Packages 的入口，不提供手动输入 Operation ID 的查找。技术细节 SHALL 在主要状态和操作之后呈现，不以原始 JSON 代替结果摘要。长名称或标识 SHALL 在其对象旁保留完整可读取或可复制的值，缩略显示不得成为唯一访问方式；状态、无效原因和操作 SHALL 与该对象保持可辨关联。

#### Scenario: 管理默认 Work 与运行时
- **WHEN** 管理员查看全局运行时或默认 Work 并准备保存
- **THEN** 页面先展示当前状态，编辑区说明作用范围和保存条件，保存入口紧随对应表单；默认 Work 明确只影响后续新 Work

#### Scenario: 查看包操作详情
- **WHEN** 管理员通过已知任务入口或保存的 Operation 详情 URL 打开详情页
- **THEN** 页面先展示 ID、当前状态、阶段及可用操作，再展示技术详情；能找到返回 Packages 和刷新原任务的入口，不导向已移除的手动 ID 查找页

#### Scenario: 页面 Content 与空态
- **WHEN** 管理员查看列表、设置页或对象详情，而当前数据为空、仍在读取或读取失败
- **THEN** 页面仍保留管理对象与作用范围，明确区分这些状态，只展示必要的下一步、已有确认事实与可访问的技术详情，不重复帮助文字或用原始 JSON 充当正文

#### Scenario: 长名称与技术标识
- **WHEN** Skill 名称、Package 来源或 Operation ID 长于可用行宽
- **THEN** 管理员仍可在对象附近读取或复制完整原文，并能辨认对应状态和动作；截断文字不成为唯一信息来源

### Requirement: 文案准确表达动作、状态与下一步

**Identifier:** UIL-008

Desktop、Serve 与引导的浏览器 UI 自有文字 SHALL 同时提供简体中文和英文，并按当前语言选择显示，包含导航、页面与 section 标题、字段标签、按钮、帮助、空态、加载／成功／失败反馈、校验提示、确认对话框、浏览器标题及无障碍名称；`html` 的文档语言 SHALL 与可见 UI 一致。导航组织与英文名称 SHALL 采用有效 `serve-ui` 与 `ai-model-management` 契约：`Overview`、`User access`、`Work setup`，以及独立的 `AI models` 入口；运行时和能力子页面保留既有深链接，已知 Operation 详情保持可达，不提供 Find operation 手动 ID 查询入口。既有业务导航入口 SHALL 不因语言支持而新增、移除或重排；语言菜单按 UIL-I18N-001 提供。UI SHALL 对 `Core`、`Work`、`Skill`、`Package`、`Operation`、`Runtime` 和 `Default Work` 等对象使用稳定一致的中英文术语，不用不同名称指代同一对象。用户提供的文本、资源名称、文件内容、技术 ID、错误码及 correlationId SHALL 保留原值，不因界面语言被翻译或改写；未经确认的服务端自然语言错误消息不能直接作为 UI 主说明，面板 SHALL 提供所选语言的说明和下一步，并将安全的错误码、字段及关联 ID 留作辅助诊断，不让诊断串替代主要反馈。规范文档可以使用中文；终端 CLI 不受浏览器 UI 双语约束。页面与字段标题 SHALL 简短指明对象；操作按钮 SHALL 使用所选语言中能说明结果的动词和对象，避免孤立的 `Submit`、`OK` 等含糊词。排序等重复行操作 SHALL 用简短可见动词及包含完整对象名称的无障碍名称区分目标。帮助文字 SHALL 只补充用户作决定所需的作用范围、限制或后果。加载、空集合、请求失败、结果待核实和成功 SHALL 使用不同措辞；反馈 SHALL 先陈述可确认的事实，再给出下一步。字段校验错误 SHALL 紧邻字段并说明修正方式；整页读取或提交错误 SHALL 放在对应 section 并提供可执行的恢复方式。未保存草稿、提交中、成功、提交前失败与提交结果未知 SHALL 分别表达，未知结果在重新读取当前状态前 SHALL 不提示自动重试。异步上传、Core 接受与 Operation 终态 SHALL 分别表述；不能把上传完成、已接受或旧状态写成最终成功。文案 SHALL 简洁、直接，不使用营销化承诺。

#### Scenario: 空集合与读取失败
- **WHEN** Skill 列表为空或读取 Skill 列表失败
- **THEN** 空态说明尚无条目并给出上传入口；读取失败说明无法取得当前列表并提供重试，不声称条目不存在

#### Scenario: 保存与运行状态不同
- **WHEN** 运行时配置已保存，但 Core 返回运行时不可用
- **THEN** 页面分别说明“配置已保存”和“运行时暂不可用”，保留真实状态码供诊断，不宣称整体失败或已就绪

#### Scenario: 包安装结果尚未确定
- **WHEN** 浏览器上传结束、Core 已接受安装，或观察 Operation 的请求中断
- **THEN** 页面分别说明上传、接受或观察中断的已知事实，保留 Operation ID 和历史状态，提供继续查询入口，不宣称安装完成或自动重提

#### Scenario: 界面语言与原始数据
- **WHEN** 管理员在中文或英文面板查看资源名称、`AGENTS.md` 内容或 Core 返回的其他语言错误消息
- **THEN** 导航、操作、提示、确认与无障碍名称使用所选语言；用户内容和技术标识保持原值；未经确认的服务端自然语言消息不直接充当 UI 主说明，管理员仍能看见所选语言的原因或状态、下一步以及安全的诊断标识

#### Scenario: 字段错误与整体失败
- **WHEN** 表单同时有字段校验错误与一次读取或提交失败
- **THEN** 字段附近说明该字段的修正方式，section 内单独说明整体失败及下一步，错误码、字段和关联 ID 只作为辅助诊断，且不将未确认的服务端自然语言消息当作主说明

#### Scenario: 草稿、提交与未知结果
- **WHEN** 管理员编辑设置并提交，随后遇到请求中断或明确的校验失败
- **THEN** 界面区分未保存草稿、提交中、明确失败和结果未知；明确失败保留可修正草稿，结果未知提示先读取当前配置，不暗示已保存或自动重提

### Requirement: 图标语义与紧凑头部跨入口一致

**Identifier:** UIL-V13-CHROME-001

Desktop/Serve SHALL 沿用当前共享浅色语言、紧凑头部层级与原 PW 资源，不因等待、通知或增加评审入口而增高头部或新增无用途空白。宽屏 Desktop 首页与 Admin Header SHALL 等高为52px，并共享水平对齐基线；Work 身份 Header 同为 52px，Service Toolbar 保持 39px 的次级密度。首页 Header 的既有 B 控件保持 icon-only，Work 列表/卡片的 Open 使用明确的轻量文字导航，必要的进入图形按同一语义取得，不强制再附图标。窄屏按必要布局折行为88px双行而不隐藏主要操作；其他本次未涉及的管理页面与表单继续使用自己的有效布局。

Work 的 Open SHALL 明确表示进入工作区，不使用播放或 Service 外链语义；列表/卡片允许只显示明确文字，其他需要图形的完成出口仍用共享进入语义。Start 继续表示生命周期启动，Service 新标签打开使用外链语义。Refresh SHALL 共用本变更确定的循环双箭头路径，常规图形为18×18 CSS px，不因小尺寸上下文缩成16px；图形尺寸不缩小原可操作热区。两端同语义 Refresh 使用同一来源，发起动作与真实目标由准确文字/无障碍名表达，busy 前后保持固定槽与几何。

本次局部呈现更新 SHALL 以当前规格和所属冻结原型为准，不从历史画面推导未声明的新行为；Service 与 Chat 次级工具栏保持39px；Files 列表/详情工具栏使用本变更明确的 44px 局部密度。Administration 的 Overview、Users、Setup、Models 四个短主导航与 Services/Files/Chat 导航 SHALL 使用对应批准的 18px SVG，保留双语可访问名称、真实权限及原导航目标；Setup 下 Defaults/Skills/Packages 次级导航 SHALL 保持 39px。Quick setup、Skills 与已知未结束操作 SHALL 继续在所属管理入口可达；Find operation 手动 ID 查询入口 SHALL 移除，其余入口不移动到 Work 行菜单。正常密度 SHALL NOT 裁掉长错误、未知状态或必要恢复控制。

#### Scenario: V14 覆盖历史视觉数值而不覆盖业务
- **WHEN** 实施者将52px/88px头部、Files的44px局部密度及共享图形应用到产品
- **THEN** 使用真实会话、健康及模型来源，保留首次读取、陈旧与未知状态；宽屏和 360px 对照验收分别记录，不能以历史记录或合成原型模拟宣称真实实现已通过

#### Scenario: Open 与 Start 分开
- **WHEN** Ready Work 显示 Open 而 Stopped Work 显示 Start
- **THEN** 列表/卡片的 Open 是明确的轻量文字导航且仅进入工作区，Start 仍执行启动；必要进入图形不使用 Service 外链或播放语义

#### Scenario: Refresh 大小一致
- **WHEN** 用户比较 Works、Files、Serve 或详情里的常规 Refresh
- **THEN** 18px循环双箭头来自同一共享定义，热区/文字对齐及 busy 前后几何保持，不用相似图形暗中切换身份或重试业务

#### Scenario: 紧凑 Header 与原 PW 标记
- **WHEN** 宽屏或窄屏查看 Works、Work、Service 和 Admin
- **THEN** 沿 V12/V13 的紧凑层级保留必要名称与动作，PW 图形不变形不重绘，不因普通反馈新增头部行
