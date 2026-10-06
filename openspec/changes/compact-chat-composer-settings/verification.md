# 实施验收

本变更已实现单一配置摘要和统一 Response settings 面板。界面文案使用英文，规范及验收记录使用中文。验收日期为 2026-10-06。

## 验收方式

使用 Node 24.20.0、Go 1.25.5、仓库既有 Playwright Chromium 和真实 Desktop 构建产物。浏览器加载实际 HTML、CSS 和 JavaScript，专项 API 使用 `recovery.test.ts` 的可控 fixture，覆盖延迟、明确拒绝、丢失回复和身份切换。全量回归还使用新构建的 Linux CLI 验证原生 Desktop API 与鉴权。截图由浏览器直接采集，已逐张检查；没有生成界面效果图。此次未改动后端、SDK、adapter 的设置协调或共享视觉令牌。

新增专项用例共 20 项（含子用例），全部通过。最终全量回归共 221 项：220 通过、0 失败、1 项按原有配置跳过；跳过项是需显式开启的五分钟 ticket 过期测试，与 Composer 变更无关。

## UI/UX 对齐矩阵

| 维度与基线 | 实际检查结果 | 证据 |
| --- | --- | --- |
| 任务层级：DUL-010、DUL-WORKSPACE-001 | 通过。输入区保持主体空间；底栏只有一个摘要，常态无 Model/Thinking 字段标签或保存成功条。短摘要扩大窗口后宽度不增长，右侧动作保持独立。 | [常规 Chat，1440px](verification/uiux/02-chat-wide.png)、[Focus chat](verification/uiux/03-focus-chat.png)；`Compact settings summary shares…`、`Compact settings UIUX evidence…` |
| 对象和容器：DUL-002、DUL-012 | 通过。Agent 辅助栏、Chat、Focus 共用当前 Session 的设置对和草稿。查看、展开、关闭及布局切换没有 PATCH、创建 Session 或提交 Run；设置面板及 Focus 往返保留原 iframe 文档和未保存输入。正常区域导航继续遵循原有模块规则。 | [Agent 辅助栏](verification/uiux/01-agent-sidebar.png)；`Compact settings summary shares…`、既有 Focus/Files/Chat 回归 |
| 视觉角色：DUL-007、DUL-WORKSPACE-002 | 通过。摘要复用 quiet 按钮，31px 高、12px 字号、8px 圆角；Input options 与 Send 同行等高，右侧组内间距 6px。面板复用现有 dialog、边框、字体、选中背景及按钮；两行当前值相邻，选项左对齐。 | [默认面板](verification/uiux/04-response-settings.png)、[Thinking 列表](verification/uiux/05-thinking-options.png)、[键盘焦点](verification/uiux/17-keyboard-focus.png)；几何与计算样式断言 |
| 状态和恢复：DUL-003、DWUI-019、DWUI-MODEL-001 | 通过。保存中、明确失败、未知、目录未确认和 Thinking 限制在关闭后仍可见。面板复用同一状态与恢复入口；打开时只有面板内的设置状态承担 live 播报，目录错误不重复显示通用 Agent 错误。恢复取得实际完整设置，不重发保留选择或消息。 | [加载](verification/uiux/11-loading-models-closed.png)、[目录失败](verification/uiux/12-models-unconfirmed-closed.png)、[保存中](verification/uiux/13-saving-closed.png)、[未保存](verification/uiux/14-not-saved-closed.png)、[未知](verification/uiux/15-unconfirmed-closed.png)、[仅支持 Off](verification/uiux/16-off-unsupported-closed.png) |
| 焦点和键盘：DUL-007、DWUI-FOCUS-001 | 通过。摘要进入 Model 行，命令进入对应已选项；不可编辑时进入恢复或 Close。上下键、Home/End 只移动当前列表焦点；Enter/Space 明确选择。Tab/Shift+Tab 留在 dialog，Esc 只关面板。有效焦点在响应重绘后保持，失效后转向恢复/关闭。草稿光标和阅读锚点保留。 | [可见焦点](verification/uiux/17-keyboard-focus.png)；`Compact settings keyboard keeps…`、未知恢复和 Focus Esc 回归 |
| 长内容和窄屏：DUL-WORKSPACE-002 | 通过。360px 下模型名局部省略，Thinking、下箭头及右侧动作可见；完整名称在当前值行和模型选项内换行。选项列表局部滚动，800×300 矮视口的正文也可滚动，Close 始终在视口内，无整页横向滚动。 | [360px 摘要](verification/uiux/06-chat-360.png)、[360px 面板](verification/uiux/07-settings-360.png)、[长名摘要](verification/uiux/08-long-model-360.png)、[长名面板](verification/uiux/09-long-model-panel-360.png)、[矮视口](verification/uiux/10-settings-low-height.png)、[矮视口键盘滚动](verification/uiux/10b-settings-low-height-scrolled.png) |
| 命令兼容：DWUI-COMMAND-001 | 通过。`/model`、`/thinking` 直达同一面板内真实选项；选择成功确认后只消费仍相等的原命令，同值确认无 PATCH。取消、失败、未知及能力不足保留命令；编辑后的新草稿不清空。打开设置不生成通用 Confirmed 条，也不提交 Run。Input options 和 Service identity 参数边界保持。 | `Compact settings confirmed repeats…`、`Compact settings unsupported Thinking commands…`、既有 slash、丢失回复和 Service identity 回归 |

视觉检查曾发现长名称选项受固定行高裁切，已修正为按内容撑高且不在滚动列表中收缩。复查后的长名面板显示完整模型名与 Use Work default。键盘检查发现页脚关闭焦点在重绘后移向标题栏，以及能力变化后失效焦点没有转向 Close，均已修正并通过回归。

## 状态与请求检查

| 条件 | 已验证的实际行为 |
| --- | --- |
| 正常确认 | 摘要和两行当前值一致；没有永久 Saved；查看、切换展开项、收起和关闭没有写请求。 |
| 相同完整设置 | 明确选回当前模型/Thinking 不增加 revision 或 PATCH；匹配的网页命令可完成；尚未确认的同值不会伪装为已保存。 |
| 保存中关闭与重开 | 最新选择与 Saving 可见，输入仍可编辑，发送受限；关闭重开及再次选择同一待确认值只有一个 PATCH。 |
| 同一面板调整两项 | Model 改变后采用目标模型提供的默认 Thinking，再选其支持的档位；请求携带完整设置对，最大保存并发数为 1，最终确认最新一对。另用 Balanced/Deep 能力数组验证没有硬编码通用档位。 |
| 明确拒绝 | 所选 High 保留并标为 Not saved，原已确认 Off 保持；面板和 Composer 均可 Retry settings。明确重试成功后错误消失，没有自动 Run。 |
| 响应未知 | 两行修改及发送禁用，摘要仍可打开；原 Session 的核对 GET 失败后继续保持未知。随后成功读取实际 Low 替代保留 High，没有第二次 PATCH。 |
| 目录首次加载与失败 | 显示 Loading models 或未确认原因，旧值标为 last known；没有虚构列表。Retry models 成功显示真实默认选项，草稿保持，没有写请求。 |
| Off / 缺失 / 未确认 | 模型仅支持 Off、Work 缺失新契约、能力数组缺失分别显示 Off、Unavailable、Unconfirmed 及原因；`/thinking` 不消费命令、不构造档位，基础聊天仍按原契约可用。 |
| 模型不兼容与失效 | 切换至仅支持 Off 的模型显示调整说明，保存真实 Off 完整设置对；已有失效偏好不静默回退。当前 Run 的实际模型和 Thinking 不改变。 |
| 尚无 Session | 草稿选择显示 For new session；只有一次明确 New session 才创建并确认设置，没有后台 Session 或 Run。原丢失创建回归验证原 key 的只读恢复，不再次创建。 |
| 跨 Session / Work | 打开时绑定原身份、Work、Session；切换关闭原面板。晚响应只更新原 Session，新对象的摘要、输入和焦点保持；没有新对象 PATCH 或 Run。 |
| Core / 账号切换 | 面板关闭，身份数据清除，旧回复不能恢复原面板、模型目录或旧对象。 |

## 场景覆盖

以下用例均位于 `apps/desktop-webui/test/recovery.test.ts`；表内缩略名称对应文件中完整英文测试名称。

| 规范场景 | 通过依据 |
| --- | --- |
| DUL「打开已有内容并后台更新」 | Activity/reading anchor 历史刷新、运行时能力恢复、局部读取与既有反馈回归 |
| DUL「输入和执行详情共存」 | Activity failure/Service identity；已受理 Run 元数据保护；保存中保留草稿 |
| DUL「窄屏与键盘操作」 | 360px 几何、UIUX evidence、keyboard keeps、Focus 与 Activity 回归 |
| DUL「Composer 常态突出输入」 | summary shares；三种容器只有一个摘要，普通状态无成功条 |
| DUL「按需调整成组配置」 | summary shares；both fields adjust；默认收起、一次一列表、Close 返回 |
| DUL「收起面板仍能解释发送限制」 | saving survives、rejected saves、unknown recovery 及截图 13–15 |
| DUL「摘要在宽屏保持内容宽度」 | UIUX evidence；1440px 扩大至 2200px 后短摘要宽度不变 |
| DWUI「当前执行中修改下一次模型」 | Brain saving preference；model transition；Run 元数据前后相等 |
| DWUI「偏好保存失败」 | Brain rejected preference；rejected saves |
| DWUI「默认与自动处理」 | Brain saving preference 保留已受理 Run 元数据；选择 Use Work default 不触发 Run 或请求生命周期动作，原自动处理契约保持 |
| DWUI「偏好保存响应丢失」 | Brain model save lost reply；unknown recovery，含 GET 失败与随后恢复 |
| DWUI「Thinking 与模型原子确认」 | UX composer serializes；both fields adjust |
| DWUI「快速选择与跨 Session 晚响应」 | UX composer serializes；context changes close |
| DWUI「没有模型覆盖或没有 Session」 | 空覆盖目录默认模型；no-Session selections；lost creation |
| DWUI「模型变化导致 Thinking 不兼容」 | model transition；both fields adjust，真实默认 Off/Balanced |
| DWUI「输入底栏对齐」 | 原几何回归及 UIUX evidence，含长名、360px 和矮视口 |
| DWUI「Thinking 直接调整与网页命令一致」 | slash Thinking 实际选项列表对比及确认消费 |
| DWUI「设置菜单优先关闭」 | Focus icons Escape；keyboard keeps；Focus chat 只关面板 |
| DWUI「摘要打开与关闭不改变设置」 | summary shares，请求计数、草稿、光标、阅读位置、iframe 断言 |
| DWUI「同一面板内调整两项」 | both fields adjust，完整设置对串行且面板保留 |
| DWUI「已确认值重复选择」 | confirmed repeats；直接与两条命令入口均无 PATCH/Run |
| DWUI「保存期间关闭并重新打开」 | saving survives，单次 PATCH 与最新选择保护 |
| DWUI「目录首次读取与失败恢复」 | first catalogue loading and failure，无虚构选项且真实读恢复 |
| DWUI「无 Thinking 能力的命令入口」 | unsupported Thinking commands 三种能力子用例 |
| DWUI「未知结果的统一入口」 | unknown recovery，禁用、重复打开及原 Session GET 计数 |
| DWUI「命令直接展开与焦点返回」 | confirmed repeats；keyboard keeps；slash Thinking |
| DWUI「切换上下文与晚到保存」 | context changes close、switching Work、Core and account changes |
| DWUI「新 Session 的草稿配置」 | no-Session selections，只有一次显式创建与设置确认 |

## 交付检查

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck -w @piwork/desktop-webui` | 通过 |
| `npm run build -w @piwork/desktop-webui` | 通过；沿用 copy-static 与 sync-desktop-assets 同步资源 |
| `npm run test:browser -w @piwork/desktop-webui` | 通过：220 通过、0 失败、1 预设跳过，约 83 秒 |
| `npm run build:cli -- --target linux/amd64` | 通过；为新 worktree 补齐原生测试前置二进制，包含本次更新的 Desktop |
| `go test ./internal/desktopassets` | 通过；该包无独立测试文件，命令验证嵌入包编译 |
| 构建产物与 Go 内嵌副本逐文件比较 | 通过：browser/public 共 11 个文件，路径集合与字节内容全部一致 |
| `openspec validate compact-chat-composer-settings --strict` | 通过 |

首次全量执行时，worktree 尚无默认 `dist/go/piwork-cli`，两个原生测试子进程在启动阶段失败。通过既有 CLI 构建脚本生成二进制并用 `PIWORK_TEST_NATIVE_CLI` 指定后，重新执行整个浏览器命令通过；没有跳过失败的原生测试，也未修改测试脚本或产品接口来绕过前置条件。

使用 Node 24 时可按以下命令重跑并重采集截图。不设置截图目录时仍执行相同断言，只省略截图文件写入：

```bash
npm run build:cli -- --target linux/amd64
export PIWORK_TEST_BROWSER_BIN=/home/p/.cache/ms-playwright/chromium-1193/chrome-linux/chrome
export PIWORK_TEST_NATIVE_CLI="$PWD/dist/cli/linux-amd64/piwork-cli"
export PIWORK_UIUX_EVIDENCE_DIR="$PWD/openspec/changes/compact-chat-composer-settings/verification/uiux"
npm run test:browser -w @piwork/desktop-webui
```

截图目录包含 18 张实际页面截图。矮视口使用正文及列表滚动，截图 10b 显示键盘 End 到达最后一项且 Close 仍可见。
