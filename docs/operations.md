# Go Core 运维

piwork 支持一台 Linux 主机上的 Docker Engine。`piwork-serve` 是 Core daemon 和 operator 命令；`piwork-cli` 是用户命令；`piwork-console` 是独立 HTTPS 管理面板。Core 直接调用本机 Engine Unix API，不运行 Docker CLI 或 OpenSSL。Agent 通过 Work 私有 bridge 和代次绑定的双向 TLS 与 Core 通信，Agent 端口不发布到宿主。

## Service 资源与版本升级

当前源码的应用 Service 不设置内存上限，也不申请 Work/安装级内存预留。Service 定义中的 `memoryBytes` 是弃用兼容字段：省略或零表示无限制；合法历史正数保留作原请求/快照事实，不恢复为有效限制。Service 投影的 `memoryLimitMode` 和部署上下文的 `serviceMemoryPolicy` 明确返回 `unlimited`，`defaultServiceMemoryBytes=0` 不能解释为零可用内存。

Work 的 `resources.memoryBytes` 和旧 total/availableMemoryBytes 字段只用于 Agent 等仍受管对象的内存预算，不是 Work 内全部应用的总内存上限，也不是宿主实时剩余内存。Agent/helper 内存政策、Agent 加 Service 的 CPU 预留、服务数和卷数仍然有效。旧 Service 内存预留不阻断新部署、Work 配置或完整包导入；历史 CPU/slots 及快照数据继续保留。Service 实际可用内存由宿主与外层部署环境决定。

按正常流程关闭旧 Core，再启动由当前源码构建的新 Core；受限旧 Service 容器会在受管恢复中替换，保留 Service 身份、固定镜像和 workspace 数据，不必逐个修改业务定义。发布镜像的功能以其固定版本为准，不能仅更新文档就使旧 Core 获得此政策。

Web 开发基础镜像的长期维护源及双语用法见 [Web base](../deploy/images/web-base/README.zh-CN.md)。Agent/base 中的 sqlite3 是容器工具，不是宿主依赖；新增 Agent 工具需要使用包含它的新 Agent 镜像，旧 Work 沿原镜像选择和显式 Apply 采用。

## 从源码启动

以下步骤用于 Linux 本机安装，在仓库根目录执行。源码构建依赖见 [Contributing](../README.md#contributing)，运行 Work 还需要当前用户可访问的本机 Docker Engine。双 Docker 安装使用 [Docker 手册](../deploy/docker/README.zh-CN.md)。

在第一个终端构建程序、镜像并启动 Core：

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

在第二个终端进入同一仓库根目录，初始化管理员和默认运行时。bootstrap 会隐藏输入管理员密码，config set 会隐藏输入模型 API key；模型提供方和 ID 使用实际可用的配置。初始化仅用于缺失配置的新安装，已有安装先用 status/config show 查看现状。

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

使用自定义模型入口时，在 config set 中追加 `--model-base-url` 和实际入口地址。配置保存后，Core 在后台准备镜像和默认上下文；status 显示进度，`GET /readyz` 返回 200 后再创建 Work。

已有 operator/env 初始化入口继续可用。每条模型的协议、地址和 Key 在 Console **AI models** 直接管理，无 Provider 设置步骤，Runtime 从列表选择默认模型；Key 轮换不重写 Work 捕获的端点或 Thinking。旧 Work 使用完整新能力前需显式采用兼容 harness 镜像并 Apply。见 [多供应商模型](ai-models.md)。

继续在第二个终端启动 Desktop，在浏览器中使用刚创建的管理员登录；Core URL 为 `http://127.0.0.1:7171`：

```sh
./dist/go/piwork-cli --core "$PIWORK_CORE_URL" desktop
```

随后可以创建并启动 Work。普通用户创建和 Console 启动见 [管理面板](serve-console.md)，命令行 Work 操作见 [用户 CLI](user-cli.md)。

## 数据目录和格式

Go Core 使用独立的**空目录**初始化 `piwork-go-core` 格式、schema 1。旧 TS Core 的开发数据目录不会自动转换、清空或接管。目录归当前 Core 用户所有，权限 0700，常规私有文件为 0600；marker、数据库和受管路径拒绝 symlink，数据库拒绝 hardlink。第二个进程无法获得目录 `flock` 时退出；进程崩溃后由 OS 释放锁。

| 路径 | 内容 |
| --- | --- |
| `core-format.json` | 格式、schema、installation ID 和 initializing/ready 阶段 |
| `core.sqlite`、WAL/SHM | Work、用户、Operation、幂等、配额、Service、文件、包与快照 journal |
| `secrets/` | 受管凭据；不属于 Work workspace |
| `runtime/` | 安装及 Work 代次证书、受控运行配置 |
| `skills/`、`works/`、`snapshots/` | 受管制品、配置和快照字节 |

初始化中断只从身份一致的受管记录恢复。未知格式、损坏 marker、无合法 marker 的非空目录、数据库与 marker 不一致时，在开放业务路由和创建 Docker 资源前拒绝。不要手工改 marker、删除 WAL 或删除待清理资源来绕过拒绝。

备份应先停止 Core，再复制整个数据目录，并按 Work 持久卷的恢复策略单独保留对应 Docker volume。只复制 SQLite 主文件会漏掉 WAL、证书、制品和快照。恢复时保留原 owner/权限，使用同版本 Go Core 打开，并让 journal 协调完成；不要 prune Docker 资源。

## Engine 和镜像

目标优先级：非空 `DOCKER_CONTEXT` → 非空 `DOCKER_HOST` → Docker config `currentContext` → `unix:///var/run/docker.sock`。仅接受本机 Unix endpoint，包括 rootless socket；显式目标不可用时不切换 Engine，SSH/TCP context 与外部 credential helper 不受支持。镜像已经按固定 ID 存在时不读取 registry 凭据；需要 pull 时可用目标 registry 的静态凭据或匿名访问。镜像身份固定后不按移动的 tag 重新解析。

源码安装的镜像构建及启动环境见 [从源码启动](#从源码启动)。镜像变量应在启动 Core 的终端设置，由 Core 进程读取。

Agent image 由 `config set --agent-image` 指定；Package helper 必须是带原生 package-helper 能力的可信 Agent 镜像。Core 在启动或接受任务前核验对应镜像标签、原生文件、平台和固定 ID；缺失时相应能力返回明确错误，不启动旧 TS/Python helper。File helper 缺失不会破坏 Service 网关。Agent 镜像内仍运行完整 TS Pi SDK harness；Package helper 与 Service MCP 为镜像内 Go 二进制。用户 Service 镜像的语言不受限制。

启用 SELinux 的宿主需要为 Core 的受管容器共享目录设置合适的持久标签，并使用配套的 Core/snapshot helper；目录授权、标签边界和验证步骤见 [SELinux 宿主上的 Core](selinux.md)。Core 宿主不需要安装用户 CLI 或运行 Desktop。

## 初始化和权限

Docker 新默认入口使用镜像内 `/etc/piwork/docker-release.json` 的非敏感发行依赖，不要求用户准备 env 文件或指定 Agent/helper。宿主已有的 `PIWORK_ADMIN_ACCOUNT`、`PIWORK_ADMIN_PASSWORD`、`PIWORK_MODEL_PROVIDER`、`PIWORK_MODEL`、`PIWORK_API_KEY` 只按名称传给 Core；可选 `PIWORK_MODEL_BASE_URL` 未设置时保持缺省，显式空值非法。镜像 defaults 与用户模型初始化分开处理，未提供用户值仍保持健康可访问、非就绪。显式部署输入优先，合法初始化只补齐缺失持久配置；已有管理员、runtime 和 Work 不被新的发行 defaults 或初始化值覆盖。新默认数据路径为 `/var/lib/piwork/quickstart/core`，高级 Core-only Demo 使用独立 `/var/lib/piwork/core`。两种默认 Docker 入口及完整就绪等待见 [Docker 手册](../deploy/docker/README.zh-CN.md#terminal-docker-quick-start)。

Core 可以健康启动但尚未就绪。`GET /healthz` 表示 listener 活着；`GET /readyz` 区分 `ADMIN_REQUIRED`、`RUNTIME_NOT_CONFIGURED`、`RUNTIME_UNAVAILABLE`、`RECOVERING` 等状态。先运行 `admin bootstrap`，再 `config set`，命令示例见 [从源码启动](#从源码启动)。operator 凭证位于数据目录的私有文件，用户 CLI 凭证位于 `$XDG_CONFIG_HOME/piwork/client.json`、`$HOME/.config/piwork/client.json` 或 `PIWORK_CONFIG_PATH`。两种身份不能互用。密码、模型 key 使用隐藏输入或 `--password-stdin`、`--api-key-stdin`、`--api-key-file`，不要放在命令参数中。

`--env-file` 读取普通 `KEY=value`、引号、注释和空行，不执行 shell 表达式。支持 `PIWORK_DATA_DIR`、`PIWORK_LISTEN`、`PIWORK_CORE_URL`、`PIWORK_ADMIN_ACCOUNT`、`PIWORK_ADMIN_PASSWORD`、`PIWORK_AGENT_IMAGE`、`PIWORK_MODEL_PROVIDER`、`PIWORK_MODEL`/`PIWORK_MODEL_ID`、`PIWORK_API_KEY`/`PIWORK_MODEL_API_KEY`、`PIWORK_FILE_HELPER_IMAGE` 等初始化项；显式命令参数和进程环境优先，已有持久记录不会被初始化值覆写。离线 bootstrap/config 仅在未显式选择 Core URL 且默认 loopback 确认连接被拒绝时使用同一目录锁。显式目标超时或响应丢失不回退为本地写入。

用户会话只保存摘要。禁用/重置用户会撤销其全部会话；重新启用不会恢复旧 token。最后一个启用中的管理员受到事务保护。用户只能访问自己拥有的 Work；即使其他管理员可以检查运行状态，也不能通过 Service/File 网关读取应用内容。

## 证书、恢复和退出

安装 CA、Work generation/instance 的证书由 Go crypto 生成，私有材料留在 Core 数据目录。容器只得到当前代次所需的只读 PEM 和 runtime/control JSON。Core 每次 WorkServices RPC 核验当前 ready 身份；旧连接不能在 Work 代次替换后继续授权。CA 到期明确失败，不静默换根；不要把私钥复制进 workspace。

Work Stop 保留共享 workspace 与 enabled Service 定义；Work Start 恢复启用的服务。`service_stop` 持久禁用单个 Service。Core 崩溃后按 Operation epoch、资源标签、job lease 和文件临时 inode 协调；未知 Docker 结果不能创建第二份实例或自动重放文件 mutation。清理失败保留 `cleanup-pending` 占用，恢复 Engine 后重试，不能全局 prune。

导出必须先 Stop 并确认 Agent、Service、文件与 Package helper 已停止写入。导入先静态校验，再恢复到隔离的目标资源，发布为 stopped Work，用户显式 Start。源安装可离线；目标使用自己的模型凭据与证书。原 snapshot ID 在保留期内可从头重下，不需要重新 Export。具体命令和失败语义见 [快照](work-snapshot.md) 与 [包格式](work-package-format.md)。

## 诊断和验收

Core 的 Operation 保存安全的阶段、主要错误、回滚和诊断收集结果；原始容器日志是不可信内容，不直接当作公开错误。用 `piwork-serve operation show <id>` 或 `piwork-cli operation show <id>` 查询对应 scope。Console 独立运行和退出，配置见 [管理面板](serve-console.md)。Service 与 WebDAV 的用户链路见 [Service 访问](service-access.md)、[Work 文件](work-files.md)。

`make test-integration` 使用随机 installation label，只 inspect/清理自己创建的 Docker container/network/volume；不执行全局清理。阶段 gate、失败案例与实际证据见 [Go 迁移验收](go-migration-acceptance.md)。
