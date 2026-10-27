# Tasks

## 1. 安全检查与既有身份读取

- [x] 1.1 在 `internal/internaltls` 实现不创建/修复目录的代次凭证检查，区分首次未发布、相同、正常变化与真实错误，保留同代次写入不可变约束；新增合成凭证单元测试覆盖 CR/LF 规范化、空值/NUL/超限、符号链接、权限、缺失及不产生写入，执行 `go test -mod=readonly ./internal/internaltls` 验证。
- [x] 1.2 为接管提供读取并校验现有有效 generation TLS 身份的通路，接入 `internal/agentclient`，不通过会发布/轮换挂载证书的方法连接原 Agent；新增身份、过期/损坏拒绝及挂载材料不变的测试，执行 `go test -mod=readonly ./internal/internaltls ./internal/agentclient` 验证。

## 2. 持久启动绑定、切换目标及恢复预算

- [x] 2.1 在既有控制元数据事务中实现版本化的启动绑定和在途切换记录，保存精确 context/image、控制版本、源/目标身份、私有 secret 引用和发布事实；新增 reopen、未知事务结果读回和启动期间再次轮换测试，验证同一启动仍使用同一绑定、无 Key 明文进入记录或公共投影，执行相关 `internal/corestore`/`internal/coreapp` 单元测试。
- [x] 2.2 实现 prepared、旧实例移除后登记目标、启动完成终结的幂等推进；目标登记时原子移交预算并关闭源重试，失败只更新实际当前恢复目标；新增事务边界故障、due 队列、跨代次 1/5/15 秒退避、耗尽及显式 Retry/稳定 ready 重置测试，执行 `go test -mod=readonly ./internal/corestore ./internal/coreapp` 验证。
- [x] 2.3 实现现行旧代次无新绑定时的按需判断，依据实际安全材料和发布/资源事实区分首次启动与异常缺失，不从旧 runtime profile 猜测实际 Key；补充旧代次 Key 相同/不同、已发布材料丢失及已有绑定与材料不符的测试，以不改写 context、不批量迁移、不忽略损坏为通过条件。

## 3. 统一接管、启动与切代协调

- [x] 3.1 分离 captured context 校验与当前启动凭证解析，在 `workruntime` 增加已有运行实例接管分支并复用完整容器/挂载、mTLS 和 readiness 验证；接管不改写启动材料，不提前降级既有 ready 身份；通过单元/契约测试及定向 Docker 测试验证容器 ID、代次、材料内容/发布次数不变，且错误身份和不完整握手仍拒绝。
- [x] 3.2 在单一每 Work 加锁协调入口接入普通 Start、Retry、Core 启动恢复、定时恢复及 `file_lifecycle.go` 的清理后恢复；凭证相同复用，差异按持久目标切代；更新所有失败写回调用方，新增各入口及交错调用测试，验证无重复锁、无重复切代、不记录到旧代次，执行相关 Go 单元测试。
- [x] 3.3 复用/抽取精确旧实例停止证明、日志归档、移除意图和删除确认；将保留目标及迟到实例纳入 Stop/Delete/Apply superseded 和快照/文件/临时任务栅栏收尾；新增假 Docker/故障注入测试，验证旧实例状态未知时不启动、后接受 Stop 不被迟到 ready 覆盖、pending desired 不被隐式应用，并执行相关生命周期测试。
- [x] 3.4 将实际代次启动绑定作为 `log_archive.go` 的补充脱敏输入，保留原配置敏感上下文和无法证明时的缺口语义；扩展日志归档单元测试及替换集成场景，使用两种合成 Key 验证旧/新实例日志正确脱敏、归档失败仍有界继续收尾，不输出秘密或原始私有路径。

## 4. 合成模型与 Core 进程集成验收

- [x] 4.1 扩展现有 `nativeModelGateway` 的合成认证能力，支持轮换后拒绝旧 Key，并新增 `TestNativeCredential*` 停止/Start 场景；用真实 Agent/Pi SDK 验证 Key A 执行、停止、轮换 B、恢复新代次、新 Run 使用 B、原历史和镜像/context/卷保持，包含无新绑定的现行旧代次及凭证相同复用对照；执行该定向 integration 测试且确认未跳过。
- [x] 4.2 扩展进程恢复 fixture，以真实 Core 的 SIGKILL/重启验证运行中轮换后接管同一容器；保持一个已外发的 Run 跨 Core 断开继续，确认不重发、后续 Run 使用新 Key、模型停用仍拒绝新执行；另验证优雅重启只恢复 desired-running Work，执行对应 `TestNativeCredential*` 进程 integration 测试且确认未跳过。
- [x] 4.3 增加切换目标持久化、旧容器移除及新容器创建后的可控故障/进程断点，并覆盖启动期间 B 再轮换 C；恢复后核对同一目标身份、至多一个有效 Agent、原绑定材料不变、新 Run 使用 C、已有历史无重放，执行定向 integration 测试验证。
- [x] 4.4 增加恢复与 Stop/Delete/Apply、快照/文件收尾交错及预算耗尽的跨组件场景，验证当前目标优先、未知旧实例阻塞、旧代次不再 due、轮换/重启不重置预算、显式 Retry 后恢复；扫描公开 Operation、历史、事件及日志不含两种合成 Key，执行定向 integration 测试验证。

## 5. 集成回归与交付核对

- [x] 5.1 执行 `make test-go`，以及 `npm run test:unit -w @piwork/agentd` 核对既有每 Run 固定绑定、SDK 凭证与子代理回归；根据现有构建入口准备 fixture/镜像和 Core 后，以 integration tag 回归原 Core crash adoption、模型认证轮换、Apply/rollback、日志和文件恢复场景，确保实际执行而非因环境变量缺失跳过。临时输出仅放 `dist/`，准确记录未测限制。
- [x] 5.2 执行 `node scripts/check-native-boundary.mjs`、`node scripts/check-repository-docs.mjs`、`git diff --check` 和 `openspec validate fix-work-resume-after-credential-rotation --strict`；核对差异只含本变更的实现/测试及所属规划，无真实凭证、磁盘副本、公共协议或未经授权发布材料；在本变更内同步实际完成项与必要验收事实。

## 验证事实

- `make test-go` 通过；按仓库入口构建 harness 后，在 Node 24 执行 Agent 单元测试，158 项通过、无跳过。
- 使用本机 Docker 和指定的 Agent、file-helper、snapshot-helper 测试镜像，实际执行凭证轮换、运行中 Core 进程崩溃接管、切换断点、定时恢复及文件清理、Stop/Delete/Apply 交错、重试预算、日志归档、Apply 回滚和快照迟到 helper 回归；测试数据均为合成值。
- 完成过程中发现并修复停止状态 Apply 的初始化容器已移除后重用日志身份的问题；对应原有 Apply 和文件恢复集成测试复测通过。

## 6. 核验警告修复

- [x] 6.1 接管运行中的 Agent 前核验已有代次绑定与实际凭证材料一致；以合成凭证覆盖运行实例材料被替换的情况。
- [x] 6.2 将恢复失败的控制版本校验、当前目标选择、预算及 Work 状态写回放入同一事务；覆盖被后接受控制操作取代的失败。
- [x] 6.3 在真实 Core 进程切换边界注入 Docker 请求阻塞，分别于旧实例删除前、删除后及目标创建后发送 SIGKILL；重启后验证固定目标、无重复 Agent 与历史请求重放，使用最新凭证执行新 Run。

使用合成凭证完成三处 SIGKILL、B 到 C 再次轮换，以及运行中材料篡改后重启拒绝接管的真实进程测试；恢复失败写回的控制版本回归和材料篡改检查通过。

- [x] 6.4 将同一 Work 的恢复尝试与失败写回纳入同一锁边界；使用受控交错测试验证失败写回完成前后一次恢复不能进入，并核对成功后的状态及预算。
- [x] 6.5 将显式 Start/Retry 的结果发布纳入同一 Work 锁，覆盖失败发布与同版本恢复成功交错；保留 Operation 的真实失败事实，后续恢复成功后 Work 保持 ready。

Start/Retry 受控交错测试及恢复失败相关 race 检查通过；CoreApp、CoreStore 完整单测通过。真实 Docker 验证 Start 失败后并发恢复使用轮换后的凭证执行新 Run，以及 Stop/Delete/Apply 交错和初次启动失败后 Retry，均实际执行且通过。原生边界、文档归属、差异格式和 OpenSpec 严格校验通过。
