# Proposal

## Why

实际部署曾因 Agent 使用 workspace 工作目录却漏传 `mounts`，在 Service 创建前被拒绝；相关规则仅藏在 Reference 的自然语言中，主步骤缺少字段示例，首次排障又误判为引擎故障。用户希望这是默认部署常识：只需表达部署目标，Agent 自己处理必要挂载，无需用户提醒或补充参数。

## What Changes

- 在默认 `brain.md` 增加简短原则：部署依赖 Work 文件的 Service 时，主动声明所需 workspace 挂载，并沿现有部署 Skill 处理具体请求。
- 在 `deploy-work-service` 的创建/更新步骤明确 `mounts` 与 `workingDirectory` 的匹配规则，适用于 NiceGUI、FastAPI 和其他使用 workspace 的应用。
- 在现有 Reference 用实际字段名提供可复制的 workspace 挂载片段，以及无需 workspace 的镜像原生服务片段；读写方式按应用需要声明。
- 参数被拒绝时，指导 Agent 先核对部署定义与已知约束，再依据证据判断故障；保留原有未知副作用核对规则。
- 通过现有脑包版本、打包测试和本地宿主构建交付，验证指导与现行 Service 校验一致。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `piwork-brain`：将主动处理所需 workspace 挂载作为默认认知，用户无需单独提出挂载要求。
- `agent-service-deployment`：明确可直接采用的挂载字段示例、工作目录边界与参数拒绝时的排查顺序。

## Impact

- 功能内容：`internal/coreassets/piwork-brain/brain.md`、`skills/deploy-work-service/SKILL.md`、`skills/deploy-work-service/reference.md`。
- 必要消费者：脑包 `package.json`、`internal/coreassets/brain_test.go` 及 bundled brain 版本相关测试；重建本地 Core/CLI 以嵌入新包。
- 复用 `internal/servicedefinition` 现有校验验证示例；Core/MCP、权限与挂载受理规则不变，不引入自动补挂载机制或新依赖。
- 工具错误字段透传留待独立事项。本变更不发布镜像、不操作在线安装，也不自动更新或 Apply 既有 Work。
