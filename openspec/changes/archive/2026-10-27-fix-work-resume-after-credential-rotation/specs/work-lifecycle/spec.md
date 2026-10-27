# Spec Delta

## ADDED Requirements

### Requirement: 凭证变化后的恢复保持幂等与原恢复预算

**Identifier:** WLIFE-CREDENTIAL-001

Work 重新启动所用凭证与原代次材料不同且旧 Agent 已确认停止或不存在时，系统 SHALL 自动协调新运行代次与实例身份，并保持原操作选定 context、固定镜像、Work 持久身份、存储、Session/Run 历史及 active/desired/pending Apply 关系。仍运行且核验成功的原 Agent SHALL 按接管规则保留；状态未知、旧实例停止/删除未确认或文件/临时资源收尾未完成时 MUST NOT 启动第二个主 Agent。

显式 Start、Retry、Core 启动恢复及定时恢复 SHALL 使用一致的判断和切换规则。切换目标及其启动绑定 SHALL 在产生目标运行资源前持久记录，重复处理或中途 Core 退出后续行同一目标；旧实例删除 SHALL 遵守既有精确身份、停止证明和有界日志归档规则，未知归属资源不得被删除。

切代 SHALL 与现有 Work 控制版本、操作 superseded、Stop/Delete/Apply、快照及文件任务栅栏排序。后接受的停止或删除目标 SHALL 阻止旧恢复任务发布 ready，并收尾已受理或迟到的目标实例；原 active context 存在时，较新的 pending desired 不得因本次恢复被隐式应用。

凭证切代 SHALL 不授予新的自动恢复预算。新代次 SHALL 继承本次恢复链已持久的计数、窗口及退避约束，后续失败只记到当前有效恢复目标；旧代次不得继续排队重试。预算耗尽后轮换 Key、等待或重启 Core 均不能恢复自动重试，仍由用户显式 Retry；连续 ready 后的预算重置保持现行规则。期望 stopped 的 Work SHALL 保持停止，不因 Key 轮换被自动启动。

#### Scenario: 显式启动因轮换切代
- **WHEN** 已停止 Work 原代次绑定 Key A，Start 接受后解析为 Key B
- **THEN** 确认原实例停止并完成精确收尾，创建一个新代次，以原 active context 和持久数据恢复，通过完整 readiness 后完成原 Operation

#### Scenario: Core 重启恢复期望状态
- **WHEN** Core 优雅退出前保留 desired-running Work A 和 desired-stopped Work B，二者使用的模型随后轮换 Key
- **THEN** 重启仅恢复 A，必要时自动切代；B 保持 stopped，二者配置和持久身份不变

#### Scenario: 定时恢复与显式恢复一致
- **WHEN** Agent 已确认退出，模型 Key 已变化，恢复预算允许下一次定时恢复
- **THEN** 定时恢复执行与 Start 相同的材料判断及持久切代，新 Agent 使用本次固定凭证且旧代次不再被定时拉起

#### Scenario: 旧实例状态未知
- **WHEN** 发现凭证变化，但 Docker 无法确认旧 Agent 是否停止或删除成功
- **THEN** Work 保持未完成或失败并报告安全原因，不发布 ready、不启动新的主 Agent

#### Scenario: 切换途中 Core 崩溃
- **WHEN** 切换目标已持久记录，Core 在旧实例移除后或新容器创建后、结果提交前崩溃
- **THEN** 重启继续同一目标，接管或启动所记录实例，最终至多一个有效 Agent，不重复增加代次或重新执行历史 Run

#### Scenario: 切代时 Stop supersede
- **WHEN** 凭证切代过程中接受新的 Stop 或 Delete，或原恢复目标被更新的控制操作取代
- **THEN** 旧任务不能激活路由，已创建或迟到资源按最新目标收尾，不覆盖后接受的期望状态

#### Scenario: 自动恢复预算跨代次保留
- **WHEN** 原代次已消耗两次自动恢复，下一次恢复因凭证变化切代且新实例又失败
- **THEN** 不获得全新的三次预算，计数和退避按同一恢复链继续，旧代次不再单独重试

#### Scenario: 预算耗尽后显式 Retry
- **WHEN** Work 已耗尽自动恢复预算，管理员轮换 Key 并重启 Core，随后用户提交显式 Retry
- **THEN** 显式 Retry 前保持失败；接受 Retry 后按现行规则重置预算，按需切代并恢复，保留历史失败事实

#### Scenario: 快照或文件清理阻塞恢复
- **WHEN** 凭证已变化，但 Work 存在快照锁或未确认退出的文件/临时执行资源
- **THEN** 恢复遵守原栅栏及收尾规则，不因凭证切代绕过阻塞、创建冲突写入者或释放快照锁
