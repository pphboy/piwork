# Serve Control Plane Specification

## Purpose

为部署者提供独立于登录用户客户端的 Core 控制面，使服务可以先启动再完成管理员和默认运行时初始化，并为未来 WebUI 复用同一套控制接口。

## Requirements

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

### Requirement: 保留独立 operator 管理 API 与身份边界

**Identifier:** SERVE-CTRL-001

Core SHALL 保留独立 operator 控制面及受保护 /control/* API，用于初始化、用户、Core Skills/packages、Runtime、默认 Work 和 Core package Operation 管理。operator 身份、凭证生成/校验和用户权限隔离保持；系统不再提供 piwork-serve 或其他 operator 管理命令适配层。默认日常管理入口是 Core 内嵌 UI，管理员 bearer 使用独立 /api/v1/admin/* API，共享管理领域能力。

operator 和管理员 SHALL NOT 读取他人 Work 会话正文、Run 输出、模型 secret 明文或非公开 Skill 文件；Core Operation 查询只限 Core package，不接受 Work Operation ID 绕过授权。默认 Skills/packages 使用公开名称，列表替换、显式空集合及省略保持原有语义，字段更新原子合并未指定项，不修改既有 Work 副本。

operator API SHALL 直连 Core HTTP 端口，不经 UI 通用代理。网页首次创建的 Setup 委托只允许既有 bootstrap 路由，不是 operator 身份，不能访问其他管理接口；正常网页登录/管理使用真实用户/admin bearer。

#### Scenario: 移除命令后 operator API 仍有效
- **WHEN** 有效 operator credential 调用受保护管理 API
- **THEN** 请求按原权限执行并返回安全结果，用户 token 不因此获得 operator 权限

#### Scenario: 管理默认配置
- **WHEN** operator 或管理员通过各自管理 API 修改默认 Skills/packages 或其他字段
- **THEN** 原子合并，省略项保留，仅后续 Work 使用新默认值，已有 Work 副本不变

#### Scenario: 查询 Core Operation
- **WHEN** operator 查询 Core package Operation 或试图查询 Work scope Operation
- **THEN** 前者返回安全阶段/结果，后者不能泄露用户 Work 数据

#### Scenario: UI 与身份边界
- **WHEN** 浏览器进行管理或首次创建管理员
- **THEN** 分别使用管理员 bearer 或单用途 Setup 委托，不读取 operator credential，不开放 /control 通用代理

### Requirement: 初始化前保持 Core 和网页可达

**Identifier:** SERVE-START-001

piwork-core SHALL 在管理员或默认运行时缺失时提供健康 HTTP 与网页引导。Readiness 如实报告 ADMIN_REQUIRED、RUNTIME_NOT_CONFIGURED、RUNTIME_UNAVAILABLE 及需要的默认 Work 配置状态；业务请求返回可操作错误，不使进程退出或创建默认 Work。

默认 packages=[] SHALL 是有效初始值。运行环境缺失时 preparation 明确失败，库查询/健康仍可用；默认引用缺失、禁用、重复或超过 64 个须原子拒绝，不覆盖旧配置。默认 Skills、AGENTS 和 base image 继续执行原字段校验，省略保留、显式清空只影响目标字段。

#### Scenario: 空安装在线初始化
- **WHEN** 启动 piwork-core 后在网页创建管理员并保存 Runtime
- **THEN** 无需命令初始化或重启；健康持续可用，实际依赖就绪后更新 readiness

#### Scenario: 无效默认值
- **WHEN** operator 或管理员 API 提交缺失、禁用、重复或不可用 Skill/package 及非法配置
- **THEN** 返回字段错误并保留旧默认值，Core 继续服务

#### Scenario: 独立清空与准备失败
- **WHEN** 管理 API 显式清空默认 packages/Skills，或在运行依赖缺失时安装包
- **THEN** 清空仅修改目标集合，不改已有 Work；安装安全报告运行依赖错误，不在 Core 执行第三方脚本

### Requirement: 保持 operator 与用户凭证隔离

Core SHALL 为 operator 控制面保留独立 operator credential，并将其与 `piwork-cli` 的用户登录 token 分开存储、校验和撤销。operator credential MUST 使用当前用户可读的保护权限，不能授权用户 Work 对话内容。

网页初始化的进程内委托仅按 CST-HTTP-BOUNDARY-001 使用既有 bootstrap 路由；它 SHALL NOT 读取、替代或暴露 operator credential，也不得用于本 Requirement 的一般 operator 管理 API。

#### Scenario: 使用 operator 凭证调用管理 API

- **WHEN** 调用者通过 operator 管理 API 连接 Core
- **THEN** Core 接受有效 operator credential，并拒绝缺少或属于 `piwork-cli` 用户会话的凭证

#### Scenario: Reject unsafe operator credential storage

- **WHEN** operator credential 路径是符号链接或可被其他用户读取
- **THEN** Core 拒绝使用该凭证并报告安全错误

### Requirement: operator API 设置 Runtime 使用服务端发行镜像

**Identifier:** SERVE-RUNTIME-RELEASE-001

受保护 /control/runtime SHALL 继续接受 operator 管理写入，使用目标 Core 内嵌发行 Agent 引用，不取调用方发行信息。模型、可选 endpoint 和 secret 沿用现有 API 校验；响应只返回非敏感 RuntimeView，确认持久化与后台依赖准备分别表达，不等待镜像拉取才返回。

写入 SHALL 支持省略镜像，已有 HTTP 镜像字段只允许与目标 Core 发行引用相同，不同值原子拒绝并保留配置；发行引用无效时安全失败，不回退旧值作为新写入选择。普通读取/启动不改变已保存 Runtime 或 Work，独立 Work/default-Work 配置不被裁减。

系统 SHALL 删除 config set 命令、秘密交互适配及离线配置回退，保留 operator 凭证验证与上述在线 API。未知响应不得触发本地初始化或自动重发。

#### Scenario: 调用方与 Core 版本不同
- **WHEN** operator API 提交合法 Runtime 配置
- **THEN** 使用目标 Core 的发行引用，凭证隔离、保存和准备语义保持

#### Scenario: 镜像字段试图覆盖
- **WHEN** operator 提交不同于服务端发行引用的 agentImage
- **THEN** 返回安全字段错误且原配置不变

#### Scenario: 写入结果未知
- **WHEN** 在线配置响应丢失或超时
- **THEN** 通过原只读 API 核对，不自动重提或启动离线初始化
