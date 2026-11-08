# 本地实施与验收事实

本附件保留发布前的本地验收事实；随后获准执行的远端发布与 brain 1.3.1 引用更新见 [镜像发布记录](image-publication.md)。

日期：2026-11-08。范围为本变更的本地实现和验证；没有对外推送镜像、发布 Core/MicroVM 或部署官网。

## 制品身份

| 项目 | 实际值 |
| --- | --- |
| 源码 commit | `08fc54adda53a0c9ee71f66d3ec237050adf9be0` |
| 构建 dirty | `true`，身份保留实际未提交状态 |
| brain 版本 | `1.3.0` |
| 平台 | `linux/amd64` |
| 本地镜像引用 | `docker.io/pphboy/piwork-fastapi-htmx-base:0.1.0-08fc54adda53-44102ae552dd-dirty` |
| 本地 image ID | `sha256:d23d4cea03a546bf2dd55506989af323ab91cd8ea679f523fd5db2944594945f` |
| 镜像 input hash | `44102ae552dd9b9fc8f608277cb3db99a416739fb78cbb33615afa5bb054eaea` |
| 镜像大小 | `181601367` bytes；不据此宣称相对 NiceGUI 的优势 |
| 最后 SDK 运行源码身份 | `8557e8636e233b658f9d51ce96f2ca8dba8841821318d6dba0ff5b6b938a105f` |
| Core SHA256 | `fc776848dd1d36a8067e4a2d3b5a56914f48330a672e1d7ff5a9a5d0f7d6fa9f` |
| CLI SHA256 | `ecbcf20c8887d771ac05c1d21653745bb572deccad5e078f69e5bde1b5dd18f1` |

末次通过后重新计算镜像输入及运行器源码身份，分别与候选和 SDK 结果一致。`validation.json`、`dependencies-validation.json`、`core-validation.json` 均匹配同一最终 image ID/input hash。正式 brain Reference 保持 `state: unpublished`、`reference: null`，没有捏造 registry digest 或匿名可取结论。资源清单保留 htmx 的真实 0BSD 许可和 Bootstrap 的 MIT 许可。

## 已执行检查

| 检查 | 结果与边界 |
| --- | --- |
| `make build` 与末版宿主重建 | 通过；产物仍为两个 Linux amd64 宿主程序，Core 包含新 brain |
| `go test ./internal/coreassets ./internal/coreapp` | 通过，含包版本、资源与更新保护回归 |
| pi-adapter 单元测试 | 22 项通过 |
| 构建身份、初始化、风格与集成计划工具测试 | 29 项通过，含负例 |
| 现有 NiceGUI runtime/依赖工具测试 | 22 项通过；使用只读环境和共享依赖准备器 |
| 最终 FastAPI runner 测试 | 5 项通过；检查副本、身份、失败测试/模板、并发准备及准备期间改动 |
| 两栈额外依赖验收 | 通过；显式安装、console interpreter、冲突/失败保护、并发准备、离线重建、移动应用及环境变化 |
| NiceGUI 默认浏览器回归 | web-app 前缀、草稿、业务操作和重启通过；工作站完整 SDK 回归另有独立通过结果 |
| 最终 FastAPI 镜像浏览器验收 | 通过；非 root/只读根、sqlite3、离线资源、htmx 表单、Agent 共享状态、输入/焦点、查询故障、深层刷新、乱序读取、检查副本及自动采用 |
| 文件选择、存储失败与代码恢复 | 通过；有文件选择时延后 reload，存储失败保留当前输入，恢复后自动采用；上一版本与匹配解释器可恢复，业务数据保留 |
| 真实 CLI Desktop/托管入口 | 通过；登录、Service 页面、两个独立 Work/Service 同源打开、单应用更新、SDK 页面/业务修改、查询故障、拒绝重复初始化及正常 Core 重启 |
| 仓库文档/native-boundary/docker-quickstart/风格/空白检查 | 通过；宿主安装参数、Compose 和发行镜像角色未改变 |

文件选择/存储失败/恢复的可重复适配器为 [check-input-protection.mjs](check-input-protection.mjs)，复用仓库正式镜像浏览器入口，生成的临时脚本及日志仍在 dist。它只注入合成浏览器故障，不进入产品代码。

## 真实 SDK 子集

统一集成运行器发现 507 个用例，明确选择以下两个，最终报告为 **partial: 2/2 PASS**，无跳过和聚合错误，不宣称全仓集成通过：

- `TestNativeBrainFastAPIAcceptedActionGapRecovery`：89.27 秒。分别覆盖原 Action 已终态、仍运行及无法证明的恢复，不重放副作用。
- `TestNativeBrainFastAPIWorkstationFeedbackExperienceAndActualCandidateBehavior`：158.05 秒。覆盖页面/Agent 操作、反馈修复、异步导出、Evidence、Memory、页面和业务修改回合、显式候选 Apply、实际行为通过/失败，以及两份独立导入后的新反馈和候选证明。

最终记录位于本机 `dist/fastapi-htmx-base/core-integration-5/result.json`，含实际源码、编译输出、镜像、宿主/测试二进制及清理身份。整轮约 365 秒，包含共享准备，不代表单应用交付速度。

NiceGUI 的完整工作站用例在 `core-integration-2/unit-0002.jsonl` 独立通过（150.15 秒）；那一轮的 FastAPI 用例失败，因此该轮整体不能称为通过。两种栈的副作用窗口恢复随后在 `core-integration-4` 各自通过，该轮完整 FastAPI 用例的夹具问题仍按失败保留，最终以 `core-integration-5` 为新栈通过依据。

## 失败记录与修正

- 初次 bind 测试遇到本机 0077 umask 下的目录/文件不可读；测试输入使用独立可读副本，合成身份显式设置读取权限，没有放宽用户数据或源码目录权限。
- runner 首次候选目录创建缺少父目录，已修复，并收紧失败测试的异常类型，防止用无关异常假通过。
- 直接 HTTP Service 入口下 `crypto.randomUUID` 不可用；改用 `crypto.getRandomValues`，并在浏览器夹具禁用 randomUUID 后验证。
- 恢复测试原先只改配置，没有部署到 checked copy；测试 driver 现通过原 Service restart/Operation 采用配置。
- FastAPI starter 的复盘默认正确；反馈修复测试现由确定性 driver 显式注入遗漏故障，再验证修复，不在正常 starter 中交付故意错误。
- 原 Desktop 验收脚本等待已不存在的 Works heading，已改为等待实际 Work 链接。
- 本机空 `/home/p/.git` 干扰 Go 自动 VCS 检测。产品构建使用当前 worktree 的显式 Git 路径并保留 `-buildvcs=true`；测试二进制使用明确记录的 `GOFLAGS=-buildvcs=false`。Go 单元和进程夹具以 umask 0022 重跑，避免权限负例的合成 0644 文件被 0077 自动缩成 0600。原失败日志未删除。
- `core-integration-3` 因恢复夹具尚未部署配置而中止，保留 aborted 状态，不计为通过。后续运行没有复用其测试结果。

各轮原日志、候选和机器验证输出位于被忽略的 `dist/fastapi-htmx-base/`；本附件仅保留必要事实，不包含真实凭据或用户数据。

## 已测范围与剩余边界

已测 Linux amd64、本地 Docker、真实 Go Core/SDK/MCP 与 Chromium 的原入口。确定性 driver 证明实际工具和协议集成，不证明任意模型自主选型或修复的成功率。没有执行全仓 507 项集成测试、其他平台/浏览器矩阵或相对 NiceGUI 的性能对比。

没有执行 DockerHub 推送、匿名远端 digest 拉取验证、Core 正式发布、MicroVM 发版或官网部署。公共可用引用仍须后续明确发布指令与对应验证，现有 Work 仍按原包更新/显式 Apply 采用新 brain。
