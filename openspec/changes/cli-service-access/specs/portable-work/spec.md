# Spec Delta

## ADDED Requirements

### Requirement: 导入后按目标身份重建默认服务域名

**Identifier:** PWORK-SERVICE-ACCESS-001

Work 的默认网络名称、service 域名、Docker 名称及活动访问连接 SHALL 属于目标 Core 派生状态，不进入 `.work` V1 包或改变其 schema。导入 SHALL 在新 Work/service ID 发布时重新分配这些身份；导入仍保持 stopped，只有显式启动并达到 ready 才可通过新域名访问。源包的应用文件、数据库、历史文本中的字面 URL SHALL 原样保留，不做搜索替换或继承源平台路由。

#### Scenario: 同一包导入两次
- **WHEN** 同一含 `notes` service 的 `.work` 文件被导入两次
- **THEN** 两个新 Work 获得不同域名，均不占用源域名；启动其中一个不使另一个可访问

#### Scenario: 未启动的导入 Work
- **WHEN** 用户刚完成导入并查询 service，再尝试访问返回的新域名
- **THEN** 能看见稳定地址但状态为 unavailable，访问失败且不隐式启动 Work

#### Scenario: 保持 V1 包字节契约
- **WHEN** 使用现有 V1 包及历史 URL 文本完成导出、导入与再次导出
- **THEN** 包格式无需新增字段，历史文本字节不被改写，目标域名由目标 ID 推导
