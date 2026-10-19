## MODIFIED Requirements

### Requirement: Bootstrap the first administrator explicitly

Core SHALL 允许空安装通过受首次设置授权保护的网页创建、显式 operator bootstrap，或成对可选的 ADMIN 环境变量创建首管理员。网页和 env 的初始化语义遵守 web-onboarding 与 CORE-DOCKER-INIT-001，所有入口 MUST 原子核验持久用户集合为空，不能因为管理员被禁用而重新开放。不得生成默认账号/密码，不覆盖任何已有身份。

原 operator 在线/离线 bootstrap 的凭证、数据目录锁和未知结果不回退规则 SHALL 保留。网页首次设置证明不等于 operator credential，也不授予一般管理员或 Work 操作权限。

#### Scenario: 网页创建空安装管理员
- **WHEN** 安装者持有效首次设置授权提交合法账号密码
- **THEN** 原子创建持久首管理员并失效首次设置授权，不需要停启 Core

#### Scenario: Operator 离线或在线初始化
- **WHEN** 有权限操作者按原契约执行 admin bootstrap
- **THEN** 原目录锁、凭证及退出语义保持，不输出密码或摘要

#### Scenario: 重复及并发 bootstrap
- **WHEN** 已有用户时再次调用任一入口，或多个入口并发初始化
- **THEN** 已有身份不变，并发最多一个创建成功，其余返回安全冲突

#### Scenario: Bootstrap an empty installation

- **WHEN** 操作者使用 `piwork-serve admin bootstrap --data-dir <path>` 提供账号和密码
- **THEN** Core 创建首个管理员且不输出密码或摘要

#### Scenario: Bootstrap an empty installation online

- **WHEN** Core 已由 `piwork-serve serve` 监听且操作者通过 operator credential 调用 `piwork-serve admin bootstrap`
- **THEN** Core 创建首个管理员并更新 readiness，不需要停止或重启 Core

#### Scenario: Refuse repeated bootstrap

- **WHEN** 管理员已经存在时调用任一 bootstrap 入口
- **THEN** 请求失败且现有身份数据不变

#### Scenario: Refuse repeated bootstrap (offline command)

- **WHEN** an operator invokes bootstrap after an administrator already exists
- **THEN** Core exits nonzero with a concise diagnostic and leaves the existing identity data unchanged


### Requirement: Start one durable Core application

统一服务端无参数或 `serve` SHALL 启动同一持久 Core 及浏览器入口，在管理员和运行时配置缺失时仍打开健康 HTTP listener，初始化完成后再报告相应 readiness；配置存在时继续执行 Docker 验证和 Work recovery。它 MUST NOT 因缺少管理员或默认 runtime 而退出，也 MUST NOT 在启动过程中创建默认 Work。

网络必做验收 SHALL 在局域网或独立客户端网络验证通配监听加实际 IP 路径，不要求公网地址或公网连通性实测。多网卡/NAT/受信代理仍可显式配置 `--public-origin`；此高级覆盖不替代基础默认路径验收。IPv6 URL 括号、来源解析保留相应单元/契约覆盖，实际 IPv6 网络实测不作为本变更完成前提。

#### Scenario: Start before initialization

- **WHEN** 操作者在空或部分配置的数据目录启动 `serve`
- **THEN** Core 监听健康接口，报告具体初始化状态，并允许控制面补齐缺失配置

#### Scenario: Start a configured Core

- **WHEN** 管理员、默认 runtime 和 Docker 都可用
- **THEN** Core 完成 recovery 后进入 READY，并保留已有 Work 的独立配置

#### Scenario: Start a configured local Core

- **WHEN** an administrator and runtime profile exist and the Docker dependency is available
- **THEN** `serve` starts one HTTP listener, emits its effective loopback URL without secrets, and reports ready after recovery completes

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
- **WHEN** 统一程序监听 `0.0.0.0:7171` 或相同通配地址的测试端口，另一电脑或独立客户端网络使用服务器实际非回环 IPv4 访问
- **THEN** 默认访问地址和对应 Host 可用于初始化、登录、管理及工作台，无须在基础场景预填 `--public-origin`；输出不将通配地址或客户端 localhost 作为目标，仍执行精确 Host、Origin 和 CSRF 校验

### Requirement: Expose distinct health and readiness probes

统一应用 SHALL 在能够响应引导/健康时提供无认证 `GET /healthz`，并在存储初始化及启动恢复完成后通过无认证 `GET /readyz` 报告基础 Work 就绪；关闭时 readiness MUST 失效，runtime/Docker 阻断 Work 操作时 MUST 给出安全原因。未提供 profile 时 SHALL 保持既有 JSON 和基础 readiness 语义，包括 file/snapshot helper 缺失的原有功能降级。

`GET /readyz?profile=docker-delivery` SHALL 复用此入口，仅在基础 ready 且 CORE-DOCKER-STATUS-001 的全部交付组件 ready 时返回 200；其他情况返回 503。此 profile SHALL 保留原 status/reason/state/ready/checks 字段，并附加 preparation；ready/status 是完整交付的布尔值/名称，state/checks 仍反映基础状态，基础 ready 但准备未完成时 reason 为 `DEPENDENCIES_PREPARING` 或 `DEPENDENCY_FAILED`。未知/重复 profile SHALL 返回 400 `INVALID_REQUEST` 和安全 field=`profile`，不原样回显输入。探针不执行模型真实调用，也不保证某用户网络、凭证或具体 Work 已 ready。

#### Scenario: Report a ready installation
- **WHEN** Core 已初始化，Docker 可达且启动恢复已完成
- **THEN** 默认 health/readiness 成功，默认 readiness 报告 Work runtime 可用

#### Scenario: Report a runtime dependency failure
- **WHEN** Core 存活但 Docker 不可达
- **THEN** health 成功，默认 readiness 失败并返回安全依赖状态，不返回内部堆栈或凭据

#### Scenario: Docker 交付全组件准备完成
- **WHEN** 基础 ready 且所有交付组件准备成功
- **THEN** docker-delivery profile 返回 200 和 ready=true，Compose 可以据此完成等待

#### Scenario: helper 降级保持旧探针兼容
- **WHEN** 基础 ready 而 snapshot helper 失败或未配置
- **THEN** 默认探针保持基础可用语义，交付 profile 返回 503 并指出安全组件状态

#### Scenario: 停机与非法 profile
- **WHEN** Core 正在关闭，或请求携带未知/重复 profile
- **THEN** 分别返回非 ready 的 503 或安全的 400，不暴露秘密、不等待镜像准备

#### Scenario: 未初始化安装的容器健康
- **WHEN** 网页可访问但首管理员或模型尚未配置
- **THEN** 应用 liveness 成功，Work readiness 按实际缺项失败，默认镜像不把等待用户配置作为应用存活失败

### Requirement: 使用显式容器环境完成首次初始化

**Identifier:** CORE-DOCKER-INIT-001

统一服务端 SHALL 仅保留 PIWORK_ADMIN_ACCOUNT 和 PIWORK_ADMIN_PASSWORD 作为可选业务初始化环境变量，供测试/自动部署在空安装创建持久管理员。两项均未设置时走网页初始化；必须成对且满足原账号/密码校验，不提供默认值，不在日志或响应中输出值。已有身份 SHALL 不被重启时合法 env 改变覆盖；显式部分、空或非法 ADMIN 输入 SHALL 安全拒绝。

服务端 SHALL 移除 PIWORK_MODEL_PROVIDER、PIWORK_MODEL、PIWORK_MODEL_ID、PIWORK_API_KEY、PIWORK_MODEL_API_KEY、PIWORK_MODEL_BASE_URL 及镜像 env 的业务初始化入口，不读取、解析、校验或采用其值。检测废弃配置只可提示变量名称，不得形成旧初始化兼容分支或泄漏值；已有持久模型/runtime/Key SHALL 保留。标准 Engine/系统环境、独立 CLI 与用户 Service 环境不因此全局删除。

发行默认镜像引用 SHALL 为非敏感、同版可核查配置，随统一程序提供；其中 Agent 引用作为发行默认值由服务端自动使用，统一启动不得提供 `--agent-image` 等手填或高级覆盖入口。端口/数据目录等部署参数通过默认值和显式参数提供，默认使用不需要环境文件。启动不得自动创建 Work，默认上下文仍保持原一次性 seed 规则。网页保存模型的协议/Base URL/secret 校验继续按现有模型契约执行。

#### Scenario: 非敏感默认值不构成用户初始化
- **WHEN** 空安装以默认命令启动
- **THEN** 网页初始化可用，不因模型或镜像 env 缺失退出，不生成默认账号、密码或 Work

#### Scenario: 空数据首次启动
- **WHEN** 空安装收到成对有效 ADMIN 值
- **THEN** 创建与网页同性质的持久管理员并进入普通登录，runtime 仍由网页配置

#### Scenario: 重建容器时 env 与持久值不同
- **WHEN** 已有安装以不同合法 ADMIN 值和包含旧模型变量的环境重启
- **THEN** 已有用户、模型、Key、runtime 与 Work 保留，旧模型变量不作为配置来源

#### Scenario: 已有安装收到非法输入
- **WHEN** 只提供一项、显式空值或非法账号/密码
- **THEN** 在初始化前安全拒绝并标识相关字段名称，不修改原安装，不回显秘密

#### Scenario: 试图使用宿主 HTTP 模型地址
- **WHEN** 管理员在网页模型表单提供 http://host.docker.internal:8000 为 Base URL
- **THEN** 继续按既有模型 URL 契约安全拒绝，不因托管入口放宽；旧模型 env 不参与配置

#### Scenario: 显式部署覆盖发行默认值
- **WHEN** 管理员通过既有高级配置提供合法或非法 helper 镜像引用
- **THEN** 合法显式配置只覆盖对应 helper 默认，非法值拒绝且不回退；Agent 仍绑定服务端发行默认，不恢复镜像 env 初始化

#### Scenario: Agent 发行默认值不可手填覆盖
- **WHEN** 安装者启动统一程序或通过引导/管理页保存 runtime
- **THEN** Agent 引用来自服务端同版内嵌元数据，不接受启动参数或网页的自定义 Agent 引用；原高级 helper 显式配置仍按其契约校验，不恢复镜像 env 初始化

#### Scenario: 可选模型地址的省略与空值
- **WHEN** 网页或管理 API 保存模型时省略可选地址或显式提交空值
- **THEN** 按既有模型输入契约区分省略与非法空值，不从旧 env 自动补值


### Requirement: Go Core 的安装、数据与运维边界

**Identifier:** CST-OPS-001

统一服务端的默认安装/业务初始化入口遵守 NATIVE-001、CORE-DOCKER-INIT-001 和 web-onboarding：默认网页引导不要求下列高级运维示例中的环境变量或独立 Desktop。下述显式 operator/开发示例仅属于其高级使用场景；模型变量名称作为 shell 交互输入的局部变量不代表保留服务端模型 env 解析。

Core SHALL 作为 Linux 上的 Go daemon/operator 入口直接使用本机 Docker Engine Unix API，CLI 和 Console 分别交付。新安装采用空的 piwork-go-core/schema 1 数据目录，目录 0700、私有文件 0600，固定 owner 并拒绝链接及多进程并发占用；未知格式、无 marker 的非空目录和身份不一致 SHALL 在开放业务及创建 Docker 资源前拒绝，不自动转换或清空旧 TS 数据。备份 SHALL 在 Core 停止后保留整个数据目录以及受管 Docker 卷，不能把仅复制 SQLite 主文件称为完整备份。

Engine 目标 SHALL 按非空 DOCKER_CONTEXT、非空 DOCKER_HOST、Docker config currentContext、默认本机 Unix socket 选择，只接受本机 Unix endpoint；显式目标失败不切换 Engine。固定镜像 ID 已存在时无需读取 registry 凭据，拉取只使用对应 registry 的静态凭据或匿名访问，不调用宿主 Docker CLI/credential helper。Agent/helper 标签、静态能力和镜像 ID SHALL 先核验，缺能力不回退旧 TS/Python 程序。

health 与 ready SHALL 分离；管理员、runtime、默认准备或恢复缺失时不能称 ready。运维参数按对应命令契约解析；统一服务端仅保留可选 ADMIN env 补充首次身份，模型和镜像不再由业务 env 初始化；通过页面/API 保存的可选 Base URL 仍区分缺省与空值。operator 与用户凭据 SHALL 分离；密码/Key 通过隐藏输入或 stdin/file 输入，不作为命令参数。保留的高级 operator env-file 解析不执行 shell。只有未显式选 Core 且默认 loopback 明确拒绝连接时才允许持同一目录锁离线初始化，超时或未知结果不授权本地回退。

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
export PIWORK_PACKAGE_HELPER_IMAGE=piwork-agentd:go-migration-production
export PIWORK_FILE_HELPER_IMAGE=piwork-file-helper:go-migration-acceptance
export PIWORK_SNAPSHOT_HELPER_IMAGE=piwork-snapshot-helper:go-migration-acceptance
./dist/go/piwork-serve serve --data-dir "$PIWORK_DATA_DIR" --listen 127.0.0.1:7171
```

```sh
export PIWORK_DATA_DIR="$PWD/.piwork-go-core"
export PIWORK_CORE_URL=http://127.0.0.1:7171
./dist/go/piwork-serve --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  admin bootstrap --account admin
read -r -p '模型提供方: ' PIWORK_MODEL_PROVIDER
read -r -p '模型 ID: ' PIWORK_MODEL_ID
./dist/go/piwork-serve --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  config set --agent-image piwork-agentd:go-migration-production \
  --model-provider "$PIWORK_MODEL_PROVIDER" --model "$PIWORK_MODEL_ID"
./dist/go/piwork-serve --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" status
```

```sh
./dist/go/piwork-cli --core "$PIWORK_CORE_URL" desktop
```
