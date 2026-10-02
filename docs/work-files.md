# Work workspace 文件访问

每个 Work 的文件根是其 `work-workspace` 卷，对应运行中的 pi-agentd 和获准挂载 workspace 的 service 容器内的 `/var/data/workspace`。同一 Work 内这些进程看到相同的 workspace 字节；未获准挂载的 service 没有这份目录。Core 管理 WebDAV 协议、用户授权和临时文件 helper，不依赖 pi-agentd 提供 WebDAV service。其他 Work 的卷、pi-agentd 的私有 `/var/data`、Core 数据目录都不在此根下。

## 启动与连接

Core 所在主机先执行 `make native-helper-images` 构建原生文件镜像，再以 `PIWORK_FILE_HELPER_IMAGE=piwork-file-helper:go-migration-acceptance` 启动 Go Core。`GET /api/v1/file-access` 使用用户 Bearer，返回文件能力及固定限额。镜像缺失时 `available=false`，service 代理仍可用。详细部署和恢复步骤见 [operations.md](operations.md)。

在已登录的 CLI 终端运行：

```sh
piwork-cli work list
piwork-cli proxy
```

`proxy` 默认监听 `127.0.0.1:17890`，同时提供 service HTTP/SSE/WebSocket 代理和 `http://127.0.0.1:17890/works/<workId>/files/`。后者是 WebDAV 服务器 URL，客户端直接连接，无需为它配置 PAC 或额外 HTTP 代理。可用 `--port <1..65535>` 改端口。CLI 启动时仅显示一次用户名 `piwork`、随机临时密码、URL 模板和能力状态；密码只在当前进程内存中，重启即失效。不要将它放进 URL、命令行参数或共享日志。一个 proxy 可访问多个当前用户拥有且正在运行的 Work，Work ID 从 `work list/show` 获取；`/` 和 `/works/` 不列出所有 Work。

通用 rclone WebDAV 配置使用 `type = webdav`、`vendor = other`、上面的 `url`、`user = piwork` 和由 rclone 生成的混淆 `pass`。将配置放在权限为 0600 的临时文件，退出 proxy 后删除。客户端可用 `rclone lsf <remote>:` 浏览，`rclone copy <local> <remote>:` 上传，`rclone copy <remote>: <local>` 下载；`rclone mkdir`、`rclone moveto` 和 `rclone deletefile` 对应本页支持的方法。以客户端实际测试为准；首版验收范围是通用 WebDAV 文件传输，不承诺 Finder/Windows 系统挂载。

例如将临时配置命名为 `work`，URL 填为 `http://127.0.0.1:17890/works/<workId>/files/`，在 `rclone config` 的交互输入中填写 CLI 输出的随机密码，然后执行：

```sh
rclone --config "$PIWORK_RCLONE_CONFIG" lsf work:
rclone --config "$PIWORK_RCLONE_CONFIG" copyto ./note.txt work:note.txt
rclone --config "$PIWORK_RCLONE_CONFIG" cat work:note.txt
rclone --config "$PIWORK_RCLONE_CONFIG" moveto work:note.txt work:renamed.txt
rclone --config "$PIWORK_RCLONE_CONFIG" deletefile work:renamed.txt
```

`PIWORK_RCLONE_CONFIG` 指向仅当前用户可读的配置文件；实际密码只在 rclone 交互配置和当前 proxy 进程内使用。上述命令不需要浏览器 PAC、系统挂载或 LOCK。

直接用 HTTP 客户端时也可访问同一 URL。例如在交互 shell 中将临时密码读入变量并避免写入历史：

```sh
read -rsp 'WebDAV password: ' PIWORK_DAV_PASSWORD
curl --user "piwork:${PIWORK_DAV_PASSWORD}" -X PROPFIND -H 'Depth: 1' 'http://127.0.0.1:17890/works/<workId>/files/'
unset PIWORK_DAV_PASSWORD
```

## 方法与边界

| 方法 | 支持行为 |
|---|---|
| `OPTIONS` | 200 与准确 `Allow`；不宣称 DAV class 1/2/3 |
| `PROPFIND` | `Depth: 0` 或 `1`、空 body/allprop/propname/prop/include；207 按属性分组，未知属性 404；缺省或 infinity 深度 403 |
| `GET`、`HEAD` | 普通文件下载/元数据；目录只允许 HEAD；单段字节 Range 支持 206/416，`If-Range` 存在时返回完整内容 |
| `PUT` | 完整文件上传，新建 201、替换 204；接受 Content-Length 或 chunked，不自动创建父目录 |
| `MKCOL` | 空 body 新建单层目录 201；已有目标 405，父目录缺失 409 |
| `DELETE` | 文件或递归目录删除 204；Depth 缺省或 infinity |
| `COPY` | 同 Work 文件/目录复制，新建 201、覆盖 204；目录 Depth=0 创建空目录，缺省/infinity 递归 |
| `MOVE` | 同 Work 移动/重命名，新建 201、覆盖 204；目录仅支持缺省/infinity Depth |
| `PROPPATCH` | 校验请求后 207，各请求属性 403；不保存自定义属性 |
| `LOCK`、`UNLOCK`、其他方法 | 405，不提供全局文件锁 |

`COPY/MOVE Destination` 可用当前本地 proxy 同源绝对 URL 或完整 `/works/<同一WorkId>/files/...` 路径；目标不能是根、其他 Work、其他主机或含 query/fragment 的地址。`Overwrite` 默认 `T`，`F` 且目标存在返回 412。根不能修改。目录部分失败返回 207，逐项 `href` 可直接用于同一 CLI 本地地址。`Location` 和 DAV `href` 均由 CLI 映射回本地 URL；普通文件 body 原样流式传输。

路径逐段只解码一次，支持中文、空格、`%`、`#` 等文件名；URL 中仍须百分号编码。拒绝点段、非法 UTF-8、链接穿越和特殊文件的直接操作。PROPFIND 可列出 symlink 的类型但不会跟随；隐藏文件按普通文件列出。已有硬链接可读，PUT 原子替换该目录项而不修改其他链接，COPY 产生独立文件。文件新建权限为 0644，目录为 0755，替换保留文件普通权限位；没有 root 权限提升。

支持存在性条件 `If-Match:*`、`If-None-Match:*` 和标准修改时间条件；不返回 ETag，也不提供内容版本锁。来自 agent/service 的直接写入不受 WebDAV 的单 Work writer 槽控制，正在写入的文件不保证一致读取。PUT 提交许可发出后客户端断线，目标可能已完整替换；先重新查询，不要假定回滚或自动重试写入。

## 限额和错误

文件最大 10 GiB，单目录子项和递归任务各最多 10,000，路径最多 128 段/4096 字节，单段最多 255 字节。XML 请求最大 64 KiB/32 层/128 个属性；XML/元数据响应最大 16 MiB。Core/用户/Work 活动 helper 上限为 16/8/4，同 Work 同时仅 1 个文件 mutation；超出立即 429 且 `Retry-After: 1`。无进展 60 秒、单请求总计 30 分钟，授权至少每 2 秒复核。固定数值可从 `GET /api/v1/file-access` 查询。

文件错误为 DAV:error XML，响应头 `X-Piwork-File-Error` 给出固定 code。常见状态：本地密码缺失/错误 401，其他所有者或不存在 Work 404，已授权但 Work 未运行/正在快照/待清理 409，权限或根操作 403，条件不符 412，helper 缺失 503，超时 504，磁盘不足 507。Core 未提供文件能力时 CLI 文件分支返回 501，而现有 service 分支继续工作。会话失效时整个 proxy 退出并返回 CLI 登录退出码 3；普通文件错误或应用自身 401 不会退出 proxy。

文件 helper 每次请求后回收。若 Docker 无法确认退出或暂存 inode 归属，Work 进入待清理状态，阻止新文件写入及导出；恢复 Docker 后按 [operations.md](operations.md) 中的 stop/retry 步骤处理。不要按 `.piwork-file-*` 前缀删除用户文件。

## 导出与备份

WebDAV 下载只覆盖当前 workspace 中可见的文件。数据库、service 私有卷或外部系统状态是否完整可迁移，取决于应用写入的位置和应用自身的备份机制。`.work` 快照包含完整 workspace 卷与现有 Work 快照定义的其他数据；WebDAV 的方法子集不会缩小导出范围。获得一致包的顺序是显式停止 Work、确认文件 helper 已清理、导出、导入、以新 Work ID 显式启动，再访问新的本地 URL：

```sh
piwork-cli work stop <sourceWorkId> --wait
piwork-cli work export <sourceWorkId>
piwork-cli work import <sourceWorkId>.work --wait
piwork-cli work start <newWorkId> --wait
```

导入 Work 保持 stopped，直到显式 start。原 Work 及其文件独立存在。完整流程和包格式见 [work-snapshot.md](work-snapshot.md)。
