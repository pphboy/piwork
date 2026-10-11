# Tasks

## 1. 请求入口与启动阶段安全计时

- [x] 1.1 在 `internal/diagnostics/` 增加独立性能事件投影与单调计时，保留现有公共诊断 schema；通过单元测试验证固定 phase / outcome / cacheState、非负耗时、业务 ID 缺省及秘密 / 路径 / digest 不泄露。
- [x] 1.2 在 `work_create_http.go`、`work_create.go` 和 `work_diagnostics.go` 接入 HTTP 请求起点、镜像解析、context 捕获和受理计时；通过 HTTP 夹具验证受理前失败仍有关联耗时、幂等重放未重新捕获且公共响应无新增字段。
- [x] 1.3 在 `workruntime/runtime.go`、`work_start.go` 接入 runtime prepare、container start、readiness RPC、diagnostic collection 和 activation 独立时间边界；用可控夹具延迟诊断收集，验证 RPC 核验和最终激活不会被记成同一时刻，也不使用 Agent 日志转存时间冒充原始时间。

## 2. 共享准备支持与 Core 生命周期

- [x] 2.1 新增 `internal/preparationcache/`，实现成功条目 / flight 分离、有界 LRU、默认条目保留及结果克隆回调；单元测试验证 64 条目上限、回收 / 保留行为、独立副本和失败 / 超时不进入成功缓存。
- [x] 2.2 实现同键合并、等待者登记及 closing 状态；并发测试验证只执行一次、首个调用者取消不影响其他等待者、最后一个取消触发收尾、新调用者不加入取消中 flight，并执行该包 race 检查。
- [x] 2.3 实现 64 个不同进行中键的容量边界、可取消容量等待和从明确 Core 生命周期派生的十分钟内执行预算；通过容量 / 截止测试证明队列不无限创建实际工作、一次初始化 attempt 结束不会取消后续合法调用。
- [x] 2.4 在 `coreapp/application.go` 注入共享任务生命周期并接入 Close，先取消并有界等待，再关闭 Engine / inspection root / Store；通过 shutdown 夹具核验资源关闭顺序、清理失败与总预算耗尽时的不成功退出结果。

## 3. 不可变镜像能力结果复用

- [x] 3.1 在 `dockerengine/image_capabilities.go` 接入按 image ID / kind / 校验版本缓存；扩展 Engine socket 夹具验证成功后重复调用不再次 ImageSave、首次检查仍验证完整归档 / 原生能力，且未知镜像不通过执行容器代码进行检查。
- [x] 3.2 将轻量 ImageInspect 和命中返回放在全量归档 gate 之前，未命中才共享实际扫描；并发夹具阻塞镜像 B 的 export，验证已准备 A 仍及时返回，并验证同键并发仅一次 export。
- [x] 3.3 覆盖镜像删除、tag 转向不同 ID、类别 / 平台不匹配、Engine 暂不可达、成功结果副本修改、扫描取消和 inspection 清理失败；相关单元 / integration 测试证明不复用错误结果、不放宽首次静态检查，并保留既有取消清理测试。

## 4. 包运行环境探测结果复用

- [x] 4.1 将 `probePackageEnvironment` 的实际探测及 defer 清理封装为完整工作，接入同键成功缓存；测试计数证明创建、包安装、脑包 seed / 候选调用共享一次真实环境探测，且环境不匹配仍经过原 `AssertEnvironment` 失败。
- [x] 4.2 只在环境校验、RemovePackageHelper 和 ReleaseResourceIntent 全部成功后发布成功结果；使用故障注入测试覆盖无效输出、运行失败、容器回收失败、归属释放失败、调用者取消及随后重试。
- [x] 4.3 为环境实际工作设置独立最多两并发许可；并发测试证明不重复取得调用者已持有的 package slot，不发生脑包 seed / 普通 package 准备嵌套死锁，两个相同镜像仍只启动一个 probe 容器。

## 5. 实际默认 Work 配置预热

- [x] 5.1 从 `work_binding.go` 提取与创建共用的 catalog 镜像解析部分，在 `prepareDefaultContext` 按实际默认 Work 配置预热镜像和所需环境；测试验证默认 Work 镜像不同于 runtime 镜像时使用正确目标，且不额外解析模型秘密或创建 Work。
- [x] 5.2 在 `default_work_patch.go` 的镜像 / 包选择持久化后，以及 `package_worker.go` 加入默认包列表成功后，调度当前默认准备；通过 HTTP / worker 测试证明保存不等待昂贵检查，预热完成状态绑定当前 runtime generation 和 default revision，旧完成结果不覆盖新选择。
- [x] 5.3 扩展已安装脑包重启与首个默认 Work 的真实 integration 测试，验证 Core ready 后默认创建和 Starting 的 ImageSave / environment probe 增量均为零；验证空包默认选择不被 seed 覆盖、不要求额外环境探测，默认条目保留期间不被其他缓存条目挤出。
- [x] 5.4 覆盖默认预热失败 / 重试 / 换代、健康状态响应、file / snapshot helper 降级以及旧 Work 捕获身份保持；执行相关 runtime preparation / recovery 单元和真实 integration 测试。
- [x] 5.5 核对并同步本次准备等待语义涉及的双语 README、Core-only Compose、单机示例双语说明、安装材料、模板和打包清单，记录命令 / 环境 / 默认超时未变化的实际核对结果；执行 `node scripts/check-docker-quickstart.mjs` 和 `node --test scripts/check-docker-quickstart.test.mjs`，文档不混入生产秘密或未实测性能承诺。

## 6. 启动阶段 readiness 快速确认

- [x] 6.1 在 `agentclient` 增加只供启动使用的受控连接退避重置，在 `waitReady` 的暂时连接失败且容器仍运行时调用，保留约 200ms 节奏、单次一秒 RPC 与三十秒总预算；延迟监听的本地 mTLS 测试验证合法 readiness 可服务后 500ms 内被确认。
- [x] 6.2 验证无忙循环或客户端重建、普通 Session / Run 不持续重置退避、超时 / 提前退出 / 身份和契约不匹配继续失败；执行 `internal/agentclient`、`internal/workruntime` 相关单元 / integration 测试并检查原诊断与 Stop supersession 仍生效。

## 7. 真实默认路径性能入口

- [x] 7.1 在现有独立安装测试支持上增加 API 性能入口，记录至少 20 个顺序默认创建成功样本和所有失败 / 超预算样本；使用真实 production Agent、合成模型配置且不发模型请求，输出请求到受理及受理到实际激活的 P50 / P95、实际扫描 / probe 次数和安全环境元数据，验证 1 / 3 秒参考目标。
- [x] 7.2 在 `apps/desktop-webui/test/` 的真实 Core / CLI 夹具增加独立浏览器全过程计时入口，至少 20 个成功样本，验证点击创建到列表 / 面板实际可用的 P95 ≤ 6 秒；保留现有两秒观察行为及同 ID 不重复请求、最多四并发和失败退避，不以 API 时间或多个 P95 相加代替浏览器测量。
- [x] 7.3 在同一参考机记录修复前后结果，单列 Core 冷启动、首次未预热镜像、并发同键、再次 Start 和大包 / 慢 MCP 条件；确认冷路径只有一份完整准备、热路径无重复准备，数据不包含真实凭据、镜像 digest、内部 context、宿主私有路径或会话内容。
- [x] 7.4 将性能入口、所需预构建镜像、参考条件、统计方法、结果目录和精确 installation 清理规则写入 `docs/testing.md`；从干净本机产物执行所述入口核对命令，安全 JSON / 截图等实际输出放入被忽略的 `dist/`，不得把未执行记为通过。

## 8. 集成一致性核对

- [x] 8.1 执行受影响 Go 包单元 / race、原有创建 / Start / Apply / 恢复 / 包 / 诊断 integration 回归及 `node scripts/check-native-boundary.mjs`；在最终代码状态核对公共 HTTP / RPC DTO、存储 schema、Agent 镜像要求和 Work 捕获身份仍与本设计一致。
- [x] 8.2 在最终构建复核性能入口实际结果、功能测试与四份规格场景的证据对应，执行 `git diff --check`；任何参考预算未达标或必需场景未执行均保留明确未完成状态，不能仅凭缓存测试通过宣称整个变更验收完成。
