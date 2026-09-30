# Spec Delta

## ADDED Requirements

### Requirement: 启动本地 Desktop WebUI

**Identifier:** CLI-DESKTOP-001

`piwork-cli [--core <url>] desktop [--port <1..65535>] [--no-open]` SHALL 在前台启动仅监听 `127.0.0.1` 的本地 WebUI，默认端口 17891；默认打开系统浏览器，`--no-open` 仅输出本地打开地址。地址 SHALL 使用受验证的 localhost 主机名；本机无需 Docker、代理/PAC、hosts 编辑或安装证书。Core 地址优先级沿用显式参数、环境、已存配置和默认值；远程 Core 要求 HTTPS，loopback Core 可用 HTTP。无登录或 Core 暂不可达 SHALL 仍可打开登录/连接页面和本地包 Inspect，不能借用其他 Core 的 token。

启动前 SHALL 校验参数；未知参数、重复或非法端口、`--json` 返回 exit 2；端口占用返回 exit 6，资源缺失或监听失败返回 exit 5，不自动换端口或遗留半启动监听器。浏览器打开失败 SHALL 保持服务并打印手动打开地址；`--help` 不读取凭证、不启动监听、不访问网络。Ctrl+C SHALL 关闭本地连接、清理本次临时资源并退出 130，不停止 Work、不取消已经接受的 Core Operation/Run。平台会话失效 SHALL 回到登录状态而不退出 WebUI。既有 `proxy` 默认 17890、PAC、临时 WebDAV 密码及退出语义 SHALL 不变；desktop 不要求先启动 proxy。

#### Scenario: 无登录的一键启动
- **WHEN** 用户首次运行 desktop 且没有保存凭证
- **THEN** 浏览器打开登录/连接页面，可以本地 Inspect；输入有效用户凭据后进入自己的 Work List

#### Scenario: 打开浏览器失败
- **WHEN** 本地监听已成功但系统没有可用的打开浏览器命令
- **THEN** 命令持续运行并显示手动地址，不谎报启动失败或自动关闭

#### Scenario: 非法端口与端口占用
- **WHEN** 用户指定非法端口或已被占用的合法端口
- **THEN** 分别返回 exit 2 或 6，不自动监听其他端口，不启动后台副本

#### Scenario: 关闭窗口和退出 CLI
- **WHEN** 用户关闭浏览器窗口，随后终止 desktop 进程
- **THEN** 关闭窗口不停止监听；进程退出只终止本地入口，Core 上已接受的工作继续，可在下次登录后查询

#### Scenario: 两种访问命令并存
- **WHEN** 用户同时运行默认 desktop 与 proxy
- **THEN** 二者使用独立端口与本地凭据，WebUI 的启动和浏览器 Files 不依赖 proxy
