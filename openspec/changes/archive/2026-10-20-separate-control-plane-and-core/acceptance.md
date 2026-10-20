# 实施验收记录

## 首轮主验收候选身份与范围

本节至“Verify 后续补验”之前的记录属于首轮候选。后续补验使用新的候选身份，单独列出实际执行结果，不将首轮记录改写为新候选的通过证据。

本次在 Linux amd64 上完成源码实现、构建和本地验收；未 commit、push、发布镜像或部署外部官网。验收使用通配监听及实际局域网 IP，不依赖公网或 DNS。

- source commit：`9a40d4443fee559335485744d0aabbf186e24b38`；`sourceModified: true`。
- 最终 release ID：`0.0.8-9a40d4443fee-7d9faa98422f-dirty`。
- source input hash：`7d9faa98422f675dcf04718305f0c6a462343d1fa610b5c7124d952c2fe6ac16`。
- Desktop UI hash：`9e60f2cd1b88838d0a2090d6f3f02f3b28ef46aca87288d9c0eeb6f50d7a0e34`。
- Console UI hash：`07b891d332991ed24bf0210ec940a654a68d25f5ab52362cee6f62c0f9947e4b`。

以下均为本地构建镜像 ID，不冒充 registry digest。镜像 tag 使用上述 release ID，完整输入与材料位于 `dist/separate-control-plane/release-inputs/` 和 `dist/separate-control-plane/docker-materials/`。

| 镜像 | image ID |
| --- | --- |
| Core | `sha256:01a07dda49aed3586ab1adb4e69c70530bc761cb292869d937c6cb7232e68bac` |
| CLI | `sha256:7382c7e46531659af7f81dfb0d7acd69a296f5504f3f381c6a014bd852339677` |
| Agent | `sha256:2c55f1a6c57fbcb95395881a130272580ea82960b9e1aba25c15f5f5a5997a7d` |
| File helper | `sha256:1c78d71d88817cfef4b916412b2fd2d47742412d0deb7037b2a4fef80d10cf3e` |
| Snapshot helper | `sha256:d4a96e3a19ed75f4438b604b29d808917dda46ddcdce69298351d15d61da4ac0` |

前缀 Web base 使用本地候选 `docker.io/pphboy/piwork-web-base:0.2.0-9a40d4443fee-9286afd39f8e-dirty`，image ID 为 `sha256:67d72e7c72274981fcded1c902230ce3c1361888aa6a1f95c0292b9e6829a966`，input hash 为 `9286afd39f8ed10ee0214f4197e8eb790a0dd7104119ff3047cfa029fc58df0e`。旧公开 base 的发布身份保持不变，Reference 明确其 `hostedPathSupport: false`；新候选独立标记为 localCandidate，不宣称已公开可拉取。正式发布时仍须发布支持前缀的 base 并绑定其真实发布身份；本次 apply 不执行该外部发布。

## 双服务与首次使用

最终候选分别完成原生二进制、Docker run、Compose 三种独立空安装：

1. ControlPlane 监听 `0.0.0.0:17891`，通过实际局域网 IP 打开。Core 默认 `127.0.0.1:17871`，两个真实 TCP server 共用一个进程生命周期。
2. 未注入 ADMIN 或模型业务环境变量。首次页面创建管理员，验证两次密码不一致的提示及一致后的成功创建，然后正常登录。
3. Admin Quick setup 通过网页保存私有 `.env.test` 的真实测试模型配置，使用版本绑定的 Agent 默认镜像，等待准备完成。
4. 创建 Work，收到真实模型回复；浏览器请求记录没有跨到 Core、容器地址或额外 Service 端口。
5. 文件写入成功返回 201；过期条件写入返回 412，重新读取确认原字节保留。
6. Compose 容器健康状态 healthy，host 网络，实际 image ID 与最终候选一致；Core status 经独立 TCP 读取，`hasUsers: true`。

主机已有其他安装占用 Agent RPC 7172，验收安装显式使用 `--agent-grpc-listen 0.0.0.0:27172`。产品默认 7172 未改变，真实 Agent mTLS 回连及模型执行均实际发生；没有通过禁用内部 RPC 达成浏览器单端口。

记录：`dist/separate-control-plane/{native,docker,compose}-browser-result.json`、`compose-health-result.json`。浏览器为 Linux Chromium `156.0.8078.4`。

## Service、文件与包

最终 Docker 候选上的真实 Service 验收覆盖：

- 同一 17891 下的多个 Service，经 ControlPlane → Core resolve/gateway 转发；默认端口从 Service 定义选择，未填端口的官方应用正确选择 8080。
- 两个应用的同名响应 Cookie 分区保存，登录、删除及过期可用；平台 Cookie 和伪造转发头不进入应用。应用 Authorization 和应用自身 401 保留。
- 接受的同源信任边界得到实测：Service 页面可访问当前用户 UI 接口、脚本 Cookie 属于共享来源；上游 Cookie jar 不使用浏览器任意 Cookie。此模式不承诺 Service 脚本相互隔离。
- HTTP、流式 SSE 和双向 WebSocket 实际可用；禁用 Service 后活动 SSE/WS 撤销记录为 167 ms，小于两秒。
- 官方 web-app/workstation 使用本地前缀 base，资源、业务操作、Socket.IO、深链接刷新、草稿恢复正常；两个应用草稿不串用，新登录身份清理旧身份草稿。
- 官方反馈实际送达 Agent，取消操作成功。
- 两个用户使用独立浏览器身份，第二个管理员访问他人 Service 返回 404；禁用用户后托管会话在两秒内失效。

最终候选完成 Stop → Export → Inspect → Import → Start。恢复后比较捕获镜像、导出前源码字节、文件哨兵和业务数据；新 Work 的路径前缀、资源和 Socket.IO 仍可操作。另用合法旧根路径 Service 验证：安装/导入保留原镜像及源码，HTML 不被改写，未适配前缀的根路径脚本返回 404；不存在托管端口池或透明源码重写兜底。

记录：`docker-services-result.json`、`docker-package-result.json`、`docker-recovery-result.json`、`legacy-result.json`，均位于 `dist/separate-control-plane/`。原始 Cookie、token、模型密钥、安装数据和包含模型配置的 `.work` 留在被忽略的私有测试目录，不进入本记录或 Git。

## 原生客户端与生命周期

Linux bridge 网络中的独立 CLI 实际使用显式开放的 Core 17871，只挂载客户端状态卷，未挂载 Engine socket 或 Core 数据。登录、whoami、Work、Service、Session、包及退出通过。独立 Desktop 使用显式 17901，直连 Core 17871 并保留原 Host-based Service 入口；与托管 ControlPlane 17891 并存。

这些独立入口实测记录为 `remote-cli-result.json`、`desktop-result.json`，前者使用本轮较早候选 `0.0.8-9a40d4443fee-c1ee19716542-dirty`，不冒称最终镜像记录。最终候选另通过独立 CLI 执行完整包生命周期及 Core 身份调用，相关客户端实现与上述独立网络验收之间未再变更。

正常退出只停止对应 installation 的全部 Work/Service，保留数据及恢复意图。最终原生、Docker、Compose 退出耗时分别为 5.774、28.792、5.863 秒；Docker 重启前关闭为 31.520 秒，均在总关闭预算内。最终 Docker 重启后旧浏览器会话失效，导入的 Work 自动恢复，无需发送新 Start，再次登录后应用及数据可用。

真实进程测试及 Go 测试覆盖 SIGTERM、重复信号、启动取消、任一 listener 异常、端口冲突与锁释放。测试结束只删除本次安装已停止的空网络，所有测试受管容器均停止；其他安装未清理。

## 回归与构建

- `go test ./...`：完整通过，最终记录 `dist/separate-control-plane-go-final.log`。
- app/webapp race 回归及最终 app/webapp/cli 重点 race 检查通过；最终记录 `dist/separate-control-plane-final-race.log`。
- Desktop 浏览器完整套件：880 项，879 通过、0 失败、1 跳过，耗时 231 秒；最终单次完整通过记录 `dist/separate-control-plane-desktop-complete.log`。跳过的是可选真实 Engine 用例，其实际 Engine/固定依赖/创建 Work 流程已由上述三种安装的独立真实验收覆盖。
- Admin Playwright：79 通过。
- Quick Start 检查器测试：41 通过；发布材料、原生边界及 CLI 入口相关测试：15 通过。
- Web base 工具：22 通过；两种官方模板的真实前缀浏览器夹具通过。依赖给出既有 Starlette/httpx 弃用提示，不影响结果。
- 两套 WebUI 及嵌入资源、Go 程序、本地 Core/CLI/Agent/helper 镜像、前缀 Web base 均已构建。Linux/Windows CLI 构建通过。
- 候选材料从最终输入重新生成，并由镜像身份校验及 Quick Start 检查器验证；双语官网仅生成到隔离预览目录。

实际平台证据为 Linux 浏览器、Linux 原生/容器服务端及 Linux CLI。Windows 仅有 CLI 编译结果，未执行 Windows 原生 CLI 或 Windows 浏览器，不宣称这些运行验收通过。

## 验收过程中修正的夹具问题

- 浏览器回归夹具原先使用默认 Core 17871，与正在运行的验收安装冲突；改为独立随机 Core 端口。两个账户菜单断言同时改为真实 Core 地址，避免继续期待旧的 UI origin。
- Docker 空数据目录最初属于宿主用户，触发容器私有目录所有权检查；仅调整本次空测试目录所有权，未放宽产品检查。
- 主机 Docker 默认地址池容量不足；仅释放本次已停止 Work 的空网络后导入新 Work，未全局 prune 或清理其他安装。
- 手工 Service 夹具漏写官方反馈所需的 `.pi/services/` 连接声明；补齐夹具后反馈送达及取消通过。原失败记录保留，不将该失败改称支持限制。
- 较早候选的一次模型调用失败，显式创建新 Run 后成功；最终原生、Docker、Compose 的真实回复记录均通过。

## Verify 后续补验：WARN 2、WARN 3 与 SUGGESTION

本轮按所有者要求处理上述三项。WARN 1（独立客户端网络只放行浏览器端口的完整验收）在该阶段尚未处理；以下结果不替代该项，后续补验结论见本文末尾。没有新增产品或架构决策，没有对外发布。

### 新候选身份与文案清理

删除 Desktop Adapter 的 `SERVICE_ORIGIN_CAPACITY` 与 `SERVICE_ORIGIN_STORAGE_UNAVAILABLE` 旧文案；浏览器资源不再提示扩容已移除的 `--service-ports`。重新构建两套 WebUI 嵌入资源、原生程序、Linux/Windows CLI 和五个镜像候选，并同步双语部署材料、Compose/单机示例、发行清单及隔离官网预览。首轮发布/候选身份保持原值。

- 新 release ID：`0.0.8-9a40d4443fee-7c66a287e30c-dirty`。
- source commit：`9a40d4443fee559335485744d0aabbf186e24b38`，modified 为 true。
- source input hash：`7c66a287e30c88b96c303ec92cd4df1afc75f37efee467686b80e101bd700acd`。
- Desktop UI hash：`6a5b97925f8ec03d8b4a7f9edb21a03e3bdff53615d24a0cf55c995d8ffa58aa`；Console UI hash 保持首轮值。
- Core image ID：`sha256:b7bf2c1d62d4c560e2b95598e0a729aa27c567c7dd8e530edc4491f749c92599`。
- CLI image ID：`sha256:9d6f271cce1c3602ecd48cf6d0a9ea89397a496ba318211dee81c3c2c957466b`。
- Agent image ID：`sha256:52334ee1732890c265bdd191c21cc52957a4ff811bc2b06dd414b0e370d4a63a`。
- File helper image ID：`sha256:6daccf6484db1a6c9559b0d61d5b96dc51bb5b70ee97a0dbdebbbf483dbd83c3`。
- Snapshot helper image ID：`sha256:0c42cf181dc9202cac63f53d886285053a8e7000b39ac6e804e7a3275e84a162`。

新输入、镜像记录、打包材料及本轮日志位于 `dist/separate-control-plane/followup/`；记录的是本地 image ID，不冒充公网 registry digest。Web base 使用首轮相同的前缀候选及其原 image ID。

### WARN 2：两套独立空 Engine 的安装闭环

可复现夹具为 `fixtures/cold-install.mjs`，从仓库根使用 Node 24 执行。夹具读取本机私有 `.env.test`，配置只通过网页保存，不把模型变量传给产品容器；模型秘密、密码和 token 不写入本验收记录。

Docker run 和 Compose 分别使用独立 Docker Engine 28.5.2、全新 Engine 数据卷及安装卷。每套 Engine 开始时镜像数为 0，只加载本轮 Core 安装镜像；开始网页配置前确认 Agent、file helper、snapshot helper 均不存在。三个依赖均由产品准备流程从只用于本次测试的本地 registry 拉取，并核对实际 image ID 与上述候选逐一一致。没有把依赖预先 load 到安装端，也没有清理宿主 Engine 缓存。

两种方式均通过默认 ControlPlane 17891、默认 Core loopback 17871、默认内部 Agent RPC 7172 运行；浏览器使用独立服务端 Engine 的实际 bridge IP，无 public-origin 覆盖、业务 env 或安装授权链接。分别完成网页创建管理员、普通登录、Quick setup、固定 Agent 默认、依赖 Ready、创建 Work 和真实模型回复。Docker run 与 Compose 的回复均为 9 字节，属于两个独立 Run；浏览器记录分别有 377、243 个请求，越出所属 origin 的请求数均为 0。

上述“独立”描述服务端 Engine/缓存及安装数据隔离。浏览器仍运行在宿主机，本轮不据此宣称独立客户端网络防火墙验收通过。原生 CLI 的 Windows 运行和 Windows 浏览器也未新增实机证据。

两套安装均正常停止 Core，并确认对应 installation 没有运行中的 Work/Service。随后仅删除本次创建的 Engine、registry、其数据卷及本地 registry 别名；未向原体验实例发送停止或重启操作，收尾时健康检查通过。最终记录为 `run-cold-result.json`、`compose-cold-result.json`、`cold-install-result.json` 和 `local-registry.log`。

### WARN 3：前缀下自动采用新页面

在同一本轮 Docker run 候选和真实 Core gateway 上创建两个官方模板 Service，均使用未改写的前缀 Web base。两个应用在同一浏览器会话的独立页签中分别保存未提交草稿；第一个应用进入自己的 `/services/<work>/<service>/8080/review`，随后修改该应用 workspace 内的 `ui.py` 标题并按原 Service restart 流程加载新代码。

没有调用浏览器手动 reload；页面自动显示新标题。实际加载的 codeVersion 从 `ad5cbd741b7a4d85cc129276d77e093162eb500444d33b6aa482105e23671931` 变为 `e0f8b160229160cb89e9429a5deb7d3b1bffc5d37411d82d1707a95b415dca81`，frontendVersion 从 `f0dcdc2280abdd998ccba42b201e332e08889f64fd9997247fb4abf943fc1f6b` 变为 `3a7aa88dc610ecb01285b9ea98bf1bf21c33064caf17d28aa837be328ebee94d`。

确认更新后仍处在原深层路径，返回 Todos 后原草稿保持；第二个应用切回可见并完成轮询后，文档导航次数仍为 0，页面挂载标记、版本和自己的草稿均不变。记录中的 17 次版本读取与 5 次自定义资源请求均保留正确 Service 前缀。具体版本、网络及断言见 `run-cold-result.json` 的 `automaticUpdate` 和 `browserRequests`。

### 本轮检查与夹具修正

- 相关 Desktop Adapter 回归 37 项通过；Quick Start/原生边界测试 42 项通过。
- 新源码 input hash、原生二进制 UI hash、五个候选镜像身份、导出材料及官网预览检查一致，文档/原生边界检查和 OpenSpec strict 校验通过。
- 本轮没有重跑首轮全部 Go/浏览器套件，也不将其旧候选记录改称为新候选全量回归。
- 初版夹具的浏览器标记使用了普通 HTTP 页面不可用的 `crypto.randomUUID`，改为非鉴权用途的测试标记；另补齐导航后等待目标页面及运行版本的时序。修正后完整重跑两套空 Engine 验收通过，原失败输出留在忽略目录，没有修改产品来配合夹具。

## Verify 后续补验：WARN 1

本节记录当前候选，补齐此前缺失的独立客户端网络验收。Docker run 和 Compose 均通过完整流程，WARN 1 已处理；不以此前同机浏览器或临时诊断程序的结果代替。本轮未提交、推送或发布，原体验实例未停止或重启。

### 验收发现并修复的配置保存错误

浏览器完成真实回复后保存 AGENTS 曾返回 500。隔离诊断以六个配置读取者并发 Save 复现，失败落在 `workcontext` 打开 works 根目录时：重复申请非阻塞独占 flock 与已有读取竞争，最终被投影为 `CONTEXT_COPY_FAILED`。上下文材料本身的离线校验及独立复制成功。

上下文读写现复用 Store 已持有的安装锁，私有目录继续检查所有者、权限及 no-follow；新上下文仍通过独立 staging 和原子发布提交。读取已发布上下文不再创建缺失的 Work/context 父目录。安装仍拒绝第二个 Core，原上下文字节保持不变。

新增 `TestPublishedContextReadsAndConfigurationPublicationCanOverlap`，覆盖保留目录句柄、六个读取者与连续发布/候选清理并行。用旧实现的临时 Go overlay 运行该用例可稳定失败，修复后通过；`go test -race ./internal/workcontext ./internal/corestore ./internal/safefs` 及 `go test ./...` 均通过。

### 当前候选身份

- release ID：`0.0.8-9a40d4443fee-c9ce8d9cdc29-dirty`；source commit 仍为 `9a40d4443fee559335485744d0aabbf186e24b38`，modified 为 true。
- source input hash：`c9ce8d9cdc29d694dce11c6e112483eb1713beb8877611bde185257e13c85972`。
- Desktop UI hash：`6a5b97925f8ec03d8b4a7f9edb21a03e3bdff53615d24a0cf55c995d8ffa58aa`；Console UI hash：`07b891d332991ed24bf0210ec940a654a68d25f5ab52362cee6f62c0f9947e4b`。
- 前缀 Web base 沿用本文记录的 `0.2.0-9a40d4443fee-9286afd39f8e-dirty` 及其实际 image ID。

下表均为本地 image ID，非已发布 registry digest；五个角色从同一固定输入构建并核验。

| 镜像 | image ID |
| --- | --- |
| Core | `sha256:6270c738a24108b5d1e3e0357302875d430884db77d18ff1ae22efb92fa7dd6a` |
| CLI | `sha256:713028f8e4671f95bcf78cea255dec586f79a7757151bf9e37744913f87b6c9a` |
| Agent | `sha256:3b5fa3000451c0375afbfa3ac72bd0268ed4b3b042688c266f6550ea35068ae9` |
| File helper | `sha256:b1c03595988093a112c1ff06e721185fea0b98ef97223deab7d861563c195c58` |
| Snapshot helper | `sha256:63ec47c81d5d89406950f5392042f73de9c7e19a227a1553ea5454ef146842b4` |

输入、镜像记录、构建日志及新材料在 `dist/separate-control-plane/network/`；`deploy/docker/candidate.json`、双语部署材料、Compose、单机示例及隔离官网预览已同步该候选。原生 Go 程序重新编译，未替换任何已发布身份。

### 实际网络与完整工作流

可复现入口为本变更的 `fixtures/restricted-network.mjs`，网络辅助实现为 `fixtures/network-client.mjs`。两种安装方式分别使用全新 Docker Engine 28.5.2、Engine 卷及安装卷，开始时均为 0 镜像，仅加载 Core 安装镜像；Agent/helper 从本次本地 registry 按固定引用拉取并逐一核对 ID。零 ADMIN/模型业务 env，网页创建管理员、登录、Quick setup、固定 Agent 默认、创建 Work 和真实模型回复均成功。

每种方式中的 Linux Chromium `146.0.7680.0` 实际运行在与服务端不同的客户端网络命名空间。IPv4/IPv6 OUTPUT 默认 DROP，只允许 loopback、已建立连接，以及到指定服务端 IP 的新 TCP 17891 连接；没有浏览器请求拦截/abort 来模拟阻断。Playwright 通过宿主发起的入站控制连接驱动浏览器，不代转产品请求。服务端通配监听后由客户端通过实际 bridge IP `http://172.17.0.3:17891` 使用，无 DNS、public-origin 或客户端代理配置。

为提供有效的负向对照，本夹具显式使用 `--core-listen 0.0.0.0:17871`：管理侧真实 Core 状态返回 200，同时客户端 TCP 探测无法连接 17871；7171、7172、旧池端点 17892/17954 及实际 Service 容器 IP 同样被拒绝，17891 可连接。每种方式记录 22 次探测和最终防火墙规则/计数；产品默认 Core loopback 未改变。两轮顺序销毁重建后 IP/内核命名空间编号可复用，每轮都确认客户端与当时服务端的命名空间不同。

| 安装方式 | 浏览器 HTTP 请求 | WebSocket 连接 | SSE/WS 撤销耗时 | 经 17891 下载并重新上传 Inspect 的包字节 |
| --- | --- | --- | --- | --- |
| Docker run | 993 | 11 | 335 ms | 817007301 |
| Compose | 1093 | 16 | 333 ms | 817015507 |

两轮均完成：真实模型回复在工作台可见；配置 Save/Apply；文件 201/条件冲突 412 及字节保留；图片上传并实际解码；包读取；多个 Service 的资源、深层导航、草稿和自动采用新页面；独立页签/iframe；同名响应 Cookie 按声明端口分区、应用 Bearer、平台凭据不进入上游；真实 SSE/双向 WebSocket 与停止撤销。所有浏览器请求均在当前 ControlPlane origin，WebSocket 也保留 Service 前缀，没有 Core/旧池/容器直连请求。

第二管理员可见既有权限允许的 Work 元数据，但访问他人 Service 和文件均为 404，读取会话为 403；禁用该账号后浏览器会话在两秒内失效，原所有者继续操作。两轮均经浏览器适配器完成 Stop/Export/Download/Inspect/Import/Start，导入后从新目标前缀操作 Todo，核对源码、固定镜像、文件哨兵和业务数据保持；最后正常注销。各轮 Core 正常退出后受管运行容器数为 0，随后只清理本次 Engine、registry、数据卷和本地 registry 别名。

最终通过记录：`network-only-17891-result.json`、`run-cold-result.json`、`compose-cold-result.json` 及私有 Core/Engine/registry 日志，均在上述忽略目录。临时诊断和早期失败另存，不属于最终通过记录。夹具修正了无效 PNG、管理 CSRF 头及管理员元数据/内容拒绝码的错误预期，未为此放宽产品权限；最终两种安装均完整重跑通过。

全量 Go、相关 race、41 项 Quick Start 测试、原生/文档边界、官网材料及 OpenSpec strict 检查通过，源码/原生 UI hash/五个镜像/当前材料身份一致。本轮未重跑完整 UI 单元套件；真实网络证据为 Linux Chromium，不新增 Windows 浏览器或原生 Windows CLI 实机声明，也不声称已完成实际 IPv6 网络验收。
