# Spec Delta

## ADDED Requirements

### Requirement: 默认 Work 创建及启动性能可重复验收

**Identifier:** WLIFE-LATENCY-001

系统 SHALL 在固定参考验收环境中，对 Core 已 ready 且默认镜像 / 所需包环境已预热、默认脑包、默认资源限制、内置本地 MCP、无外部慢依赖和无其他并发压力的创建流程执行端到端性能验收。每组 SHALL 至少记录 20 个成功样本、全部失败样本、环境条件和 P50 / P95；成功样本 SHALL 不通过丢弃慢请求或重复提交取得。

参考验收目标 SHALL 为：从创建 HTTP 请求进入到接受响应完成的 P95 不超过 1 秒；从持久受理到后端真实激活 Ready 的 P95 不超过 3 秒；实际 Desktop 点击创建到列表及面板完成可用状态确认的全过程 P95 不超过 6 秒。浏览器时间 SHALL 独立测量，不以各阶段 P95 相加替代实际全过程；未经测量 SHALL 不宣称已经满足目标。

镜像完整检查和环境探测的调用次数 SHALL 同时验证：预热后默认创建 / 启动不重复完整检查或环境探测；同键并发冷准备只执行一份。首次 Core 预热、新镜像拉取 / 检查、大包复制、外部 MCP 等条件 SHALL 单独统计，明确不适用上述默认参考预算。

#### Scenario: 预热后创建默认 Work
- **WHEN** 在记录完整环境条件的独立验收安装中顺序创建至少 20 个默认 Work
- **THEN** 报告各阶段及实际浏览器全过程的 P50 / P95 和失败样本，按 1 / 3 / 6 秒目标判定，并证明创建 / 启动未重复完整镜像检查和环境探测

#### Scenario: 首个 Work 和再次 Start
- **WHEN** Core 已完成预热，用户首次创建默认 Work，随后停止并再次 Start
- **THEN** 两条路径均复用已有镜像能力，Start 从原 active context 验证真实 Agent，性能记录不隐去首次默认 Work

#### Scenario: 冷镜像和大包条件
- **WHEN** 用户首次选择尚未准备的镜像，或配置大包 / 外部慢 MCP
- **THEN** 报告实际准备及启动阶段耗时，不把冷路径混入热路径样本后仍宣称默认预算已经满足，也不为满足预算跳过必要校验

### Requirement: 优化保持原子捕获与持久受理顺序

**Identifier:** WLIFE-CAPTURE-LATENCY-001

创建性能优化 SHALL 保留完整 Work-owned context 捕获和初始兼容性核对先于持久 Work / Operation 受理，Docker 运行资源创建先于 Ready 而后于持久受理。受理前失败 SHALL 不留下可见半成品；接受后 SHALL 沿原 Operation 异步推进，幂等重放优先返回既有结果。共享镜像结果 MUST NOT 替代 Work 自有制品、当前权限 / 配额检查、控制版本或停止 / Apply 栅栏。

#### Scenario: 捕获失败
- **WHEN** 镜像准备已命中，但 Skill / 包上下文捕获或初始兼容性核对失败
- **THEN** 创建失败且没有受理的半成品 Work / Operation，也没有为该 Work 启动 Agent 容器

#### Scenario: 接受响应丢失
- **WHEN** 已受理创建的响应丢失，客户端用同主体、同幂等键及内容重试
- **THEN** 返回原 Work / Operation，不重新捕获上下文、不启动重复容器，也不重新发起镜像准备

#### Scenario: Starting 期间接受 Stop
- **WHEN** 已受理 Work 正在等待 Agent readiness，而 Stop 成为最新控制目标
- **THEN** 旧启动不能凭缓存或迟到的 readiness 激活为 ready，继续按既有 superseded 和资源收尾规则处理
