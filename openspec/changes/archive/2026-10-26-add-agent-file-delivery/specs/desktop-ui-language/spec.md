# Spec Delta

## ADDED Requirements

### Requirement: 文件交付入口与 Files 查看共用一个工作区路径

**Identifier:** DUL-FILE-DELIVERY-001

Assistant 文件引用 SHALL 作为进入同 Work Files 的导航入口，以文件名或短说明表达目标，按需提供英文 Open in Files 的可访问说明；不依靠 hover 才能发现主要动作。文件查看 SHALL 在既有 Files 主区域承载，保留路径、文件名、Back to files 和适用的 Download file/Download saved version；不为文件交付新增顶层附件中心、强制弹窗或第二套聊天会话。

图片 SHALL 作为只读预览呈现，文本继续使用既有编辑语义；其他文件的不可预览原因与下载入口 SHALL 明确。PDF 仅复用浏览器现成行为，不能为了文件预览要求用户安装查看器或等待转换。

从常规 Chat、辅助栏、Focus chat 和请求回复进入文件 SHALL 遵守 DUL-002、005、007、015 的容器、离开保护及返回规则；360px 下文件名/路径可读取，预览与下载不遮挡返回和输入，键盘可到达导航及下载入口。读取中在目标区域反馈，失败/缺失持续显示原因和安全下一步；正常读取成功以实际内容反馈，不堆积成功状态条。

#### Scenario: 交付文件并返回会话
- **WHEN** 用户点击回复中的图片或 TXT 文件名，查看后回到 Chat
- **THEN** 在 Files 查看真实文件，原 Session、草稿与阅读位置保留，返回及下载动作可辨，没有额外模型执行

#### Scenario: 窄屏和键盘访问
- **WHEN** 用户在 360px 或仅用键盘打开长中文文件名的入口并返回
- **THEN** 文件目标可读、焦点与返回可用，图片不造成整页横向溢出，主要动作不依赖 hover

#### Scenario: 无法预览仍有明确出口
- **WHEN** 目标是 PDF/其他普通文件、超限图片，或者读取失败
- **THEN** 所属 Files 区域表达原因，分别提供合法 Download、Retry 或返回；不把失败显示为空文件或强制发起下载
