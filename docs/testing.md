# 测试与验收

本页描述 Go 平台和保留的 Pi Agent harness。构建机需要 Go 1.25.5、Node 24/npm、Docker Engine、Playwright Chromium；发布包的宿主程序运行时不需要 Node、npm、Python、Go、Docker CLI 或 OpenSSL 可执行文件。Agent 镜像内仍包含 Node 和 Pi SDK。

## 统一入口

```sh
make generate          # 固定 proto 生成及 Go HTTP 契约
make build             # harness、浏览器资源和七个 Go 程序
make test              # Go 单元/契约、保留 harness 单元、浏览器类型检查
make test-integration  # 真实 Engine、确定性 Pi SDK、Go Desktop/Console 浏览器
make acceptance        # 集成测试及 970 项场景证据完整性门槛
make release           # 三个宿主入口和镜像清单、校验和、发布包
make test-native-host  # 发布包 + scratch 宿主 + 独立 Engine 的完整运行检查
```

`make acceptance` 在任一场景没有测试、命令和结果证据时失败。阶段及逐项结果见 [Go 迁移验收记录](go-migration-acceptance.md) 和 [场景索引](go-migration-scenarios.json)。单独执行 `go test -mod=readonly ./...` 可验证 Go 单元测试，不启动 Docker。
源码边界由 `node scripts/check-native-boundary.mjs` 核对，生产/验收镜像的入口、保留 TS 模块、生产依赖与四个镜像内 Go 程序由 `node scripts/check-native-image-boundary.mjs` 核对；二者已接入 `make acceptance`。

集成测试只使用固定的确定性模型和真实 Pi SDK，不会默认调用付费模型。需要真实提供商时，另行显式运行专用 smoke；它不替代确定性验收。

## Docker 隔离

`internal/testsupport` 为每次测试生成独立的 `piwork-test-<uuid>` 安装身份。测试创建的 Docker container/network/volume 均带 `piwork.installation_id`，发现、inspect 和清理只针对该身份。不得使用全局 prune、模糊名称过滤或跨安装清理。需要独立 Engine 时设置 `PIWORK_TEST_DOCKER_HOST=unix:///path/to/docker.sock`；测试宿主可以没有 Docker CLI，但构建镜像的开发入口需要它。

真实 Core 的 package、file 和 snapshot 测试需要事先构建 Agent 及 helper 镜像。`make test-integration` 完成这些构建；直接运行 Go integration test 时，应按 [Go 迁移验收记录](go-migration-acceptance.md) 给出固定镜像环境变量。Core/CLI 子进程测试在 PATH 中移除解释器和 Docker CLI；Pi Agent 容器内仍使用它自己的 Node 运行时。

浏览器测试源位于 `apps/desktop-webui/test` 与 `apps/console-webui/browser-tests`，测试进程只启动 Go CLI、Go Console 和 Go Core。Chrome/Edge 人工界面 Review 与无解释器宿主的发布包验收单列在迁移阶段 gate 中；自动 Chromium 通过不能替代它们。
Desktop 的真实 Go Core/CLI 联合脚本已接入 `make test-integration`，默认使用 Playwright Chromium。Chrome 或 Edge 的正式界面验收可分别使用 `PIWORK_TEST_BROWSER_BIN=/path/to/browser PIWORK_TEST_SCREENSHOT_DIR=/path/to/evidence npm run test:real-core -w @piwork/desktop-webui` 执行；脚本为每次测试创建独立 Core 数据目录和受管 Work，并在结束后清理。该脚本依赖预先构建的 Agent 与原生 file/snapshot helper 镜像。

完整包包含固定镜像，大包验收应将 `TMPDIR` 指向空间充足的磁盘目录；内存盘 `/tmp` 的可用空间不足时，Desktop 按规定保留 1 GiB 余量并拒绝暂存，不能降低生产空间限制来通过测试。

`make test-native-host` 使用开发机 Docker CLI/Node/OpenSSL 准备测试夹具；这些工具不在被测宿主内。测试创建带唯一 fixture label 的临时 `docker:27-dind` 特权容器作为独立 Engine，并把发布包三个程序放在 scratch 容器中，共享该 Engine 的 Unix socket 和同机数据路径。被测 Core/CLI/Console 的根文件系统没有解释器、shell、Go、Docker CLI 或 OpenSSL，PATH 为 `/nonexistent`。脚本验证真实 SDK→Go MCP 部署、Service proxy、WebDAV、嵌入 Desktop/Console、Export/Inspect/Import/Start 和 workspace 数据，再核对实际进程及缺失工具。准备 fixture 时需要 `docker:27-dind` 和 `python:3.13-slim`；后者仅运行用户测试 Service。结束只清理该 fixture 的 container、volume、scratch image，不清理其他安装。此 gate 已接入 `make acceptance`。
