# Go Pi package helper

`piwork-package-helper` 是镜像内的原生程序，提供 `prepare/init/capture/measure` 四个入口。宿主 Core 只通过 Docker Engine API 调度它；helper 不操作 Core 数据库，不读取 Core 凭据。Pi package 内容 contract 仍为 1。

## 构建与迁移状态

开发构建需要固定 Go 1.25.5：

```sh
make build-go
dist/go/piwork-package-helper --version
```

构建使用 `CGO_ENABLED=0`，输出普通 ELF。Agent 镜像把它放在 `/usr/local/bin/piwork-package-helper`，声明 `io.piwork.package-helper.contract=2`；镜像还保留 Pi SDK、Node/npm/Git。Go Core 已接入包准备、Core/Work 目录管理和不可变 Work 副本；完整 Core 迁移门槛仍未通过。禁止回退到旧 TS helper。

运行时只接受一个 action 参数，路径由 Core 固定挂载，不接受用户传入的宿主路径：

| 入口 | 输入/输出 | 执行边界 |
| --- | --- | --- |
| `init` | `/package/work` | 可信 root 程序初始化工作卷，必要时以 CHOWN 将目录交给 10001；不联网、不执行脚本 |
| `prepare` | `/package/source/request.json`，local/ZIP 另有 `input.zip`；输出 `/package/work/result` | 仅在 Docker 容器内以非 root 运行；只允许镜像内 npm/Git 与安装脚本；受限网络、资源、独立工作卷 |
| `capture` | `/package/spool/request.json`，只读的 `/package/work/result`；输出 `artifact.zip`、`result.json` | 可信程序静态验证并打包；无网络，不运行包代码；spool 文件发布为 0644 |
| `measure` | `/package/work`；输出逻辑字节数 | 不读取文件内容、不跟随目录链接；超过 4 GiB 返回上限加一，Core 据此终止准备 |

标准输出始终是一条 JSON 结果。失败 exit 1，只输出 `errorCode`，不输出 npm/Git stderr、凭据、原始路径。未知内部错误的 code 为 null。帮助与版本查询不读取包、不启动工具。

## Core 调度与资源归属

Core 在 SQL 接受事务中保存 Operation、job、源 upload/artifact lease、固定镜像身份、目标环境、worker epoch 和 30 分钟期限，再开始后台准备。全局至多两项准备运行；同一 Core/Work scope 同时只允许一个非终态任务。

| 动作 | 身份与权限 | Docker 限制 |
| --- | --- | --- |
| init | root，仅 CHOWN，独立工作卷可写 | 无网络、1 CPU、512 MiB、64 PIDs |
| prepare | 10001，无 capability，来源只读、独立工作卷可写 | job 专用 bridge、2 CPU、2 GiB、256 PIDs、256 MiB 临时空间 |
| capture | root，仅 DAC_OVERRIDE/CHOWN，工作卷只读、spool 可写；输出继承已固定 spool 目录的 uid/gid | 无网络、1 CPU、512 MiB、64 PIDs |
| measure | 10001，无 capability，工作卷只读 | 无网络、0.25 CPU、128 MiB、32 PIDs |

各容器只读 rootfs、no-new-privileges，不挂载 Core 数据库、operator/token、模型凭据或 Docker socket；不发布宿主端口。Core 每两秒通过可信 measure 检查工作卷逻辑空间，达到 4 GiB 上限后终止准备。可信 Node 环境探针无文件挂载或网络，仅读取目标镜像自带 Node ABI/Pi SDK 版本，不执行用户包。

每个 Engine create 前持久保存包含 installation、scope、job、epoch、action、固定 image 和配置摘要的资源意图及未确认创建标记。恢复先核验并停止所有登记 helper，确认不存在后再移除卷和网络、释放租约；未知标签/名称冲突不能删除。创建响应丢失时，重启不能把暂时的 404 当作已确认不存在。已退出的 prepare 不会再次启动。

Core 独立验证 capture ZIP 的字节摘要、完整资源 inventory、环境和共享内容身份后才发布制品。恢复可静态发布已完整 capture 的结果；缺失、损坏或不完整结果以 `PI_PACKAGE_INTERRUPTED` 失败，不重跑安装脚本。原来源/依赖错误保留安全分类，未确认退出保留 `cleanup-pending` 与租约。

Work 的 from-core 在接受事务捕获 enabled head 并持有 lease，再复制为 Work 自有 context 中的独立文件；Core 更新、禁用或删除不会改变已有 Work 字节。安装、更新、开关与移除只修改 desired，运行中的 active/loaded 保持原内容，需显式 Apply 激活。

## 包准备与静态验证

local/ZIP 原生解压；npm 用镜像内 `npm pack --ignore-scripts` 获取来源，再由 Go TAR/GZIP 流式解包；Git 只接受无凭据的公开 HTTPS 来源，固定到完整 commit。来源树在安装前验证。依赖使用匹配的 lockfile 执行 `npm ci`，否则 `npm install`；保留现有 fetch 参数、omit dev、legacy peer 与安装脚本行为。无锁且有 devDependencies 时临时移除 dev 声明，成功/失败后均恢复原 manifest 字节及执行位。

四个 Pi host module 的版本从兼容镜像读取，Pi API 应作为 peer dependency。peer range 与 Node ABI/OS/architecture/variant/SDK 环境校验沿用现有契约，不能用构建宿主的 Node 版本代替目标镜像。命令使用 argv 和环境白名单，stdout 最多 4096 字节；命令期限不超过现有 30 分钟 preparation deadline。超时/SIGTERM/SIGINT 终止整个安装进程组，Core 仍须确认容器退出并收尾 durable job。

压缩包最多 256 MiB，恢复树最多 1 GiB，单文件 64 MiB，manifest 1 MiB，100000 entries、深度 64、路径 4096 bytes。静态检查覆盖重复路径、越界/循环/失效链接、特殊文件、CRC/长度、依赖闭包与资源 inventory。归档采用流式读写和目录内暂存，验证完成后原子发布；不把整包读入内存。共享内容摘要仍采用 `piwork-pi-package-tree-v1` 的规范排序和 framing。

## 可复现验证

迁移前的 TS/Node oracle 已固定在测试 fixture 中；当前测试直接读取这些样本，不再运行旧平台的采集脚本。

```sh
make harness-fixtures
make test-go
make build-go
go test -mod=readonly -tags=integration -v ./internal/dockerengine \
  -run TestNativePackageHelperRealImageSourcesAndTSArtifactCompatibility
PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:go-migration-acceptance \
  go test -mod=readonly -tags=integration -v ./internal/packageprepare \
  -run TestNativePackagePreparationUsesDurableEngineResources
PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:go-migration-acceptance \
  go test -mod=readonly -tags=integration -v ./internal/coreapp \
  -run TestCorePackageHTTPPublishesAndReplaysFrozenContent
```

真实 Engine fixture 使用预先构建的原生 acceptance 镜像，可通过 `PIWORK_TEST_NATIVE_AGENT_IMAGE` 指定；兼容性 fixture 也可在旧 acceptance 开发镜像只读挂载当前 Go helper，这仅属于测试。业务 Core 拒绝仅含旧 TS helper 的镜像。测试进程将 PATH 设为空工具目录，npm/Git/Node 只在容器内执行。fixture 使用随机 installation label，只清理自己的容器、网络和卷；能力错误镜像仅删除本测试提交得到的确切 image ID，不 prune。

测试包括四来源、tools-v1/v2 四种资源及安装脚本、真实 registry dependency 字节、固定 Git commit、原 manifest、safe source/install/peer 错误、真实安装脚本取消；生成的制品由镜像内现有 TS validator 再次核验。原生单元测试另覆盖超时/进程组回收、环境白名单、输出限额、npm ci 选择和失败恢复、恶意 ZIP/TAR、稀疏文件逻辑计量。生成 TS oracle 仅为开发动作，生产 Go 不调用这些脚本。

## 在线固定版本验收

`TestNativeOnlinePiSubagentsInstallApplyAndExecute` 从真实 npm registry 安装 `pi-subagents@0.71.0` 到 Core，复制到 Work 并显式 Apply，由完整 TS Pi SDK 执行前台、后台子代理；还验证 Stop 回收持续运行的子进程。模型 fixture 只提供确定性响应，未替换 SDK 或包内工具。

```sh
CGO_ENABLED=0 PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:go-migration-acceptance go test -mod=readonly -tags=integration ./internal/coreapp -run '^TestNative(OnlinePiSubagentsInstallApplyAndExecute|PackagePeerFaultsPreserveFrozenCoreHead)$' -count=1 -v
```

第二个测试检查有效 peer、版本不满足、无效范围和禁止的 Pi 运行时依赖，失败保持原冻结 head。测试连接实际 registry，来源不可达会失败；Go Core 宿主不执行 npm。具体旧 Pi 0.86.0 镜像与升级场景尚未执行，不以未来版本范围的故障注入替代这些证据。
