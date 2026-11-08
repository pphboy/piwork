# Design

## Context

动机与范围见 [proposal.md](proposal.md)。本设计用于明确常驻认知、部署正文和字段示例的分工，以及它们与现有校验和脑包交付的关系。

| 已核对来源 | 事实及影响 |
| --- | --- |
| `internal/coreassets/piwork-brain/brain.md:9-15` | 默认认知已路由至部署 Skill，但没有主动处理 workspace 挂载的原则 |
| `skills/deploy-work-service/SKILL.md:14-20` | 主步骤给出 workspace 源码路径和启动命令，创建请求的位置没有明确 `mounts` |
| `skills/deploy-work-service/reference.md:7` | 原有自然语言说明挂载目标及无挂载工作目录，没有可复制字段片段，按 `mounts` 搜索会漏过关键段落 |
| `internal/servicedefinition/definition.go:86-95`、WSRV-011 | 无挂载只能用 `/`；有 workspace 挂载时工作目录须位于其范围内，现有校验应保持 |
| `internal/servicemcp/server.go:105-110` | 请求失败会返回笼统 gRPC 分类；错误字段透传属于已明确暂缓的独立事项 |
| `internal/coreassets/brain.go:13-36`、`brain_test.go:13-60` | 脑包由 Go embed 交付，包版本是更新标记，已有 ZIP 内容测试可复用 |

表中 Skill/Reference 相对路径均位于 `internal/coreassets/piwork-brain/`。`piwork-brain` 当前版本为 1.3.3；实际实现时递增补丁版本并同步既有版本期望。

## Goals / Non-Goals

**Goals:** 用户只表达部署目标时，当前脑包已提供默认原则，Agent 在填写部署定义的位置能直接取得匹配的字段示例。保留镜像原生服务的无挂载能力，以及现有读写、权限和显式 Apply 边界。

**Non-Goals:** 不修改 Core/MCP 的默认值、受理或错误协议，不在平台自动补挂载；不新增 Skill、工具、用户确认步骤或模型测评系统。

## Decisions

### 1. 默认原则常驻，具体字段就近提供

在 `brain.md` 的 Act 区域加入一句简短原则：部署依赖 Work 文件的 Service 时，主动声明必要 workspace 挂载并使用匹配工作目录，无需用户提醒。它属于通用部署判断，适用于各技术栈；字段明细继续由已有部署 Skill 与 Reference 承载。

在 `deploy-work-service/SKILL.md` 的创建/更新步骤直接说明 `mounts` 与 `workingDirectory` 配对，不把这条核心约束仅留在链接中。只在 Reference 增加规则会重现此前漏读；把全部请求 JSON 放入常驻认知则会增加所有任务的上下文负担。

### 2. 两个字段片段沿用当前契约

Reference 使用实际字段名作为小标题与 JSON 键，提供以下两类片段，明确它们须与实际镜像、启动命令等字段组合。无需再创建一份配置模板或生成器。

需要读写应用源码/数据的 workspace 示例：

```json
{
  "workingDirectory": "/var/data/workspace",
  "mounts": [
    { "source": "workspace", "target": "/var/data/workspace", "readOnly": false }
  ]
}
```

完全使用镜像内程序的示例：

```json
{
  "workingDirectory": "/",
  "mounts": []
}
```

需要只读访问时使用现有 `readOnly: true`。具体选择取决于应用是否写入 workspace；示例不成为所有服务默认可写挂载的授权。授权与校验仍由现有部署上下文和 Core 负责。

### 3. 参数拒绝先核对定义

Skill 补充简短判断：遇到 `InvalidArgument` 先核对实际提交字段，特别是挂载与工作目录的组合；缺少证据时保留原因未知，不能直接报告引擎故障。此处只调整排查指导，不增加重试状态机或承诺新的错误字段；未知副作用继续遵守原操作核对规则。

### 4. 用已有交付与校验入口验证

| Owner / 来源 | 直接消费者与必要同步 |
| --- | --- |
| `brain.md` 的默认原则 | 当前冻结包的执行上下文；现有脑包 ZIP 内容测试 |
| 部署 Skill / Reference | Agent 构造请求与字段搜索；现有 Service 定义校验 |
| `package.json` | Core 内置包更新；coreassets 和 bundled brain 的版本期望；本地 Core/CLI 构建 |

扩展现有 coreassets 测试，读取实际脑包 ZIP 中的原则、操作指导和 JSON 片段。测试为片段补齐合成的 `name`、`image.reference`、`command`，直接调用 `servicedefinition.Normalize`：两类有效组合应通过；从 workspace 组合移除挂载时应仍被拒绝。这验证示例与真实契约一致，不复制校验实现或建立通用文档扫描框架。

沿用相关 bundled brain 单元测试核对版本、旧包保留和管理员定制保护，再执行 `make build-go` 让本地程序包含新版脑包。宿主参数、部署示例和镜像输入均不变，检查其一致性即可，不机械改写双语部署材料。

## Risks / Trade-offs

- [模型仍可能忽略指导] -> 采用常驻原则、操作位置提醒与具体字段示例减少漏读；验收证明当前包交付了正确认知和符合契约的示例，不把固定请求成功或文字检查夸大为任意模型首遍必成。
- [被误解为所有 Service 自动获得 workspace] -> 同时给出无挂载示例，并保留现有显式声明和 Core 校验；不需要 Work 文件的服务不附加访问。
- [示例与校验漂移] -> 测试读取随包交付的实际片段并调用现有校验，覆盖合法组合和缺失挂载的负例。

## Migration Plan

实施仅更新脑包内容、版本和必要测试，本地重建后，新 Work 可按原机制捕获新版。已有 Work 继续经原包更新和显式 Apply 采用；本变更不直接操作在线安装。若需恢复，按原内置包/程序更新机制回退，不修改 Service 定义或业务数据。
