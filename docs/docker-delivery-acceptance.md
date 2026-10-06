# Core 与 CLI Docker 交付验收

2026-10-06，`deliver-core-and-cli-with-docker` 的原 D01–D09 使用验收全部通过，支持取得发行包后的使用闭环。本次验证后的修复仅统一 Core 正常关闭全部受管 Work 的规范、修正安装/校验命令并刷新本机候选材料；此前误加的实际上传及公共下载入口验收按用户纠正移出本次范围，不以已完成冒充移除，也不作为阻塞项。此前已授权发布的镜像位于 Docker Hub 的 `pphboy` 命名空间，用户只启动 Core、CLI 两个入口；运行依赖由 Core 自动取得和管理。安装、完整命令、数据流及新增操作见 [中文操作手册](../deploy/docker/README.zh-CN.md)，维护者另行构建和手动发布说明见 [Docker 发行维护](docker-release.md)。

## 验证后的问题修复范围

| 补充项 | 状态与范围 |
| --- | --- |
| Core 正常关闭所有受管 Work | 语义已经确认，沿用现有停止 Agent/Service 的实现；正常关闭成功前确认全部停止，保留记录、历史、数据和运行意图。关闭失败仍尝试其他 Work，非零退出并保留诊断；异常退出不能标记正常关闭成功，CLI 退出不停止 Work。 |
| Bash/PowerShell 在线及已有本地包入口 | 用户手册提供完整步骤，比较可信预期 SHA256 后才解压，之后核对内部清单；下载/校验失败时停止，不只显示计算结果。已有包入口无需再次下载，镜像仍需可拉取。 |
| 本机候选包与 checksum | 使用既有 package 更新本机材料，核对模板、归档、内部清单及源码/Desktop hash；原 D09 收据保留，不冒充新材料的检查结果。 |
| 本次执行边界 | 不执行镜像 push、包上传、Release 创建或托管配置，不索取发布地址/凭证，不新增自动发行功能；公共下载入口不是本次修复的完成条件。 |

本次修改只涉及交付材料，源码及镜像内容保持；原有实机 Work/Run/Service/Files/快照及关闭/恢复证据保留。原候选包及对应 checksum/收据在刷新当前本机包前按其压缩包 SHA256 保存，避免将旧通过记录误用于新材料。

## 发行身份

| 项目 | 实际值 |
| --- | --- |
| 版本 / 架构 | `0.1.0` / `linux/amd64` |
| 源码提交 | `cc5640fd6b7fce7f6669be7bbc31c72614137b57` |
| 工作区状态 | `sourceModified=true`，包含本变更尚未提交的实现 |
| 源码输入 SHA256 | `01da2af4e912267ba9451b2c5230a4ffe1f43254e77c39b2207c4d1b41ab1514` |
| Desktop 输入 SHA256 | `817a8d99fcaf77419f98ccac7716232cf9b91018b7ea4cbd21b268ace9c45903` |
| Core / 客户端格式 | `piwork-go-core` schema 1 / credential version 1 |
| 原使用验收候选包 | `dist/docker/history/598ce9ccd9f4e43998edf81ec518ac631b2418717bfe6b1d8cb38c639ad720df/piwork-docker-0.1.0-cc5640fd6b7f.tar.gz` |
| 原候选包 SHA256 | `598ce9ccd9f4e43998edf81ec518ac631b2418717bfe6b1d8cb38c639ad720df` |
| 更新手册后的本机候选包 | `dist/docker/piwork-docker-0.1.0-cc5640fd6b7f.tar.gz` |
| 当前候选包 SHA256 | `0bac05b406835e860bfb50ae38a05d659808fcedc11734d0f77a83530d428283` |

当前候选包使用同一组已验证镜像、源码输入和 Desktop hash；重新打包时读取既有远端 digest、pull 并检查镜像平台/协议/程序版本，核对包内 8 项 checksum、压缩包 checksum 及 9 个归档文件与 staging 一致性。该过程只生成本机材料，不推送镜像或上传压缩包；本机检查不被描述为公共下载入口验收。

`release.env` 固定下列实际 digest。每个 digest 已通过无发布凭证的远端 manifest 查询及 pull；取得的 image ID 与本次构建一致。所有镜像使用标签 `0.1.0-cc5640fd6b7f`，安装使用 digest。

| 镜像 | Docker Hub digest |
| --- | --- |
| `docker.io/pphboy/piwork-core` | `sha256:2ed4834a881ee6680b028bca9751dab5fad5dac3147d35edb3f91610f19b7ed0` |
| `docker.io/pphboy/piwork-cli` | `sha256:9efeaadc7ee756f48003c4dffa26cfb56d977abf2aa417fdc43ce19b13a2fa02` |
| `docker.io/pphboy/piwork-agentd` | `sha256:b34811c6abb18acb2c37d3ea9401e24b3766bdc22093f6bc1bb386628b5635b8` |
| `docker.io/pphboy/piwork-file-helper` | `sha256:6ee1d6f33b1ebbc8fe8bee0b55f478cb0c5663c514fd81da5108e9a1971c3cbe` |
| `docker.io/pphboy/piwork-snapshot-helper` | `sha256:05469e21b4c79b68fb187699741de15859f9018763e25e207af314e4d8291a42` |

Package helper 使用相同 Agent digest。完整 image ID、协议 labels、基础层 digest 和其他元数据位于生成的 `dist/docker/piwork-docker/release-manifest.json`。本版是首个 Docker 发行，前版兼容和可直接回退版本列表均为空。

## 实际环境与范围

| 执行环境 | OS / 内核 | Engine / Desktop | Compose | 浏览器 |
| --- | --- | --- | --- | --- |
| Linux Core 与 Linux CLI | Debian 13.3 用户机；独立 Engine 宿主为 Alpine 3.22；内核 `6.18.40.1-microsoft-standard-WSL2` | rootful Engine `28.5.2` | `2.26.1-4` | 同机 Linux Chromium `140.0.7339.186` |
| Windows CLI | Windows 11 `10.0.26200.0`，Linux 容器 | Docker Desktop `4.41.2 (191736)`；Engine `28.1.1` | `2.35.1-desktop.1` | 同机 Windows Edge `138.0.3351.65` |
| 构建 | Linux amd64 | 固定 Alpine 3.22 基础 digest | — | Go `1.25.5` / Node `24.20.0` |

Linux 的冷启动使用独立 Docker-in-Docker Engine 28，避免宿主 Engine 26 的既有镜像与用户资源影响验收。特权仅用于该测试 Engine；发行 Core Compose 使用 host 网络及 Unix socket，没有 privileged。Core 与 Engine 中的数据 bind 使用相同绝对路径。

Linux CLI 使用发行的 bridge 与 `host-gateway` 覆盖；受控 TCP relay 将隔离 Engine 宿主的 Desktop loopback 入口交给同机 Linux 浏览器。Windows 使用真实 `desktop-linux` context、发行 CLI 镜像和基本 Compose，通过可达的 LAN Core 地址访问 Linux Core；没有加载 Linux 网络覆盖。两端顺序执行，避免同一物理电脑的 `127.0.0.1:17891` 相互占用。发行 Compose 文件未经测试专用修改。

此环境已有 localhost 出站代理。测试 relay 仅桥接该代理及隔离 Engine 的网络，没有修改全局 Docker Desktop/Engine 设置。Core 对其选定 socket 和 Work 私网的 mTLS 连接绕过外部 HTTP 代理；模型请求仍由真实 Agent/Pi SDK 发出。

支持范围为 Linux Core、Linux CLI Docker，以及 Windows Docker Desktop 的 Linux CLI 容器；要求 Engine 28+、Compose 2.24+、`linux/amd64`。Windows Core、Windows 容器和其他架构没有本次验收声明。原生 CLI 的构建与交付入口保持，无 Desktop Docker 的完整命令已交付，本次没有单独建立其端到端验收或发布门禁。

## D01–D09 实际结果

| 编号 | 结果 | 实际证据 |
| --- | --- | --- |
| D01 冷启动 | 通过 | 独立 Engine 初始缓存为空、数据目录无安装；只手动 pull Core，Core 自动取得 Agent/package、file、snapshot 依赖；六组件 ready，完整 profile 200，Work 数量 0。 |
| D02 失败与重试 | 通过 | 受控慢拉取期间 status/profile 最大耗时 2 ms；file/snapshot 首次失败后在同一 Core 进程重试，第 3 次取得 ready；降级时基础 probe 200、完整 profile 503；Engine 断连后 1515 ms 撤销 ready；实际不兼容 Agent 为 failed / IMAGE_INCOMPATIBLE；拉取中关闭 exit 0，108 ms。 |
| D03 Linux Desktop | 通过 | 实际发行 CLI 镜像经 bridge/host-gateway 连接 Core；本机 Chromium 兑换 exec open 票据并登录；主启动日志无票据，匿名页面要求本地授权，宿主仅发布 loopback。 |
| D04 Windows Desktop | 通过 | Windows Docker Desktop 实际 pull 已发布 CLI digest，容器 image ID 与 manifest 一致；同机 Edge 完成本地授权和 Core 登录，CLI 无 socket、Core/Work 数据挂载。 |
| D05 Work / Run | 两端通过 | 两端各创建一个 ready Work，各提交一个真实 SDK 模型 Run，terminal state 4 / succeeded，回复 `PIWORK_DOCKER_OK`（16 字节）；页面重新加载和后续恢复均沿用原 Run，未重提。 |
| D06 Service / Files | 两端通过 | 固定 Node Service fixture 经 Desktop iframe 返回 HTTP 页面并进行实际 WebSocket 回显 `PIWORK_WS`；创建目录、上传和下载 8 字节二进制文件完全一致；错误 Host 403、跨站 Origin 403、匿名 Files 401。 |
| D07 快照 | 两端通过 | 浏览器停止原 Work 后 Export / Download；退出 Core 登录后本地 Inspect 完整校验；Import 产生新 stopped Work，再明确 Start；文件字节、desired 配置、实际 Agent image ID 与原 Session 的 3 条历史消息一致。 |
| D08 授权与重建 | 两端通过 | 无浏览器 Cookie 的 exec logout 清除 Core 登录而保留既有本地浏览器授权；CLI 重建后旧 Cookie 和旧实例待兑换票据失效，新 open 恢复且保存凭证一致；停止 CLI 不停止 Work。Core 实际 force-recreate 后管理员、runtime、模型 key、operator credential、默认配置、原 ID、两卷及文件均保留。两端真实浏览器再次打开后显示原 Session/Run 回复，无 Run 重提。 |
| D09 发行与原生兼容 | 通过 | 五个公开 digest、六个角色、原生协议及镜像内版本匹配；固定 Desktop hash；包内 8 项 checksum 及压缩包 checksum 通过，模板与源文件一致；包内无真实密码/key；缺失 helper 和协议不兼容被拒绝；既有 Linux/Windows 原生 CLI 构建与既有 Go 打包链通过相关检查。 |

真实模型输入来自本机 `.env.test`，provider 为 `anthropic`、model 为 `deepseek-flash`，使用其配置的 DeepSeek Anthropic-compatible HTTPS endpoint。管理员密码与模型 key 只作为私有环境输入；本记录、发行包和镜像均不包含这些值。确定性 recovery fixture 与真实模型 D05 分别记录。

## 原对象与数据核对

主安装为 `installation-b033e401ac6d16423c26fbbe15128208`，用户为 `user-2d76d52b-2213-43a0-83aa-d1c567f7f827`。

| 对象 | Linux 浏览器创建 | Windows 浏览器创建 |
| --- | --- | --- |
| 原 Work | `work-b7a67712-6c3a-4a05-bfc7-395868d0b936` | `work-1b88a803-5406-4bc8-970e-2ff95a64533e` |
| Create Operation | `operation-355c0803a68638ebd52ee99e4f1ac6f1` | `operation-0dadf1187b9a595cf0b2510733a082a0` |
| Session | `01a10f2e-5722-73eb-b7a1-956d157c4ff3` | `01a10f49-3137-7440-82f2-270b8669d9d9` |
| Run | `run-0d5ee9e0-feaa-41be-9204-400fd861a84c` | `run-ffbe2c49-355e-412b-9fd7-573ae42f71d2` |
| Service | `service-ea5c4785-a5ba-4176-bd60-0023ce262ba3` | `service-1ee27c40-e63b-4a2b-9255-e4c17cb4079d` |
| Imported Work | `work-9e2098be-6a3c-4cbd-9ea9-a4ee6a13eb7a` | `work-2b6102fd-5aee-4c26-b1aa-e38dc96b9b3c` |
| Import Operation | `operation-b84ebbf8009f2bd52e7df664c53e204e` | `operation-2bc1d9d0b9a97e527865bf835107693f` |
| `.work` 字节数 | `605994494` | `605994515` |
| `.work` SHA256 | `b8d16e76ec779b56f7868e3863c383de55071bd126a260b215374984d59f713e` | `45234e1dba2b316add72d15648cb123d7ab2891533d154ef5dab813bacc80389` |

二进制文件字节为 `00 01 02 80 ff 2a 0d 0a`，SHA256 为 `ef66207bfb22b380e03f0ca4d43cb60c7d1e4d942be96bf37097f10338a27971`。Core 重建前后四个 Work 的每一对永久卷名称和内容一致；Agent 实际 image ID 均为 `sha256:abbc9fac9fb1cf04957fa09276685c07e45ca778545c457412fd4042abf497d0`。原 Work 和导入 Work 的 catalog 选择来源可不同，核对的是完整 desired 语义和实际捕获镜像。

D08 重建时将合法的管理员账号/密码、provider/model、模型 Base URL/key 改为不同的初始化值；已有管理员仍以原账号登录，新账号被拒绝，runtime revision 保持 1，私有 credential 字节一致，默认 Work 配置未被重置。为核对原 stopped Work 的历史，验收仅启动已有原 Work，读取后恢复停止；没有重新提交模型 Run。

Core 优雅退出沿用 work-lifecycle 的有界排空及停止 Agent/Service 流程，正常关闭成功前必须确认本安装所有受管 Work 已停，保留 desiredState、Service 启用意图与数据，重启恢复原运行意图；本变更没有改变该实现。某个 Work 的 drain/停止失败仍继续尝试其他 Work，不能确认关闭时按非零退出和未完成诊断处理。SIGKILL、崩溃或断电不执行完整正常关闭，不能记录所有 Work 已停。交付规范和手册明确区分 Core 退出、明确 Work stop 与 CLI 退出，CLI 退出不停止 Work。

## 代码、构建与材料检查

- Core 与 Agent client 的 `go test -race ./internal/coreapp ./internal/agentclient` 通过，Core 126.715 秒、Agent client 1.055 秒。准备调度、helper 恢复、配置换代、严格 DTO、默认/profile probe、Engine heartbeat 和关闭检查通过。
- 既有实际进程 recovery 八项全部通过（669.924 秒）：文件 unknown-create/迟到尝试、文件提交前后 crash、package 关闭/crash 不重装、Work stop/delete 取消 package、关闭时其他 Work 恢复、snapshot 实际 crash、Core crash 采用已有 Agent。
- CLI、client、contracts、Core operator、Docker Engine 和原生 release 相关检查通过；容器模式覆盖监听地址、NAT 对端、Host/Origin、本地授权、同实例控制、私有状态权限和原生默认行为。
- `make build-go`、`npm run build:cli` 和现有 `scripts/package-go-release.sh` 实际执行。Linux ELF 与 Windows PE 独立客户端的 commit、Go 版本、二进制 checksum 和 Desktop hash 均匹配；现有 Go 发行包的 38 项内部 checksum 通过。Docker 结果不替代 `support-cross-platform-cli-and-default-desktop` 中尚未完成的原生 Windows 验收。
- 实际 Linux Compose 合并配置与 Windows 基本配置检查通过；缺必需镜像变量、数据 bind source 或 socket 均明确失败；Windows 无 Linux host 覆盖，CLI 仅有命名卷与 loopback 发布，静态 health 无票据。
- `openspec validate deliver-core-and-cli-with-docker --strict`、`git diff --check` 通过。源码输入在构建、打包和最终审核时一致，没有用陈旧 Desktop 产物代替当前源码。

## 证据位置与复核

安全结果位于 `dist/docker/D01.json`、`dist/docker/D02.json`、`dist/docker/linux-desktop/evidence.json`、`dist/docker/windows-desktop/evidence.json`、`dist/docker/D08-core.json` 和 `dist/docker/D09.json`。两端 `desktop.png` 与 `after-core-rebuild.png` 保存实际浏览器结果，`export.work` 保存下载包。运行日志为 `/tmp/piwork-D02.log`、`/tmp/piwork-docker-recovery-tests.log`、`/tmp/piwork-docker-build-final.log`、`/tmp/piwork-docker-package.log` 和 `/tmp/piwork-native-package.log`。这些是本机验收产物，发行包只包含用户所需文件。

原 D09 收据另保存在原候选包相邻的 `history/598ce9ccd9f4e43998edf81ec518ac631b2418717bfe6b1d8cb38c639ad720df/D09.json`，对应上表的原候选包。先前错误增加的 `dist/docker/D09-distribution.json` 标记为 `result=not_applicable` 并说明实际发行不在本次修复范围内，不将其冒充通过结果或继续等待发布输入。本次本机材料检查另记录在 `dist/docker/D09-materials-fix.json`。

更新手册的 Bash 语法检查、受控本机 HTTP fixture 的正常下载/本地包路径及下载失败、错误/非法 checksum 阻止解压结果位于 `dist/docker/handbook-check.json`；Core 关闭命令的受控 fixture 确认退出码非零时不继续 down、保留诊断。PowerShell 本轮仅静态审阅输入、退出码、完整 script block 与失败路径；既有真实 Windows Docker Desktop/浏览器使用证据保留，不以本机 fixture 或静态审阅冒充新的 Windows 实机验收。修正范围后的本机重打包日志为 `/tmp/piwork-docker-package-fix.log`。先前准备的发行说明副本仅保留为历史本机材料，不构成发行待办。

复核当前 Docker 发行材料：

```bash
cd dist/docker/piwork-docker
sha256sum -c SHA256SUMS
cd ..
sha256sum -c piwork-docker-0.1.0-cc5640fd6b7f.tar.gz.sha256
```

依赖故障的测试安装为 `installation-41b860b3ba58ba6815349fac8cf3b18a`，已按该安装标签核对并清理。主安装的容器、网络和卷剩余数量同样为 0；两端客户端的测试卷、隔离 Engine 和专用 relay 已清理，复制的模型输入及私有验收数据已移除。清理只作用于核对过的本次安装/fixture 身份，不使用全局 prune；Windows 另核对其他容器、网络和卷仍保留。结果见 `dist/docker/cleanup-linux.json` 与 `dist/docker/cleanup-windows.json`。发行镜像、发行包、安全验收结果和原始 `.env.test` 保留。
