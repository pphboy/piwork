# 最新 main 整合验收

日期：2026-10-13 UTC。变更：`fix-desktop-task-completion-and-ux`。本记录只列本次恢复环境重跑结果；[旧候选验收](previous-candidate-acceptance.md)中的通过数、截图及构建身份均不转移到本候选。

## 基线与范围

- 整合基线：`28bfdfa56b4c84b10ade9a63fedb7c2b75c04a90`。旧提案基线：`8b49c2cec1c6708a601d1809a97f81491525d81d`；两者相差28个上游提交。
- 冻结输入的全部67个阶段条目与前像已校验，五组层叠等于53个最终文件；没有直接用旧文件覆盖main。依A导出、B连续性、C控件/导航顺序三方整合，正常build生成嵌入资源。
- 源码/测试冲突位于 `adapter.ts`、`app.ts`、`public/style.css`、`test/recovery.test.ts`；上游新增恢复测试与本次新增测试均保留。生成资源不手工解决冲突。
- 保留上游Stop and send、独立活动Run、Service请求及回复读取、原submissionKey恢复、点击目标快照、名称错误、过期授权响应隔离和Run执行错误。独立只读复核未发现上述行为回退。
- 旧B全局Create pending锁与上游显式改名并发行为存在冲突：现保留不同名称的新显式提交，同名pending及任何未知创建继续锁定，保留latestCreateToken与草稿revision，并增加纯函数回归。
- C取消互斥叠加在上游完整请求观察链上；不恢复旧分页/Retry实现。测试夹具补全现行 `runIds` 字段；观察投影测试继续执行生产renderer及其新增名称辅助函数。
- 三个OpenSpec delta逐Requirement三方整合，保留新增上游命名、聊天中断、导入命名及Service请求展示约束，并去除重复段落/Scenario。主规格和其他change未修改，不归档。
- 根 `docs/` 不重建。仅本次必要[使用说明](usage.md)与验收记录归本change。
- 不改Core/API、依赖/锁文件、凭据、安全设置或用户数据；没有运行Docker。

## 候选身份

实现提交顺序：

1. `9784d98dd76a7f99b68a836f1d41407040e5e478`：精确导出与单次交付
2. `3d7557cbb16bfa6961b8362b265750c6d94115a5`：工作区连续性与文件结果恢复
3. `3dfbd17e9f473666199624bf99919b718507adc5`：上下文导航与完成控件

44个实现/测试/生成变更的排序清单（path、SHA-256、bytes）的排序JSON（Python默认分隔符、不含末尾换行）SHA-256：`96c8495cd8b67059e8c0ce4b798206197e64248e59f6e2ddf3c28c7e43822b46`。

供定向GUI复验的只读asset清单排序JSON（Python默认分隔符、不含末尾换行）SHA-256：`b6998f6322dcc1a7e320d5f5af182c87516684d681275d16bd982bd3d2aaa504`。该快照不随文档更新改变。完整文件清单、命令日志和恢复包单独交付。

## 本次已通过

| 层次 | 实际结果 | 说明 |
| --- | --- | --- |
| 依赖准备 | 原 `npm ci` 成功，未改package/lock | 初次默认缓存目录不可写，改用任务内缓存；没有修改系统设置 |
| 工具链 | Node24.19.0、npm11.9.0、Go1.25.5、OpenSpec1.13.2 | Go下载使用官方校验值验证，工具仅安装于任务目录 |
| A定向纯函数/adapter | 159 pass，0 fail/skip | A阶段源码；最终集成另列 |
| B定向纯函数/adapter | 216 pass，0 fail/skip | 含新增创建并发边界回归；最终集成另列 |
| C最终纯函数/生产函数/adapter | 303 pass，0 fail/skip | 16个测试文件；包含A/B、导航竞态、取消锁和观察投影，不是浏览器测试 |
| 工作区类型检查 | 全7 workspace通过 | 按现有依赖顺序先build declarations |
| Desktop测试编译 | `tsc -p apps/desktop-webui/tsconfig.test.json`通过 | 包含保留的上游浏览器回归，编译不是执行 |
| TS contracts | 40 pass，0 fail/skip | 含cancel-and-send及Retry原键契约 |
| 正常Go构建 | `bash scripts/build-go.sh`通过 | 全部7个Go入口；保留 `-buildvcs=true`，显式指向本worktree的Git目录修复环境VCS发现问题 |
| Desktop embed | 20个文件与正常dist逐字节一致 | 未手改JS/CSS生成副本 |
| Go CLI传输/文件定向 | 14顶层测试通过，含subtest共17，0 fail/skip | 原snapshot/session、传输校验、清理、文件桥接、图片、未知结果及离线Inspect等；不是真实Core |
| 新上游Go CLI回归 | 3顶层通过 | 名称错误安全投影、允许路由与cancelRunId/Retry原键、聊天输入原键 |
| Go agentclient/contracts | 9与12个顶层测试全部通过 | 细分subtest分别23与7260；不以子项数宣称端到端覆盖 |
| Go client/clientfs/workpackage | 三个package通过 | 同批CLI完整包结果仍失败，见下方限制 |
| 文档治理 | checker及7个相关测试通过 | 当前54份文档、1份迁移清单；没有复活根docs |
| 原生边界 | checker及1个测试通过 | 扫描不代表原生Desktop运行成功 |
| OpenSpec | `validate fix-desktop-task-completion-and-ux --strict`通过 | 只证明格式/结构有效，不表示全部任务完成 |
| Git | `git diff --check`通过 | 未远端推送、发布、合并或归档 |

首次C纯测中5个观察投影测试因旧夹具未加载main新增的 `importNameFeedback` 失败；补为读取并执行生产函数后重跑303项全部通过，没有改变产品逻辑来迁就夹具。

## 未通过或未验证

- Go完整 `internal/cli` 包本轮失败：相关测试报告 `netlinkrib: operation not permitted`、原生Desktop无法启动及control channel不可用。未更改权限或绕过限制。其他三个包通过不能描述为该完整命令通过；后续有明确选择范围的CLI契约测试另列。
- 原仓库Playwright启动：先缺少浏览器，可通过官方项目依赖安装Chromium140.0.7339.186；正常重试后启动仍因 `socket() failed: Operation not permitted` / SIGABRT失败。选中的3个上游授权隔离浏览器回归均在before hook失败，产品断言0执行。清理hook因browser未创建而失败、server未关闭，使用25秒外层时限结束；没有改安全参数、使用raw CDP或绕过socket限制。
- 完整Desktop `test:browser`、原生 `browser.test` / `native-auth`、真实Core停止→导出→校验→下载→Inspect→Import→显式Start链路均未通过本轮完整验收。保留相关测试源码及未勾选门槛。
- 本轮不重复已被审批阻塞的真实Import/file chooser操作；不把合成HTTP、纯函数或GUI演示等同于真实Core结果。
- 360px全矩阵、实际NVDA/VoiceOver、完整键盘/几何/动效矩阵仍未验。任务表维持28/45，不因partial结果勾选剩余17项。
- 仅准备Draft PR，不能据此宣称全部Spec全绿或可直接合并。

## 定向GUI

通过受支持的官方GUI工具操作云浏览器，使用冻结asset及独立合成HTTP后端，以下5组定向复核通过；逐文件manifest均匹配。它们不代替整套仓库Playwright或真实Core验收。

1. 临时503连续性：原iframe保持相同文档/UUID，应用输入保留。
2. Files与命名：12个选择命中区均为32×32；选择前后行位置差为0；Rename初焦且仅选择文件主名A。
3. 轻量关闭与脏导航：Work菜单外侧关闭并返回焦点，Stop影响确认外侧不关闭；Back/Forward保留脏文件确认与草稿。
4. Start完成出口：Start POST为1；原 `operation-start-1` succeeded但Work仍Starting时无Open，Work Ready后才提供Open；不自动离开Works，Service entry POST为0。
5. 停止态导出：原 `operation-export-current-1` / `snapshot-current-1`，Export/prepare/content计数为1/1/1，Stop为0；实际浏览器下载9163字节，SHA-256为 `2b9e7538f91fbfe087ad0cfa0080e30e3480f3d40136997c3121f47dd54788ca`。未把Content GET等同于真实Core生成/完整性链路。

GUI使用的 `app.js` SHA-256为 `a8cf325f050e5911304222183944cfbd6de8e76319b55afc6609af6d17caf25a`；`asset-manifest.json` 原文件（含末尾换行）SHA-256为 `8810639ca2c3f8a2f15e2f25f7cac25df02255725da0b40e863ab0a9725e5562`。

## 2026-10-13 用户反馈增量：主流程与管理入口分层

### 基线与修改

本轮开始时只读确认PR #2仍open/draft且未合并，远端head为`615e7d92432cf1218d4d292bb164a993ca5e9393`，base仍为`28bfdfa56b4c84b10ade9a63fedb7c2b75c04a90`。本地`d9e633d`树与该远端head相同，工作树干净；不覆盖其他提交。用户三张反馈图已实际查看。

- Works/Work：Ready行直接Open Work，Stopped保留Start；Stop与Work information归当前Work更多菜单，移除Work顶栏About图标；删除列表底部重复Create a Work，空列表引导保留。
- Admin：全局About与Known operations归账号下拉；外点和Escape只收起菜单，不受背景草稿/任务阻断，不扩大危险确认白名单。
- Export：原入口本来就直接建立一次新意图，本轮不重写协调器。改为非遮罩紧凑进度/结果，技术ID、旧快照、Pause/Check按需展开；成功保留同文件下载，明确失败保留原快照Retry download，未知结果只读核对；running仍有Stop and export影响确认。
- Files：移除空选择提示条；批量图标放入原工具栏，选择命中、覆盖/删除/未知结果保护不变。
- Service/Agent：请求入口用有aria-label/title的就近图标；Service仅可靠hasRecords时显示且保留当前Service过滤，Agent保留全Work范围，无计数或新API。

只改Desktop源码、对应测试、正常生成的嵌入资源和本change材料。未运行Docker，未改Core/API、依赖/锁文件、凭据、安全设置；不发布、合并或归档。

### 本轮实际验证

- 17个纯函数/生产renderer/adapter测试文件：321 pass，0 fail/skip。新增18项覆盖新层级、停止态直接导出、running确认、在途去重、准确旧快照、failed准备重试、dialog模态切换、Admin身份转义、批量工具栏与图标作用域等；这不是浏览器通过数。
- 全7 workspace typecheck与全部Desktop测试编译通过。原browser/native-auth/feedback/recovery/real-core测试定位器按Admin及Work更多菜单迁移；新增360/500px回归源码已编译，未声称本地Playwright实际运行通过。
- 正常Desktop build、Go1.25.5全部入口构建通过；20个嵌入资产与dist逐字节一致。Node24.19.0；没有为构建修改项目依赖或安全参数。
- 文档治理、native boundary checker通过；两个checker测试文件合计5 pass。OpenSpec strict与git diff --check通过。
- 独立只读review发现并修复failed下载准备的同snapshot恢复缺口、账号标题转义及旧测试入口迁移遗漏；新增回归没有删除旧安全断言。

### 官方云浏览器定向复验

使用独立合成HTTP夹具与冻结正常构建资产，不接真实用户Core。最终`browser/app.js` SHA-256为`4fed5167039aabeeb4216b7802fbcbb65761fd9067a155832c80dd24b9a2f82a`，`public/style.css`为`ac7a157cecef9ded380c5d429f26410292efa7eb06053718c21e50047eaf95fd`。

- Admin外点/Escape关闭并回焦点，About/Known可打开，底部重复创建CTA不存在。Known operations读取pending时仍可外点收起，gate释放后不重新打开，零业务mutation。
- 已存在两份snapshot时，首次Export只有一次点击；Export/prepare/content为1/1/1，实际下载9163字节并匹配本次current内容，未误用旧snapshot。紧凑卡片非modal，Details默认折叠，背景Search可输入；背景New Work能正常切换回模态窗口。完成后再次明确Export只再新增一次新意图，两次明确操作合计Export/prepare/content为2/2/2，Stop为0，两份包均9163字节并匹配各自当前内容。
- 两类请求图标均有title/aria-label，Service入口保留原Service过滤。
- Files宽屏与500px首次选择、末次清空行位置保持不变；500px A行Y均251，复选框label32×32，scrollWidth与innerWidth均500；批量Copy打开原A.txt/B.txt目标。500px Work更多菜单和Stop影响确认可达。
- 首轮窄屏实测曾发现两行工具栏被父flex压至57px、原first-child隐藏规则误隐藏唯一Work更多按钮；两处已修，最终冻结重新测量并截图确认，不沿用失败截图为最终结果。

### 仍未通过或未测

原45项中28完成、17未测状态保留；新增层级工作另列11.x。最小可用官方Chrome窗口实际innerWidth为500，360px实际GUI未测，不能以新增回归源码或CSS推断通过。完整键盘矩阵、真实读屏、原生授权与真实Core停止→导出→校验→Inspect→Import→显式Start仍受原门槛约束。

一次较宽的测试命令误包含需本地浏览器的feedback/preferences/recovery夹具，初始化未完成，后中断退出130；这些失败/未执行不计入321项通过数。随后按17个不需浏览器的文件明确重跑成功。未绕过既有浏览器/socket限制，也没有把官方云浏览器合成GUI替代整套browser/native-auth或真实Core验收。
