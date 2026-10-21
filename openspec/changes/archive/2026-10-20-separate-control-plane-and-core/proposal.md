# Proposal

## Why

当前统一程序把网页 handler 包装在 Core listener 上，并通过进程内 transport 和直接对象调用访问 Core；一键启动因此混合了部署组合与领域边界。需要在保留一个二进制、一个进程、一条启动命令的前提下，明确浏览器、原生客户端与 Core 的调用关系，并让远程 Service 与工作台共用浏览器端口。

## What Changes

- **BREAKING**：ControlPlane 默认使用 `17891`，承载工作台、Admin、首次引导、文件/事件流与 Service Proxy；Core 保留独立 HTTP 服务，端口改为 `17871`，供 ControlPlane 后端、用户 CLI 和 operator 调用。浏览器产品流程只访问 ControlPlane。
- 一个启动协调器在同一进程创建两个独立 listener，统一处理启动失败与关闭。ControlPlane 仅通过 HTTP 客户端访问 Core，移除生产路径中的 Core 对象/handler 注入、直接存储访问和进程内 transport；不引入 `core.sock`。
- 复用现有用户、管理员、operator、Service resolve/gateway API。将当前网页初始化与会话观察的直接调用改为 HTTP 契约；首次创建继续由 Core 原子执行，网页不恢复 Access、终端授权链接或 operator 登录。
- **BREAKING**：托管 Service 使用 `http://SERVER_IP:17891/services/<workId>/<serviceId>/<port>/`。ControlPlane 复用 Desktop Service Proxy，Core 继续授权并解析当前容器；移除托管 Service 端口池、跨端口入口交换及旧地址回退。
- **BREAKING**：托管 Service 与工作台同源，作为当前用户信任的应用；不再承诺浏览器来源隔离。保留 Core 所有者校验和服务端响应 Cookie 分区，明确脚本 Cookie 与任意根路径应用不在透明兼容范围。
- 适配官方 NiceGUI base、模板、页面资源与运行时反馈，使其支持动态 Service 前缀；更新当前脑包指导。已有 Work 的源码、镜像和 `.work` 包字节不自动迁移，导入后按目标身份生成新入口。
- 保留独立 CLI、CLI proxy 与本机 Desktop 的既有用途；更新默认 Core 地址，不把 CLI 改为通过 ControlPlane 调用。独立客户端的显式地址、凭据绑定与 Desktop 偏好优先级保持。
- 同步当前部署材料、探针、镜像构建与官网生成源，使用通配监听和实际局域网 IP 验收；本变更不自动发布镜像、网站或 Release。

## Capabilities

### New Capabilities

无；使用现有能力定义边界，避免另建重复 Service 或用户 API。

### Modified Capabilities

- `core-service-startup`：双 listener、同进程启动与关闭、Core 独立领域及 HTTP 初始化适配。
- `serve-ui`：ControlPlane 独立 HTTP 入口、浏览器会话及真实 Core 网络错误处理。
- `serve-control-plane`：operator 直连 Core 的地址，以及仅限首次创建的内部委托边界。
- `control-cli`：Core 默认地址调整为 `17871`，保留原生客户端直连与地址优先级。
- `browser-service-access`：托管同端口路径入口、同源信任、前缀转发、会话与旧入口移除。
- `desktop-webui`：托管工作台所有浏览器请求使用 ControlPlane，Service 链接与入口恢复采用路径语义。
- `native-runtime-distribution`：一个进程交付两个服务，嵌入 UI 与托管 Service 边界保持一致。
- `web-development-base`：官方应用在动态 Service 前缀下完整运行，保留内部根路径协议。
- `portable-work`：导入后重新生成路径入口，保留包格式、源码及固定镜像，明确旧应用适配边界。
- `docker-delivery`：双端口职责、无 Service 端口池、内部 Agent 回连与材料/验收同步。

## Impact

- Go：`internal/app`、`coreapp`、`webapp`、`client`、`cli`、`consoleapp`、`coreoperator` 及对应测试；协议字段有变动时同步 `packages/contracts` 与生成产物。
- UI：两套 WebUI 的入口、Service URL/错误恢复及嵌入资源；不扩展为视觉重设计。
- 应用交付：`deploy/images/web-base/`、`internal/coreassets/piwork-brain/` 的模板/指导、相关镜像与真实 Service 验证。
- 材料：根 Dockerfile、`deploy/docker/`、`examples/single-host/`、构建/检查/官网生成脚本和当前架构说明。详细部署材料同步端口；README 保持现有精简入口，不重新添加长教程。
- 保留：Core 数据与权限、Work 生命周期、Service 逻辑域名、内部 `.piwork` mTLS 身份、Agent RPC、`.work` V1 格式。改变的是服务边界和浏览器入口，不是容器内业务协议。
