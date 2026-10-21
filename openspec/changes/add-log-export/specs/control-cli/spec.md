## ADDED Requirements

### Requirement: 管理员通过 CLI 一次导出 Core 与自有 Work 日志

**Identifier:** CLI-LOG-001

piwork-cli SHALL 提供 `logs export [--output <file>] [--idempotency-key <key>]`、`logs show <exportId>`、`logs download <exportId> --output <file>`，沿用全局 `--core`/`--json`、业务 Core 地址优先级及同 origin 用户凭证规则，直接连接 Core 17871，不依赖 UI 后端或本机 Docker。命令仅使用管理员用户会话；普通用户的 403 映射为 exit 3，不回退 operator 或本机日志读取。

export SHALL 预先校验参数与输出目标，缺省目标为当前目录 `piwork-logs-<本次客户端UUID>.zip`；自动补齐 UUID 幂等键。export 提交一次创建并保留原 exportId/cutoffTime/scope，然后串行观察同一任务，ready 后自动下载至目标。进度在 stderr 显示收集来源、打包、下载及实际 Core 日志可用/缺口状态，不仅凭 scope 声称 Core 文件已成功取得。CLI SHALL 不给正在正常推进的任务附加短于服务端任务预算的总等待期限；单次请求有界，暂时观察故障退避读取原 ID，确定无法继续时保留恢复信息。

用户 Ctrl+C SHALL 结束观察或本次下载并 exit 130，不取消已接受 Core 任务；show/download 恢复原任务，不重新创建。创建响应丢失 SHALL 报告未确认且保留本次幂等键供显式同键恢复，不自动以新键重提。

各级 help SHALL 在凭据、文件或网络 I/O 前成功；未知/重复 flag、空值、非法 ID、额外位置参数及输出 `-` SHALL exit 2，不接受 owner、Work 范围、Core-only、follow、停止或过滤选项。既有 `work service logs`、`work export`、默认 Desktop 和 operator API 语义保持。

#### Scenario: 管理员导出远程 Core
- **WHEN** 已在所选服务器登录的管理员运行 logs export --output ./piwork-logs.zip
- **THEN** CLI 直连该 Core，观察并下载其 Core 文件及管理员自有 Work 日志，服务器收集打包，本地只接收和校验

#### Scenario: 普通用户执行命令
- **WHEN** 普通用户调用 logs export/show/download
- **THEN** Core 权限拒绝映射为 exit 3，不创建本地最终文件或寻求其他凭据

#### Scenario: 中断后恢复
- **WHEN** CLI 已取得 exportId 后等待被中断或下载断开
- **THEN** 保留原 ID，用户可 logs show 后 logs download，Core 不被要求取消或重新收集

#### Scenario: 未确认创建结果
- **WHEN** POST 已发送但响应丢失
- **THEN** 输出安全的未确认结果与原幂等键，不虚构 exportId，显式同键恢复返回同一已接受任务

### Requirement: 日志包下载安全发布并提供稳定结果

**Identifier:** CLI-LOG-002

CLI SHALL 以 0600 权限在已核验输出目录创建本次临时文件，流式下载并校验 Content-Length、application/zip 和 SHA-256，完成同步后无覆盖发布；拒绝已有目标、链接或不安全路径，失败只清理本次临时文件，不留下最终名称的半包。不以 Work 快照 Inspect 校验 ZIP，也不将 ZIP 写 stdout。

JSON 模式 export/download 成功 SHALL 在 stdout 恰输出一个 `{exportId,cutoffTime,path,size,digest,complete,warningCount}` 对象；show 输出一个安全任务对象。部分结果成功保存仍 exit 0，但 complete=false 和缺口计数必须保留，文本/JSON 模式 stderr 均提示缺口；只有文件交付成功才报告本地保存完成。接受后观察/下载失败保留 exportId 及恢复命令，JSON 输出一个带原 ID 的 waiting/failed 结果，不污染进度。

退出码 SHALL 为：syntax/本地目标与文件失败 2，缺登录或 401/403 为 3，404 为 4，网络/503/观察或传输失败为 5，409/任务 failed 或 interrupted 为 6，410/内容校验失败及其他失败为 1，主动 Ctrl+C 为 130，成功交付或成功 show 查询为 0。show 查询到任务 failed/interrupted 时查询本身仍 exit 0；ready 包过期后 download 明确报告重新导出，不隐式提交新任务。

#### Scenario: 下载内容被截断或损坏
- **WHEN** 下载的长度或 hash 不符
- **THEN** 不发布最终 ZIP，清理本次临时文件，保留 exportId 并按内容校验失败退出

#### Scenario: 目标文件在下载期间出现
- **WHEN** 另一个进程创建了同名输出
- **THEN** 无覆盖发布失败，保留另一个文件，返回 exit 2 和原 exportId

#### Scenario: 带缺口的机器输出
- **WHEN** --json logs export 下载 complete=false 的有效结果
- **THEN** stdout 只有最终文件结果且 complete=false，stderr 显示进度和缺口，保存成功 exit 0

#### Scenario: 查询失败任务与下载过期包
- **WHEN** logs show 成功查询 failed 任务，或 logs download 收到 410
- **THEN** 前者 exit 0 并展示真实任务失败，后者 exit 1 并指向显式重新导出，无新 POST

#### Scenario: Core 确认原结果损坏后恢复查询
- **WHEN** download 因 Core 核验确认损坏收到 503 LOG_EXPORT_CONTENT_UNAVAILABLE，随后 show 原 ID 或显式用原键恢复
- **THEN** 下载 exit 5 且不发布本地文件，show 成功返回原 failed 状态、result=null、原 cutoffTime 和安全错误并 exit 0；同键返回原失败任务，不重采，不将服务端拒绝误报为本地保存成功
