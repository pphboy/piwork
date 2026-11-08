# 实施与验收

日期：2026-11-08。实现验收基线：`1b8e48a9378ee8bda41fa095a331207b9934b2d3`，功能验收在提交前的变更工作区执行；后续规格同步与归档见文末。

## 实施归属

- `apps/ui-shared/{controls.css,feedback-primitives.js,i18n.js}` 是紧凑角色、语义图形和语言子层的共享来源；Desktop/Console 的声明、显式消费者与复制资源同步。语言父层重绘后由各入口调用 `reanchor`，没有引入 MutationObserver。
- Desktop `app.ts` 按实际功能读取并修改：68–240 行的展示辅助、1370–2025 行的浮层/Work/Service/Chat、2180–2895 行的 Files/Settings/检查器，以及 `handleAction`、`render`、事件分发中的对应分支。命令上下文由 `work-chrome.ts`，浮层角色由 `overlay-role.ts` 管理。适配器、ExportFlows、配置草稿、布局返回和原请求检查器继续拥有业务状态。
- `notice-page-region.ts` 仅调整实际 DOM 边界：侧向设置导航，以及缩短 Chat Header 后可能被通知遮住的失败消息按钮；共享通知算法没有新增所有者。
- Console `app.ts` 仅涉及账户紧凑角色及语言父子层的打开、重绘、关闭归属；登录/初始化的独立语言选择继续使用默认接口。
- 真实浏览器验证发现 textarea 首行换行被 HTML 解析消费；Files、AGENTS.md、Advanced 和 Chat 的文本呈现增加解析分隔换行，保留原草稿值，不改变保存/提交内容或状态所有者。

## 已执行的检查

| 检查 | 结果 |
| --- | --- |
| 两端 TypeScript typecheck | 通过 |
| Desktop 全量浏览器/契约套件 | 1650 通过，0 失败，1 项既有门控跳过 |
| 换行保真修正后的草稿、Focus、语言及文件回归 | 15 项通过 |
| Console 语言、账户及管理页面浏览器回归 | 45 项通过 |
| Console 单元测试 | 163 项通过 |
| ui-shared 测试（含语言父子层直接浏览器测试） | 39 项通过 |
| 当前复制/同步链、`make check-generated-ui` | 通过，重新生成后字节稳定 |
| `make build-go` | 当前 Core/CLI 构建通过 |
| `go test ./internal/webapp ./internal/desktopassets ./internal/consoleassets` | 通过；两个 assets 包没有独立测试 |
| ui-language、WebUI 依赖方向、源码风格、repository-docs、`git diff --check` | 通过 |
| 冻结 prototype 校验 | snapshot.json 所列 14 个附件 SHA256 全部匹配 |

全量套件中 `real Engine prepares fixed release dependencies and permits one explicit Work from the IP workbench` 按既有 `PIWORK_RUN_ENGINE_BROWSER` 门控跳过。真实 Engine 另通过下述明确入口验收，未把该跳过项写为通过。

## 真实 Core / CLI / 浏览器

使用当前宿主构建、当前 acceptance Agent 与当前 Go helper 镜像，在独立数据目录、合成账号和精确 installation 标签下执行：

```sh
umask 022
PIWORK_TEST_SERVICE_VIEW=only node apps/desktop-webui/test/real-core.mjs
```

`service-view-real-core.mjs` 在 CLI Desktop 与托管工作台两种部署分别确认：真实 SDK Service select/refresh、同一选择保留原文档、显式刷新更换文档、其他浏览器及非来源 Run 不接管选择；真实文件通过 UI 保存且 Core 读回字节相同，未保存导航可返回编辑；Settings 跨分类共享包含首行换行的草稿，Keep editing/Discard 沿原保护；实际 HTML 所引用 CSS、共享 i18n 模块的 MIME，以及宿主 CSP 均通过。

最后一轮输出两种部署各两条通过结果，清理回执确认该 installation 的 container/network/volume 均为 0。仅清理本轮安装和精确标记的探测资源。

## 环境与边界

使用 Node 24.20.0、Go 1.25.5 和 Docker 29.1.3。本机 Node 24.2.0 的嵌套 `t.test` 等待问题已用最小例子复现；最终套件采用符合 `.nvmrc` 的 24.20.0。

本机默认 `umask 077` 会使新脑包输入不可被辅助容器读取，阻塞默认上下文准备；权限对照与独立安装 `umask 022` 已确认可运行。本次没有修改 Core 的权限实现，也不据此宣称支持该限制环境。

未执行全仓所有 Docker/模型测试、真实付费模型验证或发行流程。原型继续冻结；本节记录实现阶段的验收事实，规格同步与归档结项见下节。

## 视觉证据

- [实际呈现器的 Service 选择器](verification/screenshots/service-picker.png)：合成 HTTP 数据与故障注入，展示默认样式、固定列和紧凑密度。
- [真实 CLI Desktop](verification/screenshots/real-desktop.png)、[真实托管工作台](verification/screenshots/real-hosted.png)：真实 Core/SDK/文件/配置保护验证后的页面。

其余本地截图和日志位于被忽略的 `dist/ui-apply/` 及 `dist/ui-apply-*.log`，没有包含真实凭证或用户数据。

## 归档结项

2026-11-08 将三份 delta 同步到 `desktop-ui-language`、`desktop-webui` 与 `ui-language` 主规格，共修改 13 条要求、新增 4 条要求；未遗漏原场景，重复同步不产生差异。主规格校验 51 项通过，变更产物与 21/21 任务完成，归档到本目录。实现、嵌入资源及相关测试按共享层（`ee6c4a5`）和 Desktop 消费层（`0324da6`）依赖拆分，主规格同步与本归档单独提交；未执行外部发布。归档前复核共享 39 项、Console 单元 163 项、Desktop 直接契约 124 项、两端类型与生成物稳定性检查，均通过。
