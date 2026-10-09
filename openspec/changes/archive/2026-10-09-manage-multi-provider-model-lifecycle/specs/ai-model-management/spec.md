## Purpose

定义管理员以单条模型配置完成连接、消息 Test、保存与选择的行为：每个模型直接拥有协议、Base URL、Model ID 和只写 Key，不要求先创建 Provider 或填写 SDK 能力模板，同时保持权限、凭据、历史和已接受执行的一致性。

## ADDED Requirements

### Requirement: 管理独立模型配置

**Identifier:** AIM-001

管理员 SHALL 在一个模型表单中提供 Model ID、接口协议、Base URL 和 API Key，显示名称可选，省略或留空时使用 Model ID。接口 SHALL 仅接受 openai-responses 和 anthropic-messages。一次保存 SHALL 创建完整模型配置，不要求创建/选择 Provider、填写能力模板、Capabilities JSON、上下文窗口或价格。

每条模型 SHALL 有稳定管理 id、当前 modelRef、独立 enabled 状态和时间；同一 Model ID 可用于不同连接配置，列表与选择器须通过显示名和安全标识区分。管理员 SHALL 能直接读取、编辑、启停及受依赖保护删除模型。未知字段、非法协议、无法解析/禁止组成的 URL 或无效 Key 输入 SHALL 原子拒绝并给出可确认的字段；不以网络可达或 SDK 收录为保存前提。

Messages 根地址、末尾 /v1 和尾斜杠 SHALL 自动解析为相同连接，保留非版本前缀，避免重复 /v1；Responses 保留 API base 语义。同一有效地址表示变化不发布无意义新 modelRef。记录 SHALL 正常重启后保持；旧 Provider 子模型须保留映射为独立模型，不重输 Key、不丢失引用，不重复迁移或重启用旧停用项。

Model ID 与新模型显示名称 SHALL 各允许最多 256 个字符，默认名称、显式名称、编辑和读取输出遵守同一限制。合法长 Model ID 不填名称时 SHALL 返回合法完整模型，不能截断其身份或默认名称来规避校验。保留旧兼容接口时，128 字符的名称显示别名只属于兼容投影，不能反向修改新模型原始值、稳定 id、modelRef、Key 或历史。

#### Scenario: 一次添加完整模型
- **WHEN** 管理员只填写必需的四项连接字段并保存
- **THEN** 得到一条以 Model ID 为默认名称的完整模型，无 Provider/能力模板步骤，模型可读取和继续管理

#### Scenario: 相同 Model ID 的多个配置
- **WHEN** 两条模型使用相同 Model ID、不同端点或 Key
- **THEN** 两条配置独立存在并可区分，选择、编辑和凭据不混用

#### Scenario: 旧目录兼容
- **WHEN** 现有 Provider 下有多个模型，升级并多次重启
- **THEN** 已保存模型、Key 可用性、引用和有效启停状态保留为独立配置，不产生重复条目；后续编辑一条不影响其他条目

#### Scenario: 长模型 ID 和默认名称
- **WHEN** 管理员使用 129 或 256 字符 Model ID，不填显示名称，随后读取、编辑或清空名称
- **THEN** 默认名称完整采用 Model ID，创建/读取/编辑结果均通过公开模型 DTO，旧兼容读取也返回合法投影；257 字符输入原子拒绝，Unicode 字符不被按字节截坏

### Requirement: 模型只写凭据与独立轮换

**Identifier:** AIM-002

创建模型 SHALL 要求非空有效 Key；编辑省略 credential 保留，显式新值原子轮换，空值/空字符串拒绝。UI 空 Key 编辑输入表示省略，不回填旧值。Key SHALL 不进入管理读取、浏览器持久存储、公开列表/历史、日志或公开错误，只用于授权管理、secret 存储和当前获准模型私有执行。

轮换 SHALL 只作用于该模型，独立于其他条目，即使旧迁移条目曾共享连接或 secret。新获准 Run 使用当前 Key，无需重启 Work 或 Apply。已接受 Run 保持固定执行/凭据绑定，已发请求不重发；未开始且准入失效时安全失败。未知写入结果先安全读回，不自动重复轮换，旧 secret 不提前清理。

#### Scenario: 编辑不重填 Key
- **WHEN** 管理员仅修改名称或其他非秘密字段并省略 credential
- **THEN** 原 Key 保留，公开读取只显示可用性，表单不回显 Key

#### Scenario: 同源模型独立轮换
- **WHEN** 两条模型来自同一旧 Provider，其中一条轮换 Key
- **THEN** 只有该模型的新 Run 使用新 Key，另一条模型及已有请求保持原行为

### Requirement: 消息 Test 独立于保存和选择

**Identifier:** AIM-003

管理员 SHALL 在新增/编辑模型表单直接 Test 当前完整草稿，或检查已保存模型；名称不是 Test 必填项，无 Provider 前置步骤。保存项省略 Key 使用当前保存值。Test SHALL 向指定 Model ID 发送固定 user 消息 Reply with OK.，通过单次 Go HTTP Responses /responses 或 Messages /v1/messages 请求取得实际 assistant 文本，路径与保存/实际执行规范化一致。

Test SHALL 不保存草稿、改默认/启停、创建 Work/Session/Run/Apply 或启动资源，不通过 Agent 执行，不自动重试。Test 成功、失败、未执行均不构成保存、启用或进入 Choose model 的门槛。网络、远端 404、认证、模型或协议失败只影响本次检查；结构错误定位字段，明确此时未外发。

Modal SHALL 展示目标、测试消息、实际回复或安全原因/恢复建议、检查时间/耗时及真实 HTTP 状态。成功须有非空 assistant 正文，不伪造 OK，不把推理/工具内容作为回复；20 秒、64 KiB 原始响应、8 KiB UTF-8 展示上限及明确截断保留。错误区分认证、模型、限流、DNS/TLS/连接、超时、供应商错误、协议不匹配、空回复和大小上限，不透传原始异常、Key、认证头或内部路径。

结果 SHALL 绑定发起草稿/保存项，输入变化或读回后标为过期。关闭、导航或身份变化后晚到结果不重新打开/覆盖新 Modal；查看旧结果不外发，不丢弃非敏感草稿。供应商 Key 错误不注销管理员，真正 Core/Console 登录失效才清理敏感内存并登录。

#### Scenario: 新增草稿直接 Test
- **WHEN** 管理员未保存模型就填写四项连接字段并 Test
- **THEN** 请求使用该模型草稿，Modal 展示真实结果，目录与默认不改变，名称留空仍可检查

#### Scenario: 失败不拦保存和选择
- **WHEN** Test 返回认证/404/网络错误后，管理员保存结构有效且启用的模型
- **THEN** 模型保存并进入 Choose model，错误事实单独保留，不需要先获得成功 Test

#### Scenario: 原协议与结果边界
- **WHEN** 两种协议分别返回正常文本、空/推理/工具内容、超大回复或安全错误
- **THEN** 按实际协议提取和分类，截断明确，私有材料不回显，不能仅凭 2xx 显示成功

### Requirement: 独立模型准入与删除保护

**Identifier:** AIM-004

模型启停 SHALL 独立、幂等，不要求 Provider 状态操作。停用阻止该模型的新默认/覆盖/自动执行，保留 Work 容器、历史和已发请求；已接受未外发的执行仍重验准入。重新启用不改变其他模型。

删除 SHALL 在被 Core 默认或未删除 Work active/desired 引用时返回安全依赖冲突，不自动改默认、级联删除或读取他人 Session。只有历史或 Session 偏好引用不阻止模型退出目录，旧事实可读且旧偏好明确不可用。所有执行版本的引用均受保护，秘密按真实引用保守回收。

#### Scenario: 停用一条配置
- **WHEN** 管理员停用与另一条模型具有相同 Model ID 的配置
- **THEN** 只有被停用条目阻止新执行，其他模型、Work 和历史不被停用动作修改

#### Scenario: 删除存在引用的模型
- **WHEN** 模型被默认或 live Work 配置引用
- **THEN** 删除返回安全依赖类别，指导先切换引用，不引入 Provider 删除步骤或自动重绑定

### Requirement: 保存后直接选择且默认保持独立

**Identifier:** AIM-005

已保存、启用且凭据可用的模型 SHALL 进入 Runtime Choose model；兼容的已运行 Work SHALL 能刷新后在 Chat 选择。不得因 Model ID 不在 SDK 目录、缺少模板、Thinking 未确认或 Test 未成功而隐藏模型。停用、缺凭据或实际环境不兼容项 SHALL 有明确原因及恢复方向，不静默消失。

新增、Test 或编辑模型 SHALL 不自动换 Core 默认。管理员显式选择默认只影响后续新 Work，保留其他最新默认字段；已有 Work 捕获及 Session 不隐式改变。未配置 Agent image/默认时如实显示尚未 ready，但模型添加/Test/保存继续可用。旧 Runtime/operator/env 初始化入口继续产生稳定对应模型，不覆盖独立目录或重启用旧条目。

#### Scenario: 自定义 ID 直接可选
- **WHEN** 管理员保存固定 SDK 未收录的 Model ID，未提供任何能力定义
- **THEN** Runtime Choose model 出现该条目，兼容 Work Chat 也可选并实际发送普通消息，不再要求额外配置模板

#### Scenario: 默认不自动切换
- **WHEN** 新模型添加并 Test 成功或失败
- **THEN** 原默认保持，用户明确选择该模型后新 Work 才继承它，旧 Work 不改绑

### Requirement: Thinking 不阻断基本模型使用

**Identifier:** AIM-006

已知模型 SHALL 自动保留 SDK 已确认的真实 Thinking 档位与映射，不因自定义地址或显示名丢失。未知 Model ID SHALL 自动建立所选协议的普通消息执行定义，不要求管理员配置能力模板/JSON，也不把 Thinking 未确认当作模型不可用。

未知 Thinking SHALL 单独显示未确认，不伪造可选档位或已确认“不支持”；普通模式表示未请求额外 Thinking，不误报为已确认 Off。已有非空 Thinking 偏好不得静默降档或清除，需用户明确确认兼容设置。设置、初始化和实际请求使用一致定义，管理流程不新增默认 Thinking 档位，Test 不证明 Thinking 全能力。

#### Scenario: 已知模型保留 Thinking
- **WHEN** 用户通过完整模型配置选择 SDK 已知的 reasoning 模型
- **THEN** 原有真实档位与请求映射保持，无模板填写或管理员默认档位步骤

#### Scenario: 未知模型普通消息
- **WHEN** 已配置模型的 Thinking 无法确认，用户新建会话正常发送
- **THEN** 模型可选且消息按原协议/ID/端点执行，Thinking 标为未确认/未请求，不用伪造 Off 换取可执行性

#### Scenario: 旧 Thinking 偏好保留
- **WHEN** 已有非空 Thinking 设置与新选择的未知模型不兼容
- **THEN** 保留原事实并明确提示，由用户显式确认普通模式或其他兼容设置，不静默修改已有 Run
