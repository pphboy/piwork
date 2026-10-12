# work-file-access 规格变更

## ADDED Requirements

### Requirement: 原生文件 helper 的隔离、提交与恢复

**Identifier:** WF-NATIVE-001

文件 helper SHALL 保留协议 1 与 piwork.file_protocol=1，仅挂当前 Work workspace 至 /workspace，不挂 Agent 私有卷或 Core 数据。固定 10001:10001、无网络、只读根、无 capability、no-new-privileges，资源为 0.5 CPU/128 MiB/32 PIDs。Core 通过 Engine API 逐请求调度，不能读取宿主卷路径。

路径 SHALL 以固定根 fd 逐段安全打开，拒绝跟随父/叶链接及特殊文件；每段 255 字节、总长 4096/深度 128，枚举至多 10000 项。PUT 的临时 inode 及创建通知 SHALL 持久化，长度核验/fsync 后取得当前 epoch commit ACK 才原子发布；替换硬链接目录项不能改其他旧 inode 链接。CLEANUP 只处理明确登记且 device/inode 匹配文件，不按前缀扫描。控制帧/数据帧 SHALL 有界并拒绝重复 JSON key、非法 UTF-8、不安全整数、错误长度和方向，取消及 ACK/空闲/总时限不得永久阻塞。

文件 API SHALL 独立于 Agent，可用于已核验 ready/degraded Work；缺 helper 只降级文件能力。Stop/Delete 关闭准入，Save 保持访问，Apply 切换时收尾旧任务；未知 create、退出或 inode 归属保留 journal/占用，不重放 mutation。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

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

```sh
PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:go-migration-acceptance \
PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE=piwork-file-helper:go-migration-acceptance \
CGO_ENABLED=0 go test -mod=readonly -tags=integration ./internal/coreapp \
  -run '^TestNative(CoreWebDAV|CoreFile|UnconfirmedFileHelper)' -v -count=1
```

### Requirement: DAV 方法、限额与用户连接语义

**Identifier:** WF-DAV-001

Core SHALL 提供 Work workspace 的独立 DAV 入口，CLI proxy 默认 127.0.0.1:17890，并以只显示一次且只存当前进程的随机 piwork Basic 密码提供 /works/<id>/files/；退出失效，不列出全部 Work，不需要 PAC 或系统挂载。文件缺能力返回 501/503 而 Service 继续可用；平台会话失效退出 proxy，普通文件/应用 401 不退出。

DAV SHALL 支持 OPTIONS、PROPFIND Depth 0/1、GET/HEAD、单段 Range、PUT、MKCOL、DELETE、同 Work COPY/MOVE；PROPPATCH 对属性 403，LOCK/UNLOCK 405，不宣称完整 DAV class/ETag/版本锁。COPY/MOVE 目标同源同 Work、不能根/其他主机/query/fragment，Overwrite F 已存在 412。路径只解码一次，symlink 可列类型不跟随、特殊文件拒绝，隐藏文件普通列出；新文件/目录 0644/0755，原子替换保留普通权限且不改其他硬链接。

限额 SHALL 为文件 10 GiB、目录/递归各 10000 项、路径 128 段/4096 字节/段 255、XML 64 KiB/32 层/128 属性、元数据 16 MiB，Core/用户/Work helper 16/8/4，同 Work 一个 mutation，超额 429 和 Retry-After:1。无进展 60 秒、总计 30 分钟、授权两秒复核。提交 ACK 后断线可能已完整替换，先查不自动重试；未知退出/inode 保留待清理并阻止新写入/导出，不按 .piwork-file 前缀删除用户文件。WebDAV 只覆盖 workspace，完整冷包按快照契约处理。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```sh
piwork-cli work list
piwork-cli proxy
```

```sh
rclone --config "$PIWORK_RCLONE_CONFIG" lsf work:
rclone --config "$PIWORK_RCLONE_CONFIG" copyto ./note.txt work:note.txt
rclone --config "$PIWORK_RCLONE_CONFIG" cat work:note.txt
rclone --config "$PIWORK_RCLONE_CONFIG" moveto work:note.txt work:renamed.txt
rclone --config "$PIWORK_RCLONE_CONFIG" deletefile work:renamed.txt
```

```sh
read -rsp 'WebDAV password: ' PIWORK_DAV_PASSWORD
curl --user "piwork:${PIWORK_DAV_PASSWORD}" -X PROPFIND -H 'Depth: 1' 'http://127.0.0.1:17890/works/<workId>/files/'
unset PIWORK_DAV_PASSWORD
```

```sh
piwork-cli work stop <sourceWorkId> --wait
piwork-cli work export <sourceWorkId>
piwork-cli work import <sourceWorkId>.work --wait
piwork-cli work start <newWorkId> --wait
```
