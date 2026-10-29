# Design

## Context

动机见 [proposal.md](proposal.md)。当前可核对的实现事实如下：

- `apps/desktop-webui/src/app.ts` 的 `coreRecovering()` 只参与状态文案；`works()` 仍渲染列表及业务按钮，路由和动作处理没有统一 Core 恢复门禁。
- `adapter.ts` 在会话确认后同时读 Work、目录及已知操作；Core 自动恢复观察绑定 `recoveryListVisible`，离开列表就不再覆盖所有需要门禁的路由。`observation.ts` 已提供去重、四并发、单次十秒超时及取消。
- `workMenuTasks()` 直接遍历失败和未决关联任务，并为每条添加检查与详情；`workControl()`、`lifecycle.ts`、`workSync`、`terminalEvidence` 分别参与当前目标、对象准入及终态后的读回，不能以菜单隐藏替代这些协调过程。
- `internal/cli/user_desktop_records.go` 按 Core origin 与用户 ID 存储已知记录，已有 `Terminal` 和 `Hidden`，最多返回 500 条终态记录；`user_desktop_control.go` 在原 Operation GET 返回终态时写入 Terminal。`user_desktop_known.go` 的公开返回体没有该提示，`recoverOperations()` 将返回记录均重建为 unknown。托管工作台通过 `hosted_desktop.go` 复用同一记录实现。
- Core 已区分 `RECOVERING`、`READY`、`ADMIN_REQUIRED`、`RUNTIME_NOT_CONFIGURED` 和 `RUNTIME_UNAVAILABLE`；基础就绪与全部 helper 准备不同。自动恢复与用户 lifecycle Operation 是不同路径，截图不足以证明这些 Retry 的触发者。

现行 DWUI-012 禁止普通异步动作禁用整页；本变更明确增加当前 Core 未准入/恢复时的例外。现行“Desktop 准确呈现 Core 启动恢复状态”只要求工具栏提示；本变更用首次启动页和使用中的局部暂停替换该限定。UIL-PENDING-001 的 Core 圆环例外同步更新为确认原型，其他 Pending 和 Service 四格透明度规则保留。

## Goals / Non-Goals

**Goals:** 使用同一份身份有效的 readiness 判断页面与业务动作；将操作展示分类从生命周期协调中分离；在重载和恢复后保持历史可达及未知结果保护。真实失败来源与展示缺陷分别验证。

**Non-Goals:** 不引入全局操作中心、服务端全量操作发现、数据库迁移、Core readiness 新协议或跨设备历史保证；不把每个 Work/helper 都恢复成功作为解除 Core 门禁的条件；不改写历史 failed 为 succeeded，不取消已接受执行，不扩展 Console 或产品整体导航。

## Decisions

### 1. readiness 是门禁依据，路由与动作共同使用

在 adapter 中形成纯状态投影，至少区分 `checking`、`recovering`、`ready`、`unconfigured`、`failed`、`unreachable`、`unconfirmed` 和 `observation-paused`。输入来自当前身份的 session/status 与检查结果，不使用 Work 状态猜测 Core 状态。首读没有就绪证据时不开放业务；已展示工作区的普通读取失败继续适用原有局部未确认规则，只有明确恢复/失去准入才进入对应暂停状态。

```text
authenticated + checking
          |
          +--> recovering --> ready --> target route / fresh Work facts
          |         |
          |         +--> failed / unconfirmed / observation-paused
          |
          +--> unconfigured / unreachable / unconfirmed

ready workspace --> confirmed recovering --> preserve view + pause new actions
                                            |
                                            +--> ready --> same view + object admission
```

`app.ts` 的顶层路由渲染和业务动作派发共用该投影；adapter 中负责发起业务写入/新入口的边界再检查，防止已有弹层、键盘快捷键或直达链接绕开。保留 status、会话恢复、合法账号/语言/连接配置、必要诊断和返回；已明确授权的下载交付按原状态机处理，不在门禁切换时取消、重复或越权继续。服务端仍核验实际权限与业务准入，前端门禁不授予后端权限。

选择统一投影而非在每个按钮拼接 disabled，可以让图标、路由和动作使用同一状态，且避免旧按钮 DOM 仍可提交。单个 Work 的恢复和普通请求不构成全局门禁，Core ready 后立即恢复各对象自己的规则，包括合法 Stop 取代 Start。

### 2. Core 观察覆盖门禁和活动工作区，保持有界

将现有恢复观察从“列表可见”扩展为“当前已认证页面可见且需要确认恢复”；首次启动、直达 Work/Service 和使用中恢复共享一次去重观察。沿用单请求十秒上限、同资源在途去重和最多四个元数据读取；恢复期正常两秒间隔，最多 300 次且实际观察时间十分钟先到即暂停。页面隐藏停止派发并取消适用只读请求，返回重新确认；不为普通已就绪页面新增无条件高频全量轮询。

超时或读取失败转为静态未确认；失败状态不继续假装启动；预算耗尽说明观察暂停而非启动失败。手动检查重新开启本次只读预算。Core 状态确认与 Work/目录读取结果分开发布，列表或目录 GET 失败不能把已确认 readiness 改写成 Core 启动失败。新身份、新检查代次和较新结果使旧响应失效。

### 3. 初次启动替换正文；使用中恢复保留正文

首次未准入时显示 [原型](prototype/index.html?scene=starting) 的等待页，Work 列表、搜索、新建、导入和菜单不出现，账号入口保持可用。readiness 确认后恢复原 route，随后对象首读仍可显示其真实骨架/失败，不先闪出旧列表。

使用中的 Chat/Files/Settings 保留原内容与草稿，用固定恢复区解释暂停；Service iframe 在既有可保留规则允许时保持节点和会话，限制新的用户业务交互，轮询不反复重挂。Stop、Delete、身份失效或后端能力撤销仍执行原撤销规则，不能为了保留画面绕过。恢复后重新核对所需对象/能力再开放交互；禁止通过重载整页恢复，从而避免丢失草稿或重发提交。

中央启动图标使用四个小方块按 2×2 位置依次移位接力，外框与文字固定，不做整体旋转。已确认的原型下方小圆环仅为次级指示。仅在真实恢复观察时播放，减少动态效果时全部静态；观察中断或终态立即停止。相关双语、焦点及窄屏行为与现有组件规范一致。四格移位只适用于 Core 的本次例外，不改 Service 首次占位动效。

### 4. 当前任务、已结束历史和协调依据分别建模

新增可复用的任务展示投影，输入包括已核实 Operation、任务身份、当前 Work 快照与目标、当前接受意图、记录保存状态、Work/列表同步和未知提交保护。输出供菜单、当前任务页和 Work 操作记录共同使用，而不修改协调状态本身。

| 类别 | 处理方式 |
| --- | --- |
| 执行中、结果未知、归属未核实或待同步 | 当前任务保留原 ID/对象及检查；多个任务均可达，不凭时间挑一个当作当前目标 |
| 当前 Work/目标仍有对应失败 | 显示一个对象级问题摘要和“查看当前任务”；无法证明哪个旧失败属于当前问题时说明待核实，不能任选最近记录 |
| 已终结且目标、对象及必要读回已收敛，无匹配待处理义务 | 只留在历史，结果仍为原始 succeeded/failed/superseded |
| 原操作 404/410、旧记录无法核验 | 原记录表达不可核实；不能成为 Work 失败或无限观察理由，适用的当前未知保护继续保留 |

菜单只放命令，提供“查看当前任务”（存在时）和“操作记录”，保留 Work 信息、设置、导出、原快照找回及适用生命周期动作。操作记录是所属 Work 的现有详情流程扩展，提供全部/当前/已结束筛选；历史详情以原结果、安全原因及 ID 为主，不常驻 Check progress/Retry。用户确需重查时仍可读取原 ID；当前对象需同步时单独提供对象检查。

不使用“过滤所有 failed”方案，因为明确失败仍可能代表当前需要处理的问题；也不使用自动 DELETE known-operations，因为它会破坏刷新后的历史入口，并可能丢失待同步依据。现有显式清除/隐藏行为仍保留 `terminalEvidence` 与同步代次保护。

### 5. 兼容地恢复已知终态，不让缓存替代真实准入

利用现有记录文件与身份键，在 `known-operations` 返回体中增加可选 `terminal` 提示；为新核实记录兼容地保留及返回安全枚举 `terminalState` 与最后核实时间。字段只保存操作状态及身份，不持久化原因正文、凭证或 Work 内容。旧记录只有 Terminal 或无新字段时仍可读，旧客户端忽略附加字段；不增加数据库表或全局索引。

终态事实在当前身份下的 Operation GET 成功且 ID、类型、Work/适用 Service 与记录匹配后记录。恢复模型分别保存“已知终态提示”和“本轮是否重新核实”，不把提示直接伪造成本轮新 Operation 响应。历史候选可在操作记录显示“上次已结束，详情待核实”，按需、有界核实；当前 Work 有问题、当前意图、未知保护、保存失败或同步义务时优先核对，不能直接移入已解决历史或放开动作。只有原 Terminal 提示而无结果的旧记录，使用终态未知表达并读原 ID，不能猜 succeeded。

新鲜 Work/列表与控制目标、已知原任务身份及当前待处理义务共同决定展示；任何本地提示、Work Ready 或历史成功都不单独授予业务能力。保留现有终态最多 500 条、用户主动隐藏与身份隔离语义，不承诺恢复此前已隐藏/已超出保留范围的未知历史。原型的五条失败为展示样例，不假造生产记录。

### 6. 以原任务和请求计数核实重复 Retry 来源

实现时首先在隔离安装中重现“重启恢复 + 多条已知 Retry”流程，记录操作 ID、类型、相对顺序、控制版本、安全原因和初始化/恢复期间的 POST 次数。若能取得用户当前安装的只读诊断，再按同一方法核实来源；不得读取或输出真实密钥，不修改用户数据来消除提示。

已确认的显示缺陷直接修复。浏览器初始化、网络恢复、多窗口观察及详情查看应只发 GET；发现本流程的重复提交时修复相应客户端入口并加请求计数断言。Core `work_recovery.go` 的恢复只在证实生成了不应有的用户 Retry 或违反既有控制栅栏时做对应修复，保留原自动重试预算与控制语义。不能仅凭 UI 中多条历史就改写自动恢复调度。

若现场记录不可获取，必须明确现场各条失败的触发原因尚未核实；仍完成可复现流程、代码来源核对和合成多历史回归，不将这一限制写成已经修复真实启动失败的证据。发现需改变其他业务契约的独立根因时单独说明范围，不无界扩大本变更。

### 7. 受影响模块与验证入口

| 模块 | 职责 |
| --- | --- |
| `apps/desktop-webui/src/adapter.ts`、`observation.ts`、`models.ts` | readiness 投影、跨路由恢复观察、兼容记录元数据与身份/代次栅栏 |
| `apps/desktop-webui/src/lifecycle.ts` 及相关任务投影 | 当前任务/历史判定，保持对象准入和未知保护独立 |
| `apps/desktop-webui/src/app.ts`、`public/style.css`、i18n | 首次门禁、使用中暂停、命令菜单、原任务/历史详情、双语与动效 |
| `internal/cli/user_desktop_known.go`、`user_desktop_records.go`、`user_desktop_control.go` | 兼容终态提示、匹配核验和原子私有存储；托管与独立模式共同验证 |
| `apps/desktop-webui/test/feedback.test.ts`、`pending-adapter.test.ts`、`recovery.test.ts`、`compact-work-controls.test.ts` 及相关测试 | 首读、路由/动作门禁、来源请求计数、历史收敛、旧响应、草稿与 iframe 连续性 |
| `internal/coreapp/work_status_restart_integration_test.go` 及已有真实 Core 测试 | 慢启动、基础就绪后单 Work 恢复、真实 Docker 重启与多历史验证 |
| `internal/desktopassets/static/` | 通过既有构建同步嵌入资源，保证新页面随宿主交付 |

## Risks / Trade-offs

- [旧展示依赖工具栏及随时可点菜单] → 只在明确 Core 未准入时使用门禁，更新原测试以验证行为，不删除安全断言；正常列表布局保持确认原型。
- [大量历史核实拖慢首屏] → 复用终态提示、按需历史详情与既有有界读取；基础 ready 不等待所有历史读完，当前问题优先，单个慢任务不阻塞其他 Work。
- [将缓存终态误认为新成功] → 缓存与本轮核实分离，禁止缓存清锁；测试旧成功与新 Stop 未知、记录保存失败及读回失败。
- [暂停恢复破坏 Service 或草稿] → 保留节点和视图状态，验证节点身份、输入与选择；原身份撤销/Stop/Delete 仍按既有权限规则执行。
- [现场失败原因不可取证] → 保留明确限制，用合成故障与原 ID 计数验证本范围，不宣称修复未复现的环境错误。
- [示意原型简化了真实动作] → 原型是布局/交互参照；真实未知锁、导出交付、确认、Helper 降级、合法 Stop 和只读检查均按规格实施。

## Migration Plan

1. 以向后兼容的可选字段扩展已知记录及桥接返回体，保留旧格式、原身份键和隐藏规则；测试旧记录升级及新记录被旧结构读取。
2. 实现状态与展示投影，再接入路由/动作、菜单和原型界面；构建 WebUI、同步嵌入资源并运行相关 Go、浏览器和真实重启验收。
3. 在独立 microvm 构建工作区复用锁定 Guest/QEMU 输入，将实际验证的 Piwork 提交及 dirty/input hash 如实记录，使用原生 Windows 工具链生成 GUI；核验成品内 Core 身份后交付用户复查，不使用测试覆盖二进制打包。
4. 回退应用与嵌入资源即可恢复旧展示；记录附加字段由旧实现忽略，无需回写历史或删除 Work 数据。

## Open Questions

- 截图内各次 Retry 的具体来源与错误尚需原任务诊断/日志确认。该问题不影响已确认的门禁、菜单和分类修复，按决策 6 的隔离重现及可得只读证据处理，并在验收中区分现场事实与合成场景。
