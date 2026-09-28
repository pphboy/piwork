# Spec Delta

## ADDED Requirements

### Requirement: 同时返回私网端点和 CLI 可访问域名

**Identifier:** WSRV-ACCESS-001

Core HTTP 与 Work agent gRPC 的 service list/show SHALL 对未删除服务返回相同 `access` 投影，同时保留既有 `endpoints` 的 `svc-<name>` 私网语义。服务无 TCP 端口、disabled、failed 或 Work stopped 时，仍 SHALL 返回稳定域名与准确状态；Core 未经授权不得披露该域名或完整服务定义。默认域名由 Core 内独立解析接口产生，后续策略可以扩展而不改变 service 身份；首版不接受外部自定义域名参数。

#### Scenario: 同一服务的两种地址
- **WHEN** 所有者和本 Work agent 分别查询已部署 HTTP 服务
- **THEN** 都得到相同的 access.hostname 与原 `svc-<name>` 私网端点，且访问状态与 service 当前状态一致

#### Scenario: 禁用后查询
- **WHEN** service 被禁用但定义保留
- **THEN** list/show 仍返回原域名和 `unavailable`，不暗示已发布宿主端口

### Requirement: 新服务容器使用稳定可读名称

**Identifier:** WSRV-ACCESS-002

新建或替换的 service Docker 容器 SHALL 使用 `<work-network-name>_<service-name>` 作为名称。系统 SHALL 先按受管 installation/Work/kind/service labels 查找和核验，旧版本已经存在的匹配容器 SHALL 原名接管，不能为了显示名而重建。目标名称已被不匹配资源占用 SHALL 报冲突，不删除或接管它。现有 Work 专用网络、`svc-<name>` 别名与不发布宿主端口的要求继续有效。

#### Scenario: 新容器的名称
- **WHEN** `notes` 首次运行于网络标识为 `w-a1b2c3d4` 的 Work
- **THEN** Docker 中只有一个匹配 service 身份的 `w-a1b2c3d4_notes` 容器，且无宿主端口发布

#### Scenario: 升级后接管旧容器
- **WHEN** Core 升级时 service 仍运行在旧哈希名称容器中
- **THEN** Core 按 labels 接管它，保持原名和运行状态；以后正常替换才使用新名称

#### Scenario: 名称被异物占用
- **WHEN** 目标 Docker 名称已由其他 installation 或非受管容器占用
- **THEN** 服务启动报告冲突，不误接管或删除该容器
