# Go 辅助程序与 Agent 镜像

此文对应 `go-core-cli-migration` 的 3.9。完整 pi-agentd/Pi SDK harness 保留 TS，Agent 默认入口仍是 `node /workspace/apps/agentd/dist/main.js`；两个独立平台程序改为 Go。

## 构建与固定入口

```sh
make native-agent-images
```

构建产生 `piwork-agentd:go-migration-production` 与 `piwork-agentd:go-migration-acceptance`，不覆盖现有开发镜像的标签。两种 target 共享 runtime 层和同一套 Go 程序。构建工具可使用 Docker CLI；生产 Go Core 只通过 Engine API 操作镜像。

Go 构建阶段默认 `golang:1.25.5-alpine3.22`，可通过 `GO_BUILDER_IMAGE` 构建参数指定镜像源，工具链仍须为 Go 1.25.5。`CGO_ENABLED=0`、固定 go.mod/go.sum、`-mod=readonly`、commit/dirty 标识用于可追溯构建。Alpine 只存在于构建阶段，运行阶段仍为 Node 24 Bookworm，保留 npm/Git 与 Pi 生态。

| 能力 | 镜像配置 label | 普通可执行文件 |
| --- | --- | --- |
| Agent RPC | `io.piwork.agent.protocol=v2` | 原 Node Agent 入口 |
| 包准备 | `io.piwork.package-helper.contract=2` | `/usr/local/bin/piwork-package-helper` |
| Service MCP | `io.piwork.service-mcp.contract=1` | `/usr/local/bin/piwork-service-mcp` |

helper 启动能力与 Pi package **内容 contract 1**、context contract 1、`.work` V1 分开。镜像不复制已移除的 TS package-helper/service-mcp workspace，不创建 Node shebang 或链接启动器。完整 Agent harness 和其 Pi 生态依赖保留。

## 静态检查与资源边界

`internal/dockerengine.ImageInspector` 固定 image ID，通过 Engine inspect/save 获取归档，不运行 ENTRYPOINT、Node、helper、MCP 或用户包，不创建检查容器、网络或卷。调用方提供已锁定的安装私有目录与持久 registry；分配归档 scratch 之前提交安装/image 归属记录。

归档流写入 0600 匿名普通文件。支持 `O_TMPFILE` 时没有目录项；其他文件系统使用独占空文件并立即 unlink，返回 fd 后才写入归档字节。正常退出/取消关闭 fd，SIGKILL 由内核回收。启动恢复只清理本安装的零字节、私有、单链接 fallback 占位文件，并退役前一进程的检查记录；外来或异常文件保留并报错。检查结束后才删除持久记录，收尾有两秒期限。Core 的集中启动恢复及业务准入接入分别由任务 4/5/6 完成。

`internal/imagestatic` 核验 Docker/OCI 归档中选定 config 的 SHA-256 身份、平台、layer/diff ID、gzip 校验与合并文件树。whiteout 先作用于低层，再应用本层新文件；叶子删除、父目录删除、opaque 目录均不能留下已删除的能力。普通文件、执行位、完整 ELF program table、平台、无解释器/动态库依赖都需匹配；符号/硬链接启动器、TS 脚本、虚假 label、缺文件、错误平台及残留旧 helper 目录均拒绝。

检查使用现有包限额：归档与恢复量各 100 GiB、每份 metadata 64 MiB/累计 256 MiB、一百万条目、路径 4096 字节/深度 128；数据流和 ELF 表不会按宣称文件尺寸分配内存。最终目标文件摘要用于证明两个 target 交付相同字节。label/ELF 检查只说明静态能力，Go 构建来源另由发布构建信息和流水线证明。

这不是完整 `.work` validator。完整归档引用闭包、历史/SDK 环境、目标安装独立复核及 import/export 由 Go Work package 模块实现；静态镜像检查单独通过不能替代 Core gate，也不能把离线 inspect 标成目标安装已验证。

## 实际镜像验收

```sh
PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:go-migration-acceptance \
  go test -mod=readonly -tags=integration -v ./internal/dockerengine \
  -run 'TestRealNativeAgentImageStaticCapabilitiesAndBuildEvidence|TestRealTSAgentNativeMutualTLSWithoutHostTools|TestRealTSMCPClientNativeStdioAndCoreMutualTLS|TestNativePackageHelperRealImageSourcesAndTSArtifactCompatibility'
```

此模式只使用镜像交付的 helper/Agent 文件，取消开发覆盖挂载。测试覆盖两个 target 的静态检查/相同程序摘要/Go 版本、完整 TS Agent 启动/mTLS/stale identity、真实 TS MCP stdio 客户端、四来源包及失败分类。`--version` 的可信 smoke 容器在静态检查结束后单独创建，不属于能力检查实现。资源按随机 installation scope 精确回收，不删除已有镜像或开发资源。
