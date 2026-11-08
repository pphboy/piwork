# Design

## Context

动机见 [proposal.md](proposal.md)。这是跨 Core、CLI 与浏览器下载后端的小范围修改，需要统一命名逻辑。

当前实现与本次读取范围：

| 来源 | 已验证事实 / 责任 |
| --- | --- |
| `internal/cli/user_snapshot.go:34-95,113-163,166-250` | 解析阶段以 Work ID 生成缺省路径；运行时先校验目标，再提交、观察和校验下载；发布使用 `PublishNoReplace` |
| `internal/coreapp/snapshot_http.go:100-151,167-245` | 按 snapshot job/package 所有者授权；下载响应固定使用 `snapshot.work` |
| `internal/cli/user_desktop_transfers.go:730-865` | 下载已完整 Inspect，并将摘要存入 `job.summary`；最终响应仍使用 Work ID；托管与独立 Desktop 共用此路径 |
| `internal/workpackage/inspect.go:15-35,154`、`internal/coreapp/snapshot_capture.go:134` | 包与已校验摘要已有原始 `sourceName` |
| `internal/coreapp/work_read.go:17-33,90-104`、`internal/corestore/repository.go:81-94` | 既有 Work 查询提供名称；存储内部读取可包含已删除记录 |
| `internal/coreapp/work_create.go:25-29` | Work 名称允许中文、空格、路径分隔符等字符，限制为非空、最多 128 字节且不含 NUL |
| `apps/desktop-webui/src/app.ts:5305-5309`、`src/export-panel-controls.ts:24-27` | 浏览器沿原下载 URL 交付，`download` 属性为空，实际建议文件名由 HTTP 响应决定 |
| `internal/cli/hosted_desktop.go:18-61` | 托管工作台复用 `nativeDesktop`，无需另建下载实现 |

已核对相关的现行 `work-snapshots` 与 `control-cli` 规格，以及 `user_snapshot*_test.go`、`user_desktop_transfers_test.go`、`hosted_transfers_test.go`、`snapshot_access_test.go` 和 `apps/desktop-webui/test/real-core.mjs` 的下载断言。以上为源码调查，不代表测试已执行。

## Goals / Non-Goals

**Goals:** 一份 Go 命名函数覆盖各默认出口，使用已有名称来源，保持原授权、流式校验、恢复与安全文件发布边界。

**Non-Goals:** 不增加命名配置、改名界面、时间戳、自动编号、扩展名去重、包格式、HTTP DTO 或数据库迁移；不重构 `ExportFlows` 或改动界面布局。

## Decisions

### 1. 共用纯文件名转换函数

在 `internal/workpackage` 增加小型纯函数，输入 Work 名称，输出完整建议文件名。各入口直接调用，不在 Go 与 TS 中各维护一份规则。

按 WSNAP-FILENAME-001 将非法字符逐个替换为 `_`，去掉尾部 ASCII 点与空格；对首个点之前的名称段进行大小写无关的设备保留名判断，命中则前置 `_`；空基础名回退 `work`，最后无条件追加 `.work`。保留其他正常字符，不改包内名称。保留名涵盖常规 Windows 设备名 `CON`、`PRN`、`AUX`、`NUL`、`COM1` 至 `COM9`、`LPT1` 至 `LPT9`。

两处 HTTP 下载响应使用标准库 `mime.FormatMediaType` 构造附件响应头，正确编码 UTF-8 参数，避免手工拼接引号或换行。显式 `--output` 不走默认名称转换函数。

### 2. 复用各入口已存在的名称来源

- **CLI export**：参数解析保留“未指定输出”状态；参数校验完成后，仅缺省输出分支调用既有 `GET /api/v1/works/<workId>`，核对返回的 Work ID 与非空名称，生成路径后执行原目标校验，再 POST export。显式输出与 snapshot download 不增加名称查询。失败沿现有错误映射返回，不回退 ID。
- **Core content**：在原 snapshot 所有权检查通过后，通过 `SourceWorkID` 读取持久 Work 名称，允许包含已删除记录，再生成附件名称。下载权限仍由 snapshot job/package 决定，不改成普通 Work 内容准入，保持已删除源的旧快照可下载。
- **托管工作台 / 独立 Desktop**：从已完成校验的 `job.summary` 中取得 `Inspection.SourceName`，生成附件名称。无需信任浏览器传来的名称，也不增加对源 Work 当前状态的查询。
- **浏览器**：继续使用原 URL 和响应头，不在 `app.ts` 或 adapter 中新增命名逻辑。当前 `Snapshot.filename` 没有导出交付消费者，本次不为这个字段扩展元数据协议。

当前产品不提供 Work 重命名，删除后也保留名称，因此 Core 持久名称与包内源名称可对应，不必新增名称快照字段或 manifest 读取流程。此为基于当前源码的设计前提；将来新增重命名时应在所属变更处理旧快照名称。

### 3. 在原目标校验与交付路径内完成修改

CLI 保留提交前目标检查及最终 `PublishNoReplace`，覆盖预先存在与下载期间出现文件两种情况；不增加探测编号的循环。Core 和 Desktop 继续按原身份、快照和 transfer 校验提供字节，不因文件名变化重新打包。HTTP 头变化不涉及 DTO/proto 生成，`.work` 字节及 hash 均保持原契约。

## Risks / Trade-offs

- [脚本依赖旧默认路径] → 显式 `--output` 可维持原路径；规格明确标记默认行为变化。
- [不同 Work 名称经转换后同名] → 采用已确认策略：CLI 明确拒绝覆盖，浏览器按自身设置处理。
- [中文或特殊字符在下载头中损坏] → 对实际响应头解析后的名称及浏览器 `suggestedFilename()` 做断言，不只测试字符串函数。
- [新增 Core 名称读取误阻止已删除源快照下载] → 复用 includeDeleted 读取，并回归既有删除源、跨用户与过期下载用例。

## Migration Plan

无数据或包迁移。实施后运行相关 Go 单元/HTTP 契约、浏览器下载验证、`make build-cli` 和 `make build-go`，核对新二进制；若回退代码，仅恢复原默认命名，已导出文件与包格式仍可使用。无需发布镜像或修改双语部署材料；没有 Docker、监听、数据目录或运行配置变化。若实施中确需修改浏览器源码，则按原 workspace 构建链同步嵌入资源并执行相应浏览器检查。

## Implementation and Verification

2026-11-08 实施：新增 `internal/workpackage/filename.go` 及其表驱动测试；按上述责任修改 Core、CLI 和两种工作台共用的 Go 下载后端。CLI 帮助说明默认文件名，并以 `snapshotOutputError` 将输出目标检查和最终无覆盖发布失败映射为既有规格要求的 exit 2。没有新增 DTO、包字段、持久状态或浏览器产品逻辑。

除 Context 中列出的范围外，本次还读取了 `internal/cli/user.go` 的帮助、错误退出映射和 Operation 观察逻辑，`user_snapshot_storage_test.go` 的目标竞争测试，`process_fixtures_test.go` 的子进程构建入口，`user_desktop_api.go` 的 cookie/Host 校验、`hosted_desktop.go` 的共用 handler，以及 `internal/coreapp/settings_test.go:75-124` 的权限夹具。外部依赖仍是现有 Go 标准库、Node/Playwright 和本机 Chromium；产品运行依赖没有变化，也未修改这些范围外的功能。

| 检查 | 实际结果 |
| --- | --- |
| `go test -mod=readonly ./internal/workpackage` | 通过；覆盖中文、正常空格、特殊/控制字符、保留名、空基础名及直接追加扩展名 |
| Core / CLI 针对性测试 | 通过；覆盖名称响应头、删除源后下载、所有权/过期、默认/显式路径、名称查询失败、目标竞争、超时恢复和两种工作台的原 transfer 重下 |
| `go test -mod=readonly ./internal/workpackage ./internal/coreapp ./internal/cli` | 调整命令环境后全部通过；三包分别约 0.22s / 82.36s / 24.36s，911 项测试及子用例通过 |
| 真实 Chromium + 实际 Go 下载 handler | 通过；Core 中文名称、特殊字符与双扩展名各完成自动交付/手动重下，托管和独立 Desktop 各完成原 transfer 的两次下载，均校验建议名称、原 URL 与 SHA-256 |
| `make build-cli`、`make build-go` | 通过；生成 Linux amd64 CLI 及两个宿主程序，嵌入 WebUI 无差异 |
| `node scripts/check-native-boundary.mjs`、`node scripts/check-source-style.mjs` | 通过；未新增运行依赖或改动未触达的旧格式 |
| `node --check apps/desktop-webui/test/real-core.mjs` | 通过；已有全流程增加 `suggestedFilename()` 的回归断言 |
| 仓库文档检查、`git diff --check`、OpenSpec strict validate | 通过 |

验证环境说明：初次全量检查中，Go 因 `/home/p` 的空 `.git` 目录误识别 VCS 根目录，两项原有子进程构建失败；原有 `public` 权限负例又被 shell 的 `umask 077` 收紧成合法私有文件。仅在后续验证命令中将 `GIT_DIR` / `GIT_WORK_TREE` 指向当前工作区，并使用 `umask 022` 后全量检查通过，没有更改共享 Git 配置或产品权限规则。构建沿用正确工作区的 commit/dirty 身份。

浏览器聚焦验证通过忽略目录中的 Go overlay 夹具复用生产 handler，Core 侧使用测试代理注入合成 Bearer，独立 Desktop 使用测试 TLS 承载现有 `__Host-` cookie；未放宽产品授权、Host 或证书规则。验证只覆盖交付，不代表完整 Docker/模型/Stop→Export→Import 生命周期验收；本次未运行该完整流程。临时夹具、命令日志与 JSON 测试结果保存在忽略的 `dist/export-filename/`，没有建立新的仓库验收框架。
