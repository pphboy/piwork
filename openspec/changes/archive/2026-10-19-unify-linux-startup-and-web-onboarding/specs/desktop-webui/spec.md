## MODIFIED Requirements

### Requirement: 连接与用户会话在本地入口内完整闭环

**Identifier:** DWUI-001

本需求中的本机授权、CLI 实例/凭证、Switch Core 及默认 Core 偏好条款适用于独立 piwork-cli desktop 模式。统一服务端工作台使用 DWUI-HOSTED-001 的服务器浏览器会话与固定所属 Core，不要求这些本机入口；两模式共同的业务反馈、恢复和身份隔离约束保持。

Desktop SHALL 展示当前 Core、用户身份、Core 可达性、运行环境及各能力状态，区分可达与可创建/可对话/可访问文件。用户 SHALL 可登录、查看身份、登出及切换 Core。复用凭证前 SHALL 验证所属 Core 和当前用户，错误不得展示其他身份的旧内容。无登录仍 SHALL 能检查本地 `.work`，但不取得任何 Core 内容。

确认的 Core 会话失效 SHALL 清除该平台身份派生的内容授权、关闭相关内容流并进入登录恢复页面；仍有效的浏览器本地控制会话 SHALL 保留用于重新登录，不要求重启 Desktop。普通网络失败保留最后已知状态与取得时间，不推断为登出。重新登录同一 Core/用户 SHALL 可查询已知 Operation，不能重发原提交。切换身份 SHALL 清空内容缓存和草稿，已知操作记录按 Core/用户隔离。登出在 Core 可达时 SHALL 撤销平台会话；不可达时仍立即撤销该平台身份的本地内容访问并说明未确认远端撤销，禁止显示远端撤销成功。

Desktop SHALL 分别表示浏览器本地授权、Core 用户会话与连接状态。本地授权缺失时不展示可提交的账号登录、注销、切换 Core、已知操作或 Inspect 控件，也不展示 CLI 保存的身份；提供 DWUI-014 的本地恢复入口。正常 Sign out 清除该 Desktop 当前平台登录，保持仍有效的本地控制会话，以便输入另一账号；其影响包括该实例中使用同一平台身份的其他已授权浏览器，不影响持有其他 Core 会话的客户端。

当前连接编辑及切换 SHALL 接受 CLI-CORE-PROTOCOL-001 定义的 HTTP(S) origin，不因目标非 loopback 拒绝 HTTP。默认 Core 配置的编辑、保存、读取及后续启动 SHALL 使用相同的协议准入。偏好仍为不含凭据的独立 v1 本地记录，保存/清除仅影响之后启动，不切换当前连接、不改凭证、不清理 Inspect，退出登录仍保留默认地址。

合法 HTTP 输入 SHALL 进入原动作的加载、等待、确认或失败状态，不显示“远程必须 HTTPS”的错误或增加确认流程。非法 origin SHALL 保留输入并就地说明格式错误，后端拒绝相应修改。保存响应丢失或提交后未确认 SHALL 沿原只读核对流程恢复，不自动重发。HTTP 与 HTTPS 的 origin 身份不同，切换时 SHALL 按原身份撤销/内容隔离规则处理。

#### Scenario: Core 可达但运行环境失败
- **WHEN** 健康接口正常而运行依赖不可用
- **THEN** 登录和可用控制信息仍可使用，创建/启动显示真实限制，不把连接状态写成全部 Ready

#### Scenario: 过期后重新登录
- **WHEN** 用户在观察已接受的 Import 时会话过期，随后重新登录同一账号
- **THEN** 内容访问中止后恢复原 Operation 查询，Import 不被再次提交

#### Scenario: 切换 Core 或用户
- **WHEN** 用户从 Core A/用户 A 切换到 Core B 或用户 B
- **THEN** A 的 token、文件内容、对话和活动不被发送给或展示为 B 的内容

#### Scenario: 本地授权有效而 Core 会话过期
- **WHEN** Core 明确拒绝当前会话，但浏览器本地控制会话仍有效
- **THEN** 显示可提交的账号登录表单，旧内容和派生连接被撤销，重新登录不需要新启动链接或重启 CLI

#### Scenario: 本地未授权不能伪装成账号登录
- **WHEN** 浏览器没有可用本地授权，或账号动作被本地授权校验拒绝
- **THEN** 显示本地授权恢复页，无法提交的账号菜单与表单不出现；明确原因和可执行恢复动作，不能把错误描述为密码错误

#### Scenario: 登录页面连接远程 HTTP Core
- **WHEN** 本地授权有效且用户将当前 Core 切换为合法远程 HTTP origin
- **THEN** 输入不被协议限制拒绝，界面显示切换等待与实际连接结果，可在 Core 可达时登录；不可达时提供连接恢复而不伪造已登录

#### Scenario: HTTP 默认地址保存并用于重启
- **WHEN** 用户将 HTTP Core B 保存为默认地址，当前连接为 A，随后关闭 CLI 并在没有参数/环境覆盖时重启
- **THEN** 保存时当前仍为 A，读回显示 B；新实例使用 B，依原 origin 规则判断登录状态，普通业务 CLI 的地址优先级不变

#### Scenario: 读取已有 HTTP 偏好及清除
- **WHEN** 安全的 v1 偏好记录含合法 HTTP origin，或用户显式恢复自动选择
- **THEN** HTTP 记录可正常读取且无需迁移；清除后显示未设置，当前连接及 Inspect 保持，后续启动按原回退规则选择

#### Scenario: 从 HTTPS 切换到同地址的 HTTP
- **WHEN** 用户已有 HTTPS Core 登录，显式切换为同 host/port 的 HTTP Core
- **THEN** 旧身份的 token、内容流、缓存及草稿按原切换规则隔离，不借用旧 token；新 origin 只有真实认证成功后才成为已登录

#### Scenario: 协议扩展不放宽本地授权
- **WHEN** 无本地会话、错误 Host/Origin 或缺失/错误 CSRF 的请求尝试切换或保存 HTTP Core
- **THEN** 在修改连接或本地文件前按原 401/403/容量契约拒绝，不因 HTTP 地址放行

#### Scenario: HTTP 输入的失败与未知结果
- **WHEN** 输入非法 origin，或合法 HTTP 默认地址遇到锁冲突、存储失败、响应丢失
- **THEN** 分别显示格式/明确失败/未确认结果，保留输入和最后确认值；只有原对象只读核对才能解除未知结果保护，不自动再保存

### Requirement: 本地授权初始化与恢复形成闭环

**Identifier:** DWUI-014

本需求中的本机授权、CLI 实例/凭证、Switch Core 及默认 Core 偏好条款适用于独立 piwork-cli desktop 模式。统一服务端工作台使用 DWUI-HOSTED-001 的服务器浏览器会话与固定所属 Core，不要求这些本机入口；两模式共同的业务反馈、恢复和身份隔离约束保持。

Desktop SHALL 在初始化期间立即显示中性的工作区外壳、Opening workspace… 与可访问的等待状态，并核验已有浏览器本地会话；核验未完成前不得展示私有 Work 内容、保存的 Core 身份或可执行的账号表单；已有会话有效时使用真实的会话/CSRF，忽略失效或已使用的启动 ticket，不再次兑换、不清理有效登录。无有效会话时才能兑换本次启动 ticket，并在提交前移除地址栏中的票据；兑换后以实际会话核验结果进入账号登录或 Works。不得持久保存票据、通过复制普通链接携带票据或仅凭成功兑换响应宣称账号已登录。

本地授权缺失、过期、票据失效和 Cookie 无法保留 SHALL 显示 Browser access required；说明本地浏览器尚未获准连接 CLI，提供 Check browser access、Copy reopen command 和当前端口的 `piwork-cli desktop open --port <port> --no-open`。还 SHALL 说明 `piwork-cli desktop logout --port <port>` 可以从同一系统用户的终端清理该实例平台登录。恢复页不指示在已占用端口直接再启动 Desktop。CLI 确认不可达时显示 Desktop connection unavailable、只读重试及启动方向，区别于 Core 不可达。

初始化/手动检查的 GET SHALL 去重，检查结果有归属和确认反馈；初始化失败仍允许显式检查，不能依赖未启动的后台定时器恢复。本地 CSRF 拒绝后 SHALL 先只读核验当前会话：本地会话有效则更新 CSRF 并允许用户明确重新提交，不能自动重发原 mutation；无有效会话才转本地授权恢复。兑换响应丢失时先检查 Cookie/会话，不自动重放 ticket；有效票据兑换后 Cookie 未保存时显示具体恢复说明，不无限重试。

初始化成功 SHALL 以真实登录页面或 Works 内容自然承接，不保留浏览器检查成功条。初始化超过十秒仍未确认时 SHALL 在原等待区说明仍在验证连接，不制造进度百分比或无限遮挡返回/恢复。初始化失败 SHALL 转入下述明确的授权或连接恢复状态；普通进入与用户显式 Check browser access 的确认反馈 SHALL 分开。

#### Scenario: 旧链接与有效 Cookie 同时存在
- **WHEN** 已授权浏览器再次打开含已使用、过期或上次进程 ticket 的链接
- **THEN** 使用本次进程确认有效的本地会话，正常进入账号登录或 Works，旧 ticket 被移出地址栏，没有 bootstrap 重放

#### Scenario: 延迟打开或另一浏览器重放启动链接
- **WHEN** 无有效 Cookie 的浏览器打开过期或已被另一浏览器使用的启动链接
- **THEN** 显示 Browser access required 和当前端口的重新打开命令，没有失效登录表单，不获得保存的 Core 身份

#### Scenario: CLI 重启或浏览器 Cookie 被清除
- **WHEN** 原授权失效但本地 CLI 已运行，用户执行重新打开命令并使用新链接
- **THEN** 新授权可进入账号登录或已保存会话对应的 Works，无需重启 Core/Work，旧授权仍不可使用

#### Scenario: 检查与兑换响应不确定
- **WHEN** 会话查询暂时失败、兑换响应丢失，或浏览器没有保存 Cookie
- **THEN** 分别提供只读检查、按实际 Cookie 核验或 Cookie 无法保留的说明；不自动重放登录或票据，不虚构授权/登录成功，检查入口仍可用

#### Scenario: CSRF 拒绝与晚到的检查结果
- **WHEN** 平台修改被本地 CSRF 校验拒绝，或旧检查在身份/页面变化后返回
- **THEN** 只读核验可恢复有效会话的提交能力但不重发修改，旧结果不覆盖新身份、草稿或释放新锁

### Requirement: 注销平台身份与重置浏览器访问有明确影响

**Identifier:** DWUI-015

本需求中的本机授权、CLI 实例/凭证、Switch Core 及默认 Core 偏好条款适用于独立 piwork-cli desktop 模式。统一服务端工作台使用 DWUI-HOSTED-001 的服务器浏览器会话与固定所属 Core，不要求这些本机入口；两模式共同的业务反馈、恢复和身份隔离约束保持。

已获本地授权的 Desktop SHALL 分开提供 Sign out 和经影响确认的 Reset browser access。Sign out 清理该实例当前 Core 登录及其内容授权，保留本地控制会话，显示平台注销是否已确认；Reset browser access 结束该实例全部浏览器本地会话、派生 Service/文件/观察访问和本地敏感缓存，但不撤销或删除保存的 Core 会话，随后进入 Browser access required。二者均不得停止 Work、Service 或取消已接受的 Run/Operation。

Reset browser access 的确认 SHALL 明确影响该 Desktop 的所有已授权浏览器，取消无修改。确认成功后清除本地会话 Cookie、内容、草稿和相关临时资源；其他浏览器在受保护请求或会话检查时获知失效，活动内容流至多两秒断开。已经发送的文件修改可能已提交，界面不得声称回滚；已经接受的 Import/Export/Run 保持服务端执行。清理不得删除其他 CLI 新写入的 Core 凭证或 Work 数据。

本地授权已丢失时不提供必然被拒绝的 Sign out/Reset 提交按钮，提供可信终端命令说明；执行实例 logout 后重新授权 SHALL 进入正常账号登录。清理中显示实际等待状态、阻止重复提交，失败/未知分别提供检查或重新打开方向，不自动重发。

实例报告保存凭证清理未完成时 SHALL 区分内存身份已清理与磁盘未清理，显示可执行的实例 logout 命令；新登录或切换被拒绝时保留非敏感输入，不宣称已退出后下次启动会保持退出。

#### Scenario: 正常注销后再次登录
- **WHEN** 已授权用户 Sign out，随后输入另一账号
- **THEN** 原平台身份和内容访问被撤销，本地控制会话仍可登录；旧浏览器内容不能显示为新账号，Work 运行目标不变

#### Scenario: 重置浏览器访问并重新打开
- **WHEN** 用户确认 Reset browser access，随后用新启动链接重新打开
- **THEN** 全部旧浏览器会话和派生连接失效，重新授权仍按 Core 的真实保存会话判断登录状态，不伪装为远端注销

#### Scenario: 未授权时从终端清理登录
- **WHEN** 浏览器本地授权丢失，同一系统用户执行该实例 logout，再执行 open
- **THEN** 可进入可提交的账号登录表单，显示本地清理与远端撤销的分别结果，不要求手工删除配置文件

#### Scenario: 清理并发与敏感内容保留边界
- **WHEN** 清理过程中其他 CLI 保存新凭证，或旧响应在新登录后返回
- **THEN** 新凭证不被条件清理删除，旧内容/反馈不进入新账号；本地暂存清理不删除已接受业务结果或 Work 数据

### Requirement: 本机 Desktop 的启动、授权和使用边界

**Identifier:** DWEB-USAGE-001

本需求中的本机授权、CLI 实例/凭证、Switch Core 及默认 Core 偏好条款适用于独立 piwork-cli desktop 模式。统一服务端工作台使用 DWUI-HOSTED-001 的服务器浏览器会话与固定所属 Core，不要求这些本机入口；两模式共同的业务反馈、恢复和身份隔离约束保持。

Desktop SHALL 由前台 CLI 提供 127.0.0.1:17891 的本机浏览器入口，可显式 port/no-open；端口占用不自动更换，help 不读取状态或连 Core。启动票据一次显示、五分钟且使用后从地址移除，浏览器使用 HttpOnly 本地会话，平台 token 不交给网页。Copy local link 仅当前电脑且需 CLI/会话持续有效；.work domain 不是同一 URL，外部 DAV 使用 proxy 的随机 Basic 密码。

Service 预览/独立页 SHALL 仅路由声明 HTTP/ws 端口，隔离各应用本机 origin，保留 CSP/X-Frame-Options、应用认证、SSE/WebSocket，不改响应正文或自动批准跨 Service 跳转。嵌入拒绝提供独立页回退；平台身份不交应用。Focus/Full screen、Chat、草稿、阅读位置及 iframe 沿有效 browser-service-access/desktop-ui-language 保持，不以换布局重建业务视图。

关闭浏览器或退出本机入口 SHALL 不停止 Work 或重发写入；平台过期确认后登录并按原 ID 恢复。导入仅浏览器选取/Inspect 不登录执行，真正 Import 需授权且保持 stopped；下载开始不等于落盘。图像粘贴/拖拽/选择、限额及模型能力遵循本规范的 DWUI-IMAGE-001 至 DWUI-IMAGE-003 与 agent-conversation，About 版本日志遵循 product-release-info；技术身份按需展开，错误和恢复保持可见。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```sh
piwork-cli desktop
piwork-cli desktop --no-open
piwork-cli desktop --port 18001 --no-open
piwork-cli --core https://core.example.com desktop
```

### Requirement: 在连接配置中管理下次启动使用的默认 Core

**Identifier:** DWUI-DEFAULT-CORE-001

本需求中的本机授权、CLI 实例/凭证、Switch Core 及默认 Core 偏好条款适用于独立 piwork-cli desktop 模式。统一服务端工作台使用 DWUI-HOSTED-001 的服务器浏览器会话与固定所属 Core，不要求这些本机入口；两模式共同的业务反馈、恢复和身份隔离约束保持。

Desktop SHALL 在登录/连接页面和切换 Core 的配置入口提供默认 Core 的读取、保存及恢复自动选择操作；仅有有效本地浏览器授权即可使用，不要求 Core 可达或账号已登录。界面 SHALL 区分当前连接的 Core、编辑中的地址和已保存的默认 Core，并说明参数/环境覆盖及保存仅影响之后的启动。

用户显式保存 SHALL 校验 HTTP(S) origin，拒绝 userinfo、非根路径、query、fragment；合法 HTTP 与 HTTPS origin 均可保存，协议准入遵守 `allow-http-core-connections` 的 CLI-CORE-PROTOCOL-001，按现有 Core origin 规范保存。偏好 SHALL 不包含密码、token、账号身份或一次性票据。恢复自动选择 SHALL 清除该偏好，使下次启动按参数、环境、凭证和默认地址选择。正常退出、CLI/Desktop logout、账号会话失效和切换账号 SHALL 不删除此偏好。

保存或清除偏好 SHALL 不切换当前 Core、不清理当前身份/内容/Inspect、不重载应用、不提交 Core 请求，也不修改共享登录凭证。连接、切换 Core 和登录仍由原有显式操作完成，不自动保存；同 Core 的匿名 Inspect 在首次登录时 SHALL 继续遵守既有保留规则。既有 `desktop open` SHALL 不重读偏好或切换运行中的实例。

#### Scenario: 首次离线配置
- **WHEN** 用户首次进入已本地授权的 Desktop，Core 不可达且默认配置不存在
- **THEN** 展示当前地址、未设置默认值及可用的保存入口；保存合法地址后不要求先登录，下一次无覆盖启动使用该地址

#### Scenario: 保存不同于当前连接的地址
- **WHEN** 当前连接 Core A，用户输入 B 并保存为默认值
- **THEN** 默认值更新为 B，当前仍连接 A，账号、页面草稿、Service 和已完成 Inspect 保持；需显式切换才连接 B

#### Scenario: 临时覆盖和退出登录
- **WHEN** 通过 `--core A` 覆盖默认 B 启动，随后登录或退出登录
- **THEN** 默认 B 不被自动覆盖或删除，页面如实区分本次连接与下次启动配置

#### Scenario: 清除默认值
- **WHEN** 用户选择恢复自动选择并成功清除偏好
- **THEN** 显示未设置默认值，当前连接不变；下一次启动使用既有参数、环境、凭证和默认地址规则

#### Scenario: 登录和 Inspect 不受保存动作干扰
- **WHEN** 匿名用户完成本地 Inspect，保存默认地址后在同一当前 Core 首次登录
- **THEN** 保存不清理 Inspect，登录仍保留可继续使用的既有结果；偏好文件没有凭据，登录本身不隐式保存偏好

### Requirement: 默认 Core 配置读写有明确反馈和本地安全边界

**Identifier:** DWUI-DEFAULT-CORE-002

本需求中的本机授权、CLI 实例/凭证、Switch Core 及默认 Core 偏好条款适用于独立 piwork-cli desktop 模式。统一服务端工作台使用 DWUI-HOSTED-001 的服务器浏览器会话与固定所属 Core，不要求这些本机入口；两模式共同的业务反馈、恢复和身份隔离约束保持。

默认配置 SHALL 作为当前系统用户的独立、受保护、版本化本地状态保存；相同配置位置的多个 Desktop 实例共享该偏好，不同系统用户相互隔离。完整提交 SHALL 原子发布，并发修改 SHALL 序列化，最终值为最后成功提交的值；读取不得观察到半个文件。配置大小上限 SHALL 为 64 KiB，未知版本、额外或重复字段、错误类型、非法地址及不安全目标 SHALL 被拒绝，原文件保持可供恢复。

配置入口 SHALL 首次加载时显示读取中，成功缺失才显示未设置，失败保留最后确认值和读取恢复入口，不把失败解释为空配置。保存/清除等待 SHALL 在所属配置控件内显示，阻止重复修改，不阻塞独立的登录、Inspect 或业务读取；慢响应持续显示尚未确认。成功只在确认完整提交后显示；普通成功反馈遵守既有短提示规则，晚返回不得覆盖更新的输入或其他页面。

非法输入 SHALL 就地提示并保留输入；锁冲突、权限、存储损坏或写入失败 SHALL 提供安全原因及可执行下一步，不覆盖旧配置或声称成功。写入响应丢失、或完整提交后的持久化确认失败 SHALL 显示结果未确认，暂时阻止再次修改并提供只读重新读取；读取确认实际值后解除保护，不自动重发修改。多个实例的后续读取 SHALL 获取已提交的新值，不承诺其他窗口即时推送更新。

读取和写入 SHALL 遵守原有精确 Host/Origin、本地会话和写入 CSRF 校验，不扩大到 Core 账号身份才能满足的接口。匿名、来源不匹配或 CSRF 不匹配的请求 SHALL 在读写本地配置前被拒绝；本地授权失效或被重置后 SHALL 进入原恢复流程，不通过账号登录或缓存绕过本地授权。仅配置格式损坏时，显式恢复自动选择可安全清除该配置；权限或目标安全校验失败不得强行删除。

#### Scenario: 加载、空态和读取失败
- **WHEN** 初次读取尚未结束、成功发现配置缺失，或已确认默认值后读取失败
- **THEN** 分别呈现读取中、未设置默认值、或最后确认值和重查入口，不以读取失败制造空态

#### Scenario: 校验和提交前失败
- **WHEN** 输入非法地址，或写入遇到锁冲突、权限失败、磁盘不足
- **THEN** 保留编辑值，显示所属配置错误，原值和凭证保持；未产生成功提示，明确拒绝后可由用户重试

#### Scenario: 修改结果未确认
- **WHEN** 保存或清除响应丢失，或提交后持久化确认失败
- **THEN** 显示未确认与重新读取入口，禁止自动重复写入；读取确认实际默认值或确实缺失后恢复编辑，输入未被晚响应覆盖

#### Scenario: 并发实例和半写入
- **WHEN** 同一系统用户的两个实例并发保存 A、B，或写入过程被打断
- **THEN** 成功提交按序形成完整值，读回为最后提交值；中断只留下原完整值或新完整值，不留下被当成合法配置的部分 JSON

#### Scenario: 无授权或跨源读写
- **WHEN** 未授权浏览器、Service origin、其他本机主机名或缺失 CSRF 的请求访问配置
- **THEN** 沿现有本地授权错误拒绝，不泄漏默认地址、不触碰磁盘、不改变当前身份

#### Scenario: 损坏配置的显式恢复
- **WHEN** 用户用参数覆盖格式损坏的偏好启动，读取显示损坏后选择恢复自动选择
- **THEN** 在目标安全校验通过后只清除偏好，再读确认为未设置；凭证、当前 Core 和 Inspect 保持，不能删除不安全目标

## ADDED Requirements

### Requirement: 统一服务端提供完整远程工作台

**Identifier:** DWUI-HOSTED-001

统一应用 SHALL 提供仅凭服务器 IP 即可在另一台电脑浏览器使用的完整工作台，不要求该电脑安装 CLI/Docker、设置代理/DNS/hosts 或使用本机启动票据。托管模式 SHALL 复用既有 Work、Service、Files、Chat、模型/Thinking/图片、设置、包、导入导出和原 ID 恢复能力；页面绑定所属 Core，不提供修改服务器实例所属 Core 或读取宿主 CLI 凭证的入口。

托管 Service SHALL 遵守 browser-service-access 的独立入口、服务端响应 Cookie 分区及首版脚本 Cookie 限制；Service 说明明确依赖 document.cookie/Cookie Store 的应用可能不可用，脚本自行写入 Cookie 不保证跨 Service 隔离。该已知限制不阻塞一键启动或其他工作台功能，不能由“完整工作台”推导为任意应用 Cookie 均兼容且隔离；CLI 本机 Service 模式保持原契约。

身份 SHALL 按独立浏览器会话解析，传输/暂存、缓存、已知操作及 Service 授权均绑定用户/会话。管理员只能以自己的用户身份访问 Work 内容；注销当前浏览器不清理其他独立登录，禁用/密码重置按 Core 撤销语义生效。托管 Inspect 使用已认证会话私有暂存，保持完整格式校验与不执行内容；独立 CLI 的匿名离线 Inspect 保留。

其他 DWUI 业务条款中的“本地/CLI 传输资源”在托管模式 SHALL 对应会话私有服务器资源，并保持原容量、流式进度、条件写入、取消、未知结果与清理语义；不得把上传换成服务器任意路径或绕过 Core。浏览器关闭、导航和断线不改变远端 Work/Run/Operation 生命周期。

#### Scenario: 远程完成完整工作流
- **WHEN** 用户从另一台电脑只用浏览器登录服务器 IP
- **THEN** 可以创建 Work、收到模型回复、访问受支持的独立 Service、使用 Files、修改配置并完成 Stop/Export/Inspect/Import/Start，Service 兼容限制明确可见，不出现客户端 localhost 或 desktop open 前置步骤

#### Scenario: 两账号并发使用
- **WHEN** 两个独立浏览器账号同时使用 Service、Chat、Files 和传输
- **THEN** 各自只获得自己的内容、临时资源和原 ID，另一账号的晚响应、退出和上传不能覆盖或清理当前身份

#### Scenario: 会话失效和未知修改恢复
- **WHEN** 原 Run/Operation 观察中断或托管会话被撤销，随后同账号重新登录
- **THEN** 旧内容连接失效，按原身份及 ID 核对，不自动重发 prompt、导入、包安装或文件修改

#### Scenario: 托管与本机客户端并存
- **WHEN** 同一 Core 同时被托管浏览器和原生 piwork-cli desktop 使用
- **THEN** 两种入口独立认证，CLI 凭证、偏好、本机 open/logout 和匿名 Inspect 不被服务器浏览器登录修改
