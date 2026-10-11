# Core 0.0.5 发行记录

日期：2026-10-11。Piwork 0.0.5 Preview 同版交付 Core、CLI、Agent、file-helper、snapshot-helper；package-helper 复用 Agent。包含 Work 准备优化、Chat 图片、About/内置日志和 application-awareness Skill。NiceGUI base 继续复用已发布 0.2.0，不重建或改写其身份。

## 固定身份

- 发行标识：`0.0.5-c3e361a44a6b-f327ba4d903f`。
- 构建源码：`c3e361a44a6b19de88c7c8b0b20c6aad18a71f4f`，dirty=false。
- 源码输入 SHA256：`f327ba4d903f9985f08e86af2a7720673ea1a5e90d19cb9a573ef819d2a6e246`。
- 内置脑包：1.2.2；平台 Linux amd64；Go 1.25.5，Node 24 构建。

| 角色 | 匿名验证的 registry digest |
| --- | --- |
| core | `sha256:1190101b79a2d009f9b2440af3f91cecd3d061e66a290dd41b602fc2ca8e6df9` |
| cli | `sha256:7b5cf1ad3d487819c822932b4889f9880d5873727f616fcc10d3a242c7e80f82` |
| agent | `sha256:5ba2df4959c359d4e9541f4cdeeddb2579b74974e9b9f8580cf037cf60c347b0` |
| fileHelper | `sha256:5ff89fd8f16ad322375044a992686455cc085a33d4d560e1a2f34837c2b7ed7c` |
| snapshotHelper | `sha256:6a71adec178dc1bb82d3125c3a85499f43a70f00af7c31178376269a42245f4b` |

完整身份见[正式清单](../deploy/docker/releases/0.0.5-c3e361a44a6b-f327ba4d903f.json)，历史 [0.0.4 记录](core-release-0.0.4.md)保持原事实。

## 验证与采用

- 干净构建源码：`c3e361a44a6b19de88c7c8b0b20c6aad18a71f4f`，dirty=false；源码输入 SHA256：`f327ba4d903f9985f08e86af2a7720673ea1a5e90d19cb9a573ef819d2a6e246`；内置脑包 1.2.2。
- 完整 `make test` 重跑通过，包括全部 Go 包、脚本 68 项和 TS 37/8/62/18/111 项，Desktop/Console 类型检查通过。发布脚本定向 23 项通过。
- 首轮 operator 状态测试在异步默认环境尚为 preparing 时断言 ready，连续复测可重现。测试改为有界等待原实际状态，未放宽最终 Ready/输出/凭据断言，整包连续 5 轮及完整测试通过。首轮源码候选废弃，未发布。
- 五角色 Docker 版本/commit/dirty/源码 hash/平台/协议标签及 Core/CLI 运行边界核对通过；实际 Agent sqlite3 CLI 通过。网络重试仅改变构建代理配置，未替换源码或依赖锁。
- 实际 Core 镜像隔离启动烟测通过，13.019 s：health、docker-delivery readiness、脑包目录 1.2.2、已发布固定 NiceGUI base 和同版 CLI 连通。使用合成初始化配置，没有真实外部模型 Run。
- 五角色经过全量本地/远端身份预检后发布，并以空 Docker 配置匿名拉取各固定 digest；拉取后的 image ID 和实际程序版本匹配。独立 NiceGUI base 匿名拉取复核通过，保留原 tag/digest/source/dirty 身份。
- 七个原生程序均为 Go 1.25.5 Linux amd64 静态程序；发行原生包交付 Core/CLI/Console。Windows amd64 CLI 已实际运行版本与帮助，匹配 commit/modified=false 和 Desktop 输入摘要；完整正式 Windows 原生验收仍待完成，附件标为实验性。
- 应用认知与 NiceGUI 页面故障验收见仓库 `docs/application-awareness-acceptance.md` 和归档验证报告。其浏览器证据有各自真实构建身份，不冒记为本发行镜像的完整浏览器回归。
- 本次没有重复完整 `make acceptance`、全平台/性能对照/真实外部模型运行或完整冷导入矩阵；未重新部署 Fedora 或官网。历史一次首次页面加载超时的根因未知，后续通过不代表已修复其根因。
- 原生与 Docker 归档包含内部 SHA256SUMS；发行根 SHA256SUMS 覆盖公开附件。真实凭据、私有数据、诊断原日志及密钥不进入附件。

构建源身份固定，发行 tag 额外包含发布材料提交；Git 提交不同不会改写已制作制品身份。旧 Work 通过 Package Update 和显式 Apply 采用新脑包，原 active/镜像/源码/数据保持。

升级前正常停止 Core，备份完整 Core 数据、Work 卷和私有配置，使用匹配发行组件启动；管理员包定制与默认选择保持。操作说明见 [Brain 加载与采用](piwork-brain.md)、[Docker 手册](../deploy/docker/README.zh-CN.md)与 [Desktop](desktop-webui.md)。

本机安全构建/烟测/匿名验证记录位于忽略目录 `dist/docker/core-0.0.5/`，附件位于 `dist/release/0.0.5/`；发行状态与正式清单对应，不将源码验证扩大为任意模型能力保证。
