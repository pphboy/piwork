# Linux 统一启动验收

2026-10-19，本次 apply 的本地候选，未提交、未公开推送镜像、未发布官网。私有 `.env.test` 仅在获得用户授权后读取，用于网页配置 DeepSeek Flash 的真实连接；未把模型环境变量重新接回服务端启动。

## 制品身份

源码 commit 为 `7aa5f944fc2a56850a667de3b60fa26c8e4d378b`，dirty=true；最终源码输入 SHA256 为 `86db5b05c7673d071911cf72f0c589371febe4b2974d40e9aae7a1f549b34d75`。候选 release ID 为 `0.0.7-7aa5f944fc2a-86db5b05c767-dirty`。以下是本地 image ID，不是公开 registry digest：

| 角色 | Image ID |
| --- | --- |
| core（统一应用） | `sha256:27c4550a051d52f8572f259256f3300b60df139cf69d7873f590fe33ec0aab49` |
| cli（可选） | `sha256:f48d0c11cf80132e2d77cfb4fa85bcd5dfe9fd643b5f352645f68f027e65ca10` |
| agent / package-helper | `sha256:5a7107631e5e44ebb4f2a8c95e951360f49172d8d4c172acb8c75b92d0044ada` |
| file-helper | `sha256:545bac28d790ca27ab0875c04df5d7a60dd7ec48169ae11ec5b063cd901c62f2` |
| snapshot-helper | `sha256:517b4ee0d9930815e9642eabffe4e43c3d3251b49cb74f736f405ca389d50a53` |

Desktop 输入摘要 `9fd518b160ca4b9938280fa2c38a3410081e96bb3c634daadd971bf5d18e08e9`；Console 输入摘要 `5dfe8f8a4be0dbe8846324ccb6937a6ad4056735294110bf72ccb5c66146bd33`。实际镜像标签、二进制版本、两套资源、helper 协议、运行时依赖及嵌入默认引用经 collect 检查通过。原生发行二进制 SHA256 为 `716d3dfb5ee67b97f6845c09e396106487d0cf0d6b1ebd227c56001be67cb470`，实际打包验证其包含本候选依赖引用，静态链接且两套 UI 摘要一致。

本地可审阅输出为忽略的 `dist/unify-linux-startup/docker-materials/`、`dist/release/piwork-linux-amd64-7aa5f944fc2a.tar.gz` 和 `dist/unify-linux-startup/website-review/`。最后发布的 `deploy/docker/release.json` 保持原身份，当前材料使用独立 candidate。无 push 的发布预检通过。官网副本同时维护中英文当前导航、安装、First Work 和版本下载，未修改或发布相邻官网仓库。

## 安装与真实交互

服务端为独立 rootful Docker Engine 28.5.2；构建 Go 1.25.5、Node 24.20.0。远程客户端位于另一 Docker bridge 网络，只使用数字 IP 网页，实际浏览器为 Linux Chrome 155.0.8059.84 和 Edge 155.0.4283.62。

| 入口 | 初始化与模型 | 实际覆盖 |
| --- | --- | --- |
| 原生统一程序 | 无业务 env，网页创建首管理员、四字段保存模型及 runtime，真实首回复 9 bytes | Work、Files、Service、快照往返、正常停启、多账号；随后重建原生程序验证 HTTPS、受信代理、撤销 |
| 默认 Docker 镜像 | 独立 Engine 初始镜像数为 0，先拉统一 Core；进入引导前只有 Core，依赖由保存 runtime 后真实拉取 | 真实首回复、Files 201/412、配置 Save/Apply、ZIP 包上传及准备、Chrome/Edge Service、完整快照往返、重建恢复 |
| Core-only Compose | 另一独立 Engine 初始镜像数为 0；可选成对 ADMIN env 直接初始化账号，其余参数来自网页及嵌入引用 | Edge 真实首回复、Files 条件写入、存储不含密码/Key；错误 Agent 引用后恢复，无重复建模或付费 Test |

候选未公开发布，冷安装通过仅限本次夹具的私有 registry mirror 拉取同一候选字节。未预载 Agent/helper；此事实不等于公共仓库已可下载。宿主 Engine 26 未用于产品运行。服务器侧 NAT 夹具显式覆盖 public origin、Service 端口并使用 TCP 转接，客户端无额外配置；[Service 支持矩阵](service-support-matrix.md)说明网络覆盖的实际边界。

首次 Docker 夹具预创建 bind 根目录属于测试用户 UID 1000，被 root 运行的 Core 拒绝；把该空目录归属纠正为 UID 0 后完成初始化。默认 Docker 自动创建的 root bind 路径及 Core 的私有目录规则未放宽。

| 对象 | 原生安装 | 最终 Docker 安装 | Compose / ADMIN |
| --- | --- | --- | --- |
| Work | `work-5ac35aaa-62cd-476d-943f-ec564f76fbc4` | `work-0353ec9a-4ad9-4156-82fe-b4818d7d12db` | `work-003ac5eb-c85b-44e1-957e-ec033e0067ae` |
| 真实模型 Run | `run-b0bc67a2-7083-4f5e-baaa-4720a74fc75d` | `run-cf76f1fd-a201-430c-abdc-b9270679c873` | `run-2cdb98fc-5239-4b0a-a8fa-3bc2ca7abc46` |
| 导出快照 | `snapshot-c71c59bc-c119-49e7-8240-85463d025ef2` | `snapshot-bc830bf1-05f4-4573-8cac-29810eca6ada` | 未重复此矩阵 |
| 导入 Work | `work-9c978120-ddae-4aa8-bf9f-f00473bcfee7` | `work-c8d549fb-b404-4c42-985a-213a3b8a4f75` | 未重复此矩阵 |

两次快照闭环均经真实浏览器 Stop、Export、下载大小/SHA256 校验、上传 Inspect、Import（初态 stopped）及显式 Start，原文件 sentinel、模型 Run 和历史保留，没有为验证历史重新发消息。最终 Docker Work 的 AGENTS.md Save 保持旧 active，ZIP 包经独立准备后显式 Apply 生效。图片拾取/移除在远程托管页面验证无 Run 副作用；`TestNativeChatImagesAndOfflinePackageRoundTrip` 通过实际 SDK、合成受信模型网关验证大图片、原字节、元数据历史、幂等及源离线包续用（99.11s），不能当作真实模型视觉理解验收。

## 恢复与权限

- 缺管理员/模型时主站和 health 可用、ready 非 ready；缺 Docker 的独立进程验收通过，异步恢复状态由只读等待确认。
- Compose 保存不可达 Agent 镜像后实际报告 `IMAGE_UNAVAILABLE`、retrying 和重试时间；离开后登录返回 `/setup`，既有一个模型仍保留；修正镜像后 ready 恢复，再创建 Work 得到真实回复。最初驱动错误等待永久 failed（实际状态为 retrying），随后按公开状态恢复，没有重建模型。
- 原生正常退出实测 20.263s、29.389s、40.976s，本安装运行容器清零、数据/卷保留。最终 Docker 正常退出 31.008s、exit=0，4 个受管持久卷保留；重建同一镜像及数据 bind 后 installation ID `installation-e9f091a5a640703f28d3943ecbdd6a19` 不变，恢复 ready。
- 最终 Docker 重建后原 Work 保持 stopped，导入 Work 保持 running；原用户、模型、Run 与历史读取通过。旧浏览器会话要求重新登录，无未知修改重发。另一普通账号看不到/不能读取他人 Work；另一管理员可读全局元数据和控制，但读取他人文件被拒绝。
- 上一已发布 CLI 镜像 `0.0.7-19fc33907232-3ab753f8a90a` 使用自己的临时凭据卷登录最终 Core，读取 whoami、Work、配置、包、Service 及原 Run；CLI 注销后托管浏览器仍已登录。该测试卷已按精确名称删除。
- 当前浏览器注销保留同用户独立登录；账号禁用撤销所属内容流且不停止 Work；启用后正常登录读取原 Run。具体延时及 Service Cookie 边界见支持矩阵。

## 检查与未执行边界

- `npm ci`、`make generate`（221 schemas / 7207 TS oracle fixtures）、`make build`、`make test` 通过；最后纯构建脚本修正后再次执行全部 85 项脚本测试，通过。
- Desktop 浏览器套件 848 项：847 pass、0 fail、1 项原有五分钟 ticket 实时等待场景 skip；Console 75 pass。新增引导场景覆盖无 env / ADMIN、刷新/重启、丢响应读回、旧 preparation 晚结果、路由前进后退、360px 和键盘。
- Service gateway race 测试及托管 Service/transfer 身份测试通过；真实统一程序无宿主工具进程验收通过；真实图片/离线包 integration 通过。曾因错误工作目录找不到测试图片的运行未计为通过，按包目录执行后通过。
- `make build-cli` 完成 Linux/Windows amd64；Linux 平台检查的依赖字节绑定、存储、symlink、Files、auth、Desktop 控制、interrupt、默认启动、偏好 API、proxy 和独立运行通过。其余外部场景报告保留 unverified（其他 OS 用户、偏好浏览器夹具、旧 Core 命令族/包快照专用夹具、浏览器隔离与 TLS 负向专用夹具），不伪装整份平台报告全通过。
- 原生边界、仓库文档、Quick Start/官网副本一致性、diff 格式和本变更 strict 校验通过。发行预检仅 check；本地测试仓库传输不构成公开发布。
- Windows 原生运行、Windows OS 上浏览器、实际 IPv6 网络、物理远端主机的 host 网络直连、公开 registry 匿名拉取、官网线上发布未执行。IPv6 URL/精确来源为单元覆盖；构建 Windows CLI 不替代原生验收。

安装者证明、私钥、真实模型 Key、浏览器 Cookie、Core token、Core 数据及 `.work` 原始归档均仅留本机忽略目录。证据只保留非秘密身份、对象 ID、实际结果和限制。

收尾：三个独立验收 Engine 和私有 registry 均已停止，数据与 Engine 卷保留；服务器转接进程已退出。清理只使用本次生成的名称、PID、installation ID 和标签，原有运行容器保持不变。
