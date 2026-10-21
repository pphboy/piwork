# simplify-linux-delivery 验收事实

执行日期：2026-10-21。实现未提交、未推送、未发行；本附件记录本次执行，不提升历史验收状态。

## 本地候选

- 版本：0.0.10；releaseId：`0.0.10-a6c36da16ebc-f1b82b8572fb-dirty`。
- 真实源码 commit：`a6c36da16ebcc0e96f0e34ef820d857f2bea4877`，modified：true。
- 源码输入 SHA-256：`f1b82b8572fba3c64e387e0ddecd3e0676051baf1ad048d291eb72145d797222`。
- `make -j4 release` 成功；`dist/go` 和包内 `bin` 精确包含 `piwork-core`、`piwork-cli` 两个静态 Linux amd64 ELF。
- 成品目录：`dist/release/piwork-linux-amd64-a6c36da16ebc`，同级仅对应 `.tar.gz` 和外部 `.sha256`；完整身份见包内 `release-manifest.json`、`programs.ndjson`、`SHA256SUMS`。
- Core、Agent、fileHelper、snapshotHelper 四个独立镜像身份；packageHelper 复用 Agent。生产候选没有 acceptance 镜像引用。
- 最终源码输入、两套 UI 摘要、二进制版本与镜像身份一致。0.0.9 及更早日志、`deploy/docker/release.json` 与历史 releases 无改写。

## 实际执行

| 检查 | 本次结果与定位 |
| --- | --- |
| 独立检出 | 本地独立 clone 叠加本次未提交修改；`npm ci`、`make build`、最终 `make test` 成功。后者包含全部 Go 单元测试、85 项脚本测试、257 项保留 TS 业务测试及两套 UI 类型检查。日志 `dist/simplify-linux-clean-test-0.0.10.log`。 |
| Core 生命周期 | app/Core/Webapp 测试覆盖三参数拒绝、无副作用查询、三端口占用、部分启动失败、存储锁、listener 异常结束、来源与会话绑定。`TestNativeCoreProcessHealthIdentityRestartWithoutHostTools` 实际执行成功，覆盖 operator HTTP、第二进程锁拒绝、会话重启保留和 Engine 不可用。日志 `dist/simplify-linux-process-verified3.log`。 |
| Desktop 浏览器 | 879 项通过；另 1 项默认关闭的真实 Engine opt-in 场景未计为通过。实际新入口的网页引导/依赖/Work 路径由下述最终制品验收另行执行。日志 `dist/simplify-linux-desktop-browser.log`。 |
| 管理浏览器 | 79 项通过；真实 Core 的 5 项全部通过，含用户管理、撤销、Skill 上传、模型与 Runtime、Package 安装及 Operation 深链接。日志 `dist/simplify-linux-console-browser-verified.log`、`dist/simplify-linux-console-final4.log`。 |
| Desktop + 真实 Core | 完整脚本成功，含实际 SDK、Service iframe、Files/WebDAV、未知写入恢复、配置 Save/Apply、停止/重启、浏览器导出下载一次、Inspect/Import/Start、原 Session 继续及删除；无页面重新加载，测试安装容器/网络/卷均清理。日志 `dist/simplify-linux-desktop-real-verified2.log`。 |
| Linux CLI | `make build-cli` 和最终 0.0.10 native smoke 成功，验证任意 cwd、无开发工具 PATH、嵌入资源、默认 Desktop 与本机控制。另以实际 UID 65532 验证不能读写 UID 1000 的私有测试文件或连接其正在运行的 Desktop socket；真实候选的 HTTP/TLS 拒绝回归通过。日志 `dist/simplify-linux-cli-native-0.0.10.log`、`dist/simplify-linux-other-uid.log`、`dist/simplify-linux-cli-tls-negative.log`。 |
| Core Docker | 最终 0.0.10 候选镜像默认 CMD、空业务 env、HTTP health/setup、正常停止/启动和 operator 凭证持久化通过；最终 collect 校验 Core 镜像无宿主开发工具，内部镜像边界检查通过。日志 `dist/simplify-linux-core-image-0.0.10.log`、`dist/simplify-linux-image-boundary-0.0.10.log`。 |
| 最终两程序包 | 使用最终 0.0.10 发布包运行 `PIWORK_TEST_RELEASE_BIN=dist/release/piwork-linux-amd64-a6c36da16ebc/bin node scripts/native-host-acceptance.mjs`，成功。详见下一节与 `dist/simplify-linux-native-0.0.10.log`。 |
| 干净替换 | 实际 A（0.0.9）→B（0.0.10）→B；植入旧 Windows 目录/报告后替换只剩当前三项。实际归档工具、checksum 工具失败及缺失构建输入均非零退出，上一份归档字节不变。注入编译器失败时两个生产程序字节不变；非受管输出拒绝且合成哨兵数据不变。单元测试另覆盖中断恢复、符号链接与危险路径。日志 `dist/simplify-linux-package-replacement.log`、`dist/simplify-linux-build-failure-final.log`。 |
| 材料 | native boundary、repository docs、Docker Quick Start 检查成功；生成器测试包含候选 A/B 同步。最终双语官网隔离预览位于 `dist/simplify-linux-website-preview`，当前命令/下载材料检查通过，未写外部官网。 |
| OpenSpec | 严格校验成功，12 个 delta 只读合并预览无 warning。预览中的 Service 命令表及仍有效示例文字保留；退役 operator 命令附带的示例声明随对应旧条款删除。主规格未同步/归档，四个 Purpose 的同步内容已列入 design。 |

## 最终制品运行环境与边界

本机主 Engine 为 26.1.5。按用户“就是本地的”要求，全部本次隔离运行使用本机 Docker 内的 Engine 28.5.2，没有连接外部 Engine，没有改造或清理宿主已有安装。测试自建网络、数据卷及 Engine 按精确身份清理，没有全局 prune。宿主自动地址池不足时只为测试分配明确私有子网；进程/浏览器夹具使用同路径共享的 `/var/tmp`，避免 DinD 的 `/tmp` 重挂载和过长 Chromium socket 路径。

最终验收将发布包两个原样程序复制到 scratch 环境，PATH 不含宿主工具；使用生产 Agent/helper 镜像。实际完成：

- 浏览器创建管理员和登录，管理 API 配置模型/运行环境，operator API 独立授权；普通用户不能访问管理 API 或其他用户 Work。
- 两个真实 IPv4 接口、默认和自定义 HTTP 双端口、错误 Host 拒绝、跨入口 Cookie 重放拒绝，浏览器请求仅进入 UI。
- 实际生产 Pi SDK/MCP 创建 Service；浏览器 Service 前缀、服务端响应 Cookie 往返、SSE 和 WebSocket。
- Linux CLI/Desktop、文件读写、快照 Export/Inspect/Import/Start 与数据核对。
- 浏览器/CLI 退出不停止 Core；Core 正常退出停止本安装 Work，其他安装哨兵容器不受影响；重启复用 operator 凭证、用户 token、Work 意图、文件和完整会话历史。

模型响应为明确的合成 HTTP fixture；SDK、MCP、Core、Docker、Service、文件及快照路径均为真实实现。管理模型 Test 使用合成 HTTP 提供者检验实际 Responses/Messages 请求与回复；未调用付费真实模型。浏览器为 Linux Chromium 140.0.7339.186，未执行 Windows 浏览器测试。

未执行整个 `make acceptance` 的所有历史专项矩阵。早期 `check-cli-platform` 汇总中的外部 fixture 项未全部接入该报告，未把该汇总声明为完整平台认证；上述实际命令、浏览器、跨 UID 与 TLS 检查单独记录。不推送镜像、不上传归档、不发布网站、不归档 OpenSpec。
