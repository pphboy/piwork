# Tasks

已收到2026-10-20的apply与PR授权；最新边界为仅UI和前端交互，不改Core、Go启动、后端认证或运行逻辑。D1保留、D3手动，D2移出本轮，原1.2/1.3启动层任务撤销而不标作完成。初版发布后main更新至9a40d444（v0.0.8）；现维护同一PR，采用上游普通会话契约，受影响实现与完整可运行验证已重新完成。先做4.1共享表现；每项仅在实现及对应验证完成后勾选。

## 1. M01 首设界面

- [x] 1.1 统一普通入口、创建管理员、普通登录的组件/文案/局部Pending，保留创建后手动登录；验证：复用onboarding测试覆盖字段错误、密码确认、双击与离开晚响应，创建后密码清空、未自动发送登录请求，普通session/CSRF与正常认证沿用最新上游；不请求已删除设置/浏览器授权端点。

## 2. M02 QuickStart

- [x] 2.1 增加Quick setup专用首次空草稿默认与折叠高级字段，复用原model-form校验；验证：默认deepseek-flash、anthropic-messages、指定URL，已有/自定义模型和目录读取失败不被重置，高级错误展开定位。
- [x] 2.2 dirty按默认/已读基线比较，保持同页草稿、焦点与Key原安全生命周期；验证：初读不dirty、修改/改回基线正确、后台读取不覆盖编辑，身份离开仍清理秘密。
- [x] 2.3 准备页改为单一主等待、折叠六项明细和可见失败恢复；验证：复用准备fixture参数化检查六项任一非ready/缺失、读取失败、真实重试和全部ready；仅真实进行态显示三点，不改Core完成条件。
- [x] 2.4 在现有Quick setup代次上增加D1局部一次自动进入标记，保留手动出口；验证：直接首设保存且当前完整Ready只导航一次；管理/初读Ready/save-leave不建立标记，刷新/离开/新编辑/身份变化/未知保存及晚响应不抢导航，无新增框架。
- [x] 2.5 沿原分段保存/unknown读回和显式Test规则接入上述表单；验证：复用模型成功Runtime失败、未知不重发及Test过期测试，补默认序列化与合成adapter路径断言，保留/anthropic且仅一次/v1/messages，不用真实Key或付费调用。

## 3. M03 管理体验

- [x] 3.1 Overview按当前事实突出单一主动作并去重Quick setup，保留导航/深链接；验证：配置缺失/准备/失败/当前Ready/旧Ready未确认的代表fixture，三个顶层工作区与原工作台访问规则不变。
- [x] 3.2 Runtime改为当前配置、作用范围、Edit及维护诊断，保留模型管理和Default Work能力；验证：新旧安装与窄屏浏览器检查，无镜像输入或Key回显，默认只影响新Work，Skills/Packages/AGENTS仍可用。
- [x] 3.3 复用页级读取协调首次/同页刷新/背景回读，避免整页skeleton替换；验证：代表Runtime/模型/Default Work编辑场景保留正文、DOM、焦点/选区、草稿、展开和滚动，轮询不逐卡闪动，保存确认后读失败不抹掉成功。
- [x] 3.4 补齐S08-S14实际管理按钮/文件预检/Operation/列表/About的等待归属，沿原对象锁和恢复；验证：按位置表记录接入及复用测试，重点补模型Read current data和启停/删除/设默认独立分支，保留字节进度、危险确认及unknown/暂停的静态恢复。

## 4. M04 共享Pending与跨模块验证

- [x] 4.1 在shared controls与两端薄渲染包装统一三点和初始壳：1.2秒依次opacity、固定槽、快速结束、reduced-motion、Modal无开合动画；验证：共用组件/代表浏览器测试一次覆盖动效与共同表现，录帧核对无布局移动，无全局遮罩；复用原ActionState，不另建状态框架。
- [x] 4.2 接入D01-D02普通会话与Core初次/手动检查的可见在途/结束状态；验证：本地/托管代表延迟测试覆盖同目标去重、错误结束和晚响应，文案不声称Desktop启动Core，不新增持续探测。
- [x] 4.3 接入D03-D05 Works/生命周期、Service控制/入口/日志；验证：复用lifecycle/work-navigation测试检查原对象与Accepted反馈，iframe保留、同对象防重和独立对象可用，仅补未覆盖状态分支。
- [x] 4.4 接入D06-D09 Chat/Session/发送取消、模型自动保存、图片与Activity；验证：复用feedback/continuity测试，针对自动保存、图片和Activity独立状态补生命周期断言，保留原Run、草稿、流式文本、阅读锚点及晚响应保护。
- [x] 4.5 接入D10-D12 Files与Settings/Apply等待；验证：复用file-admission/file-results及配置测试，确认固定刷新槽、原版本/unknown锁、真实进度和已确认路径不重传，静态pendingApply不动画化。
- [x] 4.6 接入D13-D17导入导出、Operation/Snapshot、Pi请求、偏好/About独立状态；验证：复用export-flow/preferences等测试并补缺失生命周期，保留原ID、暂停/Hide/unknown语义及下载仅交接边界，31位置均有接入/测试映射，不复制31套完整矩阵。
- [x] 4.7 在最终代码执行两端既有typecheck/build/browser及现有UI嵌入资源验证，完成合成首设→手动登录→Key→准备→一次进入及代表管理回路；验证：记录真实命令结果，按现有copy-static/sync链核对嵌入资源，代表宽/窄屏截图和三点录屏无秘密并标明fixture。已有隔离Core/Docker条件且获执行授权才跑相关真实集成，否则明确未测和原因，不建设额外环境。
- [x] 4.8 汇总四模块差异、31位置覆盖、实际通过/失败/未测和回退范围；验证：`openspec validate improve-server-ui-core-flow --strict`、`node scripts/check-repository-docs.mjs`、`git diff --check`通过，必要证据归本change，临时文件dist；独立审查后按功能提交并推送草稿PR、核对远端及CI，不合并或部署。

初版（8b271841）本地验收：Desktop browser 335/335、unit 525/525；Console QuickStart 28/28、feedback/management 94/94。真实Core/认证/Docker集成与Go宿主构建未运行，条件限制见 [verification.md](verification.md)。4.8已完成发布与首次远端/CI核对；PR #3保持Draft，未合并。GitHub返回0个status及0个PR workflow run，仓库无`.github/workflows`；这是未提供CI结果，不是CI通过。不把未运行项记作通过。

v0.0.8适配最终验收：Console全部可运行浏览器138/138（QuickStart/首设/会话44 + feedback/management94）、Desktop全部可运行浏览器338/338、24个unit文件524/524，均0失败/跳过；两端typecheck/build、测试编译、43个嵌入资源hash、OpenSpec strict及边界检查通过。完整合成首设链路和未知Works数量呈现已补回归；独立审查完成。实现远端commit `058a96090f86fca1db956bdb9020a59b5358d28f`的tree与本地测试相同，PR #3仍为Draft，GitHub确认无合并冲突、未合并。该commit的status/workflow均空，不能视为CI通过；原生Go/Core/认证/Docker仍未测。

## 5. 同日页面收敛与重建验收

以下是远端3fe9f149基础上的重新实现，之前未发布工作区不可取得，旧通过数字不代表本轮验证。GitHub发布暂停；本组不要求或授权重新推送。

- [x] 5.1 Quick setup 模型页移除三个底部入口，保留准备/管理原能力；自动完整回读未知结果及目录失败，异常检查链接仅在未解决 unknown 出现。验证：正常/普通错误/目录失败无入口；未知模型零/唯一/多匹配与 Runtime 原目标匹配、不重发、不自动导航、Test锁、焦点/展开和读错误归属回归。
- [x] 5.2 Works 首次未确认显示静态列表骨架；初次失败只保留中间原因和重试，确认列表刷新失败仍可见。验证：初次检查/加载/空/错/成功、错误重试去重与终态、已载内容刷新、长错误纯文本、窄屏及 reduced-motion。
- [x] 5.3 复核并修正 Console 同页导航状态及 Overview 待完成文案。验证：账户与窄屏导航节点/焦点/ARIA、轮询和新视图关闭、缺配置及准备中事实一致；独立审查不改 Core。
- [x] 5.4 当前代码重新执行完整可运行浏览器和非浏览器测试、两端 typecheck/build、测试编译、嵌入资源同步/校验、边界与 OpenSpec strict。验证：记录实际命令、数字、失败修复和真实未测项，提供新宽/窄截图，不能复用历史图冒充新截图。
- [x] 5.5 按功能保存本地提交与可恢复 bundle，核对与main差异只涉及UI/测试/资源/OpenSpec。验证：bundle可读与HEAD、来源/截图fixture限制清楚；生成可持久保存的恢复附件交付，不对GitHub写入、合并或部署。

- [x] 5.6 修正 Starting export 展开 Details 的长操作链接/身份挤窄重叠。验证：根因对应最小布局修复，完整ID及操作入口保留，宽/360px截图与几何不重叠断言，导出相关回归及最终Desktop资源/完整可运行套件重新验证。

## 6. Session选择器样式收敛

- [x] 6.1 读取用户实际截图并在7f7221基线更新proposal/design/spec，确认仅Session选择器范围及现有顶部New session契约。
- [x] 6.2 调整局部间距/行密度/按钮层级/选中状态与长名称换行，保留原会话动作、Run及加载/错误恢复；补渲染和真实浏览器回归。
- [x] 6.3 同fixture生成宽/窄before/after截图，验证焦点、短视口、长标签及单次创建；执行相关完整测试/build/嵌入资源校验和独立Review/OpenSpec verify。
- [x] 6.4 按实现与验收分提交并验证本地恢复包，明确Library交付阻塞、不推送GitHub、不合并部署；记录精确补丁与来源以便恢复。

Session专项最终：24个unit文件533/533；六组浏览器345/345与导出呈现补充2/2，组合347/347且0失败/跳过；typecheck/build、43资源hash、OpenSpec strict及独立Review通过。完整范围和真实未测项见verification.md。本地实现a1bb406及恢复补丁已核验；Library附件和GitHub发布仍未完成，不将内部保管的补丁记录视为用户附件。

## 7. v0.0.9 main rebase

- [x] 7.1 备份并核对6b099bf，确认实际main目标；重放现有功能提交并协调UI冲突，保持上游Core/后端和全部已完成UI修正。
- [x] 7.2 保留Service前缀、登录returnTo、托管身份缓存清理及同源提示；补冲突区域回归，重建两端资源并执行完整可运行UI/非浏览器套件。
- [x] 7.3 独立Review、OpenSpec严格验证、祖先与源差异边界核对；保存精确可恢复补丁/bundle与实际验证记录，明确未测/未发布边界。
