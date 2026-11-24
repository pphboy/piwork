# Design

## Context

动机与产品范围见 [proposal.md](proposal.md)。本设计对应已选定的方案 3 和最后一次 IA 调整，不重新选择布局或配色。

已核对的当前事实：

| 来源 | 事实及影响 |
| --- | --- |
| `apps/console-webui/src/app.ts` 的 `shell`、`skillsPage`、`skillDetails`、`packagesPage`、`packageDetails`、`uploadChooser` | 当前分别管理默认 Work、Skills、Packages；目录选择和四类 Package 来源已经存在。改入口与内容展示，保留原上传及操作协议。 |
| `apps/console-webui/src/adapter.ts` 的 `skills`、`uploadSkill`、`catalogAction`、默认配置读写 | Skill 只读到管理元信息，没有目录/正文 API；默认配置已有局部 PATCH，不需要新的默认集合或“设为默认”接口。 |
| `internal/coreapp/skill_manage.go`、`skill_upload.go` | 管理员更新目前是完整目录上传；`publishSkillSnapshot` 在 `skillMu` 下发布不可变制品并原子更改 catalog，更新保留 enabled。 |
| `internal/skillartifact/{scan_linux,publish_linux,upload_linux}.go` | 已有有界快照、无链接路径访问、完整树验证、发布与清理。单文件保存应生成新完整快照，不能原地修改旧制品。 |
| `internal/coreapp/{work_create,work_configuration_save,package_work_publish}.go` | Work 复制 Skill 也使用 `skillMu`；单文件编辑必须加入同一临界区，保留 Work 自有副本。 |
| `internal/consoleapp/console_api.go` 的 `consoleAllowedAdmin`、`admin` | 现有 GET/PUT 新文件路由不在白名单；泛化的 Skill PUT 会被当成 multipart，且成功响应读取限制为 1 MiB。不能只在前端增加编辑器。 |
| `internal/coreapp/http.go` 的 `readJSON` | 通用 JSON 读取上限 1 MiB，不能覆盖已有合法的 8 MiB Skill 文本；只为新内容入口使用专用有界读取。 |
| `scripts/generate-http-contracts.mjs` | HTTP 契约由冻结 schemas 基座与当前 TS schema 合并生成，不能反向只修改 Go generated 文件。 |

规格冲突明确修订：SUI-SKL-001 当前禁止展示正文，本变更改为专用管理员接口上的原文编辑；SKM-002 原“内容更新使用目录上传”扩展为目录整体更新与现有文本文件保存两条入口。SKM-003 的原 catalog/普通用户发现、Work、Session、Run 隔离规则不放宽。

## Goals / Non-Goals

**Goals:**

- 页面导航、库对象管理和文件保存各有明确所有者；操作非当前 Skill 不改变当前文件草稿。
- 单文件保存以当前完整制品为基础，持久保存指定文件，拒绝同文件过期覆盖，保留其他文件及已有 Work 副本。
- 复用现有认证、目录上传、默认配置、发布/清理、ActionState、视图准入和资源嵌入链。

**Non-Goals:**

- 不新增文件管理器的创建、重命名、删除、二进制/非 UTF-8 转码、Markdown 阅读模式或 Package 文件 API。
- 不新增草稿数据库、localStorage 自动保存、编辑历史、自动合并、写入重放、后台编辑 Operation 或通用资源管理框架。
- 原型未展示完整 AGENTS.md 编辑、模型/用户等界面，不代表删除这些已有契约；本次不重做它们。

## Decisions

### 1. 固定页面与对象层级

```text
Work setup
  +-- Library
  |     +-- Skills -> selected Skill -> relative files -> text editor
  |     +-- Packages -> selected Package -> public metadata
  +-- New Work defaults -> existing default configuration
```

- `/admin/skills` 与 `/admin/packages` 分别进入同一能力库的对应分类；能力库主入口优先 Skills，不把旧 Packages 链接改成另一个对象。原 `/admin/skills/<name>`、`/admin/packages/<name>` 直接选中对应项，`/admin/default-work` 进入新 Work 默认。保留已知 Operation 链接与返回 Packages 分类的路径。
- 左侧只展开当前 Skill 的文件树；选新 Skill 默认打开 `SKILL.md`。集合入口无指定对象时取按名称排序的首项；这是确定性的初始选择，不硬编码原型示例名称。
- 页面只保留添加 Skill/安装 Package，刷新仍在库列表所属区域。Skill/Package 行菜单显式绑定该行 name 与权限，提供该对象的信息、更新、启停、移除。右侧 Skill 文件工具栏只显示当前路径与保存，不放 Skill 或默认配置命令。
- 新 Work 默认保留现有默认配置的 Skills 选择与排序、AGENTS.md 原文编辑、无效已选项和仅提交已改字段的规则；Packages 按已确认原型支持多选、上移/下移及保存后的顺序回读。新增选择追加至已选列表末尾，移除后保留其余条目的相对顺序；首尾边界的对应排序按钮不可用。默认选择的更改不随文件保存提交，更新旧 Work 仍需原有显式配置/Apply。
- 沿用 `apps/ui-shared/tokens.css`、现有字体和控件。简化局部层级，不修改配色、不增加第三个常驻面板。窄屏先在同一 Skill 下选文件，再进入编辑区域，提供返回文件列表；行操作一直有键盘和触屏入口。
- Work 设置壳统一在内容标题上方渲染“能力库 / 新 Work 默认”导航。两个链接共用管理顶栏的文本、间距与当前项样式，在 39px 工作区导航行内垂直居中。桌面使用蓝色下划线，窄屏使用浅蓝底。能力库和默认配置切换时导航位置保持一致。

### 原型交互与实施验收对应

| 已确认交互 | 规格 / 任务 |
| --- | --- |
| 方案 3、原配色、精简 Header、能力库/新 Work 默认导航 | SUI-004；任务 4.2、5.1 |
| Skill 下原位展开文件，仅展开当前 Skill，默认 SKILL.md | SUI-SKL-001；任务 4.2 |
| 原文编辑、仅保存当前文件、未保存三种离开选择 | SUI-SKL-004；任务 4.1、4.2 |
| 行菜单绑定被操作的 Skill/Package，文件区仅保存 | SUI-SKL-003、SUI-PKG-005；任务 4.3 |
| 默认 Skills 选择/顺序、Packages 多选/顺序、保存/取消、默认标记同步 | 现行 SUI-CFG-003、SUI-PKG-006；任务 5.1、4.2 |
| 单个完整目录添加/更新及路径、身份、限额 | 现行 SUI-SKL-002、SKM-004；任务 5.2 |
| 名称搜索/清空保留草稿、Ctrl+S、行号/光标位置与保存状态 | 本节界面细节；任务 4.2 的 browser 验收 |
| 手机文件列表与编辑切换、菜单定位与键盘焦点 | SUI-004、SUI-SKL-004；任务 4.2、4.3 |

搜索只筛选左侧 Skill/Package 名称，不替换当前文件和草稿；Ctrl+S 只在文件编辑上下文保存当前文件，不提交默认配置。行号与光标位置是编辑器展示，不引入文件格式化。Packages 排序按 SUI-PKG-006 验收，覆盖原型的上移/下移控件。

默认 Packages 顺序复用现有 `packages` 数组：`internal/coreapp/default_work_patch.go` 的管理员转换与配置赋值按输入顺序追加，`apps/console-webui/src/adapter.ts` 的默认配置投影也保持数组顺序。前端对已选列表排序，不能用 catalog 的名称排序重新构造提交数组。只调整顺序时仍视为 packages 字段修改；显式保存只 PATCH 该字段，取消保持基线。重新读取、刷新及重启后顺序一致，新 Work 继承当时默认数组；已有 Work 不被自动修改。本次不定义新的资源覆盖、冲突或运行时加载优先级，也不新增排序接口、sortOrder 字段或存储。

### 2. 增加三个管理内容操作，保持原 catalog 不变

| Core 请求 | 输入 | 成功输出 |
| --- | --- | --- |
| `GET /api/v1/admin/skills/<name>/files` | 原 Skill name | `{files:[{path,size}]}`；只列普通文件，以路径推导父目录 |
| `GET /api/v1/admin/skills/<name>/file?path=...` | 相对路径，查询解码一次 | `{path,content,version}`；最大 8 MiB UTF-8 正文，不含 NUL |
| `PUT /api/v1/admin/skills/<name>/file` | `{path,content,expectedVersion}` | `{path,version}`；确认同步发布，不创建 Operation |

仅 `/api/v1/admin` 的有效、启用管理员会话拥有这些操作；不增加 `/control` 路径别名、普通用户内容接口或 CLI 命令。原 `/api/v1/admin/skills` 和单项管理投影继续不携带正文，普通用户发现仍只返回名称。读取与保存也允许目标 Skill 当前为禁用状态，更新保留原状态。

文件版本使用该文件原文字节的 SHA-256 派生不透明字符串；客户端只回传，不解释，不使用内部完整制品 digest。它是新内容响应的一部分，不改变现有公开身份或引入持久 revision。使用 JSON 中的版本字段，避免为单一功能扩展全局 header/ETag 转发与缓存协议。

路径在查询或 JSON 解码后执行一次相同的相对路径校验，沿用现有 64 层、4,096 字节及段规则；不重复 URI 解码。只从 catalog 对应的受管 Skill 制品读取，经现有安全目录访问和制品完整性验证，禁止 `os.Open` 拼接客户端宿主路径。

错误按 delta 规格：复用 `SKILL_UNAVAILABLE`、`SKILL_UPLOAD_LIMIT_EXCEEDED` 和鉴权/上传 busy 规则；新增 `SKILL_FILE_INVALID`、`SKILL_FILE_NOT_FOUND`、`SKILL_FILE_NOT_TEXT`、`SKILL_FILE_CONFLICT`，注册原错误映射及双语提示。内容成功响应使用 `Cache-Control: no-store`，正文不进入错误、请求日志或验收报告。

### 3. 在既有锁与发布边界中完成单文件保存

```text
authenticate -> bounded request -> skillMu
  -> load current catalog + verified full snapshot
  -> check existing file + expectedVersion
  -> replace one file in a copy of the current snapshot
  -> validate limits + immutable artifact publish
  -> reauthorize in catalog transaction + switch current pointer
  -> existing cleanup -> confirmed response
```

对 `publishSkillSnapshot` 做最小内部整理：外部入口仍负责取得原锁，锁内发布步骤由同包 helper 复用，避免文件保存先加载后解锁再发布，或重复加锁。清单/正文读取在同一锁保护下取得并加载当前快照，避免 catalog 切换后的清理与读取竞态。Work 创建/重选与原目录上传沿原同一边界运行。

保存先检查指定现有文件可编辑且版本匹配，再克隆当前 `Files` 与 `Directories`，只替换该文件的数据，复用完整树校验/身份计算及 Publish。既有目录项和所有未编辑文件保持，不通过清空目录后重建的方式修改旧制品。不新增数据库表、备份目录、文件锁服务或内容缓存。

两个管理员修改同一个文件时，第二次过期提交返回冲突。另一个文件已被修改时，从当前完整快照继续只替换目标，保留其他更新。整个目录被替换后，若目标文件原文未变则可在最新目录保存；原文已变则冲突，目标已消失则返回文件不存在。相同内容的再次显式保存可返回相同版本，不需要独立幂等账本。

必要性：缺少文件版本检查会静默覆盖同文件并发编辑；缺少共享临界区会丢失其他文件的已发布更新；原地写旧目录会破坏完整制品和 Work 副本契约。使用现有锁、快照和事务已经足够，无需扩展为编辑历史或自动合并系统。

### 4. 仅为内容路由扩展浏览器转发

在 `consoleAllowedAdmin` 精确加入上述两个 GET 和一个 PUT 的方法/路径组合。文件 GET 只转发合法的单一 `path` 查询参数，不能沿用当前省略 query 的拼接方式，也不能接受任意上游或宿主路径参数。

新的 JSON 文件 PUT 必须在现有泛 Skill PUT multipart 判定之前被识别；目录 PUT 继续只接受 multipart。Core 与 Console 为文件内容请求/响应使用 64 MiB 的有界 JSON envelope，解码后的文件仍以 8 MiB、全树 32 MiB 为准。该 envelope 覆盖 JSON 转义膨胀，不是增大业务文件上限；其他管理 API 保持原 1 MiB 响应和原请求限制。

文件保存复用 Skill 内容上传的两个接收槽及有界读取机制，失败释放槽并清理未发布制品；不新增任务队列或配置项。Console 可沿用已有内容上传预算；原会话验证、Host/Origin、CSRF、只向绑定 Core 转发和 502 结果未知分类均保持。内容读取的局部失败只影响该文件，不能伪装为空库。

### 5. 前端状态按职责持有

| 所有者 | 数据与职责 |
| --- | --- |
| Core catalog / skillartifact | 持久名称、启停、完整制品和字节；单文件保存唯一发布边界 |
| Console 管理转发 | 会话、CSRF、精确路由与容量约束；不直接读 Core 存储 |
| 能力库 feature | 分类、选中 Skill、展开文件夹、明确的行菜单目标及所需公开 catalog 投影 |
| Skill editor feature | 当前 Skill/path、读取版本、原文基线、草稿、原提交快照与保存结果；不拥有默认集合 |
| 原默认配置功能 | 完整默认配置与各字段草稿、基线和 PATCH；原 AGENTS.md 编辑继续复用 |

将新的树/编辑交互放在内聚的 Console 功能模块中，避免继续把所有新状态堆进 `app.ts`。文件内容端口只需身份代次、列文件、读原文、保存原文；实现由当前 adapter 提供，feature 不接整份 adapter/store，不导入入口。纯展示不读取其他 Work 或模块状态；不为一处消费创建通用编辑器框架或重构全仓。

按需读取所选 Skill 清单及当前文件，不预加载整库正文。选择和异步响应按身份、Skill、路径、视图代次核对，复用 `view-scope.ts` 等既有准入。保存只提交原文件快照；成功若晚于新输入，只更新已确认基线，后来输入继续 dirty。普通成功/失败和未知写入沿 `ActionState`、notice 与 readback 规则，不能把刷新成功当成原写入成功。

文件切换和离开视图处理三种选择：继续编辑、放弃后切换、保存明确成功后切换。未知保存保留原提交和锁，只读原文件核对；不新建持久恢复记录、不重放 PUT。冲突保留草稿，显式重新读取替换前确认。身份失效清理内容/草稿及上传引用，原型的页面内模拟不变成生产草稿持久化。

### 6. 契约、交付与冻结参考

在 `packages/contracts/src` 增加内聚的 Skill 内容 schemas（建议 `skill-content.ts`），从当前入口导出并接入 `generate-http-contracts.mjs`，通过 `make generate` 同步 Go DTO/schema/golden。实际 UTF-8 字节数由端点验证，不能只依赖 schema 的字符串字符数限制。同步 Console 中英文、样式、内嵌资源和宿主程序；不手修 generated 输出。

冻结参考在 [prototype/index.html](prototype/index.html)，包括原静态脚本、CSS、tokens、logo、临时 server 快照及 [桌面截图](prototype/IA-v6-desktop.png)、[手机截图](prototype/IA-v6-mobile.png)。这些文件按字节复制自本轮 v6 原型，`prototype.mjs` SHA-256 为 `281ae83275f6ad9b5f19bb6ba06f059e33710128c1e0bc3307f343dfe4d96f6c`，tokens 为 `be0d1fd670d99951672b6c5d2708d5941d4076a3db409016574a0fd30b615fbb`。预览需要 HTTP 静态资源及 `/admin/*` 的 HTML 回退；附带 server 的本机地址与端口仅记录原预览环境，不作为生产配置。

已观察的原型行为：目录选择、文件读取/保存、切换保护、默认选择/排序、未选中行操作的目标隔离、桌面及 390px 布局和原配色。原型使用合成内容与内存状态，没有验证生产鉴权、持久发布、并发冲突或真实网络失败；这些必须按任务执行。截图和复制成功不计为生产验收。

## Risks / Trade-offs

- 管理员内容权限比原元信息页面更宽 → 明确只新增管理员专用路径，普通接口不扩字段，内容不渲染执行且不进入日志。
- 读取完整快照会有最多 32 MiB 的验证成本 → 复用已有界限、按需读取、只持当前文件；没有现有测量依据，不增加缓存或异步索引。
- 新 API 扩充 JSON envelope 容易误伤其他管理入口 → 精确分类内容 GET/PUT；负例验证目录 PUT、普通 API 限制和通配拒绝保持。
- 行菜单与编辑器同时存在易误用选中项 → 请求必须使用菜单触发时捕获的目标，针对未选中条目的 info/toggle/remove 回归验证草稿不变。
- 原型省略既有表单能力与错误路径 → 保留 AGENTS.md、Package 四来源/Operation 及已有 unknown/readback 规则，不用原型的简化替代现行规格。

## Migration Plan

不迁移现有数据或 Skill 身份；新接口为增量，旧 catalog/目录更新和旧链接保持。构建并验证配套的 Core/Console 内嵌资源后交付，不修改或重启用户当前安装，不增加旧 Core 适配层。

回退到旧 UI/Core 时，已保存内容仍是原格式的完整 Skill 制品，旧版本可继续按名称选择和目录更新。外部发布、归档及主规格同步由后续明确指令执行。
