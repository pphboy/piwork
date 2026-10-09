# Spec Delta

## MODIFIED Requirements

### Requirement: 使用显式容器环境完成首次初始化

**Identifier:** CORE-DOCKER-INIT-001

Core SHALL 接受部署者显式提供的进程环境变量，复用 PIWORK_ADMIN_ACCOUNT/PIWORK_ADMIN_PASSWORD、PIWORK_MODEL_PROVIDER、PIWORK_MODEL、PIWORK_API_KEY 及可选 PIWORK_MODEL_BASE_URL 初始化缺失的管理员和默认 runtime；既有模型名称与 key 的兼容别名保持。PIWORK_AGENT_IMAGE 及 package/file/snapshot helper 引用 SHALL 可显式提供，或从 Core 发行镜像携带的非敏感配置取得，用户无需为了默认试用另行提供依赖引用。

发行默认配置 SHALL 只包含可核查的非敏感发行信息和依赖引用，不包含账号、密码、模型 key、用户 token 或持久用户配置。显式有效的部署输入优先于发行默认值；显式非法输入 SHALL 安全拒绝，不静默回退。发行默认依赖存在但用户未提供初始化字段时 SHALL 保持原有健康可访问、具体状态非就绪的行为，不把非敏感依赖默认值误判为用户提交了不完整模型初始化。用户实际提供的部分或格式非法输入 SHALL 继续按既有校验拒绝，不放宽成自动账号或默认凭据。

已有管理员、模型与默认配置 SHALL 不被重启时的合法环境值或新发行默认值覆盖；格式非法的已提供输入 SHALL 在使用之前安全拒绝，即使已有持久值也不忽略。首次初始化不得创建默认 Work；未配置发行默认值的原生或高级部署保留现有显式初始化方式。

默认上下文 SHALL 保持一次性 seed 语义，管理员已经禁用、移除或选择的默认值不被启动重置。模型 Base URL 的既有限制 SHALL 保持：HTTPS 可用；HTTP 仅允许 loopback，Agent 中 loopback 指向 Agent 自身。未设置可选 Base URL SHALL 保持未设置，显式空值继续非法。

#### Scenario: 空数据首次启动
- **WHEN** 空目录收到完整合法的管理员与模型环境值，Core 镜像携带匹配发行依赖
- **THEN** 不需要环境文件或额外镜像配置即可保存首管理员及默认 runtime、自动准备依赖，完整就绪后允许创建 Work；不输出秘密或预建 Work

#### Scenario: 非敏感默认值不构成用户初始化
- **WHEN** Core 携带发行依赖配置但用户没有提交管理员或模型初始化值
- **THEN** Core 仍打开健康 listener 并报告缺项，不因依赖默认值而触发部分模型字段错误，不生成默认账号或密码

#### Scenario: 显式部署覆盖发行默认值
- **WHEN** 首次部署显式传入合法 Agent 或 helper 引用，或传入非法值
- **THEN** 合法输入优先于发行默认值，非法输入安全拒绝且不回退；原生部署仍可使用现有完整显式输入

#### Scenario: 重建容器时 env 与持久值不同
- **WHEN** 已有安装以不同合法管理员密码、模型环境或新的发行默认依赖重建
- **THEN** 既有持久管理员、默认 runtime 和 Work 配置保持，修改仍使用既有管理入口

#### Scenario: 已有安装收到非法输入
- **WHEN** 已有持久配置的 Core 收到格式非法的初始化字段
- **THEN** 在使用之前安全拒绝，不因已有配置或发行默认值而忽略非法输入，不修改原数据

#### Scenario: 可选模型地址的省略与空值
- **WHEN** 用户未设置 PIWORK_MODEL_BASE_URL 或显式设置为空
- **THEN** 分别保持未指定状态或按既有非法输入契约拒绝，不把 CLI 的宿主别名或容器模式当成放开限制的依据

#### Scenario: 试图使用宿主 HTTP 模型地址
- **WHEN** 提供 http://host.docker.internal:8000 作为模型 Base URL
- **THEN** 按既有非法输入契约拒绝，不将 CLI 宿主别名或容器模式作为放开模型限制的依据
