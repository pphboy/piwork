# Spec Delta

## ADDED Requirements

### Requirement: 安全升级已有 Core 网络身份存储

**Identifier:** CST-ACCESS-001

新 Core SHALL 对空数据库创建 schema 9，并对现有 schema 8 执行一次原子升级，按 `(created_at,id)` 顺序为所有已有 Work 和保留 service 分配唯一网络身份，保留用户、会话、定义、Operations 和正在运行的容器。升级失败 SHALL 回滚且不报告 ready；版本小于 8、版本大于 9 或无合法 schema marker 的非空库继续返回存储格式不支持。Core recovery 完成且服务身份/容器核验前 SHALL 不接受网关访问。已升级到 schema 9 的数据目录 SHALL 不被旧 schema 8 二进制静默重写。

#### Scenario: schema 8 升级并接管容器
- **WHEN** Core 以现有 schema 8 数据目录启动，已有服务容器使用哈希名称且在运行
- **THEN** 单次升级成功、保留原服务与会话、分配域名，Core 通过 labels 接管容器且不为改名重建

#### Scenario: 升级中途失败
- **WHEN** 网络别名回填发生存储错误或唯一性冲突无法解决
- **THEN** 整个升级事务回滚，Core 不打开服务路由也不声称 ready

#### Scenario: 拒绝旧格式
- **WHEN** 非空 Core 数据库没有合法 marker 或 schema 版本低于 8
- **THEN** Core 按原有存储不兼容语义拒绝，不能尝试猜测迁移
