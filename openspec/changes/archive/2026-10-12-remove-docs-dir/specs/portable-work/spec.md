# portable-work 规格变更

## ADDED Requirements

### Requirement: V1 冷包的字节封装与原生兼容

**Identifier:** PWORK-WIRE-001

冷包 MIME SHALL 为 application/vnd.piwork.work-package，字节按八字节 PIWORK1\n、uint64 大端 manifest 长度、UTF-8 JSON、按 manifest.blobs 顺序原始 blob 组成，无 blob header/压缩/尾随数据。完整包及每 blob SHA256 核验，digest 排序且去重的 blob 合并种类；重复 JSON key、未知字段、不安全整数、非法 UTF-8、悬空关系及不支持版本拒绝。

V1 SHALL 保留 cold-full、两个受管卷、active/desired/历史 context/包绑定/Service revision/终态控制与私有历史、固定镜像 config/非压缩层、模式/UID/GID/纳秒时间/空目录/链接及原用户字节；文件名为 POSIX 字节的 base64 段。100 GiB 包/逻辑恢复、metadata 64 MiB 单份/256 MiB 累计、一百万项、4096 字节/深度128，复用 blob 不绕过逻辑限额。临时层、进程、外部服务、平台用户/目录/秘密和活跃授权不迁移；用户自行存入的秘密不做内容过滤。

原生 reader SHALL 识别 schema 4 和 schema 5/Memory1，SDK JSONL、图像 input 与用户内容沿现有传输保留，不重放 Run。schema 5 的 work.sqlite/memory.sqlite 独立重建目标身份并保留本地版本/条目/文本；未恢复联合 journal 返回 SNAPSHOT_HISTORY_BUSY。schema4 升级只由授权显式 Apply、备份/恢复完成，成功后禁止 schema4-only 降级。

inspect SHALL 只验证离线字节，不打开源 SQLite、不执行包代码；目标 Core 静态核验目标模型/凭据/外部 MCP/配额/平台并发布 stopped Work，显式 Start 才生成新网络证书。原请求/来源文本和业务 JSON 不为身份重建而改写。security.selinux 精确排除，不迁移宿主标签，其余不支持属性整体拒绝；hash 完整不代表发送者或包代码可信。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec
