# Piwork FastAPI + htmx base

[English](README.md)

Linux amd64 应用 Service 环境：Python 3.13、FastAPI + Uvicorn、Jinja2、htmx、Bootstrap 5 CSS、python-multipart、pytest/httpx、pip，以及 SQLite 和 sqlite3 CLI。业务示例由 brain 模板提供，镜像不含业务应用。Agent 编辑共享 workspace，Python 在 Service 执行。默认 starter 仍为 NiceGUI。

## 环境与身份

精确 Python 依赖见 [requirements.lock](requirements.lock)，上游镜像见 [environment.json](environment.json)，本地 htmx/CSS 的版本、来源、SHA256 和许可见[资源清单](vendor/manifest.json)。无需 CDN、独立 npm 前端构建、ORM 或迁移体系。运行身份为 UID/GID 10001:10001，支持只读根和获准可写 workspace。

**已发布并通过匿名验证。** 使用下列固定 Linux amd64 引用。[release.json](release.json) 保留真实源码 commit、dirty、输入 hash、image ID、registry digest 和匿名运行结果；brain 使用相同固定引用。dist/fastapi-htmx-base/candidate.json 保留本地构建身份，原 NiceGUI 和 FastAPI/React 记录保持原事实。

```text
docker.io/pphboy/piwork-fastapi-htmx-base:0.1.1-08fc54adda53-291497dc377a-dirty@sha256:2314f5a787a1be0e575c892899e32cb779cacd163d02a137c777e3a0358a1aad
```

## 直接使用与 starter

普通应用可使用自己的 python app.py 或 Uvicorn 启动命令，无需 Piwork 身份；监听 0.0.0.0 和声明的 Service 端口。派生环境使用 ARG FASTAPI_BASE 与 FROM ${FASTAPI_BASE}，通过构建参数传入已验证固定引用，并在构建时安装精确专用依赖。

Pi-managed 应用使用 brain [starter](../../../internal/coreassets/piwork-brain/templates/fastapi-htmx/README.md) 和拒绝覆盖的初始化入口。Service command 为 /usr/local/bin/piwork-fastapi，args 为 ["run", "--app", "/var/data/workspace/apps/<service-name>"]。它准备依赖、检查版本副本并运行该副本。prepare/check/serve 同样可用；serve 要求已有通过的检查。标准依赖直接继承，不复制到 workspace。

## 编辑与持久化

源码和锁文件位于 apps/<service-name>，业务数据位于 data/<service-name>。.build/releases 保存检查后的应用副本，.build/checks.json 指向可复用的有效副本（包括损坏后生成的替代副本），编辑工作副本不改变运行内容。修改后完成 Service 更新/重启，并查询 /api/runtime-version 和实际业务结果。修复版 starter 每次表单只发一次请求，参数捕获后清空输入，不在浏览器保存/恢复提交、不自动重发 POST。失败/超时显示错误或未确认状态，并只重新读取后端列表。导航及页面版本采用后表单为空；当前页面内的正常业务刷新保留无关编辑输入。示例 Job 归单进程所有，使用单个 Uvicorn worker。

托管 URL 使用已校验请求的 /services/<workId>/<serviceId>/<port> 前缀；内部探针及 Agent 仍使用 /health、/pi/v1。UI 与 Agent 共用业务状态，token 保留在后端。Bootstrap CSS 提供外观，交互由原生 HTML、htmx 和少量原生 JS 完成。

额外精确依赖写入 requirements.in，通过 Service 的 run --install-deps 显式获取兼容包。锁文件、wheels 和 .deps 留在应用中，后续启动离线复用或重建；冲突不能替换标准包。系统库需要派生镜像。该 Service 中有 sqlite3；Agent bash 的独立 CLI 不表示 Agent 拥有 Service Python/pip。

Stop/Start、Service 替换与完整 Work 导出导入保留源码、额外依赖材料和数据。导入保持 stopped，由用户显式 Start，目标安装须有固定镜像。代码/配置恢复使用匹配依赖记录，不宣称撤销已提交业务事务。

## 维护与验证

权威源为本目录与 ../web-common 的共享依赖准备器；brain 模板/引用为消费者。开发构建需要仓库 Node/Docker 工具，用户宿主不新增 Python/Node 运行依赖。

```sh
node scripts/lock-fastapi-htmx-base.mjs
make fastapi-htmx-base-image
node --test scripts/build-fastapi-htmx-base.test.mjs
node scripts/check-fastapi-htmx-base.mjs
```

命令从仓库根执行。本地检查不推送。只有明确获准发布后才使用 node scripts/publish-fastapi-htmx-base.mjs --sdk-report <matching-SDK-result.json> --push；省略 --push 只执行预检。发布入口拒绝固定 tag 内容冲突、核对精确候选证据，并在记录发布前验证匿名 digest 拉取/运行。验证须匹配实际候选 image ID/input hash。SDK 反馈/导入的跨组件验证沿既有 Core 集成运行器执行，目标子集保留 partial 标记。

[原 0.1.0 发布记录](releases/0.1.0-08fc54adda53-44102ae552dd-dirty.json) 保留原身份和验证事实。
