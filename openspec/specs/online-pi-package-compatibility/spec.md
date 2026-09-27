# Online Pi Package Compatibility Specification

## Purpose

本能力规定 Piwork 如何接纳和启用兼容的在线发布 Pi 包，同时保留冻结包的原始字节、匹配所选 Work 镜像，并以安全的错误信息报告失败。

## Requirements

### Requirement: OPKG-001 接纳带私有运行时依赖的已发布包

对于其他方面均有效、且在清单的 `dependencies` 中声明 `typebox` 的 npm 或 Git Pi 包，Piwork **SHALL** 允许安装。它 **SHALL** 将该依赖安装并冻结在包产物内，保留包的原始清单，并把已安装依赖的字节纳入产物完整性校验。`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`、`@earendil-works/pi-coding-agent` 和 `@earendil-works/pi-tui` **MUST** 继续由宿主提供，**MUST NOT** 作为包的运行时依赖被接纳。现有的来源、压缩包、资源、大小和包隔离检查 **SHALL** 保持有效。

#### Scenario: 已发布包依赖 TypeBox
- **WHEN** 有效的在线 Pi 包在 `dependencies` 中声明 `typebox` 且安装成功
- **THEN** 包 Operation 成功，冻结产物保留原始依赖声明，包私有的已安装 `typebox` 被纳入产物摘要

#### Scenario: Pi 核心模块被声明为运行时依赖
- **WHEN** 包在 `dependencies` 中声明四个宿主 Pi API 模块之一
- **THEN** 安装以 `PI_PACKAGE_INVALID_MANIFEST` 失败，且不发布包

#### Scenario: 声明的运行时依赖缺失或逸出产物
- **WHEN** 已准备的包声明了运行时依赖，但该依赖不在冻结树内，或解析到树外
- **THEN** 验证在发布前拒绝该产物，并沿用现有的缺失依赖或不安全归档错误行为

### Requirement: OPKG-002 匹配声明的 Pi 宿主 peer 版本

对于包的 `peerDependencies` 中出现的四个宿主 Pi API 模块，Piwork **SHALL** 要求其 semver 范围有效，并由所选 agent 镜像中对应模块的版本满足。缺少 `peerDependencies` 字段不增加版本约束。已命名的 Pi 宿主模块若版本范围为空、格式错误或不受支持，**MUST** 以 `PI_PACKAGE_INVALID_MANIFEST` 失败；有效但不满足的范围 **MUST** 以 `PI_PACKAGE_SDK_VERSION_UNSUPPORTED` 失败。这两类失败均不得发布或替换包。该检查 **SHALL** 适用于 Core 和 Work 通过 npm、Git、本地上传及 ZIP 上传的安装，并 **SHALL** 使用 Operation 选定的不可变镜像。

#### Scenario: 所选镜像满足 peer 范围
- **WHEN** 包声明了有效的 Pi 宿主 peer 范围，且 Operation 所选镜像满足该范围
- **THEN** 版本检查允许继续准备，不修改包清单

#### Scenario: 所选镜像版本过旧
- **WHEN** `pi-subagents@0.71.0` 声明至少需要 Pi 0.86.1，而所选镜像提供 Pi 0.86.0
- **THEN** Operation 以 `PI_PACKAGE_SDK_VERSION_UNSUPPORTED` 失败，原有目录条目或 Work 选择保持不变

#### Scenario: peer 范围格式错误
- **WHEN** 已命名 Pi 宿主 peer 的版本范围为空或无效
- **THEN** Operation 以 `PI_PACKAGE_INVALID_MANIFEST` 失败，且不发布产物

#### Scenario: 接受请求后镜像标签改变
- **WHEN** 已接受的安装仍在等待处理，而配置的镜像标签改指其他镜像
- **THEN** 版本检查和冻结产物使用接受请求时捕获的镜像身份，而不是标签的新目标

### Requirement: OPKG-003 在接受请求前拒绝不兼容的 package-helper 镜像

对于新的 Core 或 Work 包安装或更新，Piwork **SHALL** 在接受 Operation 前确认所选准备镜像和可信 helper 镜像都能执行所需的 package-helper 契约。helper 缺失或不兼容时，**SHALL** 返回 `PI_PACKAGE_HELPER_INCOMPATIBLE`，且不创建新 Operation、不改变包状态。已接受请求若使用相同幂等键和相同请求内容重放，**SHALL** 返回原 Operation，即使任一镜像后来不可用或不兼容。响应 **MUST NOT** 暴露容器日志、宿主路径、凭据或子进程输出。

#### Scenario: 旧准备镜像缺少 helper
- **WHEN** 新的 Core 或 Work 包请求选择了缺少所需 helper 的镜像
- **THEN** 请求返回 `PI_PACKAGE_HELPER_INCOMPATIBLE`，且不存在新的 Operation

#### Scenario: 可信 helper 镜像缺少 helper
- **WHEN** 可信 helper 镜像缺少所需 helper
- **THEN** 新的包请求返回 `PI_PACKAGE_HELPER_INCOMPATIBLE`，且不存在新的 Operation

#### Scenario: 镜像删除后重放
- **WHEN** 已接受的 Core 或 Work 请求在镜像删除后，以相同 actor、scope、幂等键和请求内容再次提交
- **THEN** 响应返回原 Operation，`reused=true`，不再检查 helper，也不再次安装包

#### Scenario: 区分失败类型
- **WHEN** helper 缺失、清单无效，或有效的 peer 范围不满足
- **THEN** 各情况分别报告对应错误码，且不包含不可信诊断内容

### Requirement: OPKG-004 在真实 Work 中验收固定版本的在线包

发布验收流程 **SHALL** 使用 Pi 0.86.1 镜像，从真实 npm registry 将 `npm:pi-subagents@0.71.0` 安装到 Core，把冻结包复制到 Work，应用该 Work 的包选择，并观察其 `subagent` SDK 工具已注册。流程 **SHALL** 在前台调用该工具，并使后台子代理完成或显式取消；包与子进程均不得访问其他 Work 或 Core 存储。现有离线 npm/Git/本地 fixture 验收及测试 **SHALL** 继续通过。在线检查遇到网络或 registry 故障时，**MUST** 报告验收失败，不得作为成功的跳过处理。

#### Scenario: 已发布包运行前台子代理
- **WHEN** 固定版本 npm 包安装、选中并应用到配置了所需模型 fixture 的 Work
- **THEN** Work 报告包已加载、注册 `subagent`，且前台 `subagent` 调用通过真实 Pi SDK 返回已完成的子代理结果

#### Scenario: 已发布包运行后台子代理
- **WHEN** 已应用的包启动后台 `subagent` 子代理
- **THEN** Work 可以观察其终态结果或取消它；停止 Work 会终止任何仍在运行的子进程

#### Scenario: registry 不可用
- **WHEN** 在线 npm registry 在验收期间无法提供固定版本的包
- **THEN** 在线验收以 registry/网络诊断失败；离线 fixture 测试仍可单独报告

#### Scenario: SDK 升级期间保留旧冻结包
- **WHEN** 现有 Work 在升级到 0.86.1 期间保留针对其已捕获 0.86.0 镜像冻结的包
- **THEN** 该 Work 在显式更新前继续使用已捕获镜像和包字节；将产物移到 SDK 不兼容镜像时，沿用现有环境不匹配规则失败
