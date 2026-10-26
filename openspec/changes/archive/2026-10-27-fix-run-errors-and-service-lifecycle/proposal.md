# Proposal

## Why

模型认证失败被报告为可重试的通用 Run 错误，一次性探测遗留的启用 Service 又可能使 Work 降级，而用户无法从现有诊断理解原因。需要分别修复错误分类、临时服务收尾和服务故障归因，并覆盖 Run 中断后的自动清理。

## What Changes

- 识别受支持模型协议中可确认的认证或权限失败，以安全错误码、非直接重试标志及适合当前权限的处理方向反馈；未知错误不猜测原因，供应商内容和凭据不进入公开结果或诊断。
- 指导 Agent 优先通过现有获准能力完成一次性检查；确需特定镜像时，显式声明由当前 Run 持有的临时 Service，并在正常结束、取消或 Agent 异常中断后自动收尾。
- 为临时 Service 增加可持久恢复的归属和清理状态，确保受理、迟到实例、取消、Agent/Core 恢复和工作停止之间的顺序安全；只清理可证明归属的临时资源，保留 workspace 数据及普通持久 Service。
- 为临时清理和真实 Service 故障提供可查询的安全诊断和结构化日志，说明关联对象、阶段、结果和处理方向；清理失败或尚未确认时可观察，并在依赖恢复后继续收尾。
- 补齐常驻 Service 就绪前和运行后的退出诊断及 Work 降级归因，恢复或停用后更新当前状态；退出码 0 不被直接视为持续服务正常。

## Capabilities

### New Capabilities

无。复用现有会话、服务、生命周期和诊断能力。

### Modified Capabilities

- `agent-conversation`: Run 安全分类供应商认证与权限错误，并在终止或中断后衔接所属临时服务的收尾。
- `agent-service-deployment`: 一次性检查的工具选择、临时 Service 声明及结果确认指导。
- `work-services`: 临时 Service 的受理、归属、清理和异常恢复；常驻服务退出与恢复诊断。
- `work-lifecycle`: Work、Agent 和 Core 状态转换时收尾临时服务，并与停止及冷快照边界协调。
- `work-diagnostics`: 记录和读取可关联、可恢复、脱敏的临时服务清理及服务异常诊断。
- `desktop-webui`: 在 Run 和 Work/Service 界面解释认证失败、服务降级原因及临时清理结果。

## Impact

涉及 `apps/agentd`、`packages/pi-adapter`、`internal/coreassets/piwork-brain`、`internal/servicemcp`、`proto/` 及生成契约、`internal/coreapp`、`internal/corestore`、诊断与 Desktop WebUI。服务控制协议需要兼容的增量能力及持久恢复记录；旧 Agent、既有普通服务、既有 Run 历史和完整 Work 包继续按原能力处理。必要时更新 Agent 镜像与嵌入 WebUI 资源，并使用隔离 Docker 和合成供应商执行验证。
