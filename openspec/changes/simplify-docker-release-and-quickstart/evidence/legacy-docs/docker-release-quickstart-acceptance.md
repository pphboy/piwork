# Docker 镜像发行与终端 Quick Start 验收

日期：2026-10-09。对应 change：`simplify-docker-release-and-quickstart`。

本记录分别保留本地候选与授权后正式远端发行的事实；各段仅证明其对应快照。当前有效发行见末尾“最终发行与远端验证”。

以下本地候选阶段未进行 Docker Hub 推送、Release 上传、Git push 或官网发布。已生成的下载材料和新镜像仍标记 candidate；旧 Docker/Windows/Desktop 验收记录仅用于各自原版本与未变行为。

## 修订前候选身份（保留历史事实）

| 项目 | 事实 |
| --- | --- |
| 发行标识 | `0.0.1-da7c57ef9880-2347c451725f-dirty` |
| 源码提交 | `da7c57ef9880f7cd8f04e6ee171d02f1beab3401` |
| 源码输入摘要 | `2347c451725f18796d52d1a517b4e6f32c1500c5de77e3be7f05d12b69cae974` |
| 修改状态 | true，明确为工作区候选 |
| 平台 | linux/amd64 |
| Core 数据格式 | piwork-go-core / schema 1 |
| Work history | schema 5 |
| Desktop 输入摘要 | `2fa77fd5abbff5f1034b1de986aa45c5d6c249d275b373a900a9388a057bfc87` |
| 构建方式 | Docker 多阶段构建，构建容器内 Go 1.25.5 / Node 24，无宿主 dist 前置 |
| 发行材料 | `dist/docker/candidate/`，独立 Compose、实际镜像清单、来源说明、待审阅推送命令及 SHA256SUMS |
| 隔离运行环境 | 本次专属 Docker 28 DinD Engine 和本地 registry/mirror；无本版 Agent/helper 缓存开始准备 |

五个角色使用同一发行标识。实际镜像 ID、协议及构建记录保存在候选清单与 `dist/docker/inputs/`，package helper 与 Agent 相同。没有把镜像 config ID 写成 registry digest；正式远端 digest、匿名读取和公开文件下载待用户批准发行后单独核查。

## 修订前实际终端闭环

每条路径使用独立 Engine/数据，从已有初始化环境启动。真实模型输入只用于 Core，CLI 使用独立凭证卷；记录不包含账号密码、模型 key、token 或模型地址。

| 路径 | Work ID | 首次 Run ID | 结果 |
| --- | --- | --- | --- |
| Core/CLI 各一条 Docker run | `work-cd9fb96a-ea07-4665-8049-c08ae92c0f6d` | `run-50a8338f-e426-4c4e-8eb4-78811755fcf5` | 隐藏 TTY 登录、创建自动运行、真实模型回复、写入及读回文件通过 |
| 单个 docker-compose.yml | `work-84aea1b1-e490-4b27-b99c-c0948bad607f` | `run-f5182719-dfb5-4623-980f-910ab6225dd3` | 仅一个 YAML、同样终端闭环通过，CLI 服务未取得 Core 初始化秘密 |
| 高级 Core-only Demo + Docker run CLI | `work-8add1522-eae8-4351-a2bb-aba4ede6d8ea` | `run-dcbe4e95-c407-4187-8bd1-d94cdd086b90` | 独立数据路径、完整就绪与真实终端回复通过 |

三条路径均验证退出/重建 CLI 后凭证可复用且 Work 不停止；Core 正常停止退出码为 0，受管 Work 停止，重启后原 Work ID、历史和 workspace 保留。Compose 路径文件重启后的 SHA256 为 `21aac7c0c4e008ea8e82b80aed7313c05db80014d1304838e81e64593da8299e`，与首次工具验证值一致。原已接受 Run 可按原 ID 查询，无需重新提交。

Demo 重建期间改用合法但不同的初始化密码、模型名和 key，原凭证及原模型仍可继续使用，证明初始化不覆盖持久值。另对独立 Engine 做实际暂停/恢复，完整就绪先失效，同一 Core 进程随后自动恢复 ready；本地 mirror 的短暂中断也未要求用户手动拉取 helper。

## 负向与一致性检查

- 实际镜像缺少管理员/模型输入时 health 可访问而完整 readiness 为 503；没有创建默认账号、密码或 Work。
- 新空目录初始化为私有 0700；已有目录权限不合法、单实例锁占用和缺失 socket 挂载均失败，未放宽安全校验。
- 实际 Docker run/Compose 容器收到合成的美元符号、空格和引号原值；可选地址未设置保持不存在，显式空值保持空值并由 Core 既有规则拒绝。CLI 服务配置不含初始化秘密。
- CLI 默认入口的等待、超时、503、重定向、非法 origin 和 SIGTERM 测试通过；显式 help/version、业务参数与 Desktop 转发通过，原生默认行为未改动。
- 全角色实际 image inspect、镜像内版本、平台、协议、Core 内置配置、CLI 资源摘要及运行工具边界检查通过。
- 独立 Compose 导出、SHA256SUMS、候选清单反向核对以及文件/清单篡改负向检查通过。
- 根目录中英文 README、双语手册、Core Demo、镜像 defaults 和官网对应命令通过可执行一致性检查；官网 VitePress 构建通过。
- `npm ci`、`make build`、`make test`、指定 Docker Quick Start/发行/CLI 入口脚本测试、对应 Go 测试、OpenSpec strict 校验及 `git diff --check` 通过。

所有运行与浏览器默认入口调整仅按终端路径验收；Windows/高级 Desktop 新版实机全量流程未在本次执行，不能由 Linux 结果补记。某次真实模型调用 SDK grep 报 rg 的 EACCES，模型使用其他工具完成了本次文件操作；这不是 SDK 全部工具已通过的证据，需在对应 harness/运行边界范围单独处理。

测试结束正常关闭 Core，清理本次精确容器、其挂载的匿名卷和专属网络；不执行全局 prune，不删除其他安装资源。候选运行镜像留在本地供用户审阅与判断推送。

## 修订后候选与独立入口验收

本节对应默认 Core、CLI 独立运行，以及 `examples/single-host/` 可选“单机部署示例”。修订前合并 Compose 的结果不作为本节通过依据。

- 发行标识：`0.0.1-da7c57ef9880-49fc85a9d0c5-dirty`。
- 源码输入摘要：`49fc85a9d0c587d1ce6e9e1311da151165103fa8bdef3eaba91107c0884fefdc`。
- 源码提交：`da7c57ef9880f7cd8f04e6ee171d02f1beab3401`，工作区修改状态 true；Desktop 输入摘要保持 `2fa77fd5abbff5f1034b1de986aa45c5d6c249d275b373a900a9388a057bfc87`。
- 五个角色由本次源码通过 Docker 多阶段构建重新制作，平台 linux/amd64，Go 1.25.5 / Node 24；实际镜像版本、协议、Core defaults、CLI UI 与工具边界全部核对。
- 宿主 Engine 26.1.5 / Compose 2.26.1 用于构建与驱动；实际 Core 闭环在三个独立的 Docker 28.5.2 DinD Engine（Compose 2.40.3）内运行，使用专属本地 registry/mirror，全部无本版 Agent/helper 缓存开始。此来源不代表 Docker Hub 发布或匿名可读。

| 角色 | 实际本地镜像 ID |
| --- | --- |
| core | `sha256:a18f3c2893f772ca222b3bd38bba8a55527557ff834137302172dbb48245efea` |
| cli | `sha256:45911abdaf79f882a85184919f1f95fba6487be3fa7b06e8d90349be6a8ce8d0` |
| agent | `sha256:39be0d248c5752ba41b4681047c2dd63917029885b1b3aea68a1b07f46c4a91d` |
| fileHelper | `sha256:083a9dc6cd0f338eec37cb132d4fbb6d73d1d820b1f400a4294427ce078a4a06` |
| snapshotHelper | `sha256:989b570c413f5b156eb32df270e0effb61663bcf8c5956d57d66f83390a23c20` |

| 路径 | Work ID | 首条真实模型 Run ID | 结果 |
| --- | --- | --- | --- |
| 独立 Core/CLI Docker run | `work-86d8f884-bf94-46c2-83c5-23761f44b90a` | `run-5197f0d6-4dde-4648-96cd-b8f36cad677b` | 真实 TTY 对话、凭证复用、Core 正常关闭/恢复、原 Work 和文件读回通过 |
| Core-only Compose + 独立 Docker run CLI | `work-aceaca56-2f50-48b7-8798-b1842ef0b85f` | `run-6b43b3c7-2a76-4924-877d-f2a59f2be34a` | 真实 TTY 对话、凭证复用、Core 正常关闭/恢复、原 Work 和文件读回通过 |
| examples/single-host/ 合并 Compose 示例 | `work-2509dd0b-33c9-46e8-9fa1-3a5f461f720c` | `run-c5810e4d-93b4-4139-8fb2-3c2bb6d34b8d` | 真实 TTY 对话、凭证复用、Core 正常关闭/恢复、原 Work 和文件读回通过 |

三个路径均检查私有 Core 目录为 0700。默认 Core Docker run 与 Core-only Compose 使用 /var/lib/piwork/quickstart/core；单机示例使用 /var/lib/piwork/examples/single-host/core 和专属用户状态卷。CLI 在缺少或改变 Core 初始化变量的新终端重进，Core image/container 身份、启动时间及运行容器集合保持；CLI 不取得 Core 初始化秘密。

单机示例移除 Core 依赖，使用 `run --rm --no-deps cli`。Core 已不存在时实际启动 CLI，只创建 CLI 容器，不创建或启动 Core；等待期间取消为非零退出。初始验收脚本曾比较短 ID 与完整 ID 而误判，已保留初始记录，改用完整 ID 后独立重复该场景通过，未修改产品以绕过断言。

暂停/恢复本次隔离 Engine 的 dockerd，Core 完整就绪先失效，再自动恢复；探针直接请求 Core HTTP，避免依赖被暂停的 Docker API。原接受 Run 按原 ID 重放，前后 Run 集合不变，没有重新提交 mutation。

发布与文档检查：

- 新增/调整脚本、CLI 入口、发行身份、官网和发布预检测试共 50 项通过。发布预检覆盖标签重指向、远端冲突、认证/网络错误、未知身份、清单篡改；失败和演练均零 push，全部角色检查完才允许进入推送阶段。
- 使用实际本地候选和实际远端查询运行 `push-commands.sh --check` 通过；没有执行 `--push`。清单 SHA256、平台、源码/协议/UI 标签和 image ID 均重新核对。解析器在标准 Node 24 容器中运行，宿主不要求 Node。
- 真实 Compose 容器验证合成美元符号、空格、引号保持原值，可选 Base URL 的未设置与空值有别；CLI 无 Core 初始化环境或生命周期依赖。
- 官网连续同步 A、B 两候选的回归验证双语 First Work 及其他当前引用均更新；首页、安装、导航、当前下载的过期引用负向门禁通过，历史版本冻结材料不变。双语官网构建通过。
- Core-only Compose、单机示例 Compose、双语示例说明和发布入口均进入候选清单及 SHA256SUMS；实际 Docker materials 导出、反向检查和校验通过。根/官网材料检查、相对链接、native boundary、OpenSpec strict 和两仓 diff whitespace 检查通过。

本节未重新执行修订前已通过且未改动的全量 make build/test；本次按脚本、Docker 材料及真实 Core 交互范围验证。Windows/Desktop 新候选实机全量验收仍未执行，不由 Linux 结果推断。未执行 Docker Hub 推送、Release 上传、Git push、官网发布；正式远端 digest、匿名拉取和公开下载仍为待授权发行任务。

修订后验收结束前确认三个隔离 Engine 内没有运行容器，再移除本次标签匹配的四个外层容器、其匿名卷、专属网络和临时本地镜像别名；未执行 prune，主候选镜像保留供审阅。

补充启动边界：新候选在宿主 Engine 26.1.5 上仅检查挂载/早期启动保护，新空目录 0700、并发安装锁拒绝、已有 0755 目录拒绝且不自动修复、缺失 socket 不创建目录均通过；此检查不作为 Engine 26 完整运行兼容证据。完整业务闭环仍以本节隔离 Engine 28 结果为准。该补充测试的精确容器、目录与 Compose 资源均已清理。

## 最终发行与远端验证

用户明确授权 Docker Hub 推送后，当前镜像已发布并验证匿名读取。Git 推送、官网上线和实际公开下载验证继续等待用户最终确认。

- 最终发行标识：`0.0.1-fc409adc1a0b-808d890c6607-dirty`。
- 实际构建基线：`fc409adc1a0bcd7cdf48d711fe7e6efca92a4bdb`，修改状态 true；发布分支已同步本地 main 的既有 Logo 提交，保留其历史。
- 实际源码输入摘要：`808d890c66072207aea4d453459cc7ff7837af2e64464243a22f9e2010295523`。
- CLI 内嵌资源摘要：`7f9c422f5d5b1b07c211708ebc4f120d1711625d183c129c6c3fbdc18f9dec72`。
- 平台 linux/amd64；隔离 Engine 28.5.2 / Compose 2.40.3；构建 Go 1.25.5 / Node 24。

| 角色 | 实际 registry manifest digest | 实际 image config ID |
| --- | --- | --- |
| core | `sha256:e66f2cf552630ebc88369e23b8f37e72da6012a73c42a1ca6d96da9dbb39bd0d` | `sha256:55613b7334acc71752d4c8e1b40f5bf8657bb24ca2bf3a9ea9bab130949aef25` |
| cli | `sha256:8a6d7a26ed0f97d76931ea4f5bc682061839d7edcd1b6d13afc1f4142de3de1a` | `sha256:93e54d74717c7da7db71eb58d30de388f8749bc39f622e80088e0772f0895123` |
| agent | `sha256:d4d93fa90236ad5568717a795918fbb98f252964619b99d2f1c08df83c023c11` | `sha256:043a9ea128d4819d42746ede025374d4d7f0769ab40981d2ccab9c16254c10d1` |
| fileHelper | `sha256:8bc89dc4776682f0396df0ed6473919031827436a639289e0c1c9efd071ddef5` | `sha256:65d968959e067b24b3c72ecfcab5e29f0c09b311710bad32166cf8fb853c829b` |
| snapshotHelper | `sha256:c408c0abe957ba780a6d3417ba189accb2f65839446086e0ba1702fb108d0c94` | `sha256:156d211caad8cfc9465476bcdb016a4ab1ff0a947c252219833c4484c98d0922` |

五个角色均经同一发布入口在首次 push 前实时核对本地身份、源码、平台、协议、CLI 资源和远端标签。匿名 HTTPS 请求直接读取 Docker Hub manifest 与 config，逐字节 SHA256 匹配 registry digest/config ID，并核对实际标签；使用空 Docker 配置拉取后的 ID 一致。package helper 复用同一 Agent 镜像。

第一批已授权发布的 49fc85a9d0c5 快照保留原标签，三条公开冷启动路径的结果保存在历史记录中。随后正式状态的脚本测试暴露出夹具假定当前文档总为候选状态的问题；已修正为负向场景显式声明 candidate。对齐本地 main 的 Logo 更新后，再制作本节最终快照，未覆盖已存在的其他身份标签。仅本地制作的 4bc91ffc9afb 中间快照未推送；其关键词断言把模型生成的 Compose 命令误作持久化失败，原失败记录保留，最终验收改用重启前后的真实文件 SHA256。

本地最终快照的三个路径均从独立 Engine、空安装和无本版 Agent/helper 缓存开始，经专属本地 mirror 验证；镜像身份与本节正式公开身份一致：

| 路径 | Work ID | 首条真实模型 Run ID | 文件重启前后 |
| --- | --- | --- | --- |
| run | `work-64104039-663c-4b2a-b4bd-b0b34d83fa2c` | `run-662ca613-00f3-4462-a8c6-a14f5cd7a20e` | SHA256 一致 |
| compose | `work-b54072a1-33bb-4c78-8b64-acfd0ac44bbd` | `run-e811f36f-069b-4f46-8e9f-89fda648101d` | SHA256 一致 |
| single-host | `work-a589e9cb-e505-4ffb-97ba-6380b719a4e2` | `run-4cdba7aa-f303-4b20-bfe9-e64f4bd35d97` | SHA256 一致 |

正式远端冷启动使用另一个全新 Engine，空 Docker 配置、不设置 registry mirror，直接从 Docker Hub 拉取入口及全部依赖，检查实际 image ID、版本、协议、CLI 资源与完整就绪。Work `work-dbfa2cb5-a512-4988-bfcc-06e49a4703a0` / Run `run-eec359e0-7a76-4ff3-9358-6fc898711d50` 收到真实模型回复，凭证复用、CLI 重进不改变 Core/Work、正常关闭、原 Work 与文件字节恢复均通过。Compose 与单机示例的同一最终镜像本地验证与匿名身份验证分别记录，不冒称为新版本 Windows/浏览器全量验收。

最终快照还通过真实 Engine 暂停/恢复与完整就绪自动恢复，原 Run 按原 ID 重放且 Run 集合不变。单机示例 Core 缺失时只创建 CLI，等待取消非零退出；无自动创建或启动 Core。

发布状态的脚本测试、CLI/Console Go 测试、native boundary、材料一致性与校验、OpenSpec strict、两仓 diff whitespace 均检查。Docker 构建只精确放行并哈希既有公开 docs/images/piwork-logo.png，以满足 main 的资源构建输入，其他文档与秘密排除保持；CLI 资源来自重新构建，不复用旧 embedded 文件。

正式材料在 dist/docker/published/；两仓文档和官网静态下载含同版 Core-only Compose、单机示例 Compose、真实 digest 清单及 SHA256SUMS。官网本地构建/下载预览与部署边界测试仅使用本地服务器/临时 Git 仓库，不执行真实网站发布。仓库与官网的待发布范围见 [发布复核](docker-release-publication-review.md)。旧公开下载材料未由本 change 改写。

本次隔离安装按精确 fixture 标签清理外层容器、匿名卷、网络与本地 mirror 别名，先确认受管运行容器均已停止。镜像保留；未执行 prune。Git push、网站部署、公开下载 URL 的最终核查及 GitHub Release 创建均未执行；任务 8.4 保持待确认。
