## REMOVED Requirements

### Requirement: 新服务容器使用稳定可读名称

**Reason**: 原要求包含旧 TS 哈希容器名称的升级接管场景，超出此次全新 Go 安装范围。

**Migration**: 由“以稳定可读名称管理当前安装的服务容器”完整承接，继续使用 WSRV-ACCESS-002 标识；保留当前安装崩溃后的受管身份核验与接管。

## ADDED Requirements

### Requirement: 以稳定可读名称管理当前安装的服务容器

**Identifier:** WSRV-ACCESS-002

新建或替换的 service Docker 容器 SHALL 使用 `<work-network-name>_<service-name>` 作为名称。系统 SHALL 先按当前安装中持久保存的 installation/Work/kind/service 身份及所需运行配置核验容器；同一受支持安装在异常退出后已有的匹配容器 SHALL 被接管，不能只因尚未记录创建结果而重建。容器名称本身不构成所有权证明。本次 Go 原生交付不要求从旧 TS 安装升级或接管其哈希名称容器。

目标名称已被不匹配资源占用 SHALL 报冲突，不删除或接管它。现有 Work 专用网络、`svc-<name>` 别名与不发布宿主端口的要求继续有效。

#### Scenario: 新容器的名称
- **WHEN** `notes` 首次运行于网络标识为 `w-a1b2c3d4` 的 Work
- **THEN** Docker 中只有一个匹配 service 身份的 `w-a1b2c3d4_notes` 容器，且无宿主端口发布

#### Scenario: 崩溃后接管当前安装容器
- **WHEN** Go Core 在创建服务容器后、保存完成结果前异常退出，随后以同一安装重新启动
- **THEN** Core 核验完整受管身份后接管原实例，保留服务身份和数据，不创建第二个实例

#### Scenario: 名称被异物占用
- **WHEN** 目标 Docker 名称已由其他 installation、旧 TS 安装或非受管容器占用
- **THEN** 服务启动报告冲突，不误接管或删除该容器
