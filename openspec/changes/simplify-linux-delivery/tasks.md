# Tasks

## 1. Core 入口和三项启动配置

- [x] 1.1 将宿主服务入口改为 cmd/piwork-core，删除旧 piwork-serve/piwork 别名与 serve/管理命令分发；移除 internal/coreoperator 的命令解析、env-file、秘密交互和离线回退，必要共享函数移回其现有职责包。验证：入口分派测试覆盖所有退役子命令拒绝，源码无生产调用旧命令包。
- [x] 1.2 在 internal/app 实现 --ui-port、--core-port、--data-dir 及无副作用 help/version，保持默认数据目录；删除其余启动参数与兼容拼写。验证：表驱动测试覆盖默认值、自定义值、相同端口、7172 冲突、越界/空/重复/未知参数和额外位置参数，拒绝时无文件/网络副作用。
- [x] 1.3 保留 coreapp/settings、identity、corestore 的 operator 凭证及元数据、/control 和 /api/v1/admin 授权与 Setup 委托；不引入存储迁移。验证：新安装生成/校验 operator，正常重启复用原凭证；用户 token、operator、admin、Setup 分别只能访问既有范围，不能读取他人 Work 内容。
- [x] 1.4 删除 cmd/piwork-console 和 consoleapp 的独立启动/TLS 配置适配，保留 HostedHandler、管理资源、业务服务和 UI 会话。验证：共享管理端单元/契约测试及管理 UI 构建通过，不依赖独立 Console 程序。
- [x] 1.5 将 Core --version、About、buildinfo/releaseinfo 及 package.json 启动入口改为 piwork-core，保留 CLI 自身身份。验证：产品信息测试核对程序名、版本、commit、dirty、平台及两套 UI 摘要一致。
- [x] 1.6 更新双语部署手册的原生启动/初始化说明、AGENTS.md 对应架构段和 UI 预览命令，删除旧管理命令教程。验证：命令与本组解析契约一致，双语内容对应，git diff --check 通过。

## 2. HTTP 网络与统一生命周期

- [x] 2.1 UI/Core 按三参数契约绑定通配 IPv4，后端固定 loopback Core HTTP；删除服务端 HTTPS/origin 配置分支，保留内部 7172 mTLS 回连及 Docker 系统设施选择。验证：启动集成测试检查两个实际 HTTP listener、内部认证和无图形环境输出，旧 TLS 参数拒绝且没有新增替代环境变量。
- [x] 2.2 将 webapp、HostedHandler、HostedDesktop 的 origin 使用统一为服务端验证的请求入口，覆盖本机 IP/localhost/主机名、多网卡、会话绑定、Service、内容链接及 WebSocket。验证：来源单元/契约测试覆盖合法地址、错误 Host/端口、跨站 Origin、CSRF 和 Forwarded 伪造；客户端不能改变 Core 上游。
- [x] 2.3 将 UI/Core/RPC listener、存储锁及恢复协程纳入同一失败清理和异常关闭路径。验证：逐个端口占用、同目录第二实例、部分启动失败及 listener 异常结束测试，确认非零退出、释放资源、不换端口或影响原实例。
- [x] 2.4 迁移 scripts/native-test-server.mjs 与相关浏览器/集成夹具到新入口和测试构建镜像引用，去掉生产参数注入和旧管理命令依赖。验证：native-test-server 测试、两套 UI 的相关浏览器/real-core 测试通过，夹具不恢复隐藏命令或第四个产品参数。
- [x] 2.5 同步双语手册、网络示例与 AGENTS.md：HTTP 双端口、外部 CLI、内部 RPC、本机 Desktop 显式 --port、关闭窗口和数据保留。验证：默认/自定义端口示例与实际启动一致，当前材料不再要求 public-origin、TLS 或 core-listen。

## 3. Linux 客户端与 CLI 容器清理

- [x] 3.1 将 config/cli-release-targets.json、build-cli、clirelease 与运行夹具收敛为 linux/amd64，删除非 Linux 专用实现/测试及仅服务这些路径的依赖。验证：非 Linux 目标被拒绝，Linux CLI/client/clientfs/pipackage 等相关测试通过，make build-cli 可独立构建且不拉取或构建 Core 镜像。
- [x] 3.2 删除 Dockerfile.cli、CLI entrypoint、Compose/overlay/client env 模板、container_mode 代码和仅对应容器模式的测试。验证：原生 Desktop/proxy 始终 loopback，旧容器模式变量不再改变行为；open/logout、凭证和偏好恢复相关测试通过。
- [x] 3.3 保留所有原生用户业务命令及 HTTP(S) origin/CA、传输、快照、取消和身份规则；删除 Windows PE/ZIP 发行分支，不误删业务 ZIP 协议。验证：Linux 原生夹具覆盖命令分派、权限/并发、默认 Desktop、本机控制、proxy、包/快照及中断，不以 help/version 替代完整运行。
- [x] 3.4 清理 deploy/docker 和 examples/single-host 中 CLI 服务、profile、卷与交换教程，改为 Core-only 及外部 Linux 原生 CLI 示例；更新双语平台说明与 README 平台短说明/导航。验证：Compose 配置只有 Core，CLI 示例不启动或停止 Core，两份 README 仍精简且互相对应。

## 4. 两个宿主构建产物与四角色镜像候选

- [x] 4.1 重写 scripts/build-go.sh 的目标与受管输出替换，显式构建两个宿主程序，更新 Makefile 帮助和依赖；helper/MCP 仅由对应镜像构建。验证：干净构建及预置七程序/旧别名后重复构建，dist/go 精确包含两个有效静态 Linux ELF；失败不发布半套程序。
- [x] 4.2 将 Dockerfile.core 的程序/entrypoint/探针改为新三参数入口，保留相同绝对路径挂载、socket、host 网络和 60 秒关闭窗口。验证：镜像边界与入口测试，空业务 env 启动可访问引导，停止保留数据。
- [x] 4.3 将 build-docker-release、collect-docker-release、preflight、Dockerfile.docker-release 和候选材料模板统一为 core/agent/fileHelper/snapshotHelper 四角色。验证：相应脚本测试不再要求 CLI 角色，packageHelper 与 Agent 对应；错误角色、身份变化、远端查询失败仍在首次推送前拒绝，测试不执行真实推送。
- [x] 4.4 将 release 依赖改为生产镜像身份确定后构建 Core/CLI，再组装同版 Core 镜像/材料；清除默认发行对 migration-acceptance 镜像的引用。验证：构建顺序测试与实际候选核对内嵌引用、镜像 ID、源码/协议/UI 身份一致，make -j 不产生竞态，测试夹具不进入生产候选。
- [x] 4.5 更新本组构建、镜像维护和客户端独立构建说明；同步双语部署手册及 AGENTS.md 中七程序/五角色/Windows 旧叙述。验证：基础 npm ci、make build 路径可用，检查命令、当前目标和清单一致。

## 5. 干净发布及当前材料生成

- [x] 5.1 将 package-go-release 与相关客户端打包流程改为白名单和独立暂存，验证成功后可恢复地替换成品；为受管输出路径设清理边界，成功后 dist/release 只留下当前目录、归档和外部 checksum。验证：打包测试覆盖旧残留、连续 A/B/B、编译/归档/校验失败、提交中断恢复及危险输出路径拒绝，上次完整包和业务数据不被破坏。
- [x] 5.2 清理发行清单与包内内容：两个宿主 ELF、生产镜像按 ID 去重、许可、必要双语材料/资源、版本/源码/UI/协议/镜像身份及校验。验证：归档清单精确核验，没有旧程序、宿主 helper、非 Linux 包、验收镜像/报告或历史 staging，解包后的 --version 与 manifest/hash 一致。
- [x] 5.3 收敛 stage-go-release-materials 的材料集合，保留当前链接及真实 commit 校验，避免从 README 开发导航遍历打包 OpenSpec/历史附件。验证：既有 stage 测试和新增白名单用例覆盖未提交材料、图片、缺失目标及无法安全提供的链接，不伪造外链或复制全部源码。
- [x] 5.4 更新 docker-quickstart-content、sync-docker-quickstart、sync-docker-website、检查器及当前模板，生成两个语言的 Core-only/原生 Linux 使用材料；同步只写本仓库与隔离官网预览，不发布网站。验证：node scripts/check-docker-quickstart.mjs、node --test scripts/check-docker-quickstart.test.mjs，以及合成 A/B 连续同步通过，根 README 不被教程生成覆写。
- [x] 5.5 清理当前部署手册和示例中退役命令、独立 Console、CLI Docker、非 Linux 原生发行及旧安装兼容教程，保留已发布版本记录原值并明确版本归属。验证：node scripts/check-repository-docs.mjs、有效链接与命令检查通过；历史 commit/dirty/hash/digest 无变化，新说明不误配旧镜像。

## 6. 整体闭环与范围核对

- [x] 6.1 迁移并运行 native-host-acceptance：用最终两程序包、隔离 Engine、真实 SDK 路径，通过网页初始化及管理 API 完成配置，Linux CLI 连接同一 Core。验证：脱离源码/宿主工具后 UI、用户 CLI、operator API 及内部 helper 实际可用，生产和被测制品身份一致。
- [x] 6.2 使用通配监听和独立客户端网络实际访问服务器 IP，覆盖默认/自定义 HTTP 端口、多网卡、管理员/普通用户隔离、Service 前缀、响应 Cookie、SSE/WebSocket、Files、包与快照往返。验证：浏览器只访问 UI、CLI 直连 Core、origin 切换不串会话；按现行契约区分真实模型/浏览器证据与 fixture，未执行项如实记录。
- [x] 6.3 对实际候选执行正常关闭与重启恢复，另验证 CLI/浏览器退出不控制 Core。验证：Core 退出确认本安装运行容器停止，配置/历史/意图及 operator 凭证保留；重启按原身份恢复，其他安装资源不变。
- [x] 6.4 从干净检出执行基础构建和 make test、相关集成/浏览器及 Linux 原生验收，并制作本地 release 候选；运行原生/镜像边界和材料检查。验证：逐项保留实际结果与未测限制，生成输出在 dist，不把历史索引或旧版本通过记录作为本版证据，不推送或发行。
- [x] 6.5 核对本变更 proposal/design/specs/tasks 与最终实现和材料一致，执行 OpenSpec 严格校验和只读合并预览；在后续规格同步时更新 cli-runtime-portability、control-cli、serve-ui、docker-delivery 的过时 Purpose 为本版范围。验证：有效条款不再要求退役入口，operator 与 Work 能力未被误删，旧入口只出现在明确拒绝、移除说明或历史材料中，git diff --check 通过。
