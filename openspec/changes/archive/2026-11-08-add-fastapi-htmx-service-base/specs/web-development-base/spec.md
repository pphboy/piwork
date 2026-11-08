# Spec Delta

## ADDED Requirements

### Requirement: 提供可选的 FastAPI 与 htmx Service 基础环境

**Identifier:** WEBBASE-010

项目 SHALL 提供独立、固定身份的 Linux amd64 FastAPI + htmx 基础镜像，与 WEBBASE-001 的 NiceGUI 环境并存。公开环境 SHALL 包含 Python、FastAPI、Uvicorn、Jinja2、python-multipart、pip、pytest、httpx、Python sqlite3 和可直接执行的 sqlite3 CLI，以及固定版本、本地交付的 htmx 和 Bootstrap 5 CSS。这些组成属于下游可依赖的环境能力；标准应用 SHALL 无需安装标准包、访问 CDN 或执行独立 npm 前端构建即可检查和运行。

镜像 SHALL 支持普通 FastAPI 应用显式使用自己的启动命令及通过 FROM 派生，不要求普通应用持有 Piwork 身份或包含示例业务。官方 starter SHALL 使用 SQLite 直接 SQL，不预置 ORM、数据库迁移体系或 Bootstrap JavaScript；必要的浏览器交互由 htmx、原生 HTML 和少量原生 JavaScript 完成。

#### Scenario: 标准应用在离线基础环境运行
- **WHEN** 固定镜像已在本机可用，干净 workspace 的标准 starter 在包注册表和 CDN 不可达时启动
- **THEN** 必要检查、HTML 页面、表单交互和基础样式可用，没有标准依赖下载、node_modules 或独立前端构建

#### Scenario: 通用 FastAPI 应用复用镜像
- **WHEN** 维护者在该镜像中用自己的启动命令运行仅依赖标准环境的普通 FastAPI 应用，或通过 FROM 添加专用依赖
- **THEN** 应用可以运行，不因缺少 Piwork 身份或工作站示例被基础环境拒绝

#### Scenario: 新旧环境同时使用
- **WHEN** 两个 Work 分别选择固定 NiceGUI 环境与固定 FastAPI 环境
- **THEN** 两者使用各自匹配的模板和身份，业务状态独立，原 NiceGUI 默认和已发布引用保持有效

### Requirement: FastAPI 应用只交付与检查结果一致的运行版本

**Identifier:** WEBBASE-011

官方 FastAPI starter 的标准启动 SHALL 将必要 Python、模板及应用测试检查与运行绑定。检查失败、源码在准备期间变化、依赖不匹配或资源缺失 SHALL 明确失败，不报告新版 ready。未改变的有效输入 SHALL 复用已通过结果；应用声明的测试目录 SHALL 实际参与检查，不允许因目录约定不匹配静默跳过测试。

codeVersion SHALL 绑定被检查和实际运行的应用源码、配置、锁定依赖与基础环境；frontendVersion SHALL 绑定完整页面、局部片段、页面辅助代码及浏览器资源。新增、修改或移除有效页面输入 SHALL 改变页面身份；独立业务实现变化 SHALL 保持页面身份。运行版本 SHALL 反映实际服务的内容，不将编辑中的工作副本、可写版本标记或新旧混合模板冒充已交付版本。

默认运行过程中，尚未完成检查和部署的源文件编辑 SHALL 不进入当前页面或业务执行。模板继承、include、延迟加载和静态文件读取均 SHALL 遵守同一版本边界。实现 SHALL 保留可查的先前有效代码/配置依据，代码恢复不回滚已提交业务数据。

#### Scenario: 编辑尚未部署的模板或静态资源
- **WHEN** 原版本正在运行，AI 编辑工作副本中的页面、片段或 CSS，尚未完成新版本检查和部署
- **THEN** 当前请求仍服务原有效版本，版本接口不宣称新内容已采用；新内容只在检查和部署成功后生效

#### Scenario: 不同种类的改动具有正确身份
- **WHEN** 依次执行纯业务修改、页面片段修改、浏览器资源修改以及页面输入集合变化
- **THEN** 每次 codeVersion 按实际输入变化，纯业务修改保持 frontendVersion，其余页面输入变化改变 frontendVersion；相同输入重复计算稳定

#### Scenario: 失败检查不能交付新版本
- **WHEN** Python 语法、Jinja2 模板或实际应用测试失败，或者检查过程中输入变化
- **THEN** 启动或更新明确失败，保留失败结果与业务数据，不以旧检查、空健康响应或磁盘 marker 宣称新版 ready

### Requirement: FastAPI 页面和业务协议适配同一受管入口

**Identifier:** WEBBASE-012

官方 FastAPI starter SHALL 在同一声明端口提供页面、片段、静态资源、业务请求、现有 /pi/v1 和 /health；标准监听地址为 0.0.0.0:8080。浏览器的页面导航、深层刷新、表单及上传、htmx 请求、下载、版本检查和响应中的导航目标 SHALL 保留当前请求已校验的 /services/<workId>/<serviceId>/<port> 前缀。合法内部 Agent/探针请求与独立 CLI 根入口 SHALL 继续使用根路径，不将 Work/Service ID 或宿主地址写成永久配置。

UI 和 Agent SHALL 调用同一业务逻辑及权威状态。页面/表单入口返回可展示的 HTML，协议入口保留既有 JSON 契约。后端 mutation SHALL 沿用稳定 Action 身份及预期状态版本；同 ID 重复请求仍返回原结果。Agent 的未知副作用继续沿原标识核对。

官方浏览器表单 SHALL 采用一次请求一次处理：请求参数取得后清空本次输入，请求进行时暂时禁用业务提交按钮并丢弃重复触发，请求结束后解除禁用。前端 SHALL NOT 持久化表单输入或待恢复的提交，不自动重发写请求，也不在换页后恢复旧提交。成功显示后端结果，校验失败或冲突显示错误；网络错误或超时显示结果未确认并只重新读取后端列表，不将没收到回复等同于后端未写入。用户重新填写并提交属于新的操作。

普通 HTML 页面与局部片段 SHALL 不混用，页面直接打开或刷新取得完整页面，未知协议/API 路径保留错误。
#### Scenario: 动态前缀下完成页面交互
- **WHEN** 用户通过托管 Service 的深层页面打开、刷新、提交表单或上传、获取片段并下载文件
- **THEN** 全部浏览器请求和导航留在该 Service 前缀，资源本地可用，同时内部 /health 和 /pi/v1 可访问同一服务

#### Scenario: UI 与 Agent 并发修改
- **WHEN** 用户或 Agent 已改变业务状态，另一操作携旧状态版本提交
- **THEN** 操作得到可查冲突而非覆盖后续修改，页面显示冲突并重新读取当前状态，不恢复已经发送的输入

#### Scenario: 提交结果未知或重复提交
- **WHEN** 一个业务提交的响应丢失，或同一操作重复到达
- **THEN** 后端对相同 Action 身份保持幂等；浏览器不自动重发，显示未确认并读取后端列表，换页后表单为空，不恢复旧提交

#### Scenario: 表单错误和直接页面访问
- **WHEN** 表单校验失败或业务冲突，随后用户直接打开或刷新对应页面
- **THEN** 原操作显示可理解错误且不恢复已发送输入，直接访问返回完整页面和空表单，不显示孤立 HTML 片段或未经处理的协议 JSON

### Requirement: FastAPI 页面自动同步业务并采用成功部署的代码

**Identifier:** WEBBASE-013

官方 FastAPI starter SHALL 满足 BRN-012 的业务数据同步及失败恢复要求：用户或 Agent 的业务变化自动出现在相关页面，当前页面内的正常业务刷新保护无关未提交输入和焦点；查询失败保留最近确认内容并表达陈旧状态，恢复后重新读取权威结果。并发或乱序读取 SHALL 不用旧状态覆盖新显示，已处理的提交 SHALL 不因后到轮询响应复原为旧内容。

应用 SHALL 自动采用已成功部署的新代码/页面版本，仅独立业务实现变化时更新相关查询，页面实现变化需要重载时自动执行。采用新版页面只暂时等待当前表单 HTTP 请求结束，不等待跨页面的未决提交记录。页面导航或代码版本重载后表单重新初始化，不保存/恢复旧输入；短暂断线、失败候选及相同版本不制造重载循环。业务刷新和版本检测 SHALL 不创建新的 Agent Run、不修改脑包选择，也不刷新 Desktop 外壳或其他应用。该浏览器简单表单边界是本变更明确选择，不改变 NiceGUI 的既有草稿规则。
#### Scenario: Agent 修改数据而用户正在编辑
- **WHEN** 用户在页面保留未提交文本和焦点，Agent 成功执行对应业务 Action
- **THEN** 页面自动显示新的业务结果，未提交文本和当前操作保留，不要求重启或手动刷新

#### Scenario: 查询失败后恢复
- **WHEN** 业务读取失败后重新可用，包括恢复时业务版本未变化的情况
- **THEN** 失败期间保留最近内容与输入并提示可能陈旧，恢复后清除错误并显示当前权威结果

#### Scenario: 较旧读取晚于新结果返回
- **WHEN** 轮询请求在用户提交之前开始，但在新业务结果已显示后才返回旧版本
- **THEN** 页面保留新结果，不倒退显示、不恢复已经发送并清空的输入

#### Scenario: 页面保持打开时发布新代码
- **WHEN** AI 成功部署页面变更或纯业务变更，页面保持打开
- **THEN** 运行版本和相应效果可核对，页面按实际版本变化自动采用或刷新查询，保留当前路径但不恢复旧表单输入；请求结束后不会因待确认记录卡住，断线及失败更新不制造重载循环

### Requirement: FastAPI 环境保持现有持久化与依赖扩展语义

**Identifier:** WEBBASE-014

FastAPI 基础镜像及官方 starter SHALL 按 UID/GID 10001:10001、只读根文件系统和获准 workspace 工作。源码、额外依赖声明/锁文件、离线材料和可再生检查/运行材料 SHALL 保存在应用目录，业务数据 SHALL 位于 data/<service-name>。Service 启停和替换 SHALL 不覆盖应用或清空数据；初始化 SHALL 满足 WEBBASE-004 的目标排他与拒绝覆盖行为。

额外 Python 依赖 SHALL 沿用 WEBBASE-008 的显式安装、固定标准包、应用独立环境、离线材料保留和失败保护行为；Agent bash 与 Service Python/pip 的执行位置 SHALL 正确区分。完整 Work 导入 SHALL 保持 stopped，显式 Start 后按目标 Work 身份运行并保留代码、依赖和业务数据，不重放源 Work 的历史事件或 Job。运行材料因位置或身份变化需要重建时 SHALL 可从保留输入恢复，不要求重新联网解析版本。

#### Scenario: 只读环境运行与重启
- **WHEN** 官方 starter 在只读根和可写 workspace 中运行、Stop/Start 或替换 Service
- **THEN** 检查、缓存、数据库和上传临时写入使用获准位置，代码、额外依赖及业务数据保持

#### Scenario: 重复初始化拒绝覆盖
- **WHEN** 初始化目标已经存在，包括空目录、普通文件、链接或被并发初始化占用
- **THEN** 在覆盖 Spec、源码或注册信息之前拒绝，原应用保持，不继续 Service 创建/更新

#### Scenario: 扩展依赖离线复用与失败保护
- **WHEN** 兼容额外包经显式安装后重启或导入，或者新增依赖准备失败
- **THEN** 成功安装的包按锁定材料复用或离线重建；失败不替换原有效环境，不清除业务数据

### Requirement: FastAPI 基础环境具有独立可追溯的交付身份

**Identifier:** WEBBASE-015

FastAPI 镜像 SHALL 有独立维护源、环境契约、双语使用说明和构建/验证入口。固定身份 SHALL 绑定真实源码 commit、dirty 状态、全部镜像输入（包括浏览器资源及通用运行工具）、精确依赖、平台和实际镜像内容。文档 SHALL 说明与 Agent/Service 的关系、直接运行、派生、初始化、检查、依赖扩展、自动生效、持久化及已测平台。

本地候选与远端已发布制品 SHALL 明确区分。仅在收到明确发布指令并通过对应候选验证、推送及匿名 digest 拉取/运行后，才能将正式 brain 引用标记为可用；此前可提供模板和指导，但未发布身份 SHALL 阻止普通部署并说明限制，显式本地验收可选择已验证且实际存在的候选。历史 NiceGUI 和 FastAPI/React 身份 SHALL 不被覆盖。Service 镜像的发布 SHALL 不自动扩展为 Core、MicroVM 或官网发行。

#### Scenario: 浏览器资源改变产生新身份
- **WHEN** htmx、Bootstrap CSS、运行工具或锁文件的构建输入改变
- **THEN** 新候选具有对应新输入身份，旧候选验证不能冒充本次通过，所有记录保留真实制品信息

#### Scenario: 本地完成但没有发布指令
- **WHEN** 候选及本地验收完成，尚未获准对外发布
- **THEN** 保留可审阅候选，不推送、不标记远端可用；普通部署如实提示镜像尚不可用，显式本地验收仍可使用匹配候选

#### Scenario: 发布验证完成后采用固定引用
- **WHEN** 获准发布的精确候选完成推送及匿名 digest 拉取/运行验证
- **THEN** 发布记录、双语说明与正式 brain 引用指向同一可取得制品，既有 Work 和旧引用保持原身份
