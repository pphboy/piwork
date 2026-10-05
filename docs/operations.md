# Go Core 运维

piwork 支持一台 Linux 主机上的 Docker Engine。`piwork-serve` 是 Core daemon 和 operator 命令；`piwork-cli` 是用户命令；`piwork-console` 是独立 HTTPS 管理面板。Core 直接调用本机 Engine Unix API，不运行 Docker CLI 或 OpenSSL。Agent 通过 Work 私有 bridge 和代次绑定的双向 TLS 与 Core 通信，Agent 端口不发布到宿主。

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

先在构建机执行：

```sh
make build native-agent-images native-helper-images
```

推荐在 Core 启动前显式配置镜像：

```sh
export PIWORK_PACKAGE_HELPER_IMAGE=piwork-agentd:go-migration-production
export PIWORK_FILE_HELPER_IMAGE=piwork-file-helper:go-migration-acceptance
export PIWORK_SNAPSHOT_HELPER_IMAGE=piwork-snapshot-helper:go-migration-acceptance
./dist/go/piwork-serve serve --data-dir "$PIWORK_DATA_DIR" --listen 127.0.0.1:7171
```

Agent image 由 `config set --agent-image` 指定；Package helper 必须是带原生 package-helper 能力的可信 Agent 镜像。Core 在启动或接受任务前核验对应镜像标签、原生文件、平台和固定 ID；缺失时相应能力返回明确错误，不启动旧 TS/Python helper。File helper 缺失不会破坏 Service 网关。Agent 镜像内仍运行完整 TS Pi SDK harness；Package helper 与 Service MCP 为镜像内 Go 二进制。用户 Service 镜像的语言不受限制。

启用 SELinux 的宿主需要为 Core 的受管容器共享目录设置合适的持久标签，并使用配套的 Core/snapshot helper；目录授权、标签边界和验证步骤见 [SELinux 宿主上的 Core](selinux.md)。Core 宿主不需要安装用户 CLI 或运行 Desktop。

## 初始化和权限

Core 可以健康启动但尚未就绪。`GET /healthz` 表示 listener 活着；`GET /readyz` 区分 `ADMIN_REQUIRED`、`RUNTIME_NOT_CONFIGURED`、`RUNTIME_UNAVAILABLE`、`RECOVERING` 等状态。先运行 `admin bootstrap`，再 `config set`，命令示例见 [README](../README.md)。operator 凭证位于数据目录的私有文件，用户 CLI 凭证位于 `$XDG_CONFIG_HOME/piwork/client.json`、`$HOME/.config/piwork/client.json` 或 `PIWORK_CONFIG_PATH`。两种身份不能互用。密码、模型 key 使用隐藏输入或 `--password-stdin`、`--api-key-stdin`、`--api-key-file`，不要放在命令参数中。

`--env-file` 读取普通 `KEY=value`、引号、注释和空行，不执行 shell 表达式。支持 `PIWORK_DATA_DIR`、`PIWORK_LISTEN`、`PIWORK_CORE_URL`、`PIWORK_ADMIN_ACCOUNT`、`PIWORK_ADMIN_PASSWORD`、`PIWORK_AGENT_IMAGE`、`PIWORK_MODEL_PROVIDER`、`PIWORK_MODEL`/`PIWORK_MODEL_ID`、`PIWORK_API_KEY`/`PIWORK_MODEL_API_KEY`、`PIWORK_FILE_HELPER_IMAGE` 等初始化项；显式命令参数和进程环境优先，已有持久记录不会被初始化值覆写。离线 bootstrap/config 仅在未显式选择 Core URL 且默认 loopback 确认连接被拒绝时使用同一目录锁。显式目标超时或响应丢失不回退为本地写入。

用户会话只保存摘要。禁用/重置用户会撤销其全部会话；重新启用不会恢复旧 token。最后一个启用中的管理员受到事务保护。用户只能访问自己拥有的 Work；即使其他管理员可以检查运行状态，也不能通过 Service/File 网关读取应用内容。

## 证书、恢复和退出

安装 CA、Work generation/instance 的证书由 Go crypto 生成，私有材料留在 Core 数据目录。容器只得到当前代次所需的只读 PEM 和 runtime/control JSON。Core 每次 WorkServices RPC 核验当前 ready 身份；旧连接不能在 Work 代次替换后继续授权。CA 到期明确失败，不静默换根；不要把私钥复制进 workspace。

Work Stop 保留共享 workspace 与 enabled Service 定义；Work Start 恢复启用的服务。`service_stop` 持久禁用单个 Service。Core 崩溃后按 Operation epoch、资源标签、job lease 和文件临时 inode 协调；未知 Docker 结果不能创建第二份实例或自动重放文件 mutation。清理失败保留 `cleanup-pending` 占用，恢复 Engine 后重试，不能全局 prune。

导出必须先 Stop 并确认 Agent、Service、文件与 Package helper 已停止写入。导入先静态校验，再恢复到隔离的目标资源，发布为 stopped Work，用户显式 Start。源安装可离线；目标使用自己的模型凭据与证书。原 snapshot ID 在保留期内可从头重下，不需要重新 Export。具体命令和失败语义见 [快照](work-snapshot.md) 与 [包格式](work-package-format.md)。

## 诊断和验收

Core 的 Operation 保存安全的阶段、主要错误、回滚和诊断收集结果；原始容器日志是不可信内容，不直接当作公开错误。用 `piwork-serve operation show <id>` 或 `piwork-cli operation show <id>` 查询对应 scope。Console 独立运行和退出，配置见 [管理面板](serve-console.md)。Service 与 WebDAV 的用户链路见 [Service 访问](service-access.md)、[Work 文件](work-files.md)。

`make test-integration` 使用随机 installation label，只 inspect/清理自己创建的 Docker container/network/volume；不执行全局清理。阶段 gate、失败案例与实际证据见 [Go 迁移验收](go-migration-acceptance.md)。
