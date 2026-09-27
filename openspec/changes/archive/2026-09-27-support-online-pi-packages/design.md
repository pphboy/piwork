# Design

## Context

失败经过见 [proposal.md](proposal.md)。目前，`apps/core/src/packages/service.ts` 在接受请求时捕获不可变的准备镜像和可信 helper 镜像 ID。`apps/core/src/packages/prepare.ts` 在所选镜像中执行 prepare，在可信镜像中执行 init/capture。`apps/package-helper/src/main.ts` 获取 npm/Git 内容并安装生产依赖，不修改来源清单。`packages/pi-package/src/artifact.ts` 与 `artifact-sync.ts` 均拒绝 `dependencies` 中的 `typebox`。`apps/agentd/src/package-resources.ts` 在加载 Pi 资源前验证冻结树及 coding-agent SDK 的精确版本。新镜像包含 helper，但旧标签仍可能解析到尚未包含该文件的镜像。现有 Core 和 Work 包请求已经在准备镜像前检查幂等重放。

根锁文件和工作区直接依赖目前选择 Pi 0.86.0。已发布的 `pi-subagents@0.71.0` 压缩包将 `typebox` 声明为运行时依赖，并声明至少需要 0.86.1 的 Pi 宿主 peer 范围。其前台子代理使用进程内 Pi Session；后台执行器解析宿主 coding-agent 包，也支持通过 `PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT` 定位。当前确定性验收模型只在父进程中注册，因此单靠它无法证明后台子代理的模型调用。

## Goals / Non-Goals

**Goals:** 让固定版本的已发布包在新构建的 0.86.1 镜像中完成安装和执行；保留包私有依赖的字节；在创建 Operation 前拒绝过期的 helper 镜像；通过真实 SDK 和可控模型响应验证前台与后台行为。

**Non-Goals:** 重写第三方清单、接纳四个宿主 Pi API 包的嵌套副本、自动升级现有 Work 或冻结包、扩大 Work 挂载或 Core 凭据范围，以及保证所有在线包均可运行。

## Decisions

### 1. 固定同一组 Pi SDK 版本并重建两种镜像

将 `packages/pi-adapter/package.json` 与 `apps/agentd/package.json` 中直接依赖的 `@earendil-works/pi-ai` 和 `@earendil-works/pi-coding-agent` 精确固定为 `0.86.1`；重新生成 `package-lock.json`，并确认传递依赖中的 coding-agent、agent-core 和 TUI 也解析到匹配的 0.86.1 版本。本变更不使用浮动版本范围，也不升级到 0.86.1 之后的版本。从 `Dockerfile.agentd` 重新构建 `production` 和 `acceptance` 目标；可信 helper 必须来自同一源码修订版。保留 `PiPackagePreparedEnvironment.piSdkVersion`、镜像 ID、内容摘要及 `assertPiPackageEnvironment` 的精确匹配行为。用现有 SDK 测试确认 0.86.1 的 `DefaultResourceLoader` 和 Session/工具 API。这可将兼容性变化限制在明确版本内，避免替换现有 Work 已捕获的字节。

备选方案是使用浮动 SDK 版本；这会让镜像与冻结包的兼容关系随安装时间变化，因此不采用。

### 2. 允许私有 TypeBox，同时保持 Pi API 由宿主提供

仅从异步和同步产物验证器的 `HOST_MODULES` 中移除 `typebox`。四个 `@earendil-works/pi-*` 名称仍不得出现在 `dependencies` 中。保留现有校验：每个声明的运行时依赖必须解析到准备树内部的目录，树中的所有文件和符号链接继续纳入摘要及 ZIP。`apps/package-helper/src/main.ts` 继续用 `npm ci` 或 `npm install` 安装生产依赖；不得过滤、别名替换、提升依赖或重写清单与锁文件。SDK 资源加载器接收冻结包根目录，并从中解析包私有导入。为私有 `typebox`、缺失或逸出的 `typebox`、被禁止的 Pi API 依赖增加成对的异步/同步验证测试。还需通过真实扩展验证 TypeBox schema 能完成工具注册和调用；仅安装成功不足以证明兼容。

备选方案是把已发布清单中的 `typebox` 重写成 peer 依赖。这会改变上游字节，使冻结产物不再等同于发布包，因此不采用。

### 3. 在所选准备镜像中验证宿主 peer 版本范围

扩展 `packages/pi-package/src/source.ts` 的 `PiPackageManifest` 和 `parsePiPackageManifest`，读取 `peerDependencies`。缺失字段按 `{}` 处理；存在时必须是 JSON 对象，键为有效包名、值为非空字符串，否则返回 `PI_PACKAGE_INVALID_MANIFEST`。在包验证工作区直接依赖 `semver` 及其类型，使用严格的 `validRange` 和 `satisfies`，排除预发布版本；只对四个宿主 Pi API 名称做明确检查。其他非 Pi peer 沿用 npm 的安装行为。在 `prepare` 阶段完成解包及来源树验证后、运行 `npm install` 前，从同一镜像的 `/workspace/node_modules` 包清单读取四个宿主模块版本。宿主模块缺失或版本无效属于镜像不兼容；声明的范围格式错误返回 `PI_PACKAGE_INVALID_MANIFEST`；有效范围不满足返回 `PI_PACKAGE_SDK_VERSION_UNSUPPORTED`。npm、Git、本地和 ZIP 来源共用此检查。准备镜像 ID 不可变并随 Operation 持久化，因此标签移动后重试仍使用接受请求时的版本。安装可继续使用 `--legacy-peer-deps`，但不能绕过这一明确检查。

将新安全错误码加入 `PiPackageInputError`、`packages/runtime-docker/src/docker.ts` 的 helper 结果允许列表，以及 `apps/core/src/packages/worker.ts` 的失败映射。公开的 Operation 结构仍为 `stage`、`code`、安全的 `message`，不包含原始 npm 输出、文件路径或凭据。无需新增数据库字段：peer 校验在所选镜像内、冻结发布前完成；现有产物元数据继续记录精确的 coding-agent 版本，供运行时匹配。

备选方案是与 Core 已安装的 SDK 或配置中的镜像标签比较；二者都不能标识实际执行准备脚本的不可变镜像。

### 4. 幂等重放之后、接受请求之前预检两个 helper 镜像

在 `Dockerfile.agentd` 的共用运行阶段添加 OCI 标签 `io.piwork.package-helper.contract=1`。增加 `DockerRuntime.inspectPiPackageHelperContract(imageId)`：检查精确镜像 ID 的标签，并以有时限、只读、无网络、非 root 的 Node 探针检查 helper 入口是否为常规文件。探针只把该文件当数据检查，不执行包代码。`CorePiPackageService.accept` 和 `acceptWork` 均在 `findReplay`、来源验证和镜像解析之后、`store.packages.accept` 之前，对所选准备镜像及可信 helper 镜像调用该检查。缺少标签或入口时返回安全的 `PI_PACKAGE_HELPER_INCOMPATIBLE` 和 HTTP 409，不创建 Operation。Docker daemon 故障沿用现有运行时不可用路径，不误报 helper 不兼容。保持 `findReplay` 先于所有镜像预检；上传重放的既有语义与本次镜像检查分别维护。

标签声明能力，文件探针则阻止复制了标签但构建过期或错误的镜像通过。不可变镜像 ID 排除了探针和接受任务之间的标签移动。准备使用一个镜像，init/capture 使用另一个镜像，因此两者都必须通过。增加 Core/Work、旧镜像、可信镜像、标签移动、无接受副作用及已失败 Operation 重放的服务测试。

备选方案是等待 worker 返回笼统的 `PI_PACKAGE_PREPARATION_FAILED`；那时已经创建了失败 Operation，且无法明确定位缺少 helper 的部署错误。

### 5. 从 Work 镜像定位子代理 Pi，不改变挂载

在共用镜像运行阶段，将 `/workspace/node_modules/.bin` 加入 `PATH`，设置 `PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT=/workspace/node_modules/@earendil-works/pi-coding-agent` 与 `PI_CODING_AGENT_DIR=/tmp/piwork-child-agent`。发布前确认包根目录存在、名称和版本正确，且 UID 10001 可执行镜像中的 CLI 入口。不另设 `PI_SUBAGENT_PI_BINARY` 覆盖值。前台原生子代理留在 agentd 进程中并使用父 Pi 运行时；后台执行器继承镜像内的包根目录覆盖值和 Work 容器隔离。现有 Work 卷、网络、UID、凭据挂载和父资源加载器保持不变。不启动宿主进程，不暴露 Core 路径。Docker 停止 agent 容器是后台子进程的终止边界；添加观察这一行为的生命周期测试。

后台子代理无法使用父进程 `ModelRuntime` 内存中的 API key。在 `apps/agentd/src/pi-sdk-executor.ts` 中，验证现有只读 Work 模型凭据并解析模型后，使用该 Work 的 provider、model、base URL、API 类型和凭据，在 `/tmp/piwork-child-agent` 生成最小化的 Pi `models.json` 与 `auth.json`。现有 `/tmp` 挂载为 tmpfs；这些 0600 文件会在 Work 停止时消失，不得写入 `/var/data`、Core 数据库、Session 历史或诊断。扩展工具可能启动后台子代理之前，必须原子地完成文件写入；目录权限为 0700，agent 启动时清除上一代遗留文件。仅在验收中使用的进程内确定性 provider 跳过此桥接；在线验收使用受控 HTTP provider。子代理只看到所选 Work 的模型和 key，不读取 Core 操作员凭据。使用 Pi 0.86.1 的模型与认证文件格式，并针对生成文件测试分离的后台执行器。父进程现有凭据流程不变，后台子代理则获得通用的 Work 内模型访问路径。

备选方案是在镜像中另装一个全局 Pi CLI；它可能偏离父 SDK 版本，使精确版本检查失效。

### 6. 将确定性回归测试与真实 registry 发布验收分开

保留 `scripts/product-acceptance.mjs` 及其本地 npm/Git fixture server，作为离线回归测试。增加 `scripts/online-pi-package-acceptance.mjs`，作为显式、必需的发布验收门禁，使用公开 npm registry 和精确的 `npm:pi-subagents@0.71.0` 来源。脚本应引导隔离的 Core/Work 数据，用新构建的 acceptance 镜像作为所选 agent 和可信 helper，确认 Core 安装 Operation 成功及解析后的来源，把冻结的 Core 包复制到 Work，应用配置，检查 `loaded=true` 和实际 `subagent` 注册，再调用前台与后台路径。该用例不能经过 `startPiPackageSources`，因为它的镜像会把 npm 重定向到离线 fixture registry。registry 故障使在线验收以安全诊断失败；CI 仍可单独运行离线测试。

子代理调用使用验收网络中可随测试销毁的 OpenAI 兼容 HTTP 模型 fixture，响应协议固定，key 仅用于 fixture。父 Work 模型指向该端点；同一 Work 内的 tmpfs 凭据桥接必须配置分离的后台执行器，不得另设写入持久数据的测试专用路径。fixture server 仅在验收 Work 网络内可达，清理阶段移除 server 和全部临时数据。测试必须检查 SDK 工具调用事件和子代理终态，不能只搜索 assistant 文本。固定提示词，并断言预期子代理输出、取消/停止行为，以及 Work 停止后没有存活进程。不得提交真实模型凭据，也不得把 fixture 路径做成生产环境的绕过入口。

实现在线驱动脚本前，从固定的 `0.71.0` 压缩包记录前台/后台工具参数和结果结构，作为验收常量；不得使用会移动的 latest 版本。这是确定测试输入，并非待定的产品决策。

## Risks / Trade-offs

- [在线 registry 或固定版本压缩包不可用] → 在线发布门禁失败并报告外部原因；离线 fixture 测试仍可区分产品回归。
- [包私有 TypeBox 与 SDK 副本不同] → 保留私有副本的冻结字节，并在验收中要求实际扩展注册与工具执行，不暗中替换为宿主 TypeBox。
- [定制或旧 agent 镜像缺少 helper 契约] → 在接受新包请求前以特定错误码拒绝；现有 Work 和已接受的 Operation 保持不变。
- [包在 Work 内启动子代理负载] → 保留现有容器资源与挂载边界，使用已捕获的 Pi 安装，并验证 Work 停止时进程终止。
- [新 SDK 改变加载器或工具 API] → 固定 0.86.1，运行现有 SDK 与包回归及已发布包验收；仅对尚未迁移到新镜像的 Work 回退镜像标签。

## Migration Plan

无需存储格式迁移。先构建并标记 0.86.1 的生产与验收镜像，配置匹配的可信 helper 镜像，再显式移动 Core 默认 agent 镜像或单个 Work。现有 Work 保留已捕获的 0.86.0 镜像 ID 和包产物，不重写。包跨不兼容 SDK 镜像复制时，沿用现有环境校验失败。回滚时，为受影响 Work 使用先前镜像 ID 和旧应用构建；任何针对 0.86.1 冻结的包仍绑定其 0.86.1 环境，不得重新标记为兼容 0.86.0。
