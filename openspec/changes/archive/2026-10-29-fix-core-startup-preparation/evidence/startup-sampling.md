# 启动采样与当前证据

本附件属于 `fix-core-startup-preparation`。所有结果使用独立测试安装和合成账号；原始样本及日志放在被忽略的 `dist/`。任何一次失败、超时或中断均保留在对应组中，不用后续运行替换。

## 当前 v9 制品复验与 WARN 关闭

本轮已将包含锁顺序与访问记录合并修复的 v9 Core 集成到新的 MicroVM 本地制品，并在 Windows WHPX 2 vCPU / 4 GiB 的原独立测试安装实际运行。所有者认为重复整套基准偏重，明确选择“按已有结果收尾”；据此保留前轮完整性能基线，以本轮实际完成的 Core 20 次及整 VM 7 次作定向复验，不追加重复启动。

| 当前候选分组 | 已完成 / 运行失败 | 实测结果 | 判定范围 |
| --- | --- | --- | --- |
| Windows Core 正常重启 | 20 / 0 | P50 3.173 秒，P95 3.529 秒，max 3.548 秒 | 当前 Core 组通过 10 秒完整基准 |
| Windows 整 VM 启动 | 7 / 0 | min 10.961 秒，max 18.924 秒 | 所有者批准的当前制品增量回归通过；未重跑完整 20 次 P95 基准 |

7 次整 VM 完成并正常关闭后，第 8 次在启动前按所有者要求被控制器阻止；没有第 8 个 VM 启动、launcher 记录或性能样本。原驱动因该主动停止返回非零，`dist/windows-v9-vm-group-failure.json` 与 `dist/startup-v9-windows-vm-group.log` 原样保留，不将停止伪装为原 20 次计划已完成，也不记为已经启动的 VM 运行失败。`dist/windows-v9-vm-plan.json` 的原 20 次计划保持不变。公开采样工具汇总的 `dist/windows-v9-vm-samples.json` 为 count=7、failures=0、passed=false，忠实表达其未满足完整基准数量；当前增量回归的通过判定单独保存。原基准阈值、采样工具和旧样本均未修改。

当前冻结 Core 候选为 `dist/startup-candidate-v9/candidate.json`，输入 SHA256 `b80ba818315cf1a4df43dcd4160697c7849018692d606f4b02a2bf228073740d`，Core SHA256 `bc897ae5b8a36499451cd28f2b26d5c7aed6bbc444f40647ebabec817537167b`。新 MicroVM 本地包为 `dist/microvm-startup-candidate-v3/piwork-microvm-startup-candidate.exe`，SHA256 `6e6c64207fb934f676add826cb28adda23de118e58ae79698add2e531ac8af02`；新包复制到 Windows 独立测试根的 `piwork-candidate-v9.exe`，未替换旧包。构建、Guest 文件逐项核对、载荷 manifest 校验与制品输入见 `dist/startup-v9-microvm-build.log`、该目录的 `development-candidate.json`、`acceptance-candidate.json`。MicroVM 主程序源码输入指纹仍为 `74cee85de66742d91784817a6ec0ccf6b5522cd770220da136efa44d545530ee`，没有性能机制修改或对外发布。

`dist/windows-v9-runtime-inspection.json` 从实际 Core 进程 `/proc/<pid>/exe` 计算文件 SHA256，匹配上述 v9；同时核对 package helper 使用 0.0.16、保存的默认使用 0.0.15、原 Work 使用 0.0.14 三个不同 Agent 镜像 ID。公开 API/UI 的独立夹具确认原 Work 捕获选择、运行意图和 Service 保持。本轮每个完成样本均同时确认 UI 后端、当前 Agent、同源 Service 预期响应及完整 ready，逐次零完整导出、零扫描、零环境探测，并有三版本 Agent、file/snapshot、环境持久命中及当前 Work 核验证据。

Core 组原始单次记录、共同结束点、完整计数和新 boot 日志为 `dist/windows-v9-core-sample-01.json` 至 `20.json` 及对应日志/索引，汇总为 `dist/windows-v9-core-samples.json`，执行日志 `dist/startup-v9-windows-core-group-run2.log`。第一次资源预检因打包后可用内存不足退出，没有启动测试 VM 或建立组计划，记录 `dist/startup-v9-windows-core-group.log` 保留；仅释放本轮生成文件的缓存，资源恢复后才开始正式组。整 VM 原始单次记录为 `dist/windows-v9-vm-sample-01.json` 至 `07.json` 及对应日志/索引。

`dist/startup-v9-windows-audit.json` 与 `dist/startup-v9-windows-audit.log` 核对当前源码输入、Core/CLI 字节、Guest/Windows 本地包、实际运行进程及所有 27 个完成样本身份、计数和共同结束点；原始单次与汇总只允许正式工具对组内 attempt 编号作顺序投影。该审计单独记录 owner-approved-incremental-regression，不将 7 次组的完整基准 passed=false 改为 true，并重算前轮绑定结果 hash，确认历史基线及原失败结果未被覆盖。

最终状态 `dist/startup-v9-windows-final-state.json` 确认测试进程/监听均为零、active/runtime/unclean 标记均不存在。Windows 宿主开机时间仍为 `2026-10-29T03:37:47.5000000Z`，与本轮起始及前轮一致，未执行宿主整机重启。此前“新候选尚无匹配 Windows 运行证据”的 WARN 已由实际新包运行和所有者批准的增量复验关闭；前轮的完整基线继续按原制品身份保留。

本轮收尾的 `openspec validate fix-core-startup-preparation --strict`、`git diff --check` 与仓库文档边界检查通过；当前候选源码与文件身份在最终审计中匹配。按所有者要求没有再追加 Go、浏览器或 VM 重复测试，原代码修复的回归/竞态/真实集成证据继续保留。

## 核验后修复与本轮验证范围

所有者明确授权修复核验发现的 CRITICAL 和 WARNING。本轮静态镜像与包环境成功发布改用 `Store.WritePreparationFenced`：先取得唯一数据库写事务，再进入 Engine 身份栅栏，栅栏覆盖 SQL 和提交，消除与 Work Start/Apply 路由发布相反的锁顺序。Work 路由原有控制事务、route epoch 和 Engine 代次校验保持。

持久命中的访问时间由 `TouchPreparations` 在内存按键合并，最多 256 个提示；下一次写事务在淘汰前批量更新，失败时回滚并重新合并，正常关闭在原关闭上下文内刷新。不新增后台任务，命中不取得 SQL 写连接；访问提示不能创建或恢复成功证明。

- `dist/startup-review-old-order-both-paths.log`：临时 overlay 恢复旧锁顺序，实际静态检查与环境探测两条路径均复现约 2 秒阻塞及成功结果保存失败。
- `dist/startup-review-old-touches-regression.log`：临时 overlay 恢复旧同步访问时间写入，两条实际持久命中路径均因等待无关写事务而失败。上述 overlay 仅在忽略目录，不改写生产源码。
- `dist/startup-review-both-paths-final-race.log`：修复后两条路径与 Work 激活并发、后续强制持久命中在写锁被占用时仍可完成，连续五次 race 通过，未重复导出或探测。
- `dist/startup-review-final-touch-race.log`：存储发布先取得写连接、身份拒绝不留记录、栅栏覆盖提交、有界合并、淘汰顺序、失败回滚、正常关闭重开及关闭预算回归连续五次 race 通过。
- `dist/startup-review-full-regression.log`：coreapp/corestore/dockerengine/preparationcache/imagestatic/workruntime/app/webapp/diagnostics 九包回归通过。最终新增的持久命中与关闭预算断言另由上述最终 race 入口验证。`dist/startup-review-race.log` 保留三包相关恢复/身份/准备/关闭回归五次 race 通过。
- `dist/startup-review-real-integration-acceptance.log`：真实 Docker 的默认准备阻塞下 Work/Service 独立可用、停止 Work 快照导出/下载、Core 重启采样的实际 UI/Agent/Service/完整 ready 及日志导出三项集成均通过，无跳过。首轮误将 production Agent 作为确定性模型夹具，三项均在 Agent readiness 前退出，失败日志 `dist/startup-review-real-integration.log` 保留；源码 `apps/agentd/src/application.ts` 明确要求此模型使用 acceptance variant，改用已有 `go-migration-acceptance` 镜像后通过，没有为此修改产品实现或掩盖失败。
- 代码修复轮的 `openspec validate fix-core-startup-preparation --strict`、`git diff --check`、原生平台边界和仓库文档边界检查通过。任务 7.1/7.2 对应代码修复；任务 6.3/6.4/6.6 后续按上节当前 v9 制品复验及所有者确认的增量口径完成，前轮完整 Windows 基线仍独立保留。

代码修复轮构建候选为 `dist/startup-candidate-v9/candidate.json`，输入 SHA256 为 `b80ba818315cf1a4df43dcd4160697c7849018692d606f4b02a2bf228073740d`，Core SHA256 为 `bc897ae5b8a36499451cd28f2b26d5c7aed6bbc444f40647ebabec817537167b`，CLI 字节保持。首次构建时尚未集成 MicroVM；后续匹配新包的实际 Windows 复验见上节。下文 v7/v8 的历史 Windows 成绩保持原身份，不改写为 v9 实测。未执行宿主整机重启或对外发布。

## 前轮冻结候选的 Windows 验收结论（v7/v8）

所有者在查看实际结果后明确接受“25 秒可以接受”，因此整 VM 的验收预算由原 P95 20 秒调整为 25 秒，Core 仍为 P95 10 秒；零失败、每组至少 20 次、完整结束点及零重复重型操作要求保持。原始样本不变，原 20 秒失败判定保留，按新规则生成单独复判文件：

| 组 | 样本数 / 失败数 | P50 | P95 | max | 当前判定 |
| --- | --- | --- | --- | --- | --- |
| Windows 整 VM | 20 / 0 | 15.628 秒 | 22.197 秒 | 23.574 秒 | 通过 25 秒预算 |
| Windows Core 正常重启 | 20 / 0 | 3.080 秒 | 3.316 秒 | 3.353 秒 | 通过 10 秒预算 |

新判定文件分别为 `dist/windows-vm-accepted25-samples.json` 与 `dist/windows-core-accepted25-samples.json`。`dist/core-startup-accepted25-audit.json` 绑定判定工具 SHA256、原始/复判结果 SHA256、实际运行 Core 身份、三个冷路径及失败保留情况，并验证复判与原组的每一个样本、制品和环境字段完全相同；原资源不足的 19 样本组仍不通过，未拿追加样本替换第 15 次失败。所有日常重启样本逐次为零全量导出/扫描和零环境探测，并有三版本 Agent、file/snapshot、环境持久命中及 Work 当前核验。

最终冻结候选为 `dist/startup-candidate-v8/candidate.json`，输入 SHA256 `5dd59e100a7ca6f24447f1b71201e6687cb277152a5926532bd37b508aa3681e`。v8 纳入新的采样预算和边界测试，Core/CLI 实际文件分别与受测 v7、已打包 Guest 完全同字节；Core SHA256 仍为 `a0d3cc24b9c938a1fc0b48e64283963d559ba660667a0e30e632418b3822251e`，CLI 仍为 `c6c49fac3456bc71d2af5f81626f8c6e85bda2204e6f8c304f2651620fa50a2b`。原 MicroVM 本地包及其 v7 输入身份保持，不改写为 v8；审计重算了本地包和 Windows 实际使用副本 SHA256，均为 `420749cfa10cda5adf10f0780799df696b3e745f072b8990931bb744ea96b0a0`。

采样工具在 Linux Node 24 与 Windows Node 24 上各通过 9 个测试，包含 25 秒边界、P95 超界、零失败约束及 Core 10 秒预算保持，记录为 `dist/core-startup-sampler-25s-linux.log` 和 `dist/core-startup-sampler-25s-windows-relative.log`。Windows 对绝对 UNC 测试路径的两次命令失败保留，切换到同一仓库目录后的相对路径执行通过，不影响原性能样本。

冷路径、回退、恢复栅栏、并发及原创建性能证据见下文。整机重启按所有者要求未执行；MicroVM 网络等待保留为已知跨项目观察项，所有者接受 25 秒后本任务不再依赖修改其性能机制。本地候选没有对外发布。

最终核对已逐项检查已有 Go 回归、竞态和真实集成的通过日志：相关九个 Go 包回归见 `dist/core-startup-regression-final.log`，Core 恢复/准入栅栏竞态见 `dist/core-startup-race-final.log`；早期 Engine 失效取消测试的失败及修正后连续 15 次 race 通过分别保留。该聚焦 race 入口对 preparationcache/workruntime 曾显示 `no tests to run`，最终另行执行两包完整 `go test -race` 并通过，见 `dist/core-startup-remaining-package-race-final.log`。WebUI 244 项测试通过及真实浏览器在默认阻塞时访问已恢复 Work 的记录分别为 `dist/core-startup-browser-corrected-suite.log` 与 `dist/core-startup-partial-browser-integration.log`；真实私有记录导出隔离、跨 Work 清理隔离、文件/快照/临时 Service 崩溃恢复和旧版回退/再升级的记录也已核对，失败及对应修正结果均保留。

最终跨官网 Docker 材料一致性检查、30 项部署材料测试、原生平台边界及仓库文档边界检查通过；记录为 `dist/core-startup-quickstart-accepted25.log` 和 `dist/core-startup-quickstart-tests-accepted25.log`，其余检查见相应已有日志与实际检查输出。Windows 最终状态 `dist/core-startup-windows-final-state-accepted25.json` 确认测试进程和测试端口均为零，宿主开机时间仍为 `2026-10-29T03:37:47.5000000Z`，与初始记录一致；测试未执行整机重启。MicroVM 产品源码没有性能改动，仅保留本地候选和忽略目录中的测试驱动。

## 采样准备

在与其他安装隔离的机器上，构建待测 Core，并准备三个不同且已验收的固定 Agent 镜像版本，分别对应发行 package helper、当前默认和既有 Work，同时准备 file helper、snapshot helper。需要在独立安装中完成管理员和默认运行环境配置，保留一个期望为 running 的 Work、其已启用的 Service，以及所需的包环境成功记录。Service 的探测响应必须是稳定的合成文本；路径使用实际声明的端口。

先创建空的测试数据目录。标记位于数据目录旁边，不进入 Core 存储：

```sh
node scripts/core-startup-sampling.mjs init --data-dir dist/startup-fixture/core
```

随后仅对该目录初始化测试安装，或将维护者正常停止后复制的独立测试副本放入其中。不要指向正在使用的安装，不要清理其他安装的 Docker 资源。开始采样前正常关闭该测试 Core，并确认测试端口未被占用。`PIWORK_STARTUP_ACCOUNT`、`PIWORK_STARTUP_PASSWORD` 和 `PIWORK_STARTUP_SERVICE_RESPONSE` 从环境提供；结果不会写入这些值。

将下列占位符替换为测试 Work、Service、端口和候选二进制后运行：

```sh
node scripts/core-startup-sampling.mjs sample-core \
  --data-dir dist/startup-fixture/core \
  --core-bin dist/go/piwork-core \
  --ui-port 18891 --core-port 18871 \
  --work WORK_ID --service /services/WORK_ID/SERVICE_ID/SERVICE_PORT/ \
  --agent-image-id sha256:AGENT_IMAGE_ID \
  --default-agent-image-id sha256:DEFAULT_AGENT_IMAGE_ID \
  --work-agent-image-id sha256:WORK_AGENT_IMAGE_ID \
  --file-image-id sha256:FILE_IMAGE_ID --snapshot-image-id sha256:SNAPSHOT_IMAGE_ID \
  --samples 20 --timeout-ms 120000 \
  --output dist/core-startup-samples.json

node scripts/core-startup-sampling.mjs summarize \
  --input dist/core-startup-samples.json
```

脚本只停止自己启动的 Core 进程，启动前检查端口，并记录二进制 SHA256、Git commit/dirty、构建输入 hash、实际 Engine 版本、不可变镜像 ID、平台、逐次耗时、阶段和计数。镜像 ID 使用 `sha256:` 加 64 位十六进制，可从测试 Engine 的 `docker image inspect` 获取；本地采样会核对所提供 ID 当前存在。Windows 参考组必须提供三个不同的 Agent ID，且逐次至少记录三次 Agent 持久命中；仍须独立核对每个 ID 实际对应 package helper、默认及 Work 固定配置，次数本身不能证明命中与镜像的对应关系。缺少制品或环境信息时组判定不会通过，且仍须另行核对它们确实属于待测 Core 制品。样本尚未结束时先落一条 `interrupted`；结果文件不得覆盖。每次从启动进程前的单调时间开始，直到同一轮检查同时确认 UI 后端、当前 Agent 的 Session 查询、同源 Service 的预期响应及 `docker-delivery` 完整 ready。`/healthz` 成功不能结束采样，分阶段首达时间不能相加作为总耗时。统计使用 nearest-rank P50/P95/max；Core 组至少 20 次、零失败、P95 不超过 10 秒，且每次必须有当前 Work 核验及持久命中证据，零全量导出/扫描；启用包环境时还须有环境持久命中且零实际探测。未达到样本数时组判定必然失败。

`--environment none` 只适用于默认配置没有启用包的测试；此时不要求环境命中，但仍要求零实际环境探测。`--group cold` 用于首次安装、新镜像、首次建记录等冷路径；它保留阶段与执行次数，不把这些样本作为 10 秒重启验收，也不承诺冷路径时限。

## Windows 整 VM 外部计时

`observe-vm` 不接管、停止或重启任何 VM。维护者须先准备单独的 Windows WHPX 2 vCPU / 4 GiB 测试实例，提供确认与实际运行 Core 一致的二进制和 bundle SHA256，并为该次新启动创建全新、初始为空的 `dist/` 日志文件。参考组的观察进程须使用 Windows 原生 Node，以便正确记录宿主平台；以下命令使用同样的合成管理员账号环境变量：

```sh
node scripts/core-startup-sampling.mjs observe-vm \
  --ui http://TEST_VM_ADDRESS:17891 \
  --work WORK_ID --service /services/WORK_ID/SERVICE_ID/SERVICE_PORT/ \
  --timeout-ms 120000 \
  --artifact-sha256 CORE_SHA256 --bundle-sha256 BUNDLE_SHA256 \
  --commit CORE_COMMIT --dirty true --source-input-sha256 SOURCE_INPUT_SHA256 \
  --agent-image-id sha256:AGENT_IMAGE_ID \
  --default-agent-image-id sha256:DEFAULT_AGENT_IMAGE_ID \
  --work-agent-image-id sha256:WORK_AGENT_IMAGE_ID \
  --file-image-id sha256:FILE_IMAGE_ID --snapshot-image-id sha256:SNAPSHOT_IMAGE_ID \
  --engine-version DOCKER_VERSION --hypervisor WHPX --vcpu 2 --memory-mib 4096 \
  --metrics-timeout-ms 120000 \
  --log dist/vm-console-01.log --output dist/vm-sample-01.json
```

MicroVM 的串口日志不会直接转发 Core 全部性能事件。可使用测试管理员和公开 Core 日志导出取得证据，无需接管 QGA/QMP。准备阶段在测试 Core 仍运行时记录已有 boot ID；每次观察器输出 `readiness-observed` 后再导出日志，提取恰好一个新 boot 的安全性能事件，写入该次原本为空的日志文件。导出和提取发生在计时结束之后，最长等待由 `--metrics-timeout-ms` 控制：

```sh
node scripts/core-startup-sampling.mjs export-log --core http://TEST_VM_ADDRESS:17871 --output dist/before-01.zip
python3 scripts/core-startup-log-extract.py baseline --archive dist/before-01.zip --index dist/before-01.json
# 正常停止测试实例；启动观察器并完成下面的启动握手。
# 收到 readiness-observed 后执行：
node scripts/core-startup-sampling.mjs export-log --core http://TEST_VM_ADDRESS:17871 --output dist/after-01.zip
python3 scripts/core-startup-log-extract.py extract --archive dist/after-01.zip \
  --baseline dist/before-01.json --index dist/after-01.json --output dist/vm-console-01.log
```

导出器校验下载的长度及 SHA256，提取器核对完整 Core 分片、分片 SHA256 和 boot ID，只保留固定枚举的性能事件；没有新 boot、出现多个新 boot 或 Core 日志不完整均失败。下一次的基线使用上一次的 `after-01.json`，所有归档、索引和观察结果保留在 `dist/`。输出日志始终是每次观察器预先创建的同一文件，不能替换或追加其他启动的内容。

外部测试控制器应启动该观察进程并等待 `ready-for-start`；向其 stdin 写入一行启动信号，等待 `start-recorded` 后立即启动隔离 launcher。观察器的计时点先于 launcher 进程启动，包含已有 bundle 的校验。控制器须在每次采样前正常关闭测试实例；观察器发现 UI 的 `/healthz` 已可用时拒绝开始，不能用它附着或操作现有运行实例。每次使用独立日志及输出文件，至少完成 20 次，保留每次失败。Windows Core 正常重启也可由外部控制器先停测试 Core，再以相同握手调用 `observe-core` 并正常启动 Core；用 `combine-samples` 合并这些 Core 单次结果。所有者已明确禁止重启宿主整机；验收不执行该操作，也不将其作为完成条件。

使用 `combine-vm` 合并同一制品和环境的独立样本，输入以逗号分隔，不允许同一文件或样本重复：

```sh
node scripts/core-startup-sampling.mjs combine-vm \
  --inputs dist/vm-sample-01.json,dist/vm-sample-02.json \
  --output dist/vm-samples.json
```

示例仅显示两个路径；实际验收至少输入 20 个。观察器的 SHA256 参数是控制器提供的制品身份，仍须另行核对 MicroVM 冻结输入和实际运行二进制；仅填写参数不能证明两者一致。

## 执行记录与历史失败

- Linux/WSL 隔离 Docker 测试通过了真实 Work 创建、正常关闭与 Core 重启、Agent Session，以及真实 Service 的 HTTP/SSE/WebSocket 和停止撤销。人为阻塞默认镜像时，真实浏览器可打开已恢复 Work 并访问其 Agent、同源 Service；HTTP/SSE/WebSocket 均可访问，新建默认 Work 返回 `RUNTIME_UNAVAILABLE`。记录为 `dist/core-startup-private-and-gateway-integration.log`。
- 导出集成测试在内部准备记录中写入合成标记，验证 Work API 和完整 `.work` 文件均不包含该标记；容量、保护、淘汰后重建及超限写入也有独立测试。相应真实导出记录见同一集成日志。
- Engine 切换与关闭并发测试曾在 SQLite 1.39.1 上因取消查询后遗留读取锁而失败；该失败保留在 `dist/core-startup-engine-loss-repeated.log`。SQLite 1.40.1 释放已产生的查询结果后，相同测试以 race 检测连续通过 15 次，见 `dist/core-startup-engine-loss-driver-fix.log`；关闭和检查点相关存储测试通过。
- Work 的包清理、Stop/Delete 与后台恢复竞争曾将锁占用误报为失败，失败记录保留在 `dist/core-startup-package-and-browser-final.log`；按 Work 串行领取操作后，真实 Stop/Delete 均通过，见 `dist/core-startup-work-package-fence-corrected.log`。两个真实 Work 中，一方保留未确认的包资源时另一方独立恢复，见 `dist/core-startup-work-isolation-final.log`。
- 进程崩溃恢复验证覆盖凭证切代、保留 Agent 接管、文件写入提交前后及快照捕获/导入的中断；Stop 与初始化中的 Apply 竞争也已通过。首次文件提交前测试在全局 Ready 后过早读取目标 Work 而得到 `WORK_FILES_UNAVAILABLE`，该事实保留于 `dist/core-startup-crash-fences-final.log`；按目标 Work 实际文件可用性等待后，提交前后的原始内容与清理结果均通过，见 `dist/core-startup-file-crash-corrected.log`。
- `TestNativeStartupSamplerUsesRealUIAgentAndService` 使用合成账号和隔离安装完成一次真实重启采样。该次 UI、Agent、Service 和完整 ready 的共同结束时间约 2.75 秒；Agent/file/snapshot 和环境各有持久命中，导出、扫描、实际环境探测均为零。原始结果为 `dist/startup-sampling-piwork-test-e7ab34e1-a480-4042-9173-b26080dd41b2.json`；它只有一次样本，组判定为失败，不能推算 P95。
- 后续源码完成收尾后重跑同一隔离采样，共同结束约 3.09 秒；三类镜像与环境均持久命中，全量导出、扫描和环境探测均为零。原始结果 `dist/startup-sampling-piwork-test-71abe795-6e88-414f-9f9c-2fcb67fa67fc.json` 同样只有一次，组判定仍为失败。
- 默认 Work 创建性能冒烟的首次运行在浏览器阶段失败，原始结果为 `dist/core-startup-work-latency-smoke.json`：Work 已显示 Ready，但采样器仍按旧界面的按钮定位；当前界面实际使用链接。随后首次调整未区分同一行内的多个链接而失败，原始结果为 `dist/core-startup-work-latency-smoke-corrected.json`。采样器已改为按完整 Work 名称定位行并点击其名称链接；两次失败记录保留，不与后续结果合并。
- 调整采样器后三版本判定的真实集成重跑，首次误将 production Agent 用于只存在于测试镜像的确定性模型，Work 启动时 Agent 退出，失败保留于 `dist/core-startup-sampler-three-agent-integration.log`；改用仓库的 `go-migration-acceptance` 夹具后，真实 UI/Agent/Service 重启采样通过，见 `dist/core-startup-sampler-three-agent-fixture-corrected.log`。
- 公开 Core 日志导出与 boot ID 基线提取已用真实隔离 Core 验证，见 `dist/core-startup-sampler-log-export-integration.log`；三 Agent 判定、延迟写入、错误摘要及多 boot 拒绝等测试在 Linux 与 Windows 原生 Node/Python 上通过，记录分别为 `dist/core-startup-sampler-export-final.log`、`dist/core-startup-log-extract-final.log`、`dist/core-startup-sampler-native-windows-tests.log` 和 `dist/core-startup-log-extract-native-windows-test.log`。
- 上述集成测试中的一次真实 Linux Core 重启，共同结束约 2.99 秒，镜像导出、扫描和环境探测均为零；单样本仍不足以判定 P95，原始结果为 `dist/startup-sampling-piwork-test-f9ed7bc0-533b-4006-8968-5991b78d9a17.json`。
- 使用 v6 本地候选、固定的 0.0.16 production Agent 和独立 Linux/WSL Docker 安装，按原 1/3/6 秒参考契约分别测量 20 次 API 创建和 20 次真实浏览器创建，零失败且确认清理。API 受理 P50/P95/max 为 43.15/45.42/47.56 毫秒，受理后 Ready 为 2.158/2.265/2.477 秒；浏览器全过程为 5.081/5.110/5.123 秒。创建热路径重复全量镜像检查和环境探测均为零。原始结果 `dist/core-startup-work-latency-final.json` 包含全部样本、资源条件和源码输入 hash；此结果不是 Windows WHPX 重启验收。
- 首次工具集成测试把 Service 代理路径误写为默认端口别名，实际声明端口为 8099；该次超时原始结果保留在 `dist/startup-sampling-piwork-test-89041d62-b3b7-443d-a51b-6b11c81b3f3f.json`，不能并入修正后的运行冒充成功样本。
- 隔离 Docker-in-Docker 的真实 daemon 正常停止/重启后，身份 scope 保持稳定且连接代次推进；宿主共享 Engine 没有重启。
- 实际回退/再升级测试使用干净的原 Core 源码 `9d9b9d4783f477903a5eb2187c6c1ab1d6b6da6f` 构建旧二进制，SHA256 为 `ccd7d1a7e7bf7969d43f1cee58f19d6a72e243e30bd11f7ca4fbd35d6b402ce9`。在新 Core 已写入派生记录且存在真实 Work、Session 与已完成 Run 的隔离安装上，旧 Core 成功重开并重新完成镜像检查；再次升级后安装身份、登录、活动配置、运行意图及完整 Run 历史保持一致，没有重放 Run。测试入口为 `TestNativePreparationRecordsPermitOldCoreRollbackAndUpgrade`，记录在 `dist/core-startup-rollback-integration.log`。
- 本地未发布的开发候选位于 `dist/startup-candidate-v7/`，清单记录 commit `9d9b9d4783f477903a5eb2187c6c1ab1d6b6da6f`、dirty=true、源码输入 SHA256 `5c2f5d6b3b8063c43559160057d1522d5411a5f2753a3ccadcb2712976e082d5`，Core SHA256 `a0d3cc24b9c938a1fc0b48e64283963d559ba660667a0e30e632418b3822251e`。它显式固定已发布 0.0.16 的 Agent 和 helper 镜像用于隔离测试，不是正式 release 或已发布制品。v7 纳入三版本判定和日志证据工具，Core/CLI 二进制与完成 Linux 性能回归的 v6 完全相同。现有 MicroVM `dist/piwork` 为 0.0.15，其 Core SHA256 `3d437767198459b9fdefbc917b8e284e1d2f11d0d724179c4da2c3a3843d896d`，与候选不同。
- 所有者追加授权后，已在独立目录生成未发布的 Windows CLI 本地验收包 `dist/microvm-startup-candidate-v2/piwork-microvm-startup-candidate.exe`，SHA256 `420749cfa10cda5adf10f0780799df696b3e745f072b8990931bb744ea96b0a0`。复用的 MicroVM 源码 commit、dirty 状态、源码指纹、Guest/QEMU 基础输入及替换后的 Core、CLI、镜像 ID 记录于同目录 `acceptance-candidate.json` 与 `development-candidate.json`。对独立 Guest 副本做 ext4 检查后，从中重新读出 Core、CLI、镜像清单及镜像归档并核对哈希；逐文件验证打包清单，并在 Windows 宿主执行 `--version` 和 MicroVM 原生 bundle 解析器验证清单。该打包阶段本身没有启动 VM，后续实际运行文件核对见下文；上述本地包也不是正式发行制品。
- 最初按所有者安排在当前 Windows 宿主的 `D:\PiworkStartupAcceptance-9b33fec2d4ea` 创建带所有权标记的独立测试目录，并复制验证 MicroVM 0.2.2 / Piwork 0.0.14、MicroVM 0.2.3 / Piwork 0.0.15 与本次候选的启动器。历史 bundle、Guest、Core 和 Agent 身份记录为 `dist/windows-historical-fixture/historical-inputs.json`，可用真实升级构造三个版本；当时 Windows 仍有其他 MicroVM 和工作负载，可用内存及提交额度不足以安全增加 4 GiB 测试机，启动前检查结果为 `dist/core-startup-windows-preflight.log`，该次未启动测试 VM。
- 当前宿主独立测试已完成 0.0.14 → 0.0.15 → 修复候选升级，确认原 Work 与 Service 可用并正常关闭；整 VM 预定 20 次中完成 14 次，第 15 次因启动前内存预检失败而中止，记录见 `dist/core-startup-windows-fixture-run-after-memory.log` 和 `dist/core-startup-windows-vm-samples.log`。前 14 次均有三次 Agent 持久命中且零镜像导出、扫描和环境探测；其中第 1 次 20.994 秒、第 11 次 20.070 秒已超过 20 秒。组样本数不足且存在预检中断，不能宣称 Windows P95 达标，也不能用后续重试替换。第 1 次 UI 首达约 16.846 秒、第 11 次约 15.893 秒，结束分别约 20.994 和 20.070 秒；该事实尚不足以确定具体瓶颈。
- 资源恢复后按原编号继续第 16–20 次，均完成并正常关闭，见 `dist/core-startup-windows-vm-samples-remaining.log`。第 15 次失败仍保留，整组不通过；已完成的 19 次不能作为合格的 20 次连续组。
- 所有者释放宿主资源后，另建预先确定的完整 20 次整 VM 组，保留原失败组，不替换旧样本。新组起始可用物理内存 10088 MiB、剩余提交额度 9737 MiB，记录于 `dist/windows-vm-restored-plan.json`。20 次全部启动成功并正常关闭，但 P50/P95/max 为 15.628/22.197/23.574 秒，P95 未达到 20 秒；逐次均为三次 Agent、file/snapshot 和环境持久命中，重复镜像导出/扫描和环境探测为零。原始组结果为 `dist/windows-vm-restored-samples.json`，过程为 `dist/core-startup-windows-vm-resource-restored.log`。组判定器因 P95 超标返回非零，驱动在合并阶段输出的泛化错误不代表新增一次启动失败；20 个原始结果和失败的组判定均保留。
- Windows 参考宿主为 Windows 11 Home build 26200、AMD Ryzen 9 7945HX（16 核 / 32 逻辑处理器）、约 32 GiB 内存、SAMSUNG MZVL21T0HDLU-00BT7 NVMe；原生 Node 24.14.1、QEMU 10.0.8、Guest Docker 28.5.2，测试 VM 固定 WHPX / 2 vCPU / 4096 MiB。硬件与磁盘采集为 `dist/windows-host-reference-environment.json`，版本和制品输入另见候选清单，未提高 VM 配额。
- 从第 1、2、6、11、12、16、20 次的真实 Core 日志按新 boot ID 抽查：默认上下文准备成功耗时约 84–222 毫秒，Work 核验约 4.06–4.72 秒；第 1 与 11 次 UI 首达分别约 16.85 和 15.89 秒。该抽查支持继续拆分 UI 首达之前的 launcher、VM 与 Docker 阶段，但不能仅凭这些时间确定其中哪一项是瓶颈，也不能把阶段分位数相加。
- 独立诊断启动 `boot-01` 的控制器记录 bundle 校验完成约 2.128 秒、QEMU 创建约 2.152 秒、Core unit active 约 7.250 秒；Guest 单调时钟中 Docker 启动约 2.954 秒、active 约 4.293 秒、Core 启动约 4.563 秒。完整结果为 `dist/windows-diagnostic-boot-01-result.json` 与同前缀 `-controller.log`，正常关闭记录为 `-clean-shutdown.json`。这次较快启动的内核日志也出现 APIC timer verification failure，因此该警告本身不能证明慢样本的根因，仍需 Docker 与 Guest 阶段进一步采样。
- 后续 `boot-02` 至 `boot-04` 在同一自有 VM 控制器中记录到 Docker 自身初始化约 0.86–1.24 秒、网络就绪等待约 1.16–4.00 秒；随后用仅存在于 `dist/` 的 Go overlay，为原 MicroVM `Service` 启动流程增加启动后只读观察，不改生产源码、不附着其他启动器，采集 `boot-05` 至 `boot-07` 的完整启动阶段、systemd 单调时间和安全 DHCP 事件。三个样本均正常关闭，原始结果为 `dist/windows-diagnostic-boot-05-result.json` 至 `-07-result.json`，过程为 `dist/core-startup-windows-full-launcher-diagnostics-05-07.log`；这些诊断不作为新的合格 20 次组。
- 原启动流程的 `boot-06` 中，DHCPv4 在开机 1.579127 秒取得地址，而 `systemd-networkd-wait-online.service` 在 IPv6 link-local 事件 7.146955 秒之后才结束（7.147767 秒）；Docker 受 `After=network-online.target` 阻塞，Core 随后在 9.031861 秒启动。`boot-05` 和 `boot-07` 的 IPv4 分别在 1.441157 / 2.002172 秒取得地址，网络等待分别到 IPv6 link-local 的 3.365748 / 3.785202 秒后才结束。这确定了 MicroVM Guest 网络依赖中的额外串行等待；APIC timer 失败可能加剧计时波动，但没有对照验证，不能将其写成已确认的全部根因。该阶段按原 20 秒预算仍失败，故曾请求追加 MicroVM 修改范围；所有者随后明确接受 25 秒，当前按新预算复判通过，网络等待作为未处理的跨项目观察项保留，未修改 MicroVM 产品代码。
- 宿主资源恢复后，通过自有测试 VM 的控制器读取实际 `/proc/<pidof piwork-core>/exe`，得到 SHA256 `a0d3cc24b9c938a1fc0b48e64283963d559ba660667a0e30e632418b3822251e`，与冻结候选及 Guest 打包内容一致。真实 Docker 核对 0.0.14 / 0.0.15 / 0.0.16 三个 Agent 镜像 ID，并确认当前 Work 容器使用原 0.0.14 镜像；完整身份结果为 `dist/windows-startup-runtime-inspection.json`，过程为 `dist/core-startup-windows-core-group-execution-01.log`。该身份核验完成，不等于 Windows 性能验收完成。
- Windows Core 正常重启已完成预定的 20 次，零失败；P50/P95/max 为 3.080/3.316/3.353 秒，每次 UI、当前 Agent、同源 Service 和完整 ready 均确认可用，三 Agent 及两类 helper 与环境持久命中，镜像导出/扫描及环境探测均为零。原始逐次结果为 `dist/windows-core-samples.json`，过程为 `dist/core-startup-windows-core-group-execution-01.log`；控制器确认测试 VM 正常关闭，后续核对测试控制器和启动器均已退出。
- 三个 Windows 冷路径分别使用 `D:\PiworkStartupCold-9b33fec2d4ea` 下带所有权标记的独立安装，固定 WHPX / 2 vCPU / 4096 MiB，复用已校验的不可变 bundle 缓存；这里的空安装指空业务/Engine 状态，不声称首次解包缓存成本已测。候选阶段均使用原始本地候选启动器的完整正常启动流程，计时从启动器进程前开始，到真实 UI、当前 Agent、同源 Service 与完整 ready 共同成立为止；空安装包含自动执行的合成管理员、模型配置和首次 Work/Service 创建。完整耗时、UI 首达与配置/核验阶段保存在逐组结果，Core 细分阶段及执行次数保存在同前缀 `-metrics.json` 中，所有安装正常关闭。
  - 空安装为 `dist/windows-cold-first-result.json`：54.360 秒；首次建立记录为 `dist/windows-cold-records-result.json`：42.248 秒。两者各执行三次完整镜像导出、三次完整扫描和一次环境探测，均成功。首次建记录的前置阶段使用已发布 0.0.16 Core（SHA256 `eccb78ab6b19955bd99e0cb9f3a0df136837408a01b377c594455bd4d8928236`），与候选使用相同已存在的 0.0.16 镜像，排除新镜像导入混杂。
  - 新镜像升级使用同一修复源码、固定 0.0.15 镜像的私有夹具 Core 先建立旧成功记录，再由原候选引入 0.0.16 镜像；夹具不是正式发行，身份在 `dist/startup-cold-guests/fixtures.json`。第一次执行完成了新镜像的三次导出/扫描、命中旧 Agent 与旧环境记录且零环境探测；驱动误要求必须探测一次，失败原始结果 `dist/windows-cold-upgrade-result.json` 和 `dist/core-startup-windows-cold-groups.log` 保留。该次完整单调耗时未在断言前保存，因此不补造。
  - 按实际保存的旧运行环境仍有效修正采样判定后，在全新的 `upgrade-corrected` 独立安装执行，结果为 `dist/windows-cold-upgrade-corrected-result.json`：37.465 秒；新能力键各完整检查一次，总计三次导出/扫描，旧 Agent 和环境各持久命中一次，零重复环境探测。完整记录为 `dist/core-startup-windows-cold-upgrade-corrected.log`。它与原工具误判分别报告，不替换失败记录。上述冷路径不适用 Core 10 秒与整 VM 25 秒重启预算。
- 原 20 秒整 VM 判定仍保留为失败，所有者明确接受的 25 秒判定通过。所有者同时明确取消整机重启验收，相关规划与规格已同步；整机重启没有执行，不再作为本次完成条件。
- 已补齐当前独立测试安装的 Windows Core 组驱动 `dist/windows-startup-core-group.mjs`：先核对当前 Work/Service 和实际进程文件 SHA256，在同一 VM 与 Docker 存活期间，按预定编号正常停止 Core、确认 Work 容器已停，再以观察器握手计时启动 Core；逐次导出新 boot 日志，保留失败，并正常关闭自有 VM。首次执行在内存预检处退出，记录为 `dist/core-startup-windows-core-group-run.log`，当时未启动测试 VM、未产生 Core 组样本；后续资源恢复后的完整 20 次结果见上文。
- 官网服务端安装页的旧 0.0.13 引用已局部同步为本仓库已发布的 0.0.16，并新增对应版本的 Core-only / single-host Compose、原始发行 metadata 和校验清单；历史 0.0.13 下载材料保留，现有页面结构及其他编辑内容保留。启动准备说明已同步双语部署手册、单机示例和官网。带 `--website-root /home/p/Projects/pphboy.github.io/piwork` 的完整一致性检查、仓库文档检查及两仓 `git diff --check` 通过，发布身份使用原始发布记录，不将本次开发候选冒充发行。
