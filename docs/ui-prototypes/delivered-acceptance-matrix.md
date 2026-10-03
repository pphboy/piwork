# PiWork 原型验收与覆盖矩阵

## 阅读方式与证据边界

原始输入：`inputs/desktop-webui-brief.zh-CN(1).md` 与 `inputs/serve-ui-brief.zh-CN(1).md`。Serve 最新用户批准的 IA/UX 补充为 `docs/SERVE-TASK-REDESIGN.md`；它明确取代旧 brief 的七项平级主导航，保留原功能、深链接与业务/安全契约。本文保留 D-F01–D-F18、D01–D36、S-F01–S-F17、S01–S24 共 **95 个唯一编号**。原 brief 的 Dxx/Sxx 按区间描述；下面逐号拆开是评审定位，不增加路由或功能。

**不能把有编号、入口或截图当作通过。** 清单中的验收条件来自原输入及最新 UI 设计补充；原型实现证据、浏览器检查和真实 Go 集成是不同层级。所有真实 API、授权、持久状态、`.work` 格式与安全检查均须在目标仓库另行验证。本包不包含目标 Go/OpenSpec，业务/API/安全边界仍以目标仓库为准；最新导航/语言设计与仓库 UI 规范有差异时，Codex 须依仓库流程记录 UI-only change/delta，不能静默偏离规范，也不为此新增后端能力。设计补充不是第二份后端规范。

当前行级符号：`□` 表示必须逐项核对，并非通过；`逐态未签收` 表示源码已可定位，但尚未将该编号的所有正常与异常变体逐一签收。随包实际自动化/浏览器验证记录可证明其中子集，不会自动覆盖整行。原型控件名采用英文；文档中文。

## 源码与证据定位

- Desktop：`apps/desktop-webui/src/main.ts`（页面、弹层、交互）、`src/adapter.ts`（内存动作与恢复）、`src/fixtures.ts`（数据与场景）。模块级评审路径以 `docs/desktop-coverage.md`为补充
- Serve：`apps/console-webui/src/app.ts`（路由、页面、弹层、轮询）、`src/components.ts`（转义与共享控件）、`src/adapter.ts`（内存动作和文件预检）。完整模块路径见 `docs/serve-coverage.md`
- 可重复检查：`tests/adapter-contracts.test.mjs`、`tests/delivery.test.mjs`、`tests/browser.mjs`；执行方式与未证明范围见 `docs/QA-PLAN.md`
- 实际结果只取最终验证报告；早期测试失败、修复后局部通过与最终全套结果不可互相替代。静态代码评审不等于浏览器实测
- 真实后端、异步 transport 和稳定 iframe 生命周期尚须接入，具体限制见 `docs/CODEX-INTEGRATION.md`

## Desktop 功能清单

| 检查 | 编号 | 模块 | 验收入口/返回定位 | 正常与关键语义 | 失败/未知/恢复要求 | 画面 |
| --- | --- | --- | --- | --- | --- | --- |
| □ | D-F01 | 连接与身份 | Works → account / Core / Sign in | 可达、运行 ready、局部能力分开；登录/退出/切换；过期和启动票据恢复 | Core 不可达不当密码错；CLI 关闭须重新打开新启动地址；退出远端撤销未知 | D01–D04 |
| □ | D-F02 | 自己的 Works | Works → Search / 行 Open / More → information | 固定列对齐；加载/空/失败；状态快捷动作；复制完整 ID/网络身份 | 失败不能当空；未知状态有最后确认时间；Back 不停止 | D01,D04,D05,D08 |
| □ | D-F03 | New Work | Works → New Work → Advanced | 名称默认必填；image/Skills/Packages/AGENTS/JSON；defaults/choose/none；合并摘要 | 字段错误保留草稿；接受后沿原 Work/Operation；启动失败不重复创建 | D06,D07 |
| □ | D-F04 | 生命周期 | Work header / More → Start, Stop, Retry, Delete | desired 与 observed；Stop 写 Run/全部 Service/文件影响；Delete 默认保留数据、无 UI 撤销 | starting/stopping 查原 Operation；stop failed 不把目标改 running | D05,D07,D08,D11 |
| □ | D-F05 | Session | Chat → Session picker / New session | 按实际首消息摘要或时间/ID命名；列表/读取/切换；切换不取消 Run | 没有 Session 能新建；旧上下文提示 New session，不迁移 | D10,D13 |
| □ | D-F06 | Run | Composer → Send / Cancel run / Run details | 流式文本/折叠工具；accepted/running/cancelling/全部终态；一个 Work 一个活跃 Run | busy 留草稿；IME/空白防发送；断线按原 Run/游标恢复；不重发 | D14,D15,D16 |
| □ | D-F07 | Service 访问 | Services → service / port / More / Focus chat | 原应用视口；域名与本机链接分开；独立窗口；同一 Session 不复制 composer | CSP 拒绝开原应用；不代理浏览器；选择仅传身份，非页面数据 | D09,D12,D17,D18,D19 |
| □ | D-F08 | Service 管理 | Services → Manage services → detail / logs | 全部 enabled/disabled/failed/no-web；Start/Stop/Restart/Retry/Remove；有界日志和取得时间 | Stop 持久禁用；Start 不启动 Work；Remove 不删共享文件；原 Operation 恢复 | D20 |
| □ | D-F09 | Files 读取 | Files → breadcrumb / folder / row | 仅当前 Work workspace；元数据/打开/下载/刷新；目录导航 | 空/失败/特殊项/停止/能力缺失分开；不显示 Core 路径 | D21,D24 |
| □ | D-F10 | Files 写入 | Files → Upload / New folder / selection menu / editor | 逐文件结果；同 Work 重命名/移动/复制/删除；Save/Discard；覆盖与递归确认 | 207逐路径；未知先重读；1 MiB UTF-8；根保护；脏稿 Save/Discard/Keep editing | D22,D23,D24 |
| □ | D-F11 | WebDAV 辅助 | Files → Connect with WebDAV | 独立 proxy；完整 Work ID /works/<workId>/files/；实际用户名/端口；终端取临时密码 | Files 不需先做此步骤；无系统挂载/文件锁承诺 | D24 |
| □ | D-F12 | Work Skills | Settings → Skills → Save changes | Core 目录真实详情；Work 选择和 active/runtime；clear；沿用或重新选 Core 副本 | 目录不可用不抹掉已保存选择；loaded/modelVisible 不混为一谈 | D25,D28 |
| □ | D-F13 | Work Pi Packages | Settings → Pi Packages → details / install / update | Core/npm/Git/local/ZIP 五来源；安装/更新/enable/disable/remove/保存；desired/active/pending/loaded | 显式更新来源；上传、接受、安装、加载分开；目录权限/链接限制 | D26,D28 |
| □ | D-F14 | AGENTS / Advanced | Settings → AGENTS.md / Advanced | current/pending；文件导入/编辑/保存/放弃；完整公开 JSON 与 image/modelRef/MCP/resource/tool 字段 | 无平台 secret；格式错误/导入失败保留原稿；离开处理脏稿 | D27 |
| □ | D-F15 | Apply changes | Settings → Save changes → Apply → status | Save 只 desired；Apply 独立 Operation；In use/Saved/Not applied/Loaded/Visible 分开 | busy 不取消 Run；失败/回退失败/被取代/未知；后续草稿仍 pending；stopped 保持 | D28 |
| □ | D-F16 | Inspect / Import | Works or Sign in → Import Work → local Inspect → Import | 无登录可完整本地检查/安全摘要并退出；登录后上传；可选名称；完成 stopped；Open/Start 分开 | 无效包/冲突贴字段；原 Import Operation；不得自动运行包代码 | D29,D30,D31,D32 |
| □ | D-F17 | Export / Download | Work More → Export → explicit Stop → Prepare → Download | 先确认完全 stopped；用户再 Prepare；真实验证后下载；Operation/snapshot ID | 锁/空间/过期/中断查原 snapshot；Download started 不声称落盘 | D33,D34,D35,D36 |
| □ | D-F18 | 操作恢复 | Works / More → Known operations / Find by ID / snapshot | Work/Service/Apply/Package/Import/Export；按需本地记录，Core/用户隔离且可清除 | 不变成全局服务端历史；无内容/密钥；未知先核对；关闭仅停止观察 | D08,D16,D20,D28,D31,D36 |

## Serve 新 IA 与验收证据范围

三个主要工作区是 Overview（`/`）、User access（`/users`）、Work setup（`/default-work`）。Runtime（`/runtime`）属于 Overview 的 Core 就绪任务；Skills / Packages（含原详情 URL）属于 Work setup 的次级库视图。Find operation（`/operations`）为低强调恢复工具，保留 `/operations/:id` 和 `/login`。

下表的 Status、Users、Runtime、Default Work、Skills、Packages、Operation 是能力/对象名称，不再要求七项平级主导航。所有 95 个原编号不增删；新增任务编排验收复用相关 S-F/S 编号：

- S-F02/S-F05/S-F06：Get Core ready 由公开读取/保存结果推进；saved 与 ready 分开，未知先 readback；创建用户或安装能力不是就绪必经步骤
- S-F03/S-F04：Give someone access → Create account → Account ready → 返回账号；不虚构邀请、密码交付或实际登录
- S-F07/S-F08/S-F09：Shape new Work 阅读摘要与局部编辑，共享一个安全草稿、可选 Review changes、一次 partial Save defaults；仍只影响未来 Work
- S-F10–S-F16：添加能力后返回原默认选择区并保留安全草稿；目录可用不等于选为默认；原子默认引用变化须读回复核。引用修复保存后返回原对象，危险动作由用户重新确认
- S-F15/S-F17：Overview 仅续接本标签页明确已知的一个活跃 Operation，按原 ID/意图恢复；无全局历史、未知 ID 发现或刷新后的虚假草稿恢复
- 所有 Serve 回路：返回上下文、Stay/保留安全草稿/Discard、会话清理和深链接刷新按最新设计补充核对；新版完成证据以更新后的实际 QA 结果为准，旧导航截图和测试不会自动签收这些回路

## Serve 功能清单

| 检查 | 编号 | 模块 | 验收入口/返回定位 | 正常与关键语义 | 失败/未知/恢复要求 | 画面 |
| --- | --- | --- | --- | --- | --- | --- |
| □ | S-F01 | 登录/会话 | /login → Sign in / Sign out | 管理员认证；普通用户拒绝并指向 Desktop；bootstrap 用 CLI/env；限流/过期/撤销 | 认证错误统一；Core 断网独立；登出失败可重试；清密码/文件引用 | S01,S02,S03 |
| □ | S-F02 | Core status（Overview） | Overview / → Refresh / Get Core ready | 当前管理员；reachable/health/readiness/checks/取得时间；可见约15秒刷新/焦点会话检查 | 不可达旧值标时间；未配置/不可用/recovering 分开；无假统计 | S04,S05,S06 |
| □ | S-F03 | User access：创建账号 | /users → Give someone access → Create account → Account ready | account/password/confirmation/role，默认 User；全部账号与 ID/时间；成功清密码 | 账号1–128规则、密码12–1024；重复不覆盖；角色不同给不同使用说明 | S07 |
| □ | S-F04 | User access：访问控制 | /users → Manage access → Enable / Disable / Reset | 确认目标和全部会话撤销；Enable不恢复旧会话；自身失效返回登录 | 最后 enabled admin 保护；不存在/并发变化先刷新；不提前改行 | S08,S09 |
| □ | S-F05 | Get Core ready：Runtime 查看 | Overview → /runtime → Current configuration / Edit runtime | image/provider/model/Base URL/credential可用性/更新时间；空配置与已配置 | 不返回/回填 Key；非敏感字段可预填 | S10 |
| □ | S-F06 | Get Core ready：保存与确认 | /runtime → Edit runtime → Save runtime → Check readiness | 每次输入完整 Key；空 Base URL用默认；成功回填公开字段并清 Key；仅未来 Work | 字段错误/保存失败/保存但not-ready/未知readback；不缓存 Key | S11,S12 |
| □ | S-F07 | Work setup：Shape new Work | /default-work → 阅读摘要 / section Edit / 可选 Review / Save defaults | image/Skills/Packages/AGENTS可编辑，其他公开字段只读；只发改动字段；无改动禁用 | 无配置指 Runtime；保留并发无关字段；无 Work Apply；未知先读回 | S13 |
| □ | S-F08 | 默认能力 | Work setup → Shape new Work → Capabilities → Skills / Packages | enabled 多选；Skill 上下移动；明确 None；无效引用保留原因；Packages≤64 | 选择不安装/启用/删除 catalog；长名不遮排序；明确失效选择 | S14 |
| □ | S-F09 | 默认 AGENTS | Work setup → Shape new Work → Instructions → Import / Edit | UTF-8最大256 KiB；字节计数；import只填草稿；空文本清空 | 替换脏稿确认；取消/解码失败/超限保留旧稿；离开未保存处理 | S15 |
| □ | S-F10 | Skill library 查看 | Work setup → Skills /skills → /skills/:name | 全部条目按名排序；状态/default/公开 source/时间/文件元数据；Refresh | 空/加载/读取失败/对象消失；不假造 description 或 Work loaded | S16 |
| □ | S-F11 | Skill library 上传 | Work setup → Skills → Add Skill / Update directory → 返回来路 | 浏览器完整目录；basename合法身份/根SKILL.md/更新同名；摘要→上传→校验→确认 | 2048文件/8MiB单文件/32MiB总量；无目录支持禁用；未知查询，不自动Add变Update | S17 |
| □ | S-F12 | Skill library 控制 | Work setup → Skill detail → Enable / Disable / Remove | 移除写名称与未来可选能力影响；已有Work副本保持 | default引用保护到Default Work；不自动移出默认；失败保持状态 | S18 |
| □ | S-F13 | Package library 查看 | Work setup → Packages /packages → /packages/:name | Core全部包；version或未声明；sourceKind/enabled/isDefault/counts/resolvedSource | 不展示Work loaded/pendingApply；无元数据不猜；消失可回/刷 | S19 |
| □ | S-F14 | Package library 安装/更新 | Work setup → Packages → Install / Package detail → Update | npm/Git/local/ZIP；manifest.name身份；默认不加default；选中须原子成功；update不可变目标/显式来源 | 切来源舍弃文件确认；manifest不符/上传异常；Core完整ZIP验证；不接受.work | S20,S21 |
| □ | S-F15 | Package Operation | Install/Update → accepted → /operations/:id；按来路返回任务 | 真实上传百分比；其他阶段文字；稳定幂等意图；同source/key Resume submission | 收到ID沿用；观察中断恢复；失败后显式新意图；无取消包任务 | S22,S23 |
| □ | S-F16 | Package library 控制 | Work setup → Package detail → Enable / Disable / Remove | 同步确认不造Operation；已有Work副本保持；危险确认具体影响 | default引用保护；busy保持状态查原任务；不自动改默认 | S18,S19,S21 |
| □ | S-F17 | Utility: Find operation | 低强调工具 /operations → 已知 ID → /operations/:id | 任意有效admin查已知Core package ID；phase/time/result/安全诊断；串行约2秒，终态停 | 不存在与Work-scope同样不可用；无历史/自动猜ID/原始脚本日志；中断保留时间/ID | S22,S23,S24 |

## Desktop 画面/状态逐号索引

| 检查 | 编号 | 画面/状态 | 建议可重现路径与验收点 | 状态 |
| --- | --- | --- | --- | --- |
| □ | D01 | 有效登录 Works | Works：身份、连接、搜索及账号入口 | 见模块路径；逐态未签收 |
| □ | D02 | Sign in / Core 选择 | Sign out / account / Core：登录与切换，保留非敏感输入 | 见模块路径；逐态未签收 |
| □ | D03 | Core 不可达 / 认证过期 | Scenario switcher → connection/session；Check connection/Sign in | 见模块路径；逐态未签收 |
| □ | D04 | Works 空态 | Scenario switcher → empty Works；New Work/Import Work | 见模块路径；逐态未签收 |
| □ | D05 | 混合 Work 状态 | Works：Ready、Stopped、desired=running失败、Degraded和长中文名称 | 见模块路径；逐态未签收 |
| □ | D06 | New Work 简单 / Advanced | New Work：默认继承与明确覆盖/None，合并摘要 | 见模块路径；逐态未签收 |
| □ | D07 | 创建 accepted / preparing / failed | 提交 New Work → 原 Work/Operation；Retry 不重新创建 | 见模块路径；逐态未签收 |
| □ | D08 | 信息 / 生命周期 / Operation | Work More：完整身份、Stop/Delete确认、Operation详情及返回 | 见模块路径；逐态未签收 |
| □ | D09 | Service + Agent 协作 | Open ready Notes：应用66–72%，Agent28–34%；单composer | 见模块路径；逐态未签收 |
| □ | D10 | 无 Service Chat 主区 | Open no-service Work：可读空态与有效 New session | 见模块路径；逐态未签收 |
| □ | D11 | Stopped / Degraded | Counter stopped不可读files/应用；Degraded仅局部失败 | 见模块路径；逐态未签收 |
| □ | D12 | Focus chat 与返回 | Focus chat → 同Session；返回恢复Service/端口 | 见模块路径；逐态未签收 |
| □ | D13 | Session 选择 / 新建 | Chat picker：真实摘要/时间ID；无会话/旧上下文处理 | 见模块路径；逐态未签收 |
| □ | D14 | Run 流式 / 工具折叠 | Send：文本和工具状态，长工具结果局部展开 | 见模块路径；逐态未签收 |
| □ | D15 | Run busy / cancelling / 失败 / 恢复 | Scenario switcher + activeRun：草稿、取消、原游标恢复 | 见模块路径；逐态未签收 |
| □ | D16 | Run 详情 | Run status/details：原ID/状态/安全事件和返回 | 见模块路径；逐态未签收 |
| □ | D17 | Service / 端口 / 复制 | Service toolbar：声明端口、Copy domain/Copy local link | 见模块路径；逐态未签收 |
| □ | D18 | 独立应用窗口 | Open in new tab：Work身份/Back to Work；关闭不停止 | 见模块路径；逐态未签收 |
| □ | D19 | 拒绝嵌入 / 不可用 | Scenario blocked/stopped：保留身份、Open application tab | 见模块路径；逐态未签收 |
| □ | D20 | Service 管理 / 日志 | Manage services：所有类型、详情、控制、日志快照/时间/截断 | 见模块路径；逐态未签收 |
| □ | D21 | Files 浏览 / 空目录 | Files：breadcrumb/list；真实元数据与空/失败分开 | 见模块路径；逐态未签收 |
| □ | D22 | 文本编辑 / 脏稿 | 文本 → edit；Save file/Discard/Keep editing；失败保留 | 见模块路径；逐态未签收 |
| □ | D23 | 上传 / 目录 / 移动复制 / 覆盖删除 | Files工具栏与选中项菜单：目标明确、逐文件结果、递归确认 | 见模块路径；逐态未签收 |
| □ | D24 | 部分失败 / 特殊文件 / WebDAV | Scenario/files：207、特殊/二进制/大文本、proxy辅助说明 | 见模块路径；逐态未签收 |
| □ | D25 | Work Skills | Settings Skills：目录、选择/clear、现有副本与Core重新选择 | 见模块路径；逐态未签收 |
| □ | D26 | Work Pi Packages | Settings packages：列表/详情；Core/npm/Git/local/ZIP；显式update来源 | 见模块路径；逐态未签收 |
| □ | D27 | AGENTS.md / Advanced | Settings：导入/编辑/保存/放弃；完整公开JSON与字段校验 | 见模块路径；逐态未签收 |
| □ | D28 | Save / Apply / 失败 | Settings：desired、active、loaded、visible；Operation各阶段/回退失败 | 见模块路径；逐态未签收 |
| □ | D29 | 无登录本地 Inspect | Sign in/Import Work：选择.work、安全摘要、可直接退出 | 见模块路径；逐态未签收 |
| □ | D30 | Import 名称 / 冲突 | Inspect后：可选名称，登录后上传，字段冲突保留 | 见模块路径；逐态未签收 |
| □ | D31 | Import Operation | Accepted → 原Operation；断线/未知查询，不重复导入 | 见模块路径；逐态未签收 |
| □ | D32 | Import 完成 stopped | 成功：Open Work和Start Work两个动作；默认不运行 | 见模块路径；逐态未签收 |
| □ | D33 | 运行中 Export 准入 | Export：必须先Stop，用户明确确认影响 | 见模块路径；逐态未签收 |
| □ | D34 | Stopped Prepare package | Stop终态后用户再次Prepare；不自动触发 | 见模块路径；逐态未签收 |
| □ | D35 | 导出 / 校验 / 下载 | 原Operation与snapshot：准备/验证/Download started分开 | 见模块路径；逐态未签收 |
| □ | D36 | Operation / snapshot 恢复 | 按原ID找回、下载重试、过期/锁/空间不足说明 | 见模块路径；逐态未签收 |

## Serve 画面/状态逐号索引

| 检查 | 编号 | 画面/状态 | 建议可重现路径与验收点 | 状态 |
| --- | --- | --- | --- | --- |
| □ | S01 | 正常 Sign in | /login：account/password，管理员登录 | 见模块路径；逐态未签收 |
| □ | S02 | 普通用户 / bootstrap / 限流 | Scenario switcher：权限拒绝、CLI/env初始化、真实等待含义 | 见模块路径；逐态未签收 |
| □ | S03 | 不可达 / session expired | Scenario switcher：Core断网不当凭据错；清凭据返回登录 | 见模块路径；逐态未签收 |
| □ | S04 | Overview Ready | /：紧凑状态、reachable/health/readiness/取得时间；真实下一步或任务选择 | 见模块路径；逐态未签收 |
| □ | S05 | Get Core ready：缺 runtime / 不可用 / recovering | Overview → Get Core ready：独立原因与/runtime；其他管理能力仍可用 | 见模块路径；逐态未签收 |
| □ | S06 | Overview 旧状态 / 刷新失败 | Scenario：保留最后值/时间，Recheck Core；不造绿色Ready或任务完成 | 见模块路径；逐态未签收 |
| □ | S07 | User access 列表 / 创建任务 | /users：全账号/长名/role/status/time；Give someone access → Create account → Account ready | 见模块路径；逐态未签收 |
| □ | S08 | Manage access：Disable / Enable确认 | User access → Manage access：名字、全部会话撤销、Enable不恢复旧会话 | 见模块路径；逐态未签收 |
| □ | S09 | Manage access：Reset / last admin / self退出 | /users账号上下文 + Scenario：清密码、保护、自身失效跳login | 见模块路径；逐态未签收 |
| □ | S10 | Get Core ready：Runtime 当前 / 首次 | Overview → /runtime：已配置读摘要/按需Edit；缺失直接配置；无Key回填 | 见模块路径；逐态未签收 |
| □ | S11 | Runtime 编辑 / 校验 | Get Core ready → Edit runtime：全字段、重新输入Key、邻近错误 | 见模块路径；逐态未签收 |
| □ | S12 | saved-not-ready / 未知readback | Runtime任务：保存与ready分阶段；Check readiness / Read current runtime；确认后返回Overview | 见模块路径；逐态未签收 |
| □ | S13 | Shape new Work 当前 / 草稿 | Work setup /default-work：摘要→局部编辑，共享草稿/可选Review/partial Save；无改动禁用 | 见模块路径；逐态未签收 |
| □ | S14 | Capabilities 顺序 / 长名 / 失效 / 空集合 | Shape new Work → Capabilities：上下移动、None、失效保留；添加库能力后返回选择 | 见模块路径；逐态未签收 |
| □ | S15 | Instructions import / unsaved | Shape new Work → Instructions：文件→共享草稿；字节/错误/覆盖/安全离开返回 | 见模块路径；逐态未签收 |
| □ | S16 | Skill library 列表 / 详情 | Work setup → /skills及/skills/:name：enabled/disabled/default/元数据，次级位置正确 | 见模块路径；逐态未签收 |
| □ | S17 | Add/update Skill 子任务 | Work setup → Skills：目录摘要/限制→上传校验→Core confirmed→View Skill或返回原选择区 | 见模块路径；逐态未签收 |
| □ | S18 | 默认引用修复 / Remove确认 | 保留对象→Review default reference→明确移出并保存→返回原对象→再次确认动作 | 见模块路径；逐态未签收 |
| □ | S19 | Package library 列表 / 详情 | Work setup → /packages及/packages/:name：四来源、无version/default/disabled、安全source | 见模块路径；逐态未签收 |
| □ | S20 | Install Package 子任务 | Work setup → Install Package：互斥四来源、文件摘要、默认选项off→提交→观察 | 见模块路径；逐态未签收 |
| □ | S21 | Update / 名称不符 / 上传异常 | Package library详情Update：目标不可变/显式来源，无安装默认选项；保留任务来路 | 见模块路径；逐态未签收 |
| □ | S22 | Operation 进行中 / 终态 / 失败 | /operations/:id：safe阶段/时间/result、superseded、终态停；按安装或查询来路返回 | 见模块路径；逐态未签收 |
| □ | S23 | 观察中断 / Resume submission / Continue | 保留原ID或同source/key；Overview仅续接本标签页明确已知的一个任务，不列历史 | 见模块路径；逐态未签收 |
| □ | S24 | Find operation 工具：有效 / 无效 / Work scope拒绝 | 低强调入口/operations：仅已知ID查询；不存在和Work-scope同样不可用 | 见模块路径；逐态未签收 |

## 不可省略的跨端测试

1. 视觉：精确语义色、细分隔、小圆角、无装饰阴影；正文/辅助字号、可读宽度。Console 1100px 页面轨道、176+16+520px 表单列；Desktop Service/Chat比例与焦点模式
2. 尺寸：两个应用1440/1024/360px，Desktop另测768px；整页无横向溢出，仅表格/代码/JSON局部滚动；200%放大和长中文名/长域名/长来源不挡按钮
3. 键盘：英文accessible names、2px焦点、弹层focus trap/关闭还原、Escape、危险确认取消、Enter与Shift+Enter及IME
4. Serve任务层级：仅三个主要工作区；Runtime属于Core就绪，库属于Work setup，恢复工具低强调；原深链接/高亮/来路保留；任务进度由结果而非浏览动作推进
5. 重复与中断：双击提交、防重复、正在取消不能当idle、关闭Operation不取消任务、导航/浏览器Back/Forward、会话失效停轮询、恢复不重放mutation
6. 数据保留：脏编辑器/表单、取消文件选择、换来源丢弃确认、字段失败、未知结果读回；密码/Key/文件引用按安全语义清空
7. 安全：本包使用fixture不代表真实安全通过；Console cookie/CSRF/admin、Desktop ownership/ticket、Service origin/CSP、Files路径与真实上传限制均是集成阻断项

## 排除项检查

Desktop 不出现：Work重命名/终端、手工Service部署、全局Operation历史、公网分享、跨Work文件操作、目录ZIP下载、自动读取浏览器页面、用户管理或bootstrap/Docker/代理配置流程。

Serve 不出现：Work列表/对话/Service/workspace/WebDAV/`.work`，Core/Docker/证书管理，用户改名/角色编辑/删除/自助注册，包Operation取消/全局历史，审计/计费/模型测试聊天/无依据资源图表。

## 结果记录模板

每项在最终目标仓库记录：编号、代码路径/入口、fixture或真实数据、复现步骤、期望/实际、截图或测试路径、通过/失败/未运行、所用提交版本。未运行不是失败，但不得标为通过；生产接入未完成时保留为待办。

接入边界、Codex提示词和合并清单见 `CODEX-INTEGRATION.md`。
