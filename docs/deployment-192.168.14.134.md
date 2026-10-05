# 192.168.14.134 部署记录

部署日期：2026-10-05。服务器为 Fedora 43，部署版本为 `590f86d35331201d7471763d2a9821c92a9d3032`。连接和传输分别使用 Windows 的 `/mnt/c/Windows/System32/OpenSSH/ssh.exe` 和 `scp.exe`。

## 访问地址

| 用途 | 地址 | 使用方式 |
| --- | --- | --- |
| 当前 WSL Desktop 切换 Core | `http://127.0.0.1:17171` | 已建立 Windows SSH 隧道，在 Desktop 的 Core 地址中填写此值，然后使用 `.env.test` 的账号和密码登录 |
| Fedora CLI Desktop | `https://192.168.14.134:17892/` | 可从能访问服务器网段的其他电脑直接打开；首次打开需要下面命令生成的启动链接，并信任服务器证书 |
| 局域网 Core | `https://192.168.14.134:8443` | 供能够直连服务器的客户端使用，客户端需信任服务器自签证书 |
| 管理面板 | `https://192.168.14.134:7173/login` | 浏览器访问，使用 `.env.test` 的管理员账号和密码登录；首次访问需信任自签证书 |

当前 WSL 无法直接访问服务器网段，Windows 能够访问。隧道把本机 `127.0.0.1:17171` 转发至服务器的 `127.0.0.1:7171`，网络传输使用 SSH 加密。

隧道运行于当前 Windows 用户会话。重启 Windows 或隧道退出后，可在 WSL 运行以下命令，并保持该终端运行：

```bash
/mnt/c/Windows/System32/OpenSSH/ssh.exe -N -T \
  -L 127.0.0.1:17171:127.0.0.1:7171 \
  -o BatchMode=yes -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  root@192.168.14.134
```

服务器证书位于 `/etc/pki/tls/certs/piwork.crt`；本机副本位于 `dist/deploy/192.168.14.134-590f86d35331/piwork-server.crt`。SHA256 指纹为：

```text
10:E9:98:53:23:66:A5:7D:C4:9F:3A:B3:60:16:22:29:CD:E9:F9:3F:F9:BC:FC:2A:E3:EF:42:38:A6:14:C6:14
```

## Fedora CLI 与 Desktop

服务器的 `piwork-cli` 已使用 `.env.test` 的管理员账号 `admin` 登录 `http://127.0.0.1:7171/`。凭据保存在 `/root/.config/piwork/client.json`，文件权限为 `0600`，父目录为 `0700`。

`piwork-desktop.service` 使用此凭据运行 CLI Desktop，监听服务器的 `127.0.0.1:17893`，已设置开机启动。nginx 在 `0.0.0.0:17892` 提供 HTTPS 入口，并转发至 CLI。防火墙已永久放行 `17892/tcp`，浏览器访问 Desktop 无需 SSH 隧道。

入口配置为 `/etc/nginx/piwork-desktop.conf`，由现有的 `piwork-https.service` 管理。配置校验外部 Host 和 Origin，然后转换为 CLI 要求的本机来源；浏览器会话使用原有 Secure、HttpOnly Cookie，API 保留 CSRF 校验。

生成新的浏览器启动链接：

```bash
/mnt/c/Windows/System32/OpenSSH/ssh.exe -T -o BatchMode=yes root@192.168.14.134 \
  'piwork-desktop-open'
```

输出的 `https://192.168.14.134:17892/#ticket=...` 链接为单次使用，五分钟内有效。浏览器完成授权后会使用自己的会话，重新打开已有会话可使用不带 ticket 的地址。Core 登录失效时，可在 Desktop 中用 `.env.test` 的管理员账号和密码重新登录。

外部入口已验证 Desktop 登录和 Works 页面。当前 CLI 为 Service 应用生成的预览地址仍是 `.desktop.localhost`，应用预览与独立应用标签页需要额外的远程 Service origin 支持。

在 Fedora 上检查 CLI 登录状态：

```bash
PIWORK_CONFIG_PATH=/root/.config/piwork/client.json \
  piwork-cli --core http://127.0.0.1:7171 whoami
```

## 程序、数据与环境变量

- 宿主程序：`/opt/piwork/releases/590f86d35331/bin/`，当前版本链接为 `/opt/piwork/current`，命令入口位于 `/usr/local/bin/`。
- Core 数据目录：`/var/lib/piwork/core`；Console 数据目录：`/var/lib/piwork/console`。
- 完整运行配置：`/opt/piwork/.env.test`，Core 服务使用 `--env-file` 读取此文件。
- `.env.test` 原始逐字节备份：`/etc/piwork/env.test.original`。

两份环境文件均为 root 所有、权限 `0600`。运行配置保留原账号、密码、模型、API Key 与各测试环境变量；将数据目录和 CLI 凭证路径改为服务器路径，将 Agent 和 Package helper 镜像改为 `piwork-agentd:server-590f86d35331`，并补充本机 Docker socket 与独立 Docker 配置目录。模型为 `anthropic / deepseek-flash`，入口为 `https://api.deepseek.com/anthropic`。

原始环境文件的 SHA256 与本机 `.env.test` 一致：

```text
164546c8715b2321b31d81ad082086e5e87d29e343077e763b9ab67f630b60e0
```

服务由 systemd 管理，均已设置开机启动：

```bash
systemctl status piwork-core piwork-console piwork-https piwork-desktop
systemctl restart piwork-core piwork-console piwork-https piwork-desktop
journalctl -u piwork-core -u piwork-console -u piwork-https -u piwork-desktop -n 100
piwork-serve --core http://127.0.0.1:7171 --data-dir /var/lib/piwork/core status
```

## 端口与平台配置

`FedoraServer` 防火墙区域已在运行配置和永久配置中开放 `8443/tcp`、`7173/tcp`、`17892/tcp`。Core HTTP API 监听服务器 loopback 的 `7171`；容器控制接口使用 `7172`，Docker 网桥由 `docker` 区域放行。HTTPS 网关配置位于 `/etc/nginx/piwork.conf`，支持流式请求、响应和 WebSocket。Desktop 外部端口 `17892` 已设置 SELinux 的 `http_port_t` 持久标签，CLI 内部端口 `17893` 仅监听 loopback。

服务器 Docker 29 的 containerd 镜像存储返回的镜像身份未通过当前 piwork 的静态检查。本次使用经典 `overlay2` 镜像存储，并保留 DNS 和镜像源设置。原 Docker 配置备份为 `/etc/docker/daemon.json.piwork-backup-590f86d35331`，原有 `alpine:latest` 已导出并重新载入。存储后端切换的行为见 [Docker 官方文档](https://docs.docker.com/engine/storage/containerd/)。

SELinux 保持 Enforcing。Core 数据目录设置持久 `container_file_t` 标签，HTTPS 网关启用 `httpd_can_network_connect`。Core 服务使用 `UMask=0022`，使程序显式创建的 `0644` 容器包源文件可读取；凭据及 Core 私有目录由程序分别以 `0600`、`0700` 管理。

## 验证结果

已通过真实服务器验证：Core health/readiness、管理员登录、默认内置包与 Agent 启动、文件读写、Service 启动及 HTTP 网关、DeepSeek 实际回复、Work 停止及重新启动后的文件持久化、验收 Work 删除、验收会话登出。局域网 HTTPS Core 和管理面板使用服务器证书校验后均返回 HTTP 200，防火墙运行及永久规则均已核验。

本机验证记录位于 `dist/deploy/192.168.14.134-590f86d35331/verification.json`，其中没有登录 token、密码或 API Key。

Fedora CLI Desktop 的外部入口已通过 Windows Chrome 直接连接服务器验证：启动链接授权成功，Works 页面显示 `admin` 已登录。Windows curl 使用服务器证书校验返回 HTTP 200，防火墙运行和永久配置均确认放行。记录位于 `public-desktop-verification.json`。此前 SSH 隧道验证记录为 `desktop-verification.json`。

## SELinux 冷快照兼容验收

变更为 `fix-selinux-snapshot-compatibility`，实施与验收方法见 [验收说明](selinux-snapshot-acceptance.md)。SELinux 保持 Enforcing；此次不修改 helper 挂载或运行权限。精确允许属性名称 `security.selinux`，树处理不读写或迁移标签值，其他 xattr／ACL／capability 继续拒绝。Docker 在启动时可能将 named volume 的私有 MCS 标签规范化为共享 `s0`，此行为归宿主挂载策略；用户已确认按常规受管卷兼容完成验收。

本次直接树库测试已在不同有效源／目标 MCS 下通过卷、空卷、Skill、制品四类用例，源标签不变、目标根标签保留、新对象采用目标创建策略，标签值变化不影响树摘要。真实 helper 的完整树、空卷、目标用户属性保护、非空根保护，以及用户属性、access/default ACL、capability 四类实物拒绝共八项全部通过，测试卷／容器已精确清理。

Core 的真实用户属性失败验收已通过：`operation-9bf9d89a0741b707ec6482a8a720518b` 以 `SNAPSHOT_STORAGE_UNSUPPORTED` 失败，journal 为 cleaned，快照锁和未清理制品为零，源字节、属性值与 POSIX 元数据不变；测试驱动仅移除自己添加的属性后，`operation-f7ae27f7c4caa04b0ea53cc8b30584f0` 使用新 key 导出成功。独立安装身份为 `piwork-test-bdf07290-9af0-437c-8b7c-c2014f257a69`。失败包的 expired 记录按既有 GC 规则保留，无成功包或残留包文件。

专用平台证据存放于服务器 `/opt/piwork/acceptance/selinux-590f86d35331/`，本机副本位于 `dist/deploy/192.168.14.134-590f86d35331/selinux-acceptance/`。已执行证据包括 `platform.json`、`tree-selinux.log`、`helper-selinux.json`、`docker-label-observation.json`、`core-attribute.log`、`tree-wal.log/json`、`core-mapping.log/json` 与 `verification-summary.json`。`core-snapshot-complete.log` 包含指定完整导出／导入用例的通过段及其他用例的早期失败，不能将整个旧日志记为通过。全部规格场景的对应证据见验收说明。

两项指定 Core 用例均已在 Fedora Enforcing 实际执行通过：完整 stopped Work 导出／下载／导入为 132.24s，离线 context／服务／制品搬迁及再次导出／导入为 508.84s。后者 source 安装身份为 `piwork-test-6b8aadb3-a52b-4c94-a46f-56147c57b896`，target 为 `piwork-test-0830c210-cf9c-4de0-9f67-bd15956fc4e3`，导出包摘要 `ffa4f7f8e5c10dba902fa6b236546293ab076d91f8735358edbd4c423eb66ff1`。首次目标 `work-71d29e4e-f803-401f-a1ac-698a20a37280` 与再次导入目标 `work-0428a958-315d-43b6-8eea-ddf6d7f1ebb8` 使用独立卷及身份，每次先验证 stopped；再次导入在显式 Start 前无 Agent／Service 容器，Start 后文件、服务共享计数和原有／新增 Session 历史一致，随后 Stop。真实 WAL 的字节、已提交记录和两份恢复修改隔离另有本机与 Fedora 的通过证据。

独立配套回退已通过（`rollback.json`，安装身份 `piwork-test-0ea28c0b-78a4-4996-adb5-d343ec28d0f2`）。先使用修复版本正常重启，让既有 tombstone service 的收尾完成，再比较版本切换，避免把普通生命周期清理混入回退差异。旧 Core SHA-256 为 `e49101436ebc98e2dbfe8f174b68abc78b2a297792afef659916c8fced0cec88`，旧 helper 镜像 ID 为 `sha256:f2ccc8e7130e910bcd407091ec7a91763a5c0ac5a4607f096125c51d4761b9b2`。旧配套启动后，已导入 stopped Work、两个卷、原包、文件摘要和 14 条导入历史完整保留；`operation-407009917bea3dc046ee7f5ef50ed5f2` 导出以 `SNAPSHOT_STORAGE_UNSUPPORTED` 失败，gate 已收尾，原数据不变。恢复修复配套后，`operation-2eb2575d43e7173c4f439a69e5175dc3` 导出成功。测试资源按安装标签精确清理，未在生产安装执行旧版本回退。

正式配套发布已完成。构建基线为 `590f86d35331201d7471763d2a9821c92a9d3032` 加本次未提交修复，Go 为 1.25.5；唯一产品代码差异是树库属性名称检查，补充代码均为验收或测试。发布身份记录在 `release-identity.json`：

| 制品 | 实际身份 |
| --- | --- |
| Core 二进制 | SHA-256 `5c4a99b1df9b06f2cdc1421e27f77e539658bf2310fb0a7b9a4b87666900f7b5`；发布后实际运行 PID 为 `151683`，已核对 `/proc/<pid>/exe` |
| snapshot helper 二进制 | SHA-256 `ad47ad8b705df67d73dbc93fc7bccabe7b159f5d0cdf59808515e1494a0362ad` |
| snapshot helper 镜像 | `piwork-snapshot-helper:server-590f86d35331-selinux-verified`；ID `sha256:f825c154f76ae096f717538e72cde1428a7545a6c5c873e7de31cc06aa4c3d6e` |
| 产品源码差异 | SHA-256 `a15bcc79ce50bc01ed2e8310cdcb000bc14e042b7eb942075bb390ebaf23d46b`，为相对构建基线的 `capture_linux.go` diff |

发布切换前后 snapshot job、锁、transfer 和未清理活动 artifact 均为零，实际进程身份、health/ready 与既有 Work 配置和期望状态通过检查。生产专用 source 的导出为 `operation-b872720b01b7a559c669e77a2c96c61b`，独立 stopped 导入为 `operation-a460f47f40e7c45d24d870fb82ec33e1`；两卷使用宿主有效 `container_file_t:s0` 标签。另一个导入 `operation-c25209fe707ba820b32d86a1c98c724f` 在 Start 前保持 stopped 且无运行容器，显式启动后读回专用二进制 fixture 的全部原字节，再 Stop。

此次发布 smoke 的首次驱动把 Delete 后卷保留误判为失败；原始记录保留为 `deployment-verification-initial.json`。产品 Delete 按既有契约保留卷登记与持久数据。随后按精确安装／Work 标签及零引用核验，显式移除三个专用验收 Work 的六个物理 fixture 卷，未写数据库伪造 purged 状态；相应留存记录和 Operation 作为验收历史保留。最终 `deployment-verification.json` 为 passed。`fixture-resource-audit.json` 另核对本轮 16 个专用测试安装身份，容器、卷和网络残留均为零。原用户 `Kanban Fedora` 仍为 running/ready，四个 systemd 服务均 active/enabled，Enforcing 保持，Windows curl 使用服务器证书校验后 Core health/ready、Console 与 Desktop 外部入口全部为 HTTP 200；`8443`、`7173`、`17892` 防火墙运行与永久规则均为 yes。

本次正式备份目录为 `/opt/piwork/deployment/selinux-590f86d35331-verified/`，root 所有、`0700`；`piwork-serve.before-verification` 为 `0555`，SHA-256 与本次 Core 相同，因为此前热修已采用相同产品代码。`env.test.before-verification` 为 `0600`，SHA-256 `33b6694fa32e49004478177fd05df99e2a4012bc9d3338568bc83a5934680933`。本次运行环境与该备份仅 `PIWORK_SNAPSHOT_HELPER_IMAGE` 不同，管理员、模型与其他变量保持。备份清单、发布结果与最终健康检查分别为目录中的 `backups.json`、`deployment-verification.json`、`post-deployment-health.json`；外部证书验证为本机 `post-deployment-public.json`。

如需回到发布前热修配套，等待 snapshot gate 收尾后停止 Core，以该目录的二进制和环境备份复原配套，再启动核对健康状态。如需回到未修复版本，使用 `/opt/piwork/current/bin/piwork-serve.before-selinux-fix`，仅将当前运行配置的 snapshot helper 恢复为已核验旧镜像 ID 对应的 `piwork-snapshot-helper:go-migration-acceptance`；原环境备份 `/etc/piwork/env.test.before-selinux-fix` 保留供核对。两种回退均不删除已导入 Work、卷、包或 Operation，不重导入覆盖已有资源，也不清除标签。恢复修复版本使用验收目录的配套 Core 与 verified helper。未修复配套的标签拒绝已在上述独立安装实际验证。
