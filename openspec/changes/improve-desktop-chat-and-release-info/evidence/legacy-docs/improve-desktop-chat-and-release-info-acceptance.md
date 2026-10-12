# Chat 图片、创建交互与版本日志验收

日期：2026-10-11。对应变更：`improve-desktop-chat-and-release-info`。

本记录描述当前工作区的实际执行结果，不表示新的对外发行，也不替代 Windows 实机或全部 Docker 发行验收。

## 输入与环境

- HEAD：`5818e1de7bb5af9bd6305777fc88b40505a708b3`；实现及本记录尚未提交，工作区 `modified=true`。
- 宿主：Linux amd64、Go 1.25.5、Node 24.13.0、Docker Engine 26.1.5+dfsg1；浏览器为本机 Playwright Chromium。
- Go Core 使用独立 `piwork-test-<uuid>` 安装、数据目录和 Docker 标签。测试只清理各自精确 installation ID；未执行全局 prune。
- 提供商为合成 HTTPS/SSE 服务，真实 Pi SDK 0.86.1 执行 Responses/Messages 请求，不使用真实 API Key。图片是合成 PNG/JPEG/WebP；没有记录真实图片、密码、token 或私钥。

## 执行结果

| 检查 | 实际结果 |
| --- | --- |
| `make generate` | 通过；212 个 Go DTO schema、6932 条 TS oracle 夹具，proto 与 Go/TS 生成产物同步 |
| `make build` | 通过；harness、两端 WebUI、Go 程序及内嵌浏览器资源已构建 |
| `make test` | 通过；Go 单元/契约、65 项 scripts 测试、contracts 37、pi-package 8、work-store 62、pi-adapter 18、agentd 102 项测试均无失败 |
| `npm run test:browser -w @piwork/desktop-webui` | 251 项中 250 通过，0 失败；1 项原有“五分钟未使用 ticket”长等待场景未启用。新增图片、About 和创建布局场景均已执行 |
| `npm run test:browser -w @piwork/console-webui` | 75 项全部通过，包括真实 Console 代理的 About 页面和安全日志正文 |
| `TestNativeChatImagesAndOfflinePackageRoundTrip` | 通过，188.960 秒；5 MiB PNG 加 JPEG 贯通真实 Go Core、TS Agent 和 Pi SDK，再完成源 Core 下线后的完整包迁移与续聊 |
| `make build-cli` | Linux amd64 与 Windows amd64 交叉构建通过；两个实际二进制均通过 `clirelease.ValidateBuild` 身份/资源校验。Windows 二进制没有作为 Windows 实机运行证据 |
| `node scripts/check-native-boundary.mjs` | 通过，宿主原生平台边界保持 |
| Quick Start 合成契约与构建输入 | `check-docker-quickstart.test.mjs` 28 项通过；release-info/build-cli/build-docker-release 8 项定向测试通过 |
| `git diff --check` / OpenSpec strict validate | 通过 |

本次 Node 24.21.0 测试运行器曾在两个宿主浏览器测试文件发生原生断言崩溃；改用 Node 24.13.0 后完成上述测试。该调整没有改变仓库运行依赖或发行身份。

## 后续 OpenSpec 核验发现

实现后的独立核验发现以下未解决事项；上述测试通过不表示这些组合场景已经覆盖：

- 初始 Session 发现期间批量选择两张图片，第一张读取时草稿迁移到实际 Session，后续图片仍写入旧草稿 key。定向复现显示第一张可见、第二张滞留旧草稿且没有错误提示；现有迁移回归仅覆盖单张图片。
- 图片模型能力与有效历史上下文分别有测试，尚缺通过 `submitChat` 覆盖图片上下文切换文本模型拒绝、摘要移除图片后恢复准入的组合回归。
- 创建布局测试测量 Create 按钮，尚未测量 Cancel/Close；Advanced 与 360px 长等待的组合也未直接覆盖。
- About 尚缺旧 Core 404 后业务保持、切换 Core 后旧请求晚返回的直接回归。

本轮核验重跑相关 Go 包、13 项 Desktop 浏览器测试、8 项构建/日志测试及 OpenSpec 严格校验均通过；未修改上述实现或将问题标记为已解决。

## 已验证行为

图片支持粘贴、拖拽、文件选择、纯图和图文发送，添加/预览不创建 Session/Run 或上传到 Work。混合批次保留合法项，超限、伪造 MIME、截断容器和尺寸边界在共享 Go/TS 夹具中一致处理。初始 Session 尚在发现时选择图片的固定竞态场景已验证：图片随自动归属迁移完成读取，不会停留在 Checking。

发送快照与后续草稿分开：在途新增图片、修改或重新输入相同文字均保留；离开原页面后的接受回调只消费原快照，不关闭新表单。未知接受只按原键核对，消息和图片不重复；单张历史图片的 Retry 只重读二进制。扩展处理器 handled、丢图、换图及提供商请求改图均被拒绝，原已接受输入仍可查。

真实 Docker 场景使用 5 MiB PNG 跨越原 gRPC 4 MiB 默认边界。模型收到原图片字节，历史列表仅包含描述；图片访问校验原 Work/Session/Run/索引，未登录及其他用户被拒绝。停止 Work 后图片请求保持既有 `WORK_UNAVAILABLE` 返回且不触发 Start。

原图与 SDK 保存前中断输入在原受理事务中有持久副本。测试覆盖只读核对、重启中断、下一次显式续聊的历史补全、真实 SDK 落盘同步后事件压缩、重复恢复不重复消息、已摘要图片不复活，以及损坏消息拒绝。Go/TS 冷历史夹具还覆盖图文 promptDigest 与 Memory preference 证据的一致性及错误摘要拒绝，未增加 SQLite schema、卷或 Work 包版本。

完整包测试的源 Work 为 `work-067e62d3-49a7-4cec-b241-13ddd3aeb175`，目标为 `work-ea24b069-43b2-4824-a525-e40e095bb68d`。测试 Stop/export 后关闭源 Core，目标独立安装 import 得到 stopped Work，显式 Start 后读取同一 Session/Run 的原图并续聊；接收方使用自己的模型授权，没有自动回放历史。

创建按钮验证了宽屏 Advanced、360px 普通表单、长名称、十秒等待、长拒绝与结果未知。按钮位置/尺寸误差不超过 1 CSS px，状态区域独立可读，只有一次创建 POST；未知结果不释放重复提交保护。

About 分别采用本机 piwork-cli 和远端 piwork-serve 身份，与版本命令一致。普通已登录用户、管理员、非 ready Core、本地未登录/离线、失效身份及 Console 管理会话均有定向验证。日志安全按文本显示，匹配精确组件/版本；开发或缺失条目明确未提供，固定 All releases 链接不会触发后台联网。

## 本地制品身份

以下为本次本地验收的 Agent 基底及 helper 镜像，未推送或宣布为正式可下载版本。真实提供商场景由 `nativeModelGateway` 临时给 Agent 基底添加合成 CA；该派生镜像使用独立 UUID 标签并在测试后清理，不能把表中基底 ID 当作派生镜像 ID：

| 角色 / 标签 | 实际 image ID |
| --- | --- |
| `piwork-agentd:chat-release-validation` | `sha256:5a587c4b3acb5ddaa7263da4a6cb45be31c32ec87d3e4ca9c261e3bc529e01ac` |
| `piwork-file-helper:chat-release-validation` | `sha256:f6ff76581d3df4b9d5543b6314c12fcd2b48df6410fa42dd68302717c10c77c0` |
| `piwork-snapshot-helper:chat-release-validation` | `sha256:293df553ec07a8258b1b93e1670a927cc0c2f4b393dcba317b656189122f999d` |

客户端仍按当前构建入口读取 `0.0.3`，`modified=true`，commit 为上述 HEAD；这不是重新发布 0.0.3。`releaseInfoHash=ff512f3c70efc8ebef6fc8e83ff69c802f5bf3cf269faaf2735784079d3a8085` 绑定内置日志资源。精确 binary/UI SHA 见本次本机 `dist/cli/*/build.json`，不改写旧发行记录。

## 已发布材料检查边界

根目录 `node scripts/check-docker-quickstart.mjs` 返回失败，唯一诊断为 `deploy/docker/release.json: source inputs changed; regenerate candidate`。该记录状态为 published，绑定的是已发布 0.0.3 的 commit `30ac253e9dce501351a9e2499bac0f6f66545e91` 和输入 hash `653d50a5d7d5cbeff48f0fd94c0db4a60cff72eb76594369862e7dfd69a8aa42`。当前未发行源码与之不同。

本变更保留了这份发布清单、固定镜像引用及 Compose 制品身份。合成材料检查 28 项通过，说明双语命令、模板与材料契约保持；不能据此把根目录发行 hash 检查写成通过。后续正式发行需要从新的真实候选生成对应材料并完成该门禁，本次没有执行发布。

新功能日志只记入 Unreleased，未编造正式版本或发布日期。使用文档已说明当前源码构建范围及精确版本缺失态。

## 审阅与后续提交范围

按图片端到端实现（契约、生成产物、Go/TS、冷历史、测试及配套资源）、创建布局、产品信息/日志与构建输入分别审阅。使用文档中英文对应修改单独组织；同文件多目的修改需分段暂存，生成资源随对应实现重建。OpenSpec 主规格同步和归档在明确请求后另行组织。本次未创建 Git 提交，也未归档其他在途变更。

## 合入 NiceGUI 与创建提速主分支后的回归

2026-10-11，合并提交 `57d0428` 将 `fix-misc-1` 的六个提交合入 `main`。以下检查在完成冲突处理的工作树上、合并提交前构建执行，保留主分支 NiceGUI 脑包 1.2.1、创建预热/缓存实现和已发布 0.0.4 固定身份。

- 完整 `make test` 通过；Desktop 浏览器测试 251 项中 250 通过、0 失败、1 项原有五分钟长等待场景未启用；Console 浏览器测试 75 项全部通过。已知问题及组合覆盖缺口仍按前述核验发现保留，没有因合并而标记解决。
- `make generate` 通过，212 个 Go DTO schema 与 6932 条 TS oracle 夹具重生成后无额外差异。首次生成等待下载 protoc，改用该分支工作树已有的同版 protoc 36.2 缓存后完成，没有修改生成入口或工具版本。
- `make build-cli` 的 Linux amd64 / Windows amd64 交叉构建通过；本轮没有 Windows 实机运行证据。开发源码版本读取 0.0.4，新增日志仍为 Unreleased，不代表重发 0.0.4 或补造正式版本日志。
- `TestNativeChatImagesAndOfflinePackageRoundTrip` 通过，套件耗时 93.166 s；真实 SDK 图片请求、metadata 历史、原图、幂等，以及源 Core 下线后的完整包导入和续聊通过。Agent/helper 采用前述本地验收镜像身份。
- 首次图片夹具构建将裸 image ID 放入 Dockerfile `FROM`，被 Docker 当作远端镜像名而解析失败。给同一 Agent 镜像添加本轮专用本地标签后重跑通过；未更换镜像字节或修改产品代码，首轮日志保留。
- 41 份主规格与本次 `improve-desktop-chat-and-release-info` change 的严格校验通过。全仓 `--all --strict` 为 47 通过、3 失败：`fix-desktop-local-auth-recovery`、`fix-webui-data-integrity-and-recovery`、`go-core-cli-migration` 的既有 delta 遗漏当前主规格场景；这些旧 change 未在本轮修改。本次 change 保留在途状态，未同步主规格或归档。
- Docker Quick Start 材料一致性、原生边界与 `git diff --check` 通过；当前已发布材料校验允许后续源码演进，前述旧检查器的失败记录仍是原分支验收事实。公开 0.0.4 镜像不包含本轮新增功能，发布记录、固定引用和 digest 未改写。

本轮本机构建与测试日志位于被忽略的 `dist/merge-fix-misc-1/`。未执行新的镜像发行。
