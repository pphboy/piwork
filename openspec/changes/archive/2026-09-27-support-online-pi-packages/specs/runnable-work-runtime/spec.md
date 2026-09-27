# Spec Delta

## ADDED Requirements

### Requirement: RUNTIME-PI-PKG-001 向包的子代理提供已捕获的 Pi 安装

在运行中的 Work 内，包启动的进程内和后台子代理 **SHALL** 能使用该 Work 已捕获 agent 镜像中的 Pi 安装；后台执行器 **SHALL** 能找到并执行该安装。子代理 **SHALL** 留在该 Work 的容器隔离范围内，且只使用该 Work 配置的模型访问权限和资源。它 **MUST NOT** 获得 Core 宿主路径、Core 操作员凭据、其他 Work 的上下文或不同 SDK 版本的 Pi 安装。停止 Work 时，包启动的子代理 **SHALL** 随容器终止。

#### Scenario: 前台子代理使用匹配的 Pi 安装
- **WHEN** 已启用的包从就绪 Work 启动前台 Pi 子代理
- **THEN** 进程内子代理使用该 Work 镜像中的 Pi SDK 版本，并能完成一次 Run

#### Scenario: 后台子代理始终属于当前 Work
- **WHEN** 已启用的包启动后台 Pi 子代理
- **THEN** 子代理保持在同一 Work 的隔离范围内，并能按包定义的生命周期完成或被取消

#### Scenario: Work 停止时仍有活跃子代理
- **WHEN** Work 停止时包启动的子代理仍在运行
- **THEN** 子代理随 Work 容器终止，不会作为宿主或 Core 进程继续运行

#### Scenario: 子代理无法发现其他上下文
- **WHEN** 包启动的子代理检查自身环境和已挂载资源
- **THEN** 其中没有 Core 操作员凭据、Core 包来源路径或其他 Work 的上下文
