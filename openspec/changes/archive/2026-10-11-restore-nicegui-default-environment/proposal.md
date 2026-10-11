# Proposal

## Why

当前默认 FastAPI + React + TypeScript + Vite 环境需要准备两套应用依赖、执行前端检查与构建，并在工作站分享验收中重复搬运应用依赖，用户反馈验收周期过长。将新应用的默认环境恢复为 NiceGUI，提供预装标准依赖且支持追加 Python 包的可复用 base image，缩短环境准备与交付路径。

## What Changes

- **BREAKING**：默认应用 Service 的环境契约由 FastAPI + React + TypeScript + Vite 改为 Python 3.13 + NiceGUI + SQLite；同步脑包指导、通用应用模板、工作站示例及确定性验收 driver。既有固定镜像版本、Work 副本和业务源码不自动转换。
- 继续以 `deploy/images/web-base/` 和 `docker.io/pphboy/piwork-web-base` 维护默认基础镜像，使用新的环境契约/版本，预装 NiceGUI、pip、sqlite3 CLI 与标准测试依赖。标准应用直接复用镜像依赖，不要求 npm、React/Vite 构建或向每个 Work 复制完整基础环境；NiceGUI 自身的前端资源与传递依赖随其交付。
- 支持在该 base 内为应用安装额外 Python 依赖：写入获准 workspace 的应用独立环境，保留精确依赖身份和可离线重建的安装材料，安装失败不替换原有效环境。普通启动和重启复用已准备环境；需要新增包时允许显式联网安装，不要求运行中的 Pi 构建镜像。
- 保留单 Service HTTP/WebSocket 入口、真实业务/反馈/证据契约、应用更新后的页面自动采用、非 root/只读根文件系统以及已有不覆盖初始化、持久化和显式 Apply 边界。
- 将现有镜像检查、真实 SDK/MCP、浏览器、恢复和分享验收适配到 NiceGUI，并记录同条件下准备、启动、导出导入和完整验收的耗时与 workspace 体积；不通过删除业务验收或延长超时宣称提速。
- 同步当前使用文档和双语镜像说明。构建与本地验收先产生真实候选；对外推送、匿名拉取验证及正式默认 digest 更新仅在另有明确发布授权时执行，历史发布身份和验收事实保留。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `web-development-base`：将基础环境、启动/检查命令及页面版本机制改为 NiceGUI；增加可持久的额外 Python 依赖安装、基础依赖复用和开销测量要求，明确候选与发布边界。
- `piwork-brain`：将 BRN-008 的默认指导、模板与镜像选择恢复为 NiceGUI，保留框架自由、旧 Work 和正式包更新语义。
- `agent-service-deployment`：调整 ADEP-002 的默认部署及依赖安装指导，使用现有 Service 命令与 Operation 完成准备、检查和实际验证。
- `desktop-ui-language`：仅将 DUL-BRAIN-001 的默认工作站参考栈改为 NiceGUI，保持现有 Desktop 产品对象、交互和外壳职责。

## Impact

- 镜像与通用工具：`deploy/images/web-base/` 的 Dockerfile、环境清单、Python 锁文件、`tools/piwork_web.py`、`tools/piwork_web_runtime.py` 与双语 README；移除新默认 Service 环境的独立 Node/npm/frontend 构建资源。
- 脑包：`internal/coreassets/piwork-brain/` 的版本、部署 Skill/Reference、镜像身份、`templates/web-app/`、`templates/workstation/`，以及 `internal/coreassets/brain_test.go` 和内置包更新/采用测试。
- 验收与制品：`scripts/{lock,build,check,publish}-web-base*`、`scripts/build-workstation-fixture.mjs`、`scripts/native-host-acceptance.mjs`、`packages/pi-adapter/src/deterministic-workstation.ts`、现有工作站集成测试及必要历史迁移夹具。
- 文档：根目录双语 README、`docs/piwork-brain.md`、`docs/testing.md`、镜像使用说明及相关当前安装材料；新验收事实单独记录，不改写旧归档。
- 不改变公共 Core/MCP/proto 契约、Agent 的 TypeScript Pi SDK harness、Desktop/Console 自身的 React 构建、Service 配额或 Work 生命周期；不新增宿主 Python/Node 依赖或 Docker build/exec 权限。
