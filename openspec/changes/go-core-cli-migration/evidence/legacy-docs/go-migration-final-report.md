# Go Core / CLI 迁移交付报告

变更：`go-core-cli-migration`。迁移及规范场景验收已完成：970/970 场景已关联通过证据（自动验证及必要人工核对），OpenSpec strict 与源码/镜像边界检查通过。

## 交付边界

- 宿主程序：Go Core `piwork-serve`（`piwork` 别名）、Go CLI `piwork-cli`（含 Desktop 本地 Web 服务）、Go Console `piwork-console`。宿主不依赖 Node、npm、Python、Go 工具链、Docker CLI、OpenSSL 或 shell。
- 镜像内平台程序：Go `piwork-service-mcp`、`piwork-package-helper`、`piwork-file-helper`、`piwork-snapshot-helper`。
- 保留完整 TS Pi Agentd/Pi SDK agent harness，包括 Session/Run、模型、工具、MCP bridge、Pi package 加载与子代理生态；运行时装在 Agent 镜像内。浏览器 UI 保留 TypeScript，构建后的资源嵌入 Go 程序。
- 旧 TS Core/CLI/Console 后端及 TS/Python 平台 helper 已移除；已发布 HTTP/RPC、默认域名、Work 生命周期和 `.work` v1 数据契约按验证矩阵保持。

## 验证方法

完整 Engine 基线、真实浏览器验收与针对最后修改的补充故障测试共同组成阶段 gate；不把同一场景映射成同数量的独立测试，也不把测试跳过算通过。

| 层级 | 已执行证据 |
| --- | --- |
| 完整 Go、保留 TS harness 单元与浏览器类型检查 | `GOFLAGS=-p=1 make test`；`/tmp/piwork-go-concurrent-final-unit.log` |
| 原生 Engine / Go Core / 完整 Pi SDK 基线 | `make test-integration-go` 对应完整批次；`/tmp/piwork-go-final-native-integration.log` |
| Service、WebDAV、CLI 命令及进程故障 | 见逐场景索引；真实 Engine、Go CLI 子进程、rclone、实际 SIGKILL 后恢复 |
| Desktop / Console | Chrome、Edge 真实 Go 后端及 UI Review；Desktop 最新 3/3（`/tmp/piwork-go-warning-desktop-browser.log`），Console 最新 48/48；相关日志和截图见详细验收记录 |
| 独立源码副本构建 | 初次无 dist/node_modules 的检出副本执行 npm ci、build/test-go；最新源码再次 build/test-go；`/tmp/piwork-go-clean-source-final-delivery.log` |
| 发布流水 | `make release`；七个静态 Go ELF、三宿主程序及别名、嵌入 UI、镜像清单、版本、校验和；`/tmp/piwork-go-concurrent-release.log` |
| 无工具宿主 | 只含三个最终发布二进制的 scratch，连接独立 Engine Unix socket；真实 SDK 经 Go MCP 部署、proxy、DAV、Desktop/Console、Stop/Export/Inspect/Import/Start；`/tmp/piwork-go-concurrent-native-host.log` |
| 真实模型 | 用户授权配置下的生产 Agent / 真实 Pi SDK smoke；返回非空 assistant，重放相同 Run；`/tmp/piwork-go-real-model-final-delivery.log`。配置和密钥不进入仓库或发布包 |
| 源码及镜像边界 | `check-native-boundary.mjs`、`check-native-image-boundary.mjs`、`collect-go-migration-boundary.mjs` |

## 收尾中修复的边界

- 初始 Skill/AGENTS 校验失败须保留 desired、旧 active，并提供安全诊断；目录身份不匹配通过 SDK 加载结果明确拒绝。
- 已持久绑定的卷缺失不能由 Start 静默新建空卷代替。
- Agent 镜像入口启动失败后，确认未运行的 `created` 容器允许合法冷快照；残留 file helper 继续阻止导出，运行中/状态不确定的容器仍拒绝。
- 镜像无法解析、Docker inspection 不可达分别保留 failed/unknown；后者不以猜测缺失来启动替代容器。

## 规范场景证据

完整范围为 36 capabilities、260 Requirements、970 Scenarios，逐项 test、命令、结果与必要人工核对在 [go-migration-scenarios.json](go-migration-scenarios.json)，详细分阶段事实在 [go-migration-acceptance.md](go-migration-acceptance.md)。发布包包含这两份证据及本报告。

Skill 的“依赖安装方式/工具不可用说明”以发布指引人工核对加真实 SDK 加载验证，不宣称真实模型执行过全部指引。并发快照遵守单个 active job 的既定限制，第二个请求返回容量忙后以原幂等键重试，再验证名称及身份稳定。

工具权限按完整 canonical name 核对，例如 `work-services.service_stop`；包自行配置的其他 MCP 命名空间维持各自声明的权限。

## 凭证与失效会话 WARNING 修复（14.10–14.11）

- CLI/Desktop 共享存储逐次核验当前有效 UID、专属父目录及普通 `0600` 文件；从根目录逐段以 no-follow 打开目录，再用已核验目录 fd 上的相对路径读、原子替换与删除。不修改不安全现有目录的权限；父路径替换后访问仍限于原目录对象，外部链接目标不被读写。
- CLI logout 仅接受 Core 的空 `204` 撤销确认，或匹配所选 Core 的严格公共 `401 AUTHENTICATION_FAILED`；本地清除成功才 exit 0、输出 `loggedOut=true`。未知/畸形响应、异常 200、403/5xx、不可达与取消保留凭证；本地清除失败不报告成功，也不重放远端撤销。Desktop 保持原有本地即时退出及远端撤销确认展示。
- 新增目录权限/归属属性、文件权限/类型、父/祖先/叶子链接、目录替换和叶子竞争测试。实际 Go CLI 子进程连接真实 Go Core，覆盖有效、先撤销、过期、账号禁用；不安全路径不发送请求，换 Core/离线/SIGINT 保留凭证。Desktop 保存不安全路径失败时撤销新会话、不改变原凭证。全部通过：`/tmp/piwork-go-warning-closure.log`。
- 最新全量 `GOFLAGS=-p=1 make test` 和 Desktop 浏览器 3/3 回归通过：`/tmp/piwork-go-concurrent-final-unit.log`、`/tmp/piwork-go-warning-desktop-browser.log`；源码/镜像边界检查通过：`/tmp/piwork-go-warning-source-boundary.log`、`/tmp/piwork-go-warning-image-boundary.log`。早期 fixture 的 `0755` 临时目录与缺失 Content-Type 导致的失败已修正，以上为修正后的通过批次。
- 最新真实 Engine 的 CLI 命令/对话及 Service/WebDAV 回归 215.399s PASS，`/tmp/piwork-go-warning-cli-integration.log`。未启用该批次的可选 rclone 子用例；通用客户端以原独立 rclone 通过批次为证据。
- 受影响宿主程序经最新 `make test` 的构建步骤重建，四类镜像程序的源码和版本未改变；`bash scripts/package-go-release.sh` 重建发布包及程序/镜像清单、文档、SHA256SUMS，`/tmp/piwork-go-warning-release.log`。只含发布包三个二进制的 scratch 宿主连接独立 Engine 完成真实 SDK→Go MCP、Service/DAV、Desktop/Console、Stop/Export/Inspect/Import/Start 与 workspace 恢复，PASS：`/tmp/piwork-go-warning-native-host.log`。运行进程只有 Go 平台程序；镜像内完整 TS harness 仍实际执行。
- 最终核对上述两项 WARNING 已关闭，补充任务 14.10–14.11 完整实现；不以历史 970/970 记录替代本轮修复验证。

## 并发凭证 WARNING 修复（14.12）

- 同一用户的 CLI 进程或 CLI/Desktop 共用凭证文件。保存与条件清理在私有目录 FD 的非阻塞跨进程 flock 内完成；清理仅删除与旧请求 Core/token 一致的记录，同一 Core 重新登录的新 token 与其他 Core 的新记录同样保留。远端请求不持锁，不改变凭证格式。
- 安全确认文件缺席或被新会话替换后，旧会话已确认结束仍可 exit0、`loggedOut=true`；该输出只指旧会话。锁忙、畸形 JSON/Core URL、安全核验及删除失败返回失败、不报告成功、不重放撤销。Desktop 保持本地即时退出与远端确认展示。
- 17 个顶层针对性回归（包括真实双 CLI 子进程、跨进程锁、Desktop 8 分支和真实 Go Core 既有认证回归）通过，`/tmp/piwork-go-concurrent-closure.log`；race 通过，`/tmp/piwork-go-concurrent-race.log`；完整 make test 通过，`/tmp/piwork-go-concurrent-final-unit.log`。双进程并发测试使用受控 HTTP 端点；真实 Core 回归与发布宿主验证独立执行。
- 最终发布包重跑原失败复现保留新凭证，`/tmp/piwork-go-concurrent-release-repro.log`。最终发布二进制在独立 Engine 和 scratch 完成真实 SDK/MCP、Service、WebDAV、Desktop/Console 及完整导出恢复闭环，`/tmp/piwork-go-concurrent-native-host.log`。重建发布清单、文档和 SHA256SUMS，`/tmp/piwork-go-concurrent-release.log`；静态 Go ELF 与最终程序字节核对通过。更新既有 6 条 CLI 场景的证据，仍为 970/970，不新增或重编号场景。
- 补充任务 14.12 完成，当前 116/116。完整 Engine/Chrome/Edge 基线沿用此前通过证据；本次按最后修改执行精确回归、race、全量单测和最终发布宿主验证。

## 最终补充验收

- 多版本包闭包、pending Apply、缺失历史包拒绝、第二个 context 的包恢复故障、容量忙后的并发命名重试、导入权限保持、两副本 Session 隔离与重新导出：完整真实 Engine 回归 PASS 347.65 秒，`/tmp/piwork-go-snapshot-final-read-only.log`。
- 从未初始化的 Work：镜像入口失败保持 active=null，确认 Stop 后冷快照导出，导入仍 active=null，显式 Start 后激活；残留 file helper 与丢失镜像预检继续拒绝。`/tmp/piwork-go-preflight-empty-final-pass.log`。
- 验收发布包：`dist/release/piwork-linux-amd64-23870cfbec6a.tar.gz` 及相邻 SHA-256。该产物在源码提交前构建，记录构建时的 commit 与 dirty 标志；提交后重新发布时由构建流水生成新的版本身份。本 OpenSpec change 尚未同步/归档。
- 本次核对采用完整 Engine 基线与最后修改的对应回归、浏览器及受控宿主组合证据；完整基线中的 Core 集成批次耗时 3945.107 秒。
