# Design

## Context

动机见 proposal.md；行为契约见 specs/docker-delivery/spec.md。当前工作区已有两份 README 的未提交整理，实施时在这些内容上调整，不覆盖其他章节或其他 change。

已核对的实现决定本方案：

- `Dockerfile.cli` 基于 Alpine，提供 shell、curl 和 piwork-cli，状态目录预设为 0700；默认 CMD 是 Desktop，必须显式覆盖入口和参数才能保持纯终端流程。
- CLI 支持 TTY 隐藏密码登录、`work create --wait` 和 `chat --message`。Core 在创建 Work 时保存 running 意图并开始运行；CLI chat 自动创建 Session 并流式输出回复。
- 创建 Work 要求 Core 已 READY。完整交付探针包括全部运行依赖，不能用容器 ID 或 `/healthz` 代替。
- Core 新空目录会在首次初始化时设为 0700，已有安装仍校验权限和格式；Docker bind source 必须在宿主与 Core 容器使用同一绝对路径。
- 当前 `core.env.example` 是 Compose 专用的单引号格式。Docker `--env-file` 会保留引号和 `$` 等实际字符，不能直接复用该模板。
- 打包脚本显式复制安装材料，并要求当前源码输入、构建身份、远端固定 digest 和协议一致；改动 scripts 也会改变 sourceInputHash。

本变更调整 docker-delivery 的 D001、D002、D005、D006、D009，新增 D010、D011。D009 原先排除独立终端 Docker 验收，必须显式改为增加本次 Linux 最短路径检查；既有 Windows/Desktop 事实保留，不能由新终端证据替代。

## Goals / Non-Goals

**Goals:**

- 以首次终端模型回复为终点，固定入口、变量来源、存储、就绪与恢复规则，让实施者可以直接落实文档和检查。
- 保留旧包试用能力，在新包尚未发布时提供正确的原始值配置创建方式。
- 通过可执行检查约束 Docker run、Core Compose Demo、双语文档和材料清单持续同步。

**Non-Goals:**

- 不新增业务命令、包装器、初始化服务、API、数据格式、迁移或第三方运行依赖。
- 不修改 Go/TS 业务源码、Dockerfile 默认行为、Desktop 功能、凭证安全规则、Work/Service 生命周期或模型地址校验。
- 不扩展为全部 CLI 功能或新的 Windows 实机验收；不触发 push、上传、Release、部署或历史验收改写。

## Decisions

### 1. 固定两种终端入口与文档布局

默认 Quick Start 使用同机 Linux、rootful Engine 28+、linux/amd64。每个入口是一条逻辑上的 Docker run 命令，采用续行，不追求物理单行。CLI 选择一次进入交互容器，避免每个业务命令重复 Docker 参数；不增加长期运行的 CLI 服务或 shell alias。

README 保留现有 160×160 图片，通过居中的 HTML 段落展示。Docker 主流程展开，原生 CLI 使用一个默认关闭的 details 区域；折叠内容直接连接已准备好的 Core，显示 Linux 命令并说明 Windows 可执行文件替换，不出现 Desktop 启动。

代码块按准备材料、宿主机启动、CLI 容器内等待、登录/创建、聊天分开。两个语言版本的对应代码块完全一致；网络、配置、存储和镜像参数依次排列，沿用四空格续行缩进。业务命令使用源码现有拼写，不提供省略号或新顶层命令。更长的诊断、停止、重建和文件交换步骤放入安装手册并提供导航。

### 2. 原始值模板与已发行旧包兼容

新 `deploy/docker/core.run.env.example` 只要求填写五项初始化信息：PIWORK_ADMIN_ACCOUNT、PIWORK_ADMIN_PASSWORD、PIWORK_MODEL_PROVIDER、PIWORK_MODEL、PIWORK_API_KEY；提供注释掉的原始值 HTTPS PIWORK_MODEL_BASE_URL 示例。默认值为空，不带语法引号，不含内联注释，不 source 本文件。监听、Docker 连接和数据路径由 Core run 命令明确提供，避免用户配置与 bind 路径分离。

在新的安装目录且不存在 core.run.env 时准备配置：新版包复制 core.run.env.example；旧包缺少该文件时，用带引号的 heredoc 写入相同的空白模板。两个分支得到相同的配置键和注释说明，之后先 chmod 600，再通过 `${EDITOR:-vi}` 填写。若 core.run.env 已存在，准备命令非零退出，不覆盖它。旧包分支不读取或转换 core.env，因此不会混入 Compose 语法引号或已有秘密。

README 说明密码至少 12 位，沿用现有 UTF-16 长度校验而不改 API；测试使用足够长的合成 ASCII 密码。用户仅编辑五个必填值以及可选 HTTPS URL。原始值本来含引号时保留其实际字符，不为了配置语法在值外额外加引号；不能填入多行值。

保留现有 core.env.example 的 Compose 单引号规则。它与 run 模板共用初始化键集合、可选地址约束和安全提示，但不强行统一两种解析语法。旧包公开下载入口保持实际发行地址；新候选存在新模板不意味着旧包已更新。

### 3. Core run 的确定参数

校验安装包与内部 SHA256SUMS 成功后，在安装目录通过 sed 分别读取 PIWORK_CORE_IMAGE 和 PIWORK_CLI_IMAGE，确认其为非空固定 digest 引用；不 source release.env 或秘密配置。release.env 同时通过 Docker env-file 将 Agent/helper 引用传入 Core。

默认数据路径固定为 `/var/lib/piwork/quickstart/core`，与现有 Compose 默认目录隔离；Docker 自动创建新的 bind 目录，Core 完成其既有安全初始化。路径在环境和两端挂载中完全一致。启动命令的参数契约为：

```sh
docker run --detach --init \
    --name piwork-core-quickstart \
    --user 0:0 \
    --network host \
    --env-file release.env \
    --env-file core.run.env \
    --env DOCKER_HOST=unix:///var/run/docker.sock \
    --env DOCKER_CONTEXT= \
    --env PIWORK_DATA_DIR=/var/lib/piwork/quickstart/core \
    --env PIWORK_CORE_URL=http://127.0.0.1:7171 \
    --env PIWORK_LISTEN=0.0.0.0:7171 \
    --env PIWORK_AGENT_GRPC_LISTEN=0.0.0.0:7172 \
    --env PIWORK_AGENT_GRPC_ADVERTISE=piwork-core:7172 \
    --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
    --volume /var/lib/piwork/quickstart/core:/var/lib/piwork/quickstart/core \
    --stop-timeout 60 \
    "$PIWORK_CORE_IMAGE" serve --allow-insecure-remote
```

socket 使用要求源存在的 mount，数据使用可创建空目录的 volume bind；不为 Core 使用命名卷，不增加 Core exchange 挂载或额外 mkdir/pull 命令。说明本例的 7171/7172 监听范围和既有认证；跨机器与 HTTPS 部署指向安装手册。现有数据重进、端口冲突、容器名称已占用均提供诊断，不自动删除数据或改变现有所有权。

### 4. 交互 CLI、就绪与首次回复

CLI run 固定为 `--rm --init -it`、Linux host.docker.internal:host-gateway、PIWORK_CORE_URL=http://host.docker.internal:7171、piwork-quickstart-client-state 命名卷挂载到 /var/lib/piwork/client、`--entrypoint /bin/sh`、镜像参数 `-i`。容器模式和凭证路径继承现有镜像 ENV。无 publish、exchange、Core env-file 或 socket 挂载；Docker 自动创建状态卷并复制镜像内私有目录权限。

容器内先执行一条 `timeout 600 curl` 命令请求 `${PIWORK_CORE_URL}/readyz?profile=docker-delivery`：fail、silent/show-error、output /dev/null、max-time 3、retry 120、retry-delay 5、retry-all-errors。镜像现有 Alpine timeout 为整条等待限制 600 秒，不仅限制重试开始时间。等待失败单独结束该步骤；文档要求停止继续操作并查询 Core 状态/日志，不能串接自动创建或重提聊天。

成功后顺序执行现有命令：TTY `piwork-cli login --account ACCOUNT`；`piwork-cli work create --name 'My Work' --wait`；使用成功结果中的实际 workId 执行 `piwork-cli chat WORK_ID --message 'Hello, Piwork!'`。省去 whoami、work list、显式 start、单独 Session 创建及默认状态查询。回复直接显示在终端，成功需要模型回复及成功结束状态，不以仅获得 Run ID 为准。

Work 等待观察沿用现有 120 秒和 Operation 恢复语义；失败后按原 operationId 查询。聊天中断按现有 Run ID/cursor 恢复，Ctrl+C 取消语义不改变。`exit` 移除交互容器但保留状态卷与 Work；同一启动命令重进后先等待 Core，再可使用已有登录或显式重新登录，不需 Desktop open。

### 5. Compose Demo 与平台兼容

默认 README 的 Compose 导航指向安装手册中新建的可选 Core Demo 小节。保留 compose.core.yaml 和 Compose 专用 core.env.example，配置后使用现有 up -d --wait --wait-timeout 600 启动 Core；按当前材料先创建 Core 私有数据及 exchange 目录。Demo 使用原有 `/var/lib/piwork/core` 路径，CLI 继续使用第 4 节的同一 Docker run。

两个 Core 示例二选一，切换前正常停止当前 Core，避免 7171/7172 冲突；数据目录隔离不代表能同时监听相同端口。现有 compose.cli.yaml 与 Linux override 保留为高级 Desktop 兼容材料，不进入默认试用或 Core Demo 主流程。无需合并 Compose 或添加 CLI Compose 配置。

安装手册明确 Windows PowerShell 使用 Linux CLI 镜像并连接实际可达 Linux Core；host-gateway 参数只用于同机 Linux，Windows Core 不获得支持。根 README 不展开整套 Windows Docker 示例，保留手册导航与原生 CLI 说明。原生折叠路径仍须先等已部署 Core 完整就绪，再使用显式 login/create/chat。

### 6. 打包和持续一致性检查

在既有复制清单中增加 core.run.env.example。SHA256SUMS 继续基于实际 staging 文件生成，不增加子目录或改变归档格式、manifestVersion、协议、版本、schema 或兼容性声明。材料检查与运行镜像发布验证独立：正式 package 仍要求当前 build.json、sourceInputHash、真实远端 digest 与同一镜像身份；不能手改构建元数据满足检查。

新增 `scripts/check-docker-quickstart.mjs`，只使用 Node 内置库。读取限定章节的 fenced code、env 模板、Dockerfile 默认值、Core Compose 和打包复制清单；归一化续行并提取本方案用到的明确参数，不实现通用 shell/YAML 解释器、不执行文档中的命令或 source 文件。检查下列外部契约并返回具体文件/字段的错误：

- 中英文对应命令一致、Logo 居中、Docker 展开、原生 CLI 折叠，主流程无 GUI/CLI Compose。
- 两个镜像变量来源、固定 digest 使用方式、Core socket/host 网络/同路径存储/60 秒关闭预算，以及默认命令与模板不冲突。
- CLI 入口、host-gateway、Core URL、凭证卷和镜像 ENV 约定一致；无端口、交换卷或 Core 秘密/数据挂载。
- 必填初始化键、run 原始值示例与旧包 heredoc 的内容一致，Compose 初始化键对应，完整就绪路径与等待预算正确。
- Core Demo 的 image/env/网络/持久化/关闭配置与默认路径遵守相同契约，目录差异为上述明确隔离路径。
- 打包清单包含两个 Core 模板和双语手册；检查仅打印文件/字段，不打印配置值。

新增对应的 `.test.mjs`，用临时目录和合成夹具验证缺模板、错误路径、缺 host-gateway、误发布端口、Core 秘密传入 CLI、关闭预算变化及中英文命令漂移确实被拒绝。既有 Makefile 的 scripts/*.test.mjs 会发现它；测试同时运行仓库材料的正向检查。打包入口在复制材料前调用检查器，AGENTS.md 写明相关修改必须同步材料和检查。无需新增生产依赖或计划任务。

### 7. 验证层次与证据

文档检查：shell 语法、对应代码块、相对链接/锚点、Markdown 渲染、Logo/折叠状态和 git diff --check。纯文档部分不运行全仓业务测试。

材料检查：在受控临时目录执行真实准备命令的新模板/旧包分支，校验不覆盖已有 env、五项空白值、0600、下载失败和非法/不符 checksum 后不解压。使用合成 `$`、空格、引号分别验证实际 Docker env-file 与 Compose 解析，Compose config 输出只处理合成值；验收报告仅记录是否匹配。候选材料夹具验证两模板存在、内容和 SHA256，明确不是正式发布包。

运行检查：分别以已发布的固定镜像或通过既有门禁的候选镜像执行 Docker run Core 和 Core Compose Demo，使用独立 Engine 28+ 或隔离安装/数据/卷，CLI 从同一镜像通过真实 TTY 登录。验证首条真实模型回复、CLI 重建免登录、Core 重启后原 Work/Session/Run/历史及受管卷身份保留、正常 Core stop 后本安装受管运行容器停止。配置缺项、短密码、缺 socket、镜像不可取得和端口冲突均不能报告就绪；Work/Run 中断恢复不重复 mutation。

新增 `docs/docker-quickstart-acceptance.md` 记录本次具体命令、镜像身份、环境、对象 ID、状态和未执行项，引用既有记录而不覆盖 D01–D09 历史。真实模型输入从已有私有测试材料取得并仅供本次 Core；没有可用模型时明确未验证，不能把 fixture 结果记为真实回复。

## Risks / Trade-offs

- [首次使用代码分行后行数增加] → 以必需操作和用户决策数量衡量最短路径；保留完整命令，减少重复 pull、配置 CLI、浏览器和冗余 start/list。
- [旧发行包没有新模板] → README 提供相同空白模板的 heredoc 分支，由检查器防止副本漂移；不声称旧包已被更新。
- [run 与 Compose 的秘密解析不同] → 分开模板，实际解析仅使用合成值验证；原始值不包语法引号，既有 Compose 规则不改变。
- [新目录或状态卷权限不符合 CLI/Core 检查] → 在真实容器首启、重建和已有目录负向场景验证，保留业务权限校验。
- [脚本变化使旧 build.json 无法生成新正式候选] → 保留身份门禁，先完成材料夹具与已发布镜像命令验证；记录正式候选未执行项，不自动 push 或篡改元数据。
- [历史验收被误用于新默认路径或 Windows] → 本次 Linux 终端记录独立列出，Windows/Desktop 和原生验收边界不变。

## Migration Plan

实施顺序为模板、双语 README 与基础检查、Core Demo/手册与扩展检查、打包材料门禁、两种 Core 部署的终端验证和证据记录。现有真实 env、Core 数据及 CLI 卷原地保留，不执行数据迁移。

旧用户继续使用已有配置；新用户使用新的独立 run 配置。文档回退恢复先前入口及材料，不自动更换运行镜像或删除数据。新镜像/安装包的推送、上传和对外发布仍需用户针对具体产物另行判断，pphboy 登录状态不改变这一边界。
