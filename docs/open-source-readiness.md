# 开源发布前检查

检查日期：2026-10-06。检查范围：当前源码与全部本机 Git refs 的历史，忽略的本机运行数据不进入源码副本。没有对外发布或改写 Git 历史。

## 目录约定

- Go 程序入口：cmd/；Go 包：internal/（包目录沿用 Go 的小写命名）。
- TypeScript 应用：apps/；共享包：packages/；工作区目录使用小写连字符命名。
- 两个 Web UI 的浏览器测试统一为各自的 test/；包内单元测试继续与源码放在一起。
- 公共文档：docs/；架构图、Desktop 原型与评审材料统一放在 docs/design/。原 arch/ 与根目录的两个 Excalidraw 文件已归入这里，引用同步更新。
- 构建、生成与验证入口：scripts/；Docker 部署示例：deploy/docker/。
- 合成测试数据：fixtures/ 和 Go 包的 testdata/；OpenSpec 规范与历史记录：openspec/。

## 临时文件与忽略规则

删除了空的 .vscode/settings.json，以及归档中依赖当次工作树和已失效 /tmp 二进制的一次性网络隔离脚本；其执行结果与隔离拓扑记录仍保留。清理本机已移除 TS 工作区残留的 dist/ 和 tsbuildinfo，共十个无跟踪源码的目录。其余 scripts 均属于构建、生成、发布或验收入口；两个原先未接入 make test 的脚本测试已纳入统一发现。测试/夹具中的 console.log 是输出与协议检查的一部分，生产源码没有独立 debugger 或一次性调试入口。

.gitignore 覆盖工作区依赖、产物、Playwright 输出、env、本机 .piwork* 安装数据、SQLite、凭证、私钥、日志和编辑器文件；env.example 及 Work 格式的明确合成 testdata 继续可跟踪。.dockerignore 同步排除本机环境、数据、日志与私钥；Core/CLI 镜像仍使用只允许目标二进制的各自构建上下文。

## 敏感信息与测试数据

[Gitleaks 8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1) 默认规则对源码与全部 refs 的历史扫描初始命中 13 项，逐项核对为公开 URL 片段、fixture 名称 SHA256、固定包摘要、RFC6455 示例 nonce 和历史测试 secretId。不是可用 API key 或登录 token。.gitleaks.toml 保留全部默认规则，每个误报豁免都要求文件路径与已核对的具体值同时匹配；不排除整个 testdata 或 tests 目录。另用未知的随机合成 key 写入已豁免的 fixture 路径，扫描仍成功报警，确认没有整文件豁免。原始脱敏报告保存在本机 dist/open-source-audit/。

另以本机 .env.test 中的真实管理员密码和模型 key 检查全部 2693 个历史 blob，命中 0；扫描不输出这些值。.env.test 仍留在本机且被忽略。必要的 fixture、协议 golden 数据和验收编号保留，它们用于复现测试，不含用户业务数据；不能通过删除它们让扫描假通过。

当前文档/报告中的开发机绝对路径已改为仓库相对路径、$HOME、%TEMP% 或环境占位符；历史环境的 LAN Core 地址已改为 <core-host>。固定容器路径、loopback、安全测试中的合成 IP、公开镜像仓库及 immutable digest 保留。已提交的旧历史仍包含旧路径，这次没有改写提交历史。

复核命令（先从官方发行取得 Gitleaks 8.30.1 并校验其 checksum）：

```sh
gitleaks git --config .gitleaks.toml --log-opts=--all --redact --no-banner .
git diff --check
node scripts/check-native-boundary.mjs
```

历史扫描不包含尚未提交的改动；本次另外导出当前待交付的 1310 个文件，以同一规则执行 gitleaks dir，命中 0。个人绝对路径与大小写路径冲突均为 0，JSON 文件解析通过。不要直接扫描本机忽略的真实 env 后把报告提交。

## 干净 clone 验证

基线独立 clone 已在 Node 24.20.0、Go 1.25.5、Linux amd64 执行 npm ci、make build、make test 并通过，不复制本机 node_modules、dist、env 或安装数据。整理后的独立副本也已通过同一构建/单元测试流程、Windows/Linux CLI 构建、Console 合成浏览器测试 46/46、Desktop 浏览器测试 220 通过/1 跳过（无失败），以及 Core 启动、CLI 管理员登录与真实 Chromium Desktop 页面。Core 和 Desktop HTTP 均为 200，Core 正常关闭 exit 0，所有 smoke 安装数据随后移除。浏览器只使用临时生成的合成凭证，不调用真实模型。

Console 真实 Core 测试曾暴露保存 runtime 后未等待后台准备、以及包用例依赖上一用例的前置状态；已补齐 readyz 等待和独立初始化，覆盖已有 runtime 时进入编辑状态。需要 Docker 的 Console 真 Core 测试与合成 HTTP 浏览器测试拆为 test:real-core / test:browser，并继续同时接入 make test-integration。单独只执行 Package 用例已通过；包含最终源码的第三个独立干净 clone 也已通过 npm ci、make build、make test、Windows/Linux CLI 构建及完整真实 Core 浏览器测试 3/3，再次通过 Core/CLI/Desktop 登录 smoke。Desktop 跳过的一个用例需要等待真实五分钟的 ticket 过期，未计为通过。

本机验证日志保存在被忽略的 dist/open-source-audit/，包括 release-final-results.json、release-final-*.log、console-browser-verified.log、desktop-browser-verified.log、clone-startup-smoke.json 和脱敏扫描报告。验证使用的临时 clone 与安装数据在检查结束后清理。

构建与测试不要求真实模型 key；实际 Work 的模型 Run 仍需配置可用模型，Docker Engine/浏览器/SELinux 的完整发行验收按 docs/testing.md 和对应既有交付记录执行。这次检查不冒充新的 Windows 或完整 Docker 端到端验收。

## 许可证与提交范围

维护者已确定采用 Apache License 2.0。根目录 LICENSE 使用 Apache 官方完整文本，README 和根 npm 元数据同步声明 Apache-2.0。本次提交包含已验证的仓库整理及许可证，不进一步处理旧 TS Core 分支或提交历史；没有推送或触发发行。
