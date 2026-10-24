# Spec Delta

## ADDED Requirements

### Requirement: CLI 透明遍历会话历史并保持完整输出

**Identifier:** CLI-HISTORY-001

新版历史能力可用时，`session show <workId> <sessionId>` SHALL 在内部从最早内容遍历同一固定历史快照，合并全部消息分片及该 Session 的全部 Run 元数据，保持原命令语法和完整公开输出含义。`--json` 成功时 stdout SHALL 恰输出一个完整合法 JSON 值，保持既有 `session`、`messages`、`runs` 对象形状；不得把最近页当作全部历史、逐页输出独立成功对象或将进度混入 stdout。

客户端 SHALL 逐页处理，完整结果可超过通用单次响应上限；拼接不要求在内存中同时保存整份会话及其重复表示。结果全部验证前 SHALL 不向 stdout 发布貌似完整的成功对象。某页失败、超时、游标失效或用户中断时 SHALL 停止遍历并清理本次私有暂存，以对应失败或既有中断退出码结束，stderr 提供原 Work/Session 身份与只读恢复说明，不自动新建、提交或取消 Run。

旧 Agent 不支持时 SHALL 保留原可用命令行为并明确能力限制，无法完整取得的长会话不能返回成功或循环自动重试旧整份响应。帮助与语法检查仍在凭据、网络和暂存 I/O 前完成。

#### Scenario: 大历史的机器读取
- **WHEN** 用户对整份公开历史超过 6 MiB 且包含多页工具结果、图片描述和分片正文的 Session 执行 `--json session show`
- **THEN** 内部逐页完成同一快照，stdout 只有一个完整合法对象，所有公开消息和 Run 按原含义保留，无内部路径、图片原始字节或额外执行

#### Scenario: 中间页失败或被中断
- **WHEN** 已读取部分历史后，后续页失败、游标失效或用户按 Ctrl+C
- **THEN** 不发布半份成功 JSON，停止后续读取并清理本次暂存，按失败类别或 exit 130 结束，原 Session/Run 不改变

#### Scenario: 历史数量超出旧关联窗口
- **WHEN** 会话包含超过 1000 个合法 Run，且存在相同文字或同名工具的不同历史对象
- **THEN** 完整输出包含全部 Run，关联按真实身份保持，不合并不同消息或静默截断为前 1000 条

### Requirement: CLI 的大结果查询与观察使用有界响应

**Identifier:** CLI-HISTORY-RESULT-001

新版历史响应 profile 可用时，CLI 的 Run 查询、chat 完成确认、原 Run watch/cancel 及其结果恢复 SHALL 分离有界状态与完整结果读取。最终正文无论是否超过旧 JSON/gRPC 单次响应限制，SHALL 能按原 Run 身份分片取得，并保留既有命令输出形状和终态含义；原有流式命令的输出约定保持，不为分页另加伪终态。

受理重放及原键核对 SHALL 继续返回原 Run，响应表示变化不改变幂等内容。读取失败或观察中断 SHALL 仅结束本地读取并报告原 Run/Session 身份；显式用户取消才按既有契约取消执行，不能为读取大结果自动重发 prompt、重播工具或改写终态。容量超限、响应不完整和 JSON 非法 SHALL 有可区分的安全错误。

#### Scenario: 大结果的 show、watch 与完成确认
- **WHEN** 一个 Run 的最终正文超过 1 MiB，用户查询原 Run、观察其终态或完成 chat
- **THEN** 状态及终态事件保持有界，完整结果按原身份取得，命令无容量导致的虚假格式错误，无第二次模型执行

#### Scenario: 旧结果已经完成后核对接受事实
- **WHEN** 原受理响应曾丢失，客户端随后核对已有大最终结果的原提交键或显式重放同键同内容
- **THEN** 返回同一 Run 的有界接受事实，必要结果通过分片读取，原摘要和幂等命中不改变
