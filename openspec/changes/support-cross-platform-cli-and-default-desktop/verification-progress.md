# 实施验证进度（非发布验收报告）

> HTTP 协议调整已完成当前环境的实现与复验；受影响八项恢复，当前仍为 23/32。下文旧候选及旧测试统计明确标为历史，当前候选见以下补充；旧证据不能用于新产物。

日期：2026-10-05。基线 commit：`590f86d35331201d7471763d2a9821c92a9d3032`。实现尚未提交，也未归档。

## 当前状态

[任务清单](tasks.md) 已完成 **23/32**：`1.1–1.3`、`2.1`、`2.3–2.5`、`3.1–3.3`、`4.2`、`4.3`、`4.5`、`4.7`、`5.1–5.5`、`6.1`、`6.2`、`6.4`、`6.5`。

客户端实现、默认 Desktop、独立 Core 偏好、两平台候选构建和发布验收工具均已落地。余下 9 项包含实际跨用户/链接/已部署 Core 验收和正式发布检查；实现存在不等于该任务的全部验收已通过，不因此勾选。

## HTTP 调整后的当前复验

`allow-http-core-connections` 已 **10/10** 完成并于 2026-10-06 归档。Linux 在隔离网络中补齐实际空根命令；经用户授权暂退并恢复原 Desktop 后，Windows 原生默认入口及偏好保存后无参数重启也已通过。本变更受影响八项的复验保持，完整结果和场景映射见 [HTTP 验证报告](../archive/2026-10-06-allow-http-core-connections/verification-progress.md)。

| 当前候选 | 字节数 | SHA-256 |
| --- | --- | --- |
| `dist/cli/linux-amd64/piwork-cli` | 13433115 | `973e0e28d564ecd1ace16f1068dfe11300967fb9181771fee27a5ef769c0fa79` |
| `dist/cli/windows-amd64/piwork-cli.exe` | 13855744 | `5c62047572bb9afb3bcb2f3ac0de086e7a273020bf1af5cc453aa135f802c750` |

当前 Desktop 输入摘要为 `31c57ca3104012c29dfb886e025903a4f73cc03884317c6817603630d0a7989b`，两原生产物的 app/adapter 均与生成资源逐字节核对。Linux 完整 Go、全组件构建、独立客户端构建通过；Windows client/cli 原生整套通过。偏好浏览器两端各 8 通过；Linux 浏览器分组全部 201 项通过，Windows 原生浏览器专项 9 项通过，包含实际五分钟过期。首次浏览器失败及测试输入/异步等待修正保留在 HTTP 报告，不作历史通过掩盖。

实际 Windows exe 连接 `http://<core-host>:7171`，Linux ELF 连接本机已部署 `http://127.0.0.1:7171`，均通过 status、授权后匿名状态、HTTP 偏好保存→退出→无 Core 覆盖重启及 open。WSL 直连 LAN 地址超时，不能计为同一真实 Core 全命令族验收。正常 TLS 系统信任保留；测试子进程专用信任 fixture 的 HTTPS 正反例通过，真实可信 HTTPS Core 仍缺 fixture。

这次不重新豁免任何下文九项缺口；当前 Linux 协调器 12 pass/6 unverified 的新摘要报告仍被打包工具拒绝，未生成正式归档。

## 改动与使用习惯

- CLI 从 Console 实现/资源隔离，Console 保留独立入口及测试；Pi 安装、解包与服务器专用代码保留 Linux 边界。CLI 不引入本机 Core、容器或 Console。
- Windows 接入 SID/DACL 私有文件、原生锁、固定目录及安全发布、文件身份、磁盘与进程查询、凭证、快照、包来源、Operation 记录和传输。Desktop 使用私有 named pipe 恢复，进程控制接入 Windows console-control；Linux 原 socket 和服务端行为保留。
- **无子命令由帮助改为启动 Desktop**。`--help`、`help`、版本与空 `--json` 保留提前返回。原显式业务命令、JSON、退出码和取消契约保留；显式 `desktop --port/--no-open` 保留，端口冲突失败，不自动换端口。
- Desktop 选择 Core：参数 → 环境 → Desktop 偏好 → 凭证 → loopback。业务 CLI 仍为参数 → 环境 → 凭证 → loopback。UI 保存/清除默认 Core 仅作用于下次启动，不切换当前连接、不改凭证、不清理 Inspect；普通退出登录保留偏好。
- 独立客户端构建重新生成内嵌 UI；运行候选无需相邻资源、源码或 Go/Node/Python/Docker。Windows 是 `.exe`，Linux 是可执行文件，不增加双击要求或固定最低 OS/架构名单。

具体使用、存储安全、构建和 fixture 命令见 [CLI 平台文档](../../../docs/cli-platforms.md)。

## HTTP 调整前候选身份（历史）

版本 `0.1.0`，基线 commit 如上，`modified: true`，Go `1.25.5`、CGO=0。这些是本工作区候选，不是已通过正式验收的归档。

| 目标 | 文件 | 字节数 | SHA-256 |
| --- | --- | --- | --- |
| linux/amd64 | `dist/cli/linux-amd64/piwork-cli` | 13433835 | `5ccecab048a93ff0390b85b2fe08d264522c03390f8b777e71a0dbff5843649c` |
| windows/amd64 | `dist/cli/windows-amd64/piwork-cli.exe` | 13857792 | `c574ea8637a42fc68e203d65fd7be14298677ff276fa49811f5050b49ebc16f4` |

两者 Desktop 构建输入摘要均为 `e6ba2f3db7cc18a90017e40282e961c32514401f20a799f06ecaa8f248980d84`。从二进制实际返回的 `app.js` 摘要均为 `e4a18292ac33e074408fab5bf779a270d3c4b6b7360fc5ea46f427cb8eb237d4`。原生协调器还用当前源码和相同 stamp 重建比对二进制摘要，防止复用源码已经变化的旧候选。

## 环境事实

Linux 为 WSL2，内核 `6.18.40.1-microsoft-standard-WSL2`，amd64；构建及 Go 测试使用 Go 1.25.5，Web 构建/测试使用 Node 24.20.0。

Windows 经本机互操作实际运行原生程序，OS build `10.0.26200.0`，amd64，账号 `MSI\p`，测试进程 token 未提权。Windows Node 24.14.1、Edge 可用于浏览器测试。Windows 已安装 Go 为 1.24.2，因此本次 Go 1.25.5 测试程序由 Linux 编译后在 Windows 实际执行；不能声称 Windows 已运行固定工具链的完整协调器。

上述事实只描述本次测试环境，不是产品要求。当前未取得另一普通 SID 测试账号，且该账号实际创建 symlink 被系统拒绝。没有两平台可用的同一已部署、受原生系统信任的 HTTPS 测试 Core，也没有真实 UNC 网络共享 fixture。

## HTTP 调整前已执行验证（历史）

| 范围 | 结果与限制 |
| --- | --- |
| Linux 全组件 `make build` | 通过；包含原 harness、Desktop/Console 资源及七个 Go 程序，旧构建入口保留。 |
| Linux `go test -mod=readonly ./...` | 全部通过；包含 Core/Console/Pi、客户端及构建/发布工具回归。此命令不包含带 `integration` tag 的 Core/Agent 场景。 |
| Linux `go test -mod=readonly -race ./internal/clientfs ./internal/client` | 通过。 |
| Node 构建/原生协调器测试 | 8 项通过；覆盖调用链、目标/摘要/源码绑定、fixture 结果不能覆盖失败及缺失能力。 |
| 标准库发布工具测试 | 通过；覆盖实际 ELF/交叉编译 PE 的身份校验、证据拒绝、重复 JSON 字段、归档内容/模式和校验和冲突回滚。单测合成证据不用于发布。 |
| Desktop/Console 类型检查 | 通过。 |
| Linux Desktop 浏览器全套、实际候选 | 198 通过，默认未启用的票据过期项 1 skip；该项随后以 `PIWORK_TEST_TICKET_EXPIRY=1` 单独实际等待五分钟并通过，没有把 skip 当作验收。 |
| Linux Console 浏览器 | 49 项通过，包括三个实际 Go Core/Console 场景；这些不等于 Agent Ready 集成通过。 |
| Core 偏好浏览器专项 | Linux 7 项、Windows 原生 Edge 7 项通过，包含状态等待/恢复、晚响应和同 Core 首次登录保留 Inspect。 |
| Windows 浏览器授权/隔离专项、实际候选 | 8 项全部通过，包含真实五分钟票据过期，无 skip。假 Core 凭证由原生 helper 创建私有 ACL。 |
| Windows 原生 `clientfs` | 整套重复 20 次通过；覆盖私有 DACL、宽泛 ACL 拒绝、硬链接、junction、危险路径、目录替换、锁/崩溃、发布竞争/故障及文件身份。另一实际 SID 和真实 symlink 仍缺 fixture。 |
| Windows 原生 `client`、`cli` | 各包整套通过；包含凭证跨进程复用/退出竞争、来源解析、默认入口、偏好存储/API、IPC framing/超时/恢复、快照错误/竞争/输入替换、传输陈旧清理、proxy 和真实进程中断/Chat 原 Run 取消。 |
| Windows 原生 `contracts`、`imagestatic`、`workpackage` | 全部通过。 |
| Windows 原生 `pipackage` | 普通目录/ZIP/摘要/执行元数据、修改、junction 和危险路径相关断言通过；整套因必需真实 symlink fixture 无法创建而失败，不能标记全套通过。UNC 来源解析通过，不等于网络共享安全访问验收。 |
| 两平台候选进程烟测 | 均原生通过；从非源码目录、无开发工具 PATH 执行同摘要候选，验证版本/帮助/空 JSON、内嵌 UI、本地授权、偏好、恢复和中断。 |
| CLI import 图 | Windows 可完整构建；无 Console 实现/资源，也不依赖 Linux 专有 `safefs`；Linux 原服务端依赖仍保留。 |
| 另一用户 fixture helper | Linux 和 Windows 构建通过；没有另一实际账号的执行结果，不能当作拒绝访问证据。 |
| OpenSpec 严格校验及 `git diff --check` | 通过；结构/格式检查不代替运行验收。 |

Windows 文件身份在实际测试中发现同大小改写可能保留时间戳，已改为读者排除并发写入，并使用原生变更序号或内容摘要回退；修复后重复测试通过。未新增 NTFS/USN 产品前提。

## 实际 Core 集成失败与基线复现

使用已有 `piwork-agentd:go-migration-acceptance`、`piwork-file-helper:go-migration-acceptance`、`piwork-snapshot-helper:go-migration-acceptance` 镜像，运行以下真实 Docker/Core 集成：

```sh
go test -mod=readonly -tags=integration -v -timeout=15m ./internal/coreapp \
  -run 'TestNativeUserCLIWorkAndConversationThroughGoCore|TestNativeCoreUploadsIndependentlyVerifiesAndDeduplicatesPackage|TestNativeCoreExportsCompleteStoppedWorkAndDownloadsSameSnapshot' -count=1
```

三项均在 Work Ready 前以 **`AGENT_READINESS_TIMEOUT` 失败**。实际候选执行的 `apps/desktop-webui/test/real-core.mjs` 也在同一 Ready 阶段失败。测试所属资源已清理，未接管用户已有 Core/Console/Desktop 服务。

将原基线 commit 用 `git archive HEAD` 展开到独立目录，在相同镜像与 Docker 上复测 `TestNativeCoreUploadsIndependentlyVerifiesAndDeduplicatesPackage`，同样在 78.71 秒后以 `AGENT_READINESS_TIMEOUT` 失败。该失败在本次 CLI 修改前的代码上可复现；尚未确定具体根因，不能因此声称全组件集成通过。未修改 Core Ready 超时或其他服务端行为来绕过验收。

## 原生证据与发布门禁

HTTP 调整前的 Linux 协调器报告与上述历史候选绑定，记录 18 项必需场景中的 **12 pass、6 unverified**。未验证的是 `other-user`、`preferences-browser`、`core-command-families`、`core-packages-snapshots`、`browser-isolation`、`tls-negative`。浏览器虽已另行实际执行，尚未作为该协调器运行的外部 fixture 绑定到报告；没有手工改写为通过。

本次 HTTP 调整已重新生成绑定新候选的 `dist/cli/linux-amd64/native-evidence.json`，仍为 12 pass、0 fail、6 unverified；原报告保存在 `native-evidence.before-http.json`。新结果详见 [HTTP 验证报告](../archive/2026-10-06-allow-http-core-connections/verification-progress.md)。协调器、候选烟测、存储/凭证 fixture 和证据格式均已实现，但尚无任一完全合格的目标报告。Windows 的手工原生执行也不伪装成完整协调器证据。

已实际尝试用上述不完整 Linux 报告调用发布打包工具：工具以退出码 1 拒绝，未生成正式归档。现有 `dist/cli` 只保留候选二进制与构建元数据，没有已验收的 Windows ZIP/Linux tar.gz 发布物。

## 保留未完成的 9 项

| 任务 | 缺口 |
| --- | --- |
| 2.2 | 另一真实普通 SID 拒绝访问及真实链接 fixture。 |
| 4.1 | Windows Pi 包真实 symlink 整套原生结果；UNC 网络共享事实也未验证。 |
| 4.4 | 已覆盖同用户/伪造通道/消息/崩溃等，但另一实际 SID 对活跃 named pipe 的拒绝仍未执行。 |
| 4.6 | 客户端两目标均完整构建；Windows 客户端依赖中的 Pi 必需链接场景仍未通过，不能据其他包通过勾选。 |
| 6.3 | 验收工具及自身测试已有；尚无全部必需场景合格的原生目标报告。 |
| 7.1 | 全组件构建、默认 Go 与浏览器回归已通过，但实际 Core/Agent Ready 集成失败，基线也可复现。 |
| 7.2 | 两原生客户端连接同一已部署、证书受信任 HTTPS Core 的命令族/包/快照/TLS 正反例完整验收缺失。 |
| 7.3 | 合格证据不足，正式打包保持阻止。 |
| 7.4 | 本报告及严格结构校验已有；全部需求/失败场景的最终闭环尚未完成。 |

按照用户“暂无环境，先完成可在当前环境实施和验证的部分”和“直接继续”的授权，保留当前可审阅实现及真实验证结果。缺少 fixture 不缩小规格，不伪造发布证据，也不标记变更完成或归档。
