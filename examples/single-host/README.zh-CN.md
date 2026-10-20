# 单机部署示例

[English](README.md) | **简体中文**

Linux x86-64、rootful Docker Engine 28+、Compose 2.24+。默认只运行统一应用容器，网页完成初始化；无需业务环境变量。CLI 使用显式可选 profile。

使用独立目录 `/var/lib/piwork/examples/single-host/core`。先停止端口冲突的安装，不删除它的数据。

当前源码的直接访问流程适用于本次重建程序和后续发行。固定镜像保留发布时的初始化行为，更新源码不会更新镜像；该镜像请查阅[对应版本手册](https://github.com/pphboy/piwork/blob/62f2868cb8e24da3d08db7a7d6c00aabd6226cd4/deploy/docker/README.zh-CN.md)。测试新流程请先[构建当前源码](https://github.com/pphboy/piwork/blob/main/AGENTS.md#构建与验证)。

```sh
docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core
```

直接打开 `http://服务器IP:7171`，创建管理员并确认密码、登录进入 Admin 的 **Quick setup**（`/admin/setup`）后填写或选择模型，点击 **Save and continue** 顺序保存模型及 CoreRuntime。准备页面会自动更新；全部依赖显示 Ready 后，点击 **Open workbench** 进入 Piwork。后续从 **Overview → Quick setup** 返回配置，顶栏 **Workbench** 可返回工作台。Agent 镜像随版本内置、自动使用，不提供手填或高级覆盖。无需额外授权链接。

服务端默认监听 `0.0.0.0:7171`；本机或远程电脑通过实际非回环 IP 打开 `http://服务器IP:7171`。局域网即可使用，无需公网地址。主站放行 TCP 7171，Service 入口另需 TCP 17891–17954（可用 `--service-ports` 修改）；7172 是内部 Agent RPC，不向浏览器开放。端口由 Piwork 代理，不是用户容器直出。只开放主站时工作台仍可使用，Service 入口会不可达。无需域名、DNS 或本机代理。HTTP 不加密；不可信网络请显式配置 HTTPS，并同时放行/代理主站与全部 Service 端口。

Service 支持响应 Cookie 的服务端登录、Basic/Bearer、HTTP、SSE 和 WebSocket。响应 Cookie 按浏览器会话及 Service 保存在服务器，Secure Cookie 仅通过 HTTPS 入口发送。依赖 document.cookie/Cookie Store 读写（如脚本读取 CSRF Cookie）的应用不保证透明兼容；脚本写入浏览器 Cookie 也不保证同 IP 跨 Service 隔离，且不会转发上游。不支持硬编码 .work URL、跨站 SSO 或上游 HTTPS 的透明适配。应用 CSP/X-Frame-Options 保留；禁止嵌入时使用新标签页。

可选 CLI：待 Core 完整就绪后运行；其独立卷保留登录凭证。退出 CLI 不停止 Work。

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
