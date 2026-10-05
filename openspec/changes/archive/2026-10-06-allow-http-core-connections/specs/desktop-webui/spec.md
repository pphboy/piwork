# Spec Delta

## MODIFIED Requirements

### Requirement: 连接与用户会话在本地入口内完整闭环

**Identifier:** DWUI-001

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
