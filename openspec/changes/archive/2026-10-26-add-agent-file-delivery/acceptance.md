# 验收记录：add-agent-file-delivery

日期：2026-10-25
环境：Linux（WSL2）、Node 24.20.0、npm（仓库 lockfile）、Go 1.25.5、Playwright 1.55.1 + Chromium 140 headless。

本记录只写入实际执行结果；未执行项明确标注，不以规划内容代替验收。

## 1. 已执行的自动化验证

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| contracts | `npm run test:unit -w @piwork/contracts` | 45/45 通过 |
| pi-package | `npm run test:unit -w @piwork/pi-package` | 8/8 通过 |
| work-store | `npm run test:unit -w @piwork/work-store` | 63/63 通过 |
| pi-adapter | `npm run test:unit -w @piwork/pi-adapter` | 20/20 通过（含 session-persistence、event-mapper） |
| agentd | `npm run test:unit -w @piwork/agentd` | 130/130 通过（含 package-resources、brain-resources、sessions） |
| 全部 workspace 类型检查 | `npm run typecheck` | 退出码 0 |
| 桌面非浏览器用例 | `node --test --test-concurrency=1 dist/test/*.test.js`（排除 browser/feedback/recovery/final-acceptance） | 668 项，667 通过，0 失败，1 跳过 |
| 桌面浏览器：feedback | `node --test dist/test/feedback.test.js` | 136/136 通过 |
| 桌面浏览器：recovery | `node --test dist/test/recovery.test.js` | 165/165 通过 |
| 桌面浏览器：final-acceptance | `node --test dist/test/final-acceptance.test.js` | 13/13 通过 |
| 桌面浏览器：browser | `node --test dist/test/browser.test.js` | 3/3 通过 |
| 桌面全量入口 | `node --test --test-concurrency=1 dist/test/*.test.js` | 987 项，986 通过，0 失败，1 跳过（真实 Engine 用例在无 Docker 时跳过） |
| 仓库脚本测试 | `node --test scripts/*.test.mjs` | 85/85 通过 |
| Go | `go test -mod=readonly ./...` | 退出码 0，无失败包 |
| 平台边界 | `node scripts/check-native-boundary.mjs` | 通过 |
| 文档边界 | `node scripts/check-repository-docs.mjs` | 通过（58 个当前文档、1 个迁移清单） |
| 空白/冲突 | `git diff --check` | 退出码 0 |

说明：`npm run test:browser` 默认按文件并发启动多个 Playwright/Node 进程，在本机出现过 `local-auth` 的连接时序假失败与 `onboarding` popup 加载超时；上述失败项在串行或单独复跑时均通过。最终全量结果使用与脚本等价的 `tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist/test/*.test.js` 取得（986 通过、0 失败、1 跳过）。

新增专项回归：

- `file-reference.test.ts`：中文、空格、`%`、`#`、字面 `%2e` 往返；authority、query/fragment、dot segment、编码分隔符、控制字符、非法 UTF-8/percent、WF-005 段/总长/层数边界拒绝；Files 深链接 Work 绑定；`workspacePath` 与引用解析共用单段 255 字节上限。
- `file-preview-adapter.test.ts`：同大小同 mtime 内容变化、旧 binary/text 结论失效、删除/改名 404、读取失败保留旧预览、symlink/special、1 MiB 精确预算与实际流取消、PNG/JPEG/WebP 内容识别、尺寸/字节预算、损坏图片、伪后缀、PDF/GIF/ZIP 下载回退、读取替换/身份切换/Work 停止的取消与 Object URL 释放。
- `file-target.test.ts`：加载、缺失、不可用、错误、文本、图片、下载回退、special 与 Back to request 目标外壳；图片无 Save/Saved；360px 样式约束。
- `chat-markdown.test.ts`：文件链接只在真实 Work 上下文生成；非法/跨 scheme 保持文字；代码块、图片语法、原始 HTML 不产生导航；逐字节流式前缀安全。
- `workspace-hierarchy.test.ts`：请求详情中已关联 Run 的回复使用安全 renderer 并绑定 Work。
- `navigation-review-regressions.test.ts`：显式 Files 深链接优先于上次区域恢复、先退出 Focus、非法目标不打开文件。
- `feedback.test.ts` 新增端到端：Focus chat、普通 Chat、Services 辅助栏、请求详情返回、360px 键盘返回、TXT/三种图片/伪后缀/损坏图/超预算/缺失目标/缺失父目录、读取失败后 Retry 保留脏草稿与独立 reread、复制/刷新深链接、无 POST（无新 Run/控制请求）。
- Agent：真实 SDK 上下文中含/不含脑包均出现平台文件指导；未启用包不加载工具；真实 built-in `write` 产出文件后回复受控链接；历史与进程重开保留原引用且不产生附件块。
- WARN 补验：401/403 文件读取复用会话核对/撤销入口（`file-preview-adapter.test.ts` 17 项）；dirty 文件链接的取消/确认、分段流式链接、Files 列表打开图片、401 撤销后回到登录（`feedback.test.ts` 新增用例）。

## 2. 构建与嵌入资源

- `make build` 成功：完成 harness fixtures、桌面/控制台 WebUI 构建、`internal/desktopassets/static/` 同步和 `dist/go/piwork-core`、`dist/go/piwork-cli`（Linux amd64）。
- `make build-cli` 成功：最终产出 `dist/cli/linux-amd64/piwork-cli`（2026-10-25 23:06）。
- `diff -rq apps/desktop-webui/dist/{browser,public} internal/desktopassets/static/{browser,public}` 无差异；新增 `file-reference.js`、`image-content.js` 已随 `app.js`、`adapter.js`、`chat-markdown.js`、`images.js`、`style.css` 同步嵌入。
- 未新增 PDF 查看器、转换服务、字体/worker 或宿主运行时工具依赖；未修改 Docker/部署默认值或发布引用。`grep -riE 'pdfjs|pdf\.js|pdf-lib|mupdf'` 在依赖清单与源码中无命中。

## 3. 真实 Core / 镜像验收（已完成）

Docker Engine 26.1.5 可达。最初默认 IPv4 地址池耗尽：`docker network create` 报 `could not find an available, non-overlapping IPv4 address pool`，Core `defaultContext` 持续 `CONTEXT_PREPARATION_FAILED`，真实 Core 夹具无法 READY。

经项目所有者明确授权，执行了受限清理（记录在 `dist/docker-cleanup/`）：仅删除 70 个已停止的 `piwork.managed` 容器与 27 个 `containers=0` 的 `piwork.managed` 网络；**保留全部 109 个 `piwork.managed` 卷**（Work 数据）；未执行全局 prune，未删除 `bridge/host/none` 或其他非 piwork 资源。清理后 `docker network create piwork-pool-probe-tmp` 成功并已移除。

随后重建验收镜像（`make native-agent-images native-helper-images`）：
- `piwork-agentd:go-migration-acceptance` `2471d6df7585`（含 Agent 图片生成 fixture 重建）
- `piwork-file-helper:go-migration-acceptance` `b9ab88c500db`
- `piwork-snapshot-helper:go-migration-acceptance` `e1a3a8f6e620`

`PIWORK_TEST_CHAT_CONTROLS=only npm run test:real-core -w @piwork/desktop-webui` 通过：chat controls、真实 Agentd/Desktop、完整包往返与安装清理均成功（`{"result":"chat controls real Core/Agentd/Desktop passed",...}`、`fixture installation cleaned`）。

完整 `real-core.mjs`（含新增文件交付场景）通过，关键结果：

- `{"result":"delivered file current content, Agent-generated image preview/download, PDF download, reread/delete/recreate, standalone+hosted download hashes and cross-account denial verified","deliveryRun":"run-3381facf-...","agentImageSha256":"8f461a00503b5dac4fb8f0795c81209e415eccaf6f2bb387afe75499fbe3beac","textSha256":"794bc773..."}`：Agent 用真实 `write` 产出 `output/报告.txt`、用真实 `bash` 工具生成 `output/图片.png`，回复两个受控链接；点击图片链接预览并由浏览器下载原图，下载字节 SHA-256 与 Core 当前文件一致；同时验证文本修改、删除、重建、PDF 下载回退、独立 Desktop 与托管工作台下载 hash、跨账号拒绝。
- `{"result":"single browser export/download verified",...}`、`{"result":"workspace UX: ... exported/imported Thinking and continued original Session",...}`：完整包导出/导入 stopped Work、显式 Start、原 Session 继续。
- `{"result":"source Core offline import: history link resolved in the receiving Work","sourceCoreStopped":true,...}`：停止源 Core 后，将完整包导入第二个隔离 Core，启动新 Work 并从恢复的历史中打开同一相对路径文件，证明链接不依赖源 Core 地址；原引用仅按接收 Work 解析。
- `{"result":"real Go Core/CLI: lifecycle, ...","workId":"..."}` 与 `fixture installation cleaned`（两个安装 ID）：生命周期、真实下载、嵌入资源、资源清理均通过；仅清理本次 installation ID。

## 4. 边界与已知风险

- Agent 指导只在真实模型上下文中验证了“指导存在 + SDK 工具产文件后可输出链接”的确定性分派；这不证明任意真实模型会遵守格式或主动核实文件。浏览器侧对无 Work/非法引用保持文字，不把链接文字当作文件已存在证明。
- 文件引用始终读取点击时的当前路径；修改/删除/改名不保留发送时副本。删除后目标显示缺失并保留明确路径；脏草稿在页面内保留但不作为当前保存版本。
- 图片预览预算是本次选定的有界默认值：10 MiB、8192 px/边、40,000,000 像素；超出或解码失败给下载入口。PDF 按普通文件下载，不提供专用查看器。
- 旧 Agent 镜像不会自动获得新指导；升级仍走用户显式镜像选择与 Apply。
- 真实 Core 端到端已在受限清理 Docker 资源并重建 acceptance 镜像后完成（见第 3 节）；未做镜像推送、正式发布或 `make release`。
- 文件 401/403 现在复用既有 `checkSession`/`clearIdentity` 路径；新增用例验证撤销后预览释放并回到登录。
