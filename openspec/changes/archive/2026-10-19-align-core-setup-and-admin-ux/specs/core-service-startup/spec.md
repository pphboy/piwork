# Spec Delta

## MODIFIED Requirements

### Requirement: Configure a usable local runtime profile

Core SHALL 保留离线 runtime 配置命令，并提供受保护的在线全局默认配置 API。全局 CoreRuntime 的 Agent 镜像 SHALL 固定使用执行保存的服务端程序随版本内嵌的发行引用，模型配置命令/API 不要求操作者选择镜像；operator 的旧镜像参数按 SERVE-RUNTIME-RELEASE-001 移除，管理员和旧 HTTP 字段按 CADM-004 处理。内嵌发行引用无效时安全拒绝，不将手填镜像作为恢复方案。

全局配置 SHALL 仅作为之后新建 Work 的默认值；已有 Work 的独立配置、模型引用和运行实例 MUST NOT 因全局配置变化而修改、重启或切换模型。读取、启动和升级 SHALL 如实保留已持久 Runtime，不自动替换其中镜像；用户显式保存时才采用当前发行引用。确认保存后后台准备与 readiness 继续分别表达。

#### Scenario: Configure the global default online
- **WHEN** 管理员通过 piwork-serve config set 提供合法模型、endpoint 和 secret，未指定镜像
- **THEN** Core 使用自身内嵌发行镜像持久化全局默认，查询只返回非敏感字段和 secret 可用性

#### Scenario: Configure an installation from standard input
- **WHEN** operator 在既有离线条件下提供模型并通过标准输入提交 credential
- **THEN** 本地服务端用内嵌发行镜像保存默认 Runtime，credential 不进入命令参数、普通输出、日志或公开响应

#### Scenario: Change defaults without changing existing Works
- **WHEN** 全局默认模型配置从 model-a 改为 model-b
- **THEN** 新 Work 使用 model-b，已有 Work 保留原独立配置且不发生隐式重启

#### Scenario: Detect an incomplete runtime profile
- **WHEN** Core 启动时缺少可用的 Runtime 模型或发行依赖
- **THEN** 健康和网页引导保持可用，readiness 显示具体未配置或不可用原因，Work 创建返回可操作错误

#### Scenario: 保留已有 Runtime 的捕获镜像
- **WHEN** 服务端程序发行镜像发生变化而用户仅启动或读取旧安装
- **THEN** 原 Runtime 和 Work 继续保留捕获引用，不因固定发行默认而静默迁移；明确重新保存时才更新全局新 Work 默认

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
./dist/go/piwork-serve serve --data-dir "$PIWORK_DATA_DIR" --listen 127.0.0.1:7171 \
  --package-helper-image piwork-agentd:go-migration-production \
  --file-helper-image piwork-file-helper:go-migration-acceptance \
  --snapshot-helper-image piwork-snapshot-helper:go-migration-acceptance
```

```sh
export PIWORK_DATA_DIR="$PWD/.piwork-go-core"
export PIWORK_CORE_URL=http://127.0.0.1:7171
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
