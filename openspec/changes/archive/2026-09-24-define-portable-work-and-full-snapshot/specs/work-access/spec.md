# Spec Delta

## ADDED Requirements

### Requirement: Authorize full packages as owner content rather than control metadata

**Identifier:** WACC-SNAPSHOT-001

export、snapshot 内容/详情、upload package、import 及其敏感 provenance SHALL 仅允许相应已认证用户访问自己的内容；非所有者管理员的控制权限不包含导出/下载权限，返回 403；普通非所有者返回 404。operator 或 agent runtime 凭证不能调用这些用户入口。import 的 owner SHALL 由认证主体确定，不能来自包或请求的任意 ownerId。snapshot job 的 Operation 查询 SHALL 校验任务 owner，不能沿用普通管理员可读控制 metadata 的权限扩大内容访问。

包不会成为源 Core 的 credential；接收端导入时 SHALL 新建平台 Work/service/卷身份并按 PWORK-004 自动验证目标模型权限与凭证可用性，显式启动时 SHALL 新建运行网络、代次和 TLS 身份。内置 `work-services` MCP 的目标 Core 地址及服务控制证书 SHALL 由目标安装注入，认证身份只允许操作新 Work，不能因包内文本、源 Work ID 或源控制记录获得源平台权限。导入不能复制源证书或在尚未启动的 Work 中预置可用的运行凭证。普通状态、错误、日志和 CLI stdout 仍脱敏，完整包文件是用户明确请求的内容传输例外，不经过会破坏用户字节的内容脱敏。离线持有者能读取包内容，产品 SHALL 提醒分享者自行确认接收方可信，不宣称包已自动清除秘密。

#### Scenario: Administrator cannot export private content
- **WHEN** 一个管理员能够停止另一用户的 Work 后尝试 export/download
- **THEN** 请求返回 403，不返回包或历史正文

#### Scenario: Forge ownership in the manifest
- **WHEN** 包声称源 ownerId 是管理员或 import 请求试图指定其他 owner
- **THEN** 非法 owner 字段被拒绝，导入不能赋予调用者额外平台权限

#### Scenario: Access a failed unpublished import
- **WHEN** import 失败且 Work 没有发布
- **THEN** 只有发起者可按 Operation ID 读取安全失败诊断，其他用户不能利用缺失 Work 绕过鉴权

#### Scenario: Imported agent controls only its new Work
- **WHEN** 导入 Work 的 pi-agentd 经内置 MCP 调用目标 Core 的 service 工具，并尝试指定源 Work 或其他 Work 的 service ID
- **THEN** 目标 Core 只按新生成的 Work/运行代次/实例身份授权，拒绝跨 Work 操作，不接受包内源身份作为凭证
