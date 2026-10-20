# Spec Delta

## MODIFIED Requirements

### Requirement: 导入后按目标身份重建默认服务域名

**Identifier:** PWORK-SERVICE-ACCESS-001

Work 的默认网络名称、service 域名、Docker 名称及活动访问连接 SHALL 属于目标 Core 派生状态，不进入 `.work` V1 包或改变其 schema。导入 SHALL 在新 Work/service ID 发布时重新分配这些身份；导入仍保持 stopped，只有显式启动并达到 ready 才可通过新域名访问。源包的应用文件、数据库、历史文本中的字面 URL SHALL 原样保留，不做搜索替换或继承源平台路由。

托管浏览器的 Service basePath/访问链接 SHALL 同样属于当前安装和目标身份的派生信息，不增加 `.work` V1 字段。符合动态前缀契约的应用 SHALL 在导入、显式 Start 并 ready 后通过新 ControlPlane 的 `/services/<新workId>/<新serviceId>/<port>/` 使用，不依赖源平台、旧 IP、旧入口池或重新安装其既有依赖。

包格式可导入与其中网页适配当前入口 SHALL 分别判断。旧应用不支持前缀时，不得把它误报为包字节损坏，也不得为了透明兼容自动替换固定镜像、搜索替换源码/数据库/历史 URL，或回退旧托管端口。应用路径适配须显式进行，原内容与独立所有权继续保留；任意旧网页不属于新路径的透明兼容承诺。

#### Scenario: 同一包导入两次
- **WHEN** 同一含 `notes` service 的 `.work` 文件被导入两次
- **THEN** 两个新 Work 获得不同域名，均不占用源域名；启动其中一个不使另一个可访问

#### Scenario: 未启动的导入 Work
- **WHEN** 用户刚完成导入并查询 service，再尝试访问返回的新域名
- **THEN** 能看见稳定地址但状态为 unavailable，访问失败且不隐式启动 Work

#### Scenario: 保持 V1 包字节契约
- **WHEN** 使用现有 V1 包及历史 URL 文本完成导出、导入与再次导出
- **THEN** 包格式无需新增字段，历史文本字节不被改写，目标域名由目标 ID 推导

#### Scenario: 新模板搬迁后改变浏览器身份
- **WHEN** 支持动态前缀的 Work 停止、导出并导入新 Work 后显式启动
- **THEN** 同一代码和捕获镜像通过目标 ID 的新前缀加载资源、执行 API 和建立 WebSocket，源和目标互不串用且格式不变

#### Scenario: 旧根路径应用导入
- **WHEN** 合法旧包包含不支持前缀的网页应用
- **THEN** 原静态格式与安装校验按原契约执行，源码/镜像/数据保持；网页入口兼容范围明确，不宣称导入成功已证明该网页可用，不隐式修复用户内容
