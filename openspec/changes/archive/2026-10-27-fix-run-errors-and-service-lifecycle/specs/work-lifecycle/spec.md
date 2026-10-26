## ADDED Requirements

### Requirement: 临时服务清理遵守 Work 和 Core 生命周期

**Identifier:** WLIFE-TEMP-001

Work Stop/Delete、Agent 替换和 Core 关闭/恢复 SHALL 纳入已受理的 Run 临时 Service 及迟到实例清理，遵守现有 mutation 栅栏和有界关闭预算。确认不了实例停止或清理时 SHALL 保留未完成结果和可恢复记录，不报告已完成清理或虚假 stopped；一次失败不得跳过其他受管资源的停止尝试。清理中或 Run 已终结的临时服务 MUST NOT 因 Work/Core 启动被重新部署。

冷快照 SHALL 在无未确认临时收尾后才发布；不将原安装的 live Run 归属作为导入后执行权限。已完成的临时对象沿原历史和 tombstone 规则处理，普通 Service 的恢复与数据保持原语义。

#### Scenario: Stop 与临时创建竞争
- **WHEN** Work Stop 接受时临时服务创建尚在进行
- **THEN** 新创建被栅栏阻止，已受理的迟到实例被收尾；确认不了停止时不报告 stopped

#### Scenario: Core 在清理中重启
- **WHEN** Core 在临时服务停止或移除尚未确认时异常退出并恢复
- **THEN** 根据持久归属继续核对和清理，不重新启动该临时对象，也不把未确认结果显示为完成

#### Scenario: 冷导出遇到未确认清理
- **WHEN** Work 的临时服务清理仍 pending 或实例状态未知，用户请求冷导出
- **THEN** 不发布快照并说明清理尚未确认；清理完成后可遵循原有冷导出流程
