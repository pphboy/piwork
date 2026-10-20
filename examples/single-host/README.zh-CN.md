# 单机部署示例

[English](README.md) | **简体中文**

Linux x86-64、rootful Docker Engine 28+、Compose 2.24+。默认只运行统一应用容器，网页完成初始化；无需业务环境变量。CLI 使用显式可选 profile。

使用独立目录 `/var/lib/piwork/examples/single-host/core`。先停止端口冲突的安装，不删除它的数据。

本版固定镜像包含直接访问与网页配置流程。

```sh
docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core
```

直接打开 `http://服务器IP:17891`，创建管理员并确认密码、登录进入 Admin 的 **Quick setup**（`/admin/setup`）后填写或选择模型，点击 **Save and continue** 顺序保存模型及 CoreRuntime。准备页面会自动更新；全部依赖显示 Ready 后，点击 **Open workbench** 进入 Piwork。后续从 **Overview → Quick setup** 返回配置，顶栏 **Workbench** 可返回工作台。Agent 镜像随版本内置、自动使用，不提供手填或高级覆盖。无需额外授权链接。

一键启动在同一进程运行两个独立 HTTP 服务：ControlPlane 默认 `0.0.0.0:17891`，Core 默认 `127.0.0.1:17871`。浏览器通过实际局域网 IP 的 17891 使用全部 UI、文件、事件及 `/services/<workId>/<serviceId>/<port>/`，无需域名或额外 Service 端口。后端与 CLI/operator 直连 Core；远程或 bridge CLI 需显式配置 `--core-listen 0.0.0.0:17871`（或可达网卡）并放行相应网络，不能把 loopback 当成容器可达。7172 保留为容器可达的内部 Agent mTLS RPC，不是浏览器入口。用户 Service 不发布宿主端口。HTTPS 反向代理须转发同一 origin 的全部路径、SSE 与 WebSocket；Core TLS 如有需要由受信终止入口提供。

托管 Service 与工作台同源，须视为可信应用；其脚本可使用当前用户的 UI 权限。应用须支持动态 Service URL 前缀；旧根路径应用不会自动改写源码、镜像或包。Service 支持响应 Cookie 的服务端登录、Basic/Bearer、HTTP、SSE 和 WebSocket。响应 Cookie 按浏览器会话及 Service 保存在服务器，Secure Cookie 仅通过 HTTPS 入口发送。依赖 document.cookie/Cookie Store 读写（如脚本读取 CSRF Cookie）的应用不保证透明兼容；脚本写入浏览器 Cookie 也不保证同 IP 跨 Service 隔离，且不会转发上游。不支持硬编码 .work URL、跨站 SSO 或上游 HTTPS 的透明适配。应用 CSP/X-Frame-Options 保留；禁止嵌入时使用新标签页。

本例为可选 bridge CLI 显式监听 Core `0.0.0.0:17871`；按需限制可达网络。可选 CLI：待 Core 完整就绪后运行；其独立卷保留登录凭证。退出 CLI 不停止 Work。

```sh
docker compose -f docker-compose.yml run --rm --no-deps cli
```

```sh
piwork-cli login --account ACCOUNT
piwork-cli work create --name 'My Work' --wait
```

```sh
piwork-cli chat WORK_ID --message 'Hello, Piwork!'
```

```sh
docker compose -f docker-compose.yml stop core
docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core
```

正常关闭保留用户、模型、Work ID、历史及卷。不要使用 down -v 或全局 prune。详见 [安装手册](../../deploy/docker/README.zh-CN.md#terminal-operations)。
