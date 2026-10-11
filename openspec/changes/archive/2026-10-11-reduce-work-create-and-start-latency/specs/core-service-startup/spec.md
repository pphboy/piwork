# Spec Delta

## ADDED Requirements

### Requirement: 默认 Work 共享准备在 Core 就绪前完成

**Identifier:** CORE-WORK-PREWARM-001

Core SHALL 将当前实际默认 Work 配置所选 Agent 镜像的能力检查与默认启用包所需的运行环境探测纳入既有后台准备，不得只准备全局 runtime 镜像而遗漏管理员单独选择的默认 Work 镜像。对应默认准备完成并允许新建 Work 前，结果 SHALL 已可被同进程的第一个默认 Work 复用，不依赖脑包需要首次 seed、升级或已经安装。默认镜像 / 包选择变更成功持久化后 SHALL 重新调度必要准备；默认没有启用包时 SHALL 不为无包创建强制增加包环境探测依赖。

预热 SHALL 保持健康 / 状态查询可响应、单次准备十分钟预算、重试与配置代次规则、既有组件划分及 file / snapshot helper 降级语义，不创建默认 Work，不重置管理员的默认选择或脑包管理决定。Core 重启后的首次预热、未预热的新镜像、拉取和恢复时间 SHALL 分别报告，不能伪装成已经准备好的创建路径。

#### Scenario: 已安装脑包的安装重启
- **WHEN** 脑包已安装且默认选择有效，Core 重启完成后台准备并报告基础 ready
- **THEN** 第一个默认 Work 直接复用镜像检查和所需包环境结果，不在受理前重新导出镜像或创建环境探测容器

#### Scenario: 管理员显式选择空包列表
- **WHEN** 管理员默认配置不启用任何包且镜像运行能力有效
- **THEN** Core 保留空选择，不为预热重新启用脑包，无包 Work 创建不依赖包环境探测

#### Scenario: 默认 Work 镜像不同于全局 runtime 镜像
- **WHEN** 管理员持久化单独选择的默认 Work 镜像或默认包列表
- **THEN** 保存不等待完整准备，后台准备实际所选镜像及必要环境，准备期间状态反映当前默认选择，旧完成结果不能覆盖新选择

#### Scenario: 预热失败或配置换代
- **WHEN** 当前默认准备失败，或准备进行时管理员持久化新配置
- **THEN** 健康和状态仍可读，readiness 反映当前代次实际准备状态，旧代次结果不把新配置标记为 ready

#### Scenario: 非必需 helper 尚未完成
- **WHEN** 默认 Agent、所需环境和恢复已完成，而 file 或 snapshot helper 仍未准备好
- **THEN** 沿既有基础 / 交付 readiness 区分报告，已可用的 Work 能力不被非必需 helper 阻断
