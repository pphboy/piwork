# Proposal

## Why

首次安装和独立 Desktop 在正常账号登录之外增加了终端链接与浏览器 Access 校验，导致普通地址不能直接使用，浏览器状态丢失后还会重新出现门禁。移除这层独立授权，让用户打开地址即可创建首管理员或正常登录，并在刷新、重启、退出和登录过期后保持同一路径。

## What Changes

- **BREAKING**：移除首次安装的设置证明签发、兑换和校验，以及 `setup link` 命令、终端私密链接和对应恢复提示。空安装打开服务器普通地址即可创建首管理员，成功后关闭创建入口并进入正常登录；保留两次密码确认和原子防重复创建。
- **BREAKING**：移除独立 Desktop 的入口 ticket、独立 Access 状态、`Check browser access`、`Reset browser access` 及相关过期/重新授权界面。普通本机地址可直接使用已有 CLI/Core 登录或正常登录。
- `desktop open` 保留为可选的普通地址打开命令，Linux/Windows 本机控制通道保持原有实例归属和退出语义；旧入口链接按普通地址处理。
- 必要的浏览器会话和 CSRF 自动建立，保留正常登录、CLI/Desktop 凭据共享、Host/Origin 校验及用户/Work 权限，不新增用户需要完成的授权动作。
- 新浏览器、刷新、清 Cookie、进程重启、注销及会话过期均不得重新出现 Access；网络失败显示读取/连接恢复，账号失效回到正常登录。
- 同步直接受影响的测试夹具、双语部署说明和官网材料生成源，重建嵌入资源及宿主程序。文件、Service 和事件流沿用既有账号与会话边界，本变更不重写其业务流程。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `web-onboarding`：首次安装直接创建管理员，移除授权阶段和全部设置链接恢复分支，保留 Admin Quick setup。
- `core-service-startup`：网页首管理员创建不再要求设置证明，保留空用户集合和 operator/env 初始化约束。
- `desktop-webui`：普通地址初始化与登录恢复取消独立 Access；移除重置浏览器访问功能，保留正常注销。
- `control-cli`：Desktop 启动、重新打开和容器访问使用普通地址，不再签发入口 ticket。
- `cli-runtime-portability`：两平台 Desktop 控制通道继续验证本机实例归属，打开结果不再包含浏览器授权票据。
- `docker-delivery`：详细安装材料直接引导访问服务器 IP，不再获取或轮换设置链接；保持根 README 精简与现有发行身份。
- `work-access`：清除要求启动授权与重置浏览器访问的旧条款，保留账号、所有权、来源及内容流撤销边界。
- `serve-ui`：管理区的首次创建入口不再依赖设置授权，普通登录及管理员权限保持。
- `product-release-info`：Desktop 登录页的 About 随普通入口可用，不再要求浏览器 Access。
- `native-runtime-distribution`：发行包的独立 Desktop 入口遵守取消门禁后的登录与恢复契约。

## Impact

主要涉及 `internal/webapp/`、`internal/app/`、`internal/coreoperator/`、`internal/cli/`，两端 WebUI 的引导/会话适配，以及废弃设置证明 DTO 的生成产物。部署材料由既有 `scripts/` 生成入口同步；不增加运行时依赖，不迁移账号或安装数据，不触发发布。

`simplify-readme-and-add-github-badges` 已完成但尚未同步主规格。本变更的 Docker 文档增量基于其有效新要求；后续同步规格时先同步该变更，再同步本变更，不能恢复根 README 的安装长教程。
