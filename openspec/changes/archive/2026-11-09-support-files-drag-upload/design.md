# Design

## Context

动机见 [proposal.md](proposal.md)，用户行为契约见 [desktop-webui delta](specs/desktop-webui/spec.md)。本设计满足 schema 中「需要预先确定交互与技术决策」的条件，保留设计产物。

当前生产 Files 由 `apps/desktop-webui/src/app.ts` 的 `files()` 与 `fileTarget()` 渲染；`src/files.ts` 的旧 `mountFiles()` 不是此次接入入口。现有 `upload` 动作捕获身份／Work／目录，`handleFiles()` 的 `upload-input` 分支完成核对、调用上传、保存逐路径结果并打开原覆盖对话框。`DesktopAdapter.upload()` 已按文件串行执行 HEAD、条件 PUT 和准入复核。外部拖放目前仅接在 `.composer`，用于 Chat 图片草稿。

权威约束为主规格 DWUI-006、DWUI-V13-STATE-001、WF-001/003/005/006 及 WMB-001/002/004/007；本变更增加入口，不修改其后端、结果或版本保护语义。

## Goals / Non-Goals

**Goals:** 两个输入入口交给同一上传提交路径；拖拽状态只负责临时提示和目标快照，上传任务、待覆盖 File、逐路径账本及未知锁仍由原所有者管理。

**Non-Goals:** 新建传输中心、后台队列、自动重试、浏览器文件系统授权、目录扫描或通用拖拽框架。A 原型不接真实后端，也不作为生产实现或验收替代品。

## Decisions

### 1. 落区限定为目录内容，采用已选 A 蒙层

用户已确认单／多文件、当前目录、松手直接上传及 A 方案。目录列表和空目录的空白区域属于同一落区，包含文件夹行；工具栏在落区外，因此面包屑与当前路径上下文始终可见。预览／编辑文件时不挂载该落区，返回列表后才接收。

蒙层是非模态局部提示，不是新对话框；绝对定位覆盖列表可视区域，内部 `pointer-events: none`，不重建列表、不触发列表滚动、不改选中和焦点。拖入时仅做局部提示更新，不在每次 dragover 重绘应用。内容为上传图标、「松开以上传到」与完整路径；路径可换行。只有明确接受覆盖等原有业务决定继续使用原对话框。

```text
+--------------------------------+--------------------+
| Files: /reports      Refresh  + | Chat               |
+--------------------------------+                    |
| +----------------------------+ | Existing content   |
| |      Drop to upload        | | and draft          |
| |         /reports           | |                    |
| +----------------------------+ |                    |
| File rows remain underneath   |                    |
+--------------------------------+--------------------+
```

视觉沿用现有共享令牌，集中强调「当前目录」这一空间关系，不增加常驻上传卡片。设计计划使用六个现有色值：surface `#ffffff`、ink `#1b2634`、muted `#526477`、border `#dce7f2`、accent `#0969da`、accent-soft `#eaf3ff`。字体沿用 Inter／系统回退，列表正文 14px，蒙层动作约 20px；仅路径使用现有等宽字体。普通内容左对齐，临时蒙层中的动作与路径居中。

设计复核：本次保留 Files 原有密度、白底和工具栏，把视觉强调集中在拖入时的局部蒙层。已比较的顶部提示条 B 未被选择，因为提示与实际可松手区域分离；不再为比较而扩大页面重设计或制作其他变体。

### 2. 新增一个窄拖放单元，共用原上传处理

建议新增 `src/file-drop.ts`，只负责外部文件条目判定、拖入／移出状态与目标快照是否仍匹配；直接测试该实际模块。输入为明确的只读身份代次、Work、视图、目录及可接收事实，输出为提示状态或已校验的 File 列表与原目标，不读取整份 view／adapter，不管理网络、账本或覆盖同意。

`app.ts` 负责 DOM 事件装配，并将原 `handleFiles()` 的 Files 上传分支收拢为具名共用提交操作，显式接收 File 列表、目标快照与原 ActionRecord。选择器与拖放都经过该操作及同一 ActionState 的 files 冲突判断，然后调用原 `assertFileAdmission`、`adapter.upload`、结果保留、覆盖确认和原目录重读。选择器仍核对其打开时捕获的目标，不以给隐藏 input 人工赋 FileList 或伪造 change 事件接入拖放。

```text
File picker -- original target guard --+
                                      +--> shared upload submission
File drop --- item + target guard -----+      |
                                             v
                                     DesktopAdapter.upload
                                             |
                                  existing results / consent / refresh
```

无需新增后端 API，也不复制 `adapter.upload`。共用路径必须保留当前 ActionRecord 的 `files` 分类、原上传进度匹配和结果归属；若为拖放增加动作标识，需同步 app.ts 中实际使用该标识的上传进度／反馈匹配，避免上传已开始但现有进度入口不再显示。

实施时补充的实际交互：用户已有文件选中状态时也可拖入；上传期间用同尺寸的原进度入口暂时代替工具栏的清除选择按钮，保留选中项与其他批量按钮，上传结束后恢复清除入口。拖放的等待状态投影到该进度入口，不额外插入状态行；错误、未知结果和读回失败仍由原反馈系统呈现。

### 3. 一次拖入绑定一个目标，接受与取消都要有界

第一次进入有效落区时捕获身份代次、Work、当前视图及目录；它就是蒙层显示的目标。松手及进入异步提交前核对快照，目标变化后本次拖入失效，不自动改投新目标。后续每文件准入仍交给原 adapter。

拖拽状态只在内存中存在。子节点间移动不清除外层提示；真正离开落区、drop、dragend、Escape、窗口失焦／页面隐藏、目标卸载或身份／资格变化时清理。可用拖拽结束信号在浏览器间不同，实施用边界离开与页面生命周期兜底，不依赖单一事件，也不增加轮询。

已有上传提交或待处理上传确认时不接受新批次，保留原 File、进度与账本；不新建排队策略。原未决目标锁按既有规则检查。本地拖拽提示不能释放任何业务锁。

### 4. 只读取条目类型，不读取文件正文或遍历目录

dragenter／dragover 阶段仅判断是否包含外部文件类型并展示当前目标，不假定此时能读取文件名和数量。drop 时同步取得拖拽条目与 File，检查条目是否为文件／目录；可用的只读 entry 元数据仅用于判型，不调用目录遍历或取得文件正文。不要依赖只在安全上下文可用的文件系统授权 API，托管 UI 可经普通服务器 HTTP 使用。

规划默认：混合拖入中有任一目录、不可读或不可判定条目，整批在开始上传前拒绝，提示使用原 Upload 选择器；不静默过滤。不能把 `size === 0`、空 MIME 类型或名字后缀作为目录判据。浏览器无法提供可靠判型时走相同回退，不添加依赖、浏览器授权步骤或目录兼容层。

### 5. 外层页面阻止文件打开，保留 Chat 的独立作用域

仅在 Files 列表当前可见时，Desktop 外层页面对本地文件 drop 阻止浏览器默认打开文件；是否提交由 Files 落区、资格与目标校验决定，不让全局监听直接上传。Chat `.composer` 仍走原图片草稿入口；两个处理器以明确目标判定避免一次 drop 同时消费。文字／链接事件不被 Files 捕获，不读取或修改 Service iframe 内容，也不承诺控制 iframe 自身的拖放。

### 6. 状态、消费者与同步范围

| 所有者／文件 | 本批责任与直接消费者 |
| --- | --- |
| `src/file-drop.ts`（新增） | 条目判定和临时拖拽目标；app 读取结果，不拥有任务或覆盖同意 |
| `src/app.ts` | Files 落区、事件装配、共用上传入口；继续管理原待上传 File 与弹层上下文 |
| `src/adapter.ts`、`src/action-state.ts`、`src/file-results.ts` | 复用现有执行／准入、提交冲突、账本和未知锁；只因实际接线需要做保持行为的调整 |
| `public/style.css`、`src/i18n/catalog.js` | A 蒙层和中英文提示；沿用 `apps/ui-shared/tokens.css` 与图标，不改共享主题 |
| `test/file-drop.test.ts`（新增）、现有 `feedback.test.ts`／`recovery.test.ts` | 独立模块正负例与真实页面事件／原上传契约回归 |
| workspace build → `internal/desktopassets/static/` | 实施时生成资源同步后重建 Core／CLI；不手改生成物 |

本轮按职责定位了 app.ts 的 Files 渲染（2227–2266）、上传目标捕获（4325–4329）、文件输入与结果处理（5355–5390）及 Chat 拖放（5898–5899）；adapter.ts 的 upload 链路（2872–2908）；action-state.ts 的冲突判断（45–100）；file-admission 与 recovery 中对应准入、目录绑定用例；共享 tokens、Files CSS、workspace 构建与生成入口。行号以本次基线为准。未要求理解完整应用，也未修改其他功能源码。后端协议、配置、部署和使用文档无行为变化，因此不新增 DTO／proto、依赖或 README／部署材料任务。

### 7. A 原型的单一实验

附件：[prototype/files-drag-upload.html](prototype/files-drag-upload.html)。双击即可打开；无需服务、账号、网络或依赖。它在合成 Work 的 Files／Chat 布局中展示 A，用真实拖入或底部模拟按钮验证「可松手区域及目标目录是否一眼可辨」。所有接收结果只写内存，不读取文件正文，不连接真实 Core。

建议试用四个场景：有文件列表时拖过 `drafts` 行；切到空目录后拖入；拖入后移出／取消或切目录；在长路径及窄屏下查看完整目标。底部原型控制条与状态文字是实验工具，不是生产 UI。Chat 是保留草稿的布局参照，不模拟图片上传。

原型来源为本变更新建的合成附件，参考基线源码 commit `a31f1bd4518a138d8d85e4dad7814b9de37893de` 的 Files 布局和共享令牌，不是生产页面截图。附件 SHA256：`ae240cd8d419c9ee52abe54ec57f2942077ec4f1c1b6eeb3562a56657f73ef17`。

2026-11-09 使用本机 headless Chromium 打开独立 HTML，在 1365×980 与 360×1100 视口完成 11 项原型检查：原更多菜单 Upload／Escape、列表几何与选择／Chat 草稿保留、内部子元素移动、文件夹行落下仍取当前目录、空文件、取消、目录变化、空目录、混入文件夹整批拒绝、停止／busy 拒绝，以及长中文路径与无脚本错误／无 HTTP 请求。截图为临时输出 `dist/support-files-drag-upload/prototype-a-desktop.png` 与 `prototype-a-360.png`，已人工查看宽屏及窄屏截图。

这些检查使用模拟按钮和合成 DOM 拖拽事件，只说明原型自身行为与几何；未执行操作系统文件管理器的真实拖拽、多浏览器矩阵、生产前端上传或 Core／Engine 上传验收。用户已在讨论中选择 A；尚未取得用户在浏览器实际试用后的观察，不能把方案选择等同于原型用户验证通过。

### 8. 规划复核

范围复核保留现有上传、版本保护、未知账本及 A 落点反馈；文件夹判型使用有界元数据与选择器回退，不增加目录遍历、后台队列或兼容子系统。没有为边缘情况增加额外持久状态，任务均对应上述三个新增 Requirement。规划阶段的 OpenSpec strict validate、仓库文档边界检查和新增附件 whitespace 检查通过；生产实现任务全部保持未完成。

## Risks / Trade-offs

- 外部拖拽的目录判型存在浏览器差异 → 不遍历、不猜测，无法可靠判断时拒绝本次拖入并保留选择器。
- 蒙层引起子节点事件反复进入／离开或被旧渲染重建 → 只在真实边界与上下文变化时更新提示，浏览器验证连续移动和取消；提示不接管焦点。
- 新入口绕过旧上传保护或覆盖原待确认批次 → 两入口共用提交操作，直接保留 ActionState 与逐路径账本，通过原 HEAD／条件 PUT、未知不重放与目录绑定用例回归。
- 原型仅模拟接收 → 分别报告原型检查、生产前端测试及真实 Core／Engine 验证，不能相互替代。

## Migration Plan

没有数据迁移。实施后运行现有 Desktop 构建同步嵌入资源，再重建宿主程序；通过现有托管与独立 Desktop 入口验证。回退时一并回退源、双语文案与对应生成资源，现有 Upload 选择器和文件数据不需要迁移。

## 实施验证（2026-11-09）

- Desktop typecheck、增量源码风格、WebUI／native 边界、双语目录、仓库文档、OpenSpec strict validate 和差异空白检查通过。原测试及相关直接单元测试 103 项通过；Files／Chat 定向浏览器回归 23 项通过，覆盖双语、360px、长列表、目录／身份变化、同名版本、失败／未知、停止及重复拖入。
- Fedora 42 amd64、Chromium 140.0.7339.186：在独立 Xvfb 显示中使用 Thunar 实际拖入文件，确认浏览器收到可信 drop、普通文件进入原上传链路；上传进行中再次实际拖入时，原任务保持，新批次被拒绝并说明原因。未覆盖其他浏览器或操作系统。
- 在独立 Core 数据目录及真实 Docker Engine 中，用本机 CLI Desktop 和托管工作台分别拖入合成文件；核对普通二进制、零字节文件、子目录目标、同名取消、服务端原始字节和未触发隐式 Start。实际 Thunar 拖入的文件也从真实 Core 读回一致；测试安装 `installation-429dfac266d7b873b8fee99117bcb64c` 的容器、网络和卷均确认清理。截图为临时输出 `dist/support-files-drag-upload/screenshots/files-native-drag.png`。
- 测试 Core／CLI 来自源码基线 `a31f1bd4518a138d8d85e4dad7814b9de37893de` 加本次未提交改动。使用已有测试镜像：Agent `sha256:c4085663627747682daa21b3514671e581358bcbc92317cfdf6e86d4077d19dd`、file helper `sha256:fdc759a59e9913cbc9ee57bab05e9ba3deb4522b8966a79fc7885a4679586da3`、snapshot helper `sha256:dc77f9eb6b1072b63ee727bec7ed51d4267cf1ac083d48c8b746ff3cbf81c324`，三者标记的源码 revision 为 `08fc54adda53a0c9ee71f66d3ec237050adf9be0`；不将它们称为本次构建的新镜像。尝试重建 Agent 测试镜像时 Docker Hub DNS 不可用，未取得新镜像。
- 首次真实 Core 和辅助 Go 集成诊断继承环境 `umask 077`，内置上下文准备失败；确认测试 helper 输入实际为 0700／0600 后，**仅对隔离验收进程**使用 `umask 022`，真实 Core 验收通过。首次失败的两处测试安装亦按各自 ID 清理；未修改生产的权限策略。本次未把上述失败诊断报告为通过。
- `make check-generated-ui` 通过；使用项目测试构建器同样的显式 `GIT_DIR`／`GIT_WORK_TREE` 运行 `make build-go` 成功，Core 与 CLI 资源从现有生成链同步。直接运行构建曾因本工作树 VCS 状态获取失败而退出，未将该次失败计为通过。
