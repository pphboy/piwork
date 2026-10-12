# Piwork NiceGUI base

[English](README.md) | **简体中文**

供应用 Service 复用的 Python 3.13 + NiceGUI + SQLite 基础环境。Agent 编辑 Work 共享 workspace，Core 在独立 Service 中运行应用。标准 Python 包与浏览器资源已安装在镜像中，应用无需 npm 安装、独立前端构建或复制完整标准环境。

## 可用状态与身份

当前源码使用环境契约 **2**、**0.2.0** 版本系列，Python **3.13.16**、NiceGUI **3.18.0**、pip **26.2.1** 与 sqlite3 CLI **3.40.1-2+deb12u2**，首先验证 Linux amd64。精确标准依赖见 [requirements.lock](requirements.lock)，上游 Python 固定镜像见 [environment.json](environment.json)；镜像只读环境清单还记录实际安装包和构建输入 hash。

<!-- web-base-reference:start -->
**已发布并通过匿名验证。** `docker.io/pphboy/piwork-web-base:0.2.0-5818e1de7bb5-6b6f6f8bbf62-dirty@sha256:c85c9928549f5b6a58dd519bbf1840fe83e52b9da22eaae556f7aca64b448098` 是固定的 Linux amd64、contract-2 base。[release.json](release.json) 保留真实构建 commit/dirty、输入 hash、image ID 和 registry digest；脑包使用该已验证引用。`dist/web-base/candidate.json` 保留本地构建身份。旧 FastAPI/React 制品继续保存在[历史发布记录](releases/fastapi-react-0.1.0.json)。
<!-- web-base-reference:end -->

## 在 Work 中使用

新 Pi-managed 应用在授权的 **Agent bash** 中调用 `node <loaded-skill-directory>/initialize.mjs --template web-app --name <service-name>`；`workstation` 选择反馈/异步导出例子。初始化入口在任何写入前拒绝所有已有目标，先创建 SPEC.md，再复制可编辑应用到 `apps/<service-name>`。既有应用读取实际内容并局部修改，不重复初始化。

Service 使用实际已验证镜像引用、显式 workspace 读写 grant、命令 `/usr/local/bin/piwork-web`、参数 `["run", "--app", "/var/data/workspace/apps/<service-name>"]`、名为 web 的 TCP 8080 端口与 HTTP `/health` 就绪检查。源码、检查和临时文件在应用目录，业务数据在 `data/<service-name>`。Core 注入 `/etc/piwork/interaction` 的身份/CA，不能把它们写进浏览器 JavaScript 或源码。

同一 base 也支持普通 NiceGUI 脚本用自己的 `python app.py` 命令启动，或通过 `FROM` 派生；镜像不包含 Todo/复盘业务，普通脚本不需要 Pi 身份。Pi-managed 模板接入既有 Service 协议。

## 命令与自动采用

以下命令在 **Service base 内**的应用目录运行：

```sh
piwork-web prepare
piwork-web check
piwork-web serve
piwork-web run
piwork-web dev
```

prepare 选择标准或已准备的扩展环境；check 运行 Python 源码/应用检查；run 准备环境、补做缺失或输入变化的检查后启动，相同输入重启复用有效检查；serve 拒绝失配检查；dev 显式启用 Python 重载。无需独立前端 build 命令。

Pi 修改后完成必要检查及原 Service 更新/重启，验证实际运行 codeVersion 与业务结果。模板自动采用就绪版本，恢复其支持的非秘密 Todo 标题草稿与路径，并重读共享业务状态；检查失败、短暂断线或相同版本不造成刷新循环。这些操作不 Apply 脑包/Work 配置。

`/api/runtime-version` 提供安全版本：codeVersion 绑定源码/配置、扩展锁与实际 base 环境；frontendVersion 绑定 Python 页面/资源、扩展锁与环境。改写可写 marker 不改变进程实际加载版本。

默认页面输入是存在的 `app.py`、`ui.py`、`page-client.js` 和 `style.css`。通过 `page-files.json` 添加应用相对路径的辅助模块和本地资源：

```json
{"files": ["pages/header.py", "assets/theme.css"]}
```

拆分页面、增加或移除资源时同步维护清单与应用 Spec。有效路径排序去重；声明文件内容或有效集合变化会改变 frontendVersion，仅独立业务修改保持页面版本稳定。无效或缺失文件、越界路径和符号链接使检查/启动明确失败。业务模块、数据、缓存和依赖环境不加入清单。没有清单的现有应用继续使用默认页面输入。

## 追加 Python 包

在应用 `requirements.in` 中声明精确的**额外**版本，例如 `package-name==1.2.3`，或应用目录内的本地 wheel 路径。明确准备时可从可达注册表取得兼容包：

```sh
piwork-web prepare --install-deps
```

由 Agent 开发时，Pi 写入声明，再经现有 Service 命令/Operation 运行 `run --install-deps`；Agent bash 本身没有 Python/pip，也不使用 Docker exec/build。成功准备后，同一输入不重复下载，即使 Service 定义仍保留该参数。

pip 将额外包装入可写、版本化的 `.deps/` 环境，并继承镜像标准包；保留 `requirements.lock`、校验过的 wheels 与有效环境记录。检查、应用和安装的命令使用同一解释器。安装器不升级固定 base 包；版本冲突、缺系统库、下载或完整性错误明确失败，保留原有效环境和数据。标准应用不创建完整 venv/node_modules；删除可再生环境或移动应用后，可在匹配 base 中从保留材料精确离线重建。

系统库或基础包版本变化通过派生镜像处理。下游 Dockerfile 可在构建时切换 root 安装固定依赖，随后回到 `USER 10001:10001`。使用版本适配器的应用需让派生环境清单绑定其实际构建输入，不能用未更新的 base 清单宣称新环境身份。

准备自己的 app.py 和完整 hash 锁文件 requirements.lock，使用 `docker build --build-arg NICEGUI_BASE=<verified-fixed-reference> -t my-nicegui-app:local .` 构建。本地开发可显式使用已验证本地候选，对外交付应使用已发布固定 digest。

```dockerfile
ARG NICEGUI_BASE
FROM ${NICEGUI_BASE}
USER 0:0
COPY requirements.lock /opt/my-app/requirements.lock
RUN python -m pip install --require-hashes -r /opt/my-app/requirements.lock
COPY app.py /opt/my-app/app.py
USER 10001:10001
CMD ["python", "/opt/my-app/app.py"]
```

## 持久化、身份与 sqlite3

运行身份为 **10001:10001**，根文件系统只读，HOME/TMPDIR/cache/可写依赖均使用获准 workspace。Stop/Start、Service 替换保留源码、锁和数据；完整 Work 导出导入保留额外安装材料，导入得到 stopped Work，由用户显式 Start。目标需具备原固定 base。既有 Work 包、应用和镜像不自动转换。

Agent 和 base 均提供实际 sqlite3 CLI；AI bash 在 Agent 执行，Service 有命令不代表 Agent 能调用。普通业务变更仍走命名 Query/Action 契约。

```sh
sqlite3 -readonly -json /var/data/workspace/data/<service-name>/workstation.sqlite 'SELECT name FROM sqlite_master WHERE type="table";'
```

应用 Service 不设 Piwork 内存上限或预留；弃用的 memoryBytes 仅为兼容历史，不是可用预算。CPU 与数量准入保持，详见[运维说明](../../../openspec/specs/core-service-startup/spec.md)。

## 维护、验证与发布

权威维护源是本仓库此目录；脑包模板/引用消费该环境，`dist/web-base/` 保存被忽略的本地产物，DockerHub 保存发布制品。开发镜像检查需要 Docker Engine/CLI 与仓库 Node 工具，用户宿主不新增 Python/Node/sqlite3 运行依赖。

```sh
node scripts/lock-web-base.mjs
make web-base-image
node scripts/test-web-base-tools.mjs
node scripts/check-web-base.mjs
node scripts/check-web-base.mjs dist/web-base/candidate.json web-app
node scripts/check-web-base-dependencies.mjs
node scripts/check-web-base-core.mjs
```

真实 Core/SDK/浏览器检查还使用兼容 acceptance Agent/helper 镜像与已构建 Go 程序，见[测试说明](../../../AGENTS.md#构建与验证)。测试按唯一 installation/fixture 标签创建并仅清理自身资源。分别测量准备/启动/重启、workspace/快照体积及完整分享，超时预算不作为性能结果。

本地构建/检查不推送。只有明确要求发行后才使用 `scripts/publish-web-base.mjs`，核对实际当前候选与证据、拒绝远端 tag 冲突，并在匿名 digest 拉取/运行通过后更新正式脑包引用；旧 commit/dirty/input/digest 身份保留。
