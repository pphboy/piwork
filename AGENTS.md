# 仓库开发约定

本文件供开发代理和维护者使用。用户入口放在双语 README 与已有部署手册；当前开发契约统一归属 OpenSpec。

## 语言与文档

- OpenSpec 规格使用中文，保留已有 Requirement、Scenario 和标识符约定。
- README.md 是默认英文入口，README.zh-CN.md 提供中文版本；两份文档顶部互链，章节、产品含义、徽章、平台边界与文档导航保持对应。不新增空栏目。
- README 是精简项目首页，保留简短介绍、核心概念、演示与文档/社区入口；安装、配置、操作和构建教程由既有官网、部署手册及本文件承接，不在根 README 内嵌或折叠重复说明。发布同步不改写根 README。
- 开发约定与实现边界放在本文件；当前需求与行为约束放在 OpenSpec Spec；设计、原型和必要验收事实归属对应 OpenSpec 变更。
- AI 不自行创建开发笔记、长期计划、设计报告、验收汇总或替代文档目录。发现需要持久化的新需求、设计决策或开发知识时，先在对话中说明，由项目所有者发起或明确授权 OpenSpec 变更，形成必要 Spec 与规划后再通过 apply 执行；讨论、回答设计问题或继续调查不是落盘授权。
- 已授权变更内可维护必要 proposal、design、specs、tasks 和验收附件，不逐文件重复确认。新范围仍遵循所有者授权；临时日志、截图、生成清单和报告默认放在被忽略的 dist/。
- 仓库根不再建立 docs/，也不以其他目录承接 AI 自建开发文档。用户明确要求的既有 README/安装说明维护、源码注释和测试夹具按原职责处理；随产品交付的 brain.md、SKILL.md、Reference、模板 README、SPEC.md 属于实现，不能按开发文档清理。该规则不向产品 Work 新增 OpenSpec 审批阶段。
- 历史设计和验收记录不能作为当前实现的依据，核对现行源码、规格和实际执行结果。

## UI组件选型

后续UI开发遵循[UI组件规范采用说明](openspec/specs/desktop-ui-language/ui-component-adoption.md)与[Piwork UI Component Specification v1.0原文](openspec/specs/desktop-ui-language/ui-component-spec-v1.0.md)。它是组件选型与基本行为依据，不要求过度设计、全量重写或把无障碍合规作为独立扩项；具体修改与未测事实仍归所属OpenSpec change。

## Git 提交组织

- 默认按功能边界和依赖顺序拆分 commit，使每个提交有明确目的、便于独立审阅和回退；不把多个功能、使用文档、发布材料及 OpenSpec 归档全部塞进一个提交。拆分数量随实际改动确定，不固定为某个数量。
- 使用文档、开发约定与代码实现分别提交；中英文文档的对应修改保持在同一提交。OpenSpec 主规格同步与变更归档单独组织为规格/归档提交，验收记录可随该提交或独立提交。
- 按实际作用判断文件归属，不仅看扩展名。随脑包交付并影响 Agent 行为的 brain.md、SKILL.md、Reference、模板 README 和 SPEC.md 属于功能实现，跟对应脑包或模板修改一起提交。
- 对应单元/契约测试、必要夹具、锁文件和生成产物跟实现一起提交，不能拆出缺少契约或资源的代码提交；例如 proto 与生成代码、Desktop 源码与嵌入资源保持同步。跨组件验收与验收驱动的修改可单独提交。
- 镜像发布记录、固定版本引用、Quick Start 镜像命令及 Compose 等相互绑定的发布材料集中提交，保留发布时真实的 commit、dirty 状态、输入 hash 和 digest；不能为匹配后续 Git 提交而改写已发布制品的身份。
- 同一文件包含不同目的的改动时按 diff 分段暂存，例如部署手册的使用说明与发行镜像引用、Makefile 的构建入口与验收夹具入口。避免用整目录或全量暂存把无关改动带入提交。
- 提交前说明拆分范围与顺序，按每个提交的影响执行相关检查，并在完整序列完成后核对集成与发布材料的一致性。提交标题沿用 type(scope): purpose，如 feat、fix、test、docs、chore，明确本次目的。

## 当前架构

- Go 统一 Linux 应用在同一进程启动两个独立 HTTP 服务：ControlPlane 默认 0.0.0.0:17891 承载托管网页、管理、引导和 Service Proxy；Core 默认 127.0.0.1:17871 供后端、CLI/operator 直连，--core-listen 可显式允许远程客户端。浏览器只连接 ControlPlane；网页业务不导入 Core/store/identity 实现，不使用进程内 transport。Core 保留用户与权限、Work 生命周期、Docker 编排、Service、文件、包和快照职责。入口为 cmd/piwork-serve/，无参数或 serve 由 internal/app/ 协调启动；operator 命令由 internal/coreoperator/ 实现，piwork 是同一程序的别名。
- Go CLI 继续独立提供用户命令、本机代理与 Desktop；cmd/piwork-console/ 保留高级独立管理员 HTTPS 入口。默认统一应用不依赖第二个宿主程序或 CLI 容器。托管浏览器会话不读取 CLI 凭证。
- Service MCP、package-helper、file-helper、snapshot-helper 均由 cmd/ 中对应的 Go 程序实现，随 Agent 或 helper 镜像交付。
- apps/agentd/ 是容器内完整的 TypeScript Pi Agent SDK harness，包含 RPC、Session/Run、历史、模型/工具执行与资源加载。
- packages/contracts/、pi-adapter/、pi-package/、work-store/ 保留 Agent 所需的契约、SDK 适配、包加载和私有历史依赖，不能按“Core 已改 Go”整体删除。
- apps/desktop-webui/、console-webui/ 保留浏览器 TypeScript；构建后的资源嵌入 Go 程序。
- Core、CLI、Console 和 Go helper 关闭 CGo。宿主平台运行时不依赖 Node、npm、Python、Go 工具链、Docker CLI 或 OpenSSL；镜像内 harness/Pi 生态及用户 Service 的语言依赖按各自职责保留。
- Core 使用本机 Docker Engine Unix API，仅部署在 Linux；Windows/Linux 浏览器可通过服务器 IP 直接使用，原生 CLI 仍覆盖 Windows/Linux。默认无业务环境变量，仅可选成对 ADMIN 测试初始化；模型及 Agent/helper 的旧初始化环境变量不再读取。托管 Service 使用同一浏览器 origin 的 /services/<workId>/<serviceId>/<port>/ 路径，应用须支持动态前缀并视为当前用户信任的同源应用；服务端响应 Cookie 分区保留，脚本 Cookie 不同步。独立 CLI Desktop 的本机 Host 入口保留。Agent 7172 mTLS 回连独立于浏览器/Core HTTP。构建工具依赖与用户运行依赖分开描述。
- 当前生产入口使用 Go 平台。旧 TS Core 分支和提交历史保持现状，除非用户另有明确要求，不改写历史或继续处理旧分支。

## 目录约定

| 路径 | 用途 |
| --- | --- |
| cmd/、internal/ | Go 入口与内部实现，包目录使用 Go 小写命名 |
| apps/、packages/ | TypeScript 应用与共享包，工作区目录使用小写连字符命名 |
| apps/*-webui/test/ | 浏览器测试；包内单元测试可与源码并置 |
| scripts/ | 构建、生成、验证与打包入口 |
| deploy/docker/ | 双 Docker 安装材料与手册 |
| fixtures/、internal/*/testdata/ | 必要的合成夹具与协议 golden 数据 |
| apps/ui-shared/assets/ | 两端 WebUI 共用的产品资源 |
| openspec/ | 主规格、变更规划、归档及所属证据/原型附件 |
| dist/ | 被忽略的构建产物与本机验证输出 |

## 运行与数据边界

- operator 身份与用户 CLI 身份分离；用户 CLI 不读取 operator 凭证，管理员控制权限不等于读取他人 Work 内容的权限。
- CLI 与 Desktop 共用用户凭证，但 Desktop 的默认 Core 偏好独立于业务 CLI 的地址选择。调整入口时核对 control-cli、desktop-webui 及 cli-runtime-portability 的有效主规格/变更中的优先级和恢复规则。
- Core 正常退出会停止本安装全部受管 Work 运行容器，保留持久意图、配置、历史和数据，供重启恢复。CLI 或 Console 退出不停止 Work。
- Work workspace 是受管共享卷。导出前须确认 Work stopped；导入得到 stopped Work，随后由用户显式 Start。
- 为开发或测试使用独立安装和数据目录。Docker 清理只针对本次创建的精确 installation ID/标签，不执行全局 prune 或删除其他安装资源。
- 真实 env、密码、API key、token、Core 数据、凭证、快照及私钥不提交到 Git，也不输出到公开文档或验收报告。必要的合成测试数据继续保留，忽略规则维护在 .gitignore 与 .dockerignore。

## 构建与验证

基础环境为 Go 1.25.5、Node 24（.nvmrc）、npm、Git、Make 和 Bash。干净 clone 的基础流程：

```sh
npm ci
make build
make test
```

按改动范围选择验证：

- Go 或保留 TS 业务代码：执行对应单元/契约测试；涉及工作区或构建入口时核对基础构建流程。
- CLI 平台适配：使用 make build-cli，以及有效 control-cli / cli-runtime-portability 规格和对应变更中的平台检查入口。
- 浏览器资源：通过各 workspace 的构建与 Playwright 入口核对；资源嵌入 Go 程序，修改后需重新构建宿主程序。
- Docker、Work 生命周期及真实 Core 交互：执行相关 integration 测试；入口由 Makefile、scripts/ 和对应 Spec/变更中的验证说明提供。
- 平台源码边界：node scripts/check-native-boundary.mjs；镜像边界使用对应 image 检查入口。
- 文档归属与路径：node scripts/check-repository-docs.mjs；检查根目录缺失、当前链接、生成输出和迁移清单，不把历史路径文字、外部官网或用户 Work 的同名目录当作本仓库依赖。
- 纯文档整理：检查链接、命令与源码的一致性以及 git diff --check，无需为此重跑完整模型或 Docker 验收。
- Docker 镜像、初始化环境变量、网络、数据目录、CLI 状态存储、就绪等待或关闭预算变化时，同步双语部署手册的默认 Docker run 命令、Core-only Compose、examples/single-host/ 单机部署示例及其双语说明、官网生成内容、模板和打包清单；根 README 只维护对应的平台短说明与有效导航，不回写教程。执行 node scripts/check-docker-quickstart.mjs 与 node --test scripts/check-docker-quickstart.test.mjs。检查使用合成值，不输出真实秘密；后续材料维护不能只依赖人工记忆。

proto、HTTP DTO 和 Work history 的生成入口为 make generate；变更契约时同步生成产物和相关跨语言测试。历史场景索引和跳过项不能替代实际测试通过。

make release 是本机构建与打包入口。对外推送、发布或发行仅在用户明确要求时执行；不要把本地整理或验收自动扩展为发行。
