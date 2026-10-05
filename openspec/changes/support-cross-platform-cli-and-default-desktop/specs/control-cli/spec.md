# Spec Delta

## ADDED Requirements

### Requirement: 无子命令时默认启动 Desktop 并保留显式命令契约

**Identifier:** CLI-DEFAULT-001

`piwork-cli` SHALL 在全局参数解析成功、没有子命令且没有 `--json` 时执行默认 `desktop` 启动；无参数和仅提供 `--core <url>` 均适用。该入口 SHALL 使用显式 `desktop` 的监听、授权、浏览器打开、失败和前台退出契约，不根据操作系统、终端是否存在或启动手势选择另一套流程。

所有显式业务命令、`desktop`、`desktop open`、`desktop logout`、`proxy` 的参数语法、输出、退出码和等待/取消语义 SHALL 保持；默认路由不得吞掉未知命令或参数，不得自动启动后台进程、复用其他实例或自动换端口。自定义端口和禁止打开浏览器 SHALL 继续通过 `desktop --port ... --no-open` 设置，根级别不新增这些 flag。

`help`、`--help`、`-h` 和既有子命令帮助 SHALL 输出帮助并退出 0，`version`、`--version` SHALL 保持版本输出；均不读取凭证或 Desktop 配置、不访问 Core、不创建监听。无子命令的 `--json` 或 `--core <url> --json` SHALL 保持帮助输出和 exit 0，不进入 Desktop。显式 `--json desktop` 和 `--json proxy` SHALL 仍返回 exit 2。参数或命令语法错误 SHALL 在本地状态和网络访问前返回 exit 2。

#### Scenario: 无参数启动
- **WHEN** 用户直接执行 `piwork-cli`，默认端口可用
- **THEN** 前台启动默认 Desktop 并尝试打开浏览器，行为等同显式 `desktop`，不只输出帮助

#### Scenario: 仅参数选择 Core
- **WHEN** 用户执行 `piwork-cli --core https://core.example`
- **THEN** 启动 Desktop 并使用该 Core；不修改默认配置或登录凭证，不运行 status 或 login

#### Scenario: 显式命令和机器调用
- **WHEN** 调用 `--json work list`、`chat`、`proxy`、`desktop --port 17901 --no-open` 或 `desktop open`
- **THEN** 分别执行原命令，不额外启动默认 Desktop、不添加浏览器启动日志到业务 stdout

#### Scenario: 帮助、版本和空机器调用
- **WHEN** 调用帮助、版本，或只提供 `--json`，且本地配置损坏、Core 不可达
- **THEN** 仍按原有成功契约结束，不读取配置、不监听、不打开浏览器；无子命令的 `--json` 输出帮助

#### Scenario: 无效调用不能进入界面
- **WHEN** 用户输入未知命令、重复全局参数、缺失参数值，或根级别的 `--port`、`--no-open`
- **THEN** 返回 exit 2 和安全用法提示，不打开浏览器、不创建本地状态；显式 Desktop/proxy 的 `--json` 同样拒绝

#### Scenario: 已有实例不改变默认启动语义
- **WHEN** 默认 Desktop 端口已经被现有实例或其他程序占用，再执行无子命令入口
- **THEN** 返回 exit 6，不复用、不切换既有 Core、不新建其他端口实例；用户可显式执行 `desktop open` 恢复自己的实例

## MODIFIED Requirements

### Requirement: Resolve one Core endpoint consistently

系统 SHALL 提供独立的 operator 控制面和登录用户客户端命令；既有规范中的 `piwork-serve` operator 职责及配置保持，`piwork-cli` 用于用户客户端。业务 CLI SHALL 按显式 `--core`、`PIWORK_CORE_URL`、保存凭证中的 Core、默认 `http://127.0.0.1:7171` 的顺序解析。operator SHALL 按显式 `--core`、`--env-file` 中的控制面地址和文档化默认值解析，并使用 operator credential。

默认或显式 Desktop 启动 SHALL 按显式 `--core`、`PIWORK_CORE_URL`、Desktop 默认 Core 配置、保存凭证中的 Core、相同 loopback 默认值的顺序解析。参数和环境变量 SHALL 仅影响本次启动，不自动保存。业务 CLI SHALL 不读取 Desktop 偏好；`desktop open/logout` SHALL 继续只选择既有本机实例，不重新解析 Core。

Desktop 默认配置不存在 SHALL 回退到原凭证/默认值，不要求迁移旧凭证。需要读取的配置损坏、版本不支持、地址字段非法、超过大小限制或无法安全访问 SHALL 返回 exit 1 和安全恢复方向，保留原文件，不静默改连其他 Core；已由参数或环境选定地址时 SHALL 不读取无须使用的 Desktop 偏好。通过参数、环境或旧凭证选定的地址无效 SHALL 返回 exit 2，不继续尝试低优先级地址。凭证仅 SHALL 用于与其 Core origin 相同的请求。

#### Scenario: Use the user client endpoint
- **WHEN** 用户运行业务 CLI 且未提供显式地址
- **THEN** 使用 `PIWORK_CORE_URL`、保存凭证中的地址或 loopback 默认值；Desktop 默认配置不影响该选择

#### Scenario: Override the Core URL explicitly
- **WHEN** 用户提供 `--core <url>`，另有环境、Desktop 配置或保存凭证地址
- **THEN** 业务 CLI 或 Desktop 使用显式地址；Desktop 启动不覆盖持久配置，不把另一 Core 的 token 发给该地址

#### Scenario: Reuse the saved endpoint
- **WHEN** 没有显式或环境地址，业务 CLI 有保存凭证，或 Desktop 没有默认配置但有保存凭证
- **THEN** 使用该凭证的 Core 地址，不重写或迁移凭证

#### Scenario: Use the operator endpoint
- **WHEN** 操作者运行既有 operator 管理或配置入口
- **THEN** 使用 operator 配置和凭证，不读取 `piwork-cli` 用户 token 或 Desktop 偏好

#### Scenario: Desktop 默认地址和旧凭证并存
- **WHEN** Desktop 配置 Core B，凭证属于 Core A，且没有参数或环境覆盖
- **THEN** Desktop 连接 B 并呈现未登录状态，不发送 A 的 token；业务 CLI 仍解析为 A

#### Scenario: 退出登录后保留 Desktop 默认配置
- **WHEN** 用户保存 Desktop 默认 Core 后清理当前登录，随后重新启动
- **THEN** 仍选择保存的 Core，不因凭证删除回到 loopback，不恢复已清理的 token

#### Scenario: 缺失、损坏和被覆盖的配置
- **WHEN** 默认配置不存在、需要读取的配置损坏，或参数/环境已经覆盖损坏配置
- **THEN** 分别使用原有回退、返回 exit 1 且不监听、或按覆盖地址正常启动；损坏文件均不被自动删除

#### Scenario: 无效高优先级地址
- **WHEN** 参数、环境或保存配置给出不合法 Core origin
- **THEN** 拒绝选定地址，不悄悄使用凭证或 loopback，不泄漏 token

### Requirement: 启动本地 Desktop WebUI

**Identifier:** CLI-DESKTOP-001

`piwork-cli [--core <url>] desktop [--port <1..65535>] [--no-open]` 及符合 CLI-DEFAULT-001 的默认入口 SHALL 在前台启动仅监听 `127.0.0.1` 的本地 WebUI，默认端口 17891；默认打开系统浏览器，`--no-open` 仅输出本地打开地址。地址 SHALL 使用受验证的 localhost 主机名；本机无需 Docker、代理/PAC、hosts 编辑或安装证书。Core 地址 SHALL 按本规范的 Desktop 优先级选择；合法 HTTP 与 HTTPS Core origin 均可使用，不按目标位置限制 HTTP，协议准入遵守 `allow-http-core-connections` 的 CLI-CORE-PROTOCOL-001。无登录或 Core 暂不可达 SHALL 仍可打开登录/连接页面和本地包 Inspect，不能借用其他 Core 的 token。

启动前 SHALL 校验参数；未知参数、重复或非法端口、显式 Desktop 的 `--json` 返回 exit 2；端口占用返回 exit 6，资源缺失或监听失败返回 exit 5，不自动换端口或遗留半启动监听器。浏览器打开失败 SHALL 保持服务并打印手动打开地址；`--help` 不读取凭证或偏好、不启动监听、不访问网络。Ctrl+C SHALL 关闭本地连接、清理本次临时资源并退出 130，不停止 Work、不取消已经接受的 Core Operation/Run。平台会话失效 SHALL 回到登录状态而不退出 WebUI。既有 `proxy` 默认 17890、PAC、临时 WebDAV 密码及退出语义 SHALL 不变；Desktop 不要求先启动 proxy。

#### Scenario: 无登录的一键启动
- **WHEN** 用户首次运行默认入口或显式 desktop 且没有保存凭证
- **THEN** 浏览器打开登录/连接页面，可以配置默认 Core 和本地 Inspect；输入有效用户凭据后进入自己的 Work List

#### Scenario: 打开浏览器失败
- **WHEN** 本地监听已成功但系统没有可用的打开浏览器命令
- **THEN** 命令持续运行并显示手动地址，不谎报启动失败或自动关闭

#### Scenario: 非法端口与端口占用
- **WHEN** 用户指定非法端口或已被占用的合法端口
- **THEN** 分别返回 exit 2 或 6，不自动监听其他端口，不启动后台副本

#### Scenario: 关闭窗口和退出 CLI
- **WHEN** 用户关闭浏览器窗口，随后终止 Desktop 进程
- **THEN** 关闭浏览器不停止监听；进程退出只终止本地入口，Core 上已接受的工作继续，可在下次登录后查询

#### Scenario: 两种访问命令并存
- **WHEN** 用户同时运行默认 Desktop 与 proxy
- **THEN** 二者使用独立端口与本地凭据，WebUI 的启动和浏览器 Files 不依赖 proxy

#### Scenario: 使用远程 HTTP 启动及恢复
- **WHEN** 用户默认启动或显式 desktop 指定合法远程 HTTP Core，随后执行同用户 desktop open
- **THEN** Desktop 正常监听并输出/打开本地页面，页面报告实际 Core 状态；open 只恢复原实例，不改地址或创建第二实例
