# Proposal

## Why

导出的 Work 文件目前在浏览器与 CLI 中默认使用 Work ID，Core 直接下载则固定为 `snapshot.work`，用户难以从文件名识别内容。统一使用 Work 名称，让导出文件与用户看到的 Work 对应。

## What Changes

- Core 下载、托管浏览器工作台、独立 Desktop 与 CLI 默认导出文件名统一为安全处理后的 Work 名称直接追加 `.work`。
- 保留中文与正常空格，将文件名非法字符转换为 `_`，处理尾部点/空格及系统保留名，空结果使用 `work.work`。
- 名称直接拼接扩展名：`demo.work` 导出为 `demo.work.work`。
- CLI 显式 `--output` 继续使用用户指定路径；浏览器按自身下载设置处理重名，CLI 继续拒绝覆盖，不自动编号。
- **BREAKING**：CLI 未指定 `--output` 时，默认路径从 `<workId>.work` 改为 `<workName>.work`；依赖旧默认路径的脚本应显式指定 `--output`。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `work-snapshots`：增加各下载入口共用的默认文件命名规则与必要的文件名安全要求。
- `control-cli`：修改 `CLI-SNAPSHOT-001` 的默认导出路径要求，保留显式输出、校验和无覆盖发布语义。

## Impact

- `internal/workpackage`：承载共用的文件名转换函数，供 Core 与 CLI/工作台下载后端使用。
- `internal/coreapp/snapshot_http.go`：替换固定下载文件名，继续按原快照所有者授权。
- `internal/cli/user_snapshot.go`：缺省输出时读取 Work 名称并在提交导出前校验目标路径。
- `internal/cli/user_desktop_transfers.go`：使用已有包校验摘要中的 `sourceName` 设置下载文件名，同时覆盖托管工作台与独立 Desktop。
- 复用现有 Work 查询和包摘要；不新增配置、依赖、HTTP DTO 字段、存储迁移或 `.work` 格式版本。浏览器继续由 `ExportFlows` 推进，下载名称通过响应头交付。
