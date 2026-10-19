# 修订后 Linux 统一启动补验

2026-10-19，对通配监听加实际 IP、Agent 发行默认值不可手填及 Compose 零业务 env 的修订要求完成本地补验。[前轮验收](unified-startup-acceptance.md)及 Service Cookie 原型保留原候选身份与实际结果。

## 候选与制品

- Commit：`7aa5f944fc2a56850a667de3b60fa26c8e4d378b`，dirty=true。
- 源码输入 SHA256：`0220bff219a31d63f3cc127ace6705f0caa701f65fef928f74cef7545b21acbd`。
- Release ID：`0.0.7-7aa5f944fc2a-0220bff219a3-dirty`；状态为本地 candidate。
- Desktop 输入 SHA256：`9fd518b160ca4b9938280fa2c38a3410081e96bb3c634daadd971bf5d18e08e9`；Console 输入 SHA256：`bd1b18342af97b31312e654ad6e633f29817cfbc9a9d60311a053ce446ba3201`。
- 原生程序 SHA256：`2b47623d7d3b7c6bef5c7e5860f951a86e4afaf4fe7cc39184548c7a123056d1`；本轮归档 SHA256：`38f07cdb8bd24a7a8d93a5a78ccdee54aaec2ce7189031eaf4446a0bcb9488c4`。

下表为本地 image ID。私有测试 registry 的传输用于冷安装夹具，未公开推送；这些 ID 不作为公共 registry digest。

| 角色 | Image ID |
| --- | --- |
| core | `sha256:a5c12dc00c958614eb2e36af4ba4a8d6b9e7c41194dca5078575e0a80d5f5109` |
| cli | `sha256:83fdb8ebbfe3909458a78d4a30bc1be3ca281ab615fdd991a66ba4ae02ef4cb1` |
| agent | `sha256:60fd55aa2cfca30d459d49a815d5368f759de0fe8df4c19b356c18426860b8cc` |
| fileHelper | `sha256:b61a9848c87eada97747bba359041a43f99f26b4ca2455e49930656a0b490931` |
| snapshotHelper | `sha256:8bf17fbfdbbe414e8d68d277ed1d4fea8c2c98225cb4e085a5720cc4a6ccc9d6` |

collect 核对实际程序版本、双 UI 摘要、依赖引用、helper/Agent 协议及镜像运行边界通过；原生打包验证静态程序与实际内嵌发行引用。推送入口只运行 --check，本地/远端标签身份预检通过，未执行公开 push 或官网发布。上一候选的二进制、原始验收及归档副本保留。

## 通配监听与四条初始化路径

三个独立 rootful Docker Engine 28.5.2 从零镜像、独立空数据开始；服务端运行在各自 Linux 网络命名空间，Chrome/Edge 客户端运行在另一容器网络命名空间。主站默认监听 0.0.0.0:7171，浏览器通过服务端实际非回环 IP 访问，不预填 public-origin，不使用入口 TCP 转接、客户端代理、DNS、hosts 或域名。可选 ADMIN 安装使用独立数据与端口 7173，另配 RPC 7174，与零 env Compose 安装保持分离。

| 入口 | 初始化方式 | Work ID | 首条真实模型 Run ID |
| --- | --- | --- | --- |
| 默认 Docker run | 零业务 env，网页创建首管理员 | `work-1b539059-220d-43b4-b132-67629260cb25` | `run-87d0d2e8-15fa-4aaf-b414-528bdfd06fe2` |
| 默认 Compose | 零业务 env，网页创建首管理员 | `work-fd037115-9bfe-40e4-abf1-a5ba4395d6ec` | `run-1a82fdda-3a94-4096-8a0e-94cfb44c7f80` |
| 原生发行程序 | 零业务 env，网页创建首管理员 | `work-d5839054-fa54-4107-82dd-bf38c899404a` | `run-35251100-c33a-4c3c-8cab-fea90307abba` |
| 独立 ADMIN 测试安装 | 仅可选 ADMIN 两项；模型走网页 | `work-d32781d5-0e1f-4ede-be1c-ed5312419a01` | `run-6add8961-d983-41ca-9826-729324c4498c` |

四条路径均通过网页保存私有 .env.test 中的 DeepSeek Flash 连接、保存 CoreRuntime、准备依赖、创建就绪 Work并取得真实首回复（各 9 bytes）。保存未触发付费 Test 或预建 Work。Files 条件写入返回 201、冲突返回 412，读回内容一致；浏览器存储未包含密码或模型 Key。Docker run 与 Compose 各有独立的零 env 网页创建首管理员记录，ADMIN 记录单独验证。

ADMIN 安装已从实际容器配置核对仅有 PIWORK_ADMIN_ACCOUNT/PIWORK_ADMIN_PASSWORD 两项业务 env，未发出首次设置证明；其模型仍来自网页。共享 smoke 驱动的首条日志标签沿用了“网页创建”文案，独立审计记录纠正该标签，保留原日志。

## Agent 发行绑定与失败恢复

- 统一启动不接受 --agent-image 覆盖。引导、Runtime 管理、旧 /runtime 深链接及 Default Work 页面没有 Agent 镜像输入、选择器或高级覆盖，已有镜像信息只读显示。
- 浏览器 runtime 保存只提交 modelRef；可信服务端从当前 Core 的内嵌发行元数据取得 Agent 引用，再调用既有 runtime API。原生和容器保存结果均与本候选 images.agent 一致；独立 Console 通过受保护的 Core 读取接口取得默认值。
- 契约测试覆盖浏览器篡改镜像、Default Work 的 baseImage 绕过及缺失/无效内嵌引用：安全拒绝，不改变已保存 runtime、不出现手填恢复入口。既有低层 operator/CLI 契约保留。
- Docker 冷安装经隔离 registry 故障夹具阻断默认 Agent 拉取，实际观察 IMAGE_UNAVAILABLE 与重试状态；解除故障后自动准备成功，模型数量保持一个，随后取得真实首回复。没有更换 Agent 引用或重复创建模型。
- 引导与管理页测试覆盖丢响应读回、刷新/重启、旧准备结果、后续配置及不隐式修改已有 Work。

## 完整工作台与关闭恢复

- Linux Chrome 155.0.8059.84、Edge 155.0.4283.62 的实际 IP Service 检查通过：根路径、同名响应 Cookie 分区、应用 Basic/Bearer、应用 401、SSE、WebSocket、DOM/storage/平台 API 边界。HTTP IP Service Worker 不可用、脚本 Cookie 串用与上游排除按首版已确认限制记录。
- Service 撤销耗时 Chrome 268ms、Edge 261ms；预览与应用窗口保持登录、草稿、原 iframe（0 次重载）及 opener 隔离，X-Frame-Options: DENY 保留并正确回退到独立页。
- Chat 设置读取、真实图片拾取/移除无 Run 副作用；AGENTS.md Save 保持 active，ZIP 包上传/准备后显式 Apply 生效。图片步骤不代表真实模型视觉理解验收。
- Stop/Export/Inspect/Import/Start 通过，583 MiB 归档下载大小与 SHA256 校验一致；快照 `snapshot-058a3670-9366-44cf-a65e-749f4866a004`，导入 Work `work-0de924ba-ee2c-48d5-8e22-ccace1d1312c` 保持 stopped，显式 Start 后恢复文件与原 Run 历史，没有再次发消息。
- Docker 正常退出 30930ms、exit=0；删除并按默认命令重建 Core 后，installation `installation-5d09ebf4a3b9c8f02b55b99bc13235de`、Work ID、原 Run、4 个持久卷及 stopped/running 意图保留。Core 的持久 bearer 保留其原语义；旧托管浏览器会话要求普通登录。两个用户/管理员的 Work 元数据与内容权限边界通过。
- 当前浏览器注销 13ms、账号禁用 10ms 断开所属内容流；独立登录保留，Work 继续运行，重新启用后可读取原 Run。
- 原生与 Compose 均正常关闭，受管容器停止、持久卷保留；ADMIN 安装关闭未影响同 Engine 的 Compose 安装。最终 Docker 关闭 29790ms、exit=0。三个验收 Engine、registry 和镜像转接进程全部停止，数据及 Engine 卷保留，原有运行容器保持不变。

## 检查及实际边界

- make generate：223 schemas、7250 TS oracle fixtures。npm ci、make test（含完整 build、Go/TS 单元与契约、85 项脚本测试及类型检查）通过。
- Desktop 浏览器：850 项，849 pass、0 fail、1 项既有五分钟 ticket 实时等待场景 skip。Console：76 pass；引导与首次 Runtime 的 6 个场景全部通过。
- app/webapp/consoleapp race 检查通过；Linux/Windows amd64 CLI 构建通过；原生边界、仓库文档、Quick Start/官网副本、OpenSpec strict 与 diff 格式检查通过。
- 本轮远程证据为隔离网络命名空间中的实际 IP。公网、物理远端主机、实际 IPv6 网络、Windows OS 原生/浏览器和公开 registry 匿名拉取未执行；IPv6 URL/来源保留单元覆盖，公共发布单独按发行授权处理。HTTPS/受信代理的前轮事实保留，本轮实际入口补验使用 HTTP。
- 首轮应用窗口驱动仍按旧 281xx 端口定位 iframe，改为实际 iframe 后两浏览器重测通过；图片驱动提前引用尚未导入的 Work，导入后重测通过。重建驱动曾误将持久 Core bearer 当作临时浏览器会话，并在后续读回时遇到共享会话文件已被正常登录更新；改用实际 Docker 生命周期事件、只读状态和独立浏览器记录完成核对，未重复停启或业务写入。这些失败尝试及原日志保留在忽略目录。

临时驱动、日志、合成故障开关与原始结果位于 dist/unify-linux-startup/revision/。账号秘密、模型 Key、setup 证明、会话 Cookie、Core token、私钥、Core 数据及原始 .work 归档仅留私有忽略目录，本文只记录非敏感身份、对象及结论。

## 归档前补充

核验后按所有者要求，将管理首页仍提示配置 Agent 镜像的文案改为选择模型、保存 runtime 并确认 readiness，同步内嵌资源；Console UI、Go 构建及 diff 格式检查通过。该文案修正后的源码与开发构建不等同于上文候选输入；已记录候选、镜像、原生发行包和真实模型/浏览器验收均保留原身份，没有将旧制品或验收改写为修正文案后的新候选。

同步主规格时补齐 SUI-CFG-003 的增量：Default Work 的 Agent 镜像只读，网页不可通过 baseImage 覆盖。此项对应已经实现并验证的网页限制，保留原有 Skills、packages 和 AGENTS.md 编辑与场景，不引入新的实现范围。Windows 等未执行边界及首版脚本 Cookie 限制继续保留。

## 2026-10-19 提交前候选重建

最后的首页提示修正使旧候选输入与当前源码不同，Quick Start 检查按约拒绝旧摘要。随后从当前实际输入重新构建五种镜像及原生包，生成新的本地候选 `0.0.7-7aa5f944fc2a-ee65124bec72-dirty`；构建时 commit 仍为 `7aa5f944fc2a56850a667de3b60fa26c8e4d378b`，dirty=true。后续 Git 提交不回写此构建身份。

- 源码输入 SHA256：`ee65124bec72081db71d08343d949a55568897d0edd369796ab4eab426ab8ff2`。
- Desktop 输入 SHA256：`9fd518b160ca4b9938280fa2c38a3410081e96bb3c634daadd971bf5d18e08e9`；Console 输入 SHA256：`259e6cc5f9b6464d9f1d280b560e51305679cac143ceb700ce971592f8f4ab8a`。
- 原生程序 SHA256：`bca023c3cccc82ca0133a6188c09f297ce4ada068c78b04c92eb0e00fd473c7b`；原生归档 SHA256：`eb0596ba3c1263389545b831ed833b3d0ee31104b40aa166a23d0fe214f2a2e1`。

| 角色 | 新候选本地 Image ID |
| --- | --- |
| core | `sha256:83c4fb32b07e07dec08b5d2a1f9ae1f47cfea89f25e2fe5a4bffc2e85fcf247e` |
| cli | `sha256:f6b65f7abf38ff7e8a6261becb04c614a5c6ee0657bf8324bbea7656177422a2` |
| agent | `sha256:b2394437f069c3a6e41461b2c96fe09af7122a8295cc7d6543eff8a7d03113b1` |
| fileHelper | `sha256:d1e92ea6ffeb045aa1c49d24d563fc51bcc09f7756832d0254829fd8a47e1e94` |
| snapshotHelper | `sha256:74e442c394fcd770ec4ea247c6c26cd16c023c16989f9a73cd864f36b2632356` |

本轮 `make test`（完整构建、Go/TS 单元与契约、85 项脚本测试及类型检查）和 Console 浏览器 76 项通过。实际镜像/程序版本、双 UI、内嵌依赖、协议与运行边界经 collect 核对，原生打包核验静态程序及实际内嵌引用；Quick Start、官网可审阅副本和仅检查模式的发布预检通过。已同步双语安装材料及当前候选指针，原 published 记录和先前候选制品保持原身份。

使用新候选原生发行程序再次执行 6 个网页引导/首次 Runtime 浏览器场景，全部通过且无跳过，覆盖默认通配监听/IP、ADMIN 可选初始化、丢响应读回、重启以及 `/admin/runtime`、旧 `/runtime` 的发行 Agent 自动绑定。该检查使用明确缺失的 Engine 夹具和合成模型输入，未发送真实模型请求，不代表新候选 Docker 生命周期实测。

本次仅修正文案后的构建与回归，不将上方四条真实模型、远程浏览器和 Docker 生命周期验收转记为新候选实测；这些事实仍属于各自原候选。构建中曾遇包索引下载停滞，转用现有构建网络/代理配置后通过；官网同步首轮参数误用已修正。日志与实际新候选材料保存在忽略的 `dist/commit-unified-startup/`，未公开推送镜像或发布官网。
