# Design

## Context

本变更按 [proposal.md](proposal.md) 收敛为四个实施模块。基线 `efce08c228c12f10d18a968b69c3398bb0e783e1` 与现状图提交 `4cb118450a89383825d8e136a131eaf7cbc5c543` 的 UI/Core 源码相同。图02/04/05/07/08为原样前端加合成 API 的浏览器渲染，不代表真实 Core/Docker/付费模型测试。

现有可复用部分：`onboarding.ts` 的设置授权和手动登录；`quick-setup.ts` 的模型/Runtime 分段确认、unknown 读回、view/identity/readGeneration；Console 和 Desktop 的 ActionState/对象锁、Desktop 的局部读取与 DOM 连续性；`apps/ui-shared/{tokens,controls}.css` 及现有静态资源嵌入。当前问题主要是呈现、默认草稿、刷新方式和部分独立请求缺少可见等待。

### Core 等待的真实边界

```text
Server: coreapp.New -> HTTP listening -> Runtime 自动准备 -> 浏览器引导
        [尚无产品网页]                   [现有页面可显示三点]
Desktop: 本地 HTTP/静态壳 -> 授权检查 -> Core 连接检查 -> Works
         Desktop 不负责启动 Core
```

HTTP 监听前的初始化仍由终端报告；本次三点覆盖现有网页中的 Core 连接/检查、Runtime 准备，不承诺给不存在的网页显示动画。不新增启动壳、提前监听或持续离线探测。

## Goals / Non-Goals

- 复用已有组件和业务状态，以四模块完成必要调整；[31位置](pending-map.md) 全部保留作为接入索引。
- 主流程连贯、默认仅填 Key、等待可辨，背景读取不打断内容和输入。
- 不改 Core 业务/接口、六项准备逻辑、对象锁或未知结果恢复机制；不引入新状态管理/导航框架。
- 不实现创建后的自动认证，不保留密码给后续登录；不增加 Modal 动画、全局遮罩、自动 Test 或付费测试。

## Decisions

2026-10-20 所有者已接受精简方案：**D1 保留局部单次自动进入，D3 采用手动正常登录并延期自动认证。** 后续同日授权已允许 apply 和推送 PR，同时明确只改 UI；D2 Go启动地址调整因此移出本轮，不改后端认证或运行逻辑。

### M01 首设界面

**D2不在本轮：** `internal/app/run.go` 的浏览器打开目标、SetupLink生成/终端交付、HTTP监听和错误输出均保持原样。授权链接由现有方式取得，前端仅优化已有页面。

授权、创建管理员和登录页沿 Desktop 组件规范整理任务文案、字段错误与按钮三点。创建成功后清空密码，进入普通 Sign in，由用户手动提交正常凭据；不增加自动认证链。证明兑换、来源/CSRF、原子首管理员、两次密码确认及清理继续按 ONBOARD-001/005、UIL-SETUP-001 和既有认证实现，不重做。

### M02 QuickStart

```text
现有授权链接 -> 创建管理员 -> 手动正常登录 -> Key / 高级设置
 -> 直接 Save and continue -> 确认模型和 Runtime
 -> 准备摘要（三点；六项明细默认折叠）
 -> 全部 Ready 且本次首设意图有效 -> 单次进入工作台
```

**默认与 dirty：** 只给 Quick setup 的首次空配置新草稿预填 `deepseek-flash`、`anthropic-messages`、`https://api.deepseek.com/anthropic`，主区域只展开 Key，Model ID/协议/地址/名称在可编辑高级区。复用 `model-form` 的字段与校验，不全局修改完整模型管理的空表单。dirty 比较初始默认/已读选择与当前草稿；新 Key 算修改，预填本身不算。高级字段错误先展开再聚焦。已有模型、自定义配置与正在编辑草稿不被覆盖；读取失败不当作空目录。

**准备：** 主状态只放一组三点和当前等待对象，六项技术明细默认折叠；失败的原因与修复入口直接可见。只有真实准备、活跃前置任务或明确自动重试显示等待；failed/unknown/缺配置/需用户动作显示静态恢复。继续使用 `status.ready`、`preparation.ready` 及 docker、agent、packageHelper、defaultContext、fileHelper、snapshotHelper 六项 ready 的现有完成契约，不伪造百分比或将此契约扩大到工作台全局访问。

**D1：** 仅当前管理员在 Runtime 尚未配置的首设中直接 Save and continue 建立一个局部、一次性内存标记。沿现有 view/identity/readGeneration 和已确认 modelRef/agentImage 核对当前流程；保存已确认、当前有效回读无错且上述就绪条件满足时，消费标记并导航一次。保留手动 Open workbench；不等满1.2秒动效、不设倒计时。

已配置管理、初读已 Ready、背景更新和 save-leave 不建立标记。刷新/回退/重挂载、关闭/离开、身份变化、新编辑/改选目标及不确定保存使其失效；用户最新目的地优先，晚响应不导航。恢复仅读回持久准备和手动出口，不恢复自动标记。只在现有 Quick setup 内补这个判断，不新增路由状态框架、preparation.generation 或跨接口原子快照。

模型保存/Runtime 绑定分段确认、Test 独立于保存、unknown 先读回沿 ONBOARD-002 原规则。现有 adapter 已支持指定默认，仅合成测试核对 `/anthropic/v1/messages` 路径不重复、不改 adapter。

### M03 管理体验

Overview 由当前可确认状态给一个主动作：缺配置继续设置、准备中查看准备、Ready 打开工作台；失败或旧 Ready 未确认时给诊断/恢复。Quick setup 入口去重，保留三个顶层工作区、完整管理与旧深链接。

Runtime 按当前模型安全摘要、影响范围、Edit、状态/诊断组织，去掉已完成安装的部署轨道；镜像细节按需只读披露，Key 不回显，默认仅影响后续新 Work。Default Work 的 Skills/Packages/AGENTS 等能力保留；不误改当前已正确的托管页脚 “Closing this page keeps Core and Works running”。

Console 在当前路由复用/协调页级读状态，同对象显式刷新与后台回读去重；首读无数据用稳定外壳，同页刷新不换整页 skeleton。原位更新所属状态，保留正文、草稿、焦点/选区、展开和滚动。保存事实与关联读取结果分开；读失败保留最后确认和时间。身份切换仍执行安全清理。Desktop 继续既有 reconcileHTML、Files 刷新槽、Chat 锚点和 iframe 保留，不把独立模块强制串行。

### M04 共享 Pending

在现有 shared controls 定义固定槽三点：仅 opacity，三点依次淡入淡出、1.2秒周期，无位移/缩放/旋转；两端用薄渲染包装，不引入新库。组件只表达现有 busy 状态，不发请求、重试、取消或判定业务成功。Modal 开合无动画；reduced-motion 使用静态三点/文字，装饰点不重复播报。

| 当前真实状态 | 统一表现 |
| --- | --- |
| 用户请求在途 | 原按钮、对象标题或固定槽三点；沿现有锁限制重复提交 |
| 已接受任务正在执行/明确自动重试 | 原任务一处主要三点与阶段/ID，区分 Accepted 和完成 |
| 首读/显式回读 | 无数据用稳定框架；有正文保留，在原读取槽显示 |
| 背景静默轮询 | 原位更新，不每卡/每轮闪动；真实长任务可保留主要等待 |
| 成功、失败、确认取消、暂停、unknown、需用户动作 | 停止相关动画，显示真实结果/恢复；不由动画控制解锁或重发 |
| 超过10秒仍等待 | 原槽说明仍等什么/已等待时间及可用恢复；实际错误后停止，不伪造超时 |

保留真实字节进度；浏览器下载交接不能声称落盘。Core 连接补必要的可见在途/结束状态，沿现有目标去重，不扩成启动 Core 或持续探测。图片、响应设置自动保存、Activity、偏好、About 等不走通用动作的分支也接入；Service 内部网页和浏览器自有加载 UI 不在本变更控制范围。

## Existing Contracts and Verification

安全/业务不变量统一引用 ONBOARD-001/002/005、UIL-008/009、SUI-003/004/005/006、DWUI-011/012/013/014 及对应现有测试：proof/CSRF、密码/Key 清理、重复提交、对象归属、unknown 不自动重放、接受与完成分离、晚响应不覆新视图/解新锁保持。delta 为符合 OpenSpec 格式保留完整 MODIFIED Requirement；其中原约束不是重写系统或重新全量验收的任务。

| 模块 | 主要文件 | 增量验证 |
| --- | --- | --- |
| M01 | Console onboarding及现有前端测试 | 授权、创建与手动登录的字段/Pending/清理及离开晚响应回归；后端契约不变 |
| M02 | Console quick-setup/model-form及相关测试 | 默认/dirty/高级校验、六项ready、局部单次导航与晚响应；分段保存原测试复用 |
| M03 | Console app/model-management及相关测试 | 主动作/维护结构、实际按钮归属、同页内容连续性、已有路由功能 |
| M04 | shared controls、两端静态壳/样式；Desktop app/adapter及独立分支 | 共用动效一次验证；31入口覆盖核对，独立状态生命周期补测 |

动画、固定占位、快速完成、reduced-motion、无动画 Modal 等共用行为集中测一次；31位置逐项标接入位置和复用测试，只有独立状态/逻辑才补针对性测试，不为每个入口复制全部成功/失败/刷新/晚响应笛卡尔积。受影响安全和竞态测试仍必须通过，不以精简为由删防重/晚响应保护。

两端按现有 typecheck/build/browser 和静态资源同步入口验证；跨模块以一条合成首设到工作台及代表管理回路验收，并取宽/窄屏截图与一份三点录屏。若已有隔离 Core/Docker 条件和相应授权，再跑相关真实集成；否则明确“未测及原因”，不为本变更建设新环境，不使用真实 Key 或付费调用。

## Risks / Trade-offs

- 自动进入抢走新任务：复用现有代次、局部一次标记，save-leave 和新目的地优先。
- 默认误 dirty 或覆盖模型：区分首次草稿基线/已存值，保留高级编辑与目录错误。
- 三点漏独立分支或无限等待：31位置不删减，状态所有者决定开始/结束，静态 unknown 不旋转。
- 保留内容误显当前 Ready：标明最后确认及读取错误，完成出口只用当前有效完整状态。
- 视觉调整误触认证边界：只改已有页面及局部反馈，proof/CSRF/正常登录路径和启动交付不变。

## Migration Plan

无数据迁移。已收到 apply 与 PR 授权，实施基线已核远端 main 为 efce08c；本轮仅UI与前端交互。实施先做共享 Pending，再按首设界面、QuickStart、管理和其余入口接入，复用已有测试与资源嵌入；同一 app.ts 避免多人并改。按四模块可独立回退代码/资源，不清理用户配置或 Work。

创建后自动认证、Go启动入口D2、HTTP前启动壳和持续离线观察均不在本轮。所有者已授权提交、推送和PR；完成独立审查后按功能拆分提交并开草稿PR，核对远端与CI，不自动合并或部署。
