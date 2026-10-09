# Tasks

本次修订：默认 Core、CLI 独立运行，合并 Compose 收入 examples/single-host/ 的单机部署示例。重新打开的任务须按新候选复验；保留勾选仅表示不受本次修订影响的既有成果。旧候选验收不等于新方案通过，发布仍等待用户判断。

## 1. 从源码直接构建 Docker 发行镜像

- [x] 1.1 新增 Dockerfile.docker-release 的 metadata 导出目标，输出真实版本、commit、修改状态、源码输入摘要、发行标识和 Desktop 资源摘要；用 Docker build 本地导出核对结果，并以输入变化和未知身份的负向用例验证拒绝行为。
- [x] 1.2 将 Dockerfile.core 改为 Go 1.25.5 多阶段编译，并保留静态 linux/amd64 与固定运行层；在无预先生成 dist 的源码目录构建，核对 piwork-serve --version、平台与运行工具边界。
- [x] 1.3 将 Dockerfile.cli 改为 Node 24 资源阶段与 Go 编译阶段，复用资源摘要/同步逻辑，保留原生 CLI 构建链；核对内嵌资源摘要、容器 --version，运行 scripts/build-cli.test.mjs 及受影响的原生发行检查。
- [x] 1.4 统一 Agent、file-helper、snapshot-helper 的发行输入与标签，package helper 继续复用 Agent；Docker inspect 与二进制版本检查证明同一输入、平台及当前协议组合，包含 Work history schema 5。
- [x] 1.5 更新 docs/docker-release.md 的 Docker build 流程、角色说明及绑定审阅清单的发布入口；明确宿主仅需 Docker 构建能力、Git 和终端工具，按文档核对无需宿主 Go/Node/npm/Make 或额外 Release 工具镜像，推送预检与授权边界清晰。

## 2. Core 发行默认配置与环境初始化

- [x] 2.1 增加版本化非敏感发行配置及加载逻辑，通过 PIWORK_RELEASE_CONFIG_PATH 取得 Agent/helper 默认引用；测试合法配置、未知字段、非法引用及秘密字段被安全拒绝，诊断不回显文件内容。
- [x] 2.2 调整现有初始化解析，区分发行依赖默认值与用户实际模型输入，保留显式输入优先级、兼容别名和原生显式初始化；对应测试证明仅有 defaults 时健康可访问、完整用户输入可初始化、部分或非法输入继续失败。
- [x] 2.3 验证已有管理员/runtime/Work 不被合法新环境值或新发行 defaults 覆盖，非法输入仍拒绝，可选 Base URL 未设置与空值保持区别；运行 internal/coreapp 的对应初始化、持久状态及恢复单元/契约测试。
- [x] 2.4 将数据、监听、Docker API 和完整 readiness 默认值写入 Core 镜像，添加完整交付 healthcheck；构建后检查实际镜像配置，并用合成安装验证缺项非就绪、合法输入准备成功和 60 秒 Docker 关闭窗口。
- [x] 2.5 同步 docs/operations.md 与 Docker 手册的初始化/默认值说明；核对文档与源码一致，默认用户无需提供 Agent/helper 引用，原生与高级显式配置入口仍可使用。

## 3. CLI Docker 默认终端入口

- [x] 3.1 新增镜像内 cli-entrypoint.sh，无参数时在单一 600 秒总预算内等待完整 readiness，成功后 exec 交互 shell；合成探针测试覆盖未监听、503 后成功、永久失败、非法 Core origin、超时及退出信号，确认不显示秘密。
- [x] 3.2 显式参数直接 exec 现有 piwork-cli，并将 Docker 默认 CMD 改为空；用实际镜像验证离线 --help/--version 无等待、业务参数及退出码转发、显式 desktop --no-open 仍进入原命令，原生无参数默认不变。
- [x] 3.3 核对镜像用户状态路径、私有目录权限和信号行为，不添加 Core 环境、socket、Work 挂载或 CLI healthcheck；用容器检查和入口测试证明默认模式不启动 Desktop、不发布客户端端口。
- [x] 3.4 更新 Docker 手册中独立 CLI 的终端进入、退出/重进和显式命令说明；按所写 Docker run 命令连接已有 Core，确认无需 CLI Compose、--entrypoint 覆盖或 curl 等待循环，不传入 Core 初始化秘密。

## 4. 独立启动、Core Compose 与单机部署示例

- [x] 4.1 将 deploy/docker 的默认 docker-compose.yml 及模板改为仅定义 Core，移出 CLI profile、依赖和状态卷；以合成输入解析生成文件，确认固定镜像、同绝对路径 bind、socket、健康检查与关闭预算正确，无 env_file、include、extends、release.env 或第二个 YAML。
- [x] 4.2 默认 Core Docker run 与 Core Compose 共用 /var/lib/piwork/quickstart/core，独立 CLI 使用 piwork-quickstart-client-state；单机示例使用 /var/lib/piwork/examples/single-host/core 和 piwork-single-host-client-state。验证路径、私有权限、安装锁、socket 缺失和示例端口冲突说明，不创建伪 socket 或修改其他安装。
- [x] 4.3 Core 初始化变量只按名称传入，Core Compose 和单机示例保留可选 Base URL 未设置语义，独立 CLI 与示例 CLI 只取得 Core URL 等客户端配置；用合成特殊字符、空值及缺项检查实际输入和安全失败结果，不输出真实展开配置。
- [x] 4.4 同步 deploy/docker 双语手册的独立 Core/CLI 命令、Core-only Compose 和运维恢复步骤，引用 examples/single-host/ 单机部署示例；保留已有高级 Core Demo、Desktop 和旧包的明确归属，检查默认流程无 CLI Compose、配置文件编辑或 GUI 步骤。
- [x] 4.5 验证仍受支持的高级 Core-only Demo 与同版交互 Docker run CLI 兼容，确认完整就绪、实际终端回复及独立存储；记录使用镜像与结果，不要求新默认用户进入 Demo 或 GUI。

- [x] 4.6 将原合并 Compose 整理到 examples/single-host/docker-compose.yml，新增双语示例说明并纳入同版生成来源；验证两个独立容器、CLI 交互 profile、专属路径/状态卷、固定引用、独立可下载及端口冲突处理，根文档和官网链接可追踪。
- [x] 4.7 单机示例 CLI 不管理 Core 依赖，进入命令使用 run --rm --no-deps cli，由镜像入口等待 readiness；集成回归在缺少或改变初始化变量的新终端重进，证明 Core ID/启动时间和运行 Work 不变，Core 缺失时只失败、不自动创建或启动。

## 5. README、候选材料导出与一致性门禁

- [x] 5.1 将根目录双语 README 的完整 Architecture 图和说明移到 Problem 前，保留居中 160×160 Logo、顶部互链和其余材料槽位；核对两种语言章节顺序、图和解释同步，运行 git diff --check。
- [x] 5.2 重写双语 README Try，删除旧下载/配置步骤，分成 Core 和 CLI 两个独立 Docker run 入口；Core 提供 Core-only Compose 链接，合并部署仅链接单机部署示例，保留原生 CLI 折叠。检查多行命令语法、两语命令、执行位置与登录/创建/聊天闭环一致。
- [x] 5.3 更新 materials 导出，区分 Core-only Compose 与 examples/single-host/ 示例、双语说明、候选清单和校验；非敏感镜像记录通过命名构建上下文传入。测试源码/身份/协议/资源变化、材料缺失和清单篡改均失败，保留秘密排除，生成发布入口接入任务 5.6 的实时预检。
- [x] 5.4 更新 check-docker-quickstart.mjs 及测试，覆盖默认独立命令、Core-only Compose、单机部署示例及文档引用、镜像 defaults、手册、清单和各自存储规则；执行指定脚本与 node --test scripts/check-docker-quickstart.test.mjs，负向漂移和合成秘密不输出用例通过。
- [x] 5.5 在导出前执行门禁并反向核对全部生成材料、引用及 SHA256，保留旧包独立校验；按 Docker 发行文档生成新候选，确认单机示例可单独取得且没有依赖旁置文件，不 push、不伪造远端 digest 或正式发行状态。

- [x] 5.6 实现绑定已审阅清单的可执行发布预检，首次 push 前重新检查五个角色实时本地身份及实际远端 manifest/config；补充本地标签重指向、远端冲突、认证/网络失败、未知结果与有效演练测试，全部失败和演练均零 push，仅确认不存在或身份匹配可通过，文档不再推荐盲推可变标签。

## 6. 同步官网源文件及下载材料

- [x] 6.1 同步官网双语首页和 Quick Start 为独立 Core/CLI 命令，Core-only Compose 只用于 Core，合并方式链接单机部署示例；检查旧步骤移除、无 GUI 前置，与根 README 的版本、命令、存储、就绪规则一致。
- [x] 6.2 同步双语 installation、First Work、source-installation、导航及 piwork/README.md 的全部当前入口与示例引用；核对两语无旧候选标签，源码安装、管理员、高级 Desktop 与默认入口区分清楚。
- [x] 6.3 在独立 install/<release-id>/ 目录区分提供 Core-only Compose、单机部署示例 Compose、来源和校验，并明确文档下载链接；保留旧 0.0.1/0.1.0 内容，候选未公开不得宣称可下载，不混入秘密。
- [x] 6.4 扩展显式官网路径门禁，覆盖双语首页、Quick Start、installation、First Work、示例和当前下载引用；逐类注入旧标签/缺失引用证明失败，排除冻结历史材料，运行官网 pnpm build 与链接检查。

- [x] 6.5 官网使用共享渲染或标记生成区段重生成全部当前镜像引用，覆盖已为字面标签的 First Work；连续同步 A、B 两个候选的回归测试证明双语当前入口全部为 B、历史版本保持原样，再注入 A 证明门禁失败。

## 7. 本地集成验收与推送审阅材料

- [x] 7.1 按修订后最终源码重建全部候选角色与材料，重新检查实际身份、源码摘要、UI、运行边界、协议、Core Compose 和单机示例；记录本次真实平台，不沿用修订前候选作为通过证据。
- [x] 7.2 在独立无依赖缓存的 Linux 安装用新候选验证默认独立 Core/CLI Docker run 的自动准备、TTY 登录、Work 创建及首条真实模型回复；本地 mirror 来源明确记录，不称为 Docker Hub 发布。
- [x] 7.3 分别在独立安装验收 Core-only Compose 配合独立 Docker run CLI，以及 examples/single-host/ 合并 Compose 示例；按文档证明无额外环境文件、YAML、配置编辑或 GUI，完整就绪后取得真实模型回复，示例使用专属数据。
- [x] 7.4 用新候选验证独立 CLI 及示例 CLI 重进保留凭证、Work 继续运行，Core 正常退出停止受管 Work、重启保留 ID/历史/数据/运行意图；覆盖缺少或改变初始化变量的 CLI 重入、依赖失败及观察恢复，清理仅针对精确安装标签。
- [x] 7.5 汇总独立入口、Core Compose、单机示例、官网、发布预检及恢复结果，执行所需单元/契约和 git diff --check；保留修订前验收事实但明确旧候选待修复，提供新候选清单和可执行发布入口供用户重新判断，不自动 push 或发布官网。

## 8. 用户批准后的正式发行复核

此组只在用户明确审核并授权对应对外操作后执行；未授权时保持未完成，不能把本地候选标记为正式发行。

- [x] 8.1 用户明确批准本次候选推送后，经发布入口完成全部角色实时本地身份与远端标签预检，再 Docker push 同一候选；任一预检失败零推送，推送后核对实际远端 manifest digest、源码、协议和 CLI 资源，不一致阻止正式材料通过。
- [x] 8.2 使用不带登录凭据的 registry 配置验证入口和全部依赖可匿名读取，并在无本版缓存的隔离 Engine 复核默认引用的公开拉取与完整就绪；结果单独记录为正式远端验证，不复用本地 mirror 证据。
- [x] 8.3 导出正式 Core-only Compose、单机部署示例、发行清单及校验，更新两仓对应材料公开状态；核对镜像、实际 digest、来源和内容一致，不覆写旧版材料。
- [ ] 8.4 仅按用户对仓库/官网发布的明确指令提供 Core Compose 和单机部署示例的公开下载与文档引用，核对实际下载、校验及双语导航；未获授权或下载不可用时保留待发布，不标记公共交付完成。

当前发行状态：用户已明确授权 Docker Hub 推送，最终 main 对齐快照的 8.1–8.3 已完成。8.4 的官网源码、正式下载文件、本地构建与预览已准备；本地提交按用户要求整理；main 合并、Git 推送及官网部署按用户“最后再确认”的要求等待最终许可，未执行实际公开下载验证，继续保持未完成。
