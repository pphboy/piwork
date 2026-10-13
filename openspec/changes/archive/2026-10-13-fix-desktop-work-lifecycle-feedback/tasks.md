# Tasks

## 1. 生命周期模型与一致呈现

- [x] 1.1 在 Desktop 模型与状态映射中加入 Preparing、Core controlVersion、对象确认时间及读取错误，保留完整 desired/observed 事实和 deleted 移除语义；验证：增加状态用例覆盖 provisioning、未知值、降级、停止失败及确认时间与连接检查时间分离，执行 Desktop typecheck。（DWUI-016、017）
- [x] 1.2 统一生命周期类型识别及 Work→原 Operation 关联，覆盖 Create 接受、已有 Work 控制、known-operations 恢复与按 ID 查询；处理 localRecordSaved=false 的原 ID 复制及恢复限制；验证：受控用例断言英文/规范类型、多历史操作、缺失对象时原 ID 可查、重载后关联正确、本地记录失败仍保留 acceptance，均无新增 POST。（DWUI-018）
- [x] 1.3 实现列表行、身份栏、状态页与 Operation 详情共用的状态/目标/快捷动作投影；Stop accepted 后限制新运行及文件写入入口，确认恢复后重新核验当前面板能力和原选择；验证：浏览器逐步推进 Creating→Preparing→Starting→Ready、Stop accepted→Stopping→Stopped、Start→Ready，覆盖 Failed/degraded、准备期间 Stop、Export 准入、字段拒绝保留输入，断言两处状态和按钮一致且无整页刷新。（DWUI-016 全部场景）
- [x] 1.4 在 `docs/webui-integration.md` 补充 Work 状态、接受目标、快捷动作及能力恢复对照，引用 DWUI-016/018 和 DUL-003/008；验证：每个实际 UI 状态都有对应动作、结果依据与恢复方向，确认没有将接受写成终态或把历史成功当作当前目标。（DWUI-016、018）

## 2. 原操作观察与终态刷新恢复

- [x] 2.1 将 Operation 查询结果处理与 Work/列表同步义务集中到 adapter，同步义务独立于操作终态；接入自动轮询、手动检查、恢复、接受后读取及当前面板五秒检查，活跃对象两秒更新；验证：浏览器留在列表仍看到中间状态，手动先查终态仍同步，终态后第一次 Work/列表读回失败再恢复也能更新按钮，POST 各一次。（DWUI-017、018）
- [x] 2.2 为生命周期元数据 GET 落实十秒截止、最多四次暂时失败尝试及一/二/五秒退避、四并发与同 ID 在途合并；区分 Operation 读取、对象同步、列表错误及 404/410；验证：受控时间/网络用例覆盖慢 A 不阻塞 B、耗尽暂停、显式 GET 恢复、成功空列表与失败保留旧行、Delete 对象缺失、所有业务写入不被重试。（DWUI-017）
- [x] 2.3 实现隐藏/显示、返回列表、详情关闭、Pause/Resume 和身份切换的观察资源管理，保留同身份原 ID；验证：浏览器用例断言隐藏后无周期请求、可见后读取原对象、主动 Pause 只经 Resume 恢复、旧身份计时器/读取被释放，Close/Back 不发取消或第二次生命周期 POST。（DWUI-017、018）
- [x] 2.4 将列表及对象状态更新统一经过身份、读取序号、本地接受意图代次和 controlVersion 的合并规则，防止旧快照插回已删除条目或丢弃新创建条目；验证：固定 Start→Stop 后旧 GET/旧 Operation 晚返回的顺序，覆盖另一客户端更高版本、旧列表成员、导航/身份变化和原未知锁，断言新目标与草稿/锁保留、历史查询不错误解锁。（DWUI-018 全部场景）
- [x] 2.5 在交付文档记录只读观察频率、截止/退避、暂停含义、同步失败恢复及已知操作范围；验证：说明与实际测试请求序列一致，明确终态不等于对象刷新成功、只有已知 ID 可恢复、无全局当前 Operation 推断。（DWUI-017、018）

## 3. 清理状态条并保留必要反馈

- [x] 3.1 为 ActionState 的可见反馈增加读取等待、短确认、持久错误/未知、生命周期进展的分类，保持对象锁与协调记录独立；移除正常读取的 Checked/Confirmed/原始 ISO 完成条；验证：状态测试确认提示到期不解除未知锁、不丢原业务 ID、不取消执行，正常读成功无永久反馈。（DWUI-019）
- [x] 3.2 接入按钮/表单/列表行/模块的就地等待与 aria 状态，手动 Refresh/Check 和确认保存的单次提示三秒消失；合并已有错误/进度，生命周期进展由 Work 与原操作承接；验证：延迟请求首帧有动作/目标，快速请求不人为延迟，十秒等待如实表示，保存后刷新失败保留事实和恢复入口，背景读取无 toast 或重复播报。（DWUI-019、既有 DWUI-011/012）
- [x] 3.3 扩充并调整 Desktop 反馈浏览器断言，以对象结果及动作验证替代永久状态条依赖；验证：根→apps→子目录→根及 Services/Chat 切换无成功条堆积，未变化检查提示三秒内消失，错误/未知恢复仍可达；1440px/360px 与键盘检查无溢出、焦点丢失，正常状态刷新保持 Service iframe 输入及编辑草稿。（DWUI-019 全部场景）
- [x] 3.4 更新交付文档中的反馈说明与测试矩阵，列明短提示、持久异常和技术详情的角色；验证：对应每个 DWUI-019 场景的验收入口，不以隐藏 CSS、截图或静态编译代替交互结果。（DWUI-019）

## 4. 真实生命周期验收与执行边界

- [x] 4.1 改造 `apps/desktop-webui/test/real-core.mjs` 的创建/停止/启动主路径，使 UI 自行到达确认状态；补充本测试 Work 的 enabled/disabled Service 与 workspace 哨兵数据，以及可丢弃 Work 的 Delete 路径；验证：脚本断言原 ID、两处状态/按钮、无主路径 page.reload 补偿、每次显式生命周期请求仅一次，保留现有导入导出及认证验收语义。（DWUI-016、017、018）
- [x] 4.2 在独立端口、Core 数据目录、CLI 凭证路径及 installation 下运行桌面 Chrome 的真实 Go Core/CLI/Docker 验收；验证：Create→Ready→Stop→Stopped→Start→Ready 完成，Stop 后按归属核对 agent/service/helper 无运行资源，Service/Run/文件新请求被拒绝，Start 后启用 Service 恢复、禁用项仍禁用、哨兵文件字节保留；Delete 原 ID 到终态且列表移除，清理仅限本次 installation。（DWUI-016—018）
- [x] 4.3 使用桌面 Edge 执行同一真实主路径验收；验证：记录实际浏览器版本和 UI/Operation/容器/文件结果，主路径无整页重载补偿，后台失败交错仍用受控测试验证；浏览器或镜像不可用时明确保留未完成门禁，不计为通过。（DWUI-016—019）
- [x] 4.4 在 `docs/webui-integration.md` 记录本次真实及受控测试证据，含命令、浏览器版本、日志/截图、请求次数、installation 清理范围和所有剩余限制；验证：四项新增需求及 24 个场景各有可追溯证据，真实停启核对独立于 UI 文案；发现 Core 执行不符时记录诊断并停止对应门禁。（DWUI-016—019）

## 5. 构建与变更范围集成门禁

- [x] 5.1 执行 Desktop typecheck/build 同步 Go embed，再运行 `make build-go`；验证：`internal/desktopassets/static/` 与对应浏览器构建逐文件一致，CLI 仍可作为独立 Go 二进制提供页面；没有 ServeUI 产物、Core API 或持久化格式的额外变更。（DWUI-016—019）
- [x] 5.2 按文件串行运行完整 Desktop 浏览器回归，并运行相关 Go CLI/client/embed 测试；验证：认证恢复、未知修改防重复、Service iframe、文件条件写入、传输恢复及 Save/Apply 语义保持，新增生命周期/反馈用例通过；明确列出任何跳过项及对应独立证据，不将旧测试通过当作本次结果。（DWUI-016—019；既有 DWUI-001、006、007、010—015）
- [x] 5.3 执行 `openspec validate fix-desktop-work-lifecycle-feedback --strict`，核对四项需求/24 个场景与全部任务、实际测试记录及构建交付的一致性；验证：strict 通过，主路径无需整页刷新，规划和实现范围无偏移，未通过的真实执行或恢复门禁不得勾选完成。（DWUI-016—019）

## 6. Verify 后两项 WARNING 的增量修复

第 1—5 节保留首轮已完成的实施及 24 个场景验收记录；本节承接后续 verify 已复现的两个边界缺口。修订后的 Spec 共四项需求、25 个场景，最新整体完成状态以本节增量修复及重新验收为准。

- [x] 6.1 修复清空已完成历史后丢失终态依据的状态收敛：待同步记录独立保留原 Operation ID、已确认终态及所属接受代次，状态投影和同步收尾不依赖可见历史条目；匹配的 Work/列表确认后解除对应接受意图并释放协调记录。验证：在 adapter 及反馈浏览器测试覆盖 Start succeeded→Work/列表读回失败→Clear local records→读回 Ready，断言状态与使用入口自动恢复、原 ID 可查、原 Start POST 仅一次，无整页刷新；同时覆盖清理期间新的 Stop、旧结果晚到及未知锁，不错误解除新目标保护。（DWUI-016、017 新增清空历史场景、018）
- [x] 6.2 将元数据观察改为按对象独立派发和完成调度，移除整轮 Promise 完成及全局轮询锁对其他对象的后续检查阻塞；复用四并发、同 ID 去重、十秒截止、一/二/五秒退避和四次失败耗尽规则。验证：在 adapter 受控时间测试及真实浏览器受控响应中让 A 持续挂起跨多个观察周期，断言 B 多次按两秒活跃频率检查并显示最新状态，不等待 A 返回/超时，不以直接调用单个 MetadataReads 代替整体调度测试；回归隐藏、Pause/Resume、身份切换、队列释放、公平调度及五秒面板检查不绕过暂停，所有生命周期 POST 次数不增加。（DWUI-017 收紧慢查询场景、018）
- [x] 6.3 对增量修复重新执行 Desktop typecheck/build、逐文件 Go embed 对比、make build-go、完整 Desktop 按文件串行回归及相关 Go CLI/client/embed 测试，再运行 Chrome/Edge 的隔离真实生命周期验收；更新 docs/webui-integration.md 的四项需求/25 个场景追溯及本轮命令、日志、浏览器版本、请求次数、清理范围和跳过项证据，最后执行 openspec strict 并核对所有 Tasks。验证：两条新增/收紧交错均有通过证据，认证、未知修改防重复、Service iframe、文件条件写入、配置 Save/Apply 和真实停启/导入导出保持；主路径无整页刷新补偿，未通过门禁不得勾选，测试不重启或清理用户 tmux 环境。（DWUI-016—019）
