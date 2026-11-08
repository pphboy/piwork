# Design

## Context

动机及已确认范围见 [proposal.md](proposal.md)。行为要求由本变更的 [Web 环境增量](specs/web-development-base/spec.md)、[brain 增量](specs/piwork-brain/spec.md) 和 [部署增量](specs/agent-service-deployment/spec.md) 承载。

当前实现已提供 NiceGUI 的镜像、依赖准备、版本与页面自动采用，brain 中的 web-app/workstation 模板提供相同业务闭环。关键调查事实如下（行号为规划时位置）：

| 已读取来源 | 发现与设计影响 |
| --- | --- |
| `deploy/images/web-base/Dockerfile:1-35`、`environment.json`、`requirements.in/lock` | 环境固定、UID 10001、只读依赖和 sqlite3 已有模式，新镜像沿用约束 |
| `tools/piwork_web_dependencies.py:17-272` | 依赖安装已有锁、应用环境、离线 wheels 和失败保护；适合抽取为两种镜像共用来源 |
| `tools/freeze_environment.py:9-20`、`piwork_web_runtime.py:12-73` | 环境校验硬编码 NiceGUI，页面 head 依赖 NiceGUI request；需独立栈适配 |
| `tools/piwork_web.py:44-87,124-162` | 页面默认文件、版本命名和检查/运行入口均基于当前模板；测试预发现只识别根 test 文件与 test/，新 tests/ 不能被漏过 |
| `tools/page-client.js:104-165` | 页面自动采用包含 NiceGUI socket 拦截，不能原样作为 htmx 客户端 |
| `scripts/build-web-base.mjs:21-34` | 构建 hash 枚举当前 tools；新增 vendor CSS/JS 和共享源必须一起进入输入身份 |
| `internal/coreassets/piwork-brain/skills/deploy-work-service/initialize.mjs:19-38` | 只接受两个模板；独占目标、Spec 先行及写入顺序须保持 |
| `templates/{web-app,workstation}/workstation.py`、`piwork_protocol.py` | 两套模板的业务与协议字节相同；业务可与页面适配分离，SQL 已直接执行 |
| `templates/web-app/workstation.py:13-28,80-134` | Job 以进程 executor 认领，启动会终结其他 executor 的未完成 Job；官方 starter 应保持单 worker |
| `internal/coreapp/service_gateway.go:424-466`、`tools/piwork_web_runtime.py:45-63` | 平台校验并传递动态前缀，应用负责输出正确 URL，不能依赖代理改写 HTML 或 htmx 响应头 |
| `internal/coreassets/brain.go`、`brain_test.go:35-49`、`internal/coreapp/bundled_brain.go:26-143` | 脑包由 Go embed 生成，版本是更新标记；需更新资源检查并重建宿主程序 |
| `scripts/check-web-base.mjs:106-131`、`internal/coreapp/brain_workstation_integration_test.go` | 已有真实浏览器及 SDK/反馈/导入回路，但栈断言和模板路径需适配 |

当前主规格以 NiceGUI 为默认，同时允许用户指定其他栈。本变更以 ADDED Requirements 增加可选能力，不把旧 WEBBASE-009 的环境切换提速目标套用为新栈的性能承诺。已发布 FastAPI/React 历史制品不是新栈来源。UI 采用说明及 v1.0 原文的语义控件、反馈和焦点原则继续适用；Bootstrap CSS 是本次明确选择，模板不依赖 Desktop/Console 私有组件。

## Goals / Non-Goals

**Goals:**

- 将镜像环境、brain 开发指导及应用副本的所有者分清，使新栈能沿现有 Service 路径创建、迭代、验证和分享。
- 源码编辑有直接坐标，运行内容与检查及版本一致；UI 与 Agent 复用一份业务实现。
- 同一组业务契约验证两种 UI 适配，栈相关页面行为分别验证。

**Non-Goals:**

- 不新增技术栈选择器、复杂度自动判定器、平台调度器、数据库服务、ORM、迁移体系或 npm 构建链。
- 不把“更重工程”解释为分布式部署、多 worker 或性能优于 NiceGUI 的承诺。
- 不自动转换旧应用、热更新旧脑包 active context，或扩大为 Core/MicroVM/官网发布。
- 不改平台 HTTP/proto/history 契约或全量重做 Desktop/Console UI。

## Decisions

### 1. 新镜像独立维护，公共依赖工具只有一份来源

新增 `deploy/images/fastapi-htmx-base/`，使用 `docker.io/pphboy/piwork-fastapi-htmx-base` 作为拟定镜像仓库名；正式 tag/digest 只由真实构建和获准发布生成。首版使用 Python 3.13、Linux amd64，采用与当前基础环境兼容的 Python 上游 digest；FastAPI 等包的精确版本在锁定步骤确定，不将讨论中的版本号当已验证组合。

目录包含 Dockerfile、environment.json、requirements.in/lock、vendor 资源及其来源/版本/SHA256/许可清单、专用运行工具和双语 README。htmx 与 Bootstrap 5 采用预构建的 JS/CSS 文件，构建时完整性核对，运行时本地提供；不提供 Bootstrap JS bundle，也不引入 Sass 编译。基础镜像无业务 Demo、脑包执行引擎和平台凭据。

上游两个压缩文件保留原始字节及许可；源码风格检查仅对这两个精确路径排除格式规则，内容仍受 vendor SHA256 清单、构建核验和篡改负例约束，应用自有 CSS/JS 继续接受原检查。

把现有 `piwork_web_dependencies.py` 移入 `deploy/images/web-common/` 作为唯一维护源，两种镜像构建时复制到原 `/opt/piwork-web-base/lib` 布局。两个镜像都使用 `/opt/piwork-web-base/environment.json` 与 constraints.txt，避免引入可由应用改写的 base 路径配置。NiceGUI runner 的现有调用接口保持兼容，公共代码的注释和环境校验改为实际清单驱动。

Docker 构建上下文调整为能访问 sibling common 目录的 `deploy/images/`，COPY 与输入清单只包含对应栈及明确共享文件。构建脚本基于显式文件清单计算 hash，包含 vendor 和共享源；不把临时下载缓存或 dist 作为来源。现有固定 NiceGUI 制品不重写身份；共享源码调整后的新候选按自己的输入重新验证。

选择独立镜像而非在 NiceGUI 镜像追加 htmx，便于下游查明实际环境和避免不需要的 UI 框架耦合；不复制整套依赖安装器，避免离线和失败语义分叉。

### 2. 新 starter 在初始化时装配为自足应用

新增 `templates/fastapi-htmx/`，同名初始化参数为 `--template fastapi-htmx`。现有 `web-app` 默认值保持。将当前两个模板相同的业务、协议及相应契约测试移入 `templates/common-workstation/`，由 initializer 与各栈覆盖文件合并复制；初始化仍先独占目标、写 Spec，再复制源码和注册，重名文件冲突由开发检查拒绝，不用覆盖顺序隐含决定来源。

应用副本中的建议坐标如下；只创建实际需要的模块，不引入空 repository/service 抽象层：

```text
apps/<name>/
  SPEC.md / README.md
  app.py                    # FastAPI assembly, lifespan, single-worker launch
  agent_api.py              # existing /pi/v1 JSON adapter
  pages.py                  # full pages, read-only HTML fragments
  ui_actions.py             # form inputs, HTML results, error presentation
  workstation.py            # shared sample business and direct SQL
  piwork_protocol.py        # shared transactions, Action, Event and receipts
  templates/                # layout, full pages and partials
  static/                   # application CSS and plain JS
  tests/                    # business/protocol/route/template checks
  requirements.in / requirements.lock
  page-files.json / review_config.json
```

框架适配分别调用同一个 Workstation/WorkProtocol。初始化后全部业务代码和测试在应用副本中，运行不 import 冻结脑包或另一应用；旧已初始化 Work 不受模板源移动影响。当前直接 cp 模板目录的开发夹具改用同一 initializer，以实际交付路径验证装配，而不是维护测试专用模板。brain 中现有历史 FastAPI fixture 保持其历史用途。

当前导出结果中的 `data/workstation/` 是示例名写死的路径；装配为任意 Service 名称后，产物引用统一从实际身份的 serviceName 生成。保持现有 workstation 名称结果兼容，并以非 workstation 名称的导出验证消费者可取得真实文件。

### 3. 运行经过检查的版本副本

FastAPI 提供 `/usr/local/bin/piwork-fastapi`，保留 prepare/check/run/serve 的简洁命令语义；Service 使用 `run --app /var/data/workspace/apps/<name>`，明确安装额外依赖时添加 `--install-deps`。Python/pip 在 Service 执行，Agent 用已有 bash/文件工具编辑源和调用现有 Service 操作。

生产运行采用应用目录内的版本副本：

```text
editable source --> dependency preparation --> candidate source copy
                                                   |
                                     Python + Jinja + pytest checks
                                                   |
                                  checked release under .build/releases
                                                   |
                                     Uvicorn process serves this copy
```

- 依赖准备在应用根执行，保留现有 `.deps/` 与精确 wheels。准备和版本复制使用同一应用级锁，避免两个准备过程混合输入。
- 枚举有效源码、配置、页面、资源与测试，排除 `.deps/.build/.cache/.tmp`、业务数据、秘密和生成标记；拒绝源链接和路径逃逸。复制前后及激活前核对工作副本输入 hash，不一致则报告需要按当前输入重试。
- 在 `.build/releases/<codeVersion>/` 的候选副本执行 Python 编译、全部模板解析及 pytest。pytest 显式识别 tests/、test/ 和根 test 文件；有效测试失败必须失败。测试业务数据始终隔离于真实 data 目录。
- 同输入和环境优先读取 `.build/checks.json` 中记录的 release，校验路径、输入身份及副本内容后复用；记录不可用时再检查标准版本目录，全部无效才重新检查生成。修复后的带后缀副本继续使用同一记录，不扫描目录建立新索引。run 与 serve 共用此选择逻辑。运行前核验副本清单。发布后的副本不再改写，工作副本仍供 Agent 编辑。保留当前与上一有效副本，只有不被实际进程引用的旧材料可回收；这些副本可从源和锁文件重建，不复制标准依赖。
- 进程从该副本启动，模板 loader、静态文件和业务配置读取该副本，HOME/TMP/缓存及额外依赖仍使用原应用根，业务 data 通过实际 Service 身份解析绝对路径。版本接口使用进程加载身份，而非每次读取可写 marker。
- Jinja2 禁用运行中的自动模板重载，并使用显式 HTML autoescape；模板延迟加载也只能访问同一版本副本。单纯设置 auto_reload=false 不足以冻结尚未加载的模板，所以保留版本副本边界。

版本副本用于隔离正常编辑和运行，不声称是恶意同 UID 写入者的安全隔离。开发者仍可用显式自定义命令进行通用 FastAPI 开发，正式 starter 的交付证明沿 checked run 路径；不另造必须使用的实时开发服务器。

codeVersion 覆盖有效应用实现、锁定依赖和实际镜像环境；frontendVersion 覆盖 templates/、static/、页面适配模块及显式附加页面输入。页面清单支持按目录稳定枚举 templates/static，以自动包含新增/删除文件，并保留严格的越界/链接/缺失输入校验；仅在新 FastAPI runner 中采用新清单版本，旧 NiceGUI 清单算法和输入语义保持兼容。新镜像使用自己的环境与算法标识，不假借 `piwork-nicegui-version-v1`。

### 4. 页面、表单和 Agent 是同一业务的不同适配

```text
Browser -- HTML/forms --> UI adapter ----+
                                        +--> Workstation --> SQLite
Agent --- /pi/v1 JSON --> Agent adapter -+         |
                                              Action/Job/Event
```

app.py 只装配、管理 lifespan 和启动；单个 Uvicorn worker 负责现有示例 Job 与 outbox 线程。官方 runner 不读取宿主 worker 数或隐式启用多个 worker。显式自定义启动属于普通应用能力，不宣称与该 Demo 的 Job 认领兼容。复用现有中断处理，不在本变更实现分布式 Job 协调。

完整页面使用普通 GET 路由，局部读取使用独立片段路径，避免一个 URL 的 HTML/片段缓存混用。导航保留可直接刷新的真实路径；首版无需全站 hx-boost 或 SPA 路由。浏览器输入使用 Form/UploadFile 和明确 multipart 编码；python-multipart 作为环境能力进行合成表单/上传检查，不为现有 Todo 业务额外增加上传产品功能。临时文件写入 workspace 授权目录。

UI 每次真实请求生成临时 Action ID，并携带页面的 expectedStateVersion 进入相同业务方法。业务表单使用 htmx 的共享 `hx-sync="closest main:drop"` 与 `hx-disabled-elt="button[type=submit]"`，只限制当前 HTTP 请求，不建立客户端提交队列。参数捕获后清空发送的输入；响应结束恢复按钮，成功显示后端片段，400/409/422 显示 HTML 错误。超时或网络错误明确显示未确认，并仅重新读取业务列表，不自动重发 POST。后端相同 ID 的幂等语义及 Agent 的原 Action/Job 恢复规则保留。表单输入与待恢复提交不写浏览器存储，换页不恢复。服务器模板自动转义用户数据。
### 5. 每个请求生成正确浏览器地址

新栈使用窄 URL helper/模板 context，从请求中取得平台已校验的 X-Forwarded-Prefix 和存储 scope；前缀为空时支持内部及独立 CLI 根入口。URL 生成覆盖 href、form action、hx-*、静态资源、下载、Location 和需要时的 HX-Redirect/HX-Location。不能只给静态文件加前缀，或固定 Uvicorn root_path 为某个 Work ID。禁止重复加前缀，深层导航与尾斜杠重定向均纳入测试。

不改平台代理为通用 HTML 重写器；浏览器不取得 Agent interaction token。应用仍处于平台明确的同源信任模型，反馈回执按会话和 Service 分名仅防止正常冲突，表单输入不持久化，不宣称隔离恶意同源脚本。

### 6. 数据轮询与代码采用分别处理

FastAPI 自己的页面客户端使用 htmx 生命周期和原生 JS；不加载 NiceGUI socket 拦截。复用现有的版本与反馈 HTTP 语义，版本检查为只读操作。

业务读取在模板中采用短周期状态轮询，页面隐藏时暂停，恢复可见/连线后重新读取；具体周期属于该示例，可按实际应用调整。表单 HTTP 进行时依据 htmx 现有请求状态暂停业务列表刷新，防止重新渲染提前启用列表里的提交按钮，请求结束后恢复。完整编辑表单在稳定区域内，轮询只替换业务展示区。每个展示区域只保留一个有效读取序列，应用 mutation 后废弃其旧请求序列；服务器返回 stateVersion，客户端拒绝比已显示状态旧的片段。该示例的 stateVersion 是数据库中的单调十进制序列，以字符串传输并按 BigInt 比较，不转为可能丢精度的普通 Number；不把这一比较规则施加给其他 Service 的不透明版本标识。

Query 失败保留当前页面最近内容及尚未提交的编辑输入，并显示陈旧提示；下一次成功即清理提示，包括业务版本没有变化的恢复。表单发送后清空输入，不在失败或导航时恢复；保留反馈回执 ID 的已有独立用途，不把它当作输入存储。

版本检测只在表单 HTTP 请求进行时暂缓整页采用，请求结束后继续。仅 codeVersion 改变时查询业务；frontendVersion 改变时重载原路径，表单初始化为空。连续相同版本、失败候选或临时不可达不重复 reload。不保存客户端未决提交，不调用自动提交恢复流程，避免新版本与 pending 互相等待。各应用独立更新，不刷新工作台外壳。

### 7. brain 通过现有入口提供能力

新增 `references/fastapi-htmx-base.json` 和 `application-awareness/references/fastapi-htmx.md`。部署 Skill 简短说明默认 NiceGUI、用户选择 FastAPI 时的固定环境和模板入口；相关细节按需读取，不全文放入 brain.md，也不新增平级选型 Skill。模板 README/Spec 描述实际文件坐标、启动/检查、单 worker、错误反馈与页面更新。

更新包版本并扩展 embed 内容和更新测试；现有 catalog/source 验证、管理员定制保护、旧 Work Apply 边界继续复用。初始化和检查说明均使用当前冻结包的真实路径。镜像引用包含 stack、环境契约、平台和发布状态，匹配后才部署，用户无需通过额外技术栈 UI 选择。

### 8. 所有者、消费者与生成物同步

| Owner / 来源 | 输入与输出 | 直接消费者及必要同步 |
| --- | --- | --- |
| `deploy/images/{fastapi-htmx-base,web-common}` | 精确环境、vendor、通用依赖工具 -> 固定镜像及身份 | 两种 Dockerfile、锁定/构建脚本、候选检查和双语 README |
| `templates/common-workstation` | 共享业务/协议/契约测试 -> 应用副本 | 三种模板 initializer、原直接复制夹具、框架无关测试 |
| `templates/fastapi-htmx` | 页面/路由/Spec -> 自足应用副本 | Service runner、页面与 API 验收、应用维护 |
| brain Skills/Reference/package.json | 认知与可查环境 -> 冻结包 | coreassets embed、包更新测试、真实 SDK driver；重建 Core/CLI，生成归属仍在原构建链 |
| Service 应用 | UI/Agent 输入 -> SQLite、Action/Job/Event | 原反馈、Memory、Evidence 与 Work 分享流程，不新增平台协议生成物 |
| `scripts/` 与 coreapp 集成夹具 | 实际候选 -> 验证结果 | 现有集成计划、资源声明、prepared 输入检查与发布前检查；输出归 dist |

仅应用镜像和脑包能力变化，Core 的安装参数、网络入口、存储默认及安装镜像角色没有改变。对部署手册、Compose、single-host 和官网生成源执行相关一致性检查；无变化不做机械改写。根 README 只更新双语有效导航。新增使用说明位于镜像维护目录，产品 Skill/Reference/模板 README 属于功能交付。

### 9. 验收按真实路径组织

- 单元/契约：公共依赖安装器、输入枚举及 hash、版本副本、模板解析、测试发现、前缀 URL、表单错误、重复/冲突 Action、共享业务和两栈装配；模块直接导入，避免通过源码正则抽函数测试。
- 镜像：离线首次启动、非 root/只读根、sqlite3、普通 FastAPI、自定义启动/FROM、缺包失败、额外依赖显式安装/离线重建、停止重启数据保留；每份结果绑定实际 image ID/input hash。
- 浏览器：真实前缀入口的深层访问、导航、片段、表单错误/上传环境检查、Agent 数据变化、乱序读取、断线恢复、当前页面编辑区/焦点、简单提交及版本采用与两个 Service 独立；拦截外部资源以证明不依赖 CDN。pytest/httpx 不替代这些浏览器行为。
- SDK/平台：扩展现有工作站验收以选择 FastAPI starter 和匹配候选，复用反馈改进、异步导出、Memory、候选 Apply/实际行为、失败恢复和两份独立导入回路。保持 NiceGUI 默认回归；共享夹具按栈提供页面操作，不复制整个平台测试套件。
- 可修改性：SDK 实际完成一次只改页面/片段/CSS 的回合和一次独立业务规则修改；核对 Spec 坐标、测试、运行/页面版本及 UI/Agent 结果。确定性 driver 证明工具集成路径，不承诺任意模型的选型或修复成功率。

新用例接入 `scripts/run-core-integration.mjs` 的现有计划、资源与输入身份检查。针对目标用例运行的结果保留 partial 标记，不冒充全套平台验收。隔离 installation ID/标签、临时 data 与精确资源清理沿既有夹具执行。

## Risks / Trade-offs

- [两套镜像共享工具导致 NiceGUI 回归] -> 只抽依赖准备等明确通用部分，保留旧 runner 与算法语义；两栈的镜像/初始化/默认入口分别验证，既有发布身份不变。
- [版本副本增加 workspace 空间] -> 只复制有效应用源，不复制标准依赖；保留有恢复价值且仍被使用的版本，安全回收其他可再生材料。报告实际体积，不以速度或体积优势作为通过条件。
- [检查结果与模板实际内容漂移] -> 对运行副本检查与启动，模板/静态资源只能读取该副本；测试编辑工作副本不会影响旧进程。
- [单 worker 限制 CPU 并行能力] -> 与当前示例 Job 所有权一致；高并发/分布式后台任务另按实际应用需求设计，不默认增加协调系统。
- [轮询和局部替换干扰表单] -> 稳定编辑区域、单区域读取序列和版本拒旧；以乱序、失败恢复及发送后清空/导航不恢复测试证明。
- [Bootstrap CSS 被误认为提供交互插件] -> Demo 使用原生表单/导航与 htmx；必要小交互明确实现，不依赖未交付的 data-bs 自动行为。
- [新能力写入脑包但镜像尚不可取得] -> 未发布引用保持不可用状态，本地验证显式使用候选；正式发布验证前不宣称公开可用。

## Migration Plan

1. 实现新环境、公共依赖工具、starter 装配、运行版本机制及 brain 指导；固定未发布候选状态，完成本地验收。
2. 保留现有 NiceGUI 固定引用与老 Work。重建宿主使新版脑包可供新建 Work 捕获，管理员修改继续受保护；已有 Work 通过原 Update/显式 Apply 采用。
3. 如后续收到单独镜像发布指令，先核对精确候选的检查结果，推送新镜像并匿名按 digest 拉取/运行，再更新正式 brain 引用、包版本和双语发布记录。该步骤是后续发布条件，不属于本轮规划或普通 apply 的自动动作。
4. 失败时保留原正式引用和有效包；应用恢复使用上一有效代码/配置与匹配依赖，业务事务不自动回滚。未发布候选不能伪装成可用镜像，已发布身份不回写。

## Open Questions

- Python 3.13 上游补丁版本、各 Python 包及 htmx/Bootstrap 5 的精确版本和 SHA256，由实施时锁定与兼容检查确定；不改变技术组成、离线交付或任务边界。
- 真实机器上的镜像体积、版本副本占用和冷/热启动耗时需执行后记录；本变更不设置相对 NiceGUI 的提速指标。

本设计是规划，不代表上述实现或验收已完成。
