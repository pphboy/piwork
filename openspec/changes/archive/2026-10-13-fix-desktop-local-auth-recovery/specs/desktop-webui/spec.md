## MODIFIED Requirements

### Requirement: 连接与用户会话在本地入口内完整闭环

**Identifier:** DWUI-001

Desktop SHALL 展示当前 Core、用户身份、Core 可达性、运行环境及各能力状态，区分可达与可创建/可对话/可访问文件。用户 SHALL 可登录、查看身份、登出及切换 Core。复用凭证前 SHALL 验证所属 Core 和当前用户，错误不得展示其他身份的旧内容。无登录仍 SHALL 能检查本地 `.work`，但不取得任何 Core 内容。

确认的 Core 会话失效 SHALL 清除该平台身份派生的内容授权、关闭相关内容流并进入登录恢复页面；仍有效的浏览器本地控制会话 SHALL 保留用于重新登录，不要求重启 Desktop。普通网络失败保留最后已知状态与取得时间，不推断为登出。重新登录同一 Core/用户 SHALL 可查询已知 Operation，不能重发原提交。切换身份 SHALL 清空内容缓存和草稿，已知操作记录按 Core/用户隔离。登出在 Core 可达时 SHALL 撤销平台会话；不可达时仍立即撤销该平台身份的本地内容访问并说明未确认远端撤销，禁止显示远端撤销成功。

Desktop SHALL 分别表示浏览器本地授权、Core 用户会话与连接状态。本地授权缺失时不展示可提交的账号登录、注销、切换 Core、已知操作或 Inspect 控件，也不展示 CLI 保存的身份；提供 DWUI-014 的本地恢复入口。正常 Sign out 清除该 Desktop 当前平台登录，保持仍有效的本地控制会话，以便输入另一账号；其影响包括该实例中使用同一平台身份的其他已授权浏览器，不影响持有其他 Core 会话的客户端。

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

## ADDED Requirements

### Requirement: 本地授权初始化与恢复形成闭环

**Identifier:** DWUI-014

Desktop SHALL 在初始化期间显示 Checking browser access，并核验已有浏览器本地会话；已有会话有效时使用真实的会话/CSRF，忽略失效或已使用的启动 ticket，不再次兑换、不清理有效登录。无有效会话时才能兑换本次启动 ticket，并在提交前移除地址栏中的票据；兑换后以实际会话核验结果进入账号登录或 Works。不得持久保存票据、通过复制普通链接携带票据或仅凭成功兑换响应宣称账号已登录。

本地授权缺失、过期、票据失效和 Cookie 无法保留 SHALL 显示 Browser access required；说明本地浏览器尚未获准连接 CLI，提供 Check browser access、Copy reopen command 和当前端口的 `piwork-cli desktop open --port <port> --no-open`。还 SHALL 说明 `piwork-cli desktop logout --port <port>` 可以从同一系统用户的终端清理该实例平台登录。恢复页不指示在已占用端口直接再启动 Desktop。CLI 确认不可达时显示 Desktop connection unavailable、只读重试及启动方向，区别于 Core 不可达。

初始化/手动检查的 GET SHALL 去重，检查结果有归属和确认反馈；初始化失败仍允许显式检查，不能依赖未启动的后台定时器恢复。本地 CSRF 拒绝后 SHALL 先只读核验当前会话：本地会话有效则更新 CSRF 并允许用户明确重新提交，不能自动重发原 mutation；无有效会话才转本地授权恢复。兑换响应丢失时先检查 Cookie/会话，不自动重放 ticket；有效票据兑换后 Cookie 未保存时显示具体恢复说明，不无限重试。

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
