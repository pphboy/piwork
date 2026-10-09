# Design

## Context

动机见 [proposal.md](proposal.md)。本设计落实 docker-delivery 与 core-service-startup 的增量规格，依据当前 Go 平台源码。

- 本变更修订前已完成 Core/CLI 多阶段构建、发行 defaults 和 CLI 无参数终端入口；既有实现将 Core/CLI 合并 Compose 列为默认方式，需要改为独立入口，并将合并方式迁到 examples/single-host/。
- 当前候选材料、生成脚本、README 和官网围绕合并 Compose；发布入口缺少实时身份预检，官网 First Work 可能残留旧标签，需同步修正并增加回归。旧包的 release.env、环境模板及校验链仅保留为旧版本材料。
- 既有 Core 初始化将显式 Agent 引用与模型三项组成一组，发行 defaults 已另行加载；保留未配置 Core 仍健康可访问、部分非法初始化拒绝和持久配置不覆盖的行为。
- Core 管理宿主 Docker Engine，数据 bind 的源和目标须是同一绝对路径；CLI 只存自己的用户状态。关闭预算保持 Core 进程 45 秒、Docker 窗口 60 秒。
- 当前源码及 config/docker-release.json 使用 piwork-go-core / schema 1；Agent Work history 为 schema 5。主规格还含旧网络身份存储 schema 8/9 的描述，本变更不据此增加迁移或采用历史 TS 实现，候选元数据以现行 Go 源码和真实镜像为准。
- 官网为另一仓库的 /home/p/Projects/pphboy.github.io/piwork，已同步过候选但仍有默认合并入口和旧标签漂移。此 change 的规划文件留在 Piwork；应用时按用户已要求的范围同步官网对应文件。

## Goals / Non-Goals

**Goals:**

- 消除用户启动所需的安装旁置文件和宿主编译工具链依赖，以已发布镜像和 Core、CLI 独立 Docker 命令表达默认部署，Core 单独提供 Compose，合并方式收为可选单机部署示例。
- 让镜像默认入口、独立启动材料与单机部署示例、候选身份检查和真实终端验收相互对应，能够在推送前完整提供可审阅结果。
- 通过发行默认配置与显式用户初始化的分离，保留原有认证、持久数据、就绪及恢复规则。

**Non-Goals:**

- 不合并 Core/CLI，不将 Agent、Service、helper 或 Work 卷加入用户 Compose。
- 不引入 Core 交互初始化向导、默认秘密、新业务顶层命令或用户 wrapper；不改变原生 CLI 默认 Desktop。
- 不重做 Desktop、扩展平台/架构、增加数据库迁移、补完其他 change 的验收或自动进行公共发布。

## Decisions

### 1. Docker 多阶段构建直接制作运行镜像

Dockerfile.core 增加 Go 1.25.5 编译阶段，只编译静态 linux/amd64 piwork-serve。Dockerfile.cli 增加 Node 24 的 Desktop 资源阶段和 Go 1.25.5 编译阶段，保留现有资源输入摘要算法与 buildinfo；资源同步和编译在构建目录中完成，不依赖宿主生成的 dist 或旧 embedded 文件。

现有 Agent、file-helper 和 snapshot-helper 多阶段构建继续使用，统一传入同一版本、commit、修改状态和源码输入摘要。Core/CLI 运行层保留固定 Alpine 基础镜像、CA、curl 及 CLI 所需 jq，不包含 Go、Node、Python、Docker CLI 或 npm；Agent 运行层保留其 TS harness/Pi 生态所需 Node。

新增 Dockerfile.docker-release，提供 metadata 和 materials 导出目标：metadata 读取源码计算版本、源码输入摘要和 Desktop 输入摘要，materials 验证给定镜像检查记录并输出 Compose、候选清单和校验文件。使用 Docker 的本地输出导出文件，不发布此构建目标为额外 Release 工具镜像。检查记录通过独立的 BuildKit 命名上下文传入，只包含非敏感镜像/构建元数据；保留主 .dockerignore 对 dist、真实 env、私钥和数据的排除，不为了材料构建开放这些目录。

宿主文档直接展示 Docker build 与 Docker push 命令；Git 提供真实 commit 和修改状态，普通终端工具读取导出的非敏感元数据。不让宿主执行 npm ci、make build-go 或 node 脚本成为 Docker 发行前置条件。scripts/build-docker-release.mjs 中身份检查与材料生成逻辑改为可在构建阶段使用的纯输入处理；Docker inspect/run/manifest 检查由宿主 Docker 命令产生记录，不伪造远端或本地检查结果。原生 buildCLI/make release 继续独立存在。

备选方案为独立发布一个 Release 工具镜像，或继续要求宿主先编译 dist；用户已选择直接 Docker build/push，多阶段构建保持最少发行角色。[Docker 多阶段构建](https://docs.docker.com/build/building/multi-stage/)允许只将需要的构建输出复制到最终镜像。

### 2. 使用发行专属标签解除构建与推送的前置循环

默认 namespace 使用用户的 docker.io/pphboy，角色保持 piwork-core、piwork-cli、piwork-agentd、piwork-file-helper、piwork-snapshot-helper，package helper 复用 Agent。发行标识采用版本、commit 前缀与源码输入摘要前缀组合，有修改时附加 dirty 标记，写入候选记录，全部角色共享；禁止 latest 和覆盖已存在而身份不同的发行标签。

Core 内置依赖使用此发行专属标签。标签在正式清单中绑定推送后取得的实际 registry digest，候选检查同时验证镜像 ID、源码与协议；Core 准备成功后仍捕获不可变镜像身份。Core Compose、单机部署示例和独立启动代码引用同一发行专属标签，清单提供对应 digest 供核查与高级固定引用。

这是对旧版“用户从 release.env 提供全部 digest”的明确替换：用户不再承担 helper 引用输入。先固定候选标签，才能在任何公共推送之前完成 Core 与依赖的全部构建及测试。备选的“先推 helper、再把其 digest 写进 Core 重建”会把公共推送变成 Core 候选制作的前置步骤，与用户先判断推送的要求冲突。

源码摘要覆盖实际构建输入、Dockerfile、脚本、配置及未渲染的发行模板，不包含 dist 或生成后含本发行标识的材料，避免自引用。未知身份、摘要变化、CLI 资源陈旧或协议不同都使候选失败；镜像 config ID 不得冒充 registry manifest digest。

发布入口不能只输出五条按可变标签推送的命令。生成的可执行发布入口先加载已审阅清单，重新检查全部五个角色的实时本地 image ID、源码输入、平台、协议及 CLI 资源身份，再查询远端 manifest/config 身份。只有全部通过后才开始任何 Docker push；远端已存在且身份不同、认证/网络异常、无法确认结果或本地标签被重新指向时均退出。明确的不存在与查询失败分开处理，演练只报告预检结果。测试使用合成记录和模拟 Docker 调用证明每种失败均为零 push，不触及公共 registry 写入。全部核验仍以用户对本次候选的推送授权为前提；外部并发改写标签的风险不能被预检描述为已消除，推送后仍须复核实际 digest。

### 3. Core 镜像内置非敏感默认配置

在 Core 镜像中写入 /etc/piwork/docker-release.json，包含版本化格式、发行身份以及 Agent/package/file/snapshot helper 默认引用。通过 PIWORK_RELEASE_CONFIG_PATH 选择；该文件严格限制非敏感字段、格式及引用，错误只报告安全字段，不输出整个文件。路径未配置时保持原有高级/原生初始化方式。

镜像提供以下非敏感运行默认值：

| 项目 | 默认值 |
| --- | --- |
| 数据路径 | /var/lib/piwork/quickstart/core |
| HTTP | 0.0.0.0:7171，保留显式 allow-insecure-remote |
| Agent 控制 | 0.0.0.0:7172 / piwork-core:7172 |
| Docker API | unix:///var/run/docker.sock，空 DOCKER_CONTEXT |
| operator 本机地址 | http://127.0.0.1:7171 |
| 完整就绪探针 | /readyz?profile=docker-delivery |

internal/coreapp 的发行配置加载与初始化解析分开处理。优先级为既有显式命令/部署环境、发行默认值；合法初始化仍只补齐缺失的持久管理员与默认 runtime，不覆盖已有值。发行中的 Agent 默认引用仅在用户实际提供完整模型组时参与初始化；未提供用户初始化的空安装仍监听健康接口并报告未配置。部分或非法用户输入继续拒绝，不能用 defaults 掩盖。

管理员及模型输入仅来自已存在的五个宿主环境变量。可选 Base URL 未设置时保持不存在，显式空值按现有规则拒绝；兼容别名和模型地址限制不变。helper 默认引用补齐缺省项，显式配置保持现有校验及降级语义，不能借新默认值重置默认上下文或已有 Work。

备选的直接 Docker ENV PIWORK_AGENT_IMAGE 会触发既有初始化分组错误；增加默认密码或初始化向导也不满足已确认的输入方式。单独的非敏感发行配置同时解决分组校验和用户无需指定 helper 的问题。

### 4. Docker CLI 无参数入口负责等待并进入终端

Dockerfile.cli 使用镜像内的最小入口脚本 deploy/docker/cli-entrypoint.sh，默认 CMD 为空。无参数时从默认启动命令明确传入的 PIWORK_CORE_URL 等待完整 readiness，在单一总截止时间内重试，最多 600 秒；单次连接、请求和间隔不得突破剩余预算。只接受既有合法 HTTP(S) Core origin，保持证书验证，不打印可能包含敏感信息的地址或响应。

就绪成功后 exec /bin/sh -i；失败或收到退出信号时以非零状态结束，并给出 Core 状态/日志方向。默认启动不签发 Desktop 票据，不发布客户端端口，也不读取 Core 配置或凭据。PIWORK_CONFIG_PATH 与容器模式保持现有值。

显式传入参数则 exec piwork-cli "$@"，直接保留 help/version、业务命令、desktop --no-open 的参数、信号与退出码，不增加网络等待。这是容器包装，既有 piwork-cli 本体及其 Core 地址选择优先级不改动；默认材料显式传入本机 Core URL，远端客户端按手册覆盖它。

备选为继续在 README 写 --entrypoint 和 curl 循环；把包装放进镜像可缩短默认启动代码，并可集中验证等待失败和显式命令兼容。

### 5. 默认独立入口与可选单机部署示例

默认 Core 与 CLI 各用一条完整 Docker run 命令，使用固定发行镜像。Core 后台运行，传入已有宿主初始化变量，负责 Agent/helper/Work；CLI 独立启动，只配置可达 Core 地址和自己的凭证卷。CLI 不管理 Core 生命周期，两者无 Compose 项目依赖。CLI 可连接本机或远端 Core，平台网络差异放在手册中。

```text
Core host: existing init env --> Core --> Docker Unix API --> Work / helpers
                                  ^
                                  |
CLI host: independent CLI --------+ Core HTTP(S)
```

| 项目 | 默认 Core | 默认终端 CLI |
| --- | --- | --- |
| 网络 | host | 同机 Linux 使用 bridge + host-gateway；远端使用可达 Core URL |
| 存储 | /var/lib/piwork/quickstart/core 同绝对路径 bind | piwork-quickstart-client-state 命名卷 |
| 额外挂载 | Docker socket | 无 |
| 环境 | 五个初始化名及可选 Base URL | Core URL、镜像已有用户配置路径 |
| 运行方式 | 后台，60 秒停止窗口 | 临时交互容器 |
| 就绪 | 镜像完整 readiness healthcheck | 默认入口有界等待所选 Core |

Core-only Compose 作为 Core 的可选部署方式，渲染后的 deploy/docker/docker-compose.yml 只包含 Core 及其网络、数据、环境和关闭约定，不定义 CLI 或客户端卷。原合并模板迁移到单机部署示例对应的生成来源，清单和同步脚本明确区分两类文件，不继续把合并文件标为默认交付。默认 Core Docker run 与 Core Compose 共用 Core 数据路径，须先停止原容器再切换，保留安装锁。已有高级 Core-only Demo 的 /var/lib/piwork/core 及旧版材料保留清晰归属。

单机部署示例放在 examples/single-host/，包含 docker-compose.yml、README.md、README.zh-CN.md；双语标题分别为“单机部署示例”和“Single-host deployment”。同一 Compose 文件定义 Core 和交互 CLI 两个独立容器，CLI 放在交互 profile 中，不作为常驻后台 shell。示例数据为 /var/lib/piwork/examples/single-host/core 同绝对路径 bind，客户端使用 piwork-single-host-client-state 专属卷。示例沿用端口 7171/7172，说明先停止同机端口冲突服务；不自动关闭默认安装，不和默认安装并发争抢监听。

示例先显式启动 Core，再进入 CLI：

```sh
docker compose -f examples/single-host/docker-compose.yml up --detach --wait --wait-timeout 600 core
docker compose -f examples/single-host/docker-compose.yml run --rm --no-deps cli
```

示例 CLI 不设置自动管理 Core 的 depends_on，命令同时显式使用 --no-deps；完整 readiness 由 CLI 镜像入口负责。退出或重进 CLI 不创建、启动、停止或重建 Core；Core 不存在或未就绪时 CLI 只等待并安全失败。缺少或改变初始化变量的新终端重进 CLI，Core 容器 ID、启动时间和运行中的 Work 均保持。示例说明的用户概念只需“Core 后台服务、CLI 终端客户端”。

Core Compose 和示例均只按名称传入初始化环境，不使用 env_file，不把可选 Base URL 未设置改为空值，不要求 release.env、覆盖文件或源码。下载后的示例 YAML 可单独使用，命令中的 -f 路径按实际下载位置说明，不强制 clone。生成文件无待填镜像占位符，不打印包含真实初始化值的展开配置。

新 Core 数据 bind 允许创建空宿主目录，由现有安全初始化设置私有权限；已有目录继续检查所有者和安装锁，socket 使用 create_host_path: false。CLI 不取得 Core 初始化秘密、socket、Core 数据或 Work 卷。默认独立路径、Core Compose 配合独立 CLI 以及单机部署示例均提供终端 login、work create --wait、chat；Work ID 来自创建输出，观察中断按原 Operation/Run ID 恢复，不自动重提。

### 6. 文档布局与官网同步使用同一发行记录

README 的顺序调整为居中 Logo、项目介绍、完整 Architecture、Problem 和后续章节；只移动现有图与说明，缺少材料的槽位继续留空。Quick Start 分为运行 Core、使用 CLI 两个独立入口，各展示一条 Docker run 命令；Core 另提供 Core-only Compose 链接。examples/single-host/ 仅作为可选单机部署示例链接引用，不把其启动命令混进默认步骤；各方式共用终端使用说明；原生 CLI 路径维持默认关闭的 details。

删除旧 Try 中两个指定步骤及其 tar/checksum、env 文件编辑、release.env 读取代码，不以新标题保留同样配置负担。五个环境变量名称、12 位密码及支持的 Docker 条件用短说明表达已确认前提，不要求用户在 Quick Start 生成或编辑秘密。高级运维、完整命令、旧包和 Desktop 说明留在手册与导航中。

deploy/docker 的双语手册增加独立 Core/CLI 入口、Core-only Compose 和单机部署示例引用，原 compose.core.yaml / compose.cli.yaml / compose.cli.linux.yaml 及模板明确标为高级或旧版材料。仍受支持的高级 Core Demo 按新的默认依赖来源维护，旧版本固定材料保持来源可核查；不修改用户已填写的 env。

官网同步 docs/index.md、docs/zh/index.md、两种语言的 guide/quick-start.md、installation.md、first-work.md、source-installation.md、guide/index.md、spec/index.md、对应导航和 piwork/README.md。新静态材料位于独立 docs/public/install/<release-id>/ 路径，区分输出 Core-only Compose、单机部署示例 Compose、来源说明及校验；旧 0.0.1 和 0.1.0 地址不覆写。官网试用代码与上游采用同一生成记录，未发布时标记候选，不假设下载 URL 已存在。scripts/sync-docker-website.mjs 使用共享渲染或有标记的生成区段，每次重生成全部当前镜像引用，包括已替换为字面标签的 First Work 示例；连续 A、B 两次同步后各语言入口只能指向 B。门禁覆盖首页、Quick Start、installation、First Work、示例引用及当前下载材料，负向用例证明任一旧引用会失败；冻结的历史版本页面和下载不参与替换。

### 7. 本地候选先验证，公共发行后复核

```text
源码 + 真实身份
       |
Docker metadata --> Docker build 全部角色 --> 本地镜像/协议检查
                                             |
                                 materials + 独立入口与示例真实验收
                                             |
                                候选清单、结果、待执行推送命令
                                             |
                                      用户判断是否推送
                                             |
                               Docker push --> 匿名读取/digest 复核
                                             |
                                正式材料及文档公开状态核对
```

本地检查包括 Core/CLI --version、CLI 资源摘要、工具边界、镜像默认配置、标签、存储兼容、全部 helper 协议及材料一致性。当前 work-history schema 5 等事实由源码与镜像核查，不能复制旧版本记录当作新候选证据。

默认独立 Docker run、Core-only Compose 配合独立 CLI 和单机部署示例分别用独立 Engine/安装数据验证真实模型回复、隐藏 TTY 登录、凭证重建、Core 关闭/恢复和失败入口。推送前若发行标签尚未公开，可用本次专属本地 registry/mirror 给隔离 Engine 提供相同候选标签及内容，测试默认引用与自动拉取；记录这一来源，不能将其当作 Docker Hub 匿名读取。仅静态检查或预载缓存不能代表无缓存自动准备通过。

材料检查升级现有 check-docker-quickstart 入口，覆盖两份 README、两份手册、镜像默认值、Core Compose、examples/single-host/ 示例及其文档引用、候选清单和官网对应内容；官网路径可通过显式参数提供，在此次同步验证中必跑，其他干净 clone 的基本检查不依赖同机另一个仓库。检查语义和关键字段，移除旧代码块数量/配置文件必填断言，保留合成值泄漏、私有路径、数据/网络及负向漂移检查。打包与导出检查前置，生成物还要反向核对源模板及校验。

官网运行 pnpm build 和相关文档/链接检查；纯文案移动不新增业务测试。镜像、入口与初始化变更执行对应单元/契约和实际 Docker 验证，保留 AGENTS.md 指定的 node scripts/check-docker-quickstart.mjs、node --test scripts/check-docker-quickstart.test.mjs 与 git diff --check。候选与正式验证分别记录，不增加 GUI 默认流程，也不把 Linux 结果补成未测 Windows 结果。

## Risks / Trade-offs

- [发行标签可被外部人为改写] → 流程拒绝覆盖既有不同身份标签，正式清单记录实际 digest 并复核所有角色；Core 捕获 image ID，保留高级 digest 固定入口。更严格的构建前 digest 固定需要另外的 OCI 制作/发布链，本版不将公共推送作为准备候选的前置步骤。
- [内置依赖与用户模型分组混淆] → 独立加载非敏感默认配置，仅在实际用户初始化时补齐 Agent；覆盖未配置健康、部分字段、非法字段和持久值测试。
- [Compose 将未设置可选地址改成空值或改变特殊字符] → 仅名称传递，使用合成值做实际解析及容器输入检查，禁止输出真实展开配置。
- [切换入口产生第二份数据或两个 Core 争抢安装] → 默认 Core Docker run 与 Core Compose 共用 Core 路径、说明先停止再切换，保留单实例锁；CLI 状态独立，单机部署示例、测试与高级 Demo 使用专属路径和状态卷，并检查监听端口冲突。
- [未发布候选被文档误称正式可用] → 材料与验收分别标记本地和正式，用户判断后才 push；实际 digest/匿名读取及下载位置复核完成后更新公开状态，不自动发布网站。
- [旧材料或官网漂移] → 保留版本归属并更新可执行材料检查，将官网同步纳入本 change 的验收，不依赖维护者日后记忆。

## Migration Plan

1. 保留已有多阶段构建、Core defaults 与 CLI 入口成果；将合并 Compose 迁到 examples/single-host/，默认材料改为独立 Docker 命令与 Core-only Compose，补齐发布预检和官网完整同步。旧包和高级显式 Desktop 入口保留。
2. 更新 README、手册、检查入口及官网对应源文件，以实际候选身份核对默认独立入口、Core Compose 和单机部署示例；从修复后的源码重建全部候选，完成本地真实模型、恢复及 CLI 重入验收，输出审阅清单。没有推送许可时维持候选状态，代码完成不等于公共发行完成。
3. 用户明确判断后，使用绑定已审阅清单的发布入口，在全部实时预检通过后 Docker push 相同候选，核对远端 digest/匿名拉取及无缓存完整准备，生成正式 Compose/清单。若推送或复核失败，保留原正式版本入口，不宣称新版本已可用。
4. 官网和仓库的对外发布按用户明确指令执行；发布前核对 Core Compose 与单机部署示例的实际下载位置、文档引用和校验。旧下载与安装目录继续保留，不自动提交、合并或推送其他工作。
5. 升级保留 Core、CLI 与 Work 数据；回退使用记录中的旧发行引用和材料，先确认存储格式兼容，不将 .work 导入称为原 ID 安装恢复。

本次规划修订后，先前候选与验收记录只代表修订前结果，不能作为新默认结构、示例安全性、发布预检或官网同步通过的证明。修复、重建、同步和复验完成后生成新的审阅材料，重新等待用户对该候选的推送判断。
