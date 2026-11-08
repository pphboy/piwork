# Spec Delta

## ADDED Requirements

### Requirement: 部署指导直接提供匹配的挂载字段与参数拒绝判断

**Identifier:** ADEP-006

默认部署指导 SHALL 在准备 Service 创建或定义更新请求的位置直接说明 `mounts` 与 `workingDirectory` 的匹配关系。使用 workspace 时 SHALL 按 WSRV-011 显式声明 `source: "workspace"`、`target: "/var/data/workspace"` 和实际需要的 `readOnly` 值，工作目录 SHALL 位于该挂载范围；不使用 workspace 时 SHALL 显式选择 `/` 工作目录。该指导 SHALL 覆盖默认和用户指定的应用技术栈，无需用户提示。

随脑包交付的部署资料 SHALL 使用上述实际字段名提供可复制的 JSON 字段片段，分别表达 workspace 应用与镜像原生服务的配置，明确片段与实际镜像、启动命令等字段组合后才构成完整定义。示例 SHALL 符合现行 Service 校验，不暗示代码已在 Agent workspace 中就会自动挂载到 Service。

部署参数被拒绝时，指导 SHALL 要求 Agent 先核对所提交定义与已知字段约束，并根据实际证据说明原因；仅有笼统 `InvalidArgument` SHALL NOT 被直接认定为引擎或镜像故障。未知受理结果继续按原标识核对，不以盲目重发替代查证。

#### Scenario: 使用 workspace 源码和持久数据创建应用
- **WHEN** Agent 根据默认部署指导创建读取 workspace 源码并写入业务数据的应用 Service
- **THEN** 定义显式包含可写 workspace 挂载，工作目录与启动路径匹配，用户不需要补写 `mounts`

#### Scenario: 两类示例都符合当前部署契约
- **WHEN** 使用者将部署资料中的 workspace 或无挂载字段片段与合法的镜像、启动命令等必要字段组合
- **THEN** 两类定义均可通过现有校验；前者保留所声明的 workspace 访问，后者使用 `/` 且不获得 workspace 挂载

#### Scenario: 遗漏挂载导致参数拒绝
- **WHEN** 请求因使用 workspace 工作目录却缺少挂载而在受理前被拒绝，Agent 取得笼统参数错误
- **THEN** Agent 先检查定义中的挂载和工作目录，依据已确认的参数问题作出修正或说明，不仅凭该错误报告引擎不可用或通过更换镜像冒充排查完成
