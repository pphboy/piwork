# Spec Delta

## ADDED Requirements

### Requirement: Restore owned contexts without recopying recipient defaults

**Identifier:** WCFG-SNAPSHOT-001

导入 SHALL 恢复包内全部保留 context 的 Skills/AGENTS/有效配置、MCP 列表、工具权限和固定镜像，保持 active/desired 指向关系、active=null 和 pendingApply；不得从接收者全局 Skills 或默认配置重新复制。所需模型按 PWORK-004 在目标 Core 自动解析，image/context 使用 Work-owned 导入记录，不修改全局 catalog、默认值或同名 Skill。内置 `work-services` 原配置若存在 SHALL 保留，若被源 Work 显式移除 SHALL 不从目标默认配置重新添加；它不需要平台 secret 引用。后续仅修改无关字段 SHALL 保留已导入 Skill 和 image；只有显式重新选择相应字段才采用正常 catalog 解析。Skill 全树仍遵循现有安全格式，不扩大 host-path 权限。

导入 Work 首次 start SHALL 使用导入 active context（若存在）；待应用 desired 仅通过显式 apply 激活，不能因新安装自动生效。active=null 的包保留未初始化语义，首次显式 start 按现有初始化路径验证 desired。源平台的 runtimeProfile credentialRef SHALL 替换为接受导入时自动选定的接收方模型凭证引用，不能复制源密钥或宿主路径；运行时由目标 Core 注入模型 key。

#### Scenario: No managed Skill exists on the recipient
- **WHEN** 包内有完整 Skill s-a，接收方全局没有 s-a
- **THEN** 导入与后续启动使用包内副本，不要求 operator 导入 s-a

#### Scenario: Preserve unapplied changes
- **WHEN** active=A、desired=B 的包被导入并显式启动
- **THEN** 使用 A，pendingApply 仍为 true，只有显式 apply 才尝试 B

#### Scenario: Preserve imported assets on an unrelated edit
- **WHEN** 导入后用户仅修改 tools 配置并 apply
- **THEN** 原 Skill/image 副本保持不变，不因源 catalogId 在接收方不存在而失败

#### Scenario: No successful source initialization
- **WHEN** active=null 的合法包导入
- **THEN** active 仍为 null，导入不宣称 ready，首次显式 start 验证 desired 后才激活

#### Scenario: Preserve built-in service tools across installations
- **WHEN** 包的 active context 含有效内置 `work-services` MCP 与相应工具权限，并导入另一安装
- **THEN** 首次显式启动发现并注册同一组允许的 service 工具，目标 Core 注入新的控制连接与运行身份，不使用源 Core 地址或证书

#### Scenario: Do not reintroduce removed service tools
- **WHEN** 包的 active context 已显式移除 `work-services`
- **THEN** 目标默认配置即使含该 MCP，导入后也不自动添加或授权其工具
