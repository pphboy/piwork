# Spec Delta

## MODIFIED Requirements

### Requirement: About 入口在对应应用内可发现且保持读取边界

**Identifier:** PREL-002

Desktop SHALL 在普通地址打开后的登录页和工作区提供英文 `About Piwork` 入口，未登录 Core 或 Core 不可达时仍可读取本机 Desktop 版本和内置日志。必要的普通浏览器会话自动建立，不要求浏览器 Access、启动链接或授权检查；远端身份按真实 Core 登录读取，不能由 About 伪造登录或泄漏平台凭据。

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
