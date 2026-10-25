# Design

## Context

动机及已确认范围见 [proposal.md](proposal.md)。本变更涉及 Agent 提示、消息渲染、工作区导航和有界二进制预览，存在路径与异步资源边界，因此创建本设计。

现行源码的相关事实：

| 位置 | 当前职责与缺口 |
| --- | --- |
| `apps/agentd/src/package-resources.ts` | 使用 SDK 的提示词追加入口装配已启用脑包，目前没有平台文件引用指导；该入口也覆盖无脑包的 Work |
| `packages/pi-adapter/src/session-persistence.ts`、`apps/desktop-webui/src/chat-projection.ts` | 保存/投影普通 Assistant 文字；文件引用可沿现有路径持久化 |
| `apps/desktop-webui/src/chat-markdown.ts` | 仅允许 HTTP(S)/mailto 链接，Markdown 图片不抓取资源；需要增加严格限定的文件导航分支 |
| `apps/desktop-webui/src/app.ts` | `open-source` 有文件导航和脏编辑保护，但先读文件再切区，且缺少正常模块导航的 Focus 退出；请求详情中的 Run 回复仍是纯文本 |
| `apps/desktop-webui/src/adapter.ts` | 使用同源文件入口读取 WebDAV；目录缓存参与类型判断，当前正文读取以 1 MiB 文本编辑为中心 |
| `internal/coreapp/file_http.go`、`internal/workfiles/xml.go` | 文件 GET 和目录属性统一为 application/octet-stream，不能按后端 MIME 直接识别图片或假定 PDF 原生预览已可用 |
| `internal/cli/user_desktop_files.go`、`hosted_desktop.go` | 托管与独立 Desktop 复用受保护的文件代理；现有身份、路径、状态与流式传输边界可复用 |
| `internal/cli/user_desktop.go` | 现有 CSP 已允许 img-src blob:，object-src 为 none；本次图片预览无需放宽文档执行或 iframe 策略 |
| `scripts/sync-desktop-assets.mjs`、`internal/desktopassets/assets.go` | WebUI 构建同步扁平 JS 与公开资源，随后嵌入宿主程序；修改源码后必须同步产物 |

规格依据为现行 CONV-SESSION-001、CONV-TOOL-HISTORY-001、CONV-IMAGE-HISTORY-001，DWUI-002/004/006/019/HOSTED-001，DUL-002/005/007/015，WF-001/003/005/006，以及本变更三份增量。UI 组件采用说明要求文件作为导航目标，图片作为 Preview，不额外引入组件库或通用附件面板。

## Goals / Non-Goals

**Goals:**

- 一个 Work 相对引用贯穿 SDK 实际上下文、Assistant 正文、历史、Files 和真实下载。
- 一套 Files 读取/查看状态覆盖聊天入口、目录入口与重新打开；导航与读取失败都保留明确目标。
- 复用原鉴权和当前文件语义，用有界图片读取与可释放资源完成预览。

**Non-Goals:**

- 新增 send_file 工具、RPC、数据库/history schema、文件副本库或公开分享服务。
- 接管用户图片输入历史、脑包学习、Service 调度、版本快照或自动启动/Apply。
- 为 PDF 实现查看器、原生插件探测、专用打开按钮/端点、MIME 转换、iframe、worker 或字体打包；本次必需的 PDF 行为是普通下载。

## Decisions

### 1. 文件交付使用明确的 Work 相对 Markdown 协议

固定格式为 `[显示名](piwork-file:/<逐段编码的路径>)`，如 `piwork-file:/output/%E6%8A%A5%E5%91%8A.txt`。只接受固定小写前缀、单根路径和非空文件目标；逐段严格解码一次后按 WF-005 校验，再以已解码的 workspace 路径使用。原始路径必须先校验，不能先交给会折叠 dot segment 的 URL 规范化而隐藏穿越。拒绝 authority、query、fragment、空段、控制字符、反斜杠、解码后斜杠、`.`/`..`、非法 UTF-8/percent 和超限路径。字面 `%2e` 经 `%252e` 表达，解码后保留字面值，不递归解释。

Work 身份来自被渲染回复的真实上下文，不来自模型输入。不会自动识别任意裸路径、通用相对 URL、file:// 或模型提供的 HTTP 下载地址为本地文件动作。合法链接只是导航描述，不能作为目标存在、内容已校验或授权有效的证明。

选择此方案而不新增结构化附件块，是因为正文已经具有历史、流式与完整包保留路径；新增附件类型会无必要地扩大 proto、冷历史验证及存储范围。

### 2. 在平台提示追加入口提供最小格式指导

在 `package-resources.ts` 的现有提示追加组合中加入一段平台输出格式说明，与脑包认知独立组合：workspace 根、编码示例、先通过原获准工具核实文件、交付当前文件引用、不可把路径或下载发起当成任务成功。无脑包时也提供该说明，不恢复被显式禁用的包、Skills、Memory 或工具。

这是一段 UI 输出约定，不复制文件服务、业务逻辑或权限规则。验证需观察真实 SDK 构造的模型上下文及模型/工具交互，而非只断言常量存在。旧镜像不会自动获得指导；新版 UI 仍能消费任何已保存的合法文字引用。相较只修改 brain.md，此位置避免将 Files 的基础格式绑定到可选脑包，也不要求更新用户定制脑包。

### 3. 链接有真实 Files 地址，导航由同一工作区入口处理

新增可复制的 UI hash 地址 `#/work/<workId>/files/<encodeURIComponent(decodedWorkspacePath)>`。模型协议解码、UI 路由解码和 WebDAV 逐段编码是独立边界，各自只处理一次，不能对已解码文件名重复解码。该地址只定位当前 UI 内的 Work，不包含服务器地址或凭据。

Markdown renderer 获得真实 Work 上下文后，输出指向该地址的 Link 和受控路径数据；普通点击由原导航/未保存保护接管，修饰键/新标签保留链接语义。纯用户输入、工具结果、代码块和 Markdown 图片不生成该动作。请求详情仅对确有关联的 Run Assistant 回复复用安全 renderer，不把业务 result/evidence 任意文字改成动作。

处理顺序：保存来源 Session/阅读锚点及请求详情返回信息；执行原脏文件/配置保护；退出 Focus/Full screen；进入带目标身份的 Files 稳定外壳；核对 Work 与目录并读取文件。明确文件深链接优先于“恢复上次区域”的默认选择，慢响应不能覆盖用户后来选择。深链接的首次打开、刷新、当前登录恢复使用同一目标读取入口，不创建 Session 或 Run。

失败留在对应目标状态，显示缺失/不可用/读取错误及 Retry、Back to files 或返回来源。原目录缺失时只能明确说明后回到已核实的可访问上级，不静默打开别的文件。普通 Chat 返回沿现有导航保持原 Session/草稿/阅读锚点；从请求详情进入则保留原请求的返回身份、过滤和阅读位置。

```text
Agent tools --> workspace file
     |
     v
Assistant text --> stream / history / imported Work
     |
     v
validated reference + reply Work identity
     |
     v
dirty guard --> exit focus --> Files target shell
                                  |
                                  v
                        authenticated WebDAV read
                                  |
                     +------------+------------+
                     v            v            v
                 UTF-8 text     image      other / PDF
                   editor      preview        info
                     |            |            |
                     +------------+------------+
                                  v
                         explicit Download
```

### 4. 元数据与预览状态分开，重开读取当前文件

在 `adapter.ts` 和文件辅助模块中统一“核对当前目标 + 有界读取”入口。重开/刷新先更新目标父目录或 Depth 0 元数据，不能因旧文件缓存已存在就跳过核对。返回的文件系统种类与 UI 预览种类分开表达，避免旧的 binary/text 标记阻止后来的新类型读取。

预览状态按身份 epoch、Work、路径和本次读取代次绑定，区分 loading、text、image、download-only、missing、unavailable、error。每次读取成功才能成为新确认内容；目录 mtime/size 相同不足以证明正文相同，不用它恢复旧图片 Blob 为新内容。服务器文件在读取与下载间可能再变，明确采用当前路径语义而不伪造版本保证。

文件错误优先读取原响应中安全的 `X-Piwork-File-Error` 与 HTTP 状态，以区分缺失、Work 不可用和 helper 故障，旧后端缺少代码时给出准确的通用状态；错误正文不能无界读取或展示内部路径。鉴权拒绝复用既有会话核对/撤销入口，不能仅把 401 当成普通图片损坏而继续展示已撤销身份的内容。

文本保持原 1 MiB / UTF-8 / 无 NUL 规则。脏文本刷新仍保留草稿和独立的 reread 内容，不能由新元数据偷偷提升保存基线。图片展示不带 Saved/Save/编辑控件。其他普通文件保留名称、路径、大小及下载，不尝试文档执行或自动转换。

### 5. 图片在浏览器有界识别和解码

按真实文件签名识别 PNG/JPEG/WebP，复用或提取 `images.ts` 中适用的纯尺寸检查；不复用输入草稿的 Base64/上传状态，也不改变输入图片限额。新增输出预览预算为每文件 10 MiB、每边 8192 像素、总像素 40,000,000，这是本次选择的有界默认值。

已确认超出 10 MiB 的目标直接给下载入口；其他读取从流的有限首段识别内容，非图片按文本预算或下载处理，实际读取超过对应上限即取消。接受图片前检查尺寸并确认浏览器能够解码，再建立正确 MIME 的 Blob URL；渲染为 Files 内的只读 img，适配容器，不做转码/缩略图持久化。预览失败有局部原因和原文件下载，不自动触发下载。

每个查看目标最多一个活动内容读取。离开文件/区域、重新读取、身份切换、注销、确认 Work 停止及卸载时取消读取、释放 ImageBitmap 和 Object URL；每次异步完成检查原身份/目标/代次。普通重绘复用同一已确认预览，不因 Run 增量不断重新解码。暂时状态观察失败保留最后已知表达，真实撤销走原清理。

下载继续使用当前受保护 `fileURL`，不复用预览 Blob 或编辑草稿，因此不受预览预算限制，仍由 Core 原文件限额约束。

### 6. PDF 在本次使用下载回退，浏览器原生行为不成为实现依赖

用户只允许无需额外查看器的浏览器原生 PDF 行为。当前 WebDAV 为通用二进制，现有 Download 动作可以直接交付 PDF；Files 并没有自然可用的 PDF 查看入口。本次按普通文件提供 Download，不增加 PDF 专用代码、依赖、端点、CSP 例外或“必须预览成功”的验收要求。用户浏览器对下载文件自行打开/预览的行为可以照常发生，但 Piwork 不将其表述为已完成的 Files PDF 预览。

相较引入 PDF.js 或为原生查看器另建 MIME/iframe 链路，这一选择符合用户要求的最小范围，也避免把可选条件变成新的 PDF 子项目。

### 7. 复用文件后端和资源交付链路

不改变 WebDAV 的 MIME、权限、运行门禁、Range、路径保护或流式下载。图片采用浏览器已有解码与 img-src blob:，无需 Go 代理新接口、PDF 依赖或 CSP 放宽。新增浏览器辅助模块保持现有扁平 JS 交付形式，通过原 build 同步 `internal/desktopassets/static/`。

| 受影响模块 | 实施责任 |
| --- | --- |
| `apps/agentd/src/package-resources.ts` 及提示词辅助文件/测试 | 注入最小平台约定，验证有/无脑包的实际 SDK 行为 |
| `apps/desktop-webui/src/file-reference.ts`（新增）、`chat-markdown.ts` | 严格协议解析、Work 绑定与真实 Files 链接，保留现有安全渲染 |
| `apps/desktop-webui/src/app.ts` | 文件深链接、目标外壳、Focus/dirty guard、来源返回及请求回复入口 |
| `adapter.ts`、`models.ts`、文件预览辅助模块（按需新增） | 当前元数据、有界二进制读取、类型/错误状态及取消/释放 |
| `images.ts`、`public/style.css` | 复用适用的图片检测，局部预览布局，不改变输入图片语义 |
| `apps/desktop-webui/test/`、Agent SDK/历史测试与现有真实 Core 夹具 | 路径、状态、浏览器和真实文件交付回归 |
| `internal/desktopassets/static/` | 与源码同提交更新的嵌入生成资源；重建 Core/CLI |

## Risks / Trade-offs

- [当前文件引用会因修改/删除失去原内容] → 按已确认语义展示当前文件或明确缺失；提供固定版本附件需要另一个授权范围。
- [模型输出链接不保证文件存在] → 实际上下文提供核实指导，浏览器最终从真实文件后端取证；缺失不冒充成功。
- [路径多次编码或 URL 规范化隐藏穿越] → 原始格式校验、逐段一次解码、跨入口测试及 Core fd 路径保护共同约束。
- [图片内存与晚响应泄漏] → 固定字节/像素预算、单目标读取、取消与资源释放、身份/代次检查。
- [图片预览与用户图片历史被误合并] → 只复用纯检测函数，分别管理可变 workspace 状态和不可变会话图片身份。
- [旧 Agent 未获得新指导] → 新旧 UI/Agent 仍保留基本聊天；指导升级仅沿用户明确选择镜像与 Apply 生效。
- [PDF 不能直接在 Files 查看] → 明确提供原文件下载，不增加查看器来掩盖这一范围边界。

## Migration Plan

1. 实现后运行针对性 Agent/浏览器测试和真实 Core 文件交付回归；临时截图、日志和字节/hash 清单放在忽略的 `dist/`，不得包含真实用户数据或凭据。
2. 使用现有 WebUI 构建同步嵌入资源，执行 `make build`、`make build-cli` 及相关平台边界检查；按实际测试结果报告，规划文件本身不表示验收通过。
3. 新安装或用户显式采用兼容 Agent 镜像的 Work 获得指导；已有 Work 的包、历史、工具权限与镜像保持既有更新边界。只升级 UI 时可以识别已有合法引用，不伪造旧 Agent 已升级。
4. 不涉及数据迁移。回退 UI/Agent 代码和匹配生成资源后，历史仍是普通文字、workspace 文件保持；旧 UI 可能只显示链接标签/文字，这是展示降级，不删除文件或重放任务。
5. 本次仅完成本地构建与验证；镜像对外推送、正式发布、规格同步与归档分别沿用户后续明确请求执行。
