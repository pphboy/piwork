## ADDED Requirements

### Requirement: 将 workspace 文件内容限定为当前所有者

**Identifier:** WACC-FILES-001

Core SHALL 对所有文件请求及提交校验当前有效用户会话和 Work 所有权；非所有者管理员不因控制权限获得文件内容。未知、已删除和跨所有者 Work SHALL 返回不可区分的404；缺失/无效会话返回401。operator、agent运行身份和请求伪造的owner/Work元数据不能替代用户认证。资格检查 SHALL 先于文件内容读取、临时文件写入、helper创建及资源信息返回。

活动文件请求 SHALL 至少每2秒复核会话有效性及Work资格；会话被撤销或用户被禁用后最多2秒停止传输并开始取消。撤销之后不能发出新的写入提交许可；已经授予许可的请求可能已完整提交，不能对客户端宣称必然回滚。文件内容在授权数据响应中原样传输；WebDAV目录/逐项错误响应可包含已授权请求范围内的规范化href，不能包含宿主路径、卷名、凭据或无关文件正文。普通平台日志与控制诊断不得携带用户文件名或内容。

#### Scenario: 管理员有控制权限但没有文件权限
- **WHEN** 非所有者管理员能停止某Work并请求读取其workspace
- **THEN** 文件接口返回与未知Work相同的404，不能沿用管理身份读取文件

#### Scenario: 猜测Work身份或存储目标
- **WHEN** 用户替换URL中的workId，或注入owner、卷名、容器ID及保留平台头
- **THEN** Core按当前会话和自己的归属记录授权，不读取其他Work或请求指定的存储

#### Scenario: 长上传期间撤销会话
- **WHEN** 用户上传尚未获得提交许可时登出
- **THEN** 两秒内断开流并开始清理，不发出新提交许可，旧目标保持完整

#### Scenario: 原样传输用户文件
- **WHEN** 所有者下载内容包含看似凭据字符串的普通文件
- **THEN** 文件字节保持一致；平台日志只包含安全身份、计数和错误码，不复制文件内容

### Requirement: 隔离本地 WebDAV 认证与 service 应用认证

**Identifier:** WACC-FILES-002

CLI 文件入口 SHALL 仅接受loopback连接、精确本地Host及当前proxy的临时Basic凭据；拒绝跨站Origin和cross-site请求，不提供CORS放行。无效本地凭据只产生本地401，不联系Core、不撤销平台登录。CLI SHALL 移除本地Basic、Cookie、Proxy认证、客户端平台保留头和逐跳头，使用保存的用户Bearer调用Core文件接口。Core token不得交给WebDAV客户端、service或文件helper。

service分支 SHALL 保持原有应用Authorization/Cookie和网关认证隔离；若请求的Authorization使用大小写不敏感的Basic认证方案，且解码后的用户名与密码字节恰为当前WebDAV临时凭据，SHALL 拒绝而不转发给应用。合法应用自己的Basic凭据仍按原规则转发。service响应中的401、文件路径404、本地认证401与平台会话失效必须区分，只有确认的Core会话失效结束proxy。公开文件后端 SHALL 不能获得Core/admin/agent凭据、Docker socket、私有卷或另一Work卷。

#### Scenario: 同一proxy交替访问service与文件
- **WHEN** 应用使用自己的Bearer和Cookie，同时文件客户端使用临时Basic
- **THEN** 应用收到自己的认证，Core文件入口收到平台认证，双方都收不到不属于自己的凭据

#### Scenario: 错误本地密码
- **WHEN** WebDAV客户端提供错误密码
- **THEN** 本地返回401且Core请求数为零，service代理与已有平台会话保持可用

#### Scenario: 临时密码误投到service
- **WHEN** service请求使用当前proxy生成的WebDAV Basic认证
- **THEN** CLI拒绝请求，service没有收到该密码；合法应用自己的Basic仍按原规则转发

#### Scenario: Basic认证方案大小写变化
- **WHEN** service请求将Basic方案写为`basic`或混合大小写，但凭据解码后仍是当前proxy的WebDAV用户名和临时密码
- **THEN** CLI拒绝请求，service收不到临时密码；不同的应用Basic凭据仍可转发

#### Scenario: 浏览器跨站访问本地文件入口
- **WHEN** 网页用其他Host或跨站Origin访问本地文件路径
- **THEN** 请求被拒绝，不通过本地代理借用已保存的Core凭据
