# Proposal

## Why

部分 Service 需要持续修改页面结构、HTML 片段和业务规则，AI 需要能够直接定位路由、业务、数据访问、模板、样式与测试的工程坐标。为 brain 补齐 FastAPI + htmx 的预备环境和可运行模板，可在保持 NiceGUI 默认体验的同时提供这一开发能力，让用户通过表达目标完成迭代，减少环境准备和人工交付步骤。

## What Changes

- 新增独立的 Linux amd64 FastAPI Service 基础镜像及仓库维护源，预装 Python、FastAPI、Uvicorn、Jinja2、python-multipart、pytest、httpx、pip 和 sqlite3 CLI；htmx 与 Bootstrap 5 CSS 固定版本并本地交付。
- 在现有 brain 中增加可选的 `fastapi-htmx` starter、固定环境身份及按需指导，接入已有安全初始化入口。默认仍为 NiceGUI；用户指定这套栈后可直接使用，不增加技术栈选择界面或开发审批步骤。
- 新 starter 使用 SQLite / Python sqlite3 直接 SQL，以清晰且必要的模块组织实现相同的待办、个人复盘、异步导出、反馈与恢复闭环。HTML 页面及片段直接编辑，浏览器逻辑采用 htmx 和少量原生 JavaScript，不预置 ORM、数据库迁移体系、Bootstrap JS 或独立 npm 前端构建。
- 适配现有 Service 的动态浏览器前缀、Agent 根路径、非 root/只读根、持久 workspace、额外 Python 依赖及单端口运行契约；提供检查后运行、实际加载版本、业务数据自动同步和页面版本自动采用。浏览器采用简单表单：发送后清空，不持久化输入或未决提交、不自动重发，导航不恢复旧表单。
- 使用同一业务契约验证两种 starter，补充 FastAPI/htmx 的真实 SDK、Docker、浏览器、故障恢复及独立导入验收，并完成一次页面修改和一次业务修改，核对工程坐标与实际交付效果。
- 提供双语镜像使用说明、候选身份与发布前检查。对外镜像发布和正式远端引用切换需后续明确发布指令；本变更的规划与本地实现不自动触发 Core、MicroVM 或官网发行。

## Capabilities

### New Capabilities

无。沿现有能力增加可选技术栈，避免创建重复的 Service 或部署契约。

### Modified Capabilities

- `web-development-base`：新增 FastAPI + htmx 基础环境、检查后生效、动态入口、状态同步、依赖持久化和制品交付要求；保留 NiceGUI 默认环境及其历史身份。
- `piwork-brain`：增加可发现、可初始化且有工程坐标的 FastAPI starter 与按需认知；保留默认选择、冻结包和显式 Apply 边界。
- `agent-service-deployment`：补充新栈从用户意图到部署、反馈和实际验证的路径，以及与现有示例相同业务闭环的验收要求。

## Impact

- 镜像与工具：新增 `deploy/images/fastapi-htmx-base/`，扩展 `scripts/` 和 `Makefile` 的锁定、构建及验证入口；已有 `deploy/images/web-base/` 中可复用工具按实际职责进行最小抽取。
- brain：`internal/coreassets/piwork-brain/` 的包版本、部署 Skill、应用认知 Reference、镜像身份和模板；`internal/coreassets/brain_test.go` 与脑包更新相关测试同步。
- 集成验证：复用 `internal/coreapp/brain_workstation_integration_test.go` 的真实 SDK/反馈/分享回路及 `scripts/check-web-base*.mjs` 的镜像和浏览器验证方式，按新栈补充适配，并登记到现有集成运行器。
- 状态与协议：业务状态继续归 Service；沿用 Query、Action、Job、Event、Evidence 及现有 Service 定义，不新增平台 HTTP/proto 契约、调度引擎或宿主语言依赖。
- 文档和发行：新增镜像目录的双语 README，维护原目录与根 README 的必要双语导航；应用镜像独立发行，既有 Work、固定镜像与默认 NiceGUI 应用不自动迁移。Core 容器安装命令、Compose 和宿主三项运行配置不因该可选 Service 环境改变。
