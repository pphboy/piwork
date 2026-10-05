# SELinux 宿主上的冷快照兼容方案

## Why

Fedora 43 上导入合法 `.work` 文件时，新 Docker 卷自动带有 `security.selinux` 扩展属性，而旧快照实现将任何扩展属性都判为不支持，导致恢复尚未写入数据就以 `SNAPSHOT_STORAGE_UNSUPPORTED` 失败。该判断也影响同类宿主上的导出，因此需要把宿主安全策略与可移植 Work 内容分开处理，并将已执行的临时修复纳入明确规格和验收。

## What Changes

- 精确允许属性名 `security.selinux`：树采集／恢复代码不读取、打包、设置或删除其值，标签继续由宿主和 Docker 正常挂载策略管理。
- 对卷、保留 context/Skill 树和 Pi package 制品树采用同一检查规则；保留普通文件、目录、链接及既有 POSIX 元数据契约。
- 继续整体拒绝用户扩展属性、POSIX ACL、文件 capability 和其他未支持属性；枚举失败不能被当成没有属性。
- 补齐无 SELinux 标签环境与 SELinux Enforcing 环境的回归验收；在直接树库测试中验证不同源／目标标签，在真实 helper 中验收采用正常 Docker 标签策略的受管卷、失败清理及再次搬迁。
- 按同一修订构建和发布 Core 与 snapshot helper，记录临时修复证据、正式验收缺口和回退方式。

目标是让合法 Work 在符合既有平台条件的 SELinux 宿主正常导入和导出，同时维持完整性与隔离规则。非目标包括全面支持 xattr/ACL/capability、修改 `.work` V1 格式、关闭 SELinux、迁移源宿主安全策略、改动 Desktop 公网入口、调整 Docker 存储后端，以及扩展 Operation/桌面的错误展示。本次不改 helper 挂载或 SELinux 运行策略，不保证任意私有 MCS 标签跨 Docker 挂载保持原值。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `work-storage`：细化 `WSTOR-SNAPSHOT-001` 的可移植元数据边界，明确宿主 SELinux 标签例外、未知属性拒绝、枚举失败和目标标签保留的可验收行为。

## Impact

- 代码范围：`internal/snapshottree` 的文件描述符/符号链接属性检查及测试；调用者包括 `internal/snapshothelper` 和 Core 的 context/制品树采集路径。
- 文档与交付范围：`docs/work-package-format.md`、相关部署记录、Core 二进制和 snapshot helper 镜像。当前工作区已有未提交热修；本方案记录其事实，不代表剩余验收已完成。
- 兼容性：不增加依赖，不改变包 schema、树摘要规则、API、登录信息或数据库结构；旧版本仍可能拒绝带标签的宿主路径，所以不能仅替换 helper 而遗漏 Core。
- 生命周期与安全：导入仍只在新暂存中恢复，成功发布 stopped Work；失败沿用既有 Operation/journal 和精确资源清理。树处理不得修改来源内容、已有 Work、标签或用户属性；Docker 挂载时可能规范化受管卷标签，该宿主行为不属于树处理的标签保留保证。
