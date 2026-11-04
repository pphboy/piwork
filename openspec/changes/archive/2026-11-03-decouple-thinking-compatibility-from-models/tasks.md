# Tasks

## 1. 新版目录契约与能力协商

- [x] 1.1 在 `packages/contracts/src/chat-controls.ts` 增加 chat contract 5，允许已知模型同时携带 SDK 档位和协议兼容方式，保留 v1–v4 的严格结构及现有 profile 字段；同步本项所需生成物并扩展 TS／Go 契约样本。验证：`make generate`、contracts 单元测试和 `go test -mod=readonly ./internal/contracts` 通过，覆盖已知／未知／仅 Off、默认独自可用、旧 v4 样本及非法组合。
- [x] 1.2 扩展 Agent Readiness、Go Agent client、Core 聊天控制路由及相关响应校验识别 v5，保持强制 readiness 与取消／图片／历史能力独立；同时更新能力测试。验证：Agent application、Agent client 与 Core 相关定向测试通过，旧 0–4 和未知未来版本按原边界处理，无 profile 字段丢弃或版本误识别。用户明确同意暂时跳过基线上同样失败的日志并发用例；Core 全量测试未通过，失败事实见下方记录。

## 2. 协议兼容策略、保存与真实执行

- [x] 2.1 修改 `thinking-profiles.ts` 与 `run-models.ts`，按实际连接 API 为所有准入模型发布同一组固定 profile，移除 SDK 未知及仅保留旧 profile 的限制；生产目录包含兼容能力时稳定返回 v5，不因全已知或仅默认可用而丢失。同步策略／目录测试。验证：两种协议的已知、未知、SDK 仅 Off 及不同别名得到相同协议兼容集合，SDK 能力事实不变，不支持协议及非法等级仍拒绝；Agent 对应单元测试通过。
- [x] 2.2 将 Session 设置保存、模型专用旧入口、chat-options 读取、Run 受理及停止后发送二次准入统一按 SDK／显式兼容路径校验，兼容路径不以 SDK 档位查询作为前提；保留原子三元组、旧写省略字段拒绝及显式清除规则。同步 sessions／runs／cancel-and-send 测试。验证：新 Session 对已知及仅 Off 模型首次保存兼容设置成功，同协议重新确认成功，跨协议及无 profile 越界等级原子拒绝，保存受理交错和同键重放保持原快照。
- [x] 2.3 在 `pi-sdk-executor.ts` 确保显式 profile 在 SDK 初始化前取得完整等级映射，并跳过冲突的模型专用 Thinking 改写；保留 SDK 模式的原模型映射和其他 payload 校验。同步真实 SDK 合成网关测试。验证：固定 Pi 0.86.1 下两种协议的已知／未知／仅 Off 模型实际请求与现有三种 profile 一致，Responses XHigh／Max 不夹限，Messages adaptive／budget、Off、预算不足和工具续轮符合定义，DeepSeek 原映射与兼容映射分别正确。
- [x] 2.4 扩展相邻失败和持久化回归，覆盖新增已知模型兼容设置被服务拒绝、重启后读取与继续、自动 Run 不继承手动 profile。验证：Agent 与相关 work-store 测试检查原 Run 安全失败、设置和输入保留、无变参自动重发、非法组合未外发、SDK／Normal 默认行为不变；不新增 SQL schema、profile 版本或依赖升级。

## 3. 现有 Thinking 入口及交互恢复

- [x] 3.1 扩展 Desktop 模型／能力类型和版本读取，在现有选择器合并后端声明的 SDK 及协议等级为单一选项列表，移除 unknown 分支及单 Off 对兼容入口的限制，按普通等级显示并保留内部映射；同时增加浏览器模块用例。验证：`compatible-thinking.test.ts` 与相关 `recovery.test.ts` 用例覆盖 v5 已知／未知／仅 Off、默认独自可用及 Messages 两种方式，未硬编码协议等级或增加管理员步骤。
- [x] 3.2 核对 `adapter.ts` 的选择、可发送判断、串行自动保存与读回，完整比较 modelRef、thinkingLevel、thinkingProfile；新增同等级旧方式保留、新 Session 首次选择和跨模型确认回归。验证：同级已有 profile 保留且不重复 PATCH，不同等级使用确定映射，结果未知禁发且只读核对，快速选择与跨 Session 晚响应不覆盖当前对象或草稿。
- [x] 3.3 更新必要的中英文短说明及旧 Agent 提示，并补充 v3／v4／v5 界面行为用例，复用既有语言测试入口。验证：v3 保留普通／SDK 聊天，v4 保留目录已声明的未知模型兼容功能，缺少新能力时准确指向更新 Work Agent 与 Apply；没有要求更新 SDK 模型目录、伪造选项、丢字段保存或自动升级，`node scripts/check-ui-language.mjs` 与受影响浏览器测试通过。

## 4. 跨组件集成与验收

- [x] 4.1 构建变更涉及的 harness、WebUI、Go Core/CLI 及独立测试 Agent 镜像，核对生成契约与 Go 嵌入资源同步。验证：`make build`、相关 Go／TS 检查及 `node scripts/check-native-boundary.mjs` 通过，SDK 依赖与锁文件未因本变更升级。
- [x] 4.2 扩展并运行 `internal/coreapp/model_providers_integration_test.go` 的隔离安装／合成网关场景，贯通 v5 目录、首次兼容保存、真实 SDK 执行和原 Session 续聊；复用 `TestNativeMultiProviderLifecycleThinkingAndPackageRoundTrip` 及相关场景验证重启和 stopped 完整包冷导入。验证：按 Makefile 配置本次精确测试镜像运行对应 integration 测试通过，实际地址／凭据不混用，profile／等级及已受理事实往返保持，拒绝后无换方式重发，不操作线上 Work 或其他安装。
- [x] 4.3 按用户要求使用本机 Playwright 与 Chromium 在独立安装完成 smoke、Thinking 模块及本变更验收；覆盖已知／未知／仅 Off、SDK 与兼容同等级切换、服务拒绝后的原设置恢复，以及旧 Agent 原能力。验证：1920×1080、390×844 和规格要求的 360px 下选项、等级名称、关闭／键盘和草稿连续性可用，真实请求与 UI 选择一致；临时截图放 `/tmp`，其他临时输出放忽略的 `dist/`，必要验收事实仅归属本变更。
- [x] 4.4 核对实现与三份 delta、生成物和验收范围一致。验证：`openspec validate decouple-thinking-compatibility-from-models --strict`、`node scripts/check-repository-docs.mjs` 和 `git diff --check` 通过，按实际结果更新任务及本变更必要证据，明确未测项；不自动同步主规格、归档、修改发行身份或发布。

验证事实：Thinking 相关契约、Agent、浏览器及独立 Core/Agent 实际请求与快照测试通过；Core 全量测试中的 `TestLogExportDownloadConcurrencyLimit` 在未修改的 HEAD 基线同样失败，用户决定暂时跳过该用例。额外执行的 `TestNativeChatModelSelectionRunsThroughGoAndRealSDK` 期望忙碌状态 429，实际返回现行 `WORK_BUSY` 409，未将该无关用例计为通过。


## 5. 用户追加的实际页面交付

- [x] 5.1 以当前运行 Core 的源码版本为基底，在隔离候选中合入 Thinking 修复并保持已有界面及生命周期改动；构建同版 Core/Agent 并验证合并后的关键功能，保留原二进制、安装数据和目标 Work 受管备份。验证：候选 build、相关协议与 Agent 检查通过，镜像可由非 root 运行；备份可核验，候选不覆盖主工作区未提交改动。
- [x] 5.2 将候选用于用户指定的本机开发入口，按原受管流程更新并 Apply 目标 Work Agent，在原会话验证兼容选项、原子保存及刷新持久化，核对其他 Work 恢复原运行意图。验证：实际页面及接口声明 chat contract 5，两种协议的选项不再受 SDK 收录限制，原 Session/历史保持；恢复现场和回退材料保留，未进行外部发布。

实际页面交付：以现场运行版本 e8fe7a6 为基底隔离合入修复，Core 和生产 Agent 已用于用户指定的本机开发实例；目标 Agent 从 chat contract 3 更新至 5。浏览器验证未知／已知模型均能选择协议兼容档位、保存并刷新读回，验证后恢复原会话偏好；原 Session 保留，其他 Work 恢复 Ready。原二进制、安装数据及该安装全部四个受管卷备份已校验并保留于本机忽略目录，未做外部发布。


## 6. 用户纠正：单份正常等级列表

- [x] 6.1 修订三份 delta 和设计，加入由后端已有目录生成唯一等级的纯模块，明确 SDK／协议映射优先级及旧偏好保留。验证：已知、未知、仅 Off、两种协议及旧目录的选项等级唯一，同等级已有 profile 不被改写。
- [x] 6.2 设置选择器、摘要和 Run 详情改为普通等级名称，不再展示 Compatible、Adaptive、Budget、预算或能力未确认注释；写入使用同一归一策略。验证：adapter／模块测试覆盖同等级无重复保存、切换模型、保存及旧 profile 读回，typecheck 和相关浏览器用例通过。
- [x] 6.3 构建嵌入资源，以本机 Playwright／Chromium 验证 1920、390、360px 和中英文下每个等级只有一项；检查真实请求映射未因显示调整而改变。验证：相关协议、Agent 与浏览器测试通过，不重复升级 SDK／Agent 或改历史语义。
- [x] 6.4 更新用户当前本机入口并验证原 Session 的选项去重、保存与刷新持久化，保留回退二进制及其他工作区修改。验证：实际页面没有重复等级及兼容标记，用户数据和原会话偏好保留；OpenSpec、文档边界与 diff 检查通过。

单份等级交付验证：17 项模块／设置测试、16 项浏览器测试及 Run 详情专项通过；真实浏览器经 Core 和 Agent 的两协议请求与快照往返集成通过。指定本机页面在 1920／390／360px 下显示唯一等级，未知模型为 Normal 加七档，已知模型七档；无兼容模式说明，保存、刷新、同级不重复写和旧映射保留已验证，原偏好恢复。Core 页面资源已更新，Agent／历史格式未再次变化。


## 7. 验证 WARN 修复

- [x] 7.1 同等级选择只在完整设置有效时跳过保存；旧偏好不可用、缺少映射或原方式不匹配时，同等级确认必须采用当前有效映射并原子保存。验证：adapter 与浏览器回归覆盖未知／SDK 已知旧 High、失效 profile 的同级修复，保留合法旧方式及保存中的同值不重复写行为。
- [x] 7.2 将遗留的强制合并摘要／双行面板与界面预算声明修订为最终等级语义，保留所在工作台的既有布局。验证：三份 delta 和设计无矛盾的预算显示或布局要求，OpenSpec 严格校验通过。
- [x] 7.3 运行相关 typecheck、模块与浏览器验证，重建嵌入资源，并更新用户当前本机 Core 页面；保留原设置、会话与回退二进制，不更换 Agent 或迁移历史。验证：同等级修复回归通过、实际入口等级唯一、两 Work 恢复 Ready，文档边界及 diff 检查通过。

WARN 收口：不可用的未知／SDK 已知旧 High 及不匹配 profile 的同级选择在修复前均复现不保存，修复后连同保存中重复选择回归通过。21 项模块／设置和 18 项浏览器用例通过；规格去除了强制合并布局及界面预算声明。以现场 6960e55 加当前模型 Test 修改隔离构建并更新本机 Core，实际加载代码的合成旧偏好验证从不可发送恢复可发送且仅一次写入；真实会话偏好未修改，两 Work 为 Ready。Agent 和历史格式保持原状。
