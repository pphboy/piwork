# Design

## Context

动机见 proposal.md。已核对的实现有四个容易混淆的边界：

- `scripts/build-go.sh` 构建 `./cmd/...`，将七个程序及 `piwork` 符号链接放到同一目录。helper 实际由 Dockerfile 在内部镜像内使用，不需要作为宿主产品交付。
- `internal/app/run.go` 同时负责双 HTTP 服务启动与 `coreoperator.Run` 命令分发。`internal/coreoperator/` 是旧命令适配层；`internal/coreapp/settings.go` 的 EnsureOperator/VerifyOperator 及 `http.go` 的 `/control/*` 是继续保留的服务端机制。
- `internal/webapp/` 通过真实 Core HTTP 复用 `internal/consoleapp/` 的 HostedHandler 和 `internal/cli/` 的 HostedDesktop。独立 Console 入口可以删除，共享页面、管理适配、会话与资源不能整包删除。
- `make release` 目前先构建宿主，再构建 migration/acceptance 镜像；`package-go-release.sh` 只清理同名 stage，检查七个程序并打包三个宿主入口。Docker 候选另有五角色和 CLI Compose 假设；客户端目标另含 Windows。这些路径必须一起收敛。

当前主规格仍要求旧 operator 命令、独立 Console、Windows 原生 CLI 和 CLI Docker；本变更 delta 显式修改这些要求。operator API、Agent mTLS、用户 CLI 的业务命令和 Work 生命周期属于保留能力。

## Goals / Non-Goals

**Goals:** 对外只有两个 Linux 程序；删除退役入口的执行代码与材料；默认值足以启动并连接；本地候选内容明确且可重复生成。

**Non-Goals:** 不删除 operator、用户/admin 鉴权、Work 能力或存储字段；不改造 Agent 协议、快照/历史格式；不为旧命令设计迁移适配层；不增加安装器、自动更新、外部 HTTPS/反向代理方案或新的架构目标；不执行任何外部发布。

## Decisions

### 1. 按入口和消费者删除代码

```text
Browser --> piwork-core : UI HTTP --> Core HTTP --> Store / Docker
                                      ^              |
piwork-cli : Desktop / user commands --+              v
                                               Agent / helpers
```

`cmd/piwork-serve/` 改为 `cmd/piwork-core/`；删除旧别名和 `cmd/piwork-console/`。`internal/app/` 保留启动协调，去掉管理命令分发；`internal/coreoperator/` 的命令解析、env-file、密码交互和离线回退在确认消费者后删除。若其中有仍被产品使用的通用函数，移至现有适当职责包后删掉命令壳，不能整包误删或留下备用命令。

保留 Core 的 operator credential 文件、元数据、生成/校验及 `/control/*` 鉴权；正常管理员继续使用 `/api/v1/admin/*`，网页首次创建管理员继续使用单用途 Setup 委托。管理权限不授予他人的 Work 内容权限。由原生用户 CLI 发起的 Work 操作仍是用户业务，不属于需要删除的 Core 运维命令。

选择直接移除退役入口，不提供 `serve` 子命令、旧二进制软链或重定向命令。保留内部机制也不意味着在 `piwork-cli` 新增管理 Core 的命令。

### 2. Core 只接受三项运行配置

```sh
piwork-core
piwork-core --ui-port 17891 --core-port 17871 --data-dir /var/lib/piwork/core
piwork-cli --core http://server-ip:17871
```

| 输入 | 默认与规则 |
| --- | --- |
| `--ui-port` | 17891；十进制整数 1..65535 |
| `--core-port` | 17871；十进制整数 1..65535 |
| `--data-dir` | 沿用当前 `os.UserConfigDir()/piwork/server`，显式相对路径按启动 cwd 解析为绝对路径 |
| `--help` / `-h`、`--version` | 信息查询，不属于运行配置；不得读写数据、请求秘密、连接网络或启动 listener |

端口不得相同或与固定内部 RPC 7172 冲突。重复参数、空值、未知参数、额外位置参数和退役子命令均在副作用前以 usage exit 2 拒绝，错误不回显可能的秘密。版本查询直接使用 buildinfo/releaseinfo，不再借 coreoperator 分发。

删除 `--listen`、`--core-listen`、`--public-origin`、`--tls-cert/key`、`--allow-insecure-remote`、`--no-open`、`--docker-host/context`、`--agent-grpc-listen/advertise`、三个 helper-image 参数及所有管理命令全局参数。镜像引用由制品元数据固定；测试在测试构建时注入引用或使用内部测试 Options，不能给产品留隐藏参数。

系统设施继续使用现行 Docker Unix socket/context 选择规则；可选成对 ADMIN 测试初始化按现有契约保留，它们不是本次删除命令的替代入口。不得将删除的参数重新包装为新的 PIWORK 环境变量或配置文件。默认不需要任何业务环境变量。保留现有尽力打开浏览器行为，缺少图形环境/打开器时打印 HTTP 地址并正常运行，不新增宿主必需依赖。

### 3. HTTP 默认监听与地址行为确定

UI 固定绑定 `0.0.0.0:<ui-port>`，Core 固定绑定 `0.0.0.0:<core-port>`。这是在仅允许端口配置的条件下支持外部 CLI 的必要默认行为；继续默认 loopback 再要求 `--core-listen` 会违背三参数契约。ControlPlane 后端固定连接 `http://127.0.0.1:<core-port>`，不使用浏览器 Host 或 Forwarded 选择上游。

UI 和 Core HTTP 不加载证书、不提供 HTTPS 模式或跳转。内部 WorkServices 沿用 `0.0.0.0:7172`、`piwork-core:7172` 容器回连及现有 mTLS 身份校验，属于内部协议，不是新增用户参数。此处不改变模型/外部 MCP 的 HTTPS 或通用客户端 URL/CA 功能。

替换 `internal/webapp/server.go` 当前唯一固定 origin 的匹配方式：

- UI 接受本机 IPv4、IPv4 loopback、localhost 和本机主机名对应的合法 authority，端口必须为 UI 端口；本机网卡地址集合由服务端取得，不通过请求提供的任意 DNS 名称扩展。
- 请求 origin 由验证后的 authority 和固定 http scheme 构造；需要 Origin 的请求严格匹配本次入口并继续校验 CSRF、Sec-Fetch-Site。会话及内容授权绑定创建时的 origin，换 IP 访问需重新建立该 origin 的会话。
- 相对链接优先；必须生成绝对地址的上传、Service、事件和 WebSocket 路径使用已验证的当前 origin。不能只修改顶层 Host 校验而让 HostedHandler/HostedDesktop 继续使用另一个固定 origin。
- 不信任 Forwarded/X-Forwarded-*，不新增任意公网域名、NAT 或代理 origin 配置。本次实际验收是本机与另一网络客户端通过服务器实际 IPv4；通用 IPv6 URL 解析保留，不新增 IPv6 监听承诺。
- 输出 loopback 和可用网卡地址供使用，不输出 0.0.0.0 作为访问 URL；多网卡中的任一合法实际 IP 都能完成引导和登录。

启动器统一拥有 UI/Core/RPC listener、数据锁、后台 goroutine 和恢复过程。任何必需 listener 绑定失败或异常结束均进入有界清理；不自动换端口，不能留下半启动服务。继续保留空安装健康/引导可用、依赖未就绪如实报告、正常关闭停止本安装 Work 并保留持久意图的契约。隔离验收若需并行多安装，使用独立网络命名空间，不能通过增加第四个产品参数解决固定 RPC 冲突。

### 4. Linux 原生客户端与 Core-only 容器交付

当前发行目标统一为 linux/amd64，沿用已有 Docker 和原生发行目标，不把 Linux Only 自动扩大为所有 CPU 架构。保留 `make build-cli` 的独立 Linux 构建能力，不要求构建 Core 或镜像；客户端发布复用相同清单/身份规则。

移除 config/cli-release-targets.json 中非 Linux 目标，以及 Windows 专用文件安全、命名管道、信号、路径和测试夹具，清理仅服务它们的依赖。保留 Linux owner/0700/0600/flock、Unix socket peer UID、本机恢复、凭证和 Desktop 偏好规则。不能以平台精简删掉用户 CLI 的 Work、文件、会话、快照或 proxy 能力。

删除 Dockerfile.cli、CLI entrypoint、CLI Compose/overlay/client env 模板、CLI 专用状态卷与 exchange 教程，以及 internal/cli/container_mode 的专用分支。旧容器模式变量不再读取；它不能使原生 Desktop/proxy 绑定到通配地址。单机示例仅运行 Core，客户端示例改为 Linux 宿主上的 `piwork-cli --core ...`；同机 UI/CLI Desktop 默认端口冲突继续按 CLI 原有 `--port` 选项显式处理。

Docker 候选角色改为 core、agent、fileHelper、snapshotHelper，packageHelper 仍复用 Agent。需要同步 build-docker-release、collect、preflight、材料生成和对应测试，不能只删除 Dockerfile 而继续要求第五角色。

### 5. 构建与发布使用确定文件集合

`build-go.sh` 显式构建两个目标到同文件系统的新暂存目录，检查成功后替换受管宿主输出目录；成功后的 `dist/go` 只有两个程序。不再 `go build ./cmd/...`，镜像 Dockerfile 继续独立编译对应 helper。配置输出目录的清理需拒绝仓库根、父目录、用户目录、链接目标和不受管位置，不能将可配置路径直接交给无边界递归删除。

`make release` 改为有依赖顺序的单一编排，不能让 make -j 下的镜像/宿主/打包互相竞态：

1. 确定本次源码/版本/dirty/资源/协议输入身份，构建并验证生产 Agent/helper，生成同一候选依赖元数据。
2. 用该元数据构建 Core 和 CLI，Core 内嵌的引用必须与本次镜像集合一致；随后构建需要分发的 Core 镜像和 Core-only 材料。测试/acceptance 镜像不作为默认发行输入。
3. 在私有暂存目录按白名单组装、检查两个 ELF、CGO=0/无动态宿主依赖、UI、版本、镜像身份、文档链接和 checksum。
4. 所有步骤成功后提交新的本地 release 成品；失败清理本次暂存并保留上次完整成品。替换使用同文件系统 rename 与可恢复旧目录切换，禁止先删除旧成品再尝试打包。恢复时只处理有明确归属的 stage/previous，不能把部分结果认作完成。

本地候选采用 0.0.10，并添加对应 Core/Desktop 更新日志；0.0.9 及更早版本日志和已发布身份保持原值，候选日志不填写正式发布日期。本次沿用版本化 `piwork-linux-amd64-<commit12>` 名称，最终 `dist/release` 仅保留本次完整展开目录、对应 tar.gz 和外部 checksum。上次完整成品只在替换期间作为恢复备份，成功后清理；开发者如需长期保留应自行移至该受管目录之外。

包内采用明确清单：`bin/piwork-core`、`bin/piwork-cli`、LICENSE、当前双语使用材料及必要图片/模板、构建及镜像清单/校验。当前离线 Agent/helper 镜像若随包交付，仅按生产镜像 ID 去重打包；Core Docker 候选另按同一输入记录。发布目录不包含旧别名、Console、宿主 helper、Windows/其他平台包、验收镜像/报告、源码目录或 OpenSpec 历史附件。`stage-go-release-materials.mjs` 保留链接有效性核验，但不能沿 README 开发导航无限复制规格与历史；必要未提交材料按明确清单随包携带，无法安全提供的链接使打包失败，不伪造 commit 外链。

保留候选与 published 身份区分。make release 不推送，不改写 deploy/docker/releases 中旧记录。仅处理本地发布成品，不清理 Core 数据、凭证、Work 卷、其他 Docker 安装或已发布标签。

### 6. 材料与验收从新入口进入

更新 Makefile/package.json、Dockerfile.core、deploy/docker 双语手册、Core-only Compose/模板、examples/single-host 及说明、scripts/docker-quickstart-content.mjs、sync/check 脚本和官网隔离生成。根 README 仅改平台和导航；AGENTS.md 更新架构、入口及验证命令。同步操作不发布网站，不能把新命令配到不支持它的旧 published 镜像。

`native-test-server.mjs`、`native-host-acceptance.mjs` 和浏览器夹具迁移到 piwork-core。安装验收通过网页引导和管理员 API 配置；独立 operator API 仍单独验证其身份边界，不重新造一个仅为测试保留的旧命令程序。保留共享管理 UI 和 Desktop 浏览器测试，删除只验证退役语法/平台的正向用例，增加旧参数无副作用拒绝用例。

验收重点是：两程序清单；三参数与旧入口拒绝；多网卡 HTTP、外部 CLI、双 HTTP 与内部 RPC 失败清理；operator/user/admin 权限；UI 完成初始化、配置与 Work 流程；退出及重启恢复；CLI 原生本机安全；重复发布、残留污染和失败保留；四角色候选预检；双语及官网生成一致性。沿用真实 SDK/Engine/浏览器回归，不用编译成功替代实际运行。

## Risks / Trade-offs

- [删除命令误伤后端] → 按调用关系移除适配层，保持 operator 凭证、/control 和 admin API 的契约回归。
- [默认 Core 对外可达] → 在三参数条件下支持远程 CLI，保持现有认证授权；材料准确说明两个 HTTP 端口用途，不声称 Core 仍仅监听 loopback。
- [多入口 origin 改动波及 Service/上传] → 将已验证 origin 贯穿会话、管理适配和工作台；同时验证跨站拒绝与多个真实网卡访问。
- [RPC 固定端口限制同网络多实例] → 明确 7172 为内部依赖，冲突整机启动失败且完整清理；测试多实例隔离网络。
- [发布清理删错路径或破坏上次产物] → 只管理已确认构建目录，白名单组装、成功后切换、故障注入验证恢复；不触碰业务数据和历史发行。
- [旧规格仍要求被删功能] → 以本变更所有 delta 为有效修改集合；apply 核对命令、平台、示例和主规格引用，最终同步时更新过时 Purpose，保留历史归档事实。

## Migration Plan

按入口、平台/容器、构建发布、材料及验收的依赖顺序实施。发布包升级时替换程序与启动命令，旧命令不提供适配；继续使用相同数据目录和现有 operator/用户存储，无新增 schema 或自动迁移。Core Docker 继续同绝对路径挂载，正常停止旧实例后切换，禁止同时打开同一安装。

本地候选失败保留上次完整输出；运行回退使用原制品和其对应命令，不添加新程序兼容开关。此变更不改变数据格式，若实施中出现格式改造需求应先重新评估范围，不能借精简发布引入。真正推送、发行或官网部署需后续单独的用户请求。


## 后续主规格同步

apply 保留主规格文件，后续 sync/archive 同步上述 delta 时一并替换四个过时 Purpose：

- cli-runtime-portability：Linux amd64 原生用户客户端、Desktop、本机安全、恢复与实际运行验收；不再承诺 Windows 原生交付。
- control-cli：独立 Linux 用户 CLI 连接已有 Core，保留业务命令、身份与输出契约；Core 管理由网页及受保护 API 承担。
- serve-ui：Core 内嵌管理控制面与统一 HTTP 浏览器入口，不再描述独立 Console 程序。
- docker-delivery：Core 单入口容器、生产 Agent/helper 四角色候选及独立 Linux 原生客户端；不再描述 CLI 容器。
