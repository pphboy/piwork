# Proposal

## Why

`piwork-cli` 应作为同一个完整客户端在 Windows 和 Linux 上使用，但当前 Go 客户端的凭据、可信本机控制和文件操作仍依赖 Linux 实现。用户需要直接运行 CLI 进入 Desktop，也需要继续通过原有命令操作已部署的 Core，供终端、脚本和后续 AI 使用。

## What Changes

- 让完整的 `piwork-cli` 在 Windows、Linux 上运行，保留登录、Work、配置、Service、包、快照、Operation、Session、Run、Chat、proxy 及 Desktop 命令的既有行为；跨平台支持以实际运行验收为准。
- **BREAKING**：未指定子命令且未使用 `--json` 时，启动现有 Desktop；`piwork-cli --core <url>` 同样适用。原本依赖空命令输出帮助的调用应改用 `help`、`--help` 或 `-h`。显式命令和无子命令的 `--json` 保持原有行为。
- 保留显式 `desktop [--port ...] [--no-open]`、`desktop open`、`desktop logout`。默认启动是 `desktop` 的简写，沿用前台生命周期、端口占用错误和已有恢复方式。
- Core 协议准入按 `allow-http-core-connections` 统一允许合法 HTTP/HTTPS origin，覆盖 Desktop 启动/切换/默认配置及 proxy；不按网络位置或平台拒绝 HTTP，HTTPS 仍校验证书。
- Desktop 增加可保存、读取和清除的默认 Core 配置。启动优先级为参数、环境变量、Desktop 默认配置、既有登录凭证中的 Core、原 loopback 默认值；参数只覆盖本次启动。业务 CLI 继续按原有参数、环境变量、凭证、默认值解析，不读取 Desktop 偏好。
- 增加客户端独立构建与发布入口，内嵌现有 Desktop 资源。Windows 产物为 `.exe`，Linux 产物为对应原生可执行文件；实际构建目标由发布配置表达，需求不限定操作系统版本、发行版或 CPU 架构。
- 为本地私有存储、并发锁、可信控制通道、安全文件访问和发布提供平台实现，保留当前登录用户隔离、原子写入、禁止越界和条件清理的安全保证。

本次只交付连接已有 Core 的用户客户端。Core、Console、Agent/helper 和容器部署的平台范围不变；不引入双击专属流程、启动方式检测、托盘、后台守护或安装器，也不删除或降级业务 CLI。客户端运行不要求安装 Go、Node.js、Python 或 Docker。

## Capabilities

### New Capabilities

- `cli-runtime-portability`：完整客户端在 Windows、Linux 上的运行契约，以及私有存储、本机控制、文件传输、包来源和原生发布的等价保证。

### Modified Capabilities

- `control-cli`：无子命令默认启动 Desktop，明确 Desktop 的 Core 配置优先级，保留业务命令、显式 Desktop 和本机恢复命令的契约。
- `desktop-webui`：在本地授权的连接配置中读取、保存和清除默认 Core，区分当前连接与下次启动配置，完整呈现加载、保存失败和未确认结果。

## Impact

- 客户端入口与依赖：`cmd/piwork-cli`、`internal/cli`、`internal/client`、`internal/pipackage`、客户端可达的 `internal/workpackage` 路径，以及 Desktop 内嵌资源。需要隔离目前同包的 Console 实现及服务端文件操作，避免客户端编译被 Linux 控制面依赖阻塞；不改变它们在 Linux 上的行为。
- 本地状态与安全：沿用登录凭证格式和 Linux 路径，补齐 Windows 用户配置目录及 ACL；新增不含密码或 token 的 Desktop 偏好。并发登录/退出、配置保存、Operation 记录、临时传输和实例恢复均须有原生平台验证。
- WebUI 与 API：修改 `apps/desktop-webui` 和本地 `/_desktop/api/` 连接配置接口，不新增 Core API，不改变浏览器源隔离、Cookie、CSRF、Service gateway 或 WebDAV 协议。
- 构建、发布与验证：新增仅构建用户客户端的入口及原生平台验收，保留现有 Linux 全组件构建和发布入口。客户端发布不依赖构建容器镜像；构建环境工具不成为用户运行依赖。
- 使用习惯：下载相应平台产物后执行同一 CLI；无子命令进入 Desktop，需要帮助时显式请求帮助，自定义端口和禁止打开浏览器仍使用 `desktop` 参数。已有脚本、AI 命令及机器输出保持兼容。
