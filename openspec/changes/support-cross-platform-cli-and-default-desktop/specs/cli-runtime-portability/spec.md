# Spec Delta

## Purpose

使同一个用户 CLI 在 Windows 和 Linux 上以原生可执行文件运行，提供完整的现有客户端能力、Desktop 默认入口和等价的本地安全保证。跨平台支持覆盖真实运行、状态恢复与发布验收，不以文件扩展名或某一种启动手势代替功能支持，也不扩展 Core 的部署范围。

## ADDED Requirements

### Requirement: 两个平台运行同一个完整用户客户端

**Identifier:** CLI-PORT-001

用户客户端 SHALL 在 Windows 和 Linux 上支持全部既有 `piwork-cli` 命令族，包括登录/身份/退出、状态、Skill/Package 查询、Work 生命周期与配置、Service、包管理、离线 Inspect、快照导出/下载/导入、Operation、Session、Run、Chat、proxy 和 Desktop 及其本机恢复命令。除 CLI-DEFAULT-001 的默认路由改变外，既有参数、JSON/流式输出、stdout/stderr 分工、错误码、超时及等待/取消契约 SHALL 保持，不以客户端操作系统拒绝某个命令族。

客户端 SHALL 连接既有 Core，不要求本机运行 Core、Console、Agent/helper、Docker 或容器镜像；依赖于 Core 的能力 SHALL 根据真实响应报告就绪、缺失、授权失败或不可达。CLI 平台迁移 SHALL 不改变 Core API、包/快照格式、资源身份、权限判断及远端生命周期。

#### Scenario: 两个平台执行业务命令
- **WHEN** 两个平台的客户端以同一账号连接同一 Core，执行查询、Work/Service 控制、包、快照及会话命令
- **THEN** 均遵守相同业务准入和输出契约，已接受的 Operation/Run 可通过原 ID 继续查询；没有 Windows 专用的能力删减

#### Scenario: AI 和脚本消费结果
- **WHEN** 脚本调用现有 `--json` 业务命令、Run watch 或 Service logs
- **THEN** 获得既有 JSON/事件流及退出码，业务 stdout 不含 GUI 启动信息、平台诊断或敏感凭据

#### Scenario: Core 不可达或能力不足
- **WHEN** 本机没有容器运行环境，Core 网络断开或报告某项能力不可用
- **THEN** 客户端分别报告真实网络/能力状态，不尝试本机部署；Desktop 登录、连接配置和离线 Inspect 仍按原准入可用

### Requirement: 私有持久状态具有等价的用户隔离和并发保证

**Identifier:** CLI-PORT-002

凭证、Desktop 偏好、已知 Operation 记录、实例状态及含私有内容的临时目录 SHALL 由当前系统用户控制，普通其他用户不能读取或修改。Linux 的现有用户配置路径、凭证版本及私有权限语义 SHALL 保持；Windows SHALL 在未显式指定路径时使用当前用户配置目录。`PIWORK_CONFIG_PATH` SHALL 在两平台继续覆盖凭证位置，显式 `XDG_CONFIG_HOME` 的现有覆盖用法 SHALL 保持；Desktop 持久状态跟随该配置位置，不依赖可执行文件位置。默认目录不依赖工作目录；显式相对路径覆盖 SHALL 保持按调用目录解析，并在实例启动时固定为绝对位置。

状态读写 SHALL 拒绝链接/重解析点越界、异常文件类型、不可验证的所有权或权限、私有状态的额外硬链接及目标替换竞态，不以不可靠权限模拟或先破坏旧文件的方式完成。写入 SHALL 使用私有临时文件、排他锁和完整提交，失败不发布半个状态。无法提供这些保证的存储位置 SHALL 安全拒绝，不自动放宽访问控制。

既有凭证版本与 Core 绑定 SHALL 保持；退出清理 SHALL 在同一锁内比较目标会话，只删除本次目标，保留并发产生的新登录。旧格式的已知 Operation 记录 SHALL 继续按 Core/用户隔离读取；记录写入失败不能把已接受的远端操作误报为未接受或自动重提。

#### Scenario: 默认目录和显式覆盖
- **WHEN** 两个平台首次登录，或以包含空格/中文的 `PIWORK_CONFIG_PATH` 指定安全位置
- **THEN** 在相应用户配置位置安全保存版本化凭证，新进程可以复用；不在程序安装目录创建状态

#### Scenario: 他人可读或链接目标
- **WHEN** 凭证/偏好/私有记录指向普通其他用户可访问、链接、重解析点或额外硬链接目标
- **THEN** 拒绝访问并给安全错误，保留原目标，不输出 token、不修宽权限、不沿越界目标读写

#### Scenario: 登录与退出竞争
- **WHEN** 对旧会话 A 的退出清理与新会话 B 的登录保存交错
- **THEN** 最终保留 B，不能因旧退出删除新登录；任何读取只观察完整的版本化状态

#### Scenario: 存储失败与已接受操作
- **WHEN** 保存凭证/配置失败，或 Core 已接受 Operation 但其本地记录保存失败
- **THEN** 前者明确报告本地失败并保留旧状态；后者保留原 ID 和已接受事实，说明恢复限制，不自动重提业务请求

### Requirement: 本机 Desktop 恢复通道在两平台保持可信边界

**Identifier:** CLI-PORT-003

`desktop open/logout` SHALL 在 Windows、Linux 上仅连接同一系统用户拥有的指定端口 Desktop 实例，保留 CLI-DESKTOP-002、CLI-DESKTOP-003 的票据、退出码、超时、条件清理和恢复契约。通道 SHALL 不依赖调用目录、Core 地址、平台登录凭证或 `PIWORK_CONFIG_PATH`，不接受网络远程调用或其他普通系统用户冒用。

启动失败、正常退出及进程被强制结束后 SHALL 不留下能够冒充活跃实例的控制状态；后续恢复须检查实例身份和存活状态，陈旧状态不得提供 ticket、删除新实例资源或永久阻止再次启动。浏览器入口 SHALL 保持 Host、Origin、Cookie、CSRF、单次 ticket、会话容量和 Service origin 隔离。

#### Scenario: 同用户跨进程恢复
- **WHEN** 同一用户从不同目录及不同环境执行 `desktop open --port ... --no-open`
- **THEN** 返回既有实例的新票据链接，实例 PID、Core 和平台身份不变，不访问 Core 或读取凭证

#### Scenario: 不同系统用户和伪造通道
- **WHEN** 另一普通用户连接或预置同名控制通道/元数据
- **THEN** 权限和对端身份校验拒绝，不能取得票据、执行 logout 或冒充原实例；安全错误遵守现有 exit 3 契约

#### Scenario: 实例退出和崩溃后恢复
- **WHEN** 原 Desktop 已退出或崩溃，再运行 open/logout 或启动同端口新实例
- **THEN** 恢复命令对确实不存在的实例返回 exit 4；陈旧状态不复用旧授权，安全清理后新实例可正常启动，不清理其他活跃实例

#### Scenario: 本地和平台授权仍相互独立
- **WHEN** 浏览器 ticket 过期、Core token 过期，或用户执行 desktop logout
- **THEN** 分别进入原有本地授权恢复、账号重新登录或当前平台会话清理；均不通过 Windows 支持扩大浏览器权限或停止 Work

### Requirement: 文件传输与包检查不依赖客户端平台

**Identifier:** CLI-PORT-004

快照导出/下载/导入、离线 `.work` Inspect 和 Desktop 传输 SHALL 在两平台保留原有大小/数量/磁盘预留限制、内容校验、流式进度、取消和身份隔离。下载 SHALL 在完整验证后发布，不能覆盖已存在的目标，包括并发创建的目标；失败不留下被认作完整结果的部分文件。导入 SHALL 验证普通输入文件及检查期间的文件身份和内容稳定性，异常替换或修改不得进入业务提交。

包内容 SHALL 按协议作为数据处理；Linux 路径、权限位、链接和镜像元数据不能被解释为要求 Windows 本机运行或解压执行。Inspect SHALL 不需要 Core、登录或容器运行环境，不因客户端操作系统与包内 Work runtime 不同而拒绝合法包。安装/恢复是否兼容 SHALL 由既有 Core/runtime 判断。

临时资源 SHALL 私有且有界，身份切换、过期和正常退出按原规则回收；清理旧目录 SHALL 先确认不属于活跃进程，无法确认时保留并安全报告，不删除别的实例。磁盘空间不足或无法可靠确认配额 SHALL 在接受相应本地传输前拒绝，不影响独立的轻量读取。

#### Scenario: Windows 检查 Linux Work 包
- **WHEN** Windows 客户端离线 Inspect 含合法 Linux 文件元数据和镜像描述的 `.work`
- **THEN** 按相同协议给出摘要和验证结果，不展开成宿主文件树、不执行内容、不以 Windows runtime 不匹配报错

#### Scenario: 下载目标竞争
- **WHEN** 下载校验完成前另一进程创建了目标文件，或目标已是链接/重解析点
- **THEN** 不覆盖原目标、不沿链接写入，返回失败并清理本次私有临时文件

#### Scenario: 输入替换和传输中断
- **WHEN** 导入/上传输入在检查或提交前被替换、修改，或客户端中止传输
- **THEN** 检测不稳定输入或按原取消规则退出，不提交被替换内容，不保留假完整下载，不擅自取消已接受的 Core 操作

#### Scenario: 配额与多实例清理
- **WHEN** 临时传输达到原限制、空间不足，或存在活跃和陈旧实例目录
- **THEN** 拒绝新的受限传输、保持已有可用读取；仅清理可确认的陈旧私有资源，不删除活跃实例或其他用户内容

### Requirement: 本地文件参数和 Pi 包来源采用本平台路径语义

**Identifier:** CLI-PORT-005

客户端本地文件参数 SHALL 接受本平台的普通相对/绝对路径及空格、中文名称。Pi 包来源 SHALL 保留 `npm:`、`git:` 和既有 Linux 本地来源语法，并在 Windows 接受显式本地相对路径、盘符绝对路径及 UNC 文件路径；盘符相对路径、设备命名空间、替代数据流等歧义或危险形式 SHALL 安全拒绝，不误判为 npm/git 来源。宿主分隔符 SHALL 只用于访问客户端文件，不改变传给 Core 的归档路径和协议标识。

本地目录和 ZIP 上传 SHALL 保持规范排序、摘要、边界、manifest 校验和来源显示名称；Windows 普通目录/文件 SHALL 使用协议规范的目录 0755、普通文件 0644，不能从 `.exe` 后缀推断包内执行权限。原有 Linux 可执行位和已有 ZIP 的协议权限 SHALL 保持。真实符号链接仅作为经过既有安全相对目标校验的归档条目，不跟随到根外；junction 或其他重解析点不得冒充普通包内容。需要保留 Windows 本地目录无法表达的执行位时，文档 SHALL 指向携带相应元数据的 ZIP 来源。

#### Scenario: 本平台目录和 ZIP 来源
- **WHEN** 用户提供 Linux 的 `./包目录`，或 Windows 的 `.\包目录`、`C:\包目录\source.zip`、合法 UNC 路径
- **THEN** 按本平台路径选择本地目录或 ZIP，不误判远端来源；来源名称和内容按原接口上传，中文和空格保持

#### Scenario: 远端语法和危险 Windows 路径
- **WHEN** 用户使用合法 `npm:`/`git:`，或提交盘符相对、设备路径、替代数据流来源
- **THEN** 前者保持原解析和请求；后者在业务提交前拒绝，不进行猜测转换或发送错误来源

#### Scenario: 路径规范和模式
- **WHEN** Windows 普通目录被打包，或上传带合法可执行权限的现有 ZIP
- **THEN** 归档使用协议 `/` 路径和规范模式，摘要遵守原协议；ZIP 记录的合法执行权限保留，不依据文件后缀重新生成

#### Scenario: 链接和文件变动
- **WHEN** 来源含越界符号链接、junction、异常类型，或检查后的文件被修改
- **THEN** 拒绝不安全来源，不跟随根外目标、不悄悄漏掉文件，不接受与已检查内容不一致的上传

### Requirement: 中断语义与本地前台生命周期保持一致

**Identifier:** CLI-PORT-006

两平台的 Ctrl+C SHALL 进入既有命令取消路径；Desktop/proxy 关闭本地连接和本次临时资源，前台命令按原约定退出。Work/包/快照等待中断 SHALL 只停止本地观察，已接受的 Operation 继续；Chat 中断 SHALL 保留现有对活动 Run 发起取消的专用行为。关闭浏览器窗口 SHALL 不退出 CLI 或停止任何远端任务。

可捕获的系统终止 SHALL 尽可能执行有界本地清理；系统强制结束不承诺执行退出回调，下一次启动 SHALL 通过安全恢复处理残留。不得为某种启动方式增加退出按键等待、强制留窗或后台守护；本地入口退出不能被扩大成 Work/Service/Operation/Run 的统一取消。

#### Scenario: 中断 Desktop 和 proxy
- **WHEN** 用户在两平台运行 Desktop/proxy 并按 Ctrl+C
- **THEN** 本地监听和活动连接结束，按原退出码退出，可重新启动；已接受的远端工作继续

#### Scenario: 等待和 Chat 的不同取消规则
- **WHEN** 用户中断 `--wait` 观察，或中断拥有活动 Run 的 Chat
- **THEN** 前者只退出本地观察，后者按原 Chat 规则请求取消原 Run，不能统一处理成退出 Desktop 或取消所有任务

#### Scenario: 系统强制结束
- **WHEN** CLI 被操作系统强制结束，随后重新启动
- **THEN** 不宣称已经执行退出回调；残留通过实例身份和私有状态验证恢复，不阻止新实例或复活旧票据

### Requirement: 交付独立原生客户端并以实际运行验收

**Identifier:** CLI-PORT-007

项目 SHALL 提供只构建/发布用户客户端的入口，按发布配置选择目标并交付 Windows 原生 `.exe` 和 Linux 原生可执行文件；Desktop 静态资源 SHALL 内嵌，运行不依赖源代码目录、相邻 WebUI 文件或 Go/Node.js/Python/Docker 安装。构建工具可以在构建环境使用，不成为用户运行要求。客户端发布 SHALL 不要求构建/拉取 Core、Agent 或 helper 容器镜像，现有 Linux 全组件发布保持可用。

发布物 SHALL 携带可核对的版本、commit、dirty 标志、工具链、目标信息和校验和，打包格式和说明适配目标。操作系统版本、发行版和 CPU 架构的实际构建目标 SHALL 在发布配置及相应验证记录中表达，不成为额外写死的产品限制；不能由一个目标通过推断所有目标已支持。

每个交付目标 SHALL 有对应原生环境运行证据，覆盖完整命令分派、凭证/偏好、文件/包/快照、受信本机控制、Desktop、proxy、取消及主要失败场景。交叉编译或仅执行 help/version SHALL 不算完成运行验收。无法运行的目标 SHALL 明确记录为未验证，不发布为已完成支持。

#### Scenario: 在无开发工具的客户端机器运行
- **WHEN** 用户在 Windows/Linux 解包相应发布物，从其他工作目录启动 CLI
- **THEN** 可运行显式业务命令和默认 Desktop，UI 来自二进制，不查找本地源代码、Node 或容器环境

#### Scenario: 独立构建和全组件构建并存
- **WHEN** 运行仅客户端发布入口，或原 Linux 全组件入口
- **THEN** 前者只产生所选客户端且不触发镜像构建，后者保持原交付范围和验证契约

#### Scenario: 发布身份和校验
- **WHEN** 核对发布物清单、校验和及 `--version`
- **THEN** 可确认相同构建的目标、版本、commit 和 dirty 状态；错误文件类型、缺少 UI 或摘要不符的产物不能标为合格

#### Scenario: 原生验收缺失
- **WHEN** 某目标只有交叉编译或 help/version 结果，没有完整原生运行记录
- **THEN** 验收明确标为未验证，不能用其他平台的结果替代或宣称完整支持已闭环
