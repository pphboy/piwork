## MODIFIED Requirements

### Requirement: Session 与 Run 的观察可恢复且不重复提交

**Identifier:** DWUI-004

Desktop SHALL 提供 Session 创建、列表、读取与切换，提交消息、文本/工具事件、Run 详情和显式取消，落实 DUL-012。标题使用真实首消息摘要或创建时间/ID。一个 Work 活跃 Run 的限制 SHALL 在其他 Session 提交前后都明确反馈，保留草稿且不建立隐藏队列。取消以当前 Run ID 为目标，取消中不预告终态。

断线恢复 SHALL 按原 Run ID 和事件游标查询/观察，重复事件去重；游标过期 SHALL 查询结果和 Session 历史，不重发 prompt。旧 context 不兼容 SHALL 提供 New session 并保留草稿，不自动迁移。停止 Work 不新取历史，页面已有内容标为旧内容。所有观察 SHALL 在切换身份、对象或页面卸载时释放本地连接，不取消远端执行。

事件入口返回 410 后，Desktop SHALL 真正读取原 Run 和对应 Session；只有历史读取成功后才能提示历史已恢复。SHALL 停止向事件入口重发同一失效游标，不擅自用 0 重播。原 Run 仍活跃时 SHALL 展示历史恢复模式，以串行只读查询观察原 Run 和已保存历史；查询到终态后 SHALL 停止自动观察并呈现最终结果，已有输出不得重复追加。读取失败 SHALL 保留已知内容、Run ID 和可恢复提示；鉴权失效或对象不存在 SHALL 停止自动读取并进入对应恢复状态，不能发送新的 Run。

#### Scenario: 忙碌时保留输入
- **WHEN** 同一 Work 的另一 Session 正在执行而当前 Session 发送失败为 busy
- **THEN** 显示活动执行入口并保留草稿，不排队、不取消旧 Run

#### Scenario: 断线与游标过期
- **WHEN** 事件观察断开，恢复请求报告游标过期
- **THEN** 从原 Run 结果和 Session 历史恢复，只呈现一次已有输出，不发第二次消息

#### Scenario: 取消与成功竞争
- **WHEN** 用户取消时 Core 已经成功完成 Run
- **THEN** 最终显示 succeeded，不能以本地取消请求覆盖真实结果

#### Scenario: 410 后原 Run 已完成
- **WHEN** 事件入口返回 410，原 Run 查询确认 succeeded 且 Session 保存了最终回答
- **THEN** 实际读取 Session 并展示最终回答一次，停止自动读取，不重复 POST prompt 或请求失效事件游标

#### Scenario: 410 后原 Run 仍运行
- **WHEN** 事件入口返回 410，原 Run 先返回 running 后进入终态
- **THEN** 通过同一 Run 的只读状态和 Session 历史查询看到运行中及终态，事件入口不收到同一失效游标的无限重试，终态后查询停止

#### Scenario: 历史恢复失败或身份切换
- **WHEN** Session 读取失败、鉴权失效，或用户在历史恢复期间切换身份
- **THEN** 不显示虚假的恢复成功；读取失败保留已知内容和恢复入口，身份失效后停止旧观察且旧响应不写入新身份

### Requirement: 浏览器文件操作覆盖共享 workspace

**Identifier:** DWUI-006

Files SHALL 以当前 Work 的整个共享 workspace 为根（包含隐藏项），通过本地认证入口调用 Core WebDAV；仅运行且文件准入成功时可读写。SHALL 实现 PROPFIND 列目录、GET 下载/文本读取、PUT 上传/保存、MKCOL、同 Work MOVE/COPY/DELETE，准确处理 Destination、Location、DAV href、中文与百分号路径及逐项错误。工作根不可删除、移动或重命名，符号链接/特殊项按真实类型限制，不能穿越根或跨 Work。

文本编辑 SHALL 限于至多 1 MiB、合法 UTF-8 且不含 NUL 的普通文件；超限或二进制提供 Download。编辑不自动保存，不承诺锁/ETag/自动合并，离开前明确 Save/Discard/Keep editing；保存前展示并发覆盖风险，已知修改时间可用时携带条件请求，冲突先重读，不自动覆盖。上传逐文件显示结果，已存在目的地须明确覆盖；目录操作可递归时先说明影响。

SHALL 遵守 Core 文件限额及单 Work mutation 并发限制；浏览器默认逐文件上传，无隐式写入重试。`207` 展示成功/失败路径，未知写入要求重读实际目录。普通下载不表示一致性备份，不提供目录 ZIP 或跨 Work 操作。文件能力缺失 SHALL 只局部降级。Connect with WebDAV SHALL 展示现有 proxy 命令、完整 Work URL 和终端临时密码获取方法，浏览器 Files 不依赖该流程。

编辑保存 SHALL 将 `If-Unmodified-Since` 绑定到读取正文时已知的修改时间；后台目录刷新不得将脏编辑的读取版本偷偷升级。新文件上传 SHALL 使用 `If-None-Match: *`，防止 HEAD 确认不存在后出现的文件被覆盖。既有文件覆盖 SHALL 绑定用户确认的路径及已知修改时间，发送已有条件请求；读取失败不视为不存在。条件冲突 SHALL 保留本地编辑或待上传 File，展示先重读/比较的恢复入口，不能自动改成无条件 PUT。重读 SHALL 分别保留用户草稿和新保存版本；再次覆盖重读版本须用户明确同意。有可用条件时使用条件，无可用修改时间时 SHALL 明示不能进行版本保护并要求显式覆盖同意，不宣称具有文件锁或强一致保护。

#### Scenario: 文件读写全流程
- **WHEN** 用户建目录、上传、编辑、重命名、复制、移动并下载文件
- **THEN** 相应 WebDAV 操作作用于同一 workspace，内容一致且浏览器不持有 Core token 或外部 WebDAV 密码

#### Scenario: 大文件、特殊项及越界
- **WHEN** 用户尝试编辑超限/非 UTF-8 文件、符号链接，或修改根及跨 Work 目标
- **THEN** 合法普通文件可下载，非法编辑/目标给出原因并在写入前拒绝

#### Scenario: 覆盖冲突和响应丢失
- **WHEN** 文件保存发生条件冲突，或 PUT 已发出但结果丢失
- **THEN** 保留本地编辑，提示重读/比较，不能自动再次 PUT 或声称回滚

#### Scenario: 目录部分失败和后端缺失
- **WHEN** 目录请求返回 207，或 Core 文件后端不可用
- **THEN** 前者显示逐路径结果并刷新；后者只禁用 Files，仍允许可用 Service 与 Work 控制

#### Scenario: 用户编辑期间 Agent 更新同一文件
- **WHEN** 用户读取带修改时间的文件后编辑，Agent 在下一秒或更晚更新该文件，随后用户保存
- **THEN** PUT 携带原修改时间，Core 的 412 被显示为冲突；Agent 的内容保留，本地草稿保留，没有无条件重试

#### Scenario: 新建上传的 HEAD 与 PUT 之间出现同名文件
- **WHEN** HEAD 返回 404 后另一写入者创建了同名目标，随后上传发送 PUT
- **THEN** PUT 包含 `If-None-Match: *`，返回条件冲突，不覆盖新出现的文件；待上传文件保留，须重读并显式确认覆盖

#### Scenario: 确认覆盖后目标再次变化
- **WHEN** 用户确认覆盖的既有目标在 PUT 前以可辨别的新修改时间变化
- **THEN** 原确认版本的条件请求失败；页面保留上传输入并要求重新核对，不自动以最新版本刷新覆盖同意

#### Scenario: 重读不自动覆盖草稿或重复写入
- **WHEN** 条件冲突或未知保存结果后用户重读文件
- **THEN** 新保存版本与本地草稿分别可查看，重读本身仅 GET；用户明确接受新的覆盖基线并再次保存才允许下一次 PUT

### Requirement: 配置、能力目录与应用形成独立步骤

**Identifier:** DWUI-007

Settings SHALL 按 DUL-014 完整提供 Skills 目录与 Work 选择/清空、AGENTS 当前/待应用内容及导入编辑、Advanced 完整 JSON show/set、Pi Package 目录及 Work 已安装项。In use、Saved changes、Not applied、runtime loaded/modelVisible SHALL 各自对应真实状态。目录不可编造说明；重选 Core 副本与保留 Work 副本的语义须明确。

Package SHALL 支持 Core/npm/Git/本地目录/ZIP 的安装与显式来源更新、enable/disable/remove；本地目录和 ZIP 使用浏览器选择器与受限上传。选择现有包不暗中安装或刷新。保存和包修改仅更新 desired；Apply 为独立 Operation，不暗中启动 Work 或取消 Run，后续新编辑仍待应用。Apply 失败保留 prior active，回退失败如实展示 Work 故障。离开脏表单 SHALL 处理保存、放弃或继续编辑。

Skills、Packages、AGENTS.md 与 Advanced SHALL 展示同一份未保存配置；保存结果 SHALL 不取决于当前页签。有效 JSON 中的显式空集合和空 AGENTS 内容 SHALL 保留，未在普通表单编辑的其他公开字段 SHALL 保留；重复编辑同一字段采用最后一次有效显式编辑。非法 JSON SHALL 保留输入并定位错误，阻止配置提交与向其他配置页签转换，用户仍可修正或明确放弃草稿。保存失败或结果未知 SHALL 保留完整非敏感草稿，不触发 Apply。

Core 目录读取状态 SHALL 与 Core 可达性/readiness 和 Work 草稿独立。刷新时 SHALL 保留已有数据并显示正在检查；部分失败保留成功目录及旧 Work 副本并定位失败目录，不能将失败当成空目录或全局离线。成功取得有效目录响应后 SHALL 清除该目录的不可用状态并按实际数据及动作准入恢复操作；有效空数组表示空目录。刷新 SHALL 不修改已选 Skills、Packages 或其他未保存配置。

#### Scenario: 安装与 Apply 分开
- **WHEN** 用户从任一支持来源安装包成功但尚未 Apply
- **THEN** 显示 Saved/Not applied，不声称 loaded；用户显式 Apply 后才观察激活结果

#### Scenario: 忙碌与失败回退
- **WHEN** Apply 被 Run busy 拒绝，或已接受 Apply 验证失败
- **THEN** 前者保留配置不取消 Run；后者显示真实回退结果，不能将安装成功当成运行成功

#### Scenario: Apply 期间继续编辑
- **WHEN** Apply 已接受后用户保存新的 AGENTS/Advanced 内容
- **THEN** 原 Operation 只激活其已接受候选，新编辑仍 Not applied

#### Scenario: Advanced 修改后从其他页签保存
- **WHEN** 用户在 Advanced 修改 Skills、Packages、AGENTS.md 和其他公开字段，切到 Skills 或 AGENTS.md 后保存
- **THEN** 相应页签展示新值，提交包含全部修改，不用原表单值覆盖 JSON；保存仅更新 desired

#### Scenario: 普通表单修改后从 Advanced 保存
- **WHEN** 用户先修改 Skills、Packages 或 AGENTS.md，再打开 Advanced 保存
- **THEN** JSON 展示并提交普通表单的新值，显式空值保留，同一字段最后一次有效编辑生效

#### Scenario: JSON 非法时尝试转换或保存
- **WHEN** Advanced 存在无法解析的 JSON，用户切换配置页签或点击任一保存入口
- **THEN** 保留原文及脏状态，显示定位错误，不转换到另一配置页签、不发配置 PUT；明确 Discard 可放弃该草稿

#### Scenario: 目录失败后恢复
- **WHEN** Skills 或 Packages 曾读取失败，随后用户刷新获得有效目录
- **THEN** 清除对应不可用反馈并恢复合法动作，用户现有选择和草稿保持不变，不覆盖 Core 离线或运行环境未就绪的真实状态

#### Scenario: 目录部分失败及空集合
- **WHEN** Skills 成功而 Packages 失败，随后 Packages 成功返回空数组
- **THEN** 首次只提示 Packages 错误且保留 Skills；后续显示真实空 Packages 目录并清除其错误，保留 Work 已保存副本和未保存选择

### Requirement: 完整 Work 包可以本地检查和原子导入

**Identifier:** DWUI-008

用户 SHALL 能选择 `.work` 在本地完整 Inspect，无需 Core 登录、不执行包内代码，显示既有安全摘要和私有内容提醒，允许检查后直接关闭。上传与检查 SHALL 流式处理并遵守现有 `.work` 格式、完整校验及容量限制，不将整个包放进浏览器/CLI 内存。

Import SHALL 复用检查后的同一包，提交前校验仍一致；名称留空真正省略，显式冲突定位名称字段；目标权限与模型兼容由 Core 校验。上传不虚构 Operation；接受后保留原 ID，发布前/失败时无半成品 Work。成功展示最终名称、新 ID、stopped 以及分开的 Open Work/Start Work。不自动运行 Service 或包代码。取消未提交传输可清理本地暂存；取消观察不撤销已接受 Import。

同一本地浏览器会话在同一 Core 下从匿名检查进入首次登录时，SHALL 保留已完整验证且未提交的包和其本地传输身份；登录成功后可继续检查摘要并显式导入，无需重新选择文件或上传到本地 CLI。登录失败不丢弃合法匿名检查。此例外 SHALL 不保留已认证用户的 Core 内容，亦不适用于切换 Core、已认证用户切换账号、登出或本地会话失效。

用户关闭未提交检查、替换所选包或取消仍在进行的本地检查时，SHALL 中止相应本地传输/观察并请求释放原暂存；晚到的进度和结果不得重新打开旧检查或覆盖新包。删除确认成功或已不存在后才显示清理完成，失败时保留可定位的清理信息与显式重试入口，不能以隐藏弹窗代替清理。为同一 Core 登录而暂离检查不属于放弃该包。Import 提交中、接受响应未知及已接受后 SHALL 保留该次身份及恢复信息，不按未提交检查重新提交、替换或取消远端操作；关闭仅停止本地观察。

#### Scenario: 离线检查后关闭
- **WHEN** 未登录用户选择合法或损坏的本地包
- **THEN** 本地分别显示完整验证摘要或具体校验失败，不连接 Core 或执行内容，关闭后清理暂存

#### Scenario: 自动名称和显式冲突
- **WHEN** 导入同名包时分别留空名称或显式填入冲突名称
- **THEN** 前者由 Core 选择名称，后者保持表单并提示冲突，不覆盖旧 Work

#### Scenario: 导入完成或失败
- **WHEN** 已接受 Import 进入终态
- **THEN** 成功才显示 stopped 新 Work，失败保留 Operation 和原因，均不自动 Start

#### Scenario: 匿名检查后登录同一 Core
- **WHEN** 本地检查成功，用户通过 Sign in to import 登录原 Core 后继续导入
- **THEN** 保留原传输及摘要，只使用原 transfer ID 提交 Import；本地检查上传不再执行，用户确认前不发送 Core 导入请求

#### Scenario: 登录失败或切换 Core
- **WHEN** 检查后登录原 Core 失败，或改为切换另一个 Core
- **THEN** 前者保持匿名检查以便重新登录；后者清理旧检查且不向新 Core 提交旧包，身份内容仍按现有隔离规则处理

#### Scenario: 检查期间取消或连续换包
- **WHEN** 检查正在传输时用户取消，或选中另一个包替换旧检查
- **THEN** 原本地传输/观察停止，原暂存被请求删除，旧响应不回填；新检查仅使用自己的 transfer ID 和结果

#### Scenario: 暂存清理失败
- **WHEN** 用户放弃未提交检查，但删除请求失败或响应丢失
- **THEN** 保留旧 transfer ID 的清理提示及显式重试入口，不宣称磁盘已释放，不影响其他 Work 或删除 Core 快照

#### Scenario: 导入接受后关闭观察
- **WHEN** 已提交 Import 的响应未知或已取得 Operation ID，用户关闭检查或操作弹窗
- **THEN** 保留该次导入及恢复身份，只停止本地观察，不调用远端取消、不发第二次 Import，也不以重新选择包替代核对原结果
