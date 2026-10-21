# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: 本机 Desktop 的启动、授权和使用边界`
- TO: `### Requirement: 本机 Desktop 的普通地址启动和使用边界`

## REMOVED Requirements

### Requirement: 本地授权初始化与恢复形成闭环

**Reason:** 独立浏览器授权、ticket 兑换及其检查/重新授权恢复全部取消。

**Migration:** 由“普通入口初始化与登录恢复形成闭环”承接 DWUI-014；旧链接只按普通地址处理，原票据重放/兑换场景由普通会话恢复场景替代。

### Requirement: 注销平台身份与重置浏览器访问有明确影响

**Reason:** 移除独立 Reset browser access 功能及重新授权流程，正常 Sign out 继续提供。

**Migration:** 由“正常注销平台身份并保留直接登录入口”承接 DWUI-015；保留账号清理、并发凭据保护和内容访问撤销。

## ADDED Requirements

### Requirement: 普通入口初始化与登录恢复形成闭环

**Identifier:** DWUI-014

本需求中的 CLI 实例/共享凭证、Switch Core 及默认 Core 偏好条款适用于独立 piwork-cli desktop 模式；其普通浏览器会话自动建立，不构成独立 Access 门禁。统一服务端工作台使用 DWUI-HOSTED-001 的服务器浏览器会话与固定所属 Core，不读取 CLI 凭据；两模式共同的业务反馈、恢复和身份隔离约束保持。

Desktop SHALL 在初始化期间立即显示中性的工作区外壳、Opening workspace… 与可访问的等待状态，自动建立或恢复普通浏览器会话并读取真实 Core 登录状态。确认前不得展示未核验的私有内容或假造已登录；确认后直接显示可用的账号登录/连接页面或 Works。不得签发、兑换或校验 Desktop 入口 ticket，不得保留独立浏览器 Access 状态或仅把其标为恒定 authorized。

新浏览器、普通地址、刷新、清 Cookie、CLI 重启和浏览器会话到期 SHALL 使用同一初始化路径，不要求 `desktop open`、最新启动链接或终端授权。旧 `#ticket=` 链接 SHALL 移除或忽略该片段后按普通地址处理，不触发兑换、重放错误或额外页面。CLI/Core 共享登录继续按当前 Core 和保存凭据的真实状态判断；没有有效账号时显示正常 Sign in。

页面和账号菜单 MUST NOT 提供 Browser access required、Check browser access、Reset browser access、授权到期弹窗或复制重新授权命令。CLI 确认不可达时 SHALL 显示 Desktop connection unavailable、连接重试及必要的启动方向，区别于 Core 不可达；重试不是授权动作。浏览器不能保留普通会话 Cookie 时 SHALL 说明会话无法保存及可执行的浏览器设置/重试方向，不转成 Access 授权、不虚构登录成功或无限循环。

初始化/手动读取 SHALL 去重，检查结果有身份和视图归属；初始化失败仍允许显式读取重试，不能依赖未启动的后台定时器恢复。CSRF 拒绝后 SHALL 先只读更新普通会话与 CSRF，再允许用户明确重新提交，不能自动重发原 mutation。读取响应丢失时只读核对，账号登录是否成功以真实会话为准。身份/页面切换后的旧响应不得覆盖新身份、草稿或释放新锁。

初始化成功 SHALL 以真实登录页面或 Works 自然承接，不保留浏览器授权检查成功条。初始化超过十秒仍未确认时 SHALL 在原等待区说明仍在读取连接/会话，不制造进度百分比或无限遮挡恢复；普通网络失败保持为连接/读取错误，只有已确认 Core 登录失效才进入正常账号登录。

#### Scenario: 旧链接与有效 Cookie 同时存在
- **WHEN** 已有正常会话的浏览器打开含已使用、过期或上次进程 ticket 的旧链接
- **THEN** 忽略或移除片段，按真实登录状态进入账号登录或 Works，没有 ticket 兑换或授权恢复页

#### Scenario: 新浏览器与普通地址
- **WHEN** 没有 Cookie 的新浏览器直接打开 Desktop 普通地址，或另一浏览器打开旧启动链接
- **THEN** 自动建立普通会话，并使用正常共享凭据或账号登录流程；不要求任何一次性链接或终端动作

#### Scenario: CLI 重启或浏览器 Cookie 被清除
- **WHEN** CLI 已重新运行，或用户清 Cookie 后重新打开普通地址
- **THEN** 自动建立当前实例的普通会话，按原规则核验保存的同 Core 登录，进入工作区或正常登录，不需要新启动链接或重启 Core/Work

#### Scenario: 读取不确定或 Cookie 无法保存
- **WHEN** 会话读取暂时失败、响应丢失，或浏览器不能保留普通会话 Cookie
- **THEN** 分别提供只读重试、实际会话核对或 Cookie 设置说明；不自动重放登录/修改、不出现 Access 页面、不虚构成功

#### Scenario: CSRF 拒绝与晚到的读取结果
- **WHEN** 平台修改被 CSRF 校验拒绝，或旧读取在身份/页面变化后返回
- **THEN** 普通会话/CSRF 可自动恢复提交上下文但不重发修改，旧结果不覆盖新身份、草稿或释放新锁

#### Scenario: 注销和账号过期
- **WHEN** 用户 Sign out，或 Core 确认当前账号会话过期
- **THEN** 回到正常账号登录，继续可以登录或配置连接，旧内容访问被撤销，任何后续检查都不切回浏览器 Access

### Requirement: 正常注销平台身份并保留直接登录入口

**Identifier:** DWUI-015

本需求中的 CLI 实例/共享凭证、Switch Core 及默认 Core 偏好条款适用于独立 piwork-cli desktop 模式；其普通浏览器会话自动建立，不构成独立 Access 门禁。统一服务端工作台使用 DWUI-HOSTED-001 的服务器浏览器会话与固定所属 Core，不读取 CLI 凭据；两模式共同的业务反馈、恢复和身份隔离约束保持。

Desktop SHALL 提供 Sign out，清理该实例当前 Core 登录及其内容授权，显示平台注销是否已确认，并保留普通地址直接登录的能力。界面、API 和状态模型 MUST NOT 保留独立 Reset browser access 功能或其确认弹窗；没有账号登录时不要求先完成浏览器授权才能登录、Inspect 或配置连接。

正常注销 SHALL 撤销同一实例中使用该平台身份的 Service/文件/观察访问，清理所属敏感缓存、草稿和临时资源；其他浏览器在受保护请求或会话检查时获知身份失效，活动内容流至多两秒断开。已经发送的文件修改可能已提交，不得声称回滚；已经接受的 Import/Export/Run 保持服务端执行。注销或 CLI 退出均不得停止 Work、Service 或取消已接受的 Run/Operation，也不得删除其他 CLI 新写入的 Core 凭证或 Work 数据。

浏览器普通会话缺失时 SHALL 自动恢复提交上下文；Sign out 仍由用户明确触发，不自动重放。用户也可通过同一系统用户的实例 logout 命令清理平台登录，随后普通地址即可登录，无需重新授权。清理中显示实际等待状态并阻止重复提交，失败/未知分别提供原注销状态检查或明确恢复方向。

实例报告保存凭证清理未完成时 SHALL 区分内存身份已清理与磁盘未清理，显示可执行的实例 logout 命令；新登录或切换被拒绝时保留非敏感输入，不宣称已退出后下次启动会保持退出。

#### Scenario: 正常注销后再次登录
- **WHEN** 用户 Sign out，随后输入另一账号
- **THEN** 原平台身份和内容访问被撤销，可直接重新登录；旧浏览器内容不能显示为新账号，Work 运行目标不变

#### Scenario: 账号菜单不再包含浏览器重置
- **WHEN** 用户从普通登录页或工作区打开账号相关菜单
- **THEN** 没有 Reset browser access、其确认弹窗或重新授权提示，正常 Sign out 保留原有可用性和反馈

#### Scenario: 从终端清理登录
- **WHEN** 同一系统用户执行该实例 logout，随后从原普通地址重新打开页面
- **THEN** 可进入可提交的账号登录表单，显示本地清理与远端撤销的分别结果，不要求新链接或手工删除配置文件

#### Scenario: 清理并发与敏感内容保留边界
- **WHEN** 清理过程中其他 CLI 保存新凭证，或旧响应在新登录后返回
- **THEN** 新凭证不被条件清理删除，旧内容/反馈不进入新账号；本地暂存清理不删除已接受业务结果或 Work 数据

## MODIFIED Requirements

### Requirement: 连接与用户会话在本地入口内完整闭环

**Identifier:** DWUI-001

本需求中的 CLI 实例/共享凭证、Switch Core 及默认 Core 偏好条款适用于独立 piwork-cli desktop 模式；其普通浏览器会话自动建立，不构成独立 Access 门禁。统一服务端工作台使用 DWUI-HOSTED-001 的服务器浏览器会话与固定所属 Core，不读取 CLI 凭据；两模式共同的业务反馈、恢复和身份隔离约束保持。

Desktop SHALL 展示当前 Core、用户身份、Core 可达性、运行环境及各能力状态，区分可达与可创建/可对话/可访问文件。用户 SHALL 可登录、查看身份、登出及切换 Core。复用凭证前 SHALL 验证所属 Core 和当前用户，错误不得展示其他身份的旧内容。无登录仍 SHALL 能检查本地 `.work`，但不取得任何 Core 内容。

确认的 Core 会话失效 SHALL 清除该平台身份派生的内容授权、关闭相关内容流并进入登录恢复页面；仍有效的浏览器本地控制会话 SHALL 保留用于重新登录，不要求重启 Desktop。普通网络失败保留最后已知状态与取得时间，不推断为登出。重新登录同一 Core/用户 SHALL 可查询已知 Operation，不能重发原提交。切换身份 SHALL 清空内容缓存和草稿，已知操作记录按 Core/用户隔离。登出在 Core 可达时 SHALL 撤销平台会话；不可达时仍立即撤销该平台身份的本地内容访问并说明未确认远端撤销，禁止显示远端撤销成功。

Desktop SHALL 只以真实 Core 用户会话和连接状态决定账号界面，不提供独立浏览器 Access 状态。普通地址打开后自动建立必要的浏览器会话：可复用的同 Core CLI 凭据经正常核验后进入工作区，否则显示可提交的账号登录、连接配置和 Inspect，不要求特殊链接或额外授权。正常 Sign out 清除该 Desktop 当前平台登录，保留普通登录页面的可用性；其影响包括该实例中使用同一平台身份的其他浏览器，不影响持有其他 Core 会话的客户端。

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
- **WHEN** 普通浏览器会话仍有效而 Core 明确拒绝当前账号会话
- **THEN** 显示可提交的账号登录表单，旧内容和派生连接被撤销，重新登录不需要新启动链接或重启 CLI

#### Scenario: 本地未授权不能伪装成账号登录
- **WHEN** 新浏览器直接打开运行中 Desktop 的普通地址，或已有浏览器清除 Cookie 后刷新
- **THEN** 必要会话自动建立，必须核验真实同 Core 共享凭据后才能进入工作区，否则显示可提交的正常登录/连接页面；不以普通 Cookie 伪造 Core 登录，不出现 Access 页面或要求终端重新打开

#### Scenario: 登录页面连接远程 HTTP Core
- **WHEN** 用户在普通登录/连接页将当前 Core 切换为合法远程 HTTP origin
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
- **WHEN** 错误 Host/Origin 或缺失/错误 CSRF 的请求尝试切换或保存 HTTP Core
- **THEN** 在修改连接或本地文件前拒绝；合法页面可自动恢复普通会话后由用户显式重试，不因 HTTP 地址放行，也不要求浏览器 Access 授权

#### Scenario: HTTP 输入的失败与未知结果
- **WHEN** 输入非法 origin，或合法 HTTP 默认地址遇到锁冲突、存储失败、响应丢失
- **THEN** 分别显示格式/明确失败/未确认结果，保留输入和最后确认值；只有原对象只读核对才能解除未知结果保护，不自动再保存

### Requirement: 本机 Desktop 的普通地址启动和使用边界

**Identifier:** DWEB-USAGE-001

本需求中的 CLI 实例/共享凭证、Switch Core 及默认 Core 偏好条款适用于独立 piwork-cli desktop 模式；其普通浏览器会话自动建立，不构成独立 Access 门禁。统一服务端工作台使用 DWUI-HOSTED-001 的服务器浏览器会话与固定所属 Core，不读取 CLI 凭据；两模式共同的业务反馈、恢复和身份隔离约束保持。

Desktop SHALL 由前台 CLI 提供 127.0.0.1:17891 的本机浏览器入口，可显式 port/no-open；端口占用不自动更换，help 不读取状态或连 Core。启动与重新打开输出不含授权片段的普通地址；浏览器自动建立必要的 HttpOnly 会话，按共享凭据或正常账号登录继续，平台 token 不交给网页。Copy local link 仅当前电脑且需 CLI/会话持续有效；.work domain 不是同一 URL，外部 DAV 使用 proxy 的随机 Basic 密码。

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

本需求中的 CLI 实例/共享凭证、Switch Core 及默认 Core 偏好条款适用于独立 piwork-cli desktop 模式；其普通浏览器会话自动建立，不构成独立 Access 门禁。统一服务端工作台使用 DWUI-HOSTED-001 的服务器浏览器会话与固定所属 Core，不读取 CLI 凭据；两模式共同的业务反馈、恢复和身份隔离约束保持。

Desktop SHALL 在登录/连接页面和切换 Core 的配置入口提供默认 Core 的读取、保存及恢复自动选择操作；普通地址初始化后即可使用，不要求本地浏览器授权、Core 可达或账号已登录。界面 SHALL 区分当前连接的 Core、编辑中的地址和已保存的默认 Core，并说明参数/环境覆盖及保存仅影响之后的启动。

用户显式保存 SHALL 校验 HTTP(S) origin，拒绝 userinfo、非根路径、query、fragment；合法 HTTP 与 HTTPS origin 均可保存，协议准入遵守 `allow-http-core-connections` 的 CLI-CORE-PROTOCOL-001，按现有 Core origin 规范保存。偏好 SHALL 不包含密码、token、账号身份或一次性票据。恢复自动选择 SHALL 清除该偏好，使下次启动按参数、环境、凭证和默认地址选择。正常退出、CLI/Desktop logout、账号会话失效和切换账号 SHALL 不删除此偏好。

保存或清除偏好 SHALL 不切换当前 Core、不清理当前身份/内容/Inspect、不重载应用、不提交 Core 请求，也不修改共享登录凭证。连接、切换 Core 和登录仍由原有显式操作完成，不自动保存；同 Core 的匿名 Inspect 在首次登录时 SHALL 继续遵守既有保留规则。既有 `desktop open` SHALL 不重读偏好或切换运行中的实例。

#### Scenario: 首次离线配置
- **WHEN** 用户首次直接打开 Desktop 普通地址，Core 不可达且默认配置不存在
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

本需求中的 CLI 实例/共享凭证、Switch Core 及默认 Core 偏好条款适用于独立 piwork-cli desktop 模式；其普通浏览器会话自动建立，不构成独立 Access 门禁。统一服务端工作台使用 DWUI-HOSTED-001 的服务器浏览器会话与固定所属 Core，不读取 CLI 凭据；两模式共同的业务反馈、恢复和身份隔离约束保持。

默认配置 SHALL 作为当前系统用户的独立、受保护、版本化本地状态保存；相同配置位置的多个 Desktop 实例共享该偏好，不同系统用户相互隔离。完整提交 SHALL 原子发布，并发修改 SHALL 序列化，最终值为最后成功提交的值；读取不得观察到半个文件。配置大小上限 SHALL 为 64 KiB，未知版本、额外或重复字段、错误类型、非法地址及不安全目标 SHALL 被拒绝，原文件保持可供恢复。

配置入口 SHALL 首次加载时显示读取中，成功缺失才显示未设置，失败保留最后确认值和读取恢复入口，不把失败解释为空配置。保存/清除等待 SHALL 在所属配置控件内显示，阻止重复修改，不阻塞独立的登录、Inspect 或业务读取；慢响应持续显示尚未确认。成功只在确认完整提交后显示；普通成功反馈遵守既有短提示规则，晚返回不得覆盖更新的输入或其他页面。

非法输入 SHALL 就地提示并保留输入；锁冲突、权限、存储损坏或写入失败 SHALL 提供安全原因及可执行下一步，不覆盖旧配置或声称成功。写入响应丢失、或完整提交后的持久化确认失败 SHALL 显示结果未确认，暂时阻止再次修改并提供只读重新读取；读取确认实际值后解除保护，不自动重发修改。多个实例的后续读取 SHALL 获取已提交的新值，不承诺其他窗口即时推送更新。

读取和写入 SHALL 遵守原有精确 Host/Origin、自动建立的普通浏览器会话和写入 CSRF 校验，不要求 Core 账号登录或独立 Access 授权。来源不匹配、未持有效普通会话的配置请求或 CSRF 不匹配的修改 SHALL 在读写本地配置前被拒绝；普通页面会话缺失/过期时自动更新提交上下文，错误只显示连接、会话或 CSRF 恢复，不要求特殊链接或 Reset browser access。仅配置格式损坏时，显式恢复自动选择可安全清除该配置；权限或目标安全校验失败不得强行删除。

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
- **WHEN** Service origin、其他本机主机名、缺失普通会话的配置请求或缺失 CSRF 的修改访问配置
- **THEN** 拒绝对应请求，不泄漏默认地址、不触碰磁盘、不改变当前身份；合法普通页面可自动建立会话后使用配置，不出现 Access 门禁

#### Scenario: 损坏配置的显式恢复
- **WHEN** 用户用参数覆盖格式损坏的偏好启动，读取显示损坏后选择恢复自动选择
- **THEN** 在目标安全校验通过后只清除偏好，再读确认为未设置；凭证、当前 Core 和 Inspect 保持，不能删除不安全目标
