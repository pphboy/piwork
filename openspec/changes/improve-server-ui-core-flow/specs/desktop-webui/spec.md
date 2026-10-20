# Spec Delta

> 对应 M04 全入口接入。DWUI-012/013/014 的原对象锁、恢复与身份约束继续有效；复用既有状态，不新增业务流程。

## MODIFIED Requirements

### Requirement: 主流程的异步动作提供即时且归属明确的反馈

**Identifier:** DWUI-011

Desktop SHALL 采用 UIL-PENDING-001 的统一局部三点，并在有效动作开始后的首个可绘制机会、请求结果尚未返回时，显示动作、目标对象及正在读取/提交/上传/验证的英文状态；仅禁用按钮或改变颜色不构成等待反馈。按钮、表单、列表行、模块或传输区 SHALL 在原上下文呈现状态，等待区域提供可访问状态说明及 busy 语义。快速完成不得人为延迟；最终页面、对象状态或成功提示可直接成为完成反馈。普通菜单、搜索、选择、复制及无需读取的导航 SHALL 不被强制添加加载或 toast。

覆盖入口 SHALL 至少包括下表，鼠标、键盘提交、文件选择和深链接遵守同样规则；后台定时读取不能冒充用户刚发起的检查。

| 入口组 | 必须覆盖的动作 |
| --- | --- |
| 连接与身份 | Sign in、Sign out、Switch Core、Check connection/readiness、重试 Works 读取 |
| Work | Create、Start、Stop、Retry、Delete、Open、Check status、进入 Settings/深链接 |
| Work 模块 | Services/Files 读取与刷新、路径导航、Session 列表读取/创建/切换、Run 提交/取消/恢复 |
| Service | Start/Stop/Restart/Retry/Remove、详情及日志读取/刷新；浏览器入口按 BSA-005 |
| Files | 文本读取/保存/重读、上传/覆盖、建目录、Rename/Move/Copy/Delete、下载发起 |
| Settings | Save/Refresh/Apply、Skills 副本刷新、catalog 检查、AGENTS/JSON 文件读取、Pi Package 五种来源安装/更新/移除 |
| Work 包与恢复 | Inspect/Import、Export 准备、Download 准备/验证、原 transfer 查询与清理、Known operations、Operation/snapshot 查询、清除已完成记录 |

收到原 Operation/Run acceptance SHALL 立即展示其 ID、对象及 Accepted，不能等待后续 Work、列表、日志或配置读取才展示。执行状态 SHALL 依据真实 state/phase；不同动作不统一伪装成 Preparing，缺细阶段时显示该对象操作正在进行且保留原值。观察终态后 SHALL 提供所属对象的结果或返回/刷新入口，不把 succeeded 等同于另一能力已经 Ready、loaded 或浏览器已落盘。

同步修改已确认时 SHALL 立即保留并展示确认事实；需要关联读取时另行显示 Refreshing/Verifying，读取失败只说明当前数据未确认，保留原结果及只读恢复入口。没有可靠确认的修改 SHALL 区分明确拒绝与结果未知，保留输入和已有对象身份，禁止自动重发。手动检查成功且内容未变化时 SHALL 更新检查时间或显示此次已确认，失败不得使用成功图标/措辞。

普通导航和首屏读取 SHALL 立即建立目标页面的稳定外壳，使用稳定内容框架及固定的局部三点、Loading files / Loading conversation 等就地状态及 busy 语义满足等待反馈，不插入统一检查条。仅有本次授权身份下确认的旧数据才可先显示，并标明取得时间与正在更新；未确认数据不显示为空集合。并行模块读取 SHALL 独立收敛，不因某一模块失败而把整个 Work 退回检查页面。正常背景更新不抢焦点、不滚动或逐次播报。

覆盖 SHALL 同时包括本地/托管初始壳和会话检查、初次/手动Core连接检查、Session模型与Thinking读取/自动保存、Slash资源目录、图片草稿检查/历史图片、Chat Activity、默认Core偏好和About读取等独立状态。每次真实Core连接检查 SHALL 有可见的检查中及结束/错误状态并对同目标去重；文案为连接或检查Core，不表示Desktop会启动Core。检查失败转为准确恢复提示，不因此新增持续探测或自动进入行为。后台静默读取不逐次闪动，Files/Chat/Service的独立收敛、既有iframe及阅读锚点保持。

#### Scenario: 请求尚未返回的创建与启动
- **WHEN** 用户提交 Create Work 或 Start Work，请求被延迟
- **THEN** 原表单/Work 行在响应前显示提交动作和目标，重复入口不可再次提交，其他合法导航可用；接受后显示原 Operation，不预告 Ready

#### Scenario: 接受后关联读取缓慢
- **WHEN** Start/Stop/Delete/Apply/Package/Import/Export 已返回原 Operation ID，后续读取缓慢或失败
- **THEN** 原 ID 和 Accepted 已可见，读取独立呈现，不隐藏 acceptance、不宣称操作失败、不发第二次修改

#### Scenario: 读取不是空数据
- **WHEN** 用户打开 Work、Files、Settings、Session 或日志且请求尚未返回
- **THEN** 目标与读取状态可见，旧内容标记为最后已知，未确认列表不写成空集合/零计数；成功空集合、404 和读取失败各有不同的下一步

#### Scenario: Run 提交与请求取消
- **WHEN** 用户 Send 或 Cancel run，接受响应被延迟
- **THEN** 对应输入/Run 上显示 Submitting message 或 Requesting cancellation，保留草稿/原 Run；接受后显示真实 Run 状态，取消与成功竞争以真实终态为准

#### Scenario: 保存确认与读回分离
- **WHEN** 文件 PUT 或配置保存已被可靠确认，随后版本/配置读取失败
- **THEN** 已确认写入事实保留，界面明确版本/当前配置未确认，草稿和新编辑不丢失；不重复写入、不以旧时间授权下一次覆盖、不暗中 Apply

#### Scenario: 未变化的检查与快速完成
- **WHEN** 手动查询成功但返回相同状态，或请求立即完成
- **THEN** 查询确认时间/简短结果可辨，快速完成不增加人为等待；菜单与复制继续使用既有即时结果

#### Scenario: 自动Core检查有可辨结果
- **WHEN** 页面已完成浏览器会话检查，正在首次查询Core而请求尚未完成
- **THEN** Core连接区显示正在检查及三点，不能提前显示确定Connected；成功/错误后结束该等待，离线和Runtime未就绪分别说明，不声称正在启动Core

#### Scenario: 通用动作之外的等待不遗漏
- **WHEN** 响应设置自动保存、图片读取、Activity执行、默认Core偏好或About请求尚未确认
- **THEN** 各自原对象显示统一三点及真实阶段，完成/失败后停止；现有内容、iframe、草稿和阅读位置保持，不为此改写业务状态或重复发请求
