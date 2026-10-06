# Serve 管理面板

面板外观遵循 [UI 语言](ui-language.md)；页面信息顺序、按钮位置和文案遵循 [产品语言](product-language.md)。后续浏览器 UI 也应同时核对这两份文档。

`piwork-console serve` 是独立进程。它与 Core 部署在同一台机器，通过 Core 的 loopback HTTP API 管理用户、运行时、默认 Work、Skill 和 Core Package。浏览器可以在其他设备上打开面板；Core 仍只需监听 loopback。停止面板不会停止 Core、`piwork-serve` 命令或已经接受的 Operation。

## 启动

先按 [操作文档](operations.md#从源码启动) 启动 Core，并使用 `piwork-serve admin bootstrap` 创建首个管理员。面板不提供 bootstrap。构建后，为公开域名准备 TLS 证书与私钥，再启动：

```bash
make build-go
./dist/go/piwork-console serve \
  --core http://127.0.0.1:7171 \
  --listen 0.0.0.0:7173 \
  --public-origin https://console.example.com:7173 \
  --tls-cert /etc/piwork/console-cert.pem \
  --tls-key /etc/piwork/console-key.pem \
  --data-dir "$PWD/.piwork/console"
```

证书的主机名必须覆盖 `console.example.com`；私钥仅允许所有者读取（例如模式 `0600`）。`--public-origin` 必须是浏览器实际使用的 HTTPS origin，端口须与 `--listen` 一致。`--core` 只接受 loopback 地址。未指定时，Core 地址为 `http://127.0.0.1:7171`，监听地址为 `0.0.0.0:7173`，数据目录为当前目录下的 `.piwork/console`。`./dist/go/piwork-console --help` 查看参数。Core 暂时不可达时，登录页仍可打开并显示可用性。

只允许管理员账号登录。管理员可以在“User access” 页创建普通用户或其他管理员、禁用账号和重置密码。普通用户使用 `piwork-cli` 管理自己的 Work，不能登录面板。面板浏览器只持有 `Secure`、`HttpOnly`、`SameSite=Strict` 会话 Cookie；Core bearer 保存在面板进程内存中。面板重启后需要重新登录。

## 本机 HTTPS 预览

先启动 Core，并使用 `piwork-serve admin bootstrap` 初始化管理员。下面的命令从仓库根目录执行，只监听本机。若已有适用于 `127.0.0.1` 的证书，把 `PIWORK_PREVIEW_CERT` 和 `PIWORK_PREVIEW_KEY` 改为自己的证书与私钥绝对路径即可。

```bash
mkdir -p .piwork/console-preview
openssl req -x509 -newkey rsa:2048 -nodes -days 7 \
  -keyout .piwork/console-preview/key.pem \
  -out .piwork/console-preview/cert.pem \
  -subj '/CN=127.0.0.1' -addext 'subjectAltName=IP:127.0.0.1'
chmod 600 .piwork/console-preview/key.pem
PIWORK_PREVIEW_CERT="$PWD/.piwork/console-preview/cert.pem"
PIWORK_PREVIEW_KEY="$PWD/.piwork/console-preview/key.pem"
make build-go
./dist/go/piwork-console serve \
  --core http://127.0.0.1:7171 \
  --listen 127.0.0.1:7173 \
  --public-origin https://127.0.0.1:7173 \
  --tls-cert "$PIWORK_PREVIEW_CERT" \
  --tls-key "$PIWORK_PREVIEW_KEY" \
  --data-dir "$PWD/.piwork/console-preview/data"
```

浏览器打开 `https://127.0.0.1:7173/login`，首次使用自签证书时需要在本机浏览器信任该证书。修改 `apps/console-webui/public/` 或 `apps/console-webui/src/` 后，先执行 `npm run build -w @piwork/console-webui`，再执行 `make build-go` 并重启 `piwork-console`；浏览器资源嵌入 Go 程序，单纯刷新页面不会装入新构建。Core 可以继续运行。

## 交付界面与验证

顶层导航为 **Overview / User access / Work setup**。Overview 根据真实 Core 状态提供运行时配置和 readiness 检查；Work setup 组织 Starting point、Skills 和 Packages；Find operation 是按已知 ID 恢复的辅助入口。`/runtime`、`/default-work`、`/skills/:name`、`/packages/:name`、`/operations/:id` 等已有深链接均保留。

页面使用交付包的任务布局、详情与确认弹窗。默认 Work 的各编辑区共享一个草稿，只提交修改过的字段；添加能力后可以返回原选择上下文。控件、反馈与技术披露遵循当前任务层级，360px 窄屏通过 Menu 提供完整导航，表格可以在自身容器中滚动。公共样式来源为 `apps/ui-shared/tokens.css`；应用布局位于 `apps/console-webui/public/style.css`。

执行 `npm run test:browser -w @piwork/console-webui` 验证原生 Console 的浏览器契约及真实 Go Core 管理写入。契约测试使用隔离 HTTP fixture，真实测试使用独立 Core 和临时目录；两者的证据不能互相代替。完整接入范围、测试命令和交付编号见 [两套 WebUI 接入记录](webui-integration.md)。

## 内容与配置

- “Runtime”保存全局 Agent 镜像、模型与完整 API Key。每次保存都要重新输入 Key；页面不会回显它。保存成功与运行就绪分别显示。已有 Work 保留自己的配置。
- “Default Work”展示公开配置，可分别修改基础镜像、Skill 选择、Package 选择和 `AGENTS.md`。可选择本地 `AGENTS.md` 文件，再在文本框内编辑；文件须为 UTF-8，内容上限为 256 KiB。空文本或空选择会明确清空对应默认值。默认配置仅影响以后创建的 Work。
- “Skills”选择浏览器设备上的完整目录，目录名就是 Skill 名称，根部必须有 `SKILL.md`。上传的是相对文件树，Core 设备无需有此目录。更新时选择与现有 Skill 同名的目录。单次最多 2,048 个普通文件，单文件 8 MiB，总内容 32 MiB；不能上传符号链接或特殊文件。被默认 Work 选中的 Skill 需先取消选择才能禁用或移除。
- “Packages”可从 npm、Git、浏览器本地目录或 ZIP 安装或更新。目录中的 `package.json` 决定 Package 身份，目录名只是上传显示名；ZIP 按原字节上传并由 Core 验证。更新操作需指定来源，Package 名称不可更改。可在安装时选择原子加入默认 Work。被默认 Work 选中的 Package 需先取消选择才能禁用或移除。

## 找回 Package Operation

安装和更新被 Core 接受后，面板打开 `/operations/<operationId>` 并轮询状态。把 ID 复制并保存在自己的操作记录中；面板不提供历史列表。浏览器刷新、换设备或面板重启后，在“Find Operation”输入 ID 即可查看 Core scope 的 Operation。另一个已登录的管理员也可以按 ID 查看。查询中断只表示暂时无法观察，不代表任务被取消；不要因为观察中断就用新幂等键重复安装。Work scope 或不存在的 ID 不会显示。面板关闭后也可运行 `piwork-serve operation show <operationId>`。
