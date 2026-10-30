# 验收记录

日期：2026-10-30。范围为本变更的共享 Desktop WebUI、嵌入资源和隔离 Core 控制链路；原型只作设计参考。

## 已核验行为

- 发送中、失败、受理未知只在原用户气泡外显示图标；明确失败重试原快照，未知只读核对原键。接受后不重复显示 Message accepted；新草稿和图片不被误消费。
- 独立停止不依赖新消息准入；空草稿、模型未确认、图片不再受支持和旧 Agent 路径均有覆盖。取消只发原目标一次，不创建 Run／Session，取消失败保留原因与草稿。
- 组合主动作保留一次带原 `cancelRunId` 的请求；其他 Session／Service 来源、后续编辑、未知受理、超时和旧目标保护沿原契约。
- 三点紧跟正文末尾，工具执行时移入所属摘要，结束后移除；段落、列表、表格、代码与安全转义有覆盖。实际失败、无正文失败和观察恢复入口保留原 Run 身份。
- 工具使用公开名称／结果，默认折叠、分层展开，无伪造路径／参数；节点身份、子详情展开、输入选区、上翻位置和补读历史锚点保留。
- 常规 Chat、Focus chat、Service 的 Agent 栏在 1440px／360px 检查长文字、纯图片、展开工具及失败弹层；另有长模型名和组合按钮窄屏回归。检查弹层边界、无页面横向溢出、Esc 回焦点、2px 焦点和减少动态效果。

## 命令与结果

以下从仓库根运行，使用 Node 24.20.0 和 Go 1.25.5。生成测试的前置命令为 `npm exec -- tsc -p apps/desktop-webui/tsconfig.test.json`。

| 验证 | 命令／入口 | 结果及本机证据 |
| --- | --- | --- |
| 消息、图片、Markdown、工具与旧反馈 | `node --test --test-name-pattern='Chat redesign:|D07 Send|Agent status follows|Run wait renders|Activity|Markdown|Chat images|image acceptance|unknown image' apps/desktop-webui/dist/test/feedback.test.js` | 29/29；`dist/chat-targeted-browser.log` |
| 最终交互及几何复验 | `node --test --test-name-pattern='Chat redesign:|D07 Send' apps/desktop-webui/dist/test/feedback.test.js` | 16/16；`dist/chat-final-browser.log`；Service fixture 按正式 basePath 保留原应用后，几何用例再次 1/1，见 `dist/chat-final-geometry.log` |
| 历史、工具投影、界面层级、locale、弹层角色 | `node --test apps/desktop-webui/dist/test/{locale-format,overlay-role,workspace-hierarchy,chat-projection,history}.test.js` | 127/127；`dist/chat-final-contracts.log` |
| 原恢复及控制回归 | `node --test --test-name-pattern='Controls|Chat reload|History pages|History compatibility|Thinking|Model|Chat' apps/desktop-webui/dist/test/recovery.test.js` | 45 项首次通过，8 项旧 UI 断言调整后通过，见下行；`dist/chat-recovery-regression.log` |
| 更新后的 8 项回归 | `node --test --test-name-pattern='multi-provider empty|multi-provider Chat contract|Controls Stop and send|Controls timeout preserves|Controls active read|Chat composer keeps' apps/desktop-webui/dist/test/recovery.test.js` | 8/8；`dist/chat-recovery-updated.log`。空输入现为禁用；状态原因改从图标弹层读取 |
| slash、IME、设置及历史锚点 | `node --test --test-name-pattern='UX composer|UX slash|UX web commands|UX lost creation|UX commands|UX Activity and reading|UX runtime recovery|UX revision truly' apps/desktop-webui/dist/test/recovery.test.js` | 8/8；`dist/chat-input-regression.log` |
| 独立停止与无效图片草稿 | `node --test --test-name-pattern='Chat redesign: independent' apps/desktop-webui/dist/test/feedback.test.js` | 2/2；`dist/chat-stop-images.log`；最终 16 项也包含该覆盖 |
| 共享资源构建 | `npm run build -w @piwork/desktop-webui` | 通过；`dist/chat-ui-build.log`；构建输出与 Go 嵌入资源逐文件比对 |
| Core／CLI 构建 | `CGO_ENABLED=0 go build -mod=readonly -trimpath -o dist/chat-interaction-bin/piwork-core ./cmd/piwork-core`；同方式构建 `piwork-cli` | 通过；`dist/chat-core-build.log`、`dist/chat-cli-build.log` |
| 界面文案及源码边界 | `node scripts/check-ui-language.mjs`；`node scripts/check-native-boundary.mjs` | 通过；`dist/chat-ui-language.log`、`dist/chat-native-boundary.log` |
| 文档与规格 | `node scripts/check-repository-docs.mjs`；`openspec validate redesign-chat-interaction --strict`；`git diff --check` | 均通过；`dist/chat-repository-docs.log`、`dist/chat-openspec-validate.log`；diff 检查无输出 |

截图在忽略目录 `dist/chat-interaction-ui/`：`chat-{1440,360}.png`、`focus-{1440,360}.png`、`service-{1440,360}.png` 为弹层；对应 `-content.png` 包含图片与工具。原型文件没有被当成浏览器产品通过证据。

## 隔离真实 Core

使用已有确定性验收镜像，没有改镜像、API 或 history schema。入口：

```sh
PIWORK_TEST_NATIVE_CLI="$PWD/dist/chat-interaction-bin/piwork-cli" \
PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-chatfix-agent:test-1793281785855-v4 \
PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE=piwork-chatfix-file:test-1793281785855 \
PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE=piwork-chatfix-snapshot:test-1793281785855 \
PIWORK_TEST_DATA_ROOT="$PWD/dist/chat-interaction-native" \
PIWORK_TEST_SCREENSHOT_DIR="$PWD/dist/chat-interaction-ui/native" \
PIWORK_TEST_CHAT_CONTROLS=only \
node apps/desktop-webui/test/real-core.mjs
```

该入口只运行 `chat-controls-real-core.mjs` 的控制场景，使用独立安装／数据目录及合成账号，结束时按精确 installation ID 清理。覆盖独立取消零新 Run、一次原子跨 Session／Service 交接、旧取消目标冲突、5 秒取消超时不补发、原键核对、原失败 Chat 与后台 Service 并存，以及原有包往返的历史只读规则。最终输出保存在 `dist/chat-real-core.log`。结果通过：取消等待 5079ms；旧目标被拒绝且当前 Run 未被取消；未知原键没有晚补发；包往返规则通过。结束后该 fixture 安装的 containers／networks／volumes 均为 0。

## 验收边界

- 窄屏和键盘验证使用 Linux 的 Playwright Chromium；没有执行 Windows／MicroVM 重打包、宿主重启、性能重复采样或真实用户 Work 操作。
- 通用 `real-core.mjs` 中四处旧的常驻成功文字断言已改为核对浏览器观察的原 Run 状态和详情入口，两处空输入断言也随新契约更新，`node --check` 通过；本轮只运行控制 fixture，没有扩大为该脚本的全部 Docker／多 Core 场景。
- 不声称已测试真实模型供应商、每一种系统 IME、物理触屏或完成读屏认证；工具输入字段仍受现有公开契约限制。
- 构建产物在 `dist/chat-interaction-bin/`，本次 apply 不更新用户桌面的旧 EXE，也不执行提交、推送或归档。

## 2026-10-30 WARN 修复回归

本轮修复 verify 复现的三项问题，没有放宽规格：

- 迟到的重试失败只更新原尝试的恢复快照；更新弹层前同时核对身份、视图、Work、Session 和提交键。A 的迟到失败不会覆盖 B 的原因，也不会把 B 的重试改成 A；旧身份响应不能重新放回已清理的快照。
- 消息状态图标的锚点与回焦点选择器包含 Session／submissionKey。两个失败消息分别拥有 expanded 状态，键盘打开第二条后 Esc 回到第二条。
- 工具分组通过原 Run／调用身份保留既有 Activity 键，子工具与原始预览使用独立的稳定键。前插较早调用或追加新调用后，原节点、三层展开、焦点及文字选区保留；分组拆分保持键唯一，不按相同工具名混合调用。

上述三项及连续拒绝后重试成功的控制场景已加入 `feedback.test.ts`；分组身份和真实正文拆分边界加入 `chat-projection.test.ts`。

| 本轮命令 | 实际结果 |
| --- | --- |
| `node --test --test-name-pattern='Chat redesign:|D07 Send|Activity' apps/desktop-webui/dist/test/feedback.test.js` | 24/24；`dist/chat-warn-regression.log`，含 4 项新增浏览器回归 |
| `node --test apps/desktop-webui/dist/test/{locale-format,overlay-role,workspace-hierarchy,chat-projection,history}.test.js` | 129/129；`dist/chat-warn-contracts.log` |
| `node --test --test-name-pattern='UX Activity and reading|History pages: recent-only|Session chooser keyboard' apps/desktop-webui/dist/test/recovery.test.js` | 匹配的 2 项通过；`dist/chat-warn-reading.log` |
| `npm run build -w @piwork/desktop-webui` | 通过；`dist/chat-warn-build.log`；包含 `chat-projection.js` 的变更嵌入资源逐文件一致 |
| `CGO_ENABLED=0 go build -mod=readonly -trimpath -o dist/chat-interaction-bin/piwork-core ./cmd/piwork-core`，同方式构建 `piwork-cli` | 均通过；`dist/chat-warn-core-build.log`、`dist/chat-warn-cli-build.log` |
| `node scripts/check-ui-language.mjs`；`node scripts/check-native-boundary.mjs` | 通过；`dist/chat-warn-language.log`、`dist/chat-warn-boundary.log` |
| `node scripts/check-repository-docs.mjs`；`openspec validate redesign-chat-interaction --strict`；`git diff --check` | 均通过；`dist/chat-warn-docs.log`、`dist/chat-warn-spec.log`；diff 检查无输出 |

本轮修改局限于浏览器反馈归属、分组身份及其嵌入资源。前轮真实 Core 的取消、原子交接、冲突与超时证据保持；本轮未重复运行未变化的 Docker 控制场景，也未重打包 Windows／MicroVM 或操作用户 Work。

## 2026-10-30 阅读锚点 WARN 修复

保存滚动位置、切换布局恢复及渲染后的恢复现在共用同一套锚点选择／还原方法。Activity 标题滚出视口后，锚点深入当前可见的工具条目或原始结果预览；隐藏详情不参与选择，显式回到最新仍按原规则跟随。

原 verify 复现的工具位置从 `235.0625 → 269.0625`（偏移 34px）变为 `235.0625 → 235.0625`（偏移 0px），原节点保持，见 `dist/chat-reading-repro-fixed.log`。

- 在 `feedback.test.ts` 新增 1440px／360px 两项浏览器用例，分别从工具条目与原始结果内部阅读，核对较早调用插入及结果追加后的锚点、三层展开、焦点、草稿、选区和回到最新零业务写入。
- `node --test --test-name-pattern='Chat redesign: tool and raw reading|Chat redesign: streamed output|Chat redesign: earlier adjacent calls|Chat redesign: narrow message|Session chooser keyboard' apps/desktop-webui/dist/test/feedback.test.js`：6/6，见 `dist/chat-reading-browser.log`。
- `node --test --test-name-pattern='UX Activity and reading|History pages: recent-only' apps/desktop-webui/dist/test/recovery.test.js`：2/2，见 `dist/chat-reading-history.log`。
- 原契约入口 `node --test apps/desktop-webui/dist/test/{locale-format,overlay-role,workspace-hierarchy,chat-projection,history}.test.js`：129/129，见 `dist/chat-reading-contracts.log`。
- WebUI 构建与嵌入资源逐文件一致性通过；Core／CLI 以原 `CGO_ENABLED=0 go build -mod=readonly -trimpath` 入口重建通过，日志为 `dist/chat-reading-build.log`、`dist/chat-reading-core-build.log` 和 `dist/chat-reading-cli-build.log`。
- 界面文案与源码边界通过，见 `dist/chat-reading-language.log`、`dist/chat-reading-boundary.log`；文档、OpenSpec 严格校验及 diff 检查均通过，见 `dist/chat-reading-docs.log`、`dist/chat-reading-spec.log`。

该修复不改变 Run、提交、取消或历史协议，沿用前轮隔离 Core 证据，不重跑未变化的 Docker／性能验收，不更新 Windows／MicroVM EXE。

## 2026-10-30 连续聊天顺序误报修复

实机预览发现正常连续聊天出现 `Message order is not confirmed.`。只读复现确认：按 Run 分别补读会形成互不相连的快照排序子图；读取同一 Session 的可靠排序后标记消失。另补充修复最近 16 个快照淘汰时遗忘既有排序关系的路径。

- 终态读取先取得一页有界最新 Session 历史，再固定同一快照补读原 Run；最新页未涵盖已读轮次时，仅补读该轮次的一页尾部作为连接边界，不遍历整个 Session、不使用时间或文字猜测顺序。已验证排序边随已读内容保留，身份清理时同步清空。
- 部分正文、顺序或保存归属未确认改为消息外图标。Popover 绑定精确 Work／Session／Run／消息，展开后显示真实原因并只读核对；正文和 Activity 摘要不常驻技术文案。发送、草稿和未知提交保护保持。

| 本轮验证 | 实际结果 |
| --- | --- |
| `npm run build -w @piwork/desktop-webui`；`npx tsc -p apps/desktop-webui/tsconfig.test.json` | 通过，嵌入资源同步；`dist/chat-order-build.log`、`dist/chat-order-test-build.log` |
| `node --test apps/desktop-webui/dist/test/{history,workspace-hierarchy,overlay-role}.test.js` | 116/116；含 20 轮连续补读、24 个快照淘汰、当前轮次覆盖最新页时的有界排序连接及原游标恢复；`dist/chat-order-unit.log` |
| `node --test --test-name-pattern='Chat history:|paged replies expose' apps/desktop-webui/dist/test/feedback.test.js` | 4/4；连续 Send／终态／刷新、部分文件正文、1440px 英文与 360px 中文异常图标／键盘／精确弹层／只读恢复／草稿保留；`dist/chat-order-browser.log` |
| `bash scripts/build-go.sh` | Core／CLI 构建通过；`dist/chat-order-native-build.log`。独立演示安装以原固定 fixture 镜像构建新版 Core，保留原数据与预览地址 |
| 更新后真实 Core、Agent 与独立 CLI Desktop 浏览器验证 | 新建隔离预览 Work，实际发送 3 轮（含两个工具调用），得到 8 条消息／工具记录；零顺序、保存归属或部分内容标记，刷新前后消息身份与顺序一致，发送 POST 恰为 3 次；`dist/chat-order-real-core.log`、`dist/chat-live-preview/order-result.json` |
| `check-ui-language.mjs`、`check-native-boundary.mjs`、`check-repository-docs.mjs`、OpenSpec 严格校验、`git diff --check` | 均通过；`dist/chat-order-{language,boundary,docs,spec}.log`；生成的 app／adapter／history-projection／CSS 与嵌入资源逐文件一致 |

本轮未更改 Core／Agent API、history schema 或镜像能力，未重跑取消／原子交接／性能矩阵，未重打包 Windows／MicroVM EXE。运行中的独立预览已使用修复版 Core／CLI，原演示历史保留；真实模型回答质量不在本地 deterministic 演示模型的验证范围内。

## 2026-10-30 长回复恢复提前结束 WARN 修复

修复 `loadSavedRun` 将“原 Run 曾完整读取”和“首个页已缓存”合并为提前退出条件的问题。移除跨快照的完成缓存；恢复沿本次固定快照的原 Run 游标读到末页，最新 Session 页仍只读取一页及必要轮次边界，不自动遍历整份 Session。取消／失败／中断和空最终结果不会抹去已保存正文。

- 新增三个针对性回归：运行中先恢复用户输入，随后出现 600,000 字节已保存正文并进入 cancelled／failed／interrupted；最新页含最后 491,520 字节，原 Run 的剩余页含前 108,480 字节及用户锚点。覆盖空最终结果与无最终结果、重复读取、冻结快照、原 Run 范围和全程只读。
- 修复前上述三个用例均复现零剩余页读取，见 `dist/chat-long-before.log`；修复后正文完整且只呈现一次，部分内容／顺序／保存归属未确认标记均消失，终态保持。
- `npm run build -w @piwork/desktop-webui` 与测试 TypeScript 编译通过；`node --test apps/desktop-webui/dist/test/history.test.js` 为 58/58；`node --test --test-name-pattern='Chat history:|paged replies expose' apps/desktop-webui/dist/test/feedback.test.js` 为 4/4。日志：`dist/chat-long-{build,test-build,history,browser}.log`。
- `bash scripts/build-go.sh` 通过并更新 Core／CLI；独立预览沿原固定镜像重新构建 Core，保留演示历史及原 URL。真实浏览器只读打开原对话，确认提供新版 adapter、消息无历史异常图标、零 POST，见 `dist/chat-long-preview-smoke.log`；未重复提交模型或重跑取消／组合发送矩阵。
- 嵌入 adapter 与构建输出逐文件一致；源码边界、文档归属、OpenSpec 严格校验及 `git diff --check` 通过，见 `dist/chat-long-{native-build,boundary,docs,spec}.log`。没有 API、history schema、镜像能力或 Windows／MicroVM 包变更。
