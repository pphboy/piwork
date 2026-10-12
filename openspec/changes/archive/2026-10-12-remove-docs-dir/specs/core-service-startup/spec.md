# core-service-startup 规格变更

## ADDED Requirements

### Requirement: Go Core 的安装、数据与运维边界

**Identifier:** CST-OPS-001

Core SHALL 作为 Linux 上的 Go daemon/operator 入口直接使用本机 Docker Engine Unix API，CLI 和 Console 分别交付。新安装采用空的 piwork-go-core/schema 1 数据目录，目录 0700、私有文件 0600，固定 owner 并拒绝链接及多进程并发占用；未知格式、无 marker 的非空目录和身份不一致 SHALL 在开放业务及创建 Docker 资源前拒绝，不自动转换或清空旧 TS 数据。备份 SHALL 在 Core 停止后保留整个数据目录以及受管 Docker 卷，不能把仅复制 SQLite 主文件称为完整备份。

Engine 目标 SHALL 按非空 DOCKER_CONTEXT、非空 DOCKER_HOST、Docker config currentContext、默认本机 Unix socket 选择，只接受本机 Unix endpoint；显式目标失败不切换 Engine。固定镜像 ID 已存在时无需读取 registry 凭据，拉取只使用对应 registry 的静态凭据或匿名访问，不调用宿主 Docker CLI/credential helper。Agent/helper 标签、静态能力和镜像 ID SHALL 先核验，缺能力不回退旧 TS/Python 程序。

health 与 ready SHALL 分离；管理员、runtime、默认准备或恢复缺失时不能称 ready。显式参数/环境优先，初始化仅补缺失持久配置；可选 Base URL 缺省与空值区分。operator 与用户凭据 SHALL 分离；密码/Key 通过隐藏输入或 stdin/file 输入，不作为命令参数。env-file 解析不执行 shell。只有未显式选 Core 且默认 loopback 明确拒绝连接时才允许持同一目录锁离线初始化，超时或未知结果不授权本地回退。

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

### Requirement: 原生辅助能力检查与保留 Agent 运行环境

**Identifier:** CST-IMAGE-001

Agent production/acceptance SHALL 保留完整 TS Pi SDK harness 与 Node/npm/Git，并交付普通原生 Go package-helper 和 Service MCP；两 target 使用相同程序字节。Agent RPC v2、package-helper contract 2、Service MCP contract 1 与包内容/context contract 1 SHALL 分别核验，不能用 label、Node shebang 或链接启动器冒充静态 Go 能力。Go 构建固定 1.25.5、CGO=0、只读模块锁和真实 commit/dirty，运行宿主不增加解释器或 sqlite3 依赖。

静态检查 SHALL 先固定 image ID，通过 Engine inspect/save 核验选定 config SHA256、平台、layer/diff ID、gzip、whiteout/opaque 合并树和完整可执行 ELF，不运行 ENTRYPOINT 或包代码，不创建能力检查容器。归档使用 0600 匿名 scratch 与持久安装/image 归属，取消和进程退出回收 fd；仅精确本安装零字节 fallback 占位可清理。归档/恢复各 100 GiB、metadata 单份 64 MiB/累计 256 MiB、一百万条目、路径 4096 字节/深度 128，宣称长度不能驱动无界分配。

Agent 与默认 Web base SHALL 分别提供获准场景所需 sqlite3 CLI；Agent bash 不因 Service 有 Python/pip 就获得这些工具，策略禁用时不能另开 SQL 入口。默认 Web 环境遵循有效 web-development-base 的 NiceGUI 要求，旧 FastAPI/React 描述不作为新默认约束。旧 Work 采用新系统命令仍须兼容镜像选择及显式 Apply。静态镜像能力不替代完整包和目标安装校验。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```sh
make native-agent-images
```

```sh
PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:go-migration-acceptance \
  go test -mod=readonly -tags=integration -v ./internal/dockerengine \
  -run 'TestRealNativeAgentImageStaticCapabilitiesAndBuildEvidence|TestRealTSAgentNativeMutualTLSWithoutHostTools|TestRealTSMCPClientNativeStdioAndCoreMutualTLS|TestNativePackageHelperRealImageSourcesAndTSArtifactCompatibility'
```
