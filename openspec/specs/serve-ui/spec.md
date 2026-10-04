# Serve UI Specification

## Purpose

提供独立于 Core daemon 的浏览器管理入口，定义同机部署、管理员会话、导航和公共交互行为，使远程管理员能够通过安全连接使用管理能力，并在连接中断、会话失效或面板重启时获得明确结果。

## Requirements

### Requirement: 独立启动同机管理面板

**Identifier:** SUI-001

系统 SHALL 提供独立命令 `piwork-console serve`，由面板进程提供页面、静态资源和 HTTPS。命令 SHALL 支持 `--core`、`--listen`、`--public-origin`、`--tls-cert`、`--tls-key`、`--data-dir`；Core 默认 `http://127.0.0.1:7171`，listen 默认 `0.0.0.0:7173`，data-dir 默认当前目录下 `.piwork/console`。public-origin 和证书/私钥参数必填，public-origin SHALL 是与监听端口一致的 HTTPS origin；Core URL SHALL 只允许本机 loopback，不含凭证、路径前缀、query 或 fragment。参数错误 SHALL exit 2，证书/端口/目录等启动失败 SHALL exit 1，帮助 SHALL exit 0 且不读取配置文件或连接 Core。

Core 不可达 SHALL 不阻止有效配置的面板启动。面板 SHALL 不启动、停止或重启 Core；停止面板 SHALL 不取消 Core 已接受的 Operation。面板 SHALL 不读取 Core 数据目录或 operator credential。面板数据目录只保留受保护的临时上传和进程锁；相同目录的第二个实例 SHALL 失败且不清理第一个实例的文件。浏览器会话 SHALL 不跨面板进程重启保留。

#### Scenario: 独立运行两个进程
- **WHEN** Core 已运行，部署者启动面板并随后停止面板
- **THEN** 远程浏览器曾能通过 HTTPS 打开面板，Core 与两个 CLI 的原有管理和用户操作继续可用，已接受包任务继续运行

#### Scenario: Core 暂时不可达
- **WHEN** 面板配置有效但 Core 未启动
- **THEN** 面板仍监听，登录页显示 Core 不可达和重试入口；Core 启动后重试可恢复，无需重启面板

#### Scenario: 拒绝不完整或跨机配置
- **WHEN** 缺少 TLS 参数、public-origin 非 HTTPS、端口不匹配或 Core URL 非 loopback
- **THEN** 命令在监听前失败且给出不含 secret 的参数说明，不自动降级为远程 HTTP

#### Scenario: 面板崩溃后重启
- **WHEN** 面板重启并独占其数据目录
- **THEN** 清理上次未完成的临时上传，旧浏览器会话要求重新登录，已接受 Operation 仍能通过 Core 查询

### Requirement: 仅管理员获得浏览器管理会话

**Identifier:** SUI-002

面板 SHALL 通过 Core 账号密码登录，只有启用的 `admin` 可以获得面板会话。有效普通 `user` 凭证 SHALL 得到说明仅管理员可访问、普通用户应使用 piwork-cli 的英文拒绝提示，面板 SHALL 撤销或丢弃本次取得的 Core token 且不签发面板会话。不存在、禁用或密码错误的账号 SHALL 统一显示认证失败。首次管理员未初始化时 SHALL 以英文提示通过 CLI/env 初始化，不展示 bootstrap 表单。登录失败 SHALL 保留账号输入、清空密码，并显示限流的剩余等待时间。

Core bearer SHALL 仅留在面板服务端，浏览器会话使用随机不透明 ID 的 Secure、HttpOnly、SameSite=Strict、Path=/ Cookie，不设置 Domain。会话有效期 SHALL 不超过 Core 返回的绝对到期时间，不自动滑动续期。页面、脚本存储、URL 和日志 SHALL 不含 Core bearer、密码、operator credential 或模型 secret。面板 SHALL 按账号键和真实连接来源执行每分钟最多 5 次失败的登录限流，并遵守 Core 返回的额外限流。服务端面板会话最多 1,024 个，容量满 SHALL 返回 503 CONSOLE_SESSION_CAPACITY；登录挑战有效期 10 分钟，最多 2,048 个，过量创建 SHALL 返回 429 并优先清理过期挑战，不驱逐有效登录会话。登录和所有状态变更 SHALL 验证配置的 Origin 及与当前会话或登录挑战绑定的 CSRF 证明，验证失败前不得向 Core 发起状态变更。

#### Scenario: 管理员登录
- **WHEN** 已启用管理员提交有效凭证和同源 CSRF 证明
- **THEN** 进入状态页并显示账号，浏览器只收到面板 Cookie 和公开身份，不能从页面或 Web Storage 取得 Core bearer

#### Scenario: 普通用户登录
- **WHEN** 管理员创建的普通用户提交正确凭证
- **THEN** 面板以英文拒绝访问且无管理会话，该账号仍能使用 piwork-cli 登录

#### Scenario: 会话容量已满
- **WHEN** 面板已有 1,024 个有效会话或登录挑战容量耗尽
- **THEN** 拒绝新增对应会话/挑战并显示容量或限流提示，原有效会话不失效，也不泄漏新取得的 Core token

#### Scenario: 伪造管理请求
- **WHEN** 请求带 Cookie 但 Origin 不匹配、缺少 CSRF 或 CSRF 属于其他会话
- **THEN** 返回 403，Core 中用户、配置、Skill 和 package 状态均不变

#### Scenario: 登录失败与限流
- **WHEN** 账号不存在、密码错误、账号禁用，或连续失败触及登录限流
- **THEN** 前三者显示相同认证失败；限流显示可重试时间；密码被清空且不记录到日志

### Requirement: 会话失效与注销有明确边界

**Identifier:** SUI-003

每次受保护 API 请求 SHALL 经 Core 验证管理员当前会话。到期、撤销、禁用或权限失效后 SHALL 清除面板会话并返回登录页，停止页面轮询，清空密码和文件引用；不得自动重新提交修改。页面可见时 SHALL 至少每 15 秒检查会话，重新聚焦时立即检查。临时 Core 网络失败 SHALL 显示不可达并保留尚未到期的面板会话以便重试，不能当作密码错误。

注销 SHALL 撤销对应 Core 会话后清除面板会话；Core 已返回会话无效时也可完成本地注销。Core 不可达时 SHALL 显示注销未完成并允许重试，不宣称已撤销。账号级撤销不取消已经接受的 package Operation。面板重启后重新登录 SHALL 能按已有 Operation ID 恢复观察。

#### Scenario: 管理员在另一客户端被禁用
- **WHEN** 已登录管理员被禁用或重置密码后继续请求管理数据
- **THEN** 请求失败，面板退出到登录页，后续写请求不可成功；已接受的 Core 包任务仍保留

#### Scenario: 只注销当前浏览器
- **WHEN** 管理员在两个浏览器登录并在其中一个注销成功
- **THEN** 当前面板及对应 Core 会话失效，另一个浏览器继续可用

#### Scenario: 连接中断后恢复
- **WHEN** Core 暂时不可达但面板会话尚未到期
- **THEN** 显示连接错误和重试，恢复后重新验证身份并加载数据，不隐式重发变更

### Requirement: 提供一致的管理员导航和表单状态

**Identifier:** SUI-004

面板 SHALL 在原有 `/`、`/users`、`/runtime`、`/default-work`、`/skills`、`/packages`、`/operations` 路由分别提供 `Status`、`Users`、`Runtime`、`Default Work`、`Skills`、`Packages`、`Find Operation` 导航。未经另行要求，UI 自有文字 SHALL 只使用英文；用户内容、资源名称、技术标识和错误码保持原样。管理页面 SHALL 仅显示当前功能所需的公开数据，所有服务器返回文本 SHALL 按纯文本显示。列表 SHALL 区分加载、空集合、成功和失败；错误 SHALL 提供英文可执行提示及可复制 correlationId（如有）。表单 SHALL 在提交中禁用重复提交，验证失败保留非敏感草稿并定位字段；成功后显示 Core 确认结果并刷新相关数据。

离开有未提交更改的页面或覆盖草稿 SHALL 提示丢弃确认。删除、禁用账号及密码重置 SHALL 有含目标名称与实际影响的英文确认步骤。未知结果的变更 SHALL 提示先查询当前状态；只有显式重试且具备稳定幂等键的包安装/更新可以重放原提交。控件 SHALL 有英文可访问名称、键盘操作及可见焦点；360px 宽屏下表单和主要动作仍可操作，宽表格可横向滚动。未知页面 SHALL 返回 404；不提供任意 URL/路径代理。

#### Scenario: 空列表与加载失败
- **WHEN** 列表尚未完成、返回空集合或请求失败
- **THEN** 分别显示英文加载状态、带创建入口的空态或错误重试入口，失败不能显示为没有数据

#### Scenario: 保存失败保留编辑
- **WHEN** 表单提交被 Core 拒绝
- **THEN** 保留非敏感编辑，显示英文错误并重新启用提交，密码类字段清空，不提前显示成功

#### Scenario: 恶意名称与窄屏操作
- **WHEN** 数据含 HTML 字符，管理员通过键盘或窄屏访问页面
- **THEN** 字符按文本呈现，主要动作可聚焦和执行，不注入脚本或遮挡提交按钮

### Requirement: 管理员手动动作与文件预检有明确等待反馈

**Identifier:** SUI-005

Serve SHALL 沿用 UIL-008/009，在有效异步动作开始后的首个可绘制机会、结果返回前，在原对象/表单显示英文动作和等待状态，提供可访问的状态说明及 busy 语义；只禁用按钮不构成反馈。手动 Refresh status、Verify runtime、Retry connection、Refresh/Resume Operation、Read current runtime/defaults 和 Sign out SHALL 均覆盖，重复入口只能有一个在途请求。不同对象的合法导航和操作保持可用，读操作不得与后台轮询叠加成并行查询同一对象。

选择 Skill 目录、Package 目录/ZIP、AGENTS 文件后，浏览器本地读取/预检 SHALL 显示 Checking selected files，未完成不能提交本次未确认选择；取消选择保持原输入，预检失败保留旧选择，替换/关闭后的晚结果不能恢复旧文件。已有登录、保存、上传和 Package Operation 反馈 SHALL 保持真实；上传、验证、接受、后台准备与发布分别表达。

检查成功即使值未改变 SHALL 有新的确认时间或简短已确认说明。十秒以上未取得响应显示仍在等待及已等待时间，不虚构超时失败。明确失败、结果未知、旧缓存和成功空数据 SHALL 区分；错误不得使用成功措辞/图标。身份/路由变更后旧请求不覆盖当前页面，密码/key 处理仍遵守既有规则。快速动作不人为延迟，普通导航和复制不要求额外 toast。

请求的成功、失败及最终清理回调 SHALL 均受发起时的身份与视图归属约束；离开后返回同一路由也属于新的视图。旧请求不得清理新页面的敏感输入、改变新草稿或释放新动作的提交锁。

#### Scenario: 手动检查等待与重复点击
- **WHEN** 用户点击 Verify runtime、Refresh status、Read current configuration 或 Refresh Operation，响应被延迟并再次触发同一入口
- **THEN** 原区域已显示 Checking/Reading，只有一个对应请求；返回相同内容仍可确认本次检查完成，后台轮询不使等待提示提前消失

#### Scenario: 本地大文件预检
- **WHEN** 用户选择 Package ZIP 或较大目录，本地校验尚未结束
- **THEN** 原表单显示文件目标与预检中，不能提交未确认的新选择；失败、换源或关闭后不恢复晚到的旧选择

#### Scenario: 注销与身份失效
- **WHEN** 注销响应缓慢或 Core 暂时不可达
- **THEN** 显示 Signing out，重复注销受限，随后按 SUI-003 区分已撤销与未完成，旧账号的晚结果不覆盖新登录页

### Requirement: 已确认管理修改与关联刷新独立呈现

**Identifier:** SUI-006

Serve SHALL 在收到可靠的账号创建、启用/禁用、密码重置、Skill 添加/更新、Skill/Package 启用/禁用/移除、Runtime/Defaults 保存确认后，立即保存并显示目标与已确认结果。后续 Users、catalog、defaults、readiness 查询 SHALL 单独显示 Refreshing 和取得时间，不能阻塞成功反馈、撤销原确认或重新执行修改。

刷新失败 SHALL 显示“修改已确认；当前列表/状态未确认”及对应只读 Retry refresh，保留安全的旧数据并标记为最后已知。反馈 SHALL 位于仍存在的页面/结果容器，不能只写入已关闭弹层。更新自身凭据/状态导致撤销仍按 SUI-USR-002 返回登录，不能被普通刷新成功覆盖。响应未知继续使用既有只读核对或稳定 package key 恢复，不能据此显示确定成功。

Runtime 保存后的 API Key 清理 SHALL 仅作用于该次提交的原输入上下文。用户离开 Runtime 后重新进入并输入的新 Key 与非敏感草稿不得被旧保存请求或后续 readiness 查询的晚回调清空；原提交 Key 仍按既有敏感输入规则清理，不从后端回填，不进入动作状态、日志或验收截图。

#### Scenario: 创建用户成功但刷新缓慢
- **WHEN** Core 已返回新用户，随后用户列表查询被延迟
- **THEN** 创建结果及普通用户/管理员入口已可见，密码清空，列表显示刷新中，不要求再次创建

#### Scenario: 目录修改成功但刷新失败
- **WHEN** Skill 上传或 Skill/Package 状态修改已确认，随后 catalog/defaults 查询失败
- **THEN** 显示原成功和刷新失败，提供只读恢复；不访问已移除弹层、不抛出因其缺失而产生的异常、不再次上传或修改

#### Scenario: 保存结果与 readiness
- **WHEN** Runtime 保存成功后 readiness 查询失败，或 Defaults 保存后的辅助查询失败
- **THEN** 保留保存成功，readiness/辅助信息单独未确认，非敏感新草稿保留，key 不被回填或记录

#### Scenario: Runtime 旧保存不清理重新进入后的输入
- **WHEN** Runtime 保存请求被延迟，用户按脏草稿规则离开页面，再返回编辑并输入新 Key 与新草稿，旧保存或其 readiness 回调随后完成或失败
- **THEN** 新 Key 与新非敏感草稿保持不变，新动作的锁不被旧回调释放；旧反馈不替换新视图，原提交 Key 仍遵守敏感清理规则且不回填、不记录
