# Spec Delta

## ADDED Requirements

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

### Requirement: Keep snapshot output and existing commands compatible

**Identifier:** CLI-SNAPSHOT-002

JSON 模式 SHALL 对每个成功命令输出恰好一个对象：inspect 为 WSNAP-002 安全摘要；export/download 为 `{workId,snapshotId,operationId,path,digest,size}`；import 非 wait 为 `{workId,name,operationId,correlationId,reused}`；import wait 为既有终态 Operation envelope 加目标 name，export waiting 额外带 snapshotId。text 模式用可读摘要/缩进 JSON，进度与敏感内容警告只写 stderr。相对于旧“internal digest 不公开”的限制，新 digest 仅指用户包校验 hash，不暴露平台 context identity。

syntax/local file exit 2；缺登录/401/403 exit 3；404 exit 4；网络、503、transfer/观察超时 exit 5；409、已接受任务 failed/superseded exit 6；包校验400/413、不兼容、目标模型或自定义外部 MCP 凭证不可用与410 exit 1；成功 exit 0。接受前错误 stdout 为空，且 stderr SHALL 显示安全的错误 code 与可执行处理方向；不能仅输出 `Work snapshot request cannot be accepted`。接受后观察失败输出带 ID 的 waiting；校验过的包下载后本地发布失败也必须在安全错误中保留 snapshotId。旧 Work/service/chat、operator CLI 和通用 operation show 行为 SHALL 不变，不新增 service create/update。

#### Scenario: One JSON result
- **WHEN** --json work export 完成接受、观察、下载
- **THEN** stdout 只有最终文件结果，早期 acceptance/进度/警告不污染 JSON

#### Scenario: Preserve service boundary
- **WHEN** 用户运行 work service create 或 update
- **THEN** 仍是 usage error，本变更仅支持作为整个包恢复服务定义
