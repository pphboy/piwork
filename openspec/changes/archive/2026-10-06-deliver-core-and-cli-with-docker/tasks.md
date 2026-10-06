# Tasks

## 1. Core 初始化、后台准备与状态

- [x] 1.1 复用进程 env 的管理员/runtime 初始化，覆盖空安装、缺项、非法值、已有持久值和模型 Base URL 限制；补充 `internal/coreapp` 对应检查，以 `CGO_ENABLED=0 go test ./internal/coreapp` 验证不预建 Work、不重置身份/模型、秘密不进入输出。（CORE-DOCKER-INIT-001）
- [x] 1.2 将启动及配置刷新改为后台准备调度，按 design 的两任务上限、引用去重、十分钟期限、1/5/15/30/60 秒退避和错误分类实现；用可控阻塞/失败 Engine fixture 验证慢拉取时探针不排队、无重复拉取、有界重试与不兼容 failed。（CORE-DOCKER-PREP-001）
- [x] 1.3 改为 file/snapshot helper 仅在成功后捕获身份，失败可重试；保留 package helper 省略时的 Agent 回退，用同进程首轮失败→恢复的检查验证 helper 能力重新可用而 Work/Service 不被阻断。（CORE-DOCKER-PREP-001）
- [x] 1.4 为准备结果增加 runtime revision/关闭准入约束，沿用一次性 brain seed 和既有 package/上下文意图；验证旧代次不能发布新 ready、已禁用/移除 seed 不被重置、已有 Work 捕获镜像和模型不改变。（CORE-DOCKER-INIT-001、CORE-DOCKER-PREP-001）
- [x] 1.5 将依赖 helper 的文件/快照恢复安排在该 helper 可用后，保留持久意图并继续其他 Work recovery；运行现有 file/snapshot/work/package recovery 检查并新增 helper 延迟就绪场景，验证不假报完成、不重复对象、不泄漏卷。（CORE-DOCKER-PREP-001）
- [x] 1.6 移除 status 和配置 HTTP handler 中的长时间同步准备，保持现有管理 DTO/配置提交投影与原命令查询退出语义；验证 admin runtime 提交后返回保存值及真实非 ready 状态、operator config set 已保存则 exit 0，查询不调度重复拉取，严格 AdminStatus 合同仍通过。（CORE-DOCKER-STATUS-001、CORE-DOCKER-PREP-001）
- [x] 1.7 在 `/control/status` 增加安全 preparation 快照，并实现 `/readyz?profile=docker-delivery`；覆盖全部 state/code、未配置、基础 ready/helper 未 ready、完整 ready、关闭、未知/重复 profile 和脱敏，运行 Core/合同检查验证默认 `/readyz` 与用户/admin 状态 DTO 不变。（CORE-DOCKER-STATUS-001、Expose distinct health and readiness probes）
- [x] 1.8 接入两秒 Engine 健康探测与最多五秒撤销 ready，关闭时取消准备并加入既有关闭预算；验证 Engine 丢失/恢复、拉取中 SIGTERM、配置并发及关闭竞态，运行 `go test -race ./internal/coreapp` 与既有 shutdown 检查。（CORE-DOCKER-PREP-001、CORE-DOCKER-STATUS-001）
- [x] 1.9 在 `deploy/docker/README.zh-CN.md` 编写 Core 初始化、组件状态、交付 probe、自动重试和已持久配置修改段；按 design 6.2/6.4 核查完整命令和 secret 输入方式，确保没有手动 helper pull 或新 deployment 命令。（CORE-DOCKER-INIT-001、DOCKER-DELIVERY-006）

## 2. CLI 容器模式与本地授权

- [x] 2.1 集中实现容器模式 env 解析及容器浏览器策略；检查 1、0、空/未设置、非法值，验证 help/version 无 I/O，普通业务命令与未启用模式的原生行为保持。（CLI-CONTAINER-001）
- [x] 2.2 让容器模式 Desktop/proxy 绑定 0.0.0.0 并保留公开本机 origin/端口；用监听检查覆盖默认/自定义端口及占用错误，验证原生仍绑定 127.0.0.1，运行 `CGO_ENABLED=0 go test ./internal/cli`。（CLI-CONTAINER-001、CLI-DESKTOP-001、CLI-SERVICE-PROXY-001）
- [x] 2.3 对 proxy 的 Docker 转发对端调整传输准入，保持 Host/Origin、PAC、WebDAV Basic、保留头剥离及 Service 应用认证隔离；以现有 proxy/files 单元场景验证错误 Host/跨站/伪造转发头拒绝、无效本地凭据不联系 Core、原生仍拒绝非 loopback。（CLI-CONTAINER-001、WACC-FILES-002）
- [x] 2.4 容器 Desktop 主启动仅输出安全 origin/恢复方向，禁用内部浏览器；保留同实例 open 的五分钟票据与原 logout，使用现有进程/控制 fixture 验证主日志无票据、exec 调用可获取新票据、匿名页面不能继承身份和旧授权不可重放。（CLI-CONTAINER-DESKTOP-001、CLI-DESKTOP-002、WACC-DESKTOP-001）
- [x] 2.5 验证并保持同 UID/实例控制通道、状态卷私有权限与并发凭证处理；运行既有 Desktop control/recovery/credential 测试，确认只共享凭证卷不能控制另一实例、logout 仍为条件清理、重建不复用本地会话。（CLI-CONTAINER-DESKTOP-001、DOCKER-DELIVERY-005）
- [x] 2.6 在中文手册编写容器 open/logout、同机浏览器、环境覆盖/重建和 headless 共享凭证规则；逐条核查 design 6.3/6.5 的完整 Docker 前缀与不同 logout 作用，不引入用户 wrapper 或独立 headless 验收要求。（DOCKER-DELIVERY-005、DOCKER-DELIVERY-006）

## 3. 镜像构建与原生链保留

- [x] 3.1 新增 `Dockerfile.core`，采用固定 digest 基础层、CGO=0 的既有 Core 二进制、CA/curl 和正确 ENTRYPOINT；构建 linux/amd64 后用版本、镜像文件清单和启动帮助核对无源码运行依赖、无秘密、无 Docker CLI。（DOCKER-DELIVERY-001、DOCKER-DELIVERY-003）
- [x] 3.2 新增 `Dockerfile.cli`，包含同提交的新 Desktop 资源、CA/curl/jq、0700 状态目录和 exchange，ENTRYPOINT/CMD 按 design，不设镜像 HEALTHCHECK；构建后核对版本、资源 hash、目录权限、help 与 jq 可用，不能用陈旧 dist。（DOCKER-DELIVERY-001、DOCKER-DELIVERY-005）
- [x] 3.3 新增维护者 Docker build/package 入口，复用既有 Go/CLI 资源构建而不替换原生发行链；执行 `make build-go`、`npm run build:cli` 及已有 release 产物检查，确认 Windows/Linux 原生客户端仍独立生成。（DOCKER-DELIVERY-001、DOCKER-DELIVERY-007）
- [x] 3.4 对 Agent/package/file/snapshot 镜像执行平台、原生协议 label、不可变身份和版本核对；使用同提交产物验证 package helper 可复用 Agent，任一缺失/协议不符使 Docker 打包失败。（DOCKER-DELIVERY-001、CORE-DOCKER-PREP-001）
- [x] 3.5 在 `docs/docker-release.md` 文档化维护者构建输入、registry prefix、固定基础 digest、产物一致性及与原生链关系；核对构建入口的实际参数和对应产物，不把维护者工具交给普通用户作为安装步骤。（DOCKER-DELIVERY-001、DOCKER-DELIVERY-007）

## 4. Compose、发行文件与完整操作手册

- [x] 4.1 创建 Core Compose/env 示例，按 design 使用 host 网络、rootful Unix socket、相同绝对数据路径、独立 operator exchange、60 秒关闭与完整 profile health；用无秘密 fixture 执行 Compose 配置校验并验证缺路径/socket/镜像变量明确失败。（DOCKER-DELIVERY-003、DOCKER-DELIVERY-004）
- [x] 4.2 创建 CLI Compose/env 和 Linux 网络覆盖，设置独立 bridge、127.0.0.1 发布、固定状态/交换卷及无票据静态 health；分别解析 Linux 合并配置和 Windows 基础配置，确认 Windows 不覆盖内建 host 别名、CLI 无 socket/Core/Work 挂载。（DOCKER-DELIVERY-004、DOCKER-DELIVERY-005）
- [x] 4.3 生成真实 release.env/manifest/SHA256SUMS 和 `piwork-docker` 包；验证 digest 可读、manifestVersion/源码/协议/格式/前版兼容声明对应证据、内部及压缩包 checksum 正确，包内无真实 secret 或未知镜像地址。（DOCKER-DELIVERY-001、DOCKER-DELIVERY-002、DOCKER-DELIVERY-008）
- [x] 4.4 完成中文手册的 Linux Bash/Windows PowerShell 下载、检查、初始化、Desktop 登录/恢复、Core operator 和新增操作清单；对照 design 6.1–6.4/6.8 核查命令顺序、变量取得、密码输入和执行机器，消除省略前缀与未定义脚本。（DOCKER-DELIVERY-006）
- [x] 4.5 完成无 Desktop 全部业务命令与 proxy、配置 JSON 提取、文件 cp、快照操作段；静态对照当前 help/参数解析核对 flag、ID 来源、catalog ID 与镜像 ref 区别、输入输出路径和 shell 引号，确认宿主无 Python/jq 必装依赖；不增加 headless Docker 端到端测试/门禁。（DOCKER-DELIVERY-005、DOCKER-DELIVERY-006）
- [x] 4.6 完成出站网络、自定义 CA、Core/CLI 重建、升级与兼容回退、保留数据卸载段；按 design 6.7 核查旧引用/旧 Compose 的保存与恢复、env 不覆盖持久值、双卷与 `.work` 恢复边界，不包含 down -v/全局 prune 或仅旧镜像即可恢复的说法。（DOCKER-DELIVERY-004、DOCKER-DELIVERY-008）
- [x] 4.7 核查所有发布材料的平台范围和原生 CLI 入口，确认首发 linux/amd64、Linux Core、Linux/Windows Docker Desktop CLI 的要求与失败方向清楚；对两平台的 Compose 关键配置和文档样例做交付审核，缺实际版本/Windows 证据不标完成。（DOCKER-DELIVERY-002、DOCKER-DELIVERY-007、DOCKER-DELIVERY-009）

## 5. 实际 Core 与 Desktop 集成验收

- [x] 5.1 在独立 Linux Engine/数据目录以实际候选发行包完成 D01 冷启动：只手动拉取 Core 入口，记录自动取得运行依赖、初始化、基础/profile 就绪与无默认 Work；保留实际 OS/Engine/Compose/digest 和状态证据。（DOCKER-DELIVERY-009）
- [x] 5.2 完成 D02 的受控 Engine/registry 故障、慢拉取、首轮 helper 失败与恢复，记录同进程自动 retry/ready、状态不阻塞、不兼容 failed 以及拉取中关闭；只清理本次安装标记的资源。（CORE-DOCKER-PREP-001、CORE-DOCKER-STATUS-001、DOCKER-DELIVERY-009）
- [x] 5.3 在 Linux 用户电脑执行 D03/D05/D06/D07：真实同机浏览器 open/登录、就绪 Work、真实支持模型 Run、fixture Service HTTP/WS、Files 字节校验、停机 export/Inspect/import/start；记录原 ID 与完整结果，负向 Host/Origin/匿名校验须通过。（DOCKER-DELIVERY-004、DOCKER-DELIVERY-009、WACC-DESKTOP-001）
- [x] 5.4 在真实 Windows Docker Desktop Linux 容器与同机浏览器完成 D04/D05/D06/D07，使用实际发布 CLI 镜像而非原生程序；记录 Windows/Desktop/Engine/Compose/浏览器版本、原对象 ID 和与 Linux 相同的业务/负向结果。（DOCKER-DELIVERY-002、DOCKER-DELIVERY-009）
- [x] 5.5 在两客户端平台完成 D08 的 open 重新授权、无 Cookie desktop logout、CLI 重建及 Core 重建；核对原用户/Work/Operation/Session/Run 和卷内容，验证旧本地授权失效、改变合法 env 不覆盖持久值、关闭入口不停止 Work。（CLI-CONTAINER-DESKTOP-001、DOCKER-DELIVERY-008、DOCKER-DELIVERY-009）
- [x] 5.6 完成 D09 的候选发行包镜像/协议/checksum/文档核对与已有原生兼容检查，将 D01–D09 实际结果写入 `docs/docker-delivery-acceptance.md`；任何必需项缺证据保持未通过，无 Desktop Docker 不建立独立验收表/门禁，原生 Windows 未完成项仍归原变更。（DOCKER-DELIVERY-001、DOCKER-DELIVERY-007、DOCKER-DELIVERY-009）

## 6. 验证后确认的问题修复

前 33 项记录既有实现及验收，不表示以下修复事项完成。Core 关闭所有受管 Work 的语义已由用户确认并沿用现有实现；本次仅统一规范、修正完整安装/校验命令和刷新本机候选材料。此前误加的实际上传及公共下载入口验收要求按用户纠正移出本次范围，不以已完成冒充移除。不执行镜像 push、包上传、Release 创建或托管配置，不索取发布地址/凭证，不新增自动发行或独立 headless Docker 门禁；保留此前授权的发行和实机使用证据。

- [x] 6.1 在 core-service-startup delta 中完整修改正常关闭及重启要求/场景，统一为关闭本安装全部受管 Work、保留数据和运行意图、失败非零退出；同步 proposal、design 和 docker-delivery，明确正常关闭与异常退出及 CLI 退出边界。以 `openspec validate deliver-core-and-cli-with-docker --strict`、相同主要求名称核对和变更内语义审阅确认 delta 可用于后续主规范同步。（Shut down Core without destroying running Works、Recover Core and Work state across restart、DOCKER-DELIVERY-008）
- [x] 6.2 修正 `deploy/docker/README.zh-CN.md`、`docs/docker-release.md` 和 `docs/docker-delivery-acceptance.md`：保留 Bash/PowerShell 在线可选下载及已有本地包的完整校验/解压步骤，比较可信预期 SHA256 后才解压并核对内部清单；明确 Core 正常关闭停止全部受管 Work、保留运行意图，关闭失败时保留容器及诊断。删除索取发布输入和公共下载入口未完成阻塞本次修复的表述，注明此次不执行实际发行、不新增发行功能。静态审阅两种 shell 的变量来源、失败终止和文档范围一致性。（DOCKER-DELIVERY-001、DOCKER-DELIVERY-006、DOCKER-DELIVERY-008）
- [x] 6.3 使用既有 Docker package 流程仅重新生成包含修正手册的本机候选包与 checksum；保留旧候选包和收据，核对源码/Desktop hash、release.env/manifest、模板及归档内容、内部清单和压缩包 checksum。只读取已有镜像，不重新构建/push，不上传、不创建 Release；同步本机验收记录与候选包 hash，原有使用证据不得冒充新材料证据。（DOCKER-DELIVERY-001、DOCKER-DELIVERY-002）
- [x] 6.4 完成问题修复复核：静态审阅 Bash/PowerShell 完整命令，以受控本机 fixture 执行 Bash 在线/已有包成功入口、下载失败、错误/非法 checksum 阻止解压，以及 Core 关闭非零退出时不继续 down 的路径；记录范围和结果，不冒充公共站点或新的 Windows 实机验收。复用既有关闭/恢复及 Linux/Windows 使用证据核对未变行为，只有行为变化或证据缺项才扩大测试；将先前错误的“等待分发”收据标记为不适用并说明原因，重新执行 OpenSpec 严格校验、`git diff --check` 和交付材料审核。无需实际发布地址/凭证，不新增独立 headless 端到端门禁。（DOCKER-DELIVERY-001、DOCKER-DELIVERY-008、DOCKER-DELIVERY-009）
