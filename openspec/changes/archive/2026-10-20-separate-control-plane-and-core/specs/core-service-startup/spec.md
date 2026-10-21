# Spec Delta

## MODIFIED Requirements

### Requirement: Start one durable Core application

统一服务端无参数或 `serve` SHALL 在同一个进程内启动持久 Core 和独立 ControlPlane HTTP 服务，在管理员和运行时配置缺失时仍打开健康 HTTP listener，初始化完成后再报告相应 readiness；配置存在时继续执行 Docker 验证和 Work recovery。它 MUST NOT 因缺少管理员或默认 runtime 而退出，也 MUST NOT 在启动过程中创建默认 Work。

网络必做验收 SHALL 在局域网或独立客户端网络验证通配监听加实际 IP 路径，不要求公网地址或公网连通性实测。多网卡/NAT/受信代理仍可显式配置 `--public-origin`；此高级覆盖不替代基础默认路径验收。IPv6 URL 括号、来源解析保留相应单元/契约覆盖，实际 IPv6 网络实测不作为本变更完成前提。

ControlPlane SHALL 默认监听 `0.0.0.0:17891`，Core SHALL 默认监听 `127.0.0.1:17871`。`--listen` 只选择 ControlPlane，`--core-listen` 独立选择 Core，显式非回环 Core 监听可供远程原生 CLI 直接连接；ControlPlane 后端始终使用启动器确认的 Core 地址。通配地址只用于监听，不作为浏览器或后端请求目标。浏览器工作流 SHALL 只使用 ControlPlane；Core 端口保留独立用户/admin/operator API，不提供网页、不把 CLI 重定向到 ControlPlane。

两个必需 listener、存储锁和运行恢复 SHALL 由同一启动协调者管理。端口冲突、无效配置或部分初始化失败 SHALL 关闭本次已取得资源、非零退出且不留下半启动服务，不自动换端口、接管其他实例或回退到旧 7171。监听器异常结束 SHALL 触发统一有界关闭，正常终止仍遵守本安装 Work 停止与持久意图保留规则。

#### Scenario: Start before initialization

- **WHEN** 操作者在空或部分配置的数据目录启动 `serve`
- **THEN** Core 监听健康接口，报告具体初始化状态，并允许控制面补齐缺失配置

#### Scenario: Start a configured Core

- **WHEN** 管理员、默认 runtime 和 Docker 都可用
- **THEN** Core 完成 recovery 后进入 READY，并保留已有 Work 的独立配置

#### Scenario: Start a configured local Core

- **WHEN** an administrator and runtime profile exist and the Docker dependency is available
- **THEN** `serve` 在同一进程启动 Core 与 ControlPlane 两个 listener，输出不含秘密的实际浏览器地址及 Core 地址，恢复完成后如实报告 ready

#### Scenario: Reject a second Core owner

- **WHEN** another Core process already owns the same data directory
- **THEN** a second `serve` exits nonzero without opening another listener or modifying the store

#### Scenario: Refuse accidental remote plaintext binding

- **WHEN** 操作者使用仍受原明文 opt-in 约束的独立控制面调用请求非 loopback listener，且没有对应 opt-in
- **THEN** Core rejects startup with a diagnostic identifying the required opt-in

#### Scenario: 默认统一入口允许远程浏览器
- **WHEN** 在 Linux 使用默认统一服务端入口启动
- **THEN** 按文档化远程监听提供网页、健康及业务入口，输出实际可用 IP/URL，浏览器不需要客户端 Desktop；旧受保护监听解析不被全局放宽

#### Scenario: 通配监听后经实际 IP 访问
- **WHEN** 统一程序监听 `0.0.0.0:17891` 或相同通配地址的测试端口，另一电脑或独立客户端网络使用服务器实际非回环 IPv4 访问
- **THEN** 默认访问地址和对应 Host 可用于初始化、登录、管理及工作台，无须在基础场景预填 `--public-origin`；输出不将通配地址或客户端 localhost 作为目标，仍执行精确 Host、Origin 和 CSRF 校验

#### Scenario: 两端口与三种调用者
- **WHEN** 一键启动完成，浏览器、同机用户 CLI 和 operator 分别使用默认入口
- **THEN** 浏览器通过 17891 使用 UI/内容，CLI 和 operator 通过 17871 按各自身份调用 Core；ControlPlane 的业务请求也经 Core HTTP，只有一个持久 Core 所有者

#### Scenario: 第二个端口被占用
- **WHEN** ControlPlane 或 Core 的指定端口已被其他进程占用
- **THEN** 本次启动非零退出、清理已取得 listener 和锁，不更改占用者，不留下可写半实例

#### Scenario: 显式允许远程 CLI
- **WHEN** 操作者显式把 Core 绑定到远程客户端可达地址，CLI 指定该 Core origin
- **THEN** CLI 直接调用 Core，不需浏览器 Cookie、初始化委托或 ControlPlane 转发；浏览器配置仍只指向 17891

### Requirement: Go Core 的安装、数据与运维边界

**Identifier:** CST-OPS-001

统一服务端的默认安装/业务初始化入口遵守 NATIVE-001、CORE-DOCKER-INIT-001 和 web-onboarding：默认网页引导不要求下列高级运维示例中的环境变量或独立 Desktop。下述显式 operator/开发示例仅属于其高级使用场景；模型变量名称作为 shell 交互输入的局部变量不代表保留服务端模型 env 解析。

Core SHALL 作为 Linux 上的 Go daemon/operator 入口直接使用本机 Docker Engine Unix API，CLI 和 Console 分别交付。新安装采用空的 piwork-go-core/schema 1 数据目录，目录 0700、私有文件 0600，固定 owner 并拒绝链接及多进程并发占用；未知格式、无 marker 的非空目录和身份不一致 SHALL 在开放业务及创建 Docker 资源前拒绝，不自动转换或清空旧 TS 数据。备份 SHALL 在 Core 停止后保留整个数据目录以及受管 Docker 卷，不能把仅复制 SQLite 主文件称为完整备份。

Engine 目标 SHALL 按非空 DOCKER_CONTEXT、非空 DOCKER_HOST、Docker config currentContext、默认本机 Unix socket 选择，只接受本机 Unix endpoint；显式目标失败不切换 Engine。固定镜像 ID 已存在时无需读取 registry 凭据，拉取只使用对应 registry 的静态凭据或匿名访问，不调用宿主 Docker CLI/credential helper。Agent/helper 标签、静态能力和镜像 ID SHALL 先核验，缺能力不回退旧 TS/Python 程序。

health 与 ready SHALL 分离；管理员、runtime、默认准备或恢复缺失时不能称 ready。运维参数按对应命令契约解析；统一服务端仅保留可选 ADMIN env 补充首次身份，模型和镜像不再由业务 env 初始化；通过页面/API 保存的可选 Base URL 仍区分缺省与空值。operator 与用户凭据 SHALL 分离；密码/Key 通过隐藏输入或 stdin/file 输入，不作为命令参数。保留的高级 operator env-file 解析不执行 shell。只有未显式选 Core 且默认 loopback 明确拒绝连接时才允许持同一目录锁离线初始化，超时或未知结果不授权本地回退。

全局 Runtime 的 Agent 引用 SHALL 在服务端固定解析，config set 不再提供 --agent-image；在线取目标 Core 的发行信息，离线取本地服务端发行信息，错误提示不包含旧参数值。镜像身份仍可在非敏感配置读取或按需诊断中核对；已有 Runtime 与 Work 的捕获引用遵守保留及显式保存语义。独立 Work/default-Work 的既有高级配置和 helper 参数范围保持。

Core 正常退出 SHALL 停止本安装受管 Work 容器并保留 desired、数据和历史；重启协调原 journal/epoch/标签，未知创建和清理失败保留占用，不全局 prune。Service memoryBytes 的旧正数只作为历史兼容，应用 Service 不设有效内存限制/预留，投影明确 unlimited；CPU/数量和 Agent/helper 政策仍有效。旧受限 Service 由受管恢复替换并保留身份、固定镜像和 workspace。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```sh
npm ci
make build
make native-agent-images native-helper-images
export PIWORK_DATA_DIR="$PWD/.piwork-go-core"
./dist/go/piwork-serve serve --data-dir "$PIWORK_DATA_DIR" --listen 127.0.0.1:17891 --core-listen 127.0.0.1:17871 \
  --package-helper-image piwork-agentd:go-migration-production \
  --file-helper-image piwork-file-helper:go-migration-acceptance \
  --snapshot-helper-image piwork-snapshot-helper:go-migration-acceptance
```

```sh
export PIWORK_DATA_DIR="$PWD/.piwork-go-core"
export PIWORK_CORE_URL=http://127.0.0.1:17871
./dist/go/piwork-serve --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  admin bootstrap --account admin
read -r -p '模型提供方: ' PIWORK_MODEL_PROVIDER
read -r -p '模型 ID: ' PIWORK_MODEL_ID
./dist/go/piwork-serve --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  config set --model-provider "$PIWORK_MODEL_PROVIDER" --model "$PIWORK_MODEL_ID"
./dist/go/piwork-serve --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" status
```

```sh
./dist/go/piwork-cli --core "$PIWORK_CORE_URL" desktop
```

## ADDED Requirements

### Requirement: 通过独立 Core HTTP 完成网页初始化与授权

**Identifier:** CST-HTTP-BOUNDARY-001

ControlPlane SHALL 只通过实际 Core HTTP 契约执行用户、管理员及 Service 操作，不以共享内存业务对象、数据库或进程内请求替代。Core SHALL 独立完成所有业务授权和持久提交，不依赖网页层已经检查权限。Core 不接受浏览器 Cookie 作为用户/operator 身份，不为浏览器开放跨源 CORS，也不提供 UI 静态资源。

系统 SHALL 复用已有 Core 路由：`GET /control/status` 提供安全状态、准备信息和精确的持久用户集合非空标志 `hasUsers`；`POST /control/admin/bootstrap` 在原 operator 身份之外，仅允许启动器自动提供的单用途网页初始化委托。该委托 SHALL 只在本次进程存活且用户集合为空时可用，不得访问其他控制/API 路由、取得用户会话或代替完整 operator credential；不进入浏览器、URL、普通输出、日志、持久配置和容器。所有 bootstrap 入口继续共用原子空集合约束，创建后必须普通登录；不新增设置链接或 Access 步骤。

登录、注销、身份、管理配置、发行默认和内容请求 SHALL 复用原 Core API；Service 继续复用 service-access/resolve 与 service-gateway，不另建网关路由。会话观察使用已有身份接口及 Core 内容流撤销能力，每次新受保护请求仍由 Core 鉴权；明确撤销关闭所属内容，短暂断网不能被当作密码错误或自动重放写入。

#### Scenario: 浏览器创建与 operator 并发
- **WHEN** 空安装收到合法网页创建和有效 operator bootstrap
- **THEN** Core 原子地至多创建一个管理员，其他提交安全冲突；网页仍无 operator 输入，创建成功后未自动获得登录会话

#### Scenario: 初始化委托不可扩权
- **WHEN** 使用初始化委托访问非 bootstrap 路由，已有用户后再次创建，或重启后重放旧委托
- **THEN** Core 拒绝且没有业务变化，不将其当作管理员或用户 token

#### Scenario: 禁用管理员不重开首次创建
- **WHEN** 持久用户已存在但没有可用管理员会话
- **THEN** hasUsers 仍为 true，网页及初始化委托不能重新创建首管理员

#### Scenario: 独立网络故障与权限拒绝
- **WHEN** ControlPlane 到 Core 的 HTTP 连接中断或 Core 明确撤销用户会话
- **THEN** 分别呈现连接不可达或普通重新登录，不能绕过 HTTP 改查 Core 内部状态，未知修改先读回，不自动重发
