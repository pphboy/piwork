# Proposal

## Why

创建 Work 在返回 Work / Operation 前完整导出并扫描 Agent 镜像，进入 Starting 后又重复同一检查；固定镜像的 Node / SDK 环境也会通过新临时容器重复探测。用户因此同时经历受理前无业务进度和 Starting 长时间等待，而已有本机样本中的容器创建、启动只占约 0.6 秒，需要消除共享准备的重复执行并量化真实端到端耗时。

## What Changes

- 为不可变镜像能力检查增加有界、进程内的成功结果缓存与同键并发合并；缓存命中只做镜像存在性与身份核对，不排队等待其他镜像的全量扫描。
- 按固定镜像身份复用真实 Node ABI / Pi SDK 环境探测结果，只有探测成功且临时资源清理确认后才发布缓存。
- 将实际默认 Work 配置所选 Agent 镜像及所需包环境预热接入 Core 现有后台准备；已经安装脑包的安装也执行预热，默认镜像 / 包选择变更后重新调度，使对应准备完成后的第一个默认 Work 复用结果。
- 在 Work 启动阶段消除 gRPC 默认连接退避造成的额外确认等待，保留真实 readiness、mTLS、完整 context / generation 校验和既有超时预算。
- 从 HTTP 请求进入开始记录安全性能事件，分别计量镜像检查、环境探测、上下文捕获、受理、容器启动、RPC 就绪确认、诊断收集和激活。
- 增加缓存正确性、并发取消、Core 关闭、首个 Work、再次 Start、镜像失效和独立 Docker 性能验收；固定条件下以受理 P95 ≤ 1 秒、受理到后端 Ready P95 ≤ 3 秒为目标，实际浏览器全过程 P95 ≤ 6 秒单独测量。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `runnable-work-runtime`：复用已验证的不可变镜像能力与包运行环境，合并并发准备，并在有界启动检查中及时确认真实 Agent readiness。
- `core-service-startup`：默认镜像和所需包环境在后台完成预热，预热不依赖脑包是否需要首次安装，保持现有准备状态和恢复边界。
- `work-lifecycle`：定义默认 Work 创建与启动的性能验收条件、计时边界和结构性重复工作约束，保留原子捕获与持久受理顺序。
- `work-diagnostics`：覆盖受理前等待的安全计时，区分 Agent 实际就绪、Core 确认、诊断收集和最终激活。

## Impact

- 主要涉及新增内部共享准备支持 `internal/preparationcache/`、`internal/dockerengine/image_capabilities.go`、`internal/coreapp/work_binding.go`、`package_install.go`、`package_context.go`、`runtime_preparation.go`、`default_work_patch.go`、`package_worker.go`、`application.go`、`work_create_http.go`、`work_create.go`、`work_start.go`、`work_diagnostics.go`、`internal/agentclient/client.go`、`internal/workruntime/runtime.go` 和 `internal/diagnostics/`，对应单元 / integration 测试与性能夹具随实现交付。
- Core 启动准备、创建、Start、Apply 和恢复共享相同镜像能力缓存；已有 package 安装及脑包候选的环境探测入口共享环境缓存。
- 采用内存缓存，不新增持久存储格式、用户配置、外部依赖或公共 HTTP / RPC DTO。首版预期只需重新构建 Core，不要求重建 Agent 镜像。
- Desktop 现有两秒观察频率保持，浏览器仅用于最终端到端测量；缩短轮询、SSE、容器池、持久化能力缓存和 SDK 启动重构不在本次范围。
- 现有 Work-owned context 独立副本、包环境兼容性、幂等、权限、停止 / Apply 栅栏和故障诊断继续适用；缓存结果不代表任何 Work 已经 ready。
