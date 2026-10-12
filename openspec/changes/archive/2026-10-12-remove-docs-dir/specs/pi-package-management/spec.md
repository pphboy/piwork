# pi-package-management 规格变更

## ADDED Requirements

### Requirement: 原生包准备的隔离与不可变发布

**Identifier:** PKG-NATIVE-001

包 helper SHALL 提供 prepare/init/capture/measure/source-capture 固定入口，只接受 action，路径由 Core 挂载，不接受任意宿主路径。package-helper 启动 contract 2 与包内容 contract 1 分离；宿主不运行 npm/Git，镜像保留目标 Node/Pi 环境。stdout 仅一个 JSON 结果，失败 exit 1 只输出安全 errorCode，不泄漏第三方 stderr/路径/凭据。

Core SHALL 在接受事务固定 Operation/job、源 lease、镜像、目标环境、epoch 与 30 分钟期限；全局最多两项准备，同一 scope 一个非终态任务。init/capture 为 1 CPU/512 MiB/64 PIDs，prepare 为非 root、专用 bridge、2 CPU/2 GiB/256 PIDs/256 MiB 临时空间，measure 为无网络 0.25 CPU/128 MiB/32 PIDs；只读根、最小 capability、不挂 Core DB/token/model key/socket、不发布端口。每两秒可信逻辑计量，4 GiB 上限终止准备。

local/ZIP SHALL 原生解包；npm pack --ignore-scripts 获取来源后流式解包；Git 仅公开无凭据 HTTPS 并固定完整 commit。依赖按匹配 lockfile npm ci，否则 npm install，保留已有安装脚本/omit dev/peer 规则，临时修改 manifest 无论成功失败均恢复原字节和执行位。环境/peer/ABI/OS/架构取自固定目标镜像而非宿主。输入压缩包 256 MiB、树 1 GiB、单文件 64 MiB、manifest 1 MiB、100000 项、深度 64、路径 4096 字节；ZIP/TAR 链接、CRC、长度及 inventory 静态核验后原子发布。

每次 create 前 SHALL 持久化精确资源意图，恢复确认 helper 停止后才回收卷/网络/lease，不把暂时 404 当成未知创建不存在。已退出 prepare 不重启，恢复只发布完整合法 capture，否则 interrupted，不能重跑包脚本。from-core 冻结 enabled head 为 Work 自有字节；包变化仅改 desired，显式 Apply 才更新 active/loaded。脑包 source-capture 固定来源摘要与 verificationTarget，同键返回原候选，迟到结果不能覆盖用户替换的包或其他 desired 编辑。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```sh
make build-go
dist/go/piwork-package-helper --version
```

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

```sh
CGO_ENABLED=0 PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:go-migration-acceptance go test -mod=readonly -tags=integration ./internal/coreapp -run '^TestNative(OnlinePiSubagentsInstallApplyAndExecute|PackagePeerFaultsPreserveFrozenCoreHead)$' -count=1 -v
```
