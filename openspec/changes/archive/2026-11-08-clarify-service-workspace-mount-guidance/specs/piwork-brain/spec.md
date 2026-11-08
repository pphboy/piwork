# Spec Delta

## ADDED Requirements

### Requirement: 将主动处理 workspace 挂载作为默认部署认知

**Identifier:** BRN-018

启用当前脑包的执行上下文 SHALL 默认具备以下部署认知：Service 依赖 Work workspace 中的源码、配置或业务数据时，Agent SHALL 在既有权限范围内主动声明所需 workspace 挂载，并使用匹配的工作目录。用户只需表达应用或部署目标，SHALL NOT 被要求另行提出挂载要求、填写技术参数或确认正常挂载步骤。该认知 SHALL 通用于各技术栈，沿 BRN-002 的通用原则与现有部署指导交付，不依赖某个 Work 的 Memory 学习结果。

仅使用镜像内程序且不需要 Work 文件的 Service SHALL 保留无 workspace 挂载的部署方式。Agent SHALL 根据实际需要选择挂载及读写方式，并遵守现有授权边界。认知更新 SHALL 沿 BRN-001、BRN-005 的脑包软件更新与显式采用规则生效，不将默认认知解释为热更新旧 active context。

#### Scenario: 用户只提出应用部署目标
- **WHEN** 当前 Work 已采用包含该认知的脑包，用户要求部署一个使用 workspace 中源码或数据的应用，未提及挂载或工作目录
- **THEN** Agent 自动将必要挂载与匹配的工作目录纳入 Service 定义，沿原部署路径执行，不向用户追加技术参数确认

#### Scenario: 镜像原生服务不需要 Work 文件
- **WHEN** 用户要求部署仅使用镜像内程序、完全不依赖 workspace 的 Service
- **THEN** Agent 可沿原契约选择无 workspace 挂载和对应工作目录，不因默认认知而给无此需要的服务附加 workspace 访问
