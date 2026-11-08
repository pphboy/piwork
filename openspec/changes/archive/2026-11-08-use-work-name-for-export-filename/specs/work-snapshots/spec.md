# Work Snapshots Spec Delta

## ADDED Requirements

### Requirement: 导出文件默认按 Work 名称命名

**Identifier:** WSNAP-FILENAME-001

Core 快照下载、托管浏览器工作台、独立 Desktop 和 CLI 默认导出 SHALL 使用安全处理后的源 Work 名称直接追加 `.work`，不默认使用 Work ID、snapshot ID 或固定的 `snapshot.work`。名称已有 `.work` 结尾时 SHALL 仍直接追加，不去重扩展名，不自动增加时间戳或编号。

文件名转换 SHALL 保留中文、正常空格和其他可用字符，将 `< > : " / \ | ? *` 及控制字符逐个替换为 `_`，去除名称尾部的点与空格；遇到 Windows 保留设备名 SHALL 在名称前加 `_`；处理后为空 SHALL 以 `work` 为基础名。此转换只作用于导出文件名，不修改 Work 名称或包内 `sourceName`。

HTTP 下载响应 SHALL 提供能正确表示中文等 Unicode 名称的附件文件名；名称中的路径分隔符、引号和换行不得成为路径、额外响应头或错误的响应头参数。浏览器 SHALL 使用响应提供的建议名称，最终路径与重名处理由浏览器下载设置决定。显式指定本地输出路径时 SHALL 使用用户指定值，继续遵守现有路径校验、完整包校验与无覆盖发布要求。

同一快照重试下载 SHALL 继续使用该源 Work 名称派生的建议文件名，保持原包内容、digest 与 snapshot 身份；保留期内源 Work 已删除的快照仍 SHALL 按原所有权与有效期规则可下载。

#### Scenario: 各入口使用可识别的名称
- **WHEN** 用户通过 Core、托管浏览器工作台、独立 Desktop 或未指定 `--output` 的 CLI 导出名为 `我的项目 Demo` 的 Work
- **THEN** 建议或默认文件名为 `我的项目 Demo.work`，不使用内部 ID

#### Scenario: 转换文件名特殊字符
- **WHEN** Work 名称为 `研发/实验:1`
- **THEN** 默认文件名为 `研发_实验_1.work`，原 Work 名称与包内源名称保持原值

#### Scenario: 处理尾部点空格与保留名
- **WHEN** Work 名称分别为 `项目. `、`CON` 或 `...`
- **THEN** 默认文件名分别为 `项目.work`、`_CON.work` 或 `work.work`

#### Scenario: 直接追加扩展名
- **WHEN** Work 名称为 `demo.work`
- **THEN** 默认文件名为 `demo.work.work`

#### Scenario: 下载名称不破坏响应头
- **WHEN** Work 名称包含中文、引号或换行
- **THEN** 下载响应仍是合法的附件响应，中文保留，非法字符安全转换，不产生额外响应头或路径

#### Scenario: 重新下载原快照
- **WHEN** 用户在保留期内重新下载原快照，包括源 Work 已删除的情况
- **THEN** 建议名称保持一致，返回原快照字节和 digest，不重新 Export
