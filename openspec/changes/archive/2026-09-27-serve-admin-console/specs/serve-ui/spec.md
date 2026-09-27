# Serve UI Spec Delta

## Purpose

提供独立于 Core daemon 的浏览器管理入口，定义同机部署、管理员会话、导航和公共交互行为，使远程管理员能够通过安全连接使用管理能力，并在连接中断、会话失效或面板重启时获得明确结果。

## ADDED Requirements

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

面板 SHALL 通过 Core 账号密码登录，只有启用的 `admin` 可以获得面板会话。有效普通 `user` 凭证 SHALL 得到“仅管理员可访问，请使用 piwork-cli”的拒绝提示，面板 SHALL 撤销或丢弃本次取得的 Core token 且不签发面板会话。不存在、禁用或密码错误的账号 SHALL 统一显示认证失败。首次管理员未初始化时 SHALL 提示通过 CLI/env 初始化，不展示 bootstrap 表单。登录失败 SHALL 保留账号输入、清空密码，并显示限流的剩余等待时间。

Core bearer SHALL 仅留在面板服务端，浏览器会话使用随机不透明 ID 的 Secure、HttpOnly、SameSite=Strict、Path=/ Cookie，不设置 Domain。会话有效期 SHALL 不超过 Core 返回的绝对到期时间，不自动滑动续期。页面、脚本存储、URL 和日志 SHALL 不含 Core bearer、密码、operator credential 或模型 secret。面板 SHALL 按账号键和真实连接来源执行每分钟最多 5 次失败的登录限流，并遵守 Core 返回的额外限流。服务端面板会话最多 1,024 个，容量满 SHALL 返回 503 CONSOLE_SESSION_CAPACITY；登录挑战有效期 10 分钟，最多 2,048 个，过量创建 SHALL 返回 429 并优先清理过期挑战，不驱逐有效登录会话。登录和所有状态变更 SHALL 验证配置的 Origin 及与当前会话或登录挑战绑定的 CSRF 证明，验证失败前不得向 Core 发起状态变更。

#### Scenario: 管理员登录
- **WHEN** 已启用管理员提交有效凭证和同源 CSRF 证明
- **THEN** 进入状态页并显示账号，浏览器只收到面板 Cookie 和公开身份，不能从页面或 Web Storage 取得 Core bearer

#### Scenario: 普通用户登录
- **WHEN** 管理员创建的普通用户提交正确凭证
- **THEN** 面板拒绝访问且无管理会话，该账号仍能使用 piwork-cli 登录

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

面板 SHALL 提供“状态、用户、运行时、默认 Work、Skills、Packages、操作查询”导航，默认界面使用中文，技术标识和错误码保持原样。管理页面 SHALL 仅显示当前功能所需的公开数据，所有服务器返回文本 SHALL 按纯文本显示。列表 SHALL 区分加载、空集合、成功和失败；错误 SHALL 提供可执行提示及可复制 correlationId（如有）。表单 SHALL 在提交中禁用重复提交，验证失败保留非敏感草稿并定位字段；成功后显示 Core 确认结果并刷新相关数据。

离开有未提交更改的页面或覆盖草稿 SHALL 提示丢弃确认。删除、禁用账号及密码重置 SHALL 有含目标名称的确认步骤。未知结果的变更 SHALL 提示先查询当前状态；只有显式重试且具备稳定幂等键的包安装/更新可以重放原提交。控件 SHALL 有可访问名称、键盘操作及可见焦点；360px 宽屏下表单和主要动作仍可操作，宽表格可横向滚动。未知页面 SHALL 返回 404；不提供任意 URL/路径代理。

#### Scenario: 空列表与加载失败
- **WHEN** 列表尚未完成、返回空集合或请求失败
- **THEN** 分别显示加载状态、带创建入口的空态或错误重试入口，失败不能显示为“没有数据”

#### Scenario: 保存失败保留编辑
- **WHEN** 表单提交被 Core 拒绝
- **THEN** 保留非敏感编辑，显示错误并重新启用提交，密码类字段清空，不提前显示成功

#### Scenario: 恶意名称与窄屏操作
- **WHEN** 数据含 HTML 字符，管理员通过键盘或窄屏访问页面
- **THEN** 字符按文本呈现，主要动作可聚焦和执行，不注入脚本或遮挡提交按钮
