# Piwork Web base

[English](README.md) | **简体中文**

供多个 Work 复用的 FastAPI + React + TypeScript + Vite 开发基础镜像。Harness 在 Agent 容器中编辑共享 workspace；Core 以本镜像运行独立 Service。应用代码和数据属于 Work，镜像提供固定工具链、离线依赖与通用命令，也可通过 FROM 派生。

<!-- web-base-reference:start -->
已发布并完成匿名拉取验证：

```text
docker.io/pphboy/piwork-web-base:0.1.0-03395d0810f7-bbb24bdd0167-dirty@sha256:e83902fb568e97b2d01d488ce7c9c3d15f373ab58b46e041337baa832b8cfb81
```
<!-- web-base-reference:end -->

## 环境

首版支持 Linux amd64，使用 Python 3.13.16、Node 24.21.0、FastAPI 0.143.0、React 19.3.0、TypeScript 7.0.2、Vite 8.3.4。环境及完整锁文件以 [environment.json](environment.json)、[requirements.lock](requirements.lock) 和 [package-lock.json](frontend/package-lock.json) 为准。sqlite3 CLI 为 Debian 3.40.1-2+deb12u2；Agent 镜像也预装该命令，因为 AI 的 bash 实际在 Agent 内执行。

## 在 Work 中使用

从脑包 `templates/web-app/` 复制可写应用副本到 `apps/<service-name>`，先维护该应用 SPEC.md，再实现业务。`templates/workstation/` 是带反馈/异步导出的完整例子。镜像自身不包含 Todo 等业务。

Service 使用已发布固定 tag@digest、命令 `/usr/local/bin/piwork-web`、参数 `["run", "--app", "/var/data/workspace/apps/<service-name>"]`，显式授予 `/var/data/workspace` 读写挂载，声明 web TCP 8080 与 `/health` HTTP 就绪检查。启动前读取 deployment_context，选择可用 CPU 和服务数；普通就绪预算仍为 120 秒，允许显式选择既有 300 秒上限。

Core 注入 `/etc/piwork/interaction` 的身份/CA；标准模板在 Core 管理的 Service 内运行，不在独立 Docker 容器中伪造平台身份。前端只调用自己的同源后端，不能获得平台 token。

在 Agent 的授权 bash 中调用已加载部署 Skill 同目录的 `initialize.mjs`：`node <loaded-skill-directory>/initialize.mjs --template web-app --name <service-name>`。入口先创建必要 Spec 再复制其余模板，写入前拒绝所有已有应用目标；业务实现前读取并调整该 Spec。已有应用通过局部修改维护，重复初始化不能替换源码、锁文件、注册信息或数据。

## 命令与自动生效

在应用目录运行：

```sh
piwork-web prepare
piwork-web check
piwork-web build
piwork-web serve
piwork-web run
piwork-web dev
```

prepare 离线准备可写 `.venv` 和 node_modules；失败保留原有效依赖。check 执行隔离的 Python/前端测试与类型检查，记录 `.build/checks.json`；build 发布匹配源码的前端产物；serve 拒绝源码与检查产物不匹配；run 串联这些步骤。dev 显式提供 React Fast Refresh、后端重载和同一 8080 入口。

AI 修改后自动执行必要检查/构建及 Service 更新或重启，并验证实际 codeVersion 和业务结果。默认页面每五秒及恢复可见/连接时检查安全版本，自动采用已就绪前端、定期重读业务查询，使 Agent Action 的数据变化也直接显示而无需重启，并恢复支持的非秘密草稿与路径。不要求用户刷新；失败/相同版本/断线不会循环重载。脑包/Work 配置仍需原显式 Apply。

代码及前端版本同时绑定对应源码/锁文件和实际镜像环境身份。仅基础环境改变并重新构建/部署时，已打开页面也自动采用新版；仅后端修改则保持前端版本。

## 文件、数据与 sqlite3

源码、锁文件、可写依赖、缓存、检查与构建结果位于 `apps/<service-name>`；业务数据位于 `data/<service-name>`。HOME/TMPDIR/缓存指向 workspace 子目录，适配 UID/GID 10001:10001 和只读根文件系统。普通启动不初始化或覆盖现有业务。

```sh
sqlite3 -readonly -json /var/data/workspace/data/<service-name>/app.sqlite 'SELECT name FROM sqlite_master WHERE type="table";'
```

数据库文件名由实际应用决定；工作站例子使用 workstation.sqlite。AI 通过现有授权 bash 使用 Agent 的命令做数据开发/诊断；普通业务变更保持 Query/Action/expectedStateVersion 契约，不直接改写 Core/history/Memory 受管状态。

## 维护与依赖扩展

| 位置 | 用途 |
| --- | --- |
| deploy/images/web-base/ | 长期维护源、Dockerfile、锁文件、工具、环境清单和双语手册 |
| scripts/ 与 Makefile | 构建、验证、发布入口 |
| internal/coreassets/piwork-brain/ | 指导、模板与固定镜像引用 |
| dist/web-base/ | 被忽略的本地候选和验证产物 |
| DockerHub pphboy/piwork-web-base | 发布版本与 registry digest |

更新 requirements.in、frontend/package.json 和 environment.json 后，使用固定容器工具链更新锁文件，再构建验证。开发机需要仓库基础构建工具及 Docker Engine/CLI；用户宿主运行不新增 Node/Python/sqlite3 依赖。

```sh
node scripts/lock-web-base.mjs
make web-base-image
node scripts/check-web-base.mjs
node scripts/check-web-base-core.mjs
```

标准依赖保证离线；新增依赖不在 wheel/cache 中时明确失败。为应用保留精确锁定的依赖，或派生新镜像；运行中的 Pi 不取得 Docker build/socket 权限。下游可以使用固定引用扩展：

```dockerfile
FROM pphboy/piwork-web-base:0.1.0-03395d0810f7-bbb24bdd0167-dirty@sha256:e83902fb568e97b2d01d488ce7c9c3d15f373ab58b46e041337baa832b8cfb81
USER 0:0
# 在构建阶段安装锁定专用依赖并复制自己的应用。
USER 10001:10001
CMD ["python", "/opt/my-app/main.py"]
```

## 内存、升级与发布

应用 Service 不设置 Piwork 内存上限或内存预留。弃用的 memoryBytes 省略/零为无限制，合法旧正数仅保留历史。memoryLimitMode/serviceMemoryPolicy 明确为 unlimited，零不是零字节额度。CPU、服务/卷数量及 Agent/helper 内存政策仍有效，实际内存由宿主/外层环境决定，详见[运维说明](../../../docs/operations.md#service-资源与版本升级)。

本机构建默认不推送；发布入口校验实际候选、离线及真实 SDK/CLI/浏览器证据，拒绝覆盖不同内容的固定 tag。明确授权后推送并匿名拉取同一 digest 验证：

```sh
node scripts/publish-web-base.mjs
node scripts/publish-web-base.mjs --push
```

然后更新脑包固定引用并构建兼容 Core/Agent。既有安装通过现有包管理更新默认 catalog 后，新 Work 才捕获新版脑包。既有 Work 不静默换包或镜像，采用新版仍走选择、Package Update 与显式 Apply。五角色发行另按[现有发行流程](../../../docs/docker-release.md)执行，不用基础镜像发布器替代其完整预检。
