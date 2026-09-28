# Serve 管理面板

面板外观遵循 [UI 语言](ui-language.md)；页面信息顺序、按钮位置和文案遵循 [产品语言](product-language.md)。后续浏览器 UI 也应同时核对这两份文档。

`piwork-console serve` 是独立进程。它与 Core 部署在同一台机器，通过 Core 的 loopback HTTP API 管理用户、运行时、默认 Work、Skill 和 Core Package。浏览器可以在其他设备上打开面板；Core 仍只需监听 loopback。停止面板不会停止 Core、`piwork-serve` 命令或已经接受的 Operation。

## 启动

先按 [操作文档](operations.md#clean-installation) 启动 Core，并使用 `piwork-serve admin bootstrap` 创建首个管理员。面板不提供 bootstrap。构建后，为公开域名准备 TLS 证书与私钥，再启动：

```bash
npm run build
npm run console -- serve \
  --core http://127.0.0.1:7171 \
  --listen 0.0.0.0:7173 \
  --public-origin https://console.example.com:7173 \
  --tls-cert /etc/piwork/console-cert.pem \
  --tls-key /etc/piwork/console-key.pem \
  --data-dir "$PWD/.piwork/console"
```

证书的主机名必须覆盖 `console.example.com`；私钥仅允许所有者读取（例如模式 `0600`）。`--public-origin` 必须是浏览器实际使用的 HTTPS origin，端口须与 `--listen` 一致。`--core` 只接受 loopback 地址。未指定时，Core 地址为 `http://127.0.0.1:7171`，监听地址为 `0.0.0.0:7173`，数据目录为当前目录下的 `.piwork/console`。`npm run console -- --help` 查看参数。Core 暂时不可达时，登录页仍可打开并显示可用性。

只允许管理员账号登录。管理员可以在“Users” 页创建普通用户或其他管理员、禁用账号和重置密码。普通用户使用 `piwork-cli` 管理自己的 Work，不能登录面板。面板浏览器只持有 `Secure`、`HttpOnly`、`SameSite=Strict` 会话 Cookie；Core bearer 保存在面板进程内存中。面板重启后需要重新登录。

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
npm run build -w @piwork/console
npm run console -- serve \
  --core http://127.0.0.1:7171 \
  --listen 127.0.0.1:7173 \
  --public-origin https://127.0.0.1:7173 \
  --tls-cert "$PIWORK_PREVIEW_CERT" \
  --tls-key "$PIWORK_PREVIEW_KEY" \
  --data-dir "$PWD/.piwork/console-preview/data"
```

浏览器打开 `https://127.0.0.1:7173/login`，首次使用自签证书时需要在本机浏览器信任该证书。修改 `apps/console/public/style.css`、`index.html` 或 `src/browser/app.ts` 后，停止面板进程，重新运行 `npm run build -w @piwork/console`，再用上述 `npm run console -- serve` 命令启动；面板在启动时将构建产物读入内存，单纯刷新页面不会装入新构建。Core 可以继续运行。

在浏览器开发者工具先检查 1440px 桌面宽度，再切到 360px 窄屏。所有七个已登录管理路由及 Skill、Package、Operation 详情均采用最大 1100px 的同一页面轨道：跨路由比较页标题、说明及一级卡片的左右边界；Runtime 和 Default Work 的表单只在卡片内部按 176px 标签列、16px 间距及最多 520px 控件列收束。登录使用相同外层轨道，只有标题、说明和表单卡片组成最大 420px 的居中窄列。窄屏下卡片两侧齐平，管理表单折为单列，整页不横向溢出。

逐类核对顶栏和页面、一级 section、摘要、表单和字段组、选择与排序行、列表及表格、详情与技术披露、反馈及操作区。长名称、ID、表格和 `pre` 的换行或滚动应留在所属容器，全文仍可读取或复制，主要动作可到达；Default Skills 的空选择、长名称与不可用引用应分别显示入口、全文和原因。切换加载、空、错误、草稿、保存中、明确失败、结果未知、上传进度及 Operation 中断恢复时，反馈应贴近对应字段、section 或对象，一级卡片边界保持稳定；界面自有文字和无障碍名称使用英文，原始用户内容保持原文。危险确认核对目标与后果，键盘焦点保持可见。完整规则见两份语言文档的检查清单。

运行 `npm run test:browser -w @piwork/console` 会在 `test-results/ui-preview/` 生成 1440px 与 360px 的登录、全部七个管理路由及三个代表性详情截图。截图使用临时 Core fixture，不含真实密码、API Key 或生产用户数据；它们用于复核视觉和文案，实际部署仍按上面的 HTTPS 命令打开面板检查。

## 内容与配置

- “Runtime”保存全局 Agent 镜像、模型与完整 API Key。每次保存都要重新输入 Key；页面不会回显它。保存成功与运行就绪分别显示。已有 Work 保留自己的配置。
- “Default Work”展示公开配置，可分别修改基础镜像、Skill 选择、Package 选择和 `AGENTS.md`。可选择本地 `AGENTS.md` 文件，再在文本框内编辑；文件须为 UTF-8，内容上限为 256 KiB。空文本或空选择会明确清空对应默认值。默认配置仅影响以后创建的 Work。
- “Skills”选择浏览器设备上的完整目录，目录名就是 Skill 名称，根部必须有 `SKILL.md`。上传的是相对文件树，Core 设备无需有此目录。更新时选择与现有 Skill 同名的目录。单次最多 2,048 个普通文件，单文件 8 MiB，总内容 32 MiB；不能上传符号链接或特殊文件。被默认 Work 选中的 Skill 需先取消选择才能禁用或移除。
- “Packages”可从 npm、Git、浏览器本地目录或 ZIP 安装或更新。目录中的 `package.json` 决定 Package 身份，目录名只是上传显示名；ZIP 按原字节上传并由 Core 验证。更新操作需指定来源，Package 名称不可更改。可在安装时选择原子加入默认 Work。被默认 Work 选中的 Package 需先取消选择才能禁用或移除。

## 找回 Package Operation

安装和更新被 Core 接受后，面板打开 `/operations/<operationId>` 并轮询状态。把 ID 复制并保存在自己的操作记录中；面板不提供历史列表。浏览器刷新、换设备或面板重启后，在“Find Operation”输入 ID 即可查看 Core scope 的 Operation。另一个已登录的管理员也可以按 ID 查看。查询中断只表示暂时无法观察，不代表任务被取消；不要因为观察中断就用新幂等键重复安装。Work scope 或不存在的 ID 不会显示。面板关闭后也可运行 `piwork-serve operation show <operationId>`。
