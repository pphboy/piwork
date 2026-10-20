# Spec Delta

## MODIFIED Requirements

### Requirement: 随原生程序提供既有浏览器界面

**Identifier:** NATIVE-003

统一服务端 SHALL 内嵌管理界面、工作台、引导及其全部资源，并携带同版非敏感 Agent/helper 默认引用；Agent 引用 SHALL 与本二进制的发行元数据绑定，是程序默认值，不依赖用户手填、镜像选择或高级覆盖。从任意工作目录运行不要求旁置 WebUI、发行配置文件或源码。复用页面 SHALL 满足既有 desktop-ui-language/ui-language、任务反馈与组件选型约束，不以整合为由裁减 Work、Chat、Files、Service、配置、包和迁移能力。

托管页面 SHALL 按浏览器会话隔离用户，Service 独立来源、服务端响应 Cookie 分区及首版脚本 Cookie 限制遵守 browser-service-access；完整工作台不代表任意网页应用的 Cookie 透明兼容。管理区和工作台共用应用入口，页面关闭不影响 Core。独立 piwork-cli desktop SHALL 继续内嵌自己的资源，普通地址自动建立浏览器会话，按共享 CLI 凭据或正常账号登录继续；遵守 desktop-webui 取消 Access 门禁后的初始化、注销和恢复契约，Service origin 隔离及连接恢复保持。平台凭据不得交给页面或 Service。

#### Scenario: 从任意工作目录打开 Desktop
- **WHEN** 在无源码/静态目录的位置启动统一程序
- **THEN** 登录、管理、引导和工作台资源全部可加载，无需独立 Console 或前端开发服务器

#### Scenario: Agent 默认值随发行交付
- **WHEN** 原生二进制或统一 Docker 镜像从空安装创建 CoreRuntime
- **THEN** 保存后的 Agent 引用与该制品内嵌的同版发行元数据一致；无旁置引用文件、Agent 启动覆盖参数或网页镜像输入步骤

#### Scenario: CLI 本机模式继续可用
- **WHEN** 用户从任意目录运行原生 piwork-cli desktop
- **THEN** 本机普通地址可直接登录/复用有效共享凭据，资源及已配置 Core 的 Work/Service/Files/Chat/Settings 继续可用，恢复不要求启动授权链接

#### Scenario: Console 独立退出
- **WHEN** 管理员关闭浏览器管理页面
- **THEN** Core、Work 和已接受 Operation 继续，只有显式停止统一进程才执行 Core 关闭流程

#### Scenario: 无代理配置访问 Service
- **WHEN** 用户在桌面 Chrome 或 Edge 中登录 Desktop，预览服务并打开独立应用标签页
- **THEN** 浏览器无须配置 proxy/PAC/hosts 即可交互，受支持应用的认证、SSE、WebSocket 和受限嵌入回退可用；托管 IP 模式按 browser-service-access 明确脚本 Cookie 限制，CLI 本机模式保持原行为
