# Spec Delta

## MODIFIED Requirements

### Requirement: Limit active execution per Work

第一版每个 Work SHALL 最多有一个 accepted/running/cancelling Run，不同 Work 可以并行。未显式请求 CONV-CANCEL-SEND-001 的不同提交与现有活动 Run 冲突时 SHALL 返回 WORK_BUSY；相同键的幂等重试不受此错误替代。

#### Scenario: Concurrent sessions in one Work

- **WHEN** 两个 Session 同时在同一 Work 提交不同 Run
- **THEN** 最多一个被接受，另一个返回 WORK_BUSY，不进入隐藏队列

#### Scenario: Separate Works run concurrently

- **WHEN** 两个获准 Work 分别提交 Run 且资源允许
- **THEN** 二者可同时执行而不共享活动槽或会话状态

## ADDED Requirements

### Requirement: 显式取消指定 Run 后提交新消息

**Identifier:** CONV-CANCEL-SEND-001

获准 Work 所有者 SHALL 能查询当前 Work 的真实活跃 Run，并通过显式携带指定旧 Run 身份的新消息提交，执行取消后发送。活跃查询 SHALL 为只读，返回所属 Work 的安全 Run 投影或已确认无活跃 Run；读取失败、旧实例及未支持能力不能伪装成空闲，也不读取其他 Session 全部历史或创建执行。该能力 SHALL 独立可确认，旧 Agent 与未携带取消目标的普通提交保持原能力、WORK_BUSY 和幂等行为，不自动更新运行镜像。

新意图 SHALL 在任何取消副作用前检查新消息、目标 Session/context、模型及 Thinking、输入模式、图片和权限，并校验指定旧 Run 属于同一获准 Work。取消目标 SHALL 绑定调用者明确传入的旧 Run，不因等待或读取期间出现新 Run 而改绑。旧 Run 可以来自同一 Session、另一 Session 或 Service；指定旧 Run 已终态且 Work 空闲时正常受理新消息，另一个不同 Run 已占槽时明确拒绝且不取消它。空或非法取消目标 SHALL 不作为隐式选择最新 Run。

系统 SHALL 将取消、实际收尾和新 Run 受理协调为一个有界操作，期间其他不同提交及后台自动受理不得抢占该次交接；仍保持每 Work 最多一个 accepted/running/cancelling Run。取消等待从请求停止到执行收尾确认最多 5 秒，达到上限且尚未确认停止 SHALL 返回明确超时，保留旧 Run 实际状态及活动槽，不创建新 Run，不在它稍后结束时延迟发送。等待期间不提前创建 accepted Run，不形成持久待发送队列；其他 Work 保持可执行。

新 Run 受理前 SHALL 再检查当前运行实例、Work 准入、Session/context 和已选模型的有效性；Stop、Delete、draining、Apply 关闭准入时不接受新 Run。已经明确取消的旧 Run 不因新提交失败而恢复。已选模型/Thinking 作为完整组使用，不混入等待期间随后编辑的设置；实际模型、Thinking、图片、Memory 和来源仍按既有新 Run 受理契约记录。取消关联未完成请求 SHALL 沿用 WAF-007 终止后续自动处理，不转换成暂停或自动恢复；业务 Job 和已提交数据不被推断为撤销。

取消目标 SHALL 纳入新提交的幂等内容，相同键同内容在受理后先返回原 Run，不再次取消或启动执行；改变目标、Session、输入或显式选择语义 SHALL 冲突。受理前相同键同内容的并发调用只协调一次，相同键异内容不得产生第二次取消；不同键的同 Work 并发交接明确冲突。未携带新字段的原请求摘要和历史重放 SHALL 保持原值。接受响应未知时 SHALL 支持按原键只读查询实际新 Run；没有映射不代表原调用已经失败，不得自动重发。

已接受 Run SHALL 继续独立于观察连接执行；任何用户身份/实例变化后晚到的接受事实只归属原对象，不继续以旧授权提交新执行。此能力 SHALL 复用现有 Run/请求终态与历史，不新增任务生命周期；5 秒上限约束取消等待，不承诺强制终止不响应取消的任意工具。

#### Scenario: 取消其他 Session 或 Service Run 后发送
- **WHEN** 所有者提交有效新消息并明确指定同 Work 的活跃旧 Run
- **THEN** 先请求取消并等待实际收尾，再在目标 Session 接受一个新 Run；取消关联未完成请求时阻止其后续自动续接，其他 Work 不受该交接阻塞

#### Scenario: 校验失败与越权目标
- **WHEN** 新输入、模型、图片、命令或 Session/context 不合法，或指定旧 Run 属于另一 Work/用户
- **THEN** 在取消前拒绝，不改变任何原 Run，不创建新 Run，不暴露另一 Work 内容

#### Scenario: 旧目标完成或被另一个执行取代
- **WHEN** 指定旧 Run 已终态，Work 分别为空闲或已由另一个 Run 占槽
- **THEN** 空闲时保留旧终态并正常受理；已占槽时返回明确冲突，不取消新出现的 Run

#### Scenario: 取消等待超过五秒
- **WHEN** 已请求取消但 5 秒到达时执行及受管任务尚未确认结束
- **THEN** 返回取消等待超时，旧 Run 保持实际 cancelling/终态及应有活动槽，无新 Run；原执行随后结束也不自动提交该新消息

#### Scenario: 后台和多窗口竞争
- **WHEN** 交接释放旧执行时后台尝试受理，或另一窗口同时用不同键执行停止并发送
- **THEN** 当前交接期间不接受后台或第二个冲突交接，最终最多一个新 Run，拒绝者保留原输入且不排队

#### Scenario: 幂等重放与取消目标变更
- **WHEN** 相同键同内容并发或在接受响应丢失后重放，或相同键更换取消目标
- **THEN** 前者最多一次取消和一个新 Run且受理后返回原结果，后者冲突；不把重放的目标改成当前最新 Run

#### Scenario: 新消息未受理或已经受理时断线
- **WHEN** 连接在取消等待中或新 Run 已受理后断开
- **THEN** 未受理部分受有界操作与当前授权/准入约束且不进入恢复队列，已受理 Run 按原身份继续执行；重连只读查询原 submissionKey，不自动再提交

#### Scenario: 取消期间生命周期或设置变化
- **WHEN** 等待期间 Work 关闭执行准入、实例/context 改变、所选模型失效，或用户编辑后续模型/Thinking
- **THEN** 失去准入或有效性时不受理新 Run且不复活旧取消；仍可受理时使用原完整选择组，不混用后续编辑

#### Scenario: 旧客户端与完整包历史
- **WHEN** 原客户端未传取消目标，或已终态的新旧 Run 及幂等映射经重启/完整包导入后读取
- **THEN** 原客户端行为和摘要不变，原历史保持可读且无迁移、自动补发、旧任务复活或隐式镜像升级
