# Piwork Docker 安装与使用

[English](README.md) | **简体中文**

一个 Linux 应用提供 Core、完整网页工作台、管理和首次设置；CLI 为独立可选工具。

本版应用 Service 不设置 Piwork 内存上限或 Service 内存预留；CPU、服务/卷数量及 Agent/helper 内存政策仍有效。旧 Service memoryBytes 仅保留为兼容历史，memoryLimitMode / serviceMemoryPolicy 明确为 unlimited，零不表示零字节额度。正常关闭并启动新版 Core 后，受管恢复替换旧受限 Service 容器并保留 workspace。详见[资源与升级说明](https://github.com/pphboy/piwork/blob/main/openspec/specs/core-service-startup/spec.md)和 [Web base 手册](../images/web-base/README.zh-CN.md)。

## Docker Quick Start

<!-- docker-quickstart:start -->

Linux x86-64、rootful Docker Engine 28+。运行一个容器即可提供工作台、管理和首次设置，无需环境变量或客户端 CLI：

本版固定镜像包含直接访问与网页配置流程。

```sh
docker run --detach --init \
    --name piwork-core-quickstart \
    --network host \
    --restart unless-stopped \
    --stop-timeout 60 \
    --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
    --volume /var/lib/piwork/quickstart/core:/var/lib/piwork/quickstart/core \
    docker.io/pphboy/piwork-core:0.0.13-c48a40daf766-19451f0a08fc
```

在本机或另一台电脑直接打开 `http://服务器IP:17891`，使用服务器实际 IP。空安装会显示创建管理员；已有账号时正常登录，无需终端授权链接。

浏览器创建管理员时输入密码及确认密码，随后正常登录进入 Admin 的 **Quick setup**（`/admin/setup`）。按两步引导填写模型 ID、API 类型、Base URL 和 API Key，或选择已保存模型，点击 **Save and continue**，顺序保存模型并绑定 CoreRuntime。准备页面会自动更新；全部依赖显示 Ready 后，点击 **Open workbench** 进入 Piwork。Agent 镜像随服务端版本内置并自动使用，无需也不能手填、选择或高级覆盖。模型 Test 是显式可选操作；保存不自动调用模型。打开工作台创建 Work，然后聊天、管理文件或打开 Service。后续从 Admin **Overview → Quick setup** 返回配置；顶栏 **Workbench** 可随时返回工作台，准备区的完成按钮仍需等待全部 Ready。已保存的账号、模型和 Work 在重启后保留。

同一进程提供两个 HTTP 服务：UI 默认 `0.0.0.0:17891`，Core 默认 `0.0.0.0:17871`。浏览器只连接 UI，所有文件、事件及 `/services/<workId>/<serviceId>/<port>/` 使用同一入口；后端固定通过 loopback HTTP 连接 Core。外部 Linux CLI 直接连接服务器 Core 端口。仅使用 --ui-port/--core-port 改端口。UI 接受本机实际 IPv4、localhost、回环和主机名，校验 Host、Origin 与 CSRF，不信任 Forwarded；切换地址需独立登录。只提供 HTTP，不提供 HTTPS、域名或反向代理配置。内部 Agent 保留容器可达的 7172 mTLS 回连。用户 Service 不发布宿主端口，模型端点须从 Work 网络可达。

托管 Service 与工作台同源，须视为可信应用；其脚本可使用当前用户的 UI 权限。应用须支持动态 Service URL 前缀；旧根路径应用不会自动改写源码、镜像或包。Service 支持响应 Cookie 的服务端登录、Basic/Bearer、HTTP、SSE 和 WebSocket。响应 Cookie 按浏览器会话及 Service 保存在服务器，HTTP 入口不转发 Secure Cookie。依赖 document.cookie/Cookie Store 读写（如脚本读取 CSRF Cookie）的应用不保证透明兼容；脚本写入浏览器 Cookie 也不保证同 IP 跨 Service 隔离，且不会转发上游。不支持硬编码 .work URL、跨站 SSO 或上游 HTTPS 的透明适配。应用 CSP/X-Frame-Options 保留；禁止嵌入时使用新标签页。

可选 [Compose](docker-compose.yml)（2.24+）和 [单机示例](../../examples/single-host/README.zh-CN.md) 同样直接进入网页；CLI 是高级可选工具。运行与恢复见 [安装手册](#terminal-operations)。

<!-- docker-quickstart:end -->

## Native Linux application

<!-- native-quickstart:start -->

先按[开发入口](https://github.com/pphboy/piwork/blob/main/AGENTS.md#构建与验证)构建当前源码，再从仓库根运行；发行程序也可离开源码目录使用。原生程序仅支持 Linux x86-64。

```sh
./dist/go/piwork-core
```

Core 自带管理 UI、工作台和首次设置。只接受 `--ui-port`（17891）、`--core-port`（17871）、`--data-dir`（用户配置目录下 piwork/server）三项运行配置；`--help`、`--version` 仅查询信息。端口为 1–65535，必须不同且不能使用内部 RPC 7172。相对数据路径相对当前目录解析。

```sh
./dist/go/piwork-core --ui-port 17991 --core-port 17971 --data-dir /var/lib/piwork/custom/core
```

使用其中一种启动方式。打开输出的 HTTP URL 创建管理员，登录 Admin 的 Quick setup 配置模型和运行环境。无图形环境可手工打开该地址。Ctrl+C 正常关闭会停止本安装受管 Work，保留数据、历史和运行意图；重启复用相同数据路径。

Linux 原生客户端默认启动 Desktop，连接已有 Core；同机 UI 已占用 17891 时显式使用另一 Desktop 端口。客户端无需 Docker，不启动或停止 Core。

```sh
./dist/go/piwork-cli --core http://127.0.0.1:17871 desktop --port 17901 --no-open
```

在本机浏览器打开 `http://desktop.localhost:17901/`。Desktop 与用户命令共享凭据，Desktop 默认 Core 偏好独立；业务命令依次选择 --core、PIWORK_CORE_URL、已保存凭据、默认本机地址。关闭浏览器或 CLI 不停止 Work。Windows 浏览器也可直接连接 Linux Core UI。

<!-- native-quickstart:end -->

## Core Compose Demo

<!-- core-compose-demo:start -->

可选 Compose Demo 使用独立数据目录 `/var/lib/piwork/core`，正常停止占用相同端口的安装后再启动。模型和管理员仍在网页设置。

```sh
PIWORK_CORE_IMAGE=docker.io/pphboy/piwork-core:0.0.13-c48a40daf766-19451f0a08fc \
    docker compose -f compose.core.yaml up --detach --wait --wait-timeout 600 core
```

<!-- core-compose-demo:end -->

## Terminal operations

<!-- terminal-operations:start -->

进程健康与运行环境就绪分开：未完成网页初始化时 /healthz 可用，/readyz 尚未就绪。用户、模型、运行环境和依赖准备在内嵌 Admin 完成；operator 凭证和受保护管理 API 保留，用户 CLI 不读取 operator 凭证。

```sh
curl --fail http://127.0.0.1:17891/healthz
docker logs --tail 100 piwork-core-quickstart
```

Core 还会在其数据目录的 `logs/core/` 下保存私有进程日志。每次启动新建 `core-<bootId>-<segment>.jsonl` 分片；分片达到 16 MiB 轮转，安装最多保留 256 MiB、7 天，文件约每秒同步，并在轮转、导出边界和正常关闭时额外同步。保持 Core 数据卷挂载即可在容器替换后保留这些分片。文件覆盖从取得安装目录锁后开始，包含受管诊断、性能事件、标准应用日志及启动/关闭记录；`--help`/`--version`、非法启动参数、取得锁之前的错误以及应用日志设施之外的原生运行时崩溃仍只出现在控制台/stderr，不构成完整原始 stderr 捕获。

删除或替换 Agent/Service 实例前，Core 会把该精确实例保留的 stdout/stderr 归档到数据目录的 `logs/works/`。归档保留 7 天，每 Work 至多 512 MiB、每安装至多 2 GiB，优先清理最旧且无引用的归档。本版本之前已替换或删除的容器无法回填；已有容器继续按实际日志驱动读取，仅新建 Agent/Service 使用 16m × 4 的 json-file 有界策略。同样需保留数据卷。

管理员可从 Linux CLI 或 Desktop 账户菜单的 **Export logs** 导出 Core 安全平台日志及自己全部 Work 日志，导出不会停止或 Apply Work。CLI：`piwork-cli --core http://SERVER_IP:17871 login --account admin`，`piwork-cli --core http://SERVER_IP:17871 logs export --output ./piwork-logs.zip`；用 `logs show EXPORT_ID` 与 `logs download EXPORT_ID --output FILE` 恢复原任务。结果包自就绪起保留 24 小时；部分结果保持 complete=false，并在 manifest.json 列出缺口。关闭 UI 面板或中断 CLI 不会取消已接受的 Core 任务。GUI 全流程无需运行命令；下载 ZIP 后由用户手工发给可信维护者，本功能不自动上传。

同一进程提供两个 HTTP 服务：UI 默认 `0.0.0.0:17891`，Core 默认 `0.0.0.0:17871`。浏览器只连接 UI，所有文件、事件及 `/services/<workId>/<serviceId>/<port>/` 使用同一入口；后端固定通过 loopback HTTP 连接 Core。外部 Linux CLI 直接连接服务器 Core 端口。仅使用 --ui-port/--core-port 改端口。UI 接受本机实际 IPv4、localhost、回环和主机名，校验 Host、Origin 与 CSRF，不信任 Forwarded；切换地址需独立登录。只提供 HTTP，不提供 HTTPS、域名或反向代理配置。内部 Agent 保留容器可达的 7172 mTLS 回连。用户 Service 不发布宿主端口，模型端点须从 Work 网络可达。

托管 Service 与工作台同源，须视为可信应用；其脚本可使用当前用户的 UI 权限。应用须支持动态 Service URL 前缀；旧根路径应用不会自动改写源码、镜像或包。Service 支持响应 Cookie 的服务端登录、Basic/Bearer、HTTP、SSE 和 WebSocket。响应 Cookie 按浏览器会话及 Service 保存在服务器，HTTP 入口不转发 Secure Cookie。依赖 document.cookie/Cookie Store 读写（如脚本读取 CSRF Cookie）的应用不保证透明兼容；脚本写入浏览器 Cookie 也不保证同 IP 跨 Service 隔离，且不会转发上游。不支持硬编码 .work URL、跨站 SSO 或上游 HTTPS 的透明适配。应用 CSP/X-Frame-Options 保留；禁止嵌入时使用新标签页。

可选测试初始化：仅 PIWORK_ADMIN_ACCOUNT 与 PIWORK_ADMIN_PASSWORD 成对有效时创建空安装首管理员；已有账号不被覆盖。默认安装无需业务环境变量，模型和镜像不从初始化 env 读取。

在 Linux 客户端终端指定已有 Core 的地址，密码交互输入。ACCOUNT、WORK_ID 来自网页账号和创建结果：

```sh
export PIWORK_CORE_URL=http://SERVER_IP:17871
piwork-cli login --account ACCOUNT
piwork-cli work create --name 'My Work' --wait
piwork-cli chat WORK_ID --message 'Hello, Piwork!'
```

未知修改先读回状态，用原 Operation/Run ID 恢复，不重复创建或发消息。文件和包直接使用客户端本地路径，无交换卷。

```sh
piwork-cli operation show OPERATION_ID
piwork-cli run watch WORK_ID RUN_ID --after SEQUENCE
```

Core 正常关闭会停止本安装受管 Work，保留身份、历史、卷和运行意图。关闭网页或 CLI 不停止 Core 或 Work。

```sh
docker stop --time 60 piwork-core-quickstart
test "$(docker inspect --format '{{.State.ExitCode}}' piwork-core-quickstart)" = 0
docker start piwork-core-quickstart
```

```sh
docker compose -f docker-compose.yml stop core
docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core
```

保留同一 Core 数据目录及匹配 Work 卷。升级先正常停止并备份一致数据；保留原镜像引用和清单，格式兼容时才可回退。不要使用 down -v 或全局 prune。Work 导出不是安装备份，导出前须 Stop，导入后显式 Start。

<!-- terminal-operations:end -->