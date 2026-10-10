# 模型直接配置增量验收

日期：2026-10-09。对应当前 proposal/design/specs 与 tasks 第 10 节。第 1–9 节及旧报告保留历史事实，不作为本轮完成证据。

## 实现与需求对应

| 需求 | 当前实现与验收 |
| --- | --- |
| AIM-001/002、CADM-MODEL-001 | 新增平铺 ModelConfig/Create/Patch DTO，POST models 单次事务发布完整模型；模型自身持有连接与凭据版本，GET 不含 Provider/能力 JSON/Key。`model_config_test.go` 验证同 ID 多配置、独立 Key/启停、等价 URL、拒绝旧字段、写入回退。 |
| AIM-001 旧数据、AIM-004 | registry 版本 2 按模型保存独立连接；Core 初始化不依赖 Runtime 已配置，自动兼容版本 1。迁移保留 id/ref/有效状态/旧定义；无子模型 Provider 不生成模型。夹具覆盖失败不落盘、实际 Core 重启、重复迁移、兄弟模型独立修改及停用不复活；原删除依赖与固定授权回归保留。 |
| AIM-003、SUI-MODEL-001 | 单表单只需 Model ID/API/Base URL/Key，显示名可选；草稿 Test 与 modelId 编辑覆盖均使用当前表单，Modal 显示真实回复与安全错误。两协议真实 Core 测试和浏览器错误/草稿/晚到/身份边界测试通过。标题栏操作与 All models 返回保持统一。 |
| AIM-005、SUI-CFG-002、CADM-004/005 | Runtime 按有效启用和 Key 选择，未确认 Thinking 不过滤；禁用或缺 Key 的条目有不可选原因。默认调整保留其他字段，不自动改变已有 Work。浏览器实测未知 ID 保存即能进入选择器，无 Provider 或能力模板步骤。 |
| AIM-006、CONV-MODEL-001、runnable-work-runtime | 共用 SDK 解析精确复用已知定义；无定义的明确 Responses/Messages 原 ID 使用内部基础适配。旧私有模板错误仍拒绝，不静默套用。Thinking unknown 与基本执行分开，Chat 3 表达空 levels/null；普通请求不带未确认参数，已知 Off/high 的真实请求映射保留。 |
| CONV-MODEL-001、WCFG-MODEL-001 | Session/Run 严格区分旧缺省 Off 与新 null，私有 proto 有明确未请求标志，公开投影保留 null。旧非空偏好不静默清除，显式 Normal 才原子保存；自动 Run 使用默认普通模式，不继承 Chat High。Desktop 通过对应浏览器场景。 |
| PWORK-MODEL-001 | Go/TS/history/helper 校验接受新 null 并继续拒绝未知字段/秘密。真实两安装包往返同时保留已知 High 和未知普通会话，目标使用自己的 Key；导入保持 stopped、无历史重放，继续及再次导出通过。 |

## 实际检查

| 范围 | 结果/证据 |
| --- | --- |
| 生成 | `make generate`，204 个 Go DTO schemas、6674 个 TS oracle fixtures；新增 Session/Run 私有 proto 标志及 Chat 3。 |
| Go | `CGO_ENABLED=0 go test ./...` 全部通过；启动迁移新增回归另行通过。 |
| TS | contracts/work-store 单测通过；Agent 单测 93/93；全部 workspace typecheck 通过。 |
| Console | 完整浏览器 72/72；后续布局、字段恢复与未知模型选择专项 4/4、2/2。真实 Go Core/Console 消息 Test 1/1，覆盖两协议、已保存 Key 和远端失败后保存。 |
| Desktop | 228 项通过，1 项已有五分钟票据长时测试跳过；新增 unknown 可选、保留 High、显式 Normal/null 完整设置场景通过。该跳过不计模型功能证据。 |
| 实际 SDK URL | `TestNativeModelURLNormalizationAndErrorRecovery` 通过（53.32s）。 |
| 完整界面与包 | `TestNativeMultiProviderLifecycleThinkingAndPackageRoundTrip` 通过（312.13s），含真实 Console 添加三个未收录 ID 配置、草稿 Test、Desktop 在同 Session 切换两协议与同 ID 另一连接，实际 SDK 回复；另含未知普通会话跨安装/再导出与已知 Thinking 回归。 |
| 在途与重启 | `TestNativeManagedModelEditsInflightReplayAndRestart` 最终通过（79.44s）。旧夹具提交已移除的能力 JSON 被新 API 正确拒绝后，改为新单模型编辑与显式 Normal 场景重跑；无保留例外。 |
| 未知默认 | `TestNativeFlatUnknownDefaultAndDuplicateModelConnections` 通过（224.77s）：四条同 ID 配置分别作为默认，两个协议/独立 Key、自动初始化普通 Session、真实 SDK 请求与公开 null 一致。 |
| 构建/边界 | 两 WebUI 嵌入资源、Go 宿主、production/acceptance Agent、file/snapshot helper 构建通过。原 image boundary 脚本仅在忽略目录副本替换本轮精确镜像引用，全部原断言保留并通过；源码 native boundary 通过。 |
| 规格/格式 | OpenSpec strict validation、`git diff --check` 通过；当前 60/60 任务完成。完整批次中的旧模板夹具失败已在新契约下修正，重跑相关用例通过；不将失败批次整体记为通过。 |

所有模型请求使用受控本地服务、合成 Key 和临时 CA，保持 TLS 验证。第一次误用 production 镜像运行 deterministic 测试夹具被拒绝，补建 acceptance 后重新执行；该失败不作为产品功能证据。新模型路径实际使用原协议/ID/端点，Test 不是保存、启用或选择门槛。

验收日志保留在忽略目录 `dist/model-direct-evidence/`；截图在 `dist/model-browser-evidence/`。这些目录不提交 Git。本轮 10 个测试安装的 containers/networks/volumes 核对均为 0；测试安装仅按精确 installation 标签清理，无全局 prune、对外推送或归档。

## 本机部署

已更新 tmux 12:0 的 Core、Console、Desktop，保持一个 window/四个 pane；原用户 shell 保留。只在桌面 pane 退出时于该 window 补回 split，未创建 window。迁移前保存私有完整备份，登录凭据保持原值。真实浏览器已确认新平铺表单、原有模型列表、360px 布局和 Runtime 可选项；没有对用户模型发送收费请求或写 Runtime 默认。

数据核对：registry 版本 2、原有 1 条模型及启用状态保留。手动测试使用本轮 production Agent 镜像 `piwork-agentd:models-direct-20261009`；已存在 Work 的旧固定镜像需所有者显式升级并 Apply。registry 2/nullable 历史不供旧二进制回读，回退需升级前私有数据备份。

## 上轮复验结论（最新结果见 verify-report.md）

当前 15 项需求、68 个 Scenario 已按实现与对应测试逐项核对：完整性、正确性、一致性通过，CRITICAL 0、WARNING 0、SUGGESTION 0。本轮新增 10.1–10.8 全部完成，整体 60/60。唯一已有五分钟票据测试按原开关跳过，属于范围外长时认证检查，不替代任何模型场景；旧镜像需显式升级与 registry 回退边界已在用户文档说明。

本轮未归档、未提交或推送，也未执行发布。用户本机部署完成且私有迁移备份保留。

### 本机配置 Runtime 后的就绪修复

用户首次保存 Runtime 后（15:29），本机启动脚本暴露两个部署问题：Core 默认 Agent gRPC 与 Desktop 同占 7172，且全局 umask 077 使内置包输入成为 0700/0600，非 root 包初始化容器无法读取。已将本机 Core Agent gRPC 显式改为独立 7174，并使用容器可达的 Docker bridge 地址；Core 启动使用标准 umask 022，平台自身的私有目录/Key 仍分别为 0700/0600。没有修改用户保存的模型、Key 或 Runtime 选择，没有调用用户模型。

修复后 `/readyz?profile=docker-delivery` 实际返回 HTTP 200 / READY，docker、agent、packageHelper、fileHelper、snapshotHelper、defaultContext 全为 ready；真实 Console Runtime 页面确认 “Core is ready for new Work”。仍为 tmux 12:0 单 window 四 pane，原数据及登录凭据保留。本节补充首次保存后真实就绪事实，先前的健康/未配置页面检查不能替代它。


## 用户回归修复与最新复验

刷新后取消入口、忙状态分类、未修改新会话建议值及创建/丢失受理完整设置对已经修复并重新交付。Desktop 最新完整批次 234 通过、1 项已有范围外长时测试跳过；Core/CLI 单测和真实 Core→Agent Cancel/并发/重放集成通过。Windows 实际 17891 资源与最终 build.json、SHA256/UI hash 一致；Core 在没有 active Run 时安全更新，READY 已确认。用户授权的 Python 服务国内源/缓存调整另列为运维事实，不扩大模型 change 范围。

最新 openspec-verify-change 发现 W1 名称 128/256 契约边界及 S1 捕获型号展示建议，详见 verify-report.md。此前零问题结论仅是其当时检查范围，本轮不再声称零 WARNING。


## 第 11 节 W1/S1 修复验收

本轮统一了 256 字符新名称契约、旧 128 字符兼容显示投影和 Unicode 表单校验，并在 Work default 菜单/响应设置/输入区域显示真实捕获 Model ID。第 11 节六项均已完成，整体 66/66。新增长名称/Core 重启与兼容读取、真实 Console/Go Core、改名后捕获型号与 360px 无写入回归通过。

最新完整 Desktop 为 235 通过/1 项原有范围外长时测试跳过；Console 完整 74 项及 Unicode/字段反馈追加 2 项通过。构建、Windows 17891 实例实际资源、Core idle 后部署及 READY 已核对。最新 openspec-verify-change 结论为 CRITICAL/WARNING/SUGGESTION 均为 0，以上旧发现保留其历史事实；详细映射见 verify-report.md 顶部。
