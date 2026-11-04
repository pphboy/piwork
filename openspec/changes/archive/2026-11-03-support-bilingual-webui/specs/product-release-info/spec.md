# Spec Delta

## MODIFIED Requirements

### Requirement: About 入口在对应应用内可发现且保持读取边界

**Identifier:** PREL-002

Desktop SHALL 在普通地址打开后的登录页和工作区提供与所选界面语言对应的 `About Piwork` 入口，未登录 Core 或 Core 不可达时仍可读取本机 Desktop 版本和内置日志。必要的普通浏览器会话自动建立，不要求浏览器 Access、启动链接或授权检查；远端身份按真实 Core 登录读取，不能由 About 伪造登录或泄漏平台凭据。

Console SHALL 在管理员会话内提供 `About Piwork`，显示其连接的 Core 信息；该入口 SHALL 遵循既有管理员会话、失效和恢复规则，不读取 Core 数据目录或 operator 凭证。两端 About SHALL 支持键盘打开、关闭/返回、可见焦点和 360px 窄屏；打开 About 不提交业务修改、不取消 Run/Operation，不清空草稿或重载当前 Service iframe。

#### Scenario: 本机 About 离线可读
- **WHEN** 用户直接打开普通地址但未登录 Core，或 Core 暂时不可达
- **THEN** 本机 Desktop 版本与自带日志可立即阅读，远端 Core 区域单独表示未登录、加载中或不可达

#### Scenario: Console 权限保持
- **WHEN** 未登录、普通用户或失效管理员会话访问 Console About
- **THEN** 按既有管理会话规则拒绝或进入登录恢复，不借此取得管理会话或他人 Work 内容

#### Scenario: 查看后返回原工作区
- **WHEN** 用户有未发送 Chat 草稿及 Service 内未保存输入，用键盘打开 About 后返回
- **THEN** 草稿、Session、Service iframe 和执行观察保持，焦点返回合理入口，没有新增 Run 或生命周期请求

### Requirement: 内置更新日志匹配当前组件版本

**Identifier:** PREL-003

Core 与 Desktop SHALL 随程序携带更新日志，并在 `About Piwork` 内通过所选界面语言的 `Release notes` 入口查看。日志 SHALL 标明对应版本及其适用组件，按功能变化、修复和必要的兼容说明面向用户表达，正文安全按文本或受限结构呈现，不执行 HTML/脚本或自动加载外部资源。

当前版本日志 SHALL 按精确运行版本匹配；开发版本、未知版本或没有匹配条目时 SHALL 明确显示当前版本未提供日志，不使用最近条目或最新版替代，不编造日期和变更。Desktop 与 Core 版本不同 SHALL 分别阅读各自日志。

界面 SHALL 提供完整 GitHub Releases 的固定 HTTPS 链接 `https://github.com/pphboy/piwork/releases`，只有用户明确点击才打开外部页面。阅读内置日志 SHALL 不依赖互联网，不进行后台更新检查、联网拉取最新日志或自动升级；Core 自带内容的取得仍需要与 Core 的正常授权连接。

#### Scenario: 无互联网阅读
- **WHEN** 用户无法访问互联网，但本机 Desktop 可用且 Core 可连接
- **THEN** 可以阅读两端随各自程序交付的日志；完整 Releases 链接保留且不阻塞应用内阅读

#### Scenario: 没有精确版本日志
- **WHEN** 运行版本为开发版本或内置目录没有该精确版本
- **THEN** 显示该版本日志未提供，运行版本仍可核对，不自动选取相近版本或生成虚构内容

#### Scenario: 不同组件与恶意正文
- **WHEN** 两端运行不同版本，或内置正文包含 HTML、脚本标记及长文本
- **THEN** 各自显示匹配日志，正文不执行标记、不发起资源请求，窄屏可完整阅读
