# Tasks

## 1. 契约与版本化兼容定义

- [x] 1.1 在 `packages/contracts/src/chat-controls.ts`、`work-feedback.ts` 增加 contract 4、兼容 profile、目录选项及 Session/Run 投影，保留旧 reader；增加 schema 用例验证请求中省略、显式 null、字符串方式的区别和 null 档位/profile 互斥、非法档位/方式拒绝、旧缺省解释与公开字段不泄密，通过 contracts 单元测试。
- [x] 1.2 在 Agent 新增集中兼容策略，定义 Responses effort、Messages adaptive/budget 的档位和固定预算；单元测试覆盖三种方式、跨协议拒绝、未知默认 Normal、已知模型保持、SDK 后续收录时旧 profile 延续，并断言预算档位不同且留有正文空间。
- [x] 1.3 更新 `proto/agent.proto`、Agent `application.ts`、Go Agent client/Core DTO 转发及能力协商；执行 `make generate`，补跨语言往返和新旧契约测试，验证 profile 不丢失、旧 Agent 拒绝新设置且基础聊天可用，并确保省略、显式 null 和字符串端到端不丢失。

## 2. 会话、受理与实际模型执行

- [x] 2.1 将 `run-models.ts`、`sessions.ts` 的目录和保存校验接入集中策略，完整偏好包括 profile；扩展 `run-models.test.ts` 和 Session 测试，验证 model-only 入口保留设置、协议不匹配原子拒绝、已知模式与未知普通模式回归。
- [x] 2.2 修改 `runs.ts` 的手动受理、Cancel and send 二次准入和快照处理，保留自动 Run 原默认规则；用 Run 测试验证保存/受理交错捕获完整组、同键重放不重解析、偏好修改不改变已受理 Run、旧请求不会静默清除兼容方式。
- [x] 2.3 在 `pi-sdk-executor.ts` 初始化前生成兼容 SDK 定义、映射及预算选项，最终 payload 与工具续轮核对受理配置；扩展真实 SDK 网关测试，对三个 profile 的全部档位断言准确请求体，覆盖 XHigh/Max 不夹限、Off/null 区分、预算空间不足外发前失败及已知模型/DeepSeek 回归。
- [x] 2.4 保持兼容执行设置与管理员授权模型描述分离，核对 `AgentRunModels.credential()`、Core 凭据绑定及临时模型定义；以合成凭据测试原协议/ID/端点与 Key 不混用、轮换正常、停用仍拒绝且 profile 不导致凭据匹配失败。
- [x] 2.5 在既有供应商错误清洗层与 Run 错误投影提供兼容请求拒绝的安全恢复信息；模拟 400/422、401/403、网络错误，验证不泄露响应/Key、不将所有错误断言为推理不支持、不自动变参重试，原偏好及 Run 失败可查。运行相关 Agent 单元测试。

## 3. 历史、快照与恢复

- [x] 3.0 阶段性实现（最终升级路径由 6.2 的 4/5/6→7 替代）：实现精确 schema 5→6 升级，仅显式 Apply 时先备份 work.sqlite 和 memory.sqlite，经受管 helper 校验后事务升级版本，幂等重试及失败恢复；当时 schema 4 经既有 4→5 再升级，旧镜像降级拒绝。用独立安装的合成升级、失败恢复、重启和降级测试验证。

- [x] 3.1 同步 work-history 语义版本、work-store 与 Go history 的严格字段校验及生成产物；为旧 Off、null、新 profile、非法 profile 增加持久往返/重启用例，通过相关 work-store、contracts、workhistory 测试，证明旧记录不被回填。
- [x] 3.2 修改 `internal/workhistory/rebuild_linux.go` 及 snapshothelper 对模型重绑定的保留/校验逻辑；运行合成完整快照导出导入测试，验证目标唯一匹配及目标 Key 使用、profile/档位保留、不匹配明确不可用、旧版本拒绝未知语义且导入不执行 Run。

## 4. 聊天设置与中英文交互

- [x] 4.1 扩展 `models.ts`、`adapter.ts` 的完整选择、等同性判断、发送准入、串行保存和只读核对，使 profile 一并恢复；补 adapter 用例覆盖同档位不同方式、响应丢失、快速选择、跨 Session 晚响应、无 Session 草稿及旧契约门禁。
- [x] 4.2 在 `app.ts` 的现有 Response settings / `/thinking` 中提供协议兼容分组和后端档位，Messages 预算显示 token 数，摘要及历史区分兼容来源；同步 `i18n/app.js` 中英文，用浏览器测试验证浏览不保存、明确选择保存完整设置、关闭不撤销、拒绝后可回设置且不自动发送。
- [x] 4.3 扩展现有聊天浏览器验收，覆盖两种语言、360px/桌面、键盘焦点、命令草稿、未知结果核对及新旧 Agent；运行 Desktop 构建与 `npm run test:browser -w @piwork/desktop-webui` 和相关 Playwright/`chat-controls-real-core.mjs` 入口，核对托管及独立 Desktop 行为，截图等临时输出放 `dist/`。

## 5. 集成与交付一致性

5.4/5.5 保留各阶段实际执行的修复与验收事实，其中原 context 隔离和默认切到 Session 2 的处理已由第 6 节替代；它们不表示当前 schema 7 的续聊规则或完成标准。

- [x] 5.1 扩展 `internal/coreapp/model_providers_integration_test.go` 的真实 Core/Agent 合成网关链路：未知 Responses、未知 Messages adaptive/budget、非品牌别名及 `opus-5-5` 别名分别保存、执行、重开并读历史；运行相关 integration 测试，记录实际请求映射、拒绝后恢复、自动默认与快照往返结果，不使用生产凭据或把合成通过当作远端型号支持证明。
- [x] 5.2 同步契约生成产物及 Desktop 的 Go 嵌入资源，运行 `make build`、相关 Go/TS 测试和 `node scripts/check-native-boundary.mjs`；确认宿主资源与同版 Agent 行为一致。Docker 测试使用独立数据目录和精确安装标签清理，不执行发行推送。
- [x] 5.3 执行 `openspec validate support-compatible-thinking --strict`、`node scripts/check-repository-docs.mjs`、`git diff --check`，对照各 Scenario 检查已验证和未验证事实；必要验收附件只归本变更，确认没有业务范围外的文档、SDK 升级或发布材料变更。
- [x] 5.4 修复真实 Responses 工具调用 ID 含 `|` 时历史误报 `HISTORY_CORRUPT`：将供应商调用 ID 按有界不透明字符串读取，保留内部对象 ID 校验；覆盖调用/结果配对、双向分页、重新读取、原 SDK 文件不变及 TS/Go 契约，并在独立预览安装验证原会话可读。修复前新增两项用例均失败，修复后相关历史测试 29/29、contracts 全套 49/49 通过；Go contracts/agentclient 通过。预览原会话 HTTP 200、7 个块、2 组调用/结果，SDK 文件哈希不变且原 Run 数未增加；浏览器历史请求 200，无历史错误和页面异常。运行镜像更新后按原 context 隔离规则保留旧会话为可读历史；已准备保留相同 High 兼容设置的 Session 2，浏览器验证输入后发送按钮可用，未发起模型请求。

- [x] 5.5 修复刷新默认选中不可继续会话：只读核对当前发送资格，首次进入先核对默认用户会话，不可继续时选择最近可继续的用户会话，明确选择的历史会话保持；失效环境或设置提供准确说明与切换/新建入口，不将历史投影当作发送资格，不自动创建或发送。覆盖刷新、只读历史、无可继续项和旧 Agent，更新预览并验证两个原会话不变。 验证：相关浏览器回归 39/39、最终定向回归 5/5、adapter 11/11；Desktop 构建及 Core 嵌入资源重建、语言/文档/边界检查通过。17892 真实页面首次进入与刷新均选 Session 2，草稿发送按钮可用，旧会话历史及恢复入口可读；会话数仍为 2、Run 数仍为 1、原历史 SHA-256 不变，未调用模型。

## 6. 消除会话与运行环境的永久绑定

- [x] 6.1 将 Session 限定为 Work 内持续对话，移除创建环境绑定；新 Run 在受理时捕获当前 active context，保留重放优先、代次及单槽门禁。同步图片中断输入恢复和设置准入，不引入镜像兼容分支。
- [x] 6.2 history schema 7 去掉 Session active_context_identity；通过既有备份/Apply 授权将 4/5/6 一次升级到 7，同步 TS/Go 静态读取、重绑定、生成产物和镜像声明；旧 Run 的 context、历史、幂等与 Memory 引用不改写。
- [x] 6.3 验证同一 Session 跨环境继续、旧 Run 快照、图片恢复、取消后发送、当前资源/工具限制及跨 Work 拒绝；验证升级失败恢复、重启、完整包导入后同一 Session 可继续。执行相关 TS/Go 与浏览器回归。
- [x] 6.4 构建并更新独立预览，验证原 Session 1 的真实发送链路，保留原历史与两个会话，不以新建或切换 Session 代替；核验 Spec、生成物、嵌入资源和数据保护事实后完成。
- [x] 6.5 修复规划产物的一致性 WARN：统一 proposal、design、tasks 及相关 delta specs 的 schema 7 写入、4/5/6 静态读取与受管升级、Session/Run 环境语义；保留并标注阶段性验收事实。对照现行源码核对 Requirement/Scenario，执行严格 Spec 校验、文档检查和差异检查，确认没有改变实现、运行数据或主规格。

6.x 验证事实：schema 7 已移除 Session 环境列；work-store 67 项、Agent 164 项、相关浏览器 18 项及 contracts 测试通过。真实 Core/Agent 链路验证同一 Session 跨 Apply 使用新 AGENTS/工具禁用策略、重启及完整包导出导入后继续，并核对旧提交重放零模型调用；schema 6→7 备份恢复与 schema 7 冷历史重绑定通过。make build、镜像边界、源码边界、文档及 Spec 检查通过。独立预览沿受管 Apply 从 6 升至 7，升级前后两个 Session ID、原 Run 行、SDK 文件、偏好与 Memory 哈希一致。原 Session 1 实际发送一次只回复 OK 的检查消息并 succeeded，确认新 Run 采用当前环境、旧 Run 不变、原历史前缀保留；页面刷新选回 Session 1、回复可见且输入草稿后 Send 可用。
Go 全包验证中仅 internal/app 因另一安装占用固定 7172 而失败；仅对测试二进制应用临时端口 overlay 后 internal/app 全套通过，其余 Go 包通过，未停止其他安装或修改产品默认端口。

6.5 验证事实：本次仅修订本变更内 8 份规划产物，原 17 个 Requirement/标识符及 127 个 Scenario 名称全部保留。对照当前 schema SQL、TS 迁移与 Run 受理、Go 静态 reader 核对后，已清除现行 schema 6、仅改版本号升级和排除 schema 7 导入的矛盾描述。严格 Spec 校验、仓库文档检查与差异检查通过；本次未修改运行实现、用户数据或主规格，未重新执行模型请求，前述业务验收事实保持其原执行范围。
