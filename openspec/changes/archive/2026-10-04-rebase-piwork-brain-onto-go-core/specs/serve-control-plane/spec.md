# Spec Delta

## ADDED Requirements

### Requirement: 当前平台独立使用 Go 交付并禁止旧 TS Core 依赖

**Identifier:** GO-DELIVERY-001

当前 Core、用户 CLI、Console 后端、Service MCP 及平台 package/file/snapshot helper SHALL 使用 master 的 Go 平台实现。活动源码、依赖、构建/启动清单、测试/fixture 和当前操作文档 SHALL 不要求旧 TS Core/CLI/helper、旧平台 Node workspace、运行代理或备用路径。已废弃执行入口 SHALL 被删除或替换，不以未调用为由保留可维护旧实现。

PiSDK/Agent、脑包 extension、浏览器和开发机验证驱动可以继续使用目标架构中的 TS/Node；它们不得加载旧 TS 平台。旧 OpenSpec 归档只保留历史事实，不参与构建、运行和验收。源码边界检查 SHALL 覆盖活动 scripts 与构建清单，不能仅检查应用目录；边界检查器自身的禁止清单和历史归档不作为运行依赖误报。

#### Scenario: 旧依赖藏在验收脚本
- **WHEN** 活动脚本尝试导入 TS Core worker、启动旧 TS CLI 或读取旧 Core 资源目录
- **THEN** 边界 gate 失败，不能声明迁入完成

#### Scenario: 正常的 Agent 与 Go 平台
- **WHEN** Go 平台运行完整 PiSDK/Agent 和脑包，浏览器使用编译后的界面
- **THEN** 全部功能可用且不加载旧 TS Core，合法 TS Agent 和历史归档不会被误判为旧平台依赖

### Requirement: Go 发布产物证明新功能完整闭环

**Identifier:** GO-DELIVERY-002

发布宿主 SHALL 只依赖 Go 平台程序及既有 Engine 接口，不依赖 Node/npm/Python/shell 等宿主工具。独立干净源码构建、当前生产与验收镜像、发布清单和无工具宿主 SHALL 使用同一当前协议与资源版本。新功能验收 SHALL 在真实 Go Core、真实 SDK 与真实 Service 上完成八条回路；旧 TS 版本测试通过记录不作为本版通过证据。master 原有 Go/浏览器回归 SHALL 保持通过。

首次默认脑包准备 SHALL 使用本版自有资源和 Go 包准备流程，具备持久完成标记；运行条件暂缺不使健康 Core 退出，默认准备未完成时不伪造默认 Work 可用。成功种子后管理员修改默认包集合 SHALL 跨重启保留。

#### Scenario: 无工具发布宿主
- **WHEN** 最终发布程序在没有宿主解释器的独立环境启动并连接 Engine
- **THEN** 默认 Work、真实 SDK Service、模型选择、反馈和完整环境分享可用，平台进程只使用 Go 程序

#### Scenario: 默认准备失败与用户定制
- **WHEN** 默认脑包准备失败，或成功后管理员清空默认包并重启
- **THEN** 分别保留可操作失败与管理员选择，不伪造准备成功或重新填回默认

#### Scenario: 只完成局部 API
- **WHEN** 接口和单元测试通过，但实际能力采用或独立导入回路未通过
- **THEN** change 不得完成、归档或声明完整交付
