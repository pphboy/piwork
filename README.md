# piwork

piwork 是单机 Work 运行环境。Go Core 管理用户、Work 生命周期、Service、文件和快照；Go CLI 提供命令、本机代理和浏览器 Desktop；Go Console 是独立的管理员界面。每个运行中的 Work 使用容器内的 Pi Agent SDK harness，Agent harness 保留 TypeScript。浏览器界面也保留 TypeScript，编译后嵌入 Go 程序。

## 程序与依赖

| 程序 | 用途 | 部署位置 |
| --- | --- | --- |
| `piwork-serve`（别名 `piwork`） | Core 服务与 operator 管理命令 | Core 宿主 |
| `piwork-cli` | 用户命令、Service/WebDAV proxy、Desktop | 用户宿主 |
| `piwork-console` | 独立 HTTPS 管理面板 | Core 宿主 |
| `piwork-service-mcp`、`piwork-package-helper` | Agent 调用的原生辅助程序 | Agent 镜像内 |
| `piwork-file-helper`、`piwork-snapshot-helper` | Workspace 文件与快照辅助程序 | 独立 helper 镜像内 |

三个宿主程序关闭 CGo，运行时不调用 Node、npm、Python、Go、Docker CLI 或 OpenSSL。用户 CLI 面向 Windows 与 Linux，Windows 交付 `.exe`，Linux 交付可执行文件；Core 和 Console 沿用 Linux 部署。Core 使用本机 Docker Engine Unix socket。镜像内的 Pi SDK harness 仍需要 Node；用户 Service 和 Pi 包可以使用各自的语言。

构建机需要 Go 1.25.5、Node 24/npm 和 Docker Engine。全量构建及测试入口：

```sh
npm ci
make build
make test
make test-integration
make acceptance
make release
```

`make build` 编译保留的 harness、Desktop/Console 浏览器资源和七个 Go 程序，输出在 `dist/go/`。`make release` 另外构建原生 Agent/helper 镜像，并把三个宿主入口、版本与协议摘要、镜像清单和 SHA256SUMS 打进 `dist/release/`。测试范围与未完成 gate 见 [测试说明](docs/testing.md) 和 [迁移验收记录](docs/go-migration-acceptance.md)。

只构建客户端可运行 `npm run build:cli`（或 `make build-cli`）；它只构建 Desktop 资源和 `cmd/piwork-cli`，输出到 `dist/cli/<目标>/`。目标配置、原生验收和独立打包见 [CLI 平台交付](docs/cli-platforms.md)。用户运行产物不需要构建工具或本机容器。

## 启动 Core

为 Go 安装选择新的空数据目录。当前格式不读取旧 TS Core 开发数据，也不会自动改写该目录。

```sh
make native-agent-images native-helper-images
export PIWORK_DATA_DIR="$PWD/.piwork-go-core"
export PIWORK_CORE_URL=http://127.0.0.1:7171
export PIWORK_AGENT_IMAGE=piwork-agentd:go-migration-production
export PIWORK_PACKAGE_HELPER_IMAGE=piwork-agentd:go-migration-production
export PIWORK_FILE_HELPER_IMAGE=piwork-file-helper:go-migration-acceptance
export PIWORK_SNAPSHOT_HELPER_IMAGE=piwork-snapshot-helper:go-migration-acceptance
./dist/go/piwork-serve serve --data-dir "$PIWORK_DATA_DIR" --listen 127.0.0.1:7171
```

在另一个终端设置同样的 `PIWORK_DATA_DIR` 和 `PIWORK_CORE_URL`，随后初始化管理员与默认运行时。密码和 API key 从 stdin 读取；这里的模型名称只是命令格式示例，需要提供实际可用的模型配置。

```sh
printf '%s\n' "$PIWORK_ADMIN_PASSWORD" | ./dist/go/piwork-serve \
  --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  admin bootstrap --account admin --password-stdin
printf '%s\n' "$PIWORK_MODEL_API_KEY" | ./dist/go/piwork-serve \
  --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  config set --agent-image "$PIWORK_AGENT_IMAGE" \
  --model-provider "$PIWORK_MODEL_PROVIDER" --model "$PIWORK_MODEL_ID" --api-key-stdin
./dist/go/piwork-serve --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" status
```

Operator 命令不读取用户对话；用户 CLI 不读取 operator 凭证。Core 数据目录、锁、环境文件及恢复规则见 [运维说明](docs/operations.md)。

## 用户 Work 与浏览器

```sh
printf '%s\n' "$PIWORK_USER_PASSWORD" | ./dist/go/piwork-cli --core "$PIWORK_CORE_URL" \
  login --account "$PIWORK_USER_ACCOUNT" --password-stdin
./dist/go/piwork-cli --core "$PIWORK_CORE_URL" work create --name "My Work" --wait
./dist/go/piwork-cli --core "$PIWORK_CORE_URL" work list
./dist/go/piwork-cli --core "$PIWORK_CORE_URL" desktop
```

不带子命令的 `piwork-cli` 现在默认启动 Desktop；原来显示帮助的调用应改用 `piwork-cli --help` 或 `piwork-cli help`。原业务命令和显式 `desktop` 入口保留。Desktop 默认在 `127.0.0.1:17891` 打开浏览器。一个 Work 面板包含对话、Service 预览与独立窗口、文件、配置、生命周期和导入导出；浏览器无需配置 `.work` 代理。打开器不可用时使用 `desktop --no-open` 显示的本地地址。详情见 [Desktop](docs/desktop-webui.md)。

Desktop 地址依次取 `--core`、`PIWORK_CORE_URL`、独立保存的 Desktop 默认 Core、登录凭证地址、loopback。登录/切换连接界面可保存或清除默认 Core，只影响后续启动，当前连接保持。业务 CLI 仍依次取参数、环境、凭证、loopback，不读取 Desktop 偏好；参数仅覆盖本次调用。

命令行的身份、Work、配置、Pi Package、对话与迁移流程见 [Go 用户 CLI](docs/user-cli.md)。

用户也可以运行 `piwork-cli proxy`，在同一个 `127.0.0.1:17890` listener 上访问 `<service>.<work-network-id>.work` 和 `/works/<workId>/files/` WebDAV；本地 WebDAV 密码每次启动随机生成，仅显示一次。Service 应用的认证与平台凭证分离。见 [Service 访问](docs/service-access.md) 和 [Work 文件](docs/work-files.md)。

Work 文件根为同一 Work 的 workspace 卷，Agent 和获准挂载 workspace 的 Service 在容器内通过 `/var/data/workspace` 看到它。停止 Work 后保留数据，但首版 WebDAV 仅在 Work 运行时可读写。导出必须先显式 Stop；导入得到 stopped Work，再显式 Start。见 [快照](docs/work-snapshot.md) 和 [包格式](docs/work-package-format.md)。

## 管理面板与设计语言

`piwork-console serve` 独立提供 HTTPS 管理面板，通过 Core loopback API 管理用户、运行时、默认 Work、Skill 和 Core Package。它停止时不影响 Core 和已接受的 Operation。TLS 与 URL 参数见 [Console](docs/serve-console.md)。Desktop 的产品和视觉约束见 [UI 语言](docs/ui-language.md)。
