# Tasks

## 1. 首次安装直接创建管理员

- [x] 1.1 将网页首管理员创建接到现有未登录 challenge/CSRF，删除 setup 证明、专用 setup 会话及兑换/检查路由；更新 `internal/webapp` 测试，验证普通地址可创建、非法来源/CSRF 拒绝、并发至多一个成功，以及已有用户或账号禁用后不重开创建入口。
- [x] 1.2 删除启动私密链接输出、operator `setup link` 命令/帮助和控制路由，移除 `WebSetupProofInput` 并同步生成 DTO/schema/夹具；运行 `make generate` 及受影响的 app、coreoperator、contracts 测试，确认旧命令不再签发证明、普通启动地址仍可取得，既有 operator/env bootstrap 保持。
- [x] 1.3 删除 `onboarding.ts` 的 authorization 阶段、证明兑换、Check setup access 及授权失效/未知结果回退，复用普通 session；同步 `onboarding.test.ts` 的启动等待和浏览器夹具，验证直接 IP 创建、两次密码确认、创建后普通登录、已初始化页面、未知结果只读恢复，以及旧设置片段不再触发授权。
- [x] 1.4 更新首次安装的 Quick Start 内容源、官网生成源及检查器中获取/轮换链接的断言，准备对应双语部署/单机材料；用合成候选在隔离输出中通过 `node scripts/check-docker-quickstart.mjs` 和 `node --test scripts/check-docker-quickstart.test.mjs`，确认新流程直接打开 IP、适用于本次重建/后续发行，根 README 仍精简；不宣称旧固定镜像已有新行为或改写其身份。

## 2. Desktop 普通地址登录与恢复

- [x] 2.1 在独立 Desktop session 读取中自动建立/恢复普通 Cookie 与 CSRF，删除入口 ticket/兑换及浏览器重置 API/状态；同步 Go 认证和恢复夹具，运行 `go test ./internal/cli`，验证无 ticket 初始化、Cookie 到期/丢失恢复、共享凭据按 Core 核验、来源/CSRF 拒绝、普通会话容量及既有账号注销/内容撤销断言，不重写文件或 Service 业务。
- [x] 2.2 将启动、容器启动和 `desktop open` 的输出改为普通 URL，更新公共控制协议及 Linux/Windows 地址校验与对应测试；验证重复 open 不轮换会话、不改 PID/Core，错误主机/端口/额外片段不能被控制响应接受，原退出码、同用户实例归属、logout 条件清理和容器健康检查保持；Windows 运行事实与交叉编译结果分别表述。
- [x] 2.3 删除共享前端 `browserAccess` 状态及检查/重置方法，清理 `app.ts`、`export-flow.ts` 和直接引用点中的门禁、弹窗及重新授权文案；更新 local-auth、native-auth、control-adapter、recovery 等受影响测试并通过 Desktop 工作区浏览器测试，验证正常登录/共享登录、About、清 Cookie/过期恢复、退出、旧链接、网络/CSRF 失败与晚响应均不回到 Access，修改不自动重发。

  验证：Desktop 全量浏览器运行 876 项，874 通过、1 项真实 Engine 场景按本次范围未启用；唯一失败为 ADMIN 夹具仍断言原设置链接为空，修正为“不输出设置链接”后该场景单独复测 1/1 通过。管理界面浏览器测试 79/79 通过。
- [x] 2.4 同步 Desktop/容器的双语启动与重新打开说明及所属检查夹具，明确 open 只是可选打开普通地址；运行对应材料一致性测试和官网隔离生成检查，确认没有强制取得新链接、Check/Reset browser access 或终端重新授权步骤，既有状态卷、端口和凭据共享说明保持准确。

## 3. 构建产物与入口集成核对

- [x] 3.1 使用 Node 24、Go 1.25.5 重建两端 WebUI 嵌入资源、统一服务端和独立 CLI（`make webui-assets build-go`、`make build-cli`）；核对源资源与嵌入内容/构建身份一致，并通过对应类型检查和 `node scripts/check-native-boundary.mjs`。Linux 执行入口检查，Windows CLI 核对编译及公共协议测试结果，不据此宣称 Windows 实机通过。

  验证：41 个嵌入资源与工作区构建逐字节一致，实际服务端与 CLI 的两个 UI hash 均匹配当前源码；Linux/Windows amd64 CLI 构建成功，Windows `internal/cli` 测试交叉编译成功，未执行 Windows 实机测试。Linux 候选通过独立运行环境 smoke（源码目录外、PATH 排除开发工具）。
- [x] 3.2 使用重建的实际程序、独立临时数据和现有合成夹具完成两入口集成：统一程序监听 `0.0.0.0` 后通过实际非回环 IP 创建管理员/登录/进入 Quick setup；独立 Desktop 从普通地址正常登录或复用共享凭据。覆盖新浏览器、刷新、清 Cookie、程序重启、旧链接和 Sign out，确认均无 Access 页面/动作；不要求公网、真实模型或整套 Docker 功能验收。

  验证：全量浏览器回归使用 `dist/go/` 实际程序及隔离目录；统一服务端绑定 `0.0.0.0`，通过机器非回环 IP 完成创建、普通登录与 Quick setup。最终 `dist/cli/linux-amd64/piwork-cli` 另通过 native-auth 浏览器场景 6/6，包括共享登录、新浏览器、清 Cookie、正常注销、重启、Core 拒绝/离线、旧链接及已接受导入不重发。
- [x] 3.3 核对前后端、嵌入资源、启动/控制输出和当前生成材料中没有仍生效的设置证明、入口 ticket 签发/兑换、独立 Access 状态或恢复提示（旧链接解析仅作忽略兼容，Service 业务 grant 保留）；执行 `node scripts/check-repository-docs.mjs`、`git diff --check` 和本变更严格校验，确认规划、实现及材料一致。临时输出放 `dist/`，不自动同步/归档主规格或发布镜像/网站；后续规格同步先处理 README 变更，再处理本变更。

  验证：相关 Go 测试、双端类型检查、源码边界、文档归属、材料检查 38/38 及 diff 检查通过。严格校验为 valid；唯一 INFO 是 Docker README 新标题依赖已完成但未同步的 `simplify-readme-and-add-github-badges`，按既定顺序先同步该变更再处理本变更。当前生成说明区分本次重建行为与旧固定镜像，未改写既有发布身份或历史手册；本次未发布镜像/网站，未同步或归档规格。

- [x] 3.4 修复核验 WARN：初始化超过十秒仍挂起时，在原等待区显示可用的 Retry connection；显式重试取消旧会话读取并建立新的只读检查，旧响应不得覆盖新结果，不重发登录或业务修改。覆盖独立/托管模式及 Cookie 确认读取挂起的浏览器测试，重建嵌入资源和实际程序并核对构建身份。

  验证：新增 3 个挂起场景通过；local-auth、native-auth、export-flow、action-hierarchy、overlay-role 浏览器测试共 212/212 通过。`internal/cli`、`internal/webapp`、`internal/app` Go 测试、双端类型检查和边界检查通过。已重建 Desktop 嵌入资源、统一程序与 Linux/Windows CLI；41 个资源逐字节匹配，程序 UI hash 匹配源码，最终 Linux CLI 独立环境 smoke 通过。日志位于忽略的 `dist/remove-browser-gates/verify/`。
