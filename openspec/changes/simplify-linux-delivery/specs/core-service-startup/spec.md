## MODIFIED Requirements

### Requirement: 暴露安全的交付准备状态

**Identifier:** CORE-DOCKER-STATUS-001

`GET /control/status` SHALL 保留原 `state/ready/checks`，增加 `preparation={version:1,ready,components}`；components 固定为 `docker`、`agent`、`packageHelper`、`defaultContext`、`fileHelper`、`snapshotHelper`。每项 SHALL 包含 `state`、非负 `attempt`、`retryAfterSeconds` 与 `code`；state 为 `unconfigured|pending|preparing|ready|retrying|failed`，不适用的 delay/code 为 null，重试 delay 为非负秒数。此 `preparation.ready` 表示全部交付组件已准备，不等于基础 Work readiness；完整交付判定还要求基础 ready。Docker 持续不可用 SHALL 最多五秒使基础/交付就绪失效。

网页及既有状态 API SHALL 读取该快照，不再要求 piwork-serve status 命令；组件状态不得带镜像地址/ID、宿主路径、账号、key/token、operator credential、证书、registry 原始响应或堆栈。错误码限定为 `DOCKER_UNAVAILABLE`、`IMAGE_UNAVAILABLE`、`IMAGE_INCOMPATIBLE`、`CONTEXT_PREPARATION_FAILED`、`RUNTIME_UNCONFIGURED`、`SHUTTING_DOWN` 或 null。严格管理 API 的 `AdminStatus` 不增加字段，用户业务状态格式也不因 Docker 交付改变。

#### Scenario: 完整就绪与基础就绪不同
- **WHEN** Work 运行环境已 ready，但 file helper 尚在准备
- **THEN** 原 state/ready 可以反映基础可用，preparation.ready 为 false，fileHelper 为 preparing，状态不含拉取源或秘密

#### Scenario: 只查询状态而不修改系统
- **WHEN** 多个客户端在网络故障期间连续调用 status
- **THEN** 每次返回当前安全快照，不因读取发起重复拉取或把长期准备阻塞放到请求中

### Requirement: Go Core 的安装、数据与运维边界

**Identifier:** CST-OPS-001

piwork-core SHALL 使用三参数启动和网页业务初始化，遵守 NATIVE-001、CORE-DOCKER-INIT-001 和 web-onboarding；Linux 原生 CLI 独立连接，管理 UI 随 Core 内嵌，不交付独立 Console 或 operator 命令。

Core SHALL 使用本机 Docker Engine Unix API。安装保持 piwork-go-core/schema 1、目录 0700、私有文件 0600、固定 owner、拒绝链接及单实例锁；未知格式、无 marker 的非空目录和身份不一致必须在业务与 Docker 资源创建前拒绝，不自动转换或清空。完整备份须在 Core 停止后保存整个数据目录和受管 Docker 卷，不能仅复制 SQLite 主文件。

Engine 继续按非空 DOCKER_CONTEXT、DOCKER_HOST、Docker config currentContext、默认本机 Unix socket 的顺序选择，只接受本机 Unix endpoint；显式失败不切换 Engine。镜像已存在无需 registry 凭据，拉取使用静态凭据或匿名访问，不调用宿主 Docker CLI/credential helper。镜像身份、协议和能力均须验证，不能回退旧 helper。

health 与 ready SHALL 分离；保留可选成对 ADMIN 首次身份初始化，模型和镜像不读旧业务初始化 env，不新增环境变量或文件替代被删除的启动参数。operator 凭证生命周期和与用户凭据的隔离 SHALL 保留，不删除凭证文件/元数据、不改存储格式或强制重置用户登录。网页单用途委托不替代 operator，管理员和 Work 权限按原边界校验。

全局 Runtime 保存使用目标 Core 的固定发行引用，已有 Runtime/Work 捕获值保持；Work/default-Work 业务配置不因启动参数删除裁减。旧命令、env-file 解析及离线命令回退 SHALL 删除。

Core 正常退出 SHALL 停止本安装受管 Work 容器并保留 desired、数据和历史；重启协调原 journal/epoch/标签，未知创建和清理失败保留占用，不全局 prune。Service memoryBytes 的旧正数只作为历史兼容，应用 Service 不设有效内存限制/预留，投影明确 unlimited；CPU/数量和 Agent/helper 政策仍有效。旧受限 Service 由受管恢复替换并保留身份、固定镜像和 workspace。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

## ADDED Requirements

### Requirement: 通过网页和受保护 API 初始化首管理员

Core SHALL 允许空安装通过普通网页、受保护 operator bootstrap API 或成对可选 ADMIN 环境变量创建首管理员。网页和 env 语义遵守 web-onboarding 与 CORE-DOCKER-INIT-001，所有入口必须原子核验持久用户集合为空，不因管理员被禁用而重新开放，不生成默认账号密码或覆盖已有身份。

Core SHALL 保留 operator 凭证和网页单用途初始化委托的分离；网页不读取 operator 凭证，成功创建后仍须正常登录。旧 admin bootstrap 命令及离线初始化命令 SHALL 删除，不保留兼容入口。

#### Scenario: 网页初始化
- **WHEN** 空安装通过合法来源及 CSRF 提交账号密码
- **THEN** 原子创建管理员并关闭首次创建入口，无需重启 Core，随后正常登录

#### Scenario: operator API 初始化
- **WHEN** 有效 operator credential 对空安装调用 bootstrap API
- **THEN** 按原鉴权和原子性创建管理员，不输出密码或摘要；普通用户 token 不获此权限

#### Scenario: 重复与并发
- **WHEN** 已有用户时再次初始化，或多个允许入口并发初始化
- **THEN** 已有身份保持，并发最多一个成功，不因旧命令删除放宽授权

### Requirement: 通过在线管理配置全局 Runtime

Core SHALL 通过网页和受保护的在线管理 API 配置全局默认 Runtime，删除离线配置命令。全局 CoreRuntime 的 Agent 引用固定使用保存请求目标 Core 内嵌的发行引用，模型配置无需选择镜像；API 字段校验继续遵守 CADM-004 和 SERVE-RUNTIME-RELEASE-001。引用缺失或无效时安全拒绝，不提示手填。

全局配置 SHALL 仅作为之后新建 Work 的默认值；已有 Work 的独立配置、模型引用和运行实例不因全局修改而改变、重启或切换模型。读取、启动和升级如实保留已持久 Runtime；显式保存才采用当前发行引用，确认保存与后台准备/readiness 分别表达。

#### Scenario: 网页保存 Runtime
- **WHEN** 管理员提交合法模型、可选 endpoint 和 secret
- **THEN** Core 用自身发行引用保存，响应只有非敏感字段和 secret 可用性，准备在后台进行

#### Scenario: 仅更新新 Work 默认值
- **WHEN** 全局模型从 model-a 改为 model-b
- **THEN** 新 Work 使用新默认值，已有 Work 不隐式修改或重启

#### Scenario: 配置不完整
- **WHEN** 启动时缺少可用 Runtime 或依赖
- **THEN** 健康和网页引导可用，readiness 给出实际原因，Work 创建返回可操作错误

#### Scenario: 已有捕获引用
- **WHEN** 程序升级后仅启动或读取安装
- **THEN** 既有 Runtime/Work 引用保持，只有明确重新保存更新全局默认

### Requirement: 以三项配置启动持久 Core 应用

`piwork-core` SHALL 无子命令启动一个持久 Core 与独立 ControlPlane HTTP 服务，只接受 --ui-port、--core-port、--data-dir 三项运行配置；--help/-h 和 --version 是无数据/网络副作用的信息查询。UI/Core 默认端口为 17891/17871，默认目录为 Linux 用户配置目录下 piwork/server，显式相对路径按启动工作目录解析。端口必须为 1..65535 十进制整数，不能相同或等于内部 RPC 7172。重复、未知、空值、非法参数及额外位置参数 SHALL 在副作用前以 usage exit 2 拒绝，不回显秘密。

UI 和 Core SHALL 分别绑定 0.0.0.0 上的所选端口并使用 HTTP；后端固定通过 127.0.0.1 的 Core HTTP 地址调用。浏览器只使用 UI，外部用户客户端和 operator API 直接使用 Core 端口。系统不提供 HTTPS listener、证书/public-origin 配置、旧 serve/管理子命令、旧监听参数或对应兼容开关。内部 Agent RPC 保留 7172 和容器可达地址及原 mTLS 身份，不增加第四个运行参数。

系统 SHALL 支持通过 loopback、localhost、本机主机名和服务器实际 IPv4 使用 UI。每次请求的 Host 必须属于服务器核验的本机名称/IP 且端口正确；Origin 必须匹配该请求的 HTTP origin，变更仍需 CSRF，拒绝跨站来源及未知 Host。会话绑定其 origin；生成链接、Service 和事件/升级连接沿用当前已验证入口，不信任任意 Forwarded 头，不把浏览器 Host 当作 Core 上游。输出实际地址，不输出 0.0.0.0 作为访问 URL。浏览器打开器不可用不得使启动失败。

空安装和 runtime/Docker 不可用 SHALL 仍提供健康和初始化页面，不创建默认 Work、不伪造 ready。已配置安装完成验证及恢复后报告真实 readiness。UI/Core/RPC listener、存储锁及后台恢复 SHALL 有统一生命周期；冲突、部分启动失败或必需监听异常结束触发有界清理，非零退出且无半启动服务，不换端口或接管其他实例。正常退出遵守本安装 Work 停止及持久意图保留规则。

#### Scenario: 默认与自定义启动
- **WHEN** Linux 用户直接启动 piwork-core，或提供三项合法配置
- **THEN** 同一进程在对应端口提供 UI/Core HTTP，空安装可进入网页引导，默认无需业务 env 或 CLI 初始化

#### Scenario: 无效和旧参数
- **WHEN** 传入 serve、login、admin、--listen、--core-listen、TLS、public-origin、helper/RPC 参数、重复参数或非法端口
- **THEN** exit 2 且不创建目录、监听、凭证或 Docker 资源，不静默忽略或转发

#### Scenario: 多网卡与外部 CLI
- **WHEN** 浏览器分别使用服务器两个实际 IPv4，外部 Linux CLI 使用 Core 端口
- **THEN** 各 UI origin 都能正常初始化/登录/使用 Service，CLI 按用户身份直连 Core，不借浏览器 Cookie

#### Scenario: 伪造来源
- **WHEN** 请求包含未知 Host、错误端口、跨站 Origin 或伪造 Forwarded 上游
- **THEN** 来源校验拒绝，不能建立授权会话或修改状态，后端 Core 目标不变

#### Scenario: 端口或目录冲突
- **WHEN** 任一 HTTP/RPC 端口被占用，或另一实例持有相同数据目录
- **THEN** 本次进程非零退出并释放已取得资源，原占用者和安装不变，无可写半实例

#### Scenario: 帮助与版本
- **WHEN** 在不存在的数据目录和无 Docker 环境请求帮助或版本
- **THEN** 返回正确帮助或 piwork-core 真实构建身份，不创建状态、不打开浏览器、不联网

#### Scenario: 恢复与正常关闭
- **WHEN** 配置完整安装启动，随后正常终止
- **THEN** 按原日志和所有权恢复 Work，退出停止本安装受管容器并保留持久意图、配置、历史与数据

## REMOVED Requirements

### Requirement: Bootstrap the first administrator explicitly

**Reason**: 本变更删除旧命令、独立交付或非 Linux 路径；旧条款的相关正向场景不再成立，完整替换为“通过网页和受保护 API 初始化首管理员”，保留其中有效的业务和权限约束。
**Migration**: 按新条款使用两个 Linux 程序、Core 内嵌 UI 与既有管理 API；不保留旧语法、平台或容器兼容入口。

### Requirement: Configure a usable local runtime profile

**Reason**: 本变更删除旧命令、独立交付或非 Linux 路径；旧条款的相关正向场景不再成立，完整替换为“通过在线管理配置全局 Runtime”，保留其中有效的业务和权限约束。
**Migration**: 按新条款使用两个 Linux 程序、Core 内嵌 UI 与既有管理 API；不保留旧语法、平台或容器兼容入口。

### Requirement: Start one durable Core application

**Reason**: 本变更删除旧命令、独立交付或非 Linux 路径；旧条款的相关正向场景不再成立，完整替换为“以三项配置启动持久 Core 应用”，保留其中有效的业务和权限约束。
**Migration**: 按新条款使用两个 Linux 程序、Core 内嵌 UI 与既有管理 API；不保留旧语法、平台或容器兼容入口。
