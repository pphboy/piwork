## ADDED Requirements

### Requirement: 管理员通过单一全局入口导出日志

**Identifier:** DWUI-LOG-001

DesktopUI SHALL 仅在当前有效管理员的账户菜单显示一个 `Export logs` 入口，作用域为当前 Core 的全局日志及该管理员自己的全部保留 Work 日志，不依赖当前选中 Work。普通用户不显示入口，直接调用后端仍由 Core 拒绝；管理员无 Work 或 Docker 未就绪时仍可尝试收集可用 Core 日志。

一次明确点击 SHALL 创建一个交付意图，依次展示 `Collecting logs`、`Creating archive`、`Download started`，中文含义为“收集日志 → 生成压缩包 → 下载”。接受后立即保留 exportId、cutoffTime 和服务端 scope，按真实状态展示来源数/已取得计数；缺少可靠百分比时不得伪造。Core 日志不可用、归档缺口、部分结果、整体失败和过期 SHALL 有可读原因与对应恢复操作。

ready 后同一有效页面交付意图 SHALL 最多自动发起一次原包下载，保留 `Download again`；只读恢复、重复观察、晚响应或重新登录不能重复自动下载。浏览器下载开始不表示本地保存完成。关闭进度面板或页面内导航不取消 Core 任务；刷新/重新登录后可按已知原 ID 查询并由用户显式下载，不自动创建新任务或恢复旧自动交付许可。创建响应未知时 SHALL 保留原提交键，只提供原结果核对或显式同键恢复，不能新键盲目重试。

GUI SHALL 独立完成排障日志的创建、观察、缺口反馈与 ZIP 下载，不要求用户运行命令；取得文件后由用户手工发送给可信维护者。本功能不包含远程上传接收端，不能把下载描述为自动上传或接收成功。

POST 接受响应已为 ready（包括原键恢复）时，DesktopUI SHALL 先按原 ID 查询完整详情，取得文件名、长度/hash、到期时间及缺口后再交付。该详情查询失败 SHALL 保留已知 ID 和原键进行只读恢复，不清空身份、不退回未知创建或自动另建任务；同一当前有效意图仍最多自动交付一次。

#### Scenario: 管理员与普通用户界面
- **WHEN** 两个浏览器分别以管理员和普通用户登录
- **THEN** 仅管理员账户菜单显示 Export logs，普通用户伪造请求也不能得到导出任务或内容

#### Scenario: 运行中一键导出
- **WHEN** 管理员在自己的 Work 运行期间点击 Export logs
- **THEN** 展示范围及真实收集/打包阶段，无停止确认、Stop 或 Apply 请求，ready 后最多发起一次下载

#### Scenario: 部分结果与下载重试
- **WHEN** 某些来源缺失但 Core 生成有效 ZIP，随后浏览器拦截或取消下载
- **THEN** 保留缺口摘要、原 exportId、大小及到期时间，Download again 下载原包而非重新打包

#### Scenario: 关闭、刷新和晚结果
- **WHEN** 关闭进度、切换 Work、刷新页面或旧身份的结果晚返回
- **THEN** 已接受 Core 任务不被取消；同身份当前意图最多交付一次，刷新后需显式下载，旧身份内容不进入新页面

#### Scenario: 创建响应丢失后恢复已完成任务
- **WHEN** 创建响应丢失，用户显式原键恢复时原任务已经 ready
- **THEN** UI 查询原 ID 详情后可下载，最多自动交付一次，Download again 取得同一 hash 的包；详情暂时失败只重查原 ID，不新建任务

#### Scenario: 故障 Work 的纯 GUI 排障交付
- **WHEN** 管理员自己的 Work 故障或 Docker 不可用，但 Core 和部分保留日志仍可读取
- **THEN** 管理员仅通过唯一 GUI 入口取得含可用日志和真实缺口的 ZIP，可手工发给维护者，无需运行命令，也不显示虚构上传状态

### Requirement: Desktop 通过同源后端转发日志任务与下载

**Identifier:** DWUI-LOG-002

托管 DesktopUI SHALL 经当前 UI origin 的 `/_desktop/api/log-exports`、`/_desktop/api/log-exports/<id>` 和 `/_desktop/api/log-exports/<id>/content` 调用 Core 对应 API；浏览器仅连接 UI 17891，后端固定连接 Core 17871。创建使用现有浏览器会话、来源与 CSRF 保护；后端使用当前会话的用户凭据转发，不读取宿主 CLI credential，不把 bearer 放入浏览器、URL 或内容链接。

独立 piwork-cli desktop SHALL 使用相同 DesktopUI 契约，由本机受保护 Desktop 后端连接选定 Core，保持独立 Desktop 地址选择和凭证规则。两种后端 SHALL 使用显式日志路由适配，校验 ID/请求结构并流式转发 ready ZIP，保留大小/hash/attachment/no-store 等必要元数据，不再收集或打包、不建立另一份完整 ZIP 暂存、不用现有 .work Inspect 代替日志包交付。

界面及适配 SHALL 绑定 Core、用户、会话和原 exportId；切换账号/Core、注销、降权或确认认证失效后撤销旧自动交付和活动流。只读查询/下载的网络错误不能伪装为重新收集或保存完成；Core 最终授权遵守 WACC-LOG-EXPORT-001。

#### Scenario: 远程浏览器只开放 UI 端口
- **WHEN** 管理员浏览器能访问服务器 17891，但不能直连 17871
- **THEN** 创建、进度查询和真实 ZIP 下载均完成，所有浏览器平台请求指向 UI origin，没有 Core token 或直连 Core 的重定向

#### Scenario: 独立 Desktop 连接远程 Core
- **WHEN** 管理员通过 piwork-cli desktop 选择远程 Core 后导出
- **THEN** 浏览器经本机 Desktop 后端取得同一 Core 任务和 ZIP，收集/打包/服务端清理由远端 Core 负责

#### Scenario: 缺少防伪证明或伪造上游
- **WHEN** 请求缺少有效 CSRF、来源不符，或尝试传入任意 Core URL/宿主路径/owner
- **THEN** 适配在转发 mutation 前拒绝，不用进程或 operator 身份弥补

#### Scenario: 下载期间身份撤销
- **WHEN** 管理员下载时被降权或注销，随后重新打开旧下载链接
- **THEN** 原流被有界终止，后续请求按当前身份拒绝，已缓存链接不能恢复旧内容许可
