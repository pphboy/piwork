# Design

## Context

动机与行为范围见 [proposal.md](proposal.md)。当前有两套额外门禁，均独立于账号登录：

- `internal/webapp/setup.go` 签发首次设置证明，再兑换专用 setup Cookie/CSRF；`apps/console-webui/src/onboarding.ts` 因此包含 authorization 阶段、链接检查及错误恢复分支。
- `internal/cli/user_desktop_auth.go` 签发 Desktop ticket，`user_desktop_api.go` 兑换浏览器会话；共享前端 `adapter.ts` 的 `browserAccess` 状态控制登录页、工作区和恢复，`app.ts` 另有 Reset browser access。

现有普通会话基础可以复用：统一服务端的 `GET /_web/api/session` 已能为未登录浏览器自动建立登录 challenge/CSRF；Desktop 的会话记录还承担 CSRF、内容流生命周期和 Service 入口归属，不必连同这些职责删除。独立 Desktop 保留 CLI 共享凭据；托管工作台继续按每个浏览器独立登录。

## Goals / Non-Goals

**Goals:**

- 入口和恢复只围绕真实账号、连接与配置状态；所有普通地址均无需终端授予浏览器权限。
- 删除证明/ticket 的签发、兑换、校验及 Access 专属状态，而由合法页面请求透明建立必要会话。
- 复用现有账号存储、共享凭据、内容访问生命周期和 UI 组件，保持修改集中于入口衔接。

**Non-Goals:**

- 不建立新的浏览器账号体系，不改变 CLI/Core 凭据共享或 operator 身份。
- 不重写文件、Service、事件流、Work 生命周期、模型配置或 Quick setup 表单。
- 不引入新依赖、数据库迁移、Windows Core 支持、全功能真实模型/Docker 发行验收或自动发布。

## Decisions

### 1. 首次创建复用普通登录 challenge

`onboarding.ts` 读取持久初始化状态，再从现有普通 session 接口取得 CSRF。空安装直接进入管理员表单；`setup/administrator` 使用同一个未登录 challenge 校验来源与 CSRF，并调用原子空用户集合 bootstrap。保留 Password/Confirm password 校验，创建成功后清理敏感字段并进入普通登录，不自动登录。

删除 setup 证明及专用 setup 会话字段、`setup/session`、`setup/redeem`、`/control/setup-link`、`SetupLink` 和 operator `setup link` 命令分支/帮助；`internal/app/run.go` 不再打印私密设置链接。废弃的 `WebSetupProofInput` 从契约源移除并使用既有生成入口同步产物。

采用现有 challenge，可以保留来源/CSRF 保护并直接删除整套安装者证明状态。只隐藏授权页仍会被后端拒绝；保留一个永远通过的证明入口会留下错误恢复和维护负担，均不采用。

创建冲突或结果未知先读取 `administratorInitialized`：已初始化进入登录，仍为空只允许用户明确重试；网络失败停留在读取恢复。旧 `#setup=` 片段移除/忽略，不再提交。

### 2. Desktop 普通会话由 session 读取自动建立

独立 Desktop 的 `GET /_desktop/api/session` 在精确来源校验后复用有效 Cookie，或自动建立普通 HttpOnly 会话及 CSRF。保留现有会话容量、到期回收及内容访问上下文；自动会话不是 Core 登录，不延长 Core token，不跳过用户/Work 权限。

删除入口 ticket 字段和签发函数、bootstrap 兑换路由、独立 browser-access/reset 路由及专属重置逻辑。保留正常 logout、平台身份代次及内容访问撤销。保护业务请求所需的 Cookie/CSRF 继续验证；会话缺失/过期时前端读取 session 恢复，用户不参与授权。修改被拒绝后只恢复提交上下文，原 mutation 不自动重发。

共享 `adapter.ts` 移除 `browserAccess`、检查/重置方法及 Access 专属错误跳转，用普通初始化/读取状态与真实 `signedIn` 承接页面。`app.ts` 删除门禁页、重置菜单/确认窗和终端重新授权提示；`export-flow.ts` 等读取该字段的调用点改用普通会话/账号状态，不伪造恒定 authorized。托管模式保持服务器独立账号会话，不读取宿主 CLI 凭据。

### 3. 地址与控制通道保持各自职责

启动和 `desktop open` 都输出实例准确 origin 的普通 URL。`user_desktop_control_protocol.go` 的返回地址验证同步改为精确普通 URL，Linux/Windows 客户端均使用它；仍拒绝错误端口、主机、额外查询/片段和伪造控制响应。保留同系统用户的控制通道、实例存活检查、open/logout 退出码与有界清理。

容器模式直接打开宿主 loopback 地址，无需先 exec open；open 仍可用于找地址。旧 `#ticket=` 只移除/忽略，不执行兑换。普通链接的可访问性不再依赖控制命令，OS 控制通道也不承担浏览器授权。

### 4. 正常路由覆盖全部恢复路径

```text
服务器普通地址
  +-- 没有持久用户 -> Create admin -> Sign in -> Admin Quick setup
  +-- 已有用户     -> 正常 Sign in / 已登录工作台

Desktop 普通地址
  -> 自动普通会话 -> 核验同 Core 共享凭据 -> 工作区 / 正常 Sign in
```

刷新、清 Cookie、新浏览器、旧链接、进程重启和普通会话到期均重新走上述路径。Core 明确拒绝账号时清除所属身份内容并正常登录；网络失败保留其真实读取/连接错误，不能清理共享凭据或回到 Access。普通会话恢复不恢复已撤销的业务权限，也不自动重放已接受的操作。

Cookie 被浏览器禁用时使用普通会话保存失败说明及重试；CLI 未运行时显示连接不可用及启动方向。两者均不出现授权链接、Check browser access 或 Reset browser access。

### 5. 只同步当前入口材料和必要验证

修改 `scripts/docker-quickstart-content.mjs`、官网生成源和一致性检查，移除获取/轮换设置链接及强制 open 授权步骤；从现有入口重生成双语部署手册、单机说明和对应模板内容。根 README 维持精简导航，历史下载和已发布 commit/hash/digest 保持原身份。官网生成先在 `dist/` 隔离输出验证，本变更不推送或发布。

受影响文件按职责处理：

| 模块 | 主要文件与职责 |
| --- | --- |
| 首次创建与普通认证 | `internal/webapp/setup.go`、`authentication.go`、`server.go`：删除证明与 setup 会话，复用 challenge，保留原子创建和正常登录 |
| 启动与 operator | `internal/app/run.go`、`internal/coreoperator/arguments.go`、`run.go`：删除设置链接输出和命令/路由 |
| Desktop 后端与控制 | `internal/cli/user_desktop*.go`、`hosted_desktop.go`：自动普通会话，删除 ticket/reset，调整地址验证，保持托管账号绑定 |
| 浏览器交互 | Console `onboarding.ts`；Desktop `adapter.ts`、`app.ts`、`export-flow.ts` 及直接引用点：删除 Access 状态/文案，保留既有英文 UI 和普通登录反馈 |
| 契约与资源 | `packages/contracts/src/web-onboarding.ts`、生成 Go DTO/schema/夹具、两端嵌入资源：与源代码同步 |
| 材料与测试 | 现有 Quick Start 生成/检查脚本、部署材料、入口与恢复测试：普通 URL 成为测试起点，不再从终端提取秘密 |

测试使用现有合成 Core/浏览器夹具和独立临时数据目录。首次安装的真实程序浏览器检查继续采用 `0.0.0.0` 监听后走实际非回环 IP，不要求公网或真实模型。既有夹具中等待 `First-time setup:`、构造 ticket、断言匿名页面无表单的逻辑必须同步调整。

文件、Service 与流只检查既有会话衔接和注销撤销断言，直接复用既有测试；不把本变更扩成这些功能的重新开发或整套发行验收。最终重建两套嵌入 UI、统一二进制和 CLI，并以重建产物完成入口检查，防止源码已改而运行页面仍是旧门禁。

## Risks / Trade-offs

- [首管理员由首个完成创建的人取得] → 使用已确认的直接创建策略；原子空用户约束保证只成功一次，之后只能正常登录，账号禁用不重开创建入口。
- [取消 Desktop 浏览器独立授权后，合法本机入口可使用实例共享登录] → 这是本次确定的交互边界；继续限制 loopback、精确 Host/Origin 和写入 CSRF，平台 token 只留后端。
- [旧夹具或共享前端错误分支重新引入 Access] → 入口、错误、过期、重启、注销各场景明确断言没有门禁，检查所有直接字段引用及嵌入资源；普通 Service 访问 grant 不属于此次删除的入口 ticket。
- [旧固定镜像仍包含原门禁] → 新流程适用于本次重建程序及后续发行，候选材料在隔离输出中核对；不宣称旧镜像已有新行为，不为新说明改写旧制品身份，正式固定引用更新仍随实际新制品发布执行。
- [已完成 README 变更尚未同步规格] → Docker 增量中的 DOCKER-DELIVERY-010/011 采用 `simplify-readme-and-add-github-badges` 的有效全文；后续先同步该变更，再同步本变更，本轮不改动其产物或主规格。

门禁专属要求在增量中使用 REMOVED 与完整替代要求表达，继续保留对应 Identifier；其他既有场景保留标题并更新普通会话下的期望，账号、来源和内容撤销约束不能因移除门禁被遗漏。

## Migration Plan

不改账号、安装目录或凭据文件格式。替换程序后，旧入口证明和 ticket 不再具有作用，普通页面自动取得必要会话；已有用户/模型/Work 数据保持。升级前后的正常程序关闭仍按原契约执行。

发布回退只需恢复旧二进制；旧版本重新执行其原入口规则，不需要数据库反向迁移。本变更只准备可验证的实现与构建，不执行镜像或网站发行。
