# Proposal

## Why

Work 的 workspace 已是 pi-agentd 与获准 service 共享的持久数据源，但用户目前没有通过 Core 直接浏览、上传和修改这些文件的入口。需要在现有 CLI proxy 上提供通用 WebDAV 文件访问，并保证文件操作与 Work 停止、异常恢复及完整 `.work` 导出形成闭环。

## What Changes

- Core 新增所有者认证的 `/api/v1/works/<workId>/files/` WebDAV 文件入口，根映射整个 workspace 卷，即容器内 `/var/data/workspace`；覆盖普通文件、目录和隐藏内容，不限定 `apps/` 或 `data/` 布局。
- 扩展现有 `piwork-cli proxy [--port ...]`，在同一 loopback 监听器提供 `/works/<workId>/files/`，一个进程支持多个自有 Work；保留 service 域名代理、PAC、HTTP/SSE/WebSocket 和应用认证语义。新增本地 WebDAV 临时认证与路径映射，不新增 `work files serve` 命令。
- Core 通过独立受管文件辅助容器访问目标 workspace。辅助容器和可信镜像由平台管理；pi-agentd 不参与请求执行，不新增 agent RPC、agent Skill、用户 service、service 域名或 Work 配置字段。
- 首版提供通用客户端所需的目录查询、流式下载、完整文件上传/覆盖、建目录、同 Work 内复制/移动和删除，明确协议子集、条件请求、特殊文件处理、限额及失败语义。
- 加入路径与跨 Work 隔离、平台/本地/应用认证隔离、上传原子提交、有界并发及失败清理；不把运行中数据库下载宣称为一致性备份。
- 将文件任务及其辅助容器纳入 Core 的停止、配置 apply、删除、退出、恢复和 snapshot 门禁；只有收尾完成才允许停止成功及冷快照。保留既有卷及 `.work` 格式。
- 交付可信文件 helper 镜像、部署说明、rclone 通用 WebDAV 使用说明和真实 Docker 验收，包括上传后重启、export/import 后下载校验及现有 service proxy 回归。

首版边界：仅开放运行且已核验的 Work；只读写当前 workspace 卷。停止/删除后的文件访问、系统磁盘挂载兼容承诺、WebDAV 锁、自定义属性持久化、分块/断点上传及跨修改版本的一致续传、版本历史、回收站、同步、跨 Work 服务端移动/复制、每 service 独立卷、文件 UI、数据布局迁移均不在本次范围内。单段下载 Range 用于通用传输兼容。WebDAV 是文件传输子集，不宣称完整 WebDAV class 1/2/3 兼容。

## Capabilities

### New Capabilities

- `work-file-access`：Core WebDAV 路由、文件操作与条件请求、路径规则、受管文件后端、流式传输、限额和错误契约。

### Modified Capabilities

- `control-cli`：统一 proxy 的本地 WebDAV 路由、能力发现、临时凭据展示、两种流量隔离及版本兼容；为一次性本地凭据展示限定输出规范例外。
- `work-access`：文件内容的所有者权限、持续会话撤销、临时本地认证及受管存储访问边界。
- `work-storage`：WebDAV 与现有消费者共享同卷、上传提交/清理、权限与文件类型边界，保持持久化及导出格式。
- `work-lifecycle`：文件任务准入、有限收尾、辅助容器退出证明、崩溃恢复和 Work 状态切换互斥。
- `work-snapshots`：冷快照必须检查文件任务、暂存和辅助容器，验证 WebDAV 写入经导出/导入保留。

## Impact

- Core：`apps/core/src/application/core-application.ts` 增加 WebDAV 分派；新增 `apps/core/src/work-files/`，接入现有 `work-access`、`work-management/lifecycle.ts` 和 `work-snapshots`。
- CLI/SDK：扩展 `apps/cli/src/service-proxy.ts` 与帮助，新增协议适配模块；在 `packages/client-sdk` 增加文件能力发现和流式 Core 请求，不把文件体送入 JSON API。
- 契约/存储：`packages/contracts` 增加平台文件契约；`packages/core-store` 增加可恢复文件任务记录及门禁。这些运行记录不加入 Work portable metadata。
- Docker：扩展 `packages/runtime-docker` 的受管 helper 与二进制流适配；新增 `apps/file-helper` 和 `Dockerfile.file-helper`。Core 部署配置可信镜像；CLI 无需 Docker 权限。
- 兼容：采用当前独立 workspace 布局的既有 Work 可直接使用；旧 Core/缺少文件 helper 时，CLI 明确标识文件能力不可用，现有 service 代理仍可工作。无需升级 Work 中的 pi-agentd 镜像。
- 文档/验证：更新 README 与运维说明，新增文件访问文档及 Docker+rclone 验收脚本，补充 proxy、生命周期和快照回归。实现前将全部接口、状态、限额及验证固定在 design/specs/tasks。
