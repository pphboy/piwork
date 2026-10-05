# Spec Delta

## ADDED Requirements

### Requirement: 专注与全屏仅改变已授权 Service 的容器布局

**Identifier:** BSA-FOCUS-001

Service 专注视图 SHALL 复用当前 Work/Service/端口的既有受保护入口和应用 origin，同一 iframe 的浏览器登录态、页面路径与输入不会仅因 Focus、Focus chat、Restore layout、Hide chat、Show chat、浏览器全屏或 Exit focus而被重建。专注与常规布局共用同一 Chat Session；隐藏 Chat 不停止 Run 观察或执行。布局入口不是授权动作，不发 Start/Stop/Apply，不修改 Service 映射、访问资格或应用安全头。

专注工具栏 SHALL 保留 Service 名称、真实状态和 Exit focus，提供 Chat 显隐；仅 Service 模式保留此最小外壳。浏览器 Full screen SHALL 由用户单独请求，退出或请求失败仍保留专注视图。正常独立 Service 视图可提供仅 Service 的 Focus 与同样的返回/全屏动作；独立视图不为了 Show chat 创建或载入新 Session，需要对话时经 Back to Work 返回原 Work。直接打开禁止嵌入应用的标签页保持原应用界面，不注入专注外壳。

Focus chat 隐藏 Service 后，Exit focus SHALL 由仍可见的 Agent 头部承接，Restore layout 和直接退出不依赖已隐藏的 Service 工具栏；同一 iframe 与祖先保持连接，仅改变可见性，不重取入口或扩大访问范围。

无入口、真实失去资格、嵌入被拒绝与预览未确认 SHALL 沿 BSA-002、005、006 分别表达。缺少可嵌入入口不开放虚假专注预览；已有未确认 iframe 可保留专注布局但持续标明 Preview not confirmed。Work/Service 停止或身份撤销后连接仍按原撤销界限关闭，不用专注保留缓存网络资格；下一次页面导航按真实入口重新授权。失败或不可用时返回与独立打开回退仍可达。

本轮 SHALL 不保证跨源应用键盘事件传回外壳，也不保证应用自身重载、真实网络故障或另一个窗口的内存状态保存；持续可达的返回按钮是专注返回的可靠入口。浏览器全屏不改变上述安全和兼容约束。

#### Scenario: 切换容器保留同源应用状态
- **WHEN** 正常嵌入的应用已登录并填有未保存表单，用户切换专注、Chat 显隐和全屏后返回
- **THEN** 应用 origin、同一 iframe、登录与表单保持，未重新请求入口或重载文档，没有新增会话或生命周期请求

#### Scenario: 嵌入限制不被全屏绕过
- **WHEN** 应用明确禁止嵌入或没有声明的可用 Web 入口
- **THEN** 保留真实限制和独立打开方向，没有通过 Focus/Full screen 削弱策略、伪造成功或注入应用 UI

#### Scenario: 专注期间撤销资格
- **WHEN** 用户处于仅 Service 的专注/全屏视图且 Work 停止或会话被撤销
- **THEN** 活动连接按原界限关闭，最小外壳说明原因并保留返回，隐藏 Chat 不改变停止与授权事实

#### Scenario: 独立视图返回
- **WHEN** 用户从正常独立 Service 视图进入仅 Service 专注后返回
- **THEN** 恢复该窗口自己的 Work 身份和 Back to Work，没有自动加载对话；关闭该窗口不停止应用或 Run


#### Scenario: Service 隐藏后仍可退出
- **WHEN** 用户从 Service 专注进入 Focus chat 并恢复或直接 Exit focus
- **THEN** 出口始终可达，同一 iframe、origin、登录与表单保持，无再次入口授权、文档加载或访问范围扩大
