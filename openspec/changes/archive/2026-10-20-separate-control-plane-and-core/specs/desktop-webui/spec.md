# Spec Delta

## MODIFIED Requirements

### Requirement: 统一服务端提供完整远程工作台

**Identifier:** DWUI-HOSTED-001

统一应用 SHALL 提供仅凭服务器 IP 即可在另一台电脑浏览器使用的完整工作台，不要求该电脑安装 CLI/Docker、设置代理/DNS/hosts 或使用本机启动票据。托管模式 SHALL 复用既有 Work、Service、Files、Chat、模型/Thinking/图片、设置、包、导入导出和原 ID 恢复能力；页面绑定所属 Core，不提供修改服务器实例所属 Core 或读取宿主 CLI 凭证的入口。

托管 Service SHALL 使用当前 ControlPlane origin 的 `/services/<workId>/<serviceId>/<port>/` 路径入口，遵守 browser-service-access 的同源可信应用、动态前缀及服务端响应 Cookie 分区约束。Service 说明 SHALL 明确：应用与工作台同源，脚本可能以当前用户身份访问平台页面/API；任意根路径硬编码、document.cookie/Cookie Store 与服务端 Cookie 同步不在透明兼容保证内。CLI 本机 Service 模式保持自己的独立来源契约，不成为托管回退。

身份 SHALL 按独立浏览器会话解析，传输/暂存、缓存、已知操作及 Service 授权均绑定用户/会话。管理员只能以自己的用户身份访问 Work 内容；注销当前浏览器不清理其他独立登录，禁用/密码重置按 Core 撤销语义生效。托管 Inspect 使用已认证会话私有暂存，保持完整格式校验与不执行内容；独立 CLI 的匿名离线 Inspect 保留。

其他 DWUI 业务条款中的“本地/CLI 传输资源”在托管模式 SHALL 对应会话私有服务器资源，并保持原容量、流式进度、条件写入、取消、未知结果与清理语义；不得把上传换成服务器任意路径或绕过 Core。浏览器关闭、导航和断线不改变远端 Work/Run/Operation 生命周期。

托管浏览器的 API、事件流、文件上传/下载、图片、包和 Service SHALL 全部使用 ControlPlane 17891；只有后端连接 Core 17871。Service 的 entryUrl/basePath SHALL 携带完整目标路径，不从 origin 根重建。预览、复制、独立打开、深链接刷新、登录返回和错误恢复 SHALL 使用同一已授权目标；切换 Work/Service/端口后的晚响应不得覆盖当前入口，单纯布局改变不得重建 iframe。

#### Scenario: 远程完成完整工作流
- **WHEN** 用户从另一台电脑只用浏览器登录服务器 IP
- **THEN** 可以创建 Work、收到模型回复、访问受支持的路径入口 Service、使用 Files、修改配置并完成 Stop/Export/Inspect/Import/Start，Service 兼容限制明确可见，不出现客户端 localhost 或 desktop open 前置步骤

#### Scenario: 两账号并发使用
- **WHEN** 两个独立浏览器账号同时使用 Service、Chat、Files 和传输
- **THEN** 各自只获得自己的内容、临时资源和原 ID，另一账号的晚响应、退出和上传不能覆盖或清理当前身份

#### Scenario: 会话失效和未知修改恢复
- **WHEN** 原 Run/Operation 观察中断或托管会话被撤销，随后同账号重新登录
- **THEN** 旧内容连接失效，按原身份及 ID 核对，不自动重发 prompt、导入、包安装或文件修改

#### Scenario: 托管与本机客户端并存
- **WHEN** 同一 Core 同时被托管浏览器和原生 piwork-cli desktop 使用
- **THEN** 两种入口独立认证，CLI 凭证、偏好、本机 open/logout 和匿名 Inspect 不被服务器浏览器登录修改

#### Scenario: 多 Service 同端口独立寻址
- **WHEN** 同一用户同时打开两个 Work 的 Service，再刷新其中一个深层页面或独立打开
- **THEN** 均只请求 17891，各自路径携带正确目标，平台只读核验当前身份，不依赖最后打开的应用、其他标签页 Cookie 或 Referer 猜测路由

#### Scenario: 只有浏览器端口可达
- **WHEN** 独立客户端网络只能连接服务器 17891，无法连接 17871 和旧 Service 端口池
- **THEN** 托管完整工作流仍可完成，网络记录无浏览器直连 Core、旧池端口或容器 IP

### Requirement: Desktop 反馈按任务呈现且不堆积读取成功流水

**Identifier:** DWUI-019

Desktop SHALL 按 DUL-003、007 将反馈放在所属按钮、表单、列表行或功能模块，并将提交协调与可见反馈的保留规则分开。Open Work、切换模块、目录导航及普通读取成功后 SHALL 使用实际内容作为完成反馈，不生成或保留 `Work · 路径 · Checked/Confirmed · 原始 ISO 时间` 通用状态条，不跨目录堆积成功记录。正常背景读取 SHALL 不生成 toast 或反复播报成功。

实际请求尚在等待时 SHALL 在原上下文以骨架、就地等待或控件状态显示动作和目标、可访问的状态及 busy 语义，超过十秒仍未确认时如实说明仍在等待。Files/Chat普通读取（包括显式刷新且结果未变化）SHALL 在原控件结束等待并恢复普通状态，不增加成功条或toast；其他已有显式Check的简短确认 SHALL 保留在所属检查入口附近，不新增通用 Checked/Confirmed 条；普通成功提示至多显示三秒，不形成累计历史。同步写入可靠确认可显示 Saved 等简短结果；持久生命周期进展以 Work 状态及原 Operation 详情承接，技术 ID 和取得时间仍可按需查看。

失败、观察中断、未知修改及写入已确认但刷新失败 SHALL 有对象、可理解原因和安全下一步，不随成功提示到期被清除。提示消失不得释放未知锁、取消执行或丢失原 Operation。模块已有同一错误/进度时 SHALL 合并呈现，不再插入重复通用条；可恢复的错误在对应重查成功后清除。反馈更新不得移动或重载当前 Service iframe、覆盖编辑草稿，360px 及键盘操作仍可达。

Work 列表、Work、Services、Files、Settings、Session、详情和深链接首屏 SHALL 按同一规则呈现；进入路径本身不要求用户先点击检查。已有内容更新 SHALL 保留可读内容和取得时间，首次读取无数据时显示真实骨架，成功空集合才进入空态。后台读取不得插入通用 pending 条；需要影响准入的真实降级或不可达 SHALL 仍在所属模块持续呈现。
轻量状态、工具栏和选择反馈 SHALL 不让用户正在连续操作的命中目标无故移动；Files 从零选中到有选中及清空选择时，列表起点和对应行的选择目标位置保持稳定。同一服务的临时状态观察失败按 DWUI-002 保留实际视口，不能用整体替换状态页达到提示错误的目的。

受影响界面的完成与警告 SHALL 使用既有语义色、图标和简短文字，不重复输出同一结果的标题、长说明、状态条和toast。必要风险、失败原因、未知结果与下一步仍可见且可被辅助技术识别，不仅凭颜色表达。Files刷新SHALL固定在原控件显示busy，成功后恢复普通图标，不增加主区域顶部行；错误反馈不能随正常成功提示定时消失。

Modal footer SHALL 按DUL-007统一同类按钮几何与角色，正文按钮、菜单行保持各自职责。开关 SHALL 即时完成且不使用Modal动画、退场快照或延迟清理，同时保持原模态/非模态、Escape/外部关闭白名单、dirty guard与提交保护；旧异步结果不得影响新对象、新身份或新弹层。焦点恢复一次，背景无遗留遮罩；普通与减少动态效果设置一致。

#### Scenario: 多目录正常读取后不堆积
- **WHEN** 用户在同一 Work 依次打开根目录、apps、子目录，再返回根目录并切换 Services/Chat
- **THEN** 等待有局部读取反馈，完成后内容正常展示，没有 Checked/Confirmed 加 ISO 时间的状态条，没有跨目录成功记录堆积或背景读取 toast

#### Scenario: 手动检查未变化
- **WHEN** 用户显式刷新目录或检查 Work，成功结果与已有内容相同
- **THEN** Files/Chat普通读取在原控件结束等待并恢复普通状态，不新增成功条或toast；其他显式检查保持已有简短确认；失败时有可操作错误而非成功措辞

#### Scenario: 写入成功、未知结果及读回失败
- **WHEN** Save 已确认、修改响应丢失，或原操作已确认而对象刷新失败
- **THEN** 分别提供简短保存确认、持续的未知核对入口、或确认结果与刷新未确认说明；短提示到期不改变提交保护或重放任何修改

#### Scenario: 详情关闭与应用稳定
- **WHEN** 进行中的生命周期详情关闭、反馈到期，或状态刷新时当前 Service 有未保存输入
- **THEN** 原 Operation 从所属 Work/已知操作仍可查，正常反馈更新不重新加载 iframe；合法返回、独立动作及键盘焦点保持可用

#### Scenario: 文件多选反馈不推移目标
- **WHEN** 用户连续勾选 Files 中多个文件并取消最后一个选择
- **THEN** 操作反馈可辨且同一视口的列表起点/行选择目标不因工具栏出现消失而跳动，文件名打开与选择互不混用

#### Scenario: 文件刷新不产生额外成功行
- **WHEN** 文件刷新快速成功、慢响应、结果未变化或失败
- **THEN** busy在原图标按钮呈现、成功恢复普通图标且目标几何稳定，无重复成功toast；失败/未知仍有对象及安全下一步，不伪造成功

#### Scenario: 即时关闭与异步结果竞争
- **WHEN** 关闭时旧请求返回、立即重开另一弹层、切换身份/导航，或使用减少动态效果
- **THEN** 旧展示只清理原对象且不接受重复提交，新弹层和焦点不被旧回调清除；关闭最终无backdrop/inert残留，Export继续非模态交付

#### Scenario: Files缓存与首次读取的作用域
- **WHEN** 当前目录首次读取、缓存空目录背景读取、已有文件刷新或读取失败，而其他目录已有缓存
- **THEN** 按当前Work和目录区分静态占位/已确认内容/局部错误，保留工具栏、选中和滚动，不以其他目录缓存制造假空态；重试不重放未知写入

#### Scenario: Chat普通读取与执行状态分离
- **WHEN** 会话列表或历史背景读取、首次读取、失败重试，或activeRun首次检查
- **THEN** 原历史、草稿和阅读位置保持，普通读取无时间戳/通用状态行；初次静态占位，错误一次局部呈现与重试；activeRun真实loading在发送控制中性表示、发送仍按未确认锁定，失败/闲置未确认保留Check status，真实Run/断连/unknown提交不被隐藏

#### Scenario: 合法多入口与Desktop图标
- **WHEN** 用户切换服务、在详情选择多入口，或打开Desktop页面
- **THEN** Service主Header与选择器不展示端口，详情保留技术信息和合法入口选择；iframe及独立窗口路由与所选真实端口一致，favicon使用既有Piwork PNG并通过嵌入资源交付

#### Scenario: 首次骨架不显示普通加载文字
- **WHEN** Works、Work、Services、Files 或 Chat 首次内容尚未确认且没有真实错误
- **THEN** 骨架只呈现贴合内容区域的静态形状，区域名称与busy由辅助属性表达；未取得的Session/模型名称可使用对应字段占位，已有名称、真实错误和unknown设置恢复不被隐藏；仅延迟占位显现，不延迟可用内容，缓存刷新不换回骨架

#### Scenario: Service 入口归一与未完成导航不遮挡应用
- **WHEN** 已取得合法 Service entry，独立 CLI 票据 bootstrap URL 经预览检查归一为应用路径，或托管入口在保持完整 Service 前缀的情况下确认，或 iframe 的子资源尚未结束而应用已开始显示
- **THEN** Desktop SHALL 直接显示并保留同一 Service iframe，不以原始 src 等于最新 entryUrl 或 window.load 作为内容展示条件，不覆盖等待骨架；入口取得前可保留首次占位，真实 entry/预览失败与显式恢复入口仍可见，load 不表示业务就绪
