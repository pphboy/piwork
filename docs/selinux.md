# SELinux 宿主上的 Core

本页说明 Core 与原生 helper 在启用 SELinux 的 Linux 宿主上的运行条件。安装地址、连接方式、服务管理器、HTTPS 入口和模型配置由部署环境决定；Core 启动与初始化流程见 [运维说明](operations.md)。CLI 部署在用户机器，Core 宿主不需要安装 CLI 或运行 Desktop。

## 配套版本

部署包含 SELinux 快照兼容修复的 Core 与 snapshot helper，并核对各自版本和不可变镜像身份。树采集和恢复仅允许精确名称 `security.selinux`，不读取、写入或迁移标签值；目标对象的标签由目标宿主策略决定。

其他扩展属性、POSIX ACL、文件 capability 和无法完整枚举的属性继续拒绝。兼容修复不改变 `.work` V1 格式、文件内容、UID/GID、权限、时间或链接表示。

## 宿主目录授权

保持 SELinux Enforcing。Core 创建的包源和 snapshot spool 会由正常 helper bind mount 访问，其宿主目录需要适合容器访问的持久标签。先按 Core 进程的 owner 创建专用数据目录。以下示例仅配置该目录的标签，路径由部署者提供：

```bash
export PIWORK_DATA_DIR=/var/lib/piwork/core
getenforce
sudo semanage fcontext -a -t container_file_t "${PIWORK_DATA_DIR}(/.*)?"
sudo restorecon -RFv "$PIWORK_DATA_DIR"
ls -Zd "$PIWORK_DATA_DIR"
```

若同一表达式已经有受管规则，使用 `semanage fcontext -m` 更新该规则。`semanage` 和 `restorecon` 仅用于宿主部署管理，不是 Core 运行时调用的工具。不要将这条规则应用到其他应用的目录或整个 Docker 存储目录。

SELinux 标签与 Unix 权限分别授权。Core 私有目录仍为 `0700`，凭据仍为 `0600`；部署进程的 umask 应允许程序显式创建的 `0644` 容器包源文件保留读取权限，例如 `0022`。若出现拒绝，分别检查标签、owner、目录遍历权限和文件权限，再按宿主策略解决。

## 数据卷和快照

Docker 正常挂载 named volume 时可能按宿主策略规范化卷标签。树库保证不操作标签值；它不保证 Docker 挂载前后的私有 MCS 原值保持不变。验收时应分别记录挂载阶段与树处理阶段的标签。

导出先停止 Work，导入得到 stopped Work，再显式启动。目标卷采用目标宿主自己的标签策略，不复制来源宿主的授权标签。遇到其他未支持属性时整体失败，保留来源内容，并按已有 journal 规则收尾。

## 验证和升级

部署后核对 Core 的 `/healthz`、`/readyz`、运行二进制摘要、固定 helper 镜像身份和 Enforcing 状态。在专用测试 Work 中验证文件读写、停止、导出、导入、再次导出与再次导入；导入后先确认 stopped，再显式启动核对持久数据。完整流程和属性拒绝测试见 [SELinux 快照验收](selinux-snapshot-acceptance.md)。

升级前等待快照任务和清理 gate 收尾，备份 Core 数据目录、相关受管卷及私有运行配置，然后配套切换 Core 与 helper。回退也使用配套版本；旧版本拒绝带标签的数据树属于已知能力限制。

版本摘要、镜像 ID、安装身份、备份位置和实际测试结果应保存在部署者控制的私有验收记录中。仓库文档不保存具体服务器地址、登录凭据、证书、模型 key 或用户 Work 内容。
