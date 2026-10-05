# Tasks

HTTP 协议调整：受 `allow-http-core-connections` 影响的 5.1–5.5、6.1、6.4、6.5 已根据新候选复验恢复；当前 23/32。详见该变更验证报告。原未完成的其他平台/发布验收保持；HTTP 变更 4.2 的实际空命令验收仍因端口不可用而未完成。

按组顺序实施；每项的验证属于该项交付。下文“原生”指对应 Windows/Linux 环境实际执行，交叉编译不能代替。必要的测试用户、网络存储或控制事件 fixture 缺失时记录未验证，不能把该验收标记完成。

## 1. 隔离客户端依赖

- [x] 1.1 将 Console 实现及所属测试迁到 `internal/consoleapp`，修改 `cmd/piwork-console` 入口并移除 `cli.Entry` 的 Console 依赖；仅提取设计规定的纯辅助到 `internal/localweb`。验证：Linux Console 原单测通过，`go list -e -deps -json ./cmd/piwork-cli` 不再包含 Console 实现/资源，原版本和帮助输出保持。（CLI-PORT-001、007）
- [x] 1.2 将 Pi 包的 CopyTree、NPM tar 解包、ZIP 解包/安装发布及其专用测试放入 Linux 文件，保留扫描、manifest/ZIP 验证和客户端打包公共层。验证：Linux `go test -mod=readonly ./internal/pipackage` 通过，原模式、链接、摘要和危险归档负例保持，公共客户端接口未被 stub 替换。（CLI-PORT-001、004、005）
- [x] 1.3 在 `docs/cli-platforms.md` 记录客户端/Console/服务端依赖边界及运行和构建依赖的区别。验证：说明与新的 import 图一致，没有宣称 Core/Console 支持 Windows，也没有增加用户运行时的 Go/Node/Docker 要求。（CLI-PORT-001、007）

## 2. 原生文件访问与私有存储原语

- [x] 2.1 新建 `internal/clientfs` 公共原语和 Linux 后端，覆盖固定目录、普通文件安全打开、私有创建、原子替换及不覆盖发布；保留 Linux 凭证实现及各状态原锁位置。验证：Linux 原生测试覆盖链接/硬链接/父目录替换、目标并发创建和中断，不覆盖已有文件，原凭证安全测试仍通过。（CLI-PORT-002、004）
- [ ] 2.2 实现 Windows SID、受保护 DACL、固定目录 handle、NtCreateFile 不跟随重解析点及普通文件/所有权/硬链接校验。验证：Windows 原生 `clientfs` 测试覆盖私有创建、另一 SID 拒绝、宽泛 ACL、junction、链接、设备/ADS 和目录替换竞态；外部哨兵文件未被读写，不要求客户端账号拥有管理员权限。（CLI-PORT-002、004、005）
- [x] 2.3 实现 Windows LockFileEx、私有完整写入/同步、固定父目录原子替换和原子不覆盖发布，区分提交前失败和提交后未确认。验证：Windows 原生多进程锁、崩溃释放、半写入、目标竞争、随机/同步/发布故障测试通过；只读观察得到旧或新完整内容。（CLI-PORT-002、004；DWUI-DEFAULT-CORE-002）
- [x] 2.4 实现两平台文件身份、可用磁盘空间和进程存活后端，未知身份/存活/空间按设计安全处理。验证：原生测试覆盖文件替换/修改、空间不足、活跃/陈旧/无法确认的进程目录，只有确认陈旧资源可清理。（CLI-PORT-004）
- [x] 2.5 补充 `docs/cli-platforms.md` 的存储隔离、显式配置路径及测试 fixture 用法。验证：每个平台的原生测试命令可照文档执行，缺失其他用户或链接 fixture 明确产生未验证记录，未将测试环境能力写成产品 OS/架构限制。（CLI-PORT-002、007）

## 3. Windows 凭证与认证兼容

- [x] 3.1 为凭证路径增加 Windows 用户配置目录回退，保留 `PIWORK_CONFIG_PATH`、显式 XDG 和 Linux HOME 顺序；显式相对路径在需要状态时固定为绝对位置。验证：两平台原生路径表测试覆盖默认、覆盖、中文/空格及缺失目录；帮助、版本、语法错误和离线 Inspect 不新增状态 I/O。（CLI-PORT-002；CLI-DEFAULT-001）
- [x] 3.2 实现 Windows `credentialDirectory` 对既有 Load/Save/Clear/ClearSession 的适配，保持凭证 v1、Core origin 绑定和失败保留规则。验证：Windows 原生认证/存储测试覆盖保存后新进程复用、失败登录保留旧凭证、不安全目标拒绝及另一 Core 无 token；Linux 原格式 fixture 仍可读取。（CLI-PORT-001、002）
- [x] 3.3 拆分凭证和退出的 OS 测试辅助，保留公共断言并增加 Windows 多进程登录/条件清理测试。验证：同一锁下 A 退出与 B 登录交错后 B 保留，锁竞争、损坏记录和删除失败有准确结果；Linux 既有并发/安全测试通过，不能用 Windows skip 代替。（CLI-PORT-002）

## 4. 完成命令族的平台后端

- [ ] 4.1 将 Pi 包扫描、ZIP 安全打开/打包接入平台文件原语，在 `internal/client/package_source.go` 实现供校验与上传共用的来源解析。验证：`pipackage` 和 client 来源解析测试在两平台原生通过；覆盖相对/盘符/UNC、中文/空格、危险路径、npm/git、规范模式/摘要、真实 symlink 与 junction 拒绝，Linux CLI 原来源测试通过，原 ZIP 字节和执行元数据保持。（CLI-PORT-001、CLI-PORT-005）
- [x] 4.2 将快照下载/导入接入固定目录、文件身份和不覆盖发布，保留 Inspect 和原 Operation/快照观察契约。验证：Linux CLI 快照原测试通过，新增平台适配测试覆盖中断、摘要/大小错误、目标竞争和输入修改；Windows 底层发布/身份负例通过，完整 Windows CLI 覆盖由本组 4.6 收敛。（CLI-PORT-004）
- [x] 4.3 将 Desktop Operation 记录及传输接入原生私有存储、原锁位置、磁盘查询和进程清理，保留记录格式、Core/user key、配额、TTL 和匿名 Inspect 保留规则。验证：Linux 记录/传输/反馈原测试通过；后端原生负例确认 ACL/容量/活跃目录不被绕过，记录失败仍返回原已接受 ID。（CLI-PORT-002、004）
- [ ] 4.4 提取公共 Desktop 控制协议/动作，保留 Linux socket 协议及锁位置，实现设计规定的 Windows named pipe、私有元数据、SID/PID/创建时间校验与有界 framing。验证：原生测试覆盖同用户跨目录恢复、错误用户/伪造通道拒绝、消息边界/超时/取消、崩溃残留、端口失败回滚和新旧实例清理；Linux 旧协议互操作通过。（CLI-PORT-003；CLI-DESKTOP-002、003）
- [x] 4.5 增加 Windows console-control 进程测试辅助，保持原 Ctrl+C 取消路径和浏览器打开分支；Linux 特有信号测试独立保留。验证：原生进程测试区分 Desktop/proxy 退出、Operation 等待只停止观察和 Chat 取消原 Run；浏览器关闭不终止 CLI，打开失败有手动地址，系统强杀后可安全重启。（CLI-PORT-006；CLI-DESKTOP-001）
- [ ] 4.6 在两平台构建完整 `cmd/piwork-cli` 并运行其本模块依赖包的公共及 OS 测试；只把 Linux 专有测试拆出，不整体屏蔽客户端业务测试。验证：完整客户端构建成功，包/快照/传输/open/logout/退出测试在对应系统通过，Windows 无 unsupported 命令族；Linux Console/Pi 服务端回归仍通过。（CLI-PORT-001 至 006）
- [x] 4.7 更新 `docs/cli-platforms.md` 的本地来源、ZIP 执行位、恢复命令、终止和临时资源说明。验证：文档示例在相应原生进程测试中可复现，不要求双击、特殊留窗或本机容器，不承诺强制退出一定运行回调。（CLI-PORT-003 至 006）

## 5. 默认 Desktop 与 Core 配置闭环

- [x] 5.1 实现独立 `<credential-parent>/desktop/preferences.json` 存储、v1 严格格式、64 KiB 限制、非阻塞锁、原子保存和安全清除。验证：两平台原生存储测试覆盖缺失、合法值、重复/额外字段、未知版本、损坏、权限、并发、提交前失败和提交后未确认；只有显式安全清除可恢复格式损坏，凭证从未被改写。（DWUI-DEFAULT-CORE-002；CLI-PORT-002）
- [x] 5.2 增加 Desktop 专用地址 resolver 和空命令默认分派，保留业务 resolver 及帮助/版本/空 `--json` 提前返回。验证：两平台原生入口表测试覆盖参数/环境/偏好/凭证/默认优先级，偏好缺失/损坏/被覆盖、跨 Core token、重复端口、未知参数和显式业务命令；错误码与无 I/O 行为符合 delta。（CLI-DEFAULT-001、CLI-DESKTOP-001；control-cli 的 Resolve one Core endpoint consistently）
- [x] 5.3 实现本地 preferences GET/PUT/DELETE、方法/输入/错误映射和原本地授权守卫，保持与平台账号、连接切换及身份清理独立。验证：API 测试覆盖离线匿名账号但本地已授权、400/409/500/未确认结果、401/403/容量、CSRF/Host/Origin、授权重置及损坏清除；保存前后 Core/identity/Inspect/凭证不变，没有 Core 请求。（DWUI-DEFAULT-CORE-001、002）
- [x] 5.4 在登录/连接和切换 Core 入口增加默认配置控件及 adapter 状态，区分当前/编辑/保存值，实现加载、等待、短成功、明确失败、未知结果只读恢复和晚响应保护。验证：WebUI 类型检查与浏览器测试覆盖首次空态、读取失败不清空、非法地址、保存/清除、响应丢失后的 GET 核对、并发实例和后续输入；业务动作不被配置等待阻塞，同 Core 首次登录保留 Inspect。（DWUI-DEFAULT-CORE-001、002）
- [x] 5.5 更新 CLI 帮助、README 与 `docs/cli-platforms.md`，解释无子命令 BREAKING、显式帮助、两套 Core 优先级、参数仅本次覆盖、偏好保存/清除及损坏恢复。验证：所有示例匹配入口表和 API/UI 测试，业务 CLI 不读取 Desktop 偏好，默认入口没有新增根级 flag 或双击约束。（CLI-DEFAULT-001；DWUI-DEFAULT-CORE-001；control-cli 的 Resolve one Core endpoint consistently）

## 6. 独立构建、发布与原生验收工具

- [x] 6.1 新增 `scripts/build-cli.mjs`、实际目标配置和 Make/npm 客户端入口，只构建 Desktop 资源与 `cmd/piwork-cli`，固定工具链、CGO=0、VCS stamp 和分目标输出。验证：脚本测试记录调用链，无全 workspace/Console/镜像构建；产物为目标原生格式，重新构建不带旧 UI，现有 Linux build 入口仍成功。（CLI-PORT-007）
- [x] 6.2 新增 Go 标准库客户端打包工具，生成 Windows ZIP/Linux tar.gz、manifest/校验和/说明，关联同二进制原生验收证据。验证：打包工具测试覆盖文件类型/目标/metadata/UI/摘要不符、缺失或失败/跳过证据的拒绝，以及正确归档内容、Linux 模式与版本信息。（CLI-PORT-007）
- [ ] 6.3 新增 `scripts/check-cli-platform.mjs`、Go 原生进程验收入口和按场景的证据格式，发现并运行客户端依赖包测试，连接已部署测试 Core，不自动部署本机 Core。验证：工具自身测试确认目标/二进制摘要绑定、失败/缺失 fixture/skip 被记录为未验证、敏感数据过滤；运行一个合格原生目标得到可供打包校验的完整报告。（CLI-PORT-001 至 007；CLI-DEFAULT-001；DWUI-DEFAULT-CORE-001、002）
- [x] 6.4 增加对应系统的浏览器打开、CLI/proxy 真实网络和无开发工具 PATH 的产物烟测，复用既有 Desktop/Service 浏览器契约。验证：测试本身实际从非源码目录执行目标二进制，UI hash 匹配，proxy HTTP/WebSocket/PAC/WebDAV、授权隔离和恢复可用，未调用本机 Go/Node/Python/Docker runtime。（CLI-PORT-003、006、007；CLI-DESKTOP-001）
- [x] 6.5 在 `docs/cli-platforms.md` 文档化构建、目标配置、原生 fixture、HTTP/HTTPS Core 及独立 TLS 正反例、验收/打包命令和产物使用；分清构建/测试工具与用户运行依赖。验证：可依次按文档构建、验收、打包并从任意目录运行；OS/发行版/架构只记录为所选目标或验证事实，无固定最低产品名单。（CLI-PORT-007）

## 7. 跨组件集成与发布完成检查

- [ ] 7.1 在 Linux 运行全组件构建、`go test -mod=readonly ./...` 及受影响 Core/Console/Pi 安装和 Desktop 浏览器集成。验证：保留原 API/包格式/运行环境行为、Console 入口和全组件发布能力，新默认路由及偏好不会污染旧命令输出。（CLI-PORT-001、007；CLI-DEFAULT-001）
- [ ] 7.2 在 Windows、Linux 原生环境用实际候选客户端连接同一已部署 Core，执行各命令族、包/快照、默认/显式 Desktop、open/logout、proxy 和中断流程及主要失败路径。验证：按本变更和既有客户端契约逐项输出证据，JSON/退出码/原 ID 与取消规则一致，原生安全测试无必需 skip；未取得原生结果的目标保留未完成。（CLI-PORT-001 至 007；CLI-DEFAULT-001；DWUI-DEFAULT-CORE-001、002）
- [ ] 7.3 用匹配证据打包两平台已验收产物，核对解包后摘要、版本、内嵌 UI 和独立运行。验证：正式产物只含客户端/manifest/说明，所有目标对应合格原生记录，失败/未验证目标不能混入已支持发布结果。（CLI-PORT-007）
- [ ] 7.4 核对 proposal/specs/design/tasks 与最终实现和原生证据，形成本 change 的验证报告，再运行 `openspec validate support-cross-platform-cli-and-default-desktop --strict --no-interactive`。验证：全部需求/失败场景有匹配实现与证据，无未决行为，只有验证完成的任务被勾选，不能引用旧迁移 Linux 通过数代替本次闭环。（本 change 全部需求）
