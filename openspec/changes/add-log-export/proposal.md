# Proposal

## Why

当前 Core 进程日志没有统一落盘，已有 Service 日志接口只提供有界尾部，容器替换或删除后也不能取得完整保留输出。管理员需要从 CLI 或 DesktopUI 一次收集可授权的保留日志，取得带来源清单的压缩包，用于排查问题，且无需停止 Work。

## What Changes

本次功能范围冻结为现有单 DesktopUI 入口 → Core 收集/归档 → 下载 ZIP → 用户手工发给维护者；CLI 保持既有已规划能力。复用当前日志、任务、权限、脱敏及保存逻辑，只修复 R1–R7 并闭合交付路径，不为未来需求新增通用框架、持久数据模型或后台服务。

- Core 统一管理平台日志：保留 stdout/stderr 输出，同时追加写入数据目录内的结构化日志分片，执行轮转、同步、保留和失败区间记录；二进制与 Docker 部署采用同一机制。
- Agent、Service 使用可通过 Docker Engine API 读取的有界日志保存策略；Core 在容器替换或删除前归档精确实例的保留 stdout/stderr。归档失败仍继续原操作，通过预先保存的来源索引和归档状态持久追踪缺口。
- 新增 Core 日志导出任务：固定截止时间和授权范围，流式收集当前可取得的全部保留日志、合并历史归档、生成 ZIP 和 manifest，报告实际覆盖范围及缺失来源，并管理下载、过期、重启收尾和临时文件清理。
- **日志导出仅允许当前有效管理员**。每份任务属于发起管理员；内容为 Core 全局日志及该管理员自己全部 Work 的保留日志（包括仍保留的已删除 Work 归档），不扩大其他用户 Work 内容的访问权限。普通用户、operator 和 Agent 运行身份不能使用导出入口。
- CLI 新增 `logs export/show/download`，使用用户管理员会话直连 Core；`export` 一次完成接受、观察、下载、校验和本地安全发布，失败可用原导出 ID 恢复查询或下载。
- DesktopUI 仅在管理员账户菜单显示一个 `Export logs` 入口，经 UI 后端转发创建、查询和下载，显示“收集日志 → 生成压缩包 → 下载”及缺口摘要；浏览器不直连 Core、不取得 Core bearer。独立 CLI Desktop 使用相同界面和本机适配。管理员仅用 GUI 即可取得排障 ZIP，再手工发送给可信维护者；本功能没有维护者远程上传接收端，不包含上传协议、接收地址或自动发送。
- 保持既有 Work 快照、Service 有界日志查看、Work 生命周期和三项 Core 启动配置；日志导出不取得冷快照锁、不停止 Work、不调用宿主 Docker CLI，不增加用户运行依赖。

## Capabilities

### New Capabilities

- `log-export`：Core 日志落盘、Docker 全量保留日志读取、导出任务与 API、ZIP/清单、容量、下载和恢复清理契约。

### Modified Capabilities

- `work-access`：增加仅管理员且任务发起者可使用的日志导出授权，保持其他用户 Work 内容隔离和活动流撤销。
- `work-lifecycle`：在全部 Agent/Service 替换、删除及失败清理路径中归档精确实例，记录缺口且保持有界收尾。
- `control-cli`：增加管理员 `logs export/show/download` 命令及进度、JSON、退出码和本地下载恢复契约。
- `desktop-webui`：增加管理员全局导出入口、任务进度、同源下载、缺口提示与原 ID 恢复，覆盖托管和独立 Desktop。

## Impact

- 实现涉及 `internal/app/`、`internal/diagnostics/`、`internal/coreapp/`、`internal/corestore/`、`internal/dockerengine/`、`internal/cli/`、`internal/client/`、`internal/webapp/`；新增日志管理模块归 Core 生命周期管理。
- HTTP/浏览器契约由 `packages/contracts/` 定义，通过现有生成入口同步 `internal/contracts/`。新增三类 `/api/v1/log-exports` 路由及对应 Desktop 显式适配，不复用仅支持单 Work 的 Operation/快照投影。
- `apps/desktop-webui/` 增加入口和流程，构建后的嵌入资源随实现同步；复用已有菜单、进度容器、Button 和基本键盘/焦点规则。
- Core 受管数据目录增加 `logs/` 命名空间，日志正文存文件，紧凑任务/来源索引复用现有 `control_metadata`；需要覆盖现有安装升级和重启，避免无必要的 schema 迁移。
- 验证采用 R1–R7 各自能证明修复的最小回归、相关真实 Docker 生命周期/脱敏、必要权限与撤销测试，以及一次真实 Core + Desktop GUI 从可控 Work 故障到下载、打开 ZIP 核对并原包重下的路径。使用专属安装、可控服务及合成日志，无需真实模型密钥，不影响已有容器/VM。已通过且未受后续修改影响的检查沿用，未测限制如实记录；不按所有部署形态重复完整故障矩阵，不穷举磁盘/网络/超时/重启/过期组合。
- 实现时维护既有双语部署手册、Core-only Compose/单机示例及其生成源，说明日志保留、管理员导出与数据挂载；根 README 不增加使用教程。不执行镜像推送或发布，不改写已发布制品身份。
- 已完成的 `simplify-linux-delivery` 尚未归档同步，其 Linux 双程序、双 HTTP 入口和固定后端链路与现行源码共同作为本变更基线；本变更不恢复主规格中仍残留的旧 operator CLI、独立 Console 或非 Linux 交付。
