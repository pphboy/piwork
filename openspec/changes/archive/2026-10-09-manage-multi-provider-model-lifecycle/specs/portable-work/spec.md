## ADDED Requirements

### Requirement: 模型按可移植协议身份解析

**Identifier:** PWORK-MODEL-001

模型管理 id、旧内部 Provider id、API Key、secret 引用、源执行授权及目录 enabled 状态 SHALL 不成为目标安装权限或需要复制的管理对象。包内依赖按协议、Model ID、规范化端点及执行必要的非秘密定义匹配目标已保存可用模型，不要求用户提供 Provider 或能力模板；不同协议的同名模型不视为相同。

既有 provider 字段 SHALL 只保留逻辑协议/SDK 提供方语义，不能写源管理 Provider 身份。目标导入受理固定目标授权，发布前重验启停与Key，失效明确拒绝，不复制源秘密或选择另一个默认。

未知模型的普通执行定义/来源与 Thinking 未请求事实 SHALL 明确保存；不能因目标 SDK 未收录而要求手工模板。已知模型定义/Thinking、旧缺省 Off 和新 null 普通记录严格区分。Session 偏好只在唯一可确认身份匹配时重绑，歧义保留历史及不可用偏好，不按名称猜测；历史 Run 不重放，源 executionBindingId 不恢复 live 权限。

模型依赖及私有描述 SHALL 采用显式支持结构并同步 Go/TS/helper 验证，未知字段/版本不忽略。无对应可用默认继续按 PWORK-004 受理前拒绝；旧读取器无法表达新普通模式时明确不兼容，新读取器保留旧事实。

#### Scenario: 不同安装的独立模型
- **WHEN** 源包要求协议 P、Model ID M 和端点 E，目标已配置同一执行身份但管理 id 不同
- **THEN** 使用目标模型及 Key，不复制源 Provider/目录或要求用户映射

#### Scenario: 协议错配或停用
- **WHEN** 目标只有另一协议同名模型，或匹配项停用/无 Key
- **THEN** 默认依赖报 TARGET_MODEL_UNAVAILABLE，不导入源 Key或偷偷改用其他默认

#### Scenario: 相同模型的多个目标配置
- **WHEN** 多个目标条目使 Session 偏好匹配歧义
- **THEN** 历史/Thinking 保留，偏好不可用，用户显式重选后继续

#### Scenario: 未知模型普通模式往返
- **WHEN** 自定义 ID 的普通 Session 与已知 Thinking 历史导出、导入、再导出并继续
- **THEN** 普通 null/旧 Off/已知档位事实保留，目标使用自己的 Key，支持环境可继续普通消息，无模板或历史重放
