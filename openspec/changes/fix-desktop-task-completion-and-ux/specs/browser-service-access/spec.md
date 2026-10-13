# Spec Delta

## MODIFIED Requirements

### Requirement: 独立打开与不可嵌入回退保持真实边界

**Identifier:** BSA-005

`Open in new tab` SHALL 在用户动作中打开独立 Service 视图，正常模式保留 Work 身份、状态及 Back to Work，关闭不停止 Service 或 Run。嵌入被 CSP/X-Frame-Options 拒绝时 SHALL 保留这些响应策略，展示原因与直接新标签页打开应用的回退，不把空白 iframe 当成功。无法可靠判定加载结果时显示预览未确认和可操作回退，不伪称协议故障。

正常独立视图在资格丢失时 SHALL 显示对象/原因/返回；禁止嵌入的直接应用标签页保持应用自己的 UI，本地入口在下一次导航请求被拒绝时返回带 Work 身份与 Back to Work 的不可用页，活动连接仍按 BSA-002 撤销。不通过向任意应用注入脚本/导航栏承诺实时覆盖其已经渲染的画面。无默认入口时提供声明端口选择或明确无法预览，不猜测非 Web 服务成功。

Service 入口准备 SHALL 立即显示当前 Service/端口与准备状态；准备失败显示安全原因和显式重试，不能永久保持 Opening application。iframe 已创建但嵌入检查在有界等待后仍 unknown，SHALL 显示 Preview not confirmed 和重新检查/独立打开入口；不以 iframe load 事件单独宣称应用已正常加载。反馈更新 SHALL 保持同 Work/Service/port 的 iframe 和页面输入，不为显示加载而重建已就绪应用。

独立标签页和独立窗口 SHALL 保留用户手势打开机会；浏览器拦截时原 Work 显示允许弹窗或复制受保护本地链接的下一步，不关闭原菜单并静默结束。需要异步授权时显示准备目标，失败后原页面仍可重试，不能留下无说明的空白窗口。新窗口 SHALL 不保留可访问原 Desktop 的 opener，不以关闭 CSP、代理/PAC 配置或暴露 ticket 绕过失败。

当前所选 Work/Service/声明端口从 Starting 变为真实可访问时，若尚无有效入口且没有同目标在途准备，Desktop SHALL 自动开始一次去重入口准备；不要求切换页签或重选服务。没有实际准备/观察请求时不得永久显示 Opening application，失败或未确认必须提供对应显式恢复。旧身份、其他 Service/端口的晚结果不得替换当前入口。

仅状态观察暂时失败时 SHALL 保留同一已授权视口及祖先连接并显示未确认，不凭缓存刷新授权、不保证真实网络故障中的应用内数据。可信停止/删除/撤权仍按 BSA-002 撤销连接和能力，保留画面规则不能绕过 origin、gateway 或嵌入限制。

#### Scenario: 应用禁止嵌入
- **WHEN** 响应有禁止嵌入策略
- **THEN** 外壳说明无法嵌入并提供可用的直接打开，策略未被移除，原 Work 对话保留

#### Scenario: 独立窗口内 Work 停止
- **WHEN** 正常独立视图对应 Work 停止，或直接应用标签页在停止后重新导航
- **THEN** 分别立即更新外壳状态或返回不可用页，显示具体 Work 和返回入口，关闭窗口不发 Stop

#### Scenario: 入口准备失败与重试
- **WHEN** 入口准备请求失败或慢响应
- **THEN** 分别显示可解释失败及显式 Retry，或原 Service/端口的准备中；晚返回不替换另一 Service，重试仍走真实授权入口

#### Scenario: 嵌入检查未确认
- **WHEN** iframe 已创建但有界检查后 embed 仍 unknown
- **THEN** 显示 Preview not confirmed、Check preview 与独立打开，保留现有 iframe，不将 unknown 写成 blocked、Ready 或登录失败

#### Scenario: 浏览器拦截独立打开
- **WHEN** 用户点击新标签页或独立窗口，而浏览器未创建窗口
- **THEN** 原 Work 显示允许弹窗和 Copy local link 回退，复制链接不含凭据或 ticket；未发 Service 控制/停止请求

#### Scenario: 异步授权失败
- **WHEN** 用户手势已打开准备窗口，后续入口授权失败
- **THEN** 准备窗口显示安全失败说明或被关闭，原 Work 保留明确失败和重试入口，opener 不可访问 Desktop

#### Scenario: 所选服务从启动变为就绪
- **WHEN** 当前 Work 一直可用，所选 Service 从 Starting 变 Ready 且尚无入口
- **THEN** 自动去重准备原 Service/port 入口，成功后显示；不需重选，晚响应不能换对象，没有请求时不永久 Opening application

#### Scenario: 状态读取失败保留原应用
- **WHEN** 已显示应用时发生临时 Work/Service 状态读取错误
- **THEN** 保留同一视口并标明未确认及重查，未重载文档或扩大授权；之后真实停止/撤权按原边界处理
