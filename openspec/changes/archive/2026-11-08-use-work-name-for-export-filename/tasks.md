# Tasks

## 1. 共享命名与 Core 下载

- [x] 1.1 在 `internal/workpackage` 增加共用的默认导出文件名函数；以表驱动用例验证中文/空格、非法字符、控制字符、尾部点空格、保留名、空结果及 `demo.work.work`，执行 `go test -mod=readonly ./internal/workpackage`。
- [x] 1.2 在 `internal/coreapp/snapshot_http.go` 的原授权路径内取得包含已删除记录的源 Work 名称，并安全构造附件响应头；扩展现有 HTTP 测试，验证解码后的 Unicode 文件名、原字节/hash、删除源后可下载及跨用户/过期拒绝，执行 `go test -mod=readonly ./internal/coreapp -run 'TestSnapshot(ContentOwnerBoundary|.*Filename)'`，测试名称按实际新增用例同步。

## 2. CLI 与工作台下载接线

- [x] 2.1 调整 `internal/cli/user_snapshot.go`，仅默认 export 查询目标 Work 名称并在 POST 前生成、校验输出路径；在现有测试中验证默认文件实际发布、显式 `--output` 不改写且不查询名称、名称查询失败不提交、默认目标已存在时提示 `--output`、下载期间目标竞争与原超时恢复，执行 `go test -mod=readonly ./internal/cli -run 'Test.*(Export|Snapshot)'`；同步本批实际涉及的帮助/错误提示，不改命令语法。
- [x] 2.2 调整 `internal/cli/user_desktop_transfers.go`，由已校验的 `Inspection.SourceName` 生成附件名称；扩展独立 Desktop 与 hosted 下载测试，验证名称经响应头解码正确、重下原快照名称与字节一致、session/transfer 边界保持，执行 `go test -mod=readonly ./internal/cli -run 'TestNativeDesktopWorkPackageTransfer|TestHostedInspection'`，测试名称按实际新增用例同步。

## 3. 集成与构建核对

- [x] 3.1 在已有浏览器下载验证中核对 `download.suggestedFilename()` 与 Work 名称对应，验证自动交付与手动重下沿用原 URL/快照身份；优先复用 `apps/desktop-webui/test/real-core.mjs` 的现有下载断言，通过既有 `npm run test:real-core -w @piwork/desktop-webui` 或实际 Go 下载后端配合浏览器的聚焦场景验证，不另建验收框架，记录真实已测范围。
- [x] 3.2 执行 `go test -mod=readonly ./internal/workpackage ./internal/coreapp ./internal/cli`、`make build-cli`、`make build-go` 与 `node scripts/check-native-boundary.mjs`；确认宿主构建通过且没有新运行依赖、DTO 或包格式生成变化。仅实际触及 WebUI 源码时，另执行相应 workspace 构建/浏览器检查并同步嵌入资源。
- [x] 3.3 执行 `node scripts/check-repository-docs.mjs`、`git diff --check` 与 `openspec validate use-work-name-for-export-filename --strict`，核对 proposal/specs/design/tasks 和源码改动一致；在本变更中记录实际检查结果、必要读取范围和未测项，临时日志或截图置于忽略的 `dist/`。
