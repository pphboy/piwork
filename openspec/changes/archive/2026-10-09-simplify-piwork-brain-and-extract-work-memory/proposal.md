# Proposal

## Why

Piwork 的最短有效路径应保持为「用户意图 → Pi SDK Agent → 实际 Service」。现有脑包已经具备 Service 操作、反馈、真实验证和版本固定的 Experience，但通用认知重复承载开发与软件更新细节，Experience 又与运行历史共用 `work.sqlite`；本次收敛职责并独立化认知存储，使经验积累无需修改 Brain 软件。

## What Changes

- 将 `brain.md` 收敛为 Understand / Specify、Act、Verify、Remember 四项稳定认知原则；Service 开发、Spec-first、部署、接口与测试细节归现有 `deploy-work-service` Skill 和现有 Reference。
- 创建或修改 Pi 维护的 Service 时维护 `apps/<service>/SPEC.md`，以现有测试、Service Query / Action 和 Evidence 验证结果；普通业务操作直接使用已有能力。复用原有记录向 UI / CLI 反馈，不增加 Tasks 产品、开发账本或 Eval 平台。
- 在现有 Work-private 数据目录内新增独立 `memory.sqlite`，将现有 Experience 迁移为唯一权威 Memory，保留有效版本、失败/候选历史、来源请求与 Evidence 引用。
- 演进现有 `brain_experience`：保留 list / stage / commit / status，增加必要的 recall / read / revise / invalidate。stage 就是 Propose，不新增同义工具。
- 保留验证后提交与请求完成的原子关系，以及已受理 Run 的固定版本；按任务筛选实际提供给模型的条目，修正/失效只影响后续 Run。
- 使用同一 SQLite 连接 ATTACH Memory 与磁盘 Work 数据库，并将参与跨库事务的两库统一为 DELETE journal / FULL synchronous；不把 WAL 下的两次写入冒充原子提交，不新增分布式提交协调器。
- **BREAKING（受管历史契约）**：新 harness 写入 Work history schema 5、Memory schema 1。通过一次性受控迁移支持 schema 4；保留旧固定镜像与旧格式的静态校验/导入，禁止把已升级数据交给仅支持 schema 4 的运行镜像。`.work` formatVersion=1、storage layout=2 和两个受管卷的边界保持。
- 迁移纳入既有 Apply 的独占、恢复与回退边界：新格式未正式激活前不允许执行，迁移或候选加载失败可恢复原历史，不破坏旧 active Work。
- `brain_package_update` 继续用于显式软件更新及固定行为验收；普通认知积累只更新 Memory，Service 设计事实更新 Spec。可复用规则是 Memory 内容，工具权限、平台配置和 Founder 决策不由 Memory 改写。
- 实现阶段保留一份简洁的 Founder Baseline 文档，初始内容限于 Mark 本次给定的八项不变量；使用 Git 和现有测试追踪，后续修改须 Mark 授权。

本次不新增 Workflow Engine、Spec Engine、Eval Framework、Development Ledger、多 Agent 编排、Memory 向量检索/知识图谱/跨 Work 同步或 Baseline 后台，不重建 BrainFlow / BrainLoop / RunManager。

## Capabilities

### New Capabilities

- `work-memory`：独立 Work Memory 的存储、最小操作、证据验证、版本采用、一次性迁移与故障恢复。

### Modified Capabilities

- `piwork-brain`：稳定认知与 Skill 分工，认知学习与软件更新分离，复用 Memory 及 Founder 不变量。
- `agent-service-deployment`：现有 Skill 自动维护最小 Service Spec、使用现有测试验证，操作路径与开发路径分开。
- `agent-conversation`：保留 schema 4 历史兼容性，新增 schema 5 Memory 引用及实际采用条目记录，继续使用现有 Run/UI/CLI 可观察信息。
- `work-storage`：Memory 进入既有 private 卷，双库提交、缺失/损坏拒绝及 Apply 迁移回退纳入持久化契约。
- `portable-work`：完整校验 schema 4 或 schema 5 + Memory schema 1 的数据闭包，导入独立身份并保持旧请求不重放。

## Impact

Verify 的 C1/C2/C3 修复细化现有可信性与完整性要求，不新增能力或改变 schema 5 / Memory 1：

- 有效 preference 在提交、运行时读取、迁移分类及 TS/Go 静态校验中均核对被条目实际引用的原 Chat 偏好证明，published candidate 与 entry 的类别/来源元数据必须一致；不以 verified Query 或 caller 声明的 kind 替代用户指令。
- 有效 head 与最新持久发布事实一致，区分初始版本 0、最后一条失效后的新空版本及 legacy 未知发布时间的部分历史；拒绝旧 head/伪空，不自动修复或重编号历史。
- C3 补齐复制条目的来源一致性：不同条目提交产生新快照时，保留下来的旧条目仍须与其适用的原 effective upsert candidate 一致；TS/runtime 与 Go 静态校验必须接受同样的合法复制、拒绝同样的副本篡改。保留无对应候选的合法迁移历史，不补造来源或修改旧版本。
- 本 change 的前 33 项勾选保留为先前执行记录，原 C1/C2 的直接复现条件已有修复证据；C3 通过追加 9.1–9.3 完成修复及复验，当前 tasks 为 36/36。复制条目篡改由新增共享负向和真实 Core/helper 验收覆盖，实际结果与未验证范围见当前验收报告，原有成功测试不能替代这些证据。

- Package：`internal/coreassets/piwork-brain/brain.md`、`extensions/brain.js`、`skills/deploy-work-service/`、`references/service-contract.md`。保留真实包结构及四个既有工具名。
- Harness / Store：`apps/agentd/src/{application,brain-flow,brain-resources,runs}.ts`，`packages/work-store/src/{store,feedback,migrations,snapshot,snapshot-brain}.ts`，以及最小 `memory.ts` 与相关测试。
- Go 持久化边界：`internal/workhistory/`、`internal/snapshothelper/`、`internal/coreapp/work_apply.go` 及 snapshot capture/preflight、`internal/dockerengine/snapshot_helpers.go`、`internal/agentclient/`、`internal/imagestatic/`。只扩展既有迁移、校验与回退职责。
- 契约与生成：`packages/contracts/src/`、`scripts/generate-work-history.mjs`、`scripts/build-native-agent-images.sh` 及 `make generate` 的跨语言产物；没有新服务或外部基础设施依赖。
- 可见行为：现有 Chat 工具活动、请求/Evidence 详情、CLI chat / run watch / run show 可查 Memory 操作及采用版本；没有额外人工 Spec / Plan / Eval 审批步骤或独立管理页面。
- 验收沿用 TS/Go 单元、真实 SQLite/进程故障测试、真实 Pi SDK/MCP/Docker 工作站、浏览器与 CLI 测试。T01–T06 覆盖持久化、采用、可信性、独立性、隔离分享及原有回归；确定性模型验收不称为真实模型行为评估。
- 现有 Work 不自动替换 active Package 或固定 agent 镜像。迁移后只由 Memory 保存认知；旧 Experience 备份仅用于未完成迁移回退，不是第二读取源，不长期双写。
