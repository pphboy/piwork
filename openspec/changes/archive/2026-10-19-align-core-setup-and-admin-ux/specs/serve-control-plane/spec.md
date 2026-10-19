# Spec Delta

## ADDED Requirements

### Requirement: operator 设置全局 Runtime 使用固定发行镜像

**Identifier:** SERVE-RUNTIME-RELEASE-001

operator `config set` SHALL 保留模型、可选 endpoint 及隐藏/stdin/file secret 输入，移除 `--agent-image` 参数；无参数帮助及语法错误检查不读取 secret、数据目录或网络。显式旧镜像参数 SHALL 返回 usage 错误及安全迁移方向，不能静默忽略或将值传入存储。在线设置 SHALL 由所连接的 Core 使用自身内嵌发行 Agent 引用，不能采用 operator 客户端所带版本的引用；离线初始化 SHALL 使用本地服务端程序内嵌的同一解析规则。

受保护 `/control/runtime` 写入 SHALL 支持省略镜像，旧 HTTP 镜像字段仅可与该服务端发行引用相同，不同值返回字段错误且原子保留旧配置。内嵌引用缺失/无效 SHALL 安全失败，不回退旧配置为新的写入选择，也不提示手填；固定引用改变不授权在普通读取或启动时改写已保存 Runtime。

operator 凭证、默认 endpoint、目录锁、secret 处理及离线选择规则 SHALL 保留。只有未显式 Core 地址且默认 loopback 明确拒绝连接时才可按原规则离线；超时、断线或未知写入不能回退或重发。确认持久化与后台依赖准备分别表达，保存成功仍返回非敏感 RuntimeView，不等待镜像拉取完成。本约束只固定全局 CoreRuntime，不取消 Work 独立配置、operator 默认 Work 的既有独立配置或高级 helper 参数。

#### Scenario: 在线客户端和 Core 版本不同
- **WHEN** operator 客户端与目标 Core 内嵌的发行 Agent 引用不同，操作者提交合法模型设置
- **THEN** 最终 Runtime 使用目标 Core 的引用，客户端不提交自身引用，原凭证及保存/准备语义保持

#### Scenario: 离线配置
- **WHEN** 原有离线条件满足，操作者不传镜像参数而提供合法模型与 stdin/file Key
- **THEN** 在同一目录锁下使用本地服务端内嵌引用保存，输出无 Key，随后启动可读取该配置

#### Scenario: 拒绝旧镜像参数
- **WHEN** 调用 config set --agent-image，或帮助/无效参数与 secret 输入组合
- **THEN** 旧参数返回 usage 退出码及不泄漏值的迁移方向，帮助正常退出；均不读取 Key、连接 Core 或修改数据

#### Scenario: 旧 HTTP 请求试图改镜像
- **WHEN** 有效 operator 提交与目标 Core 发行引用不同的 agentImage
- **THEN** 控制面返回安全字段错误，Runtime 与默认配置均不改变，不能绕过网页限制

#### Scenario: 在线结果未知
- **WHEN** 在线配置已发送但响应丢失或超时
- **THEN** 保留未知结果并指向只读核对，不执行离线初始化、再次配置或改用本地发行引用
