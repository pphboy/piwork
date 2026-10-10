# 单机部署示例

[English](README.md) | **简体中文**

**本地候选：镜像尚未推送。**

在一台 Linux 主机上用 Compose 运行 Core 和 CLI 两个独立容器。默认独立使用见 [Quick Start](../../README.zh-CN.md#quick-start)。Core 是后台服务；CLI 是终端客户端，退出或重新打开 CLI 都不影响 Core 和任务。

要求 Linux x86-64、rootful Docker Engine 28+、Compose 2.24+。宿主已导出 `PIWORK_ADMIN_ACCOUNT`、`PIWORK_ADMIN_PASSWORD`（至少 12 位）、`PIWORK_MODEL_PROVIDER`、`PIWORK_MODEL`、`PIWORK_API_KEY`；可选 `PIWORK_MODEL_BASE_URL` 不用时保持未设置。初始化变量只传给 Core。

示例使用独立的 `/var/lib/piwork/examples/single-host/core` 和 `piwork-single-host-client-state` 卷，保留原有权限检查。7171/7172 不能与其他 Core 同时占用；运行前正常停止冲突服务，不删除其数据。本示例不会自动停止其他安装。

取得本目录的 `docker-compose.yml`，在文件所在目录运行；无需 clone、环境文件或第二份 YAML。先启动 Core：

```sh
docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core
```

打开 CLI；以后重新进入只需这一条命令，无需初始化变量。Core 不存在或未就绪时，CLI 等待至多 600 秒后安全失败，不自动启动 Core：

```sh
docker compose -f docker-compose.yml run --rm --no-deps cli
```

在 CLI 容器内执行；ACCOUNT 为账号，登录隐藏输入密码，WORK_ID 来自创建结果：

```sh
piwork-cli login --account ACCOUNT
piwork-cli work create --name 'My Work' --wait
```

```sh
piwork-cli chat WORK_ID --message 'Hello, Piwork!'
```

用 `exit` 退出；凭证保留，Work 继续运行。查看状态、日志和停止/重启 Core（正常停止会停止受管 Work，重启按原意图恢复）：

```sh
docker compose -f docker-compose.yml exec -T core piwork-serve --json status
docker compose -f docker-compose.yml logs --tail 100 core
docker compose -f docker-compose.yml stop core
docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core
```

核对 Core 正常退出成功，保留数据目录、客户端卷和 Work 卷；不使用 `down -v` 或全局 prune。观察中断按原 Operation/Run ID 恢复，不重复提交。更多操作见 [Docker 手册](../../deploy/docker/README.zh-CN.md#terminal-operations)。

维护：镜像版本、环境、网络、存储或就绪/关闭规则变更时，同步模板、双语说明及引用文档，并执行 Docker Quick Start 检查。
