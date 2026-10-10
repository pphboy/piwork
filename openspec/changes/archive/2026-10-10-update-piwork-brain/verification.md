# 实施验收记录

日期：2026-10-10。范围为 Core 内置 piwork-brain package 更新；未操作 Fedora、发布镜像或改动用户安装。

## 实现结果

- 内嵌 package version 为 `1.1.0`，交付归档使用现有 FastAPI + React + TypeScript + Vite 指导、模板和固定 Web base，不包含 NiceGUI 实现、依赖、入口或回退。
- 已 seed 的原内置启用旧包经现有 helper 准备后原子切换 Core catalog head；相同版本重复启动不再次发布，失败保留旧 head 和制品。
- 管理员替换、禁用、移除和空默认保持；普通 Core 包操作与启动准备互斥，已接受请求的幂等重放仍返回原 Operation。准备共用原容量门禁。
- 原 Work 不自动更新或 Apply。没有新增公共 DTO、UI、数据库 schema 或升级任务机制。

## 执行证据

| 检查 | 结果 |
| --- | --- |
| `go test ./internal/coreassets ./internal/coreapp ./internal/corestore ./internal/pipackage` | 通过；Core 单测 54.122 秒 |
| `go test -race ./internal/coreassets ./internal/coreapp -run '^Test(BrainArchive\|BundledBrain)' -count=1` | 通过；包归档、启动更新及并发门禁检查 |
| `go test -race ./internal/coreapp -run '^Test(BundledBrain\|Package)' -count=1` | 通过，16.408 秒；包含最终幂等重放回归 |
| `TestNativeCoreUpdatesLegacyBundledBrainOnRestart` | 真实 Docker/SDK 集成通过，最终运行 140.45 秒 |
| `TestNativePackagePreparationUsesDurableEngineResources` | local/ZIP 原生 helper 集成通过，8.02 秒 |
| `PIWORK_GO_BUILD_DIR=dist/piwork-brain-update/go make build-go` | 最终源码构建通过，关闭 CGo；产物仅在被忽略的本地目录 |
| `node scripts/check-native-boundary.mjs` | 通过，Node 24 |
| `openspec validate update-piwork-brain --strict`、`git diff --check` | 通过 |

集成使用现有 `go-migration-acceptance` Agent、file helper 和 snapshot helper。旧输入为隔离的合成 `1.0.0` 包，具有旧部署指导和可由真实 SDK 加载的 extension；不复制真实安装，不将旧栈文件交付进新脑包。启动前后对照证明：Core head 更新；既有 Work configuration/context 和加载摘要不变，工作文件内容保留；新 Work 实际加载新版内容摘要，捕获的部署 Skill 使用新技术栈。

## 测试资源清理

按各自精确 installation 标签核对以下 fixture，容器、卷和网络均剩余 0：

- `piwork-test-c2e0ce39-c778-4217-ac85-52e4fe42e3ed`：首次 Core 更新集成。
- `piwork-test-55cf1967-e7a6-47e0-8aa6-0b620adbd8c4`：最终 Core 更新集成。
- `piwork-test-54e6930f-c1d1-4b51-9c52-28829166267d`：原生包准备集成。

没有执行全局 Docker 清理。历史归档和既有 Work 捕获内容保持原边界；此次结果不代表新版本已发布或远程安装已升级。
