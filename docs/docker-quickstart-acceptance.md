# Docker Quick Start 终端验收

本记录对应 `improve-readme-quickstart-docs`，于 2026-10-08 验证 README 默认 Docker run 与可选 Core Compose Demo 的终端试用。操作入口见 [Quick Start](../README.zh-CN.md#quick-start) 和 [Core Compose Demo](../deploy/docker/README.zh-CN.md#core-compose-demo)。既有 Windows/Desktop 事实保留在 [Docker 交付验收](docker-delivery-acceptance.md)，本记录不替代其平台或完整业务验收。

## 环境与镜像

| 项目 | 实际值 |
| --- | --- |
| 架构 | Linux amd64 |
| 内核 | 6.18.40.1-microsoft-standard-WSL2 |
| 测试 Engine | 独立 docker:28-dind，Engine 28.5.2 |
| 外层宿主 Engine | 26.1.5+dfsg1，仅承载隔离 Engine；不作为 Core 支持范围证据 |
| Compose | 2.26.1-4 |
| 检查工具 | Node 24.20.0、Go 1.25.5、POSIX sh、GNU SHA256/tar、Chromium |
| 镜像版本与源码 | 已发行 0.0.1，20fb8334f1dce93bfa79cb6b5c86acf1cc460963 |
| 独立 Engine 名称 | piwork-quickstart-engine-bedbb8f89307 |

公开安装包来自既有 v0.0.1 Release；压缩包 SHA256 为 `b0d230734da8f64f6d629e6ea565159d419a9974a44f808fd29ae3559bf28a64`，包内十项 checksum 全部通过。确认该包缺少 `core.run.env.example`；README 的空白 heredoc 分支已实际验证，新模板仅加入本地新版材料。

实际使用的固定镜像：

| 角色 | 发行引用 |
| --- | --- |
| core | `docker.io/pphboy/piwork-core@sha256:dd41d60f639b68ed11c7408da829aba0db4e87a77965a44d416a4b34b8b67d2c` |
| cli | `docker.io/pphboy/piwork-cli@sha256:cc7ec26ab7ebddffdab22df4a74e363d619e8d920b4811a1d271072b04eb12ff` |
| agent | `docker.io/pphboy/piwork-agentd@sha256:fe1096bc481b6ccbbf3bfabbab4963d893580a1ba23f358f66c676bc3672f146` |
| fileHelper | `docker.io/pphboy/piwork-file-helper@sha256:798a1d417c2c93edc3e304d917fac6b6528e3be30f7332b89d40ce8c1df142f1` |
| snapshotHelper | `docker.io/pphboy/piwork-snapshot-helper@sha256:6d1360a573c34e103bc52e0430b979e6bc42b89b061258507db11bafb98a695c` |

Package helper 复用 Agent 引用。隔离 Engine 初始为空，默认 Core 启动时自动取得并准备 Agent、package/file/snapshot helper；没有手动预拉取运行依赖。

真实模型输入来自已有私有测试文件，仅写入本次私有 Core env；CLI 使用独立生成的测试用户密码，通过真实 TTY 隐藏输入。本文不包含模型 key、真实环境值、密码、token 或回复正文。终端首次回复由实际 Pi SDK 发出，并核对 Run state=4/succeeded 和非空 finalText，不以 fixture 或健康探针代替。

## 实际结果

| 检查 | 结果与证据 |
| --- | --- |
| 默认 Docker run | 完整 profile ready；真实 TTY 登录；work create --wait 自动启动；chat 成功返回 958 字节真实回复。 |
| Core Compose Demo | Core 独立目录部署，CLI 仍为交互 Docker run；完整 ready、TTY 登录、自动启动和真实回复通过，回复 572 字节。 |
| CLI 重建 | 两种路径分别保留状态卷，重新进入无需登录；原用户与凭证文件摘要相同，退出 CLI 不停止 Work。 |
| Core 正常停止与恢复 | 两种路径 Core 退出码均为 0，本安装受管 Work 运行容器停止；重新启动后原 Work/Session/Run、完整历史和数据卷身份保留，running 意图恢复。 |
| 已有初始化值 | 在默认安装中使用改变后的合法管理员密码和模型 key 创建替代 Core；原密码仍可登录，原模型 profile/secret 摘要未变，未覆盖持久值。 |
| 特殊字符解析 | Docker env-file 和 Compose 实际容器分别核对合成 `$`、空格和单/双引号；值与期望一致，不输出值。Compose config 的 `$` 转义展示未被误判为运行时值。 |
| Demo 配置 | 固定 image、host 网络、Unix socket、同绝对路径挂载、root 用户、完整就绪 healthcheck 和 60 秒关闭预算均经真实 compose config 核对。 |
| 准备与下载 | 新模板/旧包分支内容相同、0600、已有 env 不被覆盖；受控下载成功，下载失败、错误/非法 checksum 和错误内部 checksum 均停止后续安装。 |
| 命令与展示 | 双语默认命令一致、所有默认 sh 代码块语法通过；Chromium 验证 160×160 Logo 居中、Docker 展开、原生 CLI 默认折叠且展开后只有终端命令；本地链接/锚点通过。 |
| 材料检查 | check-docker-quickstart 的 26 项检查通过，涵盖 CLI 秘密/端口误配置、Core 路径/网络/关闭预算、模板、双语和 Demo 漂移，以及检查入口非零退出。 |
| 本机材料夹具 | 包含两个 Core 模板，source/staging/解压内容一致，内部与压缩包 SHA256 通过；篡改或缺少模板被拒绝。此夹具明确使用合成元数据，不是正式发行包。 |
| 既有 CLI 恢复契约 | 定向 Go CLI 单元检查通过，涵盖同一已接受 Operation/Run 的观察、消息流断开恢复和中断取消，不重复提交 mutation。 |
| 源码边界 | check-native-boundary 通过；Go/TS 业务源码、默认 Desktop 行为、API、数据格式与协议未修改。 |

实际命令从 README 和安装手册代码块取得，使用独立 Engine endpoint；仅为追踪与隔离加入测试容器/Compose 项目名称和 Demo 的独立 CLI 状态卷。测试保持 Core 的 host 网络、Unix socket、同绝对路径目录、固定镜像、CLI bridge/host-gateway 和真实 TTY。

主验证命令：

```sh
node scripts/check-docker-quickstart.mjs
node --test scripts/check-docker-quickstart.test.mjs
node scripts/check-native-boundary.mjs
go test ./internal/cli -run 'TestChat(Submits|Interrupt|Disconnect)|Test.*(Operation|Wait)' -count=1
openspec validate improve-readme-quickstart-docs --strict
git diff --check
```

## 原对象与状态保持

| 对象 | 默认 Docker run | Core Compose Demo |
| --- | --- | --- |
| Installation | `installation-2f774084e839e571b5726af6ba4f02c0` | `installation-b278cbbe04e182f3a3bf457d85f05b20` |
| Work | `work-5372eaed-492d-4e3e-9087-4f450cb7c96f` | `work-2eafe034-7bf2-40c3-b45f-97683ebf48af` |
| Operation | `operation-d6d1c554f4ca19b3679914ff81af02b7` | `operation-1b87f3afb92d4bad06041eeea890ab4d` |
| Session | `01a11c06-fbb1-7091-9547-5c931925c45d` | `01a11c1a-a33e-728f-907c-837f2d1c859f` |
| Run | `run-b4ba248d-87fc-4d24-8a80-b62c3238bf7e` | `run-81ddbfc0-cbaa-40b8-9807-0812b7dcf99b` |
| CLI 状态卷 | `piwork-quickstart-client-state` | `piwork-quickstart-demo-client-state` |
| Work 数据卷 | `piwork-vol-bba7cbb59a637e2f`, `piwork-vol-e06b1f201615fbcf` | `piwork-vol-5cc063517bb1ab00`, `piwork-vol-8931a077ab90019c` |

CLI 重进和 Core 停止/恢复均查询上述原对象，不通过重新创建 Work 或发送新消息来判断恢复。已有安装初始化检查也保留默认安装的原标识。

## 负向入口

| 场景 | 实际结果 |
| --- | --- |
| 管理员密码缺项 | detached launch 后 Core 非零退出，不能视为就绪。 |
| 短密码 | Core 非零退出，未报告就绪。 |
| 非法远端 HTTP 模型地址 | 初始化拒绝，Core 非零退出。 |
| 缺少 Docker socket | bind 源不存在，Docker 启动失败。 |
| 镜像不可取得 | 不存在的固定 registry digest 拒绝启动。 |
| 7171 占用 | 另一个有效 Core 占用端口，新的 Core 非零退出。 |
| 容器名称占用 | Docker 拒绝重用已存在名称。 |
| 就绪等待失败 | 保持 README 的 curl 控制和重试选项，将观察预算缩至 1 秒的受控夹具非零退出，后续操作 sentinel 没有执行；README 实际预算仍为 600 秒。 |

## 发行边界与清理

没有 push 镜像、上传包或创建 Release。真实运行使用既有已发行固定镜像，材料夹具只核对本地打包内容与完整性。

尝试既有 package 入口时，在当前缺少 dist/docker/build.json 的条件下返回 `Build the Docker images first.`；原源码身份、远端 digest、协议、版本和 sourceInputHash 门禁保持。新的正式候选镜像/包尚未构建和发布，不宣称这些步骤通过，也不修改构建元数据绕过检查。新产物对外推送仍由用户针对具体结果另行判断。

清理只针对上述独立 Engine 容器及带本次精确 fixture 标识的专用数据卷；先确认每个本次 Core 正常退出，再移除该 Engine 和卷。没有全局 prune、宿主 Core 数据删除或其他安装资源操作。已确认三个本次有效 Core 均正常退出（exit 0），精确标签核对后移除独立 Engine 容器和专用卷，并删除本次生成的秘密配置副本；原私有测试输入文件保留。
