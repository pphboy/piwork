# 单机部署示例

[English](README.md) | **简体中文**

Linux x86-64、rootful Docker Engine 28+、Compose 2.24+。默认只运行统一应用容器，网页完成初始化；无需业务环境变量。客户端使用 Linux 原生 CLI。

使用独立目录 `/var/lib/piwork/examples/single-host/core`。先停止端口冲突的安装，不删除它的数据。

本版固定镜像包含直接访问与网页配置流程。

```sh
docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core
```

直接打开 `http://服务器IP:17891`，创建管理员并确认密码、登录进入 Admin 的 **Quick setup**（`/admin/setup`）后填写或选择模型，点击 **Save and continue** 顺序保存模型及 CoreRuntime。准备页面会自动更新；全部依赖显示 Ready 后，点击 **Open workbench** 进入 Piwork。后续从 **Overview → Quick setup** 返回配置，顶栏 **Workbench** 可返回工作台。Agent 镜像随版本内置、自动使用，不提供手填或高级覆盖。无需额外授权链接。

同一进程提供两个 HTTP 服务：UI 默认 `0.0.0.0:17891`，Core 默认 `0.0.0.0:17871`。浏览器只连接 UI，所有文件、事件及 `/services/<workId>/<serviceId>/<port>/` 使用同一入口；后端固定通过 loopback HTTP 连接 Core。外部 Linux CLI 直接连接服务器 Core 端口。仅使用 --ui-port/--core-port 改端口。UI 接受本机实际 IPv4、localhost、回环和主机名，校验 Host、Origin 与 CSRF，不信任 Forwarded；切换地址需独立登录。只提供 HTTP，不提供 HTTPS、域名或反向代理配置。内部 Agent 保留容器可达的 7172 mTLS 回连。用户 Service 不发布宿主端口，模型端点须从 Work 网络可达。

托管 Service 与工作台同源，须视为可信应用；其脚本可使用当前用户的 UI 权限。应用须支持动态 Service URL 前缀；旧根路径应用不会自动改写源码、镜像或包。Service 支持响应 Cookie 的服务端登录、Basic/Bearer、HTTP、SSE 和 WebSocket。响应 Cookie 按浏览器会话及 Service 保存在服务器，HTTP 入口不转发 Secure Cookie。依赖 document.cookie/Cookie Store 读写（如脚本读取 CSRF Cookie）的应用不保证透明兼容；脚本写入浏览器 Cookie 也不保证同 IP 跨 Service 隔离，且不会转发上游。不支持硬编码 .work URL、跨站 SSO 或上游 HTTPS 的透明适配。应用 CSP/X-Frame-Options 保留；禁止嵌入时使用新标签页。

可选 Linux 原生客户端连接已有 Core，退出客户端不影响 Core 或 Work：

```sh
piwork-cli --core http://SERVER_IP:17871 desktop --port 17901
```

```sh
docker compose -f docker-compose.yml stop core
docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core
```

正常关闭保留用户、模型、Work ID、历史及卷。不要使用 down -v 或全局 prune。详见 [安装手册](../../deploy/docker/README.zh-CN.md#terminal-operations)。
