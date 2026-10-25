# Tasks

以下任务在 apply 阶段执行；规划完成不代表功能已实现或验收通过。各实现任务同时交付自己的必要测试，最后一组仅核对跨模块、真实后端与嵌入产物的完整闭环。

## 1. 文件引用格式与 Agent 指导

- [x] 1.1 实现独立的 Work 文件引用解析/编码辅助模块与契约用例，固定 `piwork-file:/`、单次逐段解码、回复所属 Work 绑定和 Files 深链接格式；通过桌面浏览器包测试验证中文、空格、`%`、`#`、字面 `%2e` 往返，以及 authority、query/fragment、dot segment、编码分隔符、控制字符、非法 UTF-8/percent 和 WF-005 长度/层数边界的拒绝。
- [x] 1.2 在既有 Agent 提示追加入口组合最小平台文件指导，保留 SDK 默认提示、AGENTS、脑包、Memory 与工具授权各自语义；运行 Agent 对应 SDK 测试，观察有/无脑包的实际模型上下文均含格式和核实规则，未启用的包/工具不会被加载，并验证真实 SDK 工具产出文件后可给出相应链接。
- [x] 1.3 为原 Assistant 文字事件、最终回复及持久会话补充文件引用兼容回归；通过 Agent/pi-adapter 对应会话测试确认断线恢复与进程重开保留原引用、旧消息仍可读、用户图片身份不变，且只读历史不执行模型/工具、不增加附件记录或 schema。

## 2. 当前文件读取与 Files 图片预览

- [x] 2.1 统一目标元数据核对与有界正文读取，在文件模型中分开文件系统类型和预览状态；随实现交付 adapter/文件读取测试，验证删除、改名、同大小/mtime 的内容变化、旧 binary/text 缓存、读取失败、symlink/特殊项、1 MiB 文本预算和实际流超限取消，确认不把目录缓存当作当前正文证明。
- [x] 2.2 实现 PNG/JPEG/WebP 内容识别、尺寸检查、浏览器解码和 Files 只读预览，保留现有 UTF-8 编辑器及普通文件/PDF 信息与下载；运行本组浏览器回归验证三种图片、TXT、后缀伪造、损坏图片、10 MiB/8192/40,000,000 预算、360px 布局与键盘返回，确认图片没有 Save/Saved 误导，PDF 没有新增查看器/转换或专用依赖。
- [x] 2.3 为文件预览实现单目标读取、身份/路径/代次检查及 AbortController/ImageBitmap/Object URL 清理，并与原脏文本 reread/保存基线协调；通过延迟响应与资源计数测试验证刷新、切换文件/Work/账号/Core、注销、Work 停止及卸载后取消/释放，晚结果不污染新目标，未保存文本下载仍是服务端版本且没有 PUT。

## 3. 聊天入口、Files 导航与失败返回

- [x] 3.1 将受控链接接入安全 Markdown renderer，生成以真实 Work 上下文绑定的 Files 导航链接，覆盖实时/历史消息和原请求已关联 Run 的 Assistant 回复；运行 Markdown/消息投影/请求详情测试，验证流式各前缀、代码块、用户/工具文字、原始 HTML、Markdown 图片、解析预算回退和现有 HTTP(S)/mailto 行为，确认仅渲染消息不产生文件读取或下载。
- [x] 3.2 实现文件 hash 深链接及统一目标打开入口，使显式目标优先于上次区域恢复，并处理普通点击、复制/新标签、刷新和当前登录恢复；通过路由与浏览器回归验证同一 Work/路径的定位、目标编码往返、无新 Session/Run、无外部请求，并确认服务端仍校验每个文件请求的当前身份。
- [x] 3.3 将文件入口与原 dirty guard、Focus/Full screen 退出及来源返回衔接，替换原先先读后切区的文件来源流程；通过普通 Chat、辅助栏、Focus chat、请求详情及窄屏用例验证 Files 真正可见，取消离开保留编辑，返回恢复原 Session、草稿、阅读位置或原请求过滤/阅读位置，未增加 Run/控制请求。
- [x] 3.4 为 Files 目标外壳增加明确加载、缺失、失败、Work/helper 不可用及合法 Retry/返回反馈；通过慢响应、连续选目标、缺失父目录、停止和权限拒绝测试验证原目标保留、不静默打开别的文件、不隐式 Start/Apply/调用模型，且正常读取成功不堆积状态条。

## 4. 真实交付与构建集成验收

- [x] 4.1 使用 `make build`、`make build-cli` 及现有 `native-agent-images`/`native-helper-images` 入口准备包含本次实现的宿主与隔离测试镜像，复用/扩展 `apps/desktop-webui/test/real-core.mjs` 的真实 Core/SDK/Engine 夹具；验证 Agent 实际生成并核实 TXT/图片、聊天链接打开 Files、当前文件修改/删除、普通文件/PDF 回退，以及托管工作台和独立 Desktop 的真实浏览器下载字节/hash 一致，预览与导航没有额外模型提交。
- [x] 4.2 在同一隔离端到端夹具中验证含文件引用的历史重开、完整包导出导入新 stopped Work、源 Core 不可达以及用户显式 Start 后的文件定位；检查原引用仅按接收 Work 相对路径解析、旧 Run 不重放，并验证跨账号拒绝和旧链接在撤销后不可恢复访问。资源清理仅针对本次 installation ID，临时证据置于 `dist/`。
- [x] 4.3 核对实现源码、各组必要测试及 `internal/desktopassets/static/` 生成资源一致；执行桌面 workspace 的 `typecheck`/`test:browser`、相关 Agent 单元与会话测试、现有 Go Desktop 文件代理回归、`node scripts/check-native-boundary.mjs`、`node scripts/check-repository-docs.mjs` 和 `git diff --check`，按真实结果补记本变更必要验收事实，确认未引入 PDF 依赖、宿主运行时工具依赖或未经请求的对外发布。
