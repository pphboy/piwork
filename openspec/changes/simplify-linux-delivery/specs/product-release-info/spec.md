## MODIFIED Requirements

### Requirement: 产品信息来自各组件真实运行身份

**Identifier:** PREL-001

Core SHALL 以 piwork-core 为程序身份提供已认证用户可读的产品信息，包含信息接口版本、程序身份、运行版本、commit、修改状态、操作系统及架构，并与该 Core 可执行程序的版本命令保持一致。此读取 SHALL 独立于 Work runtime 就绪状态，不取得任何 Work 内容或 operator 权限。

Desktop SHALL 从本机承载 Desktop 的 CLI 获取本机版本，并分别查询当前连接的 Core 身份；Core 内嵌管理区 展示的 Core 版本 SHALL 来自其连接的 Core。界面不得以浏览器资源版本、Core 内嵌管理区 版本、发行标签或另一组件的版本推断 Core/Desktop 版本。版本、commit 未提供或处于开发状态时 SHALL 如实显示。

#### Scenario: 两端版本不同
- **WHEN** Desktop 与所连接的 Core 来自不同版本
- **THEN** 界面分别展示两端实际运行版本，不合成一个版本或默认二者相同

#### Scenario: Core 运行依赖尚未就绪
- **WHEN** 已认证用户连接 Core，但 Agent/helper 依赖尚未就绪
- **THEN** 仍可读取 Core 版本和自带更新日志，读取不触发依赖准备、Work 创建或运行

#### Scenario: 身份与版本命令一致
- **WHEN** 用户分别查看 Core/Desktop 的版本命令与 About 信息
- **THEN** 对应组件的版本、commit、修改状态、平台与架构一致，开发构建不被表达成未经确认的正式发行

#### Scenario: 新程序身份一致
- **WHEN** 核对 piwork-core --version、Core About 和本次发布清单
- **THEN** 都使用 piwork-core 身份及相同真实构建字段，不继续标成 piwork-serve；CLI 保持 piwork-cli 身份

## ADDED Requirements

### Requirement: Desktop 与内嵌管理区的 About 入口

**Identifier:** PREL-002

Desktop SHALL 在普通地址打开后的登录页和工作区提供英文 `About Piwork` 入口，未登录 Core 或 Core 不可达时仍可读取本机 Desktop 版本和内置日志。必要的普通浏览器会话自动建立，不要求浏览器 Access、启动链接或授权检查；远端身份按真实 Core 登录读取，不能由 About 伪造登录或泄漏平台凭据。

Core 内嵌管理区 SHALL 在管理员会话内提供 `About Piwork`，显示其连接的 Core 信息；该入口 SHALL 遵循既有管理员会话、失效和恢复规则，不读取 Core 数据目录或 operator 凭证。两端 About SHALL 支持键盘打开、关闭/返回、可见焦点和 360px 窄屏；打开 About 不提交业务修改、不取消 Run/Operation，不清空草稿或重载当前 Service iframe。

#### Scenario: 本机 About 离线可读
- **WHEN** 用户直接打开普通地址但未登录 Core，或 Core 暂时不可达
- **THEN** 本机 Desktop 版本与自带日志可立即阅读，远端 Core 区域单独表示未登录、加载中或不可达

#### Scenario: Core 内嵌管理区 权限保持
- **WHEN** 未登录、普通用户或失效管理员会话访问 Core 内嵌管理区 About
- **THEN** 按既有管理会话规则拒绝或进入登录恢复，不借此取得管理会话或他人 Work 内容

#### Scenario: 查看后返回原工作区
- **WHEN** 用户有未发送 Chat 草稿及 Service 内未保存输入，用键盘打开 About 后返回
- **THEN** 草稿、Session、Service iframe 和执行观察保持，焦点返回合理入口，没有新增 Run 或生命周期请求

## REMOVED Requirements

### Requirement: About 入口在对应应用内可发现且保持读取边界

**Reason**: 本变更删除旧命令、独立交付或非 Linux 路径；旧条款的相关正向场景不再成立，完整替换为“Desktop 与内嵌管理区的 About 入口”，保留其中有效的业务和权限约束。
**Migration**: 按新条款使用两个 Linux 程序、Core 内嵌 UI 与既有管理 API；不保留旧语法、平台或容器兼容入口。
