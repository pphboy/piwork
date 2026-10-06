# Tasks

## 1. 合并摘要与成组编辑面板

- [x] 1.1 在 `apps/desktop-webui/src/app.ts` 用单一 `response-settings-trigger` 摘要替换 Composer 的两个常驻选择器，呈现真实模型名与 Thinking，并提供完整英文无障碍名称。验证：浏览器用例检查辅助栏、常规 Chat 和 Focus chat 都只有一个摘要，没有常驻 Model/Thinking 字段标签，当前值与原 Session 一致。对应 DUL-WORKSPACE-001「Composer 常态突出输入」。
- [x] 1.2 用既有 `#modal` 实现统一 Response settings 面板、相邻的两行当前值与一次一项的可展开菜单，摘要打开默认收起列表，选择后收起列表且保留面板；打开、切换展开目标和关闭不修改偏好。验证：为「摘要打开与关闭不改变设置」「同一面板内调整两项」加入请求计数与面板状态断言，打开/关闭没有 PATCH、Session 创建或 Run 提交。
- [x] 1.3 在 Desktop 局部样式中落实 31px 等高、quiet 角色、摘要内容宽度与 320px 上限、名称局部省略、右侧 Input options/Send 动作组及面板局部滚动，移除旧的均分与 420px 强制整行规则。验证：更新几何用例，短名称放大窗口后摘要不被拉伸；长名称在 360px 下不挤走动作，面板能读取完整名称，页面无横向溢出。对应「输入底栏对齐」「摘要在宽屏保持内容宽度」。
- [x] 1.4 更新 `recovery.test.ts` 的 `chooseModel()` / `chooseThinking()` 辅助函数，让单次设置路径显式关闭面板，连续调整路径显式保留面板；替换针对旧四个按钮的断言。验证：运行与本组相关的浏览器用例，保留原请求、草稿及真实选项断言，后续状态测试能够使用统一入口。
- [x] 1.5 对实际浏览器的宽屏、Agent 辅助栏、Focus chat、360px 和矮视口截图进行层级与控件一致性检查，将正常摘要、展开面板和长名称证据保存在本变更 `verification/uiux/`，在 `verification.md` 记录设计矩阵的任务层级、视觉角色和响应式结果。验证：截图可读且显示一个内容宽度摘要、同组当前值、完整可达的发送与关闭动作，样式复用既有角色，问题修正后才标记通过。

## 2. 完整设置对与状态恢复

- [x] 2.1 让摘要与面板复用 adapter 的同一模型目录、能力、设置对及确认事实，明确显示 Saving / Not saved / Unconfirmed / For new session；选择不同值调用现有串行保存，相同完整设置不重复保存，关闭或重开不重放。验证：扩展「已确认值重复选择」「保存期间关闭并重新打开」「Thinking 与模型原子确认」的浏览器断言；PATCH 不重复、并发最大为一，最新值未确认前发送受限，当前 Run 元数据不变。
- [x] 2.2 让摘要在目录读取、失败和未知时仍可打开；在面板及 Composer 的适当位置复用 Retry models、Retry settings 与原 Session 的 Check chat settings，并保持必要状态在面板关闭后可见。验证：复用延迟、拒绝、丢失响应与 GET 恢复 fixture，覆盖「目录首次读取与失败恢复」「未知结果的统一入口」；核对不 PATCH、不自动发送，失败/未知不被表述为保存成功。
- [x] 2.3 在两行当前值与选项中准确区分模型仅支持 Off、Work 能力缺失、能力未确认、失效模型、只有 Work default 和尚无 Session；模型切换的不兼容 Thinking 调整沿用真实模型默认值。验证：回归实际 SDK 档位与旧基础聊天用例，补充统一入口的边界断言，确认没有硬编码档位、静默模型回退、额外 Session 或立即发送。对应「模型变化导致 Thinking 不兼容」「没有模型覆盖或没有 Session」「新 Session 的草稿配置」。
- [x] 2.4 将面板本地展开状态绑定打开时的身份、Work 和 Session；上下文切换关闭原面板，晚保存不恢复旧面板或旧焦点。验证：扩展「快速选择与跨 Session 晚响应」「切换上下文与晚到保存」用例，检查新摘要、草稿与对象身份保持，原结果只归属原 Session。
- [x] 2.5 在 `verification.md` 记录加载、保存中、明确失败和未知恢复的实际检查结果，并保存至少一组关闭面板后仍可见的限制/恢复截图。验证：证据覆盖 DUL-WORKSPACE-001「收起面板仍能解释发送限制」与设计矩阵的状态和恢复项，能分辨保留选择和已确认偏好，没有重复 live 播报或成功流水。

## 3. 命令与键盘一致性

- [x] 3.1 将 `/model` 与 `/thinking` 接到统一面板并直接展开对应真实列表，保留原命令草稿比较与完整设置确认逻辑；已确认同值可完成命令而不 PATCH，不可用项进入可见原因而不消费命令。验证：更新「Thinking 直接调整与网页命令一致」「命令直接展开与焦点返回」「无 Thinking 能力的命令入口」及丢失回复用例，确认没有 Run，确认前/取消/失败保持原输入，新编辑不被清除。
- [x] 3.2 更新面板的展开语义、当前列表箭头/Home/End、Enter/Space、Tab 焦点限制与 Esc 优先级；直接入口关闭回到摘要，命令入口关闭回到 Composer，选择后回到对应值行，响应更新保留有效焦点。验证：纯键盘操作覆盖两条入口、Focus chat、未知恢复和输入法组合；Esc 只关闭面板，IME Enter 不选择或发送，草稿光标及阅读位置保持。对应「设置菜单优先关闭」「摘要打开与关闭不改变设置」。
- [x] 3.3 在 `verification.md` 记录命令、无障碍名称、可见焦点和焦点返回的实际结果。验证：完成设计矩阵的命令兼容与键盘项，并确认既有 Input options / Service identity 的资源命令边界用例仍通过。

## 4. 集成与交付检查

- [x] 4.1 运行 `npm run typecheck -w @piwork/desktop-webui`、`npm run build -w @piwork/desktop-webui`、`npm run test:browser -w @piwork/desktop-webui` 及 `go test ./internal/desktopassets`，用既有构建同步 Go 内嵌资源，不手工维护生成副本。验证：命令全部通过，构建后的 JS/CSS 与内嵌副本一致，无后端、共享令牌或无关应用改动。
- [x] 4.2 回归 Service/Files/Chat 与专注布局往返、未保存 Service iframe 输入、Activity 展开和当前 Run 观察；汇总 `verification.md` 的 UI/UX 矩阵与截图证据，并执行 `openspec validate compact-chat-composer-settings --strict`。验证：原 iframe 文档及会话草稿保持、没有额外模型提交或生命周期动作，全部对齐项有实际依据，所有本次需求场景有通过记录。
