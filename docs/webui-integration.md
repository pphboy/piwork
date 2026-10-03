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
