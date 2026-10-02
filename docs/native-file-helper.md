# Go 文件 helper

## 平台边界

`piwork-file-helper` 是平台内置的 Go 二进制，保留文件协议版本 1 和 `piwork.file_protocol=1` 镜像标识。它独立于 pi-agentd、用户 Service 和 Pi SDK；Core 使用 Docker Engine API 创建、attach、启动、核验退出及删除每个有持久任务身份的 helper。Core 不读取 Docker 宿主的卷路径。

只允许当前 Work 的 `work-workspace` 卷挂载到 `/workspace`。容器固定用户 `10001:10001`、无网络、只读根文件系统、移除所有 capability、禁止提权、CPU 0.5、内存 128 MiB、PID 32，并使用固定原生入口。Agent 的 `/var/data` 私有卷不允许挂载。镜像静态检查要求原生静态 ELF，拒绝旧 Python/Node 入口及被 whiteout 删除或由符号链接替代的文件。

## 文件操作与发布

文件路径按 UTF-8/XML 安全字符检查，限制单段 255 字节、总长 4096 字节、深度 128。查询和修改通过 workspace 根目录的文件描述符逐段 `openat`，拒绝跟随父目录或叶节点的链接，拒绝读取特殊文件，并在操作前复核被固定的父目录身份。目录枚举最多 10,000 个条目。

PUT 使用同目录临时文件。创建前及创建后分别通知 Core；通知包含路径及十进制字符串形式的 device/inode。上传结束、长度核验和 `fsync` 后，必须获得当前 epoch 的 commit ACK 才可发布。新文件用 `renameat2(RENAME_NOREPLACE)`；替换已有文件使用原子重命名，保留权限但不修改指向旧 inode 的其他硬链接。失败时只清理身份一致的临时文件。

支持 PROPFIND Depth 0/1、GET/HEAD、单段 Range、存在性/日期条件、PUT、MKCOL、COPY、MOVE、DELETE 和精确 CLEANUP。递归操作先检查链接、特殊文件及树限额；提交后的部分失败按原协议返回 ERROR 条目和 207 RESULT。CLEANUP 仅处理 Core 显式登记且 inode 匹配的临时文件，不扫描通配符。

协议帧分为有界 JSON 控制帧和二进制数据帧；拒绝重复 JSON key、非法 UTF-8、不安全整数及方向/长度错误。阻塞管道采用固定非阻塞描述符和 poll；取消、ACK 时限、空闲和总时限不会留下永久阻塞的 I/O。

## 构建与验收

```sh
docker build -f Dockerfile.file-helper.native \
  -t piwork-file-helper:go-migration-acceptance .

CGO_ENABLED=0 go test -mod=readonly \
  ./internal/filehelper ./internal/fileprotocol ./internal/workfiles ./internal/imagestatic

PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE=piwork-file-helper:go-migration-acceptance \
PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:go-migration-acceptance \
CGO_ENABLED=0 go test -mod=readonly -tags=integration ./internal/dockerengine \
  -run '^TestNativeFileHelperEngineAttachAndWorkspaceIsolation$' -v -count=1
```

真实验收用 Agent 镜像的普通空 workspace 目录初始化卷所有权，随后删除初始化容器；文件操作期间没有运行 Agent、Agent RPC 或用户 Service。被测进程的 PATH 中没有宿主工具。测试只清理本次唯一 installation label 的资源。

## Core DAV 入口

Core 启动时配置 `PIWORK_FILE_HELPER_IMAGE`，首次检查捕获不可变镜像 ID。文件请求使用 Work 所有者的 Bearer，访问 `/api/v1/works/<workId>/files/`；`GET /api/v1/file-access` 独立返回冻结能力及限额。未配置 helper 只使文件能力不可用，不影响 Work 和 Service。允许 ready/degraded，停止或尚未核验的 Work 拒绝访问，不隐式启动。

Go Core 已接入流式 DAV HTTP 和持久任务协调。响应保持二进制正文、DAV XML 和安全错误码，GET/HEAD 支持单段 Range/条件请求；OPTIONS 不宣称文件锁或完整 DAV class，PROPPATCH 逐属性拒绝。文件名编码一次，Destination 限同源同 Work，不转发外部地址。Core 接受任务和临时 inode、commit 授权均先持久化，再给 helper ACK。

Stop/delete 接受目标时关闭该 Work 的门禁；Save 保持文件访问，Apply 开始切换时关闭并收尾旧任务。未授权提交的上传取消；已授权提交只允许有界收尾。退出或移除未确认时保留 journal 和占用，仍尝试停止 Agent/Service。Core 重启失效旧 epoch、按精确归属确认退出并清理临时文件，不重放用户修改；未知 create/inode 保持待清理，用户可显式 retry。文件资源只挂 workspace，Service 与 DAV 读写同一数据。

```sh
PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:go-migration-acceptance \
PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE=piwork-file-helper:go-migration-acceptance \
CGO_ENABLED=0 go test -mod=readonly -tags=integration ./internal/coreapp \
  -run '^TestNative(CoreWebDAV|CoreFile|UnconfirmedFileHelper)' -v -count=1
```

执行进程崩溃场景前先运行 `make build-go`。验收分别覆盖完整 HTTP、上传与 Stop/Apply/会话撤销、真实 Go Core 提交前后 SIGKILL、迟到 Engine create、helper 无法停止及与 Service 共享文件。证据见 [go-migration-acceptance.md](go-migration-acceptance.md)。冷快照实际互斥由迁移阶段 9 接通；统一 CLI proxy 和浏览器入口仍由后续 Go CLI/Desktop 阶段验收。
