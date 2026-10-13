# 交付 ServeUI / DesktopUI 接入

## 来源与结果

本次使用 `PiWork-Desktop-Serve-UI.zip` 中的两套界面源码、共享样式和任务设计，使用 `PiWork-UI-Verification.zip` 核对交付说明。交付源码原本使用内存 adapter；正式页面已改用仓库现有 Go HTTP API。界面中的账号、Work、Service、目录、配置、Operation 与迁移结果均来自实际请求，移除了模拟登录、场景选择、样例应用和占位下载。

保留原生 DOM TypeScript 构建，产物嵌入 `piwork-cli` / `piwork-console`。运行这两个 Go 二进制不需要 Node，也不启动 Vite。Core 与 Pi Agentd 协议、生命周期和 `.work` 格式保持既有实现。

## 接入对照

| 界面模块 | 真实入口与语义 |
| --- | --- |
| Desktop 登录与连接 | `/_desktop/api/bootstrap`、`session`、`connection`、`login`、`logout`；平台 token 留在 CLI，浏览器使用本地会话及 CSRF |
| Works 与生命周期 | `works`、`works/:id`、`start/stop/retry/delete`；接收 Operation 后查询实际状态；Delete 默认保留数据 |
| Session / Run | `works/:id/sessions`、`runs`、原 Run 的 `events?after=`、`cancel`；NDJSON 按 sequence 去重、断流按原游标退避重连，保留未接受的草稿 |
| Service 访问 | `service-entries` 创建一次性入口，应用在独立 origin 打开；`.work` 为内部身份、本机链接为浏览器访问入口；不要求浏览器设置代理 |
| Service 管理 | 完整列表、Start/Stop/Restart/Retry/Remove、有限日志；禁用和没有 Web 端口的条目仍可管理 |
| Files | `/_desktop/files/works/:id/files/` 的真实 WebDAV；PROPFIND / GET / PUT / MKCOL / COPY / MOVE / DELETE；上传原始字节，UTF-8 编辑上限 1 MiB，覆盖确认、207 逐路径结果、未知结果先重读 |
| 外部 WebDAV | 提示独立启动 `piwork-cli proxy`，使用终端实际端口、用户名和临时密码；浏览器 Files 不依赖这一步 |
| Work Settings | `configuration`、公开 desired/active/pendingApply/runtime、Core Skill/Package 目录、Work Package 安装及更新；Save 与 Apply 分开 |
| Skill 副本刷新 | 现有 Core 的 `configuration/skills` 刷新完整选中集合；界面说明实际影响并确认，不声称只替换一个 Skill |
| Work Package 来源 | Core / npm / Git / 本地目录 / ZIP；真实 multipart 文件上传与 Core 校验，安装是独立 Operation |
| Inspect / Import | 文件上传到本机 CLI 后由现有解析器完整检查；明确 Import 才上传 Core；成功创建 stopped Work，Open 与 Start 分开 |
| Export / Download | desired 与 observed 均停止后显式 Export；按原 snapshot 校验真实包的长度、摘要和格式后提供浏览器下载 |
| 已知操作恢复 | CLI `known-operations` 按 Core/账号隔离记录；按原 Operation/snapshot ID 查询，暂停观察不取消执行 |
| Serve 身份与账号 | `/console/api/session/login/logout`、`admin/users` 及 enable/disable/reset-credential；管理员限制、最后管理员保护、撤销会话 |
| Serve 运行时 | `admin/runtime` 保存 agentImage/provider/model/credential；Key 只写且提交后清空，配置成功与 readiness 分开 |
| Serve Starting point | `admin/default-work` 的 partial PATCH；保留未编辑的公开配置、显式空集合及空 AGENTS.md；仅影响未来 Work |
| Serve Skills | `admin/skills` 真实目录上传及更新、enable/disable/delete；不可变名称、限额、默认引用保护 |
| Serve Packages | npm / Git / directory / ZIP（ZIP 发送原字节，directory 使用 multipart）、更新、启禁用与移除；addToDefaults 原子提交；响应丢失以同一 key 和 payload 恢复 |
| Serve Operation | `admin/operations/:id` 原 ID 串行观察及深链接恢复；仅查询 Core Package Operation，不提供全局历史 |

Service iframe 与其祖先在同一 Work/Service/port 的聊天、弹窗和状态更新中原地更新，保留应用的未保存输入。只有切换应用、端口或功能区才改变当前应用容器。应用 CSP/X-Frame-Options 仍由浏览器执行；禁止嵌入时直接打开应用标签页。

Serve 采用交付设计的 Overview / User access / Work setup 三个工作区与 Find operation 辅助入口。对应 UI-only OpenSpec 变更为 `integrate-delivered-webuis`；既有管理 URL 和业务动作保留。

## 样式与构建

- 公共颜色、字体和焦点：`apps/ui-shared/tokens.css`。
- Desktop 布局与组件外观：`apps/desktop-webui/public/style.css`。
- Serve 布局与组件外观：`apps/console-webui/public/style.css`。
- 真实接口映射：两个应用的 `src/adapter.ts`；交互与渲染在 `src/app.ts`。

```sh
npm run build -w @piwork/desktop-webui
npm run build -w @piwork/console-webui
make build-go
```

构建合并公共 tokens 与应用 CSS，同步浏览器模块到 Go embed。修改样式后需要重启对应 CLI/Console 进程；仅刷新页面不能更新二进制里的资源。Core 无需因 UI 修改重启。

## 验证入口与证据边界

```sh
go test -p 1 ./...
npm run test:browser -w @piwork/desktop-webui
npm run test:browser -w @piwork/console-webui
npm run test:real-core -w @piwork/desktop-webui
openspec validate integrate-delivered-webuis --strict
```

Desktop 真实验收需要 Docker、仓库的验收 Agent / file-helper / snapshot-helper 镜像和 Chromium。使用隔离 Core、CLI 与安装标签清理资源，覆盖创建、Service 交互/独立标签、聊天保持 iframe、二进制 WebDAV、未知写入、Save/Apply、Stop/Export/Download/Inspect/Import/Start 和恢复历史。Console 的真实验收覆盖用户管理、Skill 目录、运行时、默认配置、实际 Package 安装与刷新 Operation 深链接。

完整 `.work` 包含镜像，测试数据和下载准备可能超过 `/tmp` 可用空间。可通过 `PIWORK_TEST_DATA_ROOT` 为 Desktop 验收指定有空间的已有目录，不需要修改浏览器临时目录。截图位置可用 `PIWORK_TEST_SCREENSHOT_DIR` 指定；测试结束清理自身数据和资源。

交付的 [95 个追溯编号](ui-prototypes/delivered-acceptance-matrix.md) 是原型范围清单，原型文件路径与内存场景的证据仍属于交付包。这里保留全部业务模块和对应入口，但不把原型测试或静态代码对照计为所有异常状态的真实验收通过。实际结果以本仓库上述测试为准；没有增加系统 WebDAV 挂载/文件锁、任意网络代理、公网分享、自动读取浏览器页面或 AI 页面状态同步。

## 本次实测结果

- 两应用 TypeScript 构建、浏览器模块同步及 native Go 构建通过。
- `go test -p 1 ./...` 全部通过；增加带 scope Package 深链接后，Go CLI 回归再次通过。
- Desktop 浏览器契约 3/3 通过：本地身份与平台凭据隔离、生命周期及原 Delete Operation 保留、Service 独立 origin/应用登录/SSE/WebSocket/CSP 拒绝、WebDAV 和 Run 取消终态。
- Serve 浏览器验收 15/15 通过，包含 12 个 fixture 契约场景与 3 个真实 Go Core 场景；npm/Git/directory/ZIP 四来源均实际走 transport。
- Desktop 独立真实 Core/CLI 验收通过：完整导出下载、检查导入、停止状态、显式启动、持久会话和 Service 恢复；独立应用窗口观察 Work 停止；1440/1024/390 宽度无整页水平溢出。
- OpenSpec 严格校验与 `git diff --check` 通过。

测试仅清理自身安装标签和临时目录，未删除用户开发 Core 的 Work。上述结果不表示交付清单中每个异常状态都已单独实测。

## 数据完整性与恢复约束（fix-webui-data-integrity-and-recovery）

### Files：读取版本与写入意图

编辑器单独保存读取时的正文和修改时间，优先使用 GET 的 `Last-Modified`，缺失时使用该次读取已有的 PROPFIND 时间。目录刷新、脏草稿的重读不会替换这条编辑基线。保存用 `If-Unmodified-Since` 绑定原版本；成功后确认已保存正文的新版本，再用于下一次保存。保存期间继续输入的内容不会被误标成已保存。

412 与响应丢失都保留草稿，不自动重发 PUT。“Reread saved version”只读目标，以独立只读区域呈现服务器正文；“Overwrite this reread version”明确采用该版本作为下次保存基线，草稿仍由用户保留和编辑。没有可靠修改时间时提示无法保护并发变化，必须单独同意无条件覆盖。已保存但新版本未确认时同样不得伪造日期。

上传逐个传输原始 File 字节。HEAD 404 后使用 `If-None-Match: *` 创建；已有目标先记录修改时间，再让用户同意覆盖。确认后目标时间变化会重新要求同意，实际 PUT 带原确认时间。HEAD 失败不视为不存在；412/unknown 保留原 File 输入和结果供重读、重新确认。缺时间的覆盖明确提示风险。现有 Core 文件时间条件按秒比较，这不是文件锁、ETag、自动合并，也不保证同一秒内的修改冲突检测。

### Settings：一个完整公开草稿

Skills、Packages、AGENTS.md 和 Advanced 编辑同一个完整公开配置。简单表单更新对象，进入 Advanced 将其序列化；Advanced 输入保留 JSON 原文，在切换配置页签或任何 Save 入口统一解析并校验对象及集合/文本形状。非法输入不允许切页或 PUT，保留原文、错误和焦点，用户可修正或 Discard。

JSON/AGENTS 文件导入遵循相同规则。空 Skills/Packages 和空 AGENTS.md 是显式值；未编辑的 modelRef、MCP、工具等公开字段保留。同字段最后一次有效编辑生效。Save 仅保存 desired，再读取确认值；失败或未知响应保留完整非秘密草稿。Apply 仍是独立显式操作。

### Run：失效事件游标的历史降级

正常 NDJSON 按 sequence 去重，断流仍从原游标退避恢复。事件返回 410 后改为只读恢复原 Run 与 Session：立即串行 GET，活跃态约每两秒读取历史并替换展示；不再请求该失效游标，不从零重复事件，也不重新执行 prompt。遇到暂时失败按 2/4/8/16/30 秒退避，成功后恢复两秒间隔。

终态读取最终历史后停止；必要时使用原 Run 的 finalText 补缺，避免重复。最终历史读取失败保留已知内容及真实 Run 状态，并要求显式 reread，不能声称恢复成功。401/403/404、身份变化、观察对象变化或页面关闭停止本地观察并拒绝晚响应。用户取消 Run 是另一个服务器操作；历史降级不承诺逐 token 输出。

### Inspect：登录继续与身份隔离

本地上传开始即持有 transfer ID、来源 Core、本地会话、独立检查代次和导入状态。唯一保留例外是同 Core/同本地浏览器会话的匿名 ready、未提交检查进入首次登录；失败登录可重试，成功后回到原摘要。Sign in to import 是暂离检查，不删除包、不重新上传本地文件，也不自动向 Core Import。用户之后明确确认，使用原 transfer ID。

切 Core、已认证账号切换、显式登出、本地会话失效仍清除旧平台内容和检查身份；普通 Core 缓存不会借此跨身份保留。后端的凭据撤销规则未被绕过。

### 暂存检查：显式放弃与清理结果

Cancel、Escape、换包和上传中取消会停止本地观察、abort 上传并 DELETE 原 transfer ID。独立检查代次使旧回调不能恢复已放弃的包；DELETE 2xx/404 是清理确认，失败或丢响应保留独立 ID、未确认提示和 Retry cleanup，不阻止用户开始另一个尚未提交的检查。原生 CLI 回归直接检查暂存文件删除，而非只检查界面隐藏。

Import submitting/unknown/accepted 不走未提交包的 abandon；换包受阻，关闭只结束界面观察，不取消服务器导入、不重复 POST。原 transfer ID/Operation 保留用于已知操作恢复。页面关闭只能尽力清理；本机 CLI 的一小时 TTL、会话撤销和进程退出是兜底，不能被当作显式取消已经完成。

### Serve Package Operation：原值与显示标签

| Core packagePhase | 显示步骤 |
| --- | --- |
| queued | Accepted |
| source | Resolving |
| prepare | Preparing |
| validate | Validating |
| publish | Publishing |
| succeeded | Published |

仅 acceptance 回执显示 Submission accepted，Core phase 尚未报告，不伪造 `accepted` 阶段。`cleanup-pending` 单独提示清理待完成；failed/superseded 呈现真实终态和诊断，不点亮未来发布步骤；未知值明确显示 Unrecognized phase 并保留原值。观察是否停止以真实 state 为准。深链接、刷新、Find Operation 继续读取同一 ID，无整体百分比或包任务取消能力。

### Core 能力目录：局部事实与恢复

Skills/Packages 分别持有 loading/error/confirmed 和最近确认时间。响应必须是有效数组；缺失或畸形不能当成空目录。失败保留已读目录、Work 副本和配置草稿，只限制依赖该目录确认的动作；另一目录可以正常更新。合法空数组是成功，立即清除该目录错误并恢复合法动作，无需等待 session 定时器。Check catalog 提示来自实际结果，部分失败不显示整体可用。

目录检查不修改 Core 可达性、runtime readiness 或 Work 列表状态；普通 session 刷新也不清除目录错误、覆盖环境未就绪状态。Work 副本仅说明 Work 已保存内容，不等同于当前 Core 库。

### 本次修复验收结果

`fix-webui-data-integrity-and-recovery` 实施后实际执行：

- Desktop 完整浏览器测试 **18/18**：原 3 个原生 CLI 契约场景，加 15 个实际执行的 R1/R2/R3/R4/R5/R7 回归。包含跨秒版本冲突、脏刷新、二进制变化保留草稿、原 File 字节、失效游标的终态/活跃态/退避/失效身份、原 ID 登录继续、清理丢响应与强制晚 XHR 回调；原正常流去重及取消成功竞争继续通过。
- Serve 完整浏览器测试 **16/16**：原 15 个场景继续通过，新增真实 phase 枚举进度回归；包含 3 个真实 Go Core 场景，实际 Package Operation 深链接恢复继续通过。
- `go test ./internal/cli ./internal/filehelper`、`go test -p 1 ./...` 通过。原生新回归验证匿名检查经失败登录/成功登录继续使用原 transfer、明确 Import 才访问 Core、DELETE 后真实暂存文件不存在、清理不影响已接受导入、logout 清除私有文件。Go embed 模块路由回归覆盖新增配置与阶段模块。
- 两应用 `npm run build`、资源同步、`scripts/build-go.sh` 通过；运行二进制的浏览器链路无需 Node 运行时。
- 隔离真实 Desktop Core/CLI 链路通过：Service iframe/独立标签、聊天与弹窗保持 iframe 输入、WebDAV 二进制及未知写入、Save/Apply、Stop/Export/Download/Inspect/Import/Start、还原历史和 Service，1440/1024/390 布局检查通过。测试 Core/CLI 用 `PATH=/nonexistent` 启动，使用真实 Pi SDK 的确定性测试模型，不调用外部模型。
- `openspec validate fix-webui-data-integrity-and-recovery --strict`、`git diff --check` 通过。

真实 Desktop 运行命令（截图在忽略目录内保留，临时数据和本次安装标签的 Docker 资源由验收程序清理）：

```sh
mkdir -p .piwork/webui-recovery-verification/tmp .piwork/webui-recovery-verification/screenshots
PIWORK_TEST_DATA_ROOT="$PWD/.piwork/webui-recovery-verification/tmp" \
PIWORK_TEST_SCREENSHOT_DIR="$PWD/.piwork/webui-recovery-verification/screenshots" \
npm run test:real-core -w @piwork/desktop-webui
```

以上恢复异常由浏览器契约及原生 CLI/File helper 测试覆盖；真实 Docker 链路验证的是整条使用流程，不将所有异常都宣称为真实 Docker 单项验收。

## 主路径反馈约束（fix-webui-core-flow-feedback）

两套 UI 的 `action-state.ts` 只协调本页面请求，没有新增后台任务、自动重放写入或取消服务端操作。开始请求时在原对象区域显示目标与动作，十秒以后显示真实等待时长；完成只读检查时记录时间，即使数据相同也有反馈。`role=status`、`aria-live=polite` 和 `aria-busy` 用于读屏与键盘使用。失败使用信息/警示样式，不能用绿色完成标记包装未知结果。

### 对象锁与关闭

Desktop 同 Work 的生命周期提交与写入互斥，Files 修改串行；配置/Skill/Package 修改按 Work、Service 控制按 Service、Agent 提交按 Work、下载按 snapshot 协调。纯读取、其他 Work/Service、复制和 Close 不受整页锁限制。鼠标、键盘和文件选择经过同一协调入口。接受返回后释放提交锁，Start 尚在观察时可以显式提交合法 Stop；服务端原 Operation 的 superseded 才表示被取代。

Service 控制锁按 Work + Service 绑定，不包含浏览器端口；切换端口或关闭再打开详情不会形成第二个控制目标。入口准备与预览缓存继续按 Work + Service + port 区分，控制等待提示不因端口变化消失。

未知写入保留原对象及错误，必须先明确读取原对象。已确认结果与辅助刷新独立：刷新慢或失败不会重新写入，也不会改成“提交失败”。配置与文件按提交的草稿版本更新保存基线，保存期间新输入仍未保存；配置读取失败保留已确认配置和现有编辑器，只显示读取错误。Core/账号变更清除动作 generation；Work、路径、Service/端口、Session 和弹层变化使晚回调失效，不能切回原对象、复活旧弹层或释放新提交的锁。

Operation 查询不按当前页面 Work 批量解除未知锁；只有实际响应中的 Operation/Work 身份与原记录的业务身份匹配，才能核对对应记录。未知生命周期在 Work information 提供 Check original Work：原 Work 的有效响应必须确认 Start 的运行目标已达到 Ready/Degraded，或 Stop 的停止目标已达到 Stopped，才恢复对应准入；状态不匹配、返回另一 Work 或关联证据不足时继续保留未知。此核对不会恢复无关 Run、Import、Export 或 Download，也不会把原提交结果未知改写成成功。Download 只按原 snapshot/transfer 的 ready 事实恢复对应准备记录。

Serve Runtime 捕获原提交的 Key 输入节点，成功、失败和 finally 仅清理该节点；离开后返回的新编辑器使用新的视图归属，新 Key/草稿和新提交锁不会被旧 PUT/readiness 回调改变。原 Key 不进入动作记录，也不从后端回填。

Desktop 关闭下载视图只停止页面观察，原准备 POST 可继续；离开后的完成不自动打开下载。Inspect 保持既有独立暂存释放规则，已经提交/未知 Import 不清理或重传原意图。Serve 修改弹层在请求未确认时保留既有关闭限制；本地预检允许关闭，选择 token 会使晚读取无效。确认结果放入稳定页面，后续读取不再访问已关闭 dialog。自撤销账号优先回登录。

### 传输与 Service

Files 每个文件先 HEAD 检查目标，再用原 File 和原条件头发送 XHR；展示当前文件/总数、真实浏览器发送字节，发送完仍等待确认。逐路径失败/未知保留输入和结果，没有自动 PUT 重试。本地 Pi Package multipart 只量化浏览器到 CLI 的发送字节；CLI 校验与向 Core 转发是不可量化阶段。远端 npm/Git/Core 提交不显示估计百分比。

Download 在一次明确意图中预先生成 UUID v4，通过既有 `X-Piwork-Transfer-Id` 发一个准备 POST，同时串行 GET 原 transfer。尚未 claim 且 POST 未结束的首次 404 为准备中；观察失败暂停查询，可显式 Check transfer 恢复。准备结果和观察结果独立，已 ready 不被晚查询降级，内容入口只使用原已验证 transfer。仅提示 Download started，不能承诺系统文件已经落盘。

Service 入口缓存和反馈归属 Work/Service/port。入口失败有显式 Retry；有界检查结束仍 unknown 显示 Preview not confirmed，可 Check preview 或独立打开，不宣称 ready/blocked。反馈节点在 DOM 对齐前移除再原位呈现，避免移动 iframe 或其祖先使应用重载；已存在 iframe 的区域将等待反馈放在应用之后，有界检查的新提示也放在应用之后，防止异步提示改变应用顶部位置。独立窗口在用户手势内预留并立即隔离 opener；确实被拦截时保留安全本机链接与允许弹窗说明，异步授权失败关闭本次空窗。不放松 CSP/X-Frame-Options，不将 ticket 放入复制链接。

### 逐入口测试映射

下表中的 `feedback` 为 Desktop `test/feedback.test.ts` 或 Console `test/feedback.spec.mjs`；这些测试在真实浏览器中操作交付 UI，并按入口阻塞请求，验证等待阶段、目标、重复请求数量和确认后的独立读取。它们使用隔离 HTTP fixture，不把模拟响应计为真实 Core 业务执行。

| 编号 | 实际入口与证据 |
| --- | --- |
| D01 | feedback：Login、Sign out、Switch Core、connection/readiness、Retry Works；原生 CLI 浏览器身份隔离测试；R4 匿名 Inspect 经失败登录/首次同 Core 登录继续 |
| D02/D03 | feedback：Create、Start、Stop、Retry、Delete 分别阻塞 POST 和随后 GET；接受后合法 Stop；原生生命周期测试验证 superseded、失败 Stop 不提示 Retry、Delete 原 Operation 保留 |
| D04 | feedback：Open Work、Settings、Check Operation；深链接由 route Loading Work 协调；原生/真实 Core 导入后等待新 Work 页并断言 Start 按钮的目标 ID |
| D05 | feedback：Services、Files、路径切换与刷新，加载期间不误报空数据；Service/Files 异常及缓存由原生与 R1/R7 测试补充 |
| D06 | feedback：Sessions 列表、创建、选择，每个原请求单独延迟；确认创建先于对话读取 |
| D07 | feedback：鼠标和键盘 Send、Cancel、Resume，草稿版本及原 Run ID；R3 覆盖原 cursor、历史恢复、终态、403、身份失效和退避；真实 Core 覆盖 Pi SDK 对话与持久历史 |
| D08 | feedback：Service Start、Stop、Restart、Retry、Remove 五项；独立 Service B 在 A 请求未完成时仍可操作，A 的晚响应不能关闭 B 的详情；W1 覆盖延迟 Restart 后切换端口、重开详情仍仅一个控制请求 |
| D09 | feedback：详情初次日志读取、Refresh logs；原生 transport 验证有限日志，不承诺实时流 |
| D10 | feedback：准备失败 Retry、unknown 有界检查、Check preview、同 iframe/应用位置保持、popup 拦截、安全复制链接、用户手势/opener、授权失败空窗清理；原生 CLI 浏览器及 Chrome/Edge 验证应用登录、SSE/WebSocket、禁止嵌入与独立打开、停止回退 |
| D11 | feedback：文本 GET、条件 Save、Re-read/Refresh；R1 验证秒级版本冲突、412、脏刷新、新草稿、未知写入和明确重读基线 |
| D12 | feedback：HEAD 后逐文件上传、实际 HTTP 接收原始 PUT 字节/条件头、发送完成仍等待服务端确认；R1 和原生 CLI 测试补充覆盖/部分失败/未知结果与原 File 保留 |
| D13 | feedback：建目录、Rename、Move、Copy、Delete、刷新和路径读取；原生 CLI 覆盖真实 WebDAV 方法及 207 逐路径结果、文件下载发起；对象锁模型验证同 Work 串行而其他 Work 不锁 |
| D14 | feedback：Save、Refresh、Apply、Use current Core copy；保存确认与读取错误独立、新编辑保留；R2 覆盖完整公开 JSON/显式空值，真实 Core 覆盖 Save/Apply |
| D15 | feedback：Check catalog、创建/设置 AGENTS.md、Import JSON 的真实 File 读取与替换 token；R7 覆盖目录错误、合法空集合、部分恢复与草稿 |
| D16 | feedback：Core/npm/Git/Local directory/ZIP 五来源各自 install/update、Remove；本地 XHR 发送阶段与 acceptance 分开；原生 CLI transport 验证 multipart，真实 Core 验证实际 Work 配置应用 |
| D17/D18 | feedback：Inspect、Import、原 transfer 查询、cleanup、Export，分别保留 ID 与接受结果；R4/R5 和 Go CLI 验证匿名检查、明确导入、关闭/Escape、原暂存释放和晚回调；真实 Core 验证先 Stop 后 Export、下载、检查、导入和显式 Start |
| D19 | feedback：POST 未返回时 GET 已显示 bytes、关闭/导航/返回、观察失败与丢 POST 回复、ready 原 transfer 复用；`TestDesktopDownloadProgressBeforePreparationCompletes` 用合法 golden `.work` 和受控慢速 HTTP 验证并行查询、同 UUID、校验完成前内容不可下载 |
| D20 | feedback：Known Operations、Lookup、Refresh/Check、Resume observation、Snapshot、Clear completed；W2 覆盖未知 Start 后查询另一 Work、同 Work 无关 Operation、缺失身份、错误 Work 响应及原 Work 目标状态核对；原生 CLI 验证 ID/scope 恢复与非重放，暂停只停止观察 |
| S01 | feedback：Health、Verify runtime、Retry connection、Operation refresh/resume、runtime/defaults readback、Sign out；手动查询跨真实轮询间隔只发一次 GET；十秒仍等待和同值确认时间；原生 Serve 测试覆盖串行观察与离线恢复 |
| S02 | feedback：Skill directory、Package directory、Package ZIP、AGENTS.md 四入口；Checking selected files、提交限制、关闭/换源的晚读取失效；原生 Serve 验证实际目录和 ZIP transport |
| S03 | feedback：User create/enable/disable/reset，确认先于 Users GET、刷新失败只读重试、密码清空、跨页/新弹层晚响应失效；原生和真实 Core 覆盖最后管理员、自撤销会话与返回登录 |
| S04 | feedback：Skill add/update、Skill/Package enable/disable/remove，确认后 catalog/defaults 慢或失败不重新提交；文件名/提交身份由 fixture 验证，实际 multipart 字节由原生 Serve HTTP 接收测试验证；真实 Core 覆盖 Skill 目录及 Package 安装 |
| S05 | feedback：Login 防键盘重复、Runtime 保存与 readiness 分离、新非敏感草稿保留/key 清空、Defaults 保存及新编辑；W3 四个组合覆盖旧 PUT/readiness 成功与失败、离开后返回的新 Key/草稿及新保存锁；原生 Serve 验证 partial PATCH、未知结果 readback、Package 原 key/payload 恢复和四来源安装 |

协调器的六项模型测试还覆盖双向冲突、只读例外、无关 Work/Service、十秒时钟、接受后解锁、确认与刷新分离、身份清理、旧 token 不释放新锁，以及未知提交只由匹配对象/视图的显式读取解除。新增模型回归验证核对一条原记录时，无关传输与 Agent 未知锁仍保留，并拒绝旧身份记录。两个应用的协调语义保持一致，Desktop 增加按原记录核对及业务身份字段；它们各自的页面、输入和网络入口由上述浏览器测试覆盖。

### 本次验收结果与局限

- 初次实施 Desktop 完整浏览器测试 100 项：3 项原生 Go CLI transport、15 项既有恢复回归、5 项协调器模型、77 项逐入口/边界反馈测试。三个 WARNING 修复后新增 W1/W2 两项浏览器回归及一项原记录核对模型测试，合计 103 项。
- 初次实施 Serve 完整浏览器测试 45 项：16 项既有测试（其中 3 项真实 Go Core），29 项反馈、预检、确认/读回、草稿和等待测试。三个 WARNING 修复后新增 W3 四项回归，合计 49 项。
- 两应用 typecheck/build、Go embed 同步、`make build-go`、`go test -p 1 ./...`、本变更 OpenSpec 严格校验和 diff 空白检查通过。原生模块路由测试确认新 `action-state.js` 由两个 Go 二进制提供。
- 隔离 Desktop 真实 Core/CLI 使用真实 Pi SDK 确定性模型、Docker 和正式 helper，覆盖创建/生命周期、聊天、Service 交互/独立窗口、二进制 WebDAV、条件/未知写入、Save/Apply、Stop/Export/Download/Inspect/Import/Start、会话与 Service 恢复。Core/CLI 用 `PATH=/nonexistent` 启动；不用外部模型密钥，运行无需 Node。
- 桌面 Google Chrome 154.0.8037.97、Microsoft Edge 154.0.4258.53 用各自真实浏览器可执行文件执行同一原生 Service 用例。使用新的隔离 profile，未关闭安全策略或配置代理/PAC；验证正常预览、应用登录、Service origin 隔离、SSE/WebSocket、CSP 回退和独立应用标签。
- Desktop 与 Serve 分别在 1440/390 宽度验证十秒等待、长诊断换行、没有整页横向溢出；Desktop 还验证编辑器键盘焦点、选区和新草稿。真实 Core Desktop 链路补充 1024 宽度。读屏证据为 DOM 的 status/live/busy 属性，未宣称实际读屏软件验收。

本轮本地截图位于 `/tmp/piwork-feedback-screens/`（两应用等待/长诊断）、`/tmp/piwork-feedback-chrome-screens/`、`/tmp/piwork-feedback-edge-screens/`（受控 Service）、`/tmp/piwork-feedback-real-screens/`（隔离真实 Core 流程）。只有测试账号、确定性内容和模拟诊断，没有真实用户的配置、token、密码或 API key；截图不作为仓库构建依赖。验收日志同样仅保留受控测试数据，启动 ticket 会脱敏。

真实 Core 用例验证完整业务结果；延迟、回复丢失和晚回调由受控浏览器 HTTP fixture 验证。Playwright route 拦截不能据此证明 multipart 文件原始内容，字节断言放在真实 HTTP 接收/Go CLI 测试；它们也不证明所有异常都在 Docker 中逐项注入。进度不等于 Core 完成，浏览器发起下载不等于系统文件已落盘；直接 Service 应用页的实时内容仍由应用负责。没有新增 Core API、改变包格式、增加网络代理设置或引入后台自动重放。

WARNING 后续验收：W1/W2 在真实浏览器中延迟或丢失隔离 HTTP fixture 响应，统计实际请求数量；W3 的旧 PUT 使用延迟 HTTP 响应，readiness 用例在实际 fixture HTTP 读取完成后延迟 adapter 方法的首次完成回调，允许新路由按正常读取加载，专门验证旧回调不会清理新输入或释放新锁。这些都是前端异常回归，不宣称真实 Core 逐项注入上述异常。后续重新执行两应用完整浏览器回归、typecheck/build、Go embed 同步、相关 CLI/静态资源测试及 `make build-go`；既有真实 Desktop 和 Chrome/Edge 链路结果保留为初次实施证据。

复现本变更验收：

```sh
npm run typecheck -w @piwork/desktop-webui
npm run typecheck -w @piwork/console-webui
npm run build -w @piwork/desktop-webui
npm run build -w @piwork/console-webui
make build-go
npm run test:browser -w @piwork/desktop-webui
npm run test:browser -w @piwork/console-webui
go test -p 1 ./...
PIWORK_TEST_SCREENSHOT_DIR=/tmp/piwork-feedback-real-screens npm run test:real-core -w @piwork/desktop-webui
openspec validate fix-webui-core-flow-feedback --strict
```

Chrome/Edge 通过 `PIWORK_TEST_BROWSER_BIN` 指向对应可执行文件，`PIWORK_DESKTOP_SCREENSHOTS` 指定截图目录，执行 `node --test --test-name-pattern='Service in an iframe' apps/desktop-webui/dist/test/browser.test.js`。测试只删除自身安装标签与临时数据，不停止或清理用户 tmux 中的 Core/CLI 和 Work。

## Desktop 本地授权恢复

Desktop 的浏览器访问授权与 Core 账号登录独立。匿名页面不能继承 CLI 保存的账号；Core 离线也不等于浏览器 Cookie 失效。初始化先检查已有本地会话，有效时忽略并移除 fragment 中的旧 ticket；仅在无授权且有 ticket 时兑换一次，再检查 Cookie。启动链接五分钟有效、只能兑换一次；会话十二小时绝对到期，每实例最多 128 个有效会话，不自动驱逐。多个 open 以最后签发的未兑换链接为准，已有 Cookie 不受影响。

在运行 Desktop 的同一系统用户终端执行：

```sh
piwork-cli desktop open --port 17891
piwork-cli desktop open --port 17891 --no-open
piwork-cli desktop logout --port 17891
```

open 连接已有实例，输出新的启动地址并默认打开浏览器；不再启动监听、不切换 Core。logout 不需要 Cookie，清理该实例的 Core 登录，但不撤销有效本地控制会话。两命令在加载配置/凭证之前执行，因此其他目录、损坏的调用者配置或不同 Core 环境不影响恢复；禁止全局 `--core`/`--json`。端口默认 17891，合法范围 1–65535，重复 flag/额外参数均拒绝。logout 不接受 `--no-open`。

| 退出码 | 含义 |
| --- | --- |
| 0 | 帮助、open 成功（浏览器启动失败仍可手动打开）、logout 完成/当前无登录 |
| 2 | 参数非法 |
| 3 | 本机控制通道权限或安全校验拒绝 |
| 4 | 目标 Desktop 不存在或已退出；需启动该端口实例 |
| 5 | 协议/通道/超时失败，或注销的远端撤销/保存凭证清理未确认 |
| 6 | 原 desktop 启动时 HTTP 端口占用/不可用 |
| 130 | 用户中断辅助命令；不会停止已有 Desktop |

Linux 控制通道位于固定同 UID 私有目录，以 0700 目录、0600 单链接文件/socket、端口 flock、inode/实例标识和双向 SO_PEERCRED 保护。客户端不争抢服务锁；仅锁持有者清理已核验的残留，退出不删除共享目录或活动锁文件。协议单连接一次 JSON、16 KiB、十秒、最多 16 条连接；校验版本/端口/实例，拒绝未知/重复字段及尾随对象。不提供匿名 HTTP 恢复接口，元数据不保存平台秘密；同 UID 的本机进程具有与该用户 CLI 一致的权限，网页/Service/其他 UID 不能使用此通道。

| 动作 | Core 身份与保存凭证 | 本地浏览器授权 | Work/Service/已接受业务 |
| --- | --- | --- | --- |
| Sign out / desktop logout | 立即撤销内存身份，五秒内尝试远端撤销；条件清理捕获的保存凭证 | 保留有效 Cookie，可再次账号登录 | 不停止，不取消 |
| Reset browser access | 保留 | 经确认撤销此实例全部浏览器、ticket、派生连接及临时传输 | 不停止，不取消；已发送写入可能已提交 |
| desktop open | 保留 | 更新一个待兑换 ticket；已有会话保留 | 不改变 |

保存凭证清理失败显示“内存身份已清理、磁盘未清理”，阻止新登录/切换并保留一条有界捕获记录；再次实例 logout 重试条件清理，不删除另一 CLI 写入的新会话。离线注销的本地结果与远端未知分别报告，不能称远端成功。正常 Sign out 保持 Cookie；Reset 则清除所有窗口的本地访问，须再 open。

故障页显示 Checking browser access、Browser access required 或 Desktop connection unavailable，隐藏不可执行的 Account/Sign out/Inspect/操作记录入口，命令使用当前实际端口。Check browser access 只读核验，不自动重放登录、bootstrap、reset 或业务 mutation。CSRF 拒绝先核验 Cookie，有效则更新 CSRF 并让用户明确再次提交；兑换响应丢失先检查实际会话，Cookie 拒收单独说明。容量满须从已授权窗口确认 Reset 后重新打开；不弱化 Secure/HttpOnly/SameSite Cookie 属性。

### 本地授权恢复验收与证据边界

| 验收范围 | 可复现证据 |
| --- | --- |
| 命令在凭证/Core I/O 前分流、独立环境恢复、同 UID 实际进程 RPC、浏览器启动失败/辅助命令中断 | `internal/cli/user_desktop_recovery_test.go` 的 CLI/Helper 用例，以及 `native-auth.test.ts` 的实际 Go Desktop 进程 |
| 0700/0600、端口锁、陈旧资源、链接/硬链接/错误对象拒绝、HTTP 启动回退、inode 条件删除 | Go Recovery 控制资源/目录边界用例；不会改用户 tmux 的控制目录权限 |
| 十秒/16 KiB/16 连接、严格 JSON、UID、请求及响应实例/版本 | Go Recovery 协议、idle deadline、peer 与代次测试；idle 用例实际等十秒，不靠缩短生产限制 |
| 原子兑换、随机失败、128 上限、到期回收、并发 ticket、旧会话保留 | Go ticket 用例；native browser 覆盖重启失效和旧链接复用 |
| 浏览器异常与交互 | `local-auth.test.ts` 21 项真实 Chromium 页面配受控 HTTP 响应：初始化探测、去重、丢响应、Cookie 拒收、CSRF、离线、旧回调、Reset 影响确认、防重复和窄屏键盘操作；这些是受控故障，不宣称逐项注入真实 Core |
| 五分钟过期 | `native-auth.test.ts` opt-in 用例实际等待 300 秒再请求原生 Desktop，随后新 ticket 恢复；常规套件跳过此长用例，另行执行验收 |
| 清理、重试及保存凭证隔离 | Go Recovery 与既有 Credential Concurrent 用例，真实条件凭证存储；包括远端五秒边界、断开辅助连接后清理继续、同一清理并发复用、已无效会话、失败重试和新凭证保留 |
| 内容撤销 | Go 实际 HTTP WebDAV/Run 流在 reset 后两秒内终止；到期 observer、响应守卫、旧平台响应不能标成本地 Cookie 失效。Service SSE/WebSocket 接入独立取消登记，后台 Core resolve 阻塞时仍在两秒内关闭客户端与上游，旧 grant 拒绝，新授权恢复 |

复现：

```sh
npm run typecheck -w @piwork/desktop-webui
npm run build -w @piwork/desktop-webui
make build-go
npm run test:browser -w @piwork/desktop-webui
npm run test:browser -w @piwork/console-webui
go test ./internal/cli ./internal/client ./internal/desktopassets ./internal/consoleassets
go test -race ./internal/cli -run 'TestDesktop(Control|Recovery|Ticket|Logout|BrowserReset|Helper|ExpiredContent|Reset|ConcurrentLogout|ServiceRevocation)|TestNativeDesktop' -count=1
PIWORK_TEST_TICKET_EXPIRY=1 node --test --test-name-pattern='actually five-minute' apps/desktop-webui/dist/test/native-auth.test.js
PIWORK_TEST_LOCAL_AUTH_RECOVERY=1 PIWORK_TEST_BROWSER_BIN=<Chrome或Edge可执行文件> PIWORK_TEST_SCREENSHOT_DIR=<隔离截图目录> npm run test:real-core -w @piwork/desktop-webui
openspec validate fix-desktop-local-auth-recovery --strict
```

2026-10-03 本轮：Desktop 常规浏览器 **121 passed / 1 skipped**（唯一跳过为另行通过的五分钟实时时效用例）；Serve UI **49 passed**。Go CLI/client/embed 常规测试、上述变更范围 race 检查、typecheck/build 和 native 构建通过。额外执行整个 CLI 包的 race 检查，暴露两个既有 fixture 使用非原子共享计数器：`TestNativeProxyLostFileWriteResponseDoesNotReplay` 和 `TestServiceObservationRetainsIDsAndBoundsInflightPoll/stalled`；这些测试文件未在本变更修改，不能把该额外检查写成全包 race 通过，普通全包与本变更范围检查结果独立记录。

本轮保持 tmux 4 的 Core/CLI/Serve 实例及其用户 Work；native 构建只更新磁盘二进制。用户测试入口需在后续仅重启 Desktop 装载新版本，无 Core 数据迁移，亦无需重启 Core/Work。

完整真实 Core 流程还会导出/下载/再次 Inspect 大约 570 MiB 的含 SDK 测试 Work。并行流程在本机 7.7 GiB 的 `/tmp` tmpfs 触发过 ENOSPC/安全磁盘预留拒绝；恢复链路本身已通过。完整重跑将 `TMPDIR` 与 `PIWORK_TEST_DATA_ROOT` 指向同 UID 私有磁盘目录，不降低生产传输预留/容量检查、不删除用户数据，也不把磁盘错误记为平台授权错误。

最终真实验收：Google Chrome **154.0.8037.97**、Microsoft Edge **154.0.4258.53** 均用实际浏览器二进制、新隔离 profile 和真实 Go Core/CLI/Docker/Pi SDK 确定性模型完成全流程。先完成首次登录、含已用 ticket 的重复打开、清 Cookie 后同 PID 重签、两窗口 Reset、保留保存 token、Sign out 与 terminal logout 后重登、Core 实际撤销账号会话、暂停/恢复仅该隔离 Core 的离线恢复。两次日志均确认 `bootstrapPosts=2 / resetPosts=1 / businessWrites=0`（统计恢复阶段的主窗口），原 Work/Service 仍 ready、文件字节不变、原已接受 Run ID/持久历史存在；不会将已清理的终态 Run 页面缓存冒充运行中的观察。

随后两浏览器继续通过原完整流程：Service iframe 与独立标签、真实 Run 与保存历史、二进制 WebDAV、实际已写入但丢响应的单次 PUT、配置 Save/Apply、显式 Stop/Export、真实归档下载/Inspect/Import/Start，以及 1440/1024/390 布局。真实 Core 只使用独立测试账号、数据目录与安装标签，Node 仅为浏览器验收驱动；被测 Go Core/CLI 的 PATH 为 `/nonexistent`，Pi SDK 留在既有 Agent 镜像。本轮未读取/修改用户 `.env.test`，没有对 tmux 4 的 Work 执行生命周期操作。

成功截图分别在 `/tmp/piwork-auth-chrome-screens/`、`/tmp/piwork-auth-edge-screens/`；`06-auth-recovered.png` 对应恢复后 Work，`04-restored-work.png` 对应重新导入运行结果。日志 `/tmp/piwork-auth-chrome.log`、`/tmp/piwork-auth-edge.log` 为最终成功运行，启动 fragment 在诊断路径脱敏；日志和截图不成为生产构建依赖。

### 验证后修复回归（任务 6.1–6.3）

认证检查及 session GET 去重绑定 epoch 与认证检查序号；旧检查结束只清理自己的 pending 记录。受控浏览器测试延迟旧检查后完成新登录，确认旧响应尚未返回时 Works 已加载，新账号、草稿与锁保留，登录 POST 一次，且旧检查不能清掉仍进行中的新检查。这部分由 `local-auth.test.ts` 验证。

`TestDesktopServiceRevocationInterruptsBlockedResolution` 使用实际本地 HTTP 代理、SSE 与 WebSocket 升级，Core 测试端让后台 resolve 一直阻塞到取消；覆盖 Reset/会话到期与两种协议的四种组合。Reset 后 resolver、客户端、上游均约一毫秒内结束，到期约 250 毫秒内结束，断言使用统一的两秒截止时间。旧 grant 无法访问，保存的 Core token 保留，新 ticket/Cookie/grant 可恢复访问，Core 未收到业务写入。到期以测试中设置 session 到期时间触发生产 observer，不宣称等待了十二小时；此处 Core 是受控 HTTP 测试端。

`native-auth.test.ts` 的 accepted Import 用例由实际 Chromium 操作 Go Desktop 页面，通过原生 Inspect/Import 接口上传并核对 golden `.work` 字节。Core 测试端接受一次导入后，在首次查询原 Operation 时撤销账号会话；同账号重新登录后，从 Known operations 恢复并查询同一 ID，显示 confirmed result。包上传 POST、Import POST 各一次，登录 POST 两次，本地 bootstrap 总共一次，本地 Cookie 未改变，浏览器存储不持有恢复记录。该用例验证原生 CLI 的账号隔离持久记录与浏览器恢复链路；账号过期由受控 Core 注入，与上节 Chrome/Edge 的真实 Core 验收分开记录。

完整 Desktop 回归按文件串行执行，避免多个浏览器进程同时争用本机资源；命令如下。此前并行执行出现过既有反馈/编辑 fixture 的等待或定位失败，单项复跑均通过，不计作通过的全套结果。

```sh
npx tsc -p apps/desktop-webui/tsconfig.test.json
node --test --test-concurrency=1 apps/desktop-webui/dist/test/*.test.js
go test -race ./internal/cli -run 'TestDesktopServiceRevocationInterruptsBlockedResolution|TestNativeDesktopServiceEntry' -count=1 -v
```

本次最终串行完整回归为 **123 passed / 1 skipped / 0 failed**（124 项；跳过项仍为上节已单独验收的五分钟实时时效测试）。相关 Go CLI/client/embed 常规测试、包含新增 ServiceRevocation 的变更范围 race 检查、Desktop typecheck/build、`make build-go`、构建产物与 Go embed 逐文件比对、OpenSpec strict 校验均通过。日志 `/tmp/piwork-auth-review-desktop.log` 与 `/tmp/piwork-auth-review-go-race.log` 保存本次最终完整浏览器和变更范围 race 结果。

### 业务 401 回查与重新打开竞态（任务 6.4–6.5）

后续 verify 捕获原生浏览器在离线 terminal logout → open 后偶尔停在 Checking browser access；受控交错确认旧业务 401 的独立 session 回查会推进 epoch，使新初始化丢弃结果。这是前端恢复竞态，不能用一次偶然通过、延长五秒等待或强制整页刷新消除验收失败。

业务 401 现在复用带 epoch/认证检查序号的 `checkBrowserAccess`，过期业务请求不能启动或发布更新认证流程的回查结果；只有实际 session 确认平台退出才清理身份，Core 离线保留最后已知身份，本地 Cookie 失效仍进入本地恢复。初始化与检查结束时只处理自己的 Checking 状态；若已因身份清理失效且没有更新流程接管，显示 Desktop connection unavailable 和可点击的只读检查入口，不自动重发登录、bootstrap 或业务修改。

新增五项受控浏览器测试固定旧 401 回查、新初始化与新登录的返回顺序，覆盖既有 Cookie 进入账号登录、旧结果不清除新账号或草稿、初始化失效后显式检查恢复，以及当前 401 回查对平台过期/离线的不同处理。原生 Go Desktop 用例在离线注销后通过 `location.assign` 在既有标签页打开新地址，以 window 标记确认未整页刷新，并断言 bootstrap 计数不增加、三次显式登录各提交一次；默认五秒等待保持。

这些新增故障测试使用受控 HTTP/Core 响应；原生用例使用真实 Go CLI、Cookie 和 Unix 辅助命令，Core 仍为测试端。上节真实 Core Chrome/Edge 完整验收是此前记录，不作为本轮新增交错故障的真实 Core 注入证据。

本轮完整 Desktop 回归 **128 passed / 1 skipped / 0 failed**（129 项）；21 项 local-auth 全部通过，唯一跳过仍是此前单独通过的五分钟等待用例。相关 Go CLI/client/embed 常规测试与变更范围 race、Desktop typecheck/build、`make build-go`、静态资源与 Go embed 比对、OpenSpec strict 均通过。日志为 `/tmp/piwork-auth-initialization-desktop.log`、`/tmp/piwork-auth-initialization-local.log`、`/tmp/piwork-auth-initialization-go.log`、`/tmp/piwork-auth-initialization-race.log` 和 `/tmp/piwork-auth-initialization-build.log`。常规 Go 第一次执行在不安全对象 fixture 的端口元数据路径遇到已有对象（EEXIST），独立复跑完整相关包通过；没有删除该已有对象或改动生产通道安全规则。本轮只更新前端、测试、embed 与交付记录，用户 tmux 4 实例和 Work 保持运行；需后续重启 Desktop 装载新资源。

## Desktop Work 生命周期与反馈收敛（fix-desktop-work-lifecycle-feedback）

对应 DWUI-016—019 与 DUL-003/008。Desktop 不改变 Core 执行、协议或持久化格式。对象的 `desiredState`、`observedState`、`controlVersion` 和对象读取确认时间是事实来源；连接检查时间不能代表 Work 已确认。Operation 的接受/完成与 Work、列表的同步分别记录。

| 已确认事实或接受目标 | 界面状态 / 快捷动作 | 能力与恢复 |
| --- | --- | --- |
| provisioning / starting，运行目标 | Preparing / Starting；Stop Work | 原操作可查，尚不开放运行内容；接受后允许显式 Stop |
| Create / Start / Retry 已接受，但事实尚旧 | Create accepted / Start accepted；Stop Work | 保留最后事实，不写入 Ready；原 ID 继续查询 |
| Ready / Degraded，运行目标且无未决停止 | Ready / Degraded；Stop Work | 各面板再按真实能力准入；恢复后核验 Services、Sessions、配置与包，保留原选择 |
| Stop 已接受或停止目标尚未确认 | Stop accepted / Stopping；Check status | 新 Run、Service 控制、Apply 及文件修改不可提交；Settings 草稿编辑和保存仍可用；Last confirmed 是旧事实 |
| 停止失败 / 未知事实 / 对象读取错误 | Stop not confirmed / Unknown；Check status | 原操作与安全原因可查；不能导出或假定停止成功 |
| Failed，运行目标 | Failed；Retry Work | 查看原操作原因；用户显式重试，不自动 POST |
| desired / observed 均停止且无冲突 | Stopped；Start Work | 数据保留；Settings 可达；Export 仍要求确认停止 |
| Delete 已接受 / 确认删除 | Deleting Work / 移除 | 原 Delete ID 保留；对象缺失不能单独证明未知删除已成功 |

### 只读观察规则

可见页面对活跃已知操作与所属 Work 每两秒检查，当前 Work 常规事实与 Services 检查每五秒。原操作查询取得终态后仍保留 Work 和列表的同步义务；手动检查、自动轮询与恢复经过同一结果入口。读取失败不改写 Operation 执行结果，不清空旧列表，不重复业务写入。

每个对象及接受代次独立记录在途请求和下一次检查时间；某个对象完成后安排自己的下一次检查，不等待同轮其他对象或超时。仍使用共享四并发队列，已在队列中的其他对象先得到空出的名额。

Operation、Work、列表元数据 GET 截止十秒；同身份、同对象、同接受代次的在途读取合并，最多四并发。暂时失败连续最多四次，失败后间隔一、二、五秒；耗尽或明确 404/410 时暂停对应只读查询。显式 Check、重新进入对象或重新显示页面可重新开启有限检查。用户主动 Pause 的原操作只有 Resume 才重新观察；Pause/Close/Back 不取消远端任务。隐藏停止调度并取消本地元数据请求，身份切换清理旧观察资源。

Create、控制接受、known-operations 恢复、按 ID 查询统一建立 Work 与生命周期操作的关联。CLI 英文名称和 Core 规范 kind 均归一化；多原 ID 显示 Related operations，不能按历史时间猜当前目标。`localRecordSaved=false` 保留 acceptance、原 ID 复制和重载恢复限制提示。对象读取按身份、发起序号、本地接受代次及 Core controlVersion 合并；旧 Start 或旧列表不能覆盖新的 Stop、插回已删除对象或丢掉新成员。更高 Core 版本可反映另一客户端的真实目标。

清空已完成本地历史只移除展示及 CLI 本地记录；尚待 Work/列表同步的原 ID、已确认终态及接受代次独立保留。原 ID 在同步期间仍能打开详情并发起 GET，读回恢复后解除匹配意图及释放协调记录。清理只针对点击时选中的已完成 ID，新 Stop 和未知修改锁不随旧历史删除。

读取序号在实际发出共享 GET 时分配。同一请求被多个调用合并后仍只有一个序号；操作终态前开始的请求即使在终态后被重新等待，也不能充当终态之后的对象确认。另有用例确认：旧失败操作不会成为当前 Work 的失败原因。

### 反馈用途与验收入口

| 反馈 | 保留规则 | 验证 |
| --- | --- | --- |
| 普通目录 / 面板读取 | Waiting 时就地显示；成功后内容承接，无 Checked/ISO 历史条 | feedback.test.ts 多目录用例 |
| 手动 Refresh / Check | 单次简短确认，最多三秒 | action-state.test.ts 与 Files 浏览器用例 |
| 已确认写入 / 保存 | 原结果保留；简短提示最多三秒 | 既有保存、传输、Run 用例 |
| 已接受生命周期 | Work 状态及原 Operation 详情承接；不构造步骤或百分比 | 生命周期受控及 real-core 主路径 |
| 未知提交 / 错误 / 确认后读回失败 | 安全原因与恢复持续可达；到期不释放未知锁或删业务 ID | ActionState 未知锁、反馈 W2 及终态读回失败用例 |
| 技术详情 | 原 ID、真实 phase、最后事实与时间按需查看 | Operation 详情 / Work State details |

同一模块已经展示的错误不重复生成通用错误条。等待使用实际经过时间，不人为延迟快速响应。状态呈现不替换编辑草稿或同一可用 Service iframe。测试区分受控请求交错和真实 Core/Docker 执行结果；真实浏览器证据见下方验收记录。

### 场景追溯（25 项）

受控故障使用真实浏览器与可控 HTTP 响应，状态协调边界使用可控时间；`real-core.mjs` 使用真实 Go 二进制、Docker 与 Pi SDK 确定性模型。表中真实执行门禁须以成功的实际日志为准，不能从受控用例推出 Docker 结果。

| 需求 / 场景 | 可追溯证据 |
| --- | --- |
| 016 默认创建到就绪无需重载 | feedback Create 用例；real-core Create 列表 Ready / 详情 Ready |
| 016 停止接受而实际尚运行 | lifecycle accepted stop；feedback Create→Stop accepted；accepted Stop also prevents Apply，保存及编辑仍可用 |
| 016 准备期间停止 | feedback Create and Stop during preparation；D02 acceptance allows Stop to supersede Start |
| 016 停止完成后再启动 | feedback Start to Ready；real-core 同一 Work Stop→Start、哨兵和 Service 检查 |
| 016 创建校验拒绝和运行失败 | feedback create validation retains field；lifecycle failure recovery actions |
| 016 停止失败或真实状态未知 | lifecycle failure recovery actions；browser stopped failures out of Retry |
| 016 降级与删除 | lifecycle degraded/unknown 投影；browser Delete；real-core disposable Delete |
| 017 列表看到执行中变化 | feedback Create 列表 Preparing；reload persisted Stop 列表 Stopping→Stopped |
| 017 终态后 Work 查询暂时失败 | lifecycle manual terminal query；feedback terminal readback failure |
| 017 手动先于自动取得终态 | 同上，手动 checkOperation 后仍有独立 workSync |
| 017 清空历史后待同步的 Work 自动恢复 | lifecycle clear terminal history / clear snapshot new Stop；feedback cleared Start history；W2 清空历史后未知锁仍保护 |
| 017 独立失败、慢查询、耗尽 | adapter controlled clock B 102000/104000/106000；feedback browser B 跨三个两秒周期发布 Starting→Ready→Degraded，A 始终挂起；adapter failure backoff / panel exhaustion；既有 timeout/dedupe/max concurrency/cancel |
| 017 隐藏、返回列表、暂停 | feedback hidden page and user Pause；lifecycle identity observer release |
| 017 缺失对象、失败与空列表 | lifecycle empty list/Delete 404；browser missing Operation 单次查询 |
| 018 Create 关联原操作 | lifecycle local record failure；feedback original Create ID 与复制按钮 |
| 018 重载恢复停止 | feedback reload recovers original Stop through canonical kind |
| 018 多历史操作和类型差异 | lifecycle canonical types / multiple IDs；Related operations 按 Work 过滤 |
| 018 Stop 取代 Start，旧读回晚到 | lifecycle old snapshot/list/generation/version/terminal obligation；D02 Start→Stop |
| 018 切换对象/身份后旧结果 | feedback readonly callback after Core switch；local-auth obsolete check / identity tests |
| 018 未知提交及无关查询 | feedback W2；action-state unrelated unknown locks；原 ID 匹配才解除 |
| 018 本地记录保存失败 | lifecycle Create localRecordSaved=false；feedback 原 ID 及重载限制文案 |
| 019 多目录无成功条堆积 | feedback Files root→apps→child→root、Services 切换 |
| 019 手动检查未变化 | action-state confirmation expiry；feedback Files Refresh 提示消失 |
| 019 写入成功、未知、读回失败 | feedback configuration confirms before failed refresh；原文件条件写入/传输用例 |
| 019 关闭详情与应用稳定 | feedback close/reopen Services；browser live iframe 登录/SSE/WS；1440/360px 等待、键盘焦点与草稿 |

首轮验收（增量修复前）：Desktop typecheck/build、逐文件 embed 对比（10 个文件）、`make build-go`。相关 Go 门禁：`go test -mod=readonly ./internal/cli ./internal/client ./internal/desktopassets`。完整 Desktop 按文件串行执行 153 项，其中 152 项通过、0 失败，五分钟票据过期 1 项默认跳过；另以 `PIWORK_TEST_TICKET_EXPIRY=1` 单独执行该真实等待用例通过（301 秒），所以没有未取得证据的跳过门禁。结果日志：`/tmp/piwork-lifecycle-all-desktop.log`、`/tmp/piwork-lifecycle-ticket-expiry.log`、`/tmp/piwork-lifecycle-go-test.log`。

### 首轮执行命令与真实验收记录

2026-10-04 完成两种桌面浏览器的真实验收，均成功退出并清理各自 installation：

| 浏览器与实际版本 | installation | 日志 / 截图 |
| --- | --- | --- |
| Chrome 154.0.8037.97 | installation-fd1708d0d3e045aca1f01cdfb4b49e17 | `/tmp/piwork-lifecycle-chrome.log` / `/tmp/piwork-lifecycle-chrome/` |
| Edge 154.0.4258.53 | installation-23e79ce3d3d883c581090d6f3aef757e | `/tmp/piwork-lifecycle-edge.log` / `/tmp/piwork-lifecycle-edge/` |

```bash
npm run typecheck -w @piwork/desktop-webui
npm run build -w @piwork/desktop-webui
make build-go
npx tsc -p apps/desktop-webui/tsconfig.test.json
node --test --test-concurrency=1 apps/desktop-webui/dist/test/*.test.js
go test -mod=readonly ./internal/cli ./internal/client ./internal/desktopassets
PIWORK_TEST_TICKET_EXPIRY=1 node --test --test-name-pattern='actually five-minute' apps/desktop-webui/dist/test/native-auth.test.js
PIWORK_TEST_BROWSER_BIN=/tmp/piwork-feedback-browsers/chrome/opt/google/chrome/chrome PIWORK_TEST_SCREENSHOT_DIR=/tmp/piwork-lifecycle-chrome node apps/desktop-webui/test/real-core.mjs
PIWORK_TEST_BROWSER_BIN=/tmp/piwork-feedback-browsers/edge/opt/microsoft/msedge/msedge PIWORK_TEST_SCREENSHOT_DIR=/tmp/piwork-lifecycle-edge node apps/desktop-webui/test/real-core.mjs
openspec validate fix-desktop-work-lifecycle-feedback --strict
```

真实验收各自创建临时 Core 数据目录、CLI 凭证文件、独立端口及 installation。Go Core/CLI 以 `PATH=/nonexistent` 启动；Pi SDK 和确定性模型位于实际 agent 镜像内。本次镜像身份：

| 镜像 | SHA256 |
| --- | --- |
| piwork-agentd:go-migration-acceptance | 978371fd78494d94a1f7fc4b2712b558d6a6ed575600b826ea259252c24480c5 |
| piwork-file-helper:go-migration-acceptance | 5c84418b2369ccd7b0d4ceea5291410141956624c7b48b28a8a3bff7064c2938 |
| piwork-snapshot-helper:go-migration-acceptance | 78b2b557c3ae1de9c693a9a182e2df0a12d7487722e3393f298e5f05282ae60c |

每套真实脚本验证 Create→Ready→Stop→Stopped→Start→Ready，再显式 Stop 后 Export→下载真实 PIWORK1 包→Inspect→Import→Start→Ready，最后删除可丢弃的导入 Work。脚本先等界面确认，随后独立检查 Core/Docker。导入后的 Work 保留当前模块，脚本正常点击 Services 后验证预览，没有靠改默认页或整页重载补偿。

脚本记录的生命周期 POST 是：Create 一次、原 Work Stop 两次（两次显式操作）、原 Work Start 一次、导入 Work Start 一次、导入 Work Delete 一次；主路径 WebUI 文档重载为零。停止后按 installation + Work 标签检查无运行 agent/service/helper，Run 返回 WORK_UNAVAILABLE、Service restart 返回 FAILED_PRECONDITION、Service gateway 返回 SERVICE_UNAVAILABLE、workspace GET/PUT 均返回 409。再次启动后启用 Service 为 ready、禁用项仍 disabled，38 字节哨兵文件逐字节一致。Delete 的原 Operation ID 到 succeeded，Core 对象为 404，界面列表移除。

截图目录中的 `07-work-stopped.png`、`08-work-restarted.png`、`09-disposable-work-deleted.png` 对应停、启、删；`04-restored-work.png` 对应真实包恢复，`05-responsive-*.png` 对应 1440/1024/390px。受控等待/键盘/草稿用例另覆盖 1440/360px。截图只辅助观察；请求、字节、原 ID 和资源断言是通过依据。

清理逐项验证 installation 标签再删除，最后断言本次 containers/networks/volumes 全为零。用户 tmux 中的 Core/CLI/Work 不参与测试清理。限制仍是：只恢复当前 Core/账号已有记录的原 ID；没有全局操作发现或自动重提未知业务请求；自动元数据检查耗尽后须显式恢复。真实测试使用确定性模型，故障交错、超时与后台显示/隐藏由受控测试覆盖。

Go 回归首次遇到本地控制目录中一次端口文件重名，单独复跑通过（CLI 23.185 秒）；没有据此修改 Core/CLI 逻辑。构建与检查日志另见 `/tmp/piwork-lifecycle-build-go.log` 和 `/tmp/piwork-lifecycle-typecheck.log`。这些 `/tmp` 日志及截图是本次运行证据，后续清理可能移除；验收命令保留在此以便重现。


### Verify WARNING 增量验收（任务 6.1—6.3，2026-10-04）

本节是 25 个场景修订后的验收记录；上面的首轮 24 场景记录保留为历史。增量实现集中在 Desktop adapter 的终态协调记录、按对象观察调度及 Operation 详情读取。沿用原有 Core/CLI 协议和持久化格式；构建将新浏览器资源嵌入 Go CLI。

新增交错证据：

- adapter：清空 terminal 历史后仍保留原 Start ID/终态，503 恢复后清除接受意图、释放协调记录并恢复 Ready；原 Start POST 一次。清理期间的新 Stop、晚到的旧 Start 和身份清理分别验证。`/tmp/piwork-lifecycle-warnings-adapter.log` 共 20 项通过。
- 浏览器：用户实际点击 Start、Clear local records、原 Operation 详情及 Check，随后只等待后台 GET 恢复 Ready/Composer，Start POST 一次、无整页刷新。W2 同时确认清空历史不解除未知 Start 锁。`/tmp/piwork-lifecycle-warnings-targeted.log` 三项通过。
- adapter 受控时间：A 的原 Operation 在途时，B 在 102000、104000、106000 毫秒连续检查并发布 Starting→Ready→Degraded；五个元数据目标进入共享队列，列表得到释放的并发名额。另验证 102000/103000/105000/110000 四次暂时失败后暂停，五秒面板读取不能绕过耗尽；隐藏、主动 Pause/Resume 和身份切换保留对应边界。
- 浏览器受控 HTTP：A 挂起跨三个观察周期，B 的请求间隔在 1700—3000 毫秒内，列表连续显示最新状态；A 原请求仍为一次、没有生命周期 POST。`/tmp/piwork-lifecycle-warnings-feedback.log` 的 12 项 DWUI 交互断言通过，最终完整回归再次覆盖这些用例。

增量真实验收按 Chrome、Edge 顺序运行；各自使用新的数据目录、CLI 配置、端口和 installation：

| 浏览器与实际版本 | installation | 日志 / 截图 |
| --- | --- | --- |
| Chrome 154.0.8037.97 | installation-b4b2909cdb9a920b3333d9ed1617a3a5 | `/tmp/piwork-lifecycle-warnings-chrome.log` / `/tmp/piwork-lifecycle-warnings-chrome/` |
| Edge 154.0.4258.53 | installation-d86e3c3ed3f9e3458a053d7959452347 | `/tmp/piwork-lifecycle-warnings-edge.log` / `/tmp/piwork-lifecycle-warnings-edge/` |

两种浏览器都完成实际 Create→Ready→Stop→Stopped→Start→Ready，以及第二次显式 Stop→Export→下载→Inspect→Import→Start→Ready→Delete。每套 Create POST 一次、原 Work Stop 两次、原 Work Start 一次、导入 Work Start/Delete 各一次，主路径整页重载为零。停止时运行资源数为零，workspace GET/PUT 为 409；恢复后启用 Service ready、禁用项 disabled，38 字节哨兵完整保留。认证、Service iframe/独立窗口、Run、二进制 WebDAV、未知写入和配置 Save/Apply 同时通过。每套测试清理后的 containers/networks/volumes 均为零；用户 tmux 4 和其中的 Work 未重启或清理。

本轮构建通过：Desktop typecheck/build、10 文件逐字节 embed 对比、`make build-go`；Go CLI/client/embed 测试通过，CLI 实际耗时 23.522 秒，client 使用有效测试缓存，embed 包无独立测试文件。构建与 Go 结果分别在 `/tmp/piwork-lifecycle-warnings-typecheck.log`、`-ui-build.log`、`-embed.log`、`-build-go.log`、`-go-test.log`（统一前缀 `/tmp/piwork-lifecycle-warnings`）。

最终完整 Desktop 按文件串行回归共 159 项：158 通过、0 失败、1 项默认跳过，日志 `/tmp/piwork-lifecycle-warnings-all-desktop.log`。唯一跳过是实际等待五分钟的票据过期用例；本轮首次完整运行使用 `PIWORK_TEST_TICKET_EXPIRY=1`，该用例实际等待 300.903 秒后通过，证据在 `/tmp/piwork-lifecycle-warnings-all-desktop-initial.log`，使用同一份 UI/Go 构建。首次运行另有一个 Apply 测试断言误选三个并行等待提示，修正为精确匹配本动作反馈后完整复跑通过；没有修改 Apply 的产品实现。最后还对清空历史用例补强主页面 document 请求计数（明确排除借助整页重载），并复跑三项交错定向验收。因此无缺少证据的跳过门禁。

本轮实际使用的命令（日志和截图均在 `/tmp`，可能被后续清理）：

```bash
npm run typecheck -w @piwork/desktop-webui
npm run build -w @piwork/desktop-webui
make build-go
go test -mod=readonly ./internal/cli ./internal/client ./internal/desktopassets
npx tsc -p apps/desktop-webui/tsconfig.test.json
node --test apps/desktop-webui/dist/test/lifecycle.test.js
node --test --test-name-pattern='DWUI-' apps/desktop-webui/dist/test/feedback.test.js
PIWORK_TEST_TICKET_EXPIRY=1 node --test --test-concurrency=1 apps/desktop-webui/dist/test/*.test.js
# 精确定位 Apply 等待反馈后，完整串行复跑；五分钟证据保留在首次运行日志。
node --test --test-concurrency=1 apps/desktop-webui/dist/test/*.test.js
node --test --test-name-pattern='cleared Start|browser B publishes|W2 unrelated' apps/desktop-webui/dist/test/feedback.test.js
PIWORK_TEST_BROWSER_BIN=/tmp/piwork-feedback-browsers/chrome/opt/google/chrome/chrome PIWORK_TEST_SCREENSHOT_DIR=/tmp/piwork-lifecycle-warnings-chrome node apps/desktop-webui/test/real-core.mjs
PIWORK_TEST_BROWSER_BIN=/tmp/piwork-feedback-browsers/edge/opt/microsoft/msedge/msedge PIWORK_TEST_SCREENSHOT_DIR=/tmp/piwork-lifecycle-warnings-edge node apps/desktop-webui/test/real-core.mjs
openspec validate fix-desktop-work-lifecycle-feedback --strict
```

逐文件 embed 对比：遍历 `apps/desktop-webui/dist/browser/` 和 `dist/public/` 下除 `.ts`、`.map` 外的文件，与 `internal/desktopassets/static/` 相同相对路径进行字节比较，10 个文件全部相同，SHA256 记录见 `/tmp/piwork-lifecycle-warnings-embed.log`。Spec 的四项需求、25 个场景与上方 25 行矩阵逐项一致；strict 通过，全部 23/23 项 Tasks 完成。原限制保持：只恢复当前 Core/账号已知的 ID；没有全局操作发现、未知 POST 自动重提或跨页面自动同步 Service 数据。
