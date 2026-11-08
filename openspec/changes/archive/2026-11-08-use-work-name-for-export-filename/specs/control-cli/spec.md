# Control CLI Spec Delta

## MODIFIED Requirements

### Requirement: Transfer complete Work packages from the user CLI

**Identifier:** CLI-SNAPSHOT-001

piwork-cli SHALL 提供以下命令，沿用全局 --core/--json 放在 work 前的约定：
- `work export <workId> [--output <file>] [--idempotency-key <key>]`
- `work snapshot download <snapshotId> --output <file>`
- `work package inspect <file>`
- `work import <file> [--name <name>] [--wait] [--idempotency-key <key>]`

--idempotency-key 缺省由 UUID 补齐；export SHALL 先按 ResourceId 规则验证 workId，未指定 `--output` 时取得该 Work 名称，按 WSNAP-FILENAME-001 生成当前目录的默认输出文件名，并在提交 export 前校验输出目标；不得把未验证的输入或未经文件名转换的 Work 名称拼成路径。名称查询失败 SHALL 按现有错误语义返回，不回退 ID 命名或提交导出。import 缺省使用包内源名称并由 Core 原子处理冲突。`--output` 与 `--name` 可显式覆盖默认值，显式输出路径 SHALL 原样使用，不额外追加 `.work` 或按 Work 名称改写；file/workId 仍必填，snapshot download 继续要求显式 `--output`；`--bindings` 不再接受。禁止空白值、NUL、重复选项、额外位置参数、未知 flag、stdout 目标 "-"、覆盖已有输出、过滤/排除/自动停止/自动启动选项。各级 -h/--help SHALL 在凭证或文件读取前成功返回。syntax 错误 exit 2；inspect 不需登录或 Core，其他命令沿用保存的用户 credential。CLI SHALL 完整校验本地输入包后再上传，服务器独立重验。

export SHALL 提交一次请求并等待最多 120 秒（含每次 poll），串行每 250ms 观察，完成后下载并验证到新文件；超时/观察失败返回 waiting 与 Work/snapshot/Operation ID、恢复命令，exit 5，不取消服务端任务或自动重提。download 对未就绪 snapshot 返回冲突，不隐式新建快照。import 默认上传并提交后输出 acceptance，--wait 使用同样观察期限，只观察导入而不启动 Work。

本地输出 SHALL 使用安全新建、同目录临时文件、0600 权限及校验后的无覆盖发布；已有目标、symlink 目标/父路径或读取错误 exit 2，不改原文件。默认名称同样 SHALL 拒绝覆盖，不自动编号；已知默认目标存在时 SHALL 在提交 export 前失败，提示可用 `--output` 指定其他路径。失败只清理本次临时文件，不留名为最终目标的半包。transfer 超时按 WSNAP-005；包永不写 stdout。export/import 前 stderr SHALL 明确提示原样携带敏感内容和不自动执行包，非交互模式不额外要求输入确认。

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
- **WHEN** 用户运行 `work export work-abc`，该 Work 名为 `我的项目`，且当前目录不存在 `我的项目.work`
- **THEN** 导出经完整校验后无覆盖地发布为当前目录的 `我的项目.work`

#### Scenario: Explicit output overrides the default name
- **WHEN** 名为 `我的项目` 的 Work 通过 `work export work-abc --output ./saved.backup` 导出
- **THEN** 完整校验后的文件发布为 `./saved.backup`，不改成 Work 名称或追加扩展名

#### Scenario: Default output already exists
- **WHEN** 名为 `我的项目` 的 Work 默认导出时当前目录已有 `我的项目.work`
- **THEN** CLI exit 2，保留已有文件并提示使用 `--output`，不提交 export 或自动选择编号文件名

#### Scenario: Work name lookup fails
- **WHEN** 未指定 `--output`，且 Core 无法返回目标 Work 的有效名称
- **THEN** CLI 返回对应失败，不提交 export，不创建最终输出文件，也不回退为 `<workId>.work`

#### Scenario: Recover after wait timeout
- **WHEN** export 超过 CLI 观察期限但服务端仍在工作
- **THEN** CLI exit 5 保留 snapshotId，用户可以 operation show 后 snapshot download 而无需再 export

#### Scenario: Inspect packages without executing them
- **WHEN** 用户执行 work package inspect demo.work，文件包含 Pi extension/lifecycle scripts
- **THEN** 本地完整验证后显示包数量/安全名称版本，不执行内容、不连接 Core，标明尚未运行验证

#### Scenario: Keep packages in the standard export command
- **WHEN** 用户运行原有 work export/import 命令而没有新增 package 选项
- **THEN** 所有 retained context 的包与依赖自动完整搬迁
