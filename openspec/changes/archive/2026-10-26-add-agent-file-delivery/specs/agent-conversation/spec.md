# Spec Delta

## ADDED Requirements

### Requirement: Agent 通过普通回复交付当前 Work 文件引用

**Identifier:** CONV-FILE-REFERENCE-001

支持本约定的 Agent SHALL 在实际模型执行上下文提供简短的文件交付指导，独立于是否启用 piwork-brain：通过既有获准能力核实生成或已有文件位于共享 workspace 后，使用普通 Assistant Markdown 链接交付，例如 `[报告.txt](piwork-file:/output/%E6%8A%A5%E5%91%8A.txt)`。无法核实文件时 SHALL 如实说明，不以链接文字冒充文件已生成或用户已下载。

`piwork-file:/` SHALL 表示所属回复所在 Work 的 workspace 根 `/var/data/workspace/`，后续各段按 UTF-8 URL 编码一次。引用 SHALL 不携带 Work ID、Core 地址、凭据、容器根路径或宿主路径，不接受 authority、query、fragment、根目标、空段、`.`、`..`、解码后的分隔符/控制字符或非法编码。合法字面百分号 SHALL 编码并只解码一次；路径边界继续遵循 WF-005。该约定只交付文件身份，不增加工具权限、隐式复制 workspace 外文件或新的 Agent 文件传输协议。

#### Scenario: 生成文件后提供可用引用
- **WHEN** Agent 通过已有工具生成并核实 `/var/data/workspace/output/报告.txt`
- **THEN** 实际模型可取得文件格式指导，回复提供指向 `/output/报告.txt` 的受控链接，原 Run 与工具记录仍按既有机制保存

#### Scenario: 未启用脑包或缺少文件能力
- **WHEN** Work 未启用脑包，或当前获准工具无法生成/核实用户需要的文件
- **THEN** 前者仍可获得平台文件引用指导而不隐式加载脑包；后者说明实际限制，不扩大工具权限或宣称已交付不存在的文件

#### Scenario: 路径编码与越界格式
- **WHEN** 文件名含中文、空格、百分号或井号，或候选引用包含其他 Work 的 authority、路径穿越、非法编码
- **THEN** 合法文件名按段编码且可一次往返还原；非法格式不被解释为文件操作或外部访问地址

### Requirement: 文件引用保留当前路径语义与原会话历史兼容

**Identifier:** CONV-FILE-REFERENCE-HISTORY-001

文件引用 SHALL 沿用普通 Assistant 文字事件、最终回复和 SDK 会话历史保存，不内联文件字节、不新增附件副本或结构化内容块。重新连接、重新打开会话及完整 Work 包导出导入 SHALL 保留原文字；导入后的链接按接收 Work 的相同相对路径解析，不依赖原 Work ID 或源 Core。历史读取和文件入口不得重放旧 Run、工具或文件写入。

引用 SHALL 指向点击时该路径的当前文件，不承诺发送时版本或读取/下载间的内容一致性快照；修改后重开读取当前内容，删除或改名后原引用可失效。原用户图片输入与私有图片历史 SHALL 保持 CONV-IMAGE-001 和 CONV-IMAGE-HISTORY-001 的独立语义，不与 workspace 文件引用混用。

旧 Agent SHALL 保持原聊天与文件能力；支持本约定的 UI 可以解析其真实文字中已有的合法引用，不伪造旧 Agent 已采用新指导。采用新版指导 SHALL 沿现有显式 Agent 镜像选择及 Apply 边界，不自动更新既有 Work 或为升级创建执行。

#### Scenario: 重开历史后文件已改变
- **WHEN** 原回复引用的文件被修改后用户重新打开历史，再点击该链接
- **THEN** 原回复文字保持，文件入口读取当前路径内容，不补造发送时副本或执行原任务

#### Scenario: 完整包导入另一个 Work
- **WHEN** 包含回复和对应 workspace 文件的 Work 完整包导入为新 Work，并由用户显式 Start
- **THEN** 链接在新 Work 内打开相同相对路径，源 Core 下线不影响解析，导入和查看本身不执行旧 Run

#### Scenario: 旧 Agent 和现有用户图片
- **WHEN** Work 仍使用旧 Agent，或用户查看原先发送给模型的图片历史
- **THEN** 原聊天和图片历史继续按既有契约工作，不自动换镜像，也不将用户图片变成可变 workspace 引用
