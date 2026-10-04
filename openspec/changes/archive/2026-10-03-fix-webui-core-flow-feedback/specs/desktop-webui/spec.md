## ADDED Requirements

### Requirement: 主流程的异步动作提供即时且归属明确的反馈

**Identifier:** DWUI-011

Desktop SHALL 在有效动作开始后的首个可绘制机会、请求结果尚未返回时，显示动作、目标对象及正在读取/提交/上传/验证的英文状态；仅禁用按钮或改变颜色不构成等待反馈。按钮、表单、列表行、模块或传输区 SHALL 在原上下文呈现状态，等待区域提供可访问状态说明及 busy 语义。快速完成不得人为延迟；最终页面、对象状态或成功提示可直接成为完成反馈。普通菜单、搜索、选择、复制及无需读取的导航 SHALL 不被强制添加加载或 toast。

覆盖入口 SHALL 至少包括下表，鼠标、键盘提交、文件选择和深链接遵守同样规则；后台定时读取不能冒充用户刚发起的检查。

| 入口组 | 必须覆盖的动作 |
| --- | --- |
| 连接与身份 | Sign in、Sign out、Switch Core、Check connection/readiness、重试 Works 读取 |
| Work | Create、Start、Stop、Retry、Delete、Open、Check status、进入 Settings/深链接 |
| Work 模块 | Services/Files 读取与刷新、路径导航、Session 列表读取/创建/切换、Run 提交/取消/恢复 |
| Service | Start/Stop/Restart/Retry/Remove、详情及日志读取/刷新；浏览器入口按 BSA-005 |
| Files | 文本读取/保存/重读、上传/覆盖、建目录、Rename/Move/Copy/Delete、下载发起 |
| Settings | Save/Refresh/Apply、Skills 副本刷新、catalog 检查、AGENTS/JSON 文件读取、Pi Package 五种来源安装/更新/移除 |
| Work 包与恢复 | Inspect/Import、Export 准备、Download 准备/验证、原 transfer 查询与清理、Known operations、Operation/snapshot 查询、清除已完成记录 |

收到原 Operation/Run acceptance SHALL 立即展示其 ID、对象及 Accepted，不能等待后续 Work、列表、日志或配置读取才展示。执行状态 SHALL 依据真实 state/phase；不同动作不统一伪装成 Preparing，缺细阶段时显示该对象操作正在进行且保留原值。观察终态后 SHALL 提供所属对象的结果或返回/刷新入口，不把 succeeded 等同于另一能力已经 Ready、loaded 或浏览器已落盘。

同步修改已确认时 SHALL 立即保留并展示确认事实；需要关联读取时另行显示 Refreshing/Verifying，读取失败只说明当前数据未确认，保留原结果及只读恢复入口。没有可靠确认的修改 SHALL 区分明确拒绝与结果未知，保留输入和已有对象身份，禁止自动重发。手动检查成功且内容未变化时 SHALL 更新检查时间或显示此次已确认，失败不得使用成功图标/措辞。

#### Scenario: 请求尚未返回的创建与启动
- **WHEN** 用户提交 Create Work 或 Start Work，请求被延迟
- **THEN** 原表单/Work 行在响应前显示提交动作和目标，重复入口不可再次提交，其他合法导航可用；接受后显示原 Operation，不预告 Ready

#### Scenario: 接受后关联读取缓慢
- **WHEN** Start/Stop/Delete/Apply/Package/Import/Export 已返回原 Operation ID，后续读取缓慢或失败
- **THEN** 原 ID 和 Accepted 已可见，读取独立呈现，不隐藏 acceptance、不宣称操作失败、不发第二次修改

#### Scenario: 读取不是空数据
- **WHEN** 用户打开 Work、Files、Settings、Session 或日志且请求尚未返回
- **THEN** 目标与读取状态可见，旧内容标记为最后已知，未确认列表不写成空集合/零计数；成功空集合、404 和读取失败各有不同的下一步

#### Scenario: Run 提交与请求取消
- **WHEN** 用户 Send 或 Cancel run，接受响应被延迟
- **THEN** 对应输入/Run 上显示 Submitting message 或 Requesting cancellation，保留草稿/原 Run；接受后显示真实 Run 状态，取消与成功竞争以真实终态为准

#### Scenario: 保存确认与读回分离
- **WHEN** 文件 PUT 或配置保存已被可靠确认，随后版本/配置读取失败
- **THEN** 已确认写入事实保留，界面明确版本/当前配置未确认，草稿和新编辑不丢失；不重复写入、不以旧时间授权下一次覆盖、不暗中 Apply

#### Scenario: 未变化的检查与快速完成
- **WHEN** 手动查询成功但返回相同状态，或请求立即完成
- **THEN** 查询确认时间/简短结果可辨，快速完成不增加人为等待；菜单与复制继续使用既有即时结果

### Requirement: 等待状态按对象防重复并允许离开和独立操作

**Identifier:** DWUI-012

Desktop SHALL 只限制该提交的重复入口和同对象的冲突修改，禁止用一个异步动作禁用整页按钮。同一 Work 文件修改串行，同一 Service 控制提交串行，同一配置提交串行；同 Work 生命周期提交期间限制冲突写入。取得 acceptance 后提交锁 SHALL 释放，后续准入仍按真实对象状态及既有控制语义，允许合法 Stop 取代未完成 Start；不能将 Operation 观察当作全局锁。身份变更提交期间阻止新的平台修改，既有匿名 Inspect 规则保持。

Service 控制提交的对象 SHALL 按发起时的 Work 与 Service 身份绑定，不包含浏览器入口端口。切换端口、关闭再打开详情或换用另一控制入口不能绕过同一 Service 的在途冲突锁；其他 Service 的合法动作保持可用。Service 预览、入口准备及其缓存仍按 Work/Service/port 区分。

等待期间 SHALL 保留普通 Close/Back、复制及无关对象的合法动作，导航仍检查脏草稿。关闭普通详情或离开模块只结束当前展示/读取观察，不暗中取消远端 Operation、Run 或已提交修改。未提交 Inspect 的 Cancel/Escape 仍释放本地暂存；提交中/未知/已接受 Import 保留原身份并只停止展示。界面 SHALL 明确这些不同的关闭含义。

反馈 SHALL 绑定发起时的 Core/账号、Work/对象及该次动作。切换对象后晚结果不能打开旧弹层、覆盖新内容/草稿或显示为新对象的成功；同身份已接受操作仍能按原 ID 找回。新身份不得取得旧内容或传输。失败/终止后 SHALL 释放相应等待状态，保留已有安全约束；未知修改不能通过重新启用按钮暗示可直接再次提交。保存期间允许继续编辑时，成功只确认已提交草稿，新编辑仍为 Unsaved。

未知修改的只读核对 SHALL 匹配原 Core/账号、Work、动作及涉及资源，并依据实际返回对象判断核对范围。查询其他 Work 的 Operation、同 Work 的无关 Operation 或未确认关联关系的记录不得解除原动作的未知结果锁；不得因为一次查询成功而批量解除当前 Work 的生命周期、传输和 Agent 锁。已有接口能够确认原目标的当前事实或原业务身份时，才可恢复对应动作的既有准入，并保留原提交结果未知与当前事实已核对的区别；无法确认时继续提供原对象核对入口，不自动重发、不暗示可直接重试。

#### Scenario: 等待下载时关闭或执行独立动作
- **WHEN** 当前 Work 的下载准备尚未完成，用户关闭 Export 并查看另一 Work
- **THEN** Close/Back 可操作，另一个 Work 的合法动作不被禁用；原准备不会自动再次提交，原结果可在原上下文找回，完成不会在新页面自动触发下载

#### Scenario: 文件选择入口防重复
- **WHEN** 同一 Work 正在上传，用户再次通过文件选择或键盘触发上传/删除
- **THEN** 第二个冲突修改未发出，当前上传和原因可见，不建立隐藏队列；其他 Work 的合法操作不受此锁限制

#### Scenario: 晚返回与继续编辑
- **WHEN** 用户切换 Work/Core/账号，或在 Save 期间继续编辑，旧动作随后返回
- **THEN** 旧反馈不进入新对象或新身份；同对象保存只确认提交版本，新草稿保留；旧请求的结束不会释放另一动作的锁

#### Scenario: Operation 观察与目标取代
- **WHEN** Start 已接受并正在观察，用户在既有准入下显式 Stop
- **THEN** 可以提交新的停止目标；两个 Operation 身份分别保留，旧 superseded 不被描述为当前启动成功

#### Scenario: 切换端口不绕过 Service 控制锁
- **WHEN** 同一 Service 的 Restart 响应尚未返回，用户关闭详情、切换浏览器端口并重新打开该 Service 的控制入口
- **THEN** 第二个冲突控制请求不会发出，原目标与等待原因仍可查看；其他 Service 的合法控制不受此锁限制，预览入口仍按所选端口区分

#### Scenario: 未知结果核对仅恢复对应原对象
- **WHEN** Work A 的 Start 返回结果未知，用户查询 Work B 的 Operation 或 Work A 的无关 Operation，随后核对原目标
- **THEN** 无关查询不会解除 A 的未知结果锁或产生第二次 Start；只有匹配原身份、动作对象且能够确认相关事实的核对才恢复对应准入，原提交未知不被改写为确定成功，其他未知动作不被批量解除

### Requirement: 传输的等待与进度在所属流程中可见

**Identifier:** DWUI-013

Files 上传 SHALL 在开始目标检查时显示当前文件/总文件数，并展示真实已发送字节或不可量化的 Uploading，逐文件串行且最终结果按路径呈现。只有浏览器发送完成时不能宣称 Core 已保存；等待响应时显示 Waiting for confirmation，部分失败/未知保留未成功输入及既有条件覆盖规则，不自动重传。

Pi Package 本地目录/ZIP SHALL 在安装弹层展示浏览器到 CLI 的真实上传、等待本地校验及传送、随后提交 Core 接受的不同事实；没有 CLI 到 Core 的字节数据时只显示阶段。Core/npm/Git 来源的提交也 SHALL 有等待反馈，acceptance 后才进入原 Operation 观察，安装成功不等于 Apply/loaded。

`.work` 下载 SHALL 在点击后立即显示本机下载准备，随后按已有原 snapshot/transfer 显示 downloading/validating/ready、已知字节及查询时间。准备响应尚未返回也 SHALL 可以观察进度；total 未知时不得伪造百分比或用零代表真实大小。下载读取/校验失败与观察失败分别反馈；观察失败保留原 transfer/snapshot，显式重新查询不创建新快照、不重复准备。已准备的同一 transfer SHALL 可继续发起浏览器内容下载，发起后只显示 Download started，不声称落盘完成。

关闭 Download 弹层不隐式取消原准备；完成后在原 Export/已知活动上下文提供 Download，不在其他页面自动弹出保存。页面卸载、本地身份失效或 CLI 退出的传输边界沿用现有行为，不能承诺后台跨进程续传。Inspect/Import 的已有本地检查与明确提交、释放及未知恢复保持 DWUI-008 与既有修复规则。

#### Scenario: 文件上传发送完成但等待确认
- **WHEN** 文件上传字节已发送，而 WebDAV 响应尚未返回
- **THEN** 当前路径显示等待保存确认，成功计数不提前增加，重复/冲突修改受限，返回成功后才更新结果

#### Scenario: 本地 Pi Package 阶段
- **WHEN** 用户从目录或 ZIP 安装/更新包
- **THEN** 响应前可见真实上传和后续等待阶段，取得 Operation 后立即显示 Accepted；不把上传完成写成安装/加载完成

#### Scenario: 下载 POST 尚未结束
- **WHEN** CLI 正在从原 snapshot 拉取和验证 `.work`，初始准备请求尚未返回
- **THEN** Export 显示对应 transfer 的实际进度/阶段，Close 可用，尚未提供未校验内容下载，未新增 Export

#### Scenario: 下载观察丢失与继续
- **WHEN** 下载状态查询失败后用户显式 Check transfer，随后原 transfer ready
- **THEN** 保留原 snapshot/transfer 和最后确认时间，仅重新查询原传输，提供同一内容下载，不重新提交准备或声称文件已落盘

#### Scenario: 有界本地等待与未知总量
- **WHEN** 进度没有 total，或已等待十秒但未取得新确认
- **THEN** 分别显示不可量化阶段或仍在等待确认及已等待时间，不假造百分比、超时失败或新的修改请求
