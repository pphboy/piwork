# Spec Delta

## MODIFIED Requirements

### Requirement: 本机 Desktop 恢复通道在两平台保持可信边界

**Identifier:** CLI-PORT-003

`desktop open/logout` SHALL 在 Windows、Linux 上仅连接同一系统用户拥有的指定端口 Desktop 实例，保留 CLI-DESKTOP-002、CLI-DESKTOP-003 的普通地址打开、退出码、超时、条件清理和恢复契约。通道 SHALL 不依赖调用目录、Core 地址、平台登录凭证或 `PIWORK_CONFIG_PATH`，不接受网络远程调用或其他普通系统用户冒用。

启动失败、正常退出及进程被强制结束后 SHALL 不留下能够冒充活跃实例的控制状态；后续恢复须检查实例身份和存活状态，陈旧状态不得冒充活跃实例、删除新实例资源或永久阻止再次启动。浏览器入口 SHALL 保持 Host、Origin、自动建立的普通 Cookie 会话、CSRF、会话容量和 Service origin 隔离，不再要求启动 ticket 或独立浏览器 Access 授权。

#### Scenario: 同用户跨进程恢复
- **WHEN** 同一用户从不同目录及不同环境执行 `desktop open --port ... --no-open`
- **THEN** 返回既有实例不含授权片段的普通地址，实例 PID、Core 和平台身份不变，不访问 Core 或读取凭证

#### Scenario: 不同系统用户和伪造通道
- **WHEN** 另一普通用户连接或预置同名控制通道/元数据
- **THEN** 权限和对端身份校验拒绝，不能调用实例控制命令、执行 logout 或冒充原实例；安全错误遵守现有 exit 3 契约

#### Scenario: 实例退出和崩溃后恢复
- **WHEN** 原 Desktop 已退出或崩溃，再运行 open/logout 或启动同端口新实例
- **THEN** 恢复命令对确实不存在的实例返回 exit 4；陈旧状态不复用旧控制实例身份，安全清理后新实例可正常启动，不清理其他活跃实例

#### Scenario: 本地和平台授权仍相互独立
- **WHEN** 新浏览器打开普通地址、旧 Cookie 失效、Core token 过期，或用户执行 desktop logout
- **THEN** 普通页面会话自动建立且仅承担会话/CSRF，不代表 Core 登录；账号按真实共享凭据核验或正常登录继续，logout 保持当前平台会话清理；均不出现 Access 门禁，也不停止 Work
