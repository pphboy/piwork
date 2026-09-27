# Spec Delta

## ADDED Requirements

### Requirement: Manage Core packages from the operator CLI

**Identifier:** CLI-PKG-001

`piwork-serve` SHALL 提供以下命令，使用 operator 身份；全局 --core/--json 沿用现有解析：

```text
packages list
packages show <name>
packages install <source> [--default] [--wait] [--verbose]
packages update <name> --source <source> [--wait] [--verbose]
packages enable|disable|remove <name>
config default-work show
config default-work set [--package <name>]... [--no-packages]
operation show <operation-id>
```

source SHALL 支持 PKG-001 四种形式，本地目录/ZIP 先按 PKG-003 上传。install --default SHALL 原子追加；default-work set --package SHALL 替换全部默认包，--no-packages 显式清空，两者互斥，均省略则保留原 packages。其他默认字段省略 SHALL 保留。operation show SHALL 只查询 Core package Operation，不提供 Work 内容读取。enable/disable/remove SHALL 同步返回结果，不接受 --wait。

#### Scenario: Install each operator source
- **WHEN** operator 分别使用 npm:spec、git:spec、本地目录或 .zip 执行 packages install --wait
- **THEN** CLI 提交对应来源并等待原 Operation，成功时显示实际 name/version 和 enabled/default 状态

#### Scenario: Update does not guess a source
- **WHEN** operator 执行 packages update tools 却缺少 --source
- **THEN** exit 2 且未发请求，不尝试重新读取历史本机目录

#### Scenario: Observe a Core preparation failure
- **WHEN** Core 包安装脚本失败，operator 使用 operation show 查询返回的 ID
- **THEN** 显示持久 failed/stage/code，查询成功 exit 0，不泄露未经处理的脚本日志

### Requirement: Manage independent Work packages from the user CLI

**Identifier:** CLI-PKG-002

`piwork-cli` SHALL 提供 enabled Core catalog 的 `packages list` 和 `packages show <name>`，以及下列 Work 命令，采用现有用户/Work 授权：

```text
work packages list <work-id>
work packages show <work-id> <name>
work packages install <work-id> <source> [--wait] [--verbose]
work packages install <work-id> --from-core <name> [--wait] [--verbose]
work packages update <work-id> <name> --source <source> [--wait] [--verbose]
work packages update <work-id> <name> --from-core [--wait] [--verbose]
work packages enable|disable|remove <work-id> <name>
```

install 的位置 source 与 --from-core <name> SHALL 恰选其一；update 的 --source 与 boolean --from-core SHALL 恰选其一。四类直接来源 SHALL 与 Core 语义一致；from-core 只复制当前 enabled Core 制品。所有修改 SHALL 仅作用 desired，命令不得隐式 apply。list/show SHALL 显示 PKG-008 的 desired/active/runtime 状态，指明需显式 work config apply；操作成功不能用 installed 代替 loaded。

#### Scenario: Install locally and activate explicitly
- **WHEN** 用户 work packages install W ./tools.zip --wait 后查询配置，再 work config apply W --wait
- **THEN** 第一步只等待 desired 提交；第二步才验证和激活，list/show 能分别观察两个时点

#### Scenario: Copy from Core after import
- **WHEN** 用户对已导入 Work 执行 work packages update W tools --from-core
- **THEN** 选择当前连接 Core 的 tools，不联系最初导出 Core；同名不存在/disabled 时明确失败

#### Scenario: Reject source ambiguity
- **WHEN** install 同时给位置 source 和 --from-core，或 update 两者都缺失/都存在
- **THEN** CLI exit 2，在 credential、文件和网络 I/O 前拒绝

### Requirement: Preserve package acceptance waiting and output semantics

**Identifier:** CLI-PKG-003

两个 CLI 的 package install/update SHALL 在未 --wait 时输出一次 acceptance 并 exit 0；CLI 每次提交 SHALL 自动生成 UUID 幂等键，不提供用户传入幂等键的 package 命令参数。--wait SHALL 对同一 Operation 串行观察直至 succeeded、failed 或 superseded，不设置本地总等待时限；正常观察每 250 ms 一次，单次观察请求有界。单次请求超时、暂时网络中断或服务暂不可用 SHALL 以 250 ms 起、最多 5 秒的退避间隔重试读取原 Operation，成功观察后恢复 250 ms 间隔，不重提安装或取消后台任务；鉴权被拒、Operation 不存在等无法继续观察的确定性错误 SHALL exit 5 并保留 ID 与恢复查询命令。用户以 Ctrl+C 主动中断等待 SHALL exit 130，保留 ID 与恢复查询命令，不取消已接受的 Operation。succeeded exit 0、failed/superseded exit 6，服务端真实失败不得被无限等待掩盖。operation show 查询成功 SHALL exit 0，包括任务失败。--json 的 stdout SHALL 恰有一条 acceptance、最终 observation，或在不可恢复观察错误/主动中断时带原 Operation ID 的 waiting 结果；进度和恢复命令输出 stderr。

两个 CLI 的 package install/update SHALL 仅在与 --wait 同用时接受 --verbose；单独 --verbose SHALL 在鉴权、文件及网络 I/O 前以 usage exit 2 拒绝。--verbose SHALL 在 stderr 显示原 Operation ID、安全的 packagePhase 变化、已等待时间、每 30 秒仍处于同一阶段的心跳、暂时观察故障的重试/恢复，以及终态安全 stage/code；同一阶段的普通 250 ms 轮询不得逐次打印。--verbose 不改变 Operation、轮询语义、退出码或 --json 的单值 stdout。任何模式 SHALL NOT 输出 npm/Git 原始 stdout/stderr、命令参数、来源绝对路径、凭据、helper ID 或内部 digest。

接受前 syntax=2、auth=3、missing=4、network=5、conflict=6、其他=1。未知 flag、额外位置参数、空值和组合矛盾 SHALL 在 auth/file/network 前拒绝；各级 help SHALL 不读取凭证或文件。公共输出 SHALL 不含 source 绝对路径、secret、内部 digest/revision。文档 SHALL 包含四来源测试示例和 install→desired→apply→loaded→stop/export/import/start 的完整示例。

#### Scenario: Preparation exceeds two minutes
- **WHEN** --wait 在 120 秒内未观察到终态，而后原 Operation 完成
- **THEN** CLI 继续观察原 Operation 并显示最终结果，不重新发起 install

#### Scenario: Observation becomes unavailable
- **WHEN** --wait 的单次观察请求超时或连接中断
- **THEN** CLI 保留原 Operation ID、限频重试读取，连接恢复后显示该 Operation 的最终结果；不重新发起 install，暂时故障不产生终态 stdout

#### Scenario: User interrupts package waiting
- **WHEN** 用户在 install/update --wait 期间按 Ctrl+C
- **THEN** CLI exit 130；stdout 仅输出一条带原 Operation ID 的 waiting 结果，stderr 给出 operation show 恢复命令；后台 Operation 不被取消

#### Scenario: Observation cannot be authorized
- **WHEN** 已接受包 Operation 后，观察请求被确定性拒绝鉴权或报告该 Operation 不存在
- **THEN** CLI exit 5；stdout 仅输出一条带原 Operation ID 的 waiting 结果，stderr 给出恢复查询命令；不重新发起 install

#### Scenario: Wait for failure in JSON mode
- **WHEN** 已接受 Operation 随后 failed 且启用 --json --wait
- **THEN** stdout 恰好一条最终 failed observation，包含安全 stage/code 与 ID，exit 6

#### Scenario: Verbose package wait without leaking output
- **WHEN** operator 或 Work 用户运行 package install/update --wait --verbose，Operation 经过 queued、prepare 并完成，期间某次观察暂时断线
- **THEN** stderr 显示该 Operation 的阶段变化、已等待时间、重试及恢复，超过 30 秒的未变阶段有心跳；--json stdout 仍只有一条最终结果，不打印第三方进程输出或敏感字段，也不重复提交安装

#### Scenario: Reject verbose without waiting
- **WHEN** package install/update 指定 --verbose 而未指定 --wait
- **THEN** CLI exit 2，且不读取凭证、来源文件或联系 Core

#### Scenario: Reject a caller-supplied package idempotency key
- **WHEN** Core 或 Work 的 package install/update 命令带有 --idempotency-key
- **THEN** CLI exit 2，且不读取凭证、来源文件或联系 Core；不带该参数的有效请求仍由 CLI 自动生成请求幂等键

#### Scenario: Help with unavailable authentication
- **WHEN** 用户执行任一 package 命令 --help 且凭证文件不可读
- **THEN** help 成功，不读凭证、不读本地来源或发送请求

## MODIFIED Requirements

### Requirement: Create and control Works from the CLI

**Identifier:** CLI-WORK-001

`piwork-cli` SHALL provide Work lifecycle, `work config show`, `work config set`, field-specific configuration commands, and explicit `work config apply` without public revision arguments. `work create` SHALL accept `--base-image <image>`, repeatable `--skill <skill-name>`, `--no-skills`, `--agents-md-file <path>`, and `--config <file>`. If neither Skill option nor a `skills` field is supplied, Core SHALL copy the current default Work Skill selection; explicit Skill flags SHALL replace defaults and a configuration-file selection, while `--no-skills` SHALL select an empty set. The CLI SHALL reject duplicate names and mutually exclusive Skill options before contacting Core. Core SHALL copy selected managed Skill directories, AGENTS content, and the resolved configuration into Work-owned storage before reporting successful creation. `piwork-serve` MUST NOT create or control user Works.

SDK-invalid imported Skill bytes SHALL be diagnosed asynchronously during required initialization rather than rejected as a CLI syntax error. Both `work config set <workId> --config <file>` and `work config skills set <workId>` SHALL update desired state consistently; omitted fields in field-specific commands SHALL preserve unrelated desired fields. `--no-skills` SHALL be parsed as a boolean flag on create, per-Work Skill set, and operator default-Work set. Missing selection on the field-specific Skill-set command SHALL be a usage error, not implicit clearing. `work config apply <workId> [--wait] [--idempotency-key <key>]` SHALL report acceptance immediately unless waiting was requested and use the same durable Operation observation behavior as create/start.

work create SHALL 额外支持重复 --package <name> 或互斥 --no-packages，优先于配置文件 packages 与默认集合；重复/空 name 或矛盾选项在 auth/file/network 前拒绝。work config set 同样支持该选择，对已存在 Work 只引用自身 desired 已安装包；flags 选中项 enabled=true，其他字段省略保留，disabled 可用专用命令或完整配置表示。包安装与 apply 分离，create --wait 的成功仍要求最终完整 context ready。

#### Scenario: Create from the current default
- **WHEN** 用户运行 `piwork-cli work create --name <name> --wait` without a Skill selection
- **THEN** the Work receives independent copies of the current default Skills and other effective context, and later default or managed-Skill changes do not alter it

#### Scenario: Create with explicit Skills
- **WHEN** a user supplies one or more `--skill <skill-name>` options
- **THEN** the Work receives exactly those enabled managed Skills in the supplied order, replacing the default or configuration-file selection

#### Scenario: Create with per-Work context overrides
- **WHEN** a user supplies base image, Skills, AGENTS content, or a configuration file while creating a Work
- **THEN** explicit CLI fields take precedence over the corresponding configuration-file and default fields, and Core copies the resulting complete context into the new Work

#### Scenario: Create with no Skills
- **WHEN** a user supplies `--no-skills`
- **THEN** the Work is created with an empty Skill directory and does not inherit default Skills

#### Scenario: Reject invalid create context
- **WHEN** a create request repeats a Skill, combines `--skill` with `--no-skills`, names a missing or disabled Skill, or supplies a missing, unreadable, or oversized AGENTS file
- **THEN** the CLI exits with a usage or validation error, no Work becomes visible, no partial Work context remains, and no secret or host path is disclosed

#### Scenario: Update one Work only
- **WHEN** a user changes Work A configuration without an expected-revision argument
- **THEN** only Work A's desired context changes, later successfully committed updates replace earlier desired values, and other Works and global defaults remain unchanged

#### Scenario: Set Skills and AGENTS independently
- **WHEN** an owner invokes `work config skills set <workId> --skill <name>...`, `work config skills set <workId> --no-skills`, or `work config agents set <workId> --file <path>`
- **THEN** Core copies the requested content into that Work's desired context, preserves unrelated fields, and leaves the running active context unchanged

#### Scenario: Apply pending Work configuration explicitly
- **WHEN** an owner invokes `piwork-cli work config apply <workId>`
- **THEN** the CLI submits one apply operation for the desired context captured at acceptance, reports its stable Operation identifier, and does not require a revision or silently cancel an active Run

#### Scenario: Apply a pending Work configuration explicitly
- **WHEN** an owner invokes `piwork-cli work config apply <workId>` while `pendingApply` is true
- **THEN** the CLI applies the desired context captured by that Operation without an expected-revision option and reports the durable Operation state

#### Scenario: Create and wait for a ready Work
- **WHEN** a logged-in user invokes `piwork-cli work create --name <name> --wait` against a configured installation
- **THEN** the CLI returns the stable Work identifier, follows its Operation, and exits successfully only after the Work-owned context is mounted and agentd is ready

#### Scenario: Show a Work preparation failure
- **WHEN** Docker, the image, model configuration, or agent readiness causes an accepted create Operation to fail
- **THEN** the CLI displays the stable Work and Operation identifiers plus a safe actionable failure and exits nonzero

#### Scenario: Stop and restart one Work
- **WHEN** an owner stops a ready Work and later starts it with `--wait`
- **THEN** the CLI observes both Operations and the Work becomes ready again with its retained Work-owned context and data

#### Scenario: Clear Skills through the documented flag
- **WHEN** the owner uses `work config skills set <workId> --no-skills` and successfully applies
- **THEN** desired and active Skills become empty, the ready runtime reports no loaded Skills, and AGENTS/model/image/tool fields are preserved

#### Scenario: Set Skills through configuration JSON
- **WHEN** the owner supplies a valid configuration file with skills [s-a] to the generic set command
- **THEN** it produces the same desired Skill snapshot and pending state as the field-specific set command with s-a, without changing active Skills before apply

#### Scenario: SDK-invalid creation is an Operation failure
- **WHEN** an enabled managed Skill has bytes that pass Core tree validation but fail SDK loading
- **THEN** create returns the accepted Work and Operation, initialization fails before ready, and `--wait` shows the Skill error with those identifiers and exits 6

#### Scenario: Repeated apply key
- **WHEN** a caller repeats an apply with the same idempotency key
- **THEN** the CLI receives the original Operation and reused true, without causing another initialization

#### Scenario: Create from package defaults
- **WHEN** 用户不提供 package flags 或配置字段创建 Work
- **THEN** 继承当时默认包的独立副本，不持续跟随 Core

#### Scenario: Override package selection
- **WHEN** 用户提供 --package tools 或 --no-packages
- **THEN** 分别替换为 tools 或 []，不与文件/defaults 合并

#### Scenario: Reject duplicate package flags before I/O
- **WHEN** 用户重复同名 --package 或与 --no-packages 同用
- **THEN** exit 2 且不读取凭证、本地文件或发起网络请求

### Requirement: Transfer complete Work packages from the user CLI

**Identifier:** CLI-SNAPSHOT-001

piwork-cli SHALL 提供以下命令，沿用全局 --core/--json 放在 work 前的约定：
- `work export <workId> [--output <file>] [--idempotency-key <key>]`
- `work snapshot download <snapshotId> --output <file>`
- `work package inspect <file>`
- `work import <file> [--name <name>] [--wait] [--idempotency-key <key>]`

--idempotency-key 缺省由 UUID 补齐；export SHALL 先按 ResourceId 规则验证 workId，缺省输出到当前目录的 `<workId>.work`，不得把未验证的输入拼成路径；import 缺省使用包内源名称并由 Core 原子处理冲突。`--output` 与 `--name` 可显式覆盖默认值，file/workId 仍必填；`--bindings` 不再接受。禁止空白值、NUL、重复选项、额外位置参数、未知 flag、stdout 目标 "-"、覆盖已有输出、过滤/排除/自动停止/自动启动选项。各级 -h/--help SHALL 在凭证或文件读取前成功返回。syntax 错误 exit 2；inspect 不需登录或 Core，其他命令沿用保存的用户 credential。CLI SHALL 完整校验本地输入包后再上传，服务器独立重验。

export SHALL 提交一次请求并等待最多 120 秒（含每次 poll），串行每 250ms 观察，完成后下载并验证到新文件；超时/观察失败返回 waiting 与 Work/snapshot/Operation ID、恢复命令，exit 5，不取消服务端任务或自动重提。download 对未就绪 snapshot 返回冲突，不隐式新建快照。import 默认上传并提交后输出 acceptance，--wait 使用同样观察期限，只观察导入而不启动 Work。

本地输出 SHALL 使用安全新建、同目录临时文件、0600 权限及校验后的无覆盖发布；已有目标、symlink 目标/父路径或读取错误 exit 2，不改原文件。失败只清理本次临时文件，不留名为最终目标的半包。transfer 超时按 WSNAP-005；包永不写 stdout。export/import 前 stderr SHALL 明确提示原样携带敏感内容和不自动执行包，非交互模式不额外要求输入确认。

work export/import SHALL 无条件携带完整 Pi package 闭包；不新增 skip-packages 或“导入时重新安装”模式。既有单数 work package inspect SHALL 报 WSNAP-002 的安全包摘要，与复数 work packages 管理命令区分。导入成功保持 stopped，不暗中 apply pending desired 或加载 extension。

#### Scenario: Export and share
- **WHEN** 所有者导出已停止 Work 到不存在的 demo.work
- **THEN** 命令返回完整校验后的 0600 文件和一条结果，不打印包内配置/历史，不自动启动或停止 Work

#### Scenario: Do not overwrite a destination
- **WHEN** output 已存在或在下载期间被其他进程创建
- **THEN** 原文件不变，命令失败并清理其临时文件

#### Scenario: Inspect without login
- **WHEN** 未登录用户检查一个合法包
- **THEN** 完整校验并显示安全摘要及平台依赖概况，exit 0，不发网络请求或执行包

#### Scenario: Import an ordinary Work with only its file
- **WHEN** 接收端已有匹配模型，用户运行 `work import ./first.work --wait`，不提供名称或 bindings
- **THEN** CLI 上传并提交导入，目标 Work 获得不冲突名称，Operation 成功且 Work 保持 stopped

#### Scenario: Export without an output option
- **WHEN** 用户运行 `work export work-abc` 且当前目录不存在 `work-abc.work`
- **THEN** 导出经完整校验后无覆盖地发布为当前目录的 `work-abc.work`

#### Scenario: Recover after wait timeout
- **WHEN** export 超过 CLI 观察期限但服务端仍在工作
- **THEN** CLI exit 5 保留 snapshotId，用户可以 operation show 后 snapshot download 而无需再 export

#### Scenario: Inspect packages without executing them
- **WHEN** 用户执行 work package inspect demo.work，文件包含 Pi extension/lifecycle scripts
- **THEN** 本地完整验证后显示包数量/安全名称版本，不执行内容、不连接 Core，标明尚未运行验证

#### Scenario: Keep packages in the standard export command
- **WHEN** 用户运行原有 work export/import 命令而没有新增 package 选项
- **THEN** 所有 retained context 的包与依赖自动完整搬迁
