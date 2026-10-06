# Design

## Context

动机与基础范围见 [proposal](proposal.md)。`apps/cli` 已有 Work、Session/Run、Service、配置、快照及 proxy/WebDAV 能力，Desktop 尚未实现。本变更把已确认的产品语义、交互结构和视觉规则固化为规范与静态原型；当前 CLI 的可用能力与未来浏览器体验分别表达。

## Goals / Non-Goals

**Goals:**

- 用现有 36 幅原型、能力矩阵和中文规范形成一致的实现依据，保留需求编号和画面编号。
- 固定对象归属、容器职责、状态与恢复边界，使用户能完成基本任务，界面整洁一致。
- 用少量共享样式与控件规则支持整体调整，以完整流程和基础 UI 质量验收 MVP。

**Non-Goals:**

- 本变更不交付运行中的 WebUI、不选择前端框架、不实现本地认证或浏览器网关。
- 不改变 Core/CLI/agentd 的接口、权限、运行准入和 `.work` 包格式。
- 不增加独立高保真样板、主题编辑器或通用设计系统阶段；不扩大 proposal 中的基础功能范围。

## Decisions

### 1. 以 Spec 统一承载产品、交互与 UI 规则

| 材料 | 职责 |
| --- | --- |
| [Desktop Spec](specs/desktop-ui-language/spec.md) | DUL-001 至 DUL-016：用户场景、产品语义、容器与返回、视觉角色、状态和验收行为的唯一规范来源 |
| 本 design | 设计理由、组织方式、既有能力边界、规范迁移及后续实现依赖 |
| [原型说明与能力矩阵](../../../../docs/design/piwork-desktop-prototype.md) | CLI/协议能力对应的画面、入口、操作、结果、失败及返回 |
| [评审目录](../../../../docs/design/desktop-review/README.md) | 按模块和单画面检查静态设计 |

后续功能引用 Spec 的需求编号、所属场景及能力映射。Spec 必须可独立用于实现和验收；design 解释选择原因，原型展示布局与流程。此前三份 Desktop docs 是迁移输入，规则补全后移除，不作为额外的规范来源。这样可避免修改 Spec 后还需同步三份正文造成规则分叉。

| 迁移输入 | 规则归属 |
| --- | --- |
| `docs/desktop-product-language.md` | DUL-003 用词/信息/反馈，DUL-010 用户及六类场景，DUL-004 至 DUL-006 与 DUL-008 至 DUL-015 的访问和任务契约 |
| `docs/desktop-design-language.md` | DUL-002 容器/导航/返回，DUL-003 表单状态，DUL-007 焦点与可达性，DUL-008/DUL-009 生命周期与迁移，DUL-016 评审材料 |
| `docs/desktop-ui-language.md` | DUL-007 完整配色、字阶、比例、对齐、控件与窄屏，DUL-002/DUL-011/DUL-014/DUL-015 的容器和表单呈现 |

文档中的重复段落合并到对应条款；英文示例保留其动作和状态含义，视觉近似尺寸保留为基线，允许按可读性调整。文档中“无 Service 即可聊天”的省略条件统一为 Work 对话准入成功；无锁/ETag 时始终不承诺版本保护或自动合并。既有硬规则均进入 requirement 与 scenario，不仅留下“参见文档”。

### 2. 以一个 Work 组织任务与容器

Work List 是首层；打开后进入独立 Work 面板，身份、状态、返回与生命周期动作常驻。日常用户在同一 Work 内操作 Service、管理文件和与 AI 对话；Settings 和诊断按需进入。沿用同一工作区可以保持对象归属并减少导航层级；不采用必经 Work 总览或跨 Work 侧栏。

| 容器 | 职责与返回 |
| --- | --- |
| Work List | 搜索、创建、导入、打开与状态快捷动作；已知 Operation 活动按需出现 |
| Services 主区域 | 显示实际应用；在 Work 内切换 Service/端口，Manage services 进入同 Work 列表与详情 |
| Files 主区域 | 操作当前 Work workspace 文件，保留 Agent 辅助栏 |
| Chat / Agent 辅助栏 | 复用同一 Session；可聚焦或返回 Service/Files，不产生两个独立输入上下文 |
| Settings | Skills、Packages、AGENTS、Advanced 与显式 Apply；返回原 Work，未保存编辑先处理 |
| 对象详情与确认 | Service、Run、Operation、日志及危险操作，始终显示对象与返回来源 |
| Service 独立窗口 | 一键访问同一 Service，保留 Work 身份与返回；关闭不停止服务 |

默认选择上次仍可用的 Service，否则选择已就绪的默认 Web 入口。无可用 Service 且对话准入成功时，或用户聚焦 Chat 时，对话占主区域；Work 停止或准入失败时，显示相应限制和恢复动作。Services / Files / Chat 同级切换，Settings 明确可达。

关闭详情、返回列表和切换 Session 只改变观察。Desktop 保留自己知道的 Work/Session/Service/端口及非敏感草稿；Service 内的表单、滚动、DOM 和跨窗口同步由应用负责。具体行为见 DUL-002、DUL-004、DUL-011 至 DUL-015。

### 3. 通过共享规则达到 MVP 的基础 UI 质量

沿用 Serve 浅色语义令牌，使用常规列表、表单、菜单与详情。统一颜色、字阶、间距和圆角变量；按钮、输入、状态、列表行与确认框复用规则。全局变量修改影响其全部 Desktop 使用处，组件修改影响该组件使用处，局部布局只影响所属页面；Service 内部样式独立。这样可以整体调整并避免每页重复设计。

Work List 使用“名称与摘要／状态／快捷动作／更多”的稳定列结构：圆点紧邻状态文字，状态、按钮与菜单行内垂直居中、跨行同列对齐，控件尺寸和间距一致。行导航与 Start/Retry/菜单独立触发；长名称不能挤走动作，窄屏允许按相同顺序分行。

首版 UI 文案使用英文，用户内容保持原文；主次通过位置、字阶和按钮层级表达。基础验收包含可读性、无错位遮挡、真实状态、必要反馈、可见焦点、360px 可达性与明确返回。实际字体和宽度由实现验证，静态坐标不作为机械复刻要求。DUL-007 约束统一视觉与可达性，DUL-010 约束 MVP 质量及避免过度设计；不将装饰动效或额外样板设为前置交付。

### 4. 统一状态、动作与恢复语义

通用反馈按“目标、已确认状态、下一步”组织。技术 ID、阶段和时间保留在所属对象的详情或状态区，不替代日常任务文案。操作接受、执行与业务完成分开；观察中断保留最后已知时间，按原 ID 查询。成功、失败、未知和互斥状态不能同时被当作产品当前结果显示。

| 对象 | 不变量与恢复边界 | 规范 |
| --- | --- | --- |
| Core/身份 | Core 可达、runtime 可用与身份分开；重新登录先查询原操作，切换身份不混用记录 | DUL-003、DUL-011 |
| Work | Start/Stop/Retry/Delete 含义不同；Stop 失败不以 Retry Work 启动；停止保留数据但不能重新加载 Session/Run，旧消息标明非实时 | DUL-008、DUL-012 |
| Session/Run | 标题取已加载消息摘要或时间/ID；单 Work 单活跃 Run；取消须显式，断线按原 Run/游标恢复，不重发 prompt、不暗示队列 | DUL-012 |
| Service | Stop 持久禁用；Start 不启动 stopped Work；Restart 有运行前提；Remove 保留共享文件且不能用 Start 撤销；日志为有限尾部加 Refresh | DUL-013 |
| Settings | desired 保存、active 激活与 runtime loaded/modelVisible 分开；Package 安装与开关只改 desired；Apply 独立、busy 不暗中取消 Run、失败与后续编辑可恢复 | DUL-014 |
| Files | 写入影响当前路径；覆盖/删除确认，部分失败逐路径说明，未知先重读；无锁/ETag 不承诺自动合并 | DUL-005、DUL-015 |
| 导入导出 | 显式 Stop 并确认后再 Export；快照完成后下载；同 snapshot 恢复，默认保留期 24 小时；Import 发布成功后为 stopped，Open 与 Start 分开 | DUL-009 |
| 已知操作 | 仅保存当前 WebUI 已知的 Core/用户、类型、对象与 Operation/snapshot ID、时间；按 ID 恢复，不保存包字节/凭证，不冒充全局历史 | DUL-009、DUL-016 |

六类用户场景与八组基础能力均按现有能力矩阵验收。高级创建选项、Package 各来源、文件表单、控制前提及具体失败场景继续由原条款覆盖，不因归并为通用规则而删减。

### 5. 明确浏览器、Service、文件与 Agent 的访问边界

目标链路如下；本变更只规定其可观察体验，本地浏览器入口由后续实现变更交付。

```text
Browser Desktop / Service window
              |
              v
      CLI local browser entry
              |
              +--> Core Service gateway --> Work Service
              |
              +--> Core WebDAV ---------> Work workspace
```

- 浏览器内嵌、独立打开与 Copy link 一键使用本地认证入口，用户无需配置代理/PAC。Core 映射域名用于身份与复制，浏览器链接用于直接访问；入口需支持 HTTP、SSE、WebSocket、正常导航/跳转/会话及不同 Service 的状态隔离。目标拒绝 iframe 时独立打开。
- 浏览器 Files 经受保护的本地入口转接 Core WebDAV，根为共享 `/var/data/workspace`，只在运行且准入成功时可访问。Service 显式挂载才共享；根与特殊文件受保护，同 Work Move/Copy，不承诺目录 ZIP 下载或超限文本编辑。
- 外部 curl/WebDAV 工具继续使用现有 CLI proxy。WebDAV URL 使用完整 Work ID；临时密码从启动终端一次获取，重启失效，不回读到页面、URL 或持久记录。浏览器 Files 不要求用户完成该手动配置流程。
- Agent 仅在用户明确请求后读取实际可达文件或 Service API，并说明来源。选中 Service 提供身份上下文，不自动传递页面 DOM、输入或内存；无文件/API 时说明不可读取。

DUL-004 至 DUL-006、DUL-015 约束这些边界。现有 forward proxy 的可用性不能作为浏览器免配置访问已完成的证据。

### 6. 保留可独立评审的静态交付

Excalidraw 为可编辑源，PNG 内嵌等价场景。保留 01–36 编号，按 A–H 八组分开放置、每组最多两列，提供独立模块和原尺寸单画面预览；总图负责定位。画面之间约 400px、模块之间至少 1000px 的现有留白用于人工评审，不约束产品页面间距。

并列的互斥状态是评审变体，模拟 Notes 是 Service 示例；二者均不新增 Desktop 产品功能。原型与能力矩阵按 Spec 验收，不能凭一个按钮或一张成功截图认定流程覆盖；原型说明仅提供索引、解读及覆盖证据。

### 7. 将规范交付与运行实现分别验收

本 change 的任务仅对应规范与静态原型。后续实现开始编码前，应把以下已有依赖落实到其技术 design 与可执行任务；本次整理不添加新的产品探索阶段。

| 技术依赖 | 已确定的用户验收目标 |
| --- | --- |
| CLI 启动命令、本地进程与认证生命周期 | 本机启动可进入 WebUI；登录/过期/退出/入口失联有真实反馈，关闭页面不隐式停止 Work |
| 浏览器 Service 入口、隔离与认证转接 | 无代理设置，一键内嵌或独立访问；HTTP/SSE/WebSocket、跳转和会话可用 |
| 文件转接、文本编辑与大小限制 | 同 Work 文件读写可完成，超限拒绝可理解，覆盖、未知及部分失败可恢复 |
| Work 包与 Package 来源传输 | 文件/目录选择、完整检查、导入/安装进度、大包传输与下载恢复可用 |
| 本地已知操作记录 | 重载和重新登录后按原 ID 查询，跨 Core/用户隔离，无凭证或包内容持久化 |

这些实现依赖不改变本轮已确定的导航、产品语义和基础范围。前端框架、具体路由与限额在实现变更中明确，不能在编码现场任意补齐；本 change 的任务完成不作为运行功能已验证的证据。

## Risks / Trade-offs

- Service 的 Cookie、跳转、同源和嵌入策略可能影响访问：在实现变更中验证本地入口和隔离，保留拒绝嵌入时的独立窗口路径。
- 静态图不能证明浏览器行为、可访问性与大包传输：实现按同一能力矩阵进行真实功能验收。
- 页面变化或缓存容易造成错误承诺：以实际准入和状态为准，停止历史、任意网页状态及未知计数按限制表达。
- 观察中断后重提可能重复副作用：操作按原 ID/游标恢复，文件写入未知先重读。

## Verification / Migration

本变更无运行数据迁移或部署。

规范来源迁移分三步：

1. 在当前 change 的 `specs/desktop-ui-language/spec.md` 补全三份 docs 的规则和场景，更新 UIL-001 的 Desktop 适用规则；保留所有既有需求编号。
2. apply 阶段移除三份 `docs/desktop-*-language.md`，更新 `docs/product-language.md`、`docs/ui-language.md` 与 `docs/design/piwork-desktop-prototype.md` 的入口，清除失效链接与“三份文档为准”的要求。活动说明引用规范能力名 `desktop-ui-language` 和 DUL 编号；同步前可用普通代码路径说明目标主规范，不能建立指向尚不存在文件或即将移动的 change 目录的长期链接。
3. 后续通过 sync/archive 将本 delta 合入 `openspec/specs/desktop-ui-language/spec.md`；该主规范为持久入口。apply 不隐式执行同步或归档；旧文档仅在历史任务与迁移说明中作为来源记录保留。

规范交付检查：DUL-001 至 DUL-016 与 UIL-001 编号保持；能力矩阵覆盖八组基础功能；正常、空、加载、停止、失败、未知与返回场景相互一致；Spec 独立包含规则和验收场景；删除后的相对链接有效；36 个 Frame 与预览可追溯。保留既有阶段完成记录，以新的迁移任务跟踪清理，不能以先前完成状态宣称迁移已完成；通过 OpenSpec strict 和文本差异检查。

运行 MVP 的完成条件：按矩阵走通真实操作与恢复，验证字体、长内容、键盘、窄屏、状态、访问和数据边界。基础功能缺失、误导状态、错位遮挡或缺少反馈必须修复；缺少装饰动效或独立高保真样板不阻止交付。
