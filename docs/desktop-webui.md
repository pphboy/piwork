# CLI Desktop WebUI

Desktop 是 Work 所有者在本机浏览器中使用的界面，由 Go `piwork-cli` 前台启动。首版验收桌面 Chrome 和 Edge 当前稳定版。运行 CLI 的机器需要到 Core 的连接，不需要安装 Node；浏览器不需要代理、PAC、hosts 修改或 Docker 权限。

```sh
piwork-cli desktop
piwork-cli desktop --no-open
piwork-cli desktop --port 18001 --no-open
piwork-cli --core https://core.example.com desktop
```

默认监听 `127.0.0.1:17891`，默认尝试打开浏览器。`--no-open` 只输出手动打开地址。远程 Core 必须用 HTTPS；本机 loopback Core 可用 HTTP。若端口被占用，可显式指定另一端口；命令不会自动换端口。`piwork-cli desktop --help` 不读取登录凭证，也不连接 Core。

CLI 必须保持运行，本地 WebUI 和 Service 浏览器链接才可用。`Copy local link` 是这台机器的浏览器入口，不是可发给其他电脑的公网地址；`Copy domain` 是 Core 映射的 `.work` 服务身份，直接使用它仍需现有 `piwork-cli proxy`。桌面界面不需要启动 proxy。外部 WebDAV 客户端仍按 [Work 文件访问](work-files.md) 使用 proxy 和该进程终端显示的临时 Basic 密码。

启动时 CLI 会打印一次包含本地引导票据的浏览器地址。只在自己的电脑上打开该地址；不要分享完整启动地址。浏览器成功打开后会从地址栏移除票据，并使用 HttpOnly 本地会话。复制 Work 或 Service 的本机链接不会包含票据。若首次引导票据已用或超过五分钟，请重新启动 desktop 取得新地址。平台 token 保留在 CLI，不需要粘贴到网页。

界面的 Core 地址默认沿用当前 CLI 配置和 `--core` 选择。保存的登录凭证只会用于其所属 Core；选择另一 Core 后需用该 Core 账号登录。`Core is unavailable` 表示连接暂时失败，界面保留最后确认的账号和时间；恢复后使用 **Check connection** 重新检查。确认平台登录过期会返回登录页，重新登录同一账号后可按原 ID 查 Operation。Sign out 会立刻结束本地内容访问，并尝试撤销共享的 Core 会话；若远端不可达，界面会说明撤销未确认。其他使用同一 Core token 的 CLI 进程也可能受到显式登出的影响。

Desktop 与命令行共用 [用户 CLI 凭证存储](user-cli.md#登录与-work) 的权限、归属和路径检查。不安全的现有目录或符号链接不会被自动修正或继续读取；登录保存被拒绝时不会建立已登录状态，并尝试撤销本次新取得的 token，原凭证保持不变。

关闭浏览器窗口不会停止 Work 或 Run。按 Ctrl+C 退出 desktop 只关闭本地入口和连接，不取消 Core 已接受的操作。重新启动后，应从新的启动地址进入；端口改变时旧本机链接失效。平台登录过期后可在 WebUI 中重新登录并用原 Operation ID 查询，不要重复提交未知结果的写入请求。

## Work 与 Service

Work List 提供搜索、创建、导入、状态动作和按 ID 查询 Operation。创建 Work 时，高级表单可指定基础镜像、Skills、Pi Packages、AGENTS.md 与完整配置 JSON；留空沿用 Core 默认值，选择高级设置中的 None 则传入显式空集合。Create/Start/Stop/Retry/Delete 先得到 Operation ID，界面随后只查询该 Operation；接受请求不代表 Work 已经就绪。停止后保存数据仍在，但 Service、Files 与会话运行不可用。删除 Work 默认不清理持久化数据；已记录的 Operation 仍可按 ID 查询。

打开一个 Work 后，Services、Files、Chat 和 Settings 位于同一面板。网页 Service 可在预览区使用，也可通过 **Open application in new tab** 打开带有 Work 返回入口的新窗口；该窗口会更新 Work 的停止状态。工具栏中的 **Service domain** 是 Core 的 `.work` 服务身份，**Copy domain** 复制该身份；**Copy local link** 是当前 Desktop 端口上的浏览器入口，仅适用于本机且需要 CLI 持续运行及有效登录。两者不是同一个 URL。预览被应用的 CSP 或 X-Frame-Options 拒绝时，界面会保留限制并提供 **Open application tab**；直接应用标签页在下次导航时如遇 Service 停止，会显示 Work 身份和返回入口。Service 的登录与存储由各应用自己的本机 origin 隔离；Desktop 不会把平台凭据交给应用。

浏览器入口只转发 Core 声明的 HTTP/ws 端口，支持应用自己的路径、Cookie、Basic/Bearer 登录、SSE 与 WebSocket；不承担 HTTPS/wss 上游、任意 TCP/UDP 或公网分享。应用若把 `.work` URL 硬编码在正文或脚本、依赖跨站 SSO 回调、要求上游 HTTPS，或通过脚本共享父域 Cookie，可能需要修改应用配置；Desktop 不改写响应正文，也不会移除应用 CSP。每个应用本机 origin 的 `/.well-known/piwork-local/` 留作授权入口；应用不能占用该路径。跨 Service 的 `.work` 跳转不会自动获准，应从所属 Work 的 Service 选择器打开。

**Manage Services** 保留禁用、失败和没有 Web 端口的 Service；详情可按状态执行 Start、Stop、Restart、Retry、Remove 并刷新有限日志。Stop 会把该 Service 持久设为禁用，Start 一个已停止 Work 里的 Service 不会自动启动 Work；移除 Service 不会删除共享 workspace 文件。日志是一次有界快照，遇到不可用或截断会显示原因。危险动作会确认目标并保留原 Operation ID 供检查。

Agent 对话只在用户提交消息时启动 Run。勾选 Service identity 只把选中 Service 的身份写入消息，不会自动传送页面 DOM、表单或登录状态。若希望 Agent 分析应用数据，请在消息中明确说明要读取哪些共享 workspace 文件或 Service API；实际可达范围取决于 Work 和 Service 的配置。

例如在 Chat 里写“读取共享 workspace 的 `/note.txt` 和 Notes Service 的 `/api/data`，比较并注明每条结论的来源”。Agent 只有在这些路径实际可达且工具调用成功时才能引用内容；Service 页面里的未保存输入、浏览器 Cookie 和 localStorage 不随消息传递。若文件或 API 不可达，回复应说明无法读取，不能称页面数据已同步。

## 文件、配置与迁移

Files 只访问当前 Work 的 workspace。可浏览、下载、上传、创建目录，并对同一 Work 内的文件执行编辑、重命名、移动、复制与删除。内置文本编辑器限制为 1 MiB UTF-8；二进制或更大的文件可下载后使用外部工具。离开未保存的文件草稿前会要求选择保留或丢弃。覆盖现有目标前会检查并要求确认；同一 Work 的并发写入会收到忙碌提示。WebDAV 的 `207` 可能代表部分成功，界面分别列出成功和失败路径；网络中断后的写入结果应先刷新核对。外部 WebDAV 仍通过 `piwork-cli proxy` 和临时密码连接，浏览器 Files 不需要该密码。

Settings 的 Skills、Pi Packages、AGENTS.md 和完整 JSON 都先保存为 Work 的期望配置，再单独 **Apply changes**。已保存、当前 active 和运行时 loaded 状态可能暂时不同。Pi Package 可从 Core catalog、npm、Git、本地目录或 ZIP 安装；本地文件先由 Desktop 以 Work 范围上传，再交给 Core 安装。浏览器目录选择只提供普通文件及相对路径，文件权限和符号链接不会保留；需要这些信息时请选择 ZIP。Core catalog 中可发现的包不等于此 Work 已安装。

配置的使用顺序是：在对应页面选择或导入内容 → **Save**（仅保存到这个 Work）→ **Apply changes**（创建独立 Operation）→ 等待 Operation 终态 → **Refresh status** 核对 active 和 runtime 的 loaded/modelVisible。Skill 列表的 Core catalog 只是可选来源；保留的 Work 副本在 Apply 前继续使用。Advanced 使用完整配置 JSON，可编辑镜像、modelRef、MCP、资源与工具策略；Core 会指出无效字段。Apply 遇到 Run busy 不会取消 Run，表单与 pending 状态仍在；已接受的 Apply 失败时按原 Operation 查看错误和回退状态，刷新配置确认 active。Apply 期间再保存的内容仍需下一次 Apply。停止的 Work 也可保存和 Apply 配置，Apply 不会自动 Start。

导入时先在本机完整检查 `.work` 包，检查无需 Core 登录；审核后才上传并提交 Import。显式名称冲突会定位到名称输入框，可改名或留空让 Core 自动命名。Import 被接受后先按原 Operation ID 等待；只有 Core 完成并确认新 Work 为 stopped，才显示分开的 **Open Work** 和 **Start Work**。关闭观察不会取消 Core 的 Import，未知提交结果先查原对象，不自动重发。

导出时先单独 Stop 并等待 desired/observed 均为 stopped，再点 **Prepare .work package**；Core 如仍有写入者或快照锁会给出准入错误，不会出现半成品下载。接受后保留原 Operation ID 和 snapshot ID，Desktop 校验原包长度、摘要及格式，最后提供浏览器下载。**Download started** 只表示浏览器已发起下载，不表示文件已落盘。下载中断可用原 snapshot ID 在 Work List 的 已知操作弹窗的 Snapshot ID 查询 重新准备；本地空间不足时也可改用 CLI 的 `work snapshot download` 并指定有空间的目标目录。快照过期需要用户重新决定是否 Export，界面不会自动重新 Export。包可能包含私有 Work 数据，请自行保管下载文件。

真实 Core 的阶段性浏览器验收结果与尚未通过的范围见 [Desktop WebUI 本机验收记录](desktop-webui-acceptance.md)。

本次交付界面的适配层、共享样式、实际测试范围和构建命令见 [两套 WebUI 接入记录](webui-integration.md)。
