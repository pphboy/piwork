# AI 模型

[English](ai-models.md) | **简体中文**

本流程需要配套的当前 Core、Console、Agent 和 CLI。旧固定镜像保留原有能力，修改文档或重启旧 Agent 不会升级它；升级前先阅读本页的数据与 Work 迁移说明。

## 添加与选择

在 Serve UI 的 **AI models** 填写 **Model ID、API type、Base URL 和 API Key**，即可保存一条完整模型配置。显示名称可选，省略时使用完整 Model ID；型号和显示名最多 256 个字符。无需先创建 Provider，也无需填写能力 JSON。同一 Model ID 可以配置多个独立连接。

支持 **OpenAI Responses** 与 **Anthropic Messages**。Responses 填 API base，例如 `https://gateway.example.invalid/v1`，系统追加 `/responses`。Messages 可填服务根地址或末尾 `/v1`，有无尾斜杠均生成一个 `/v1/messages`，网关路径前缀保留。不要填写完整请求路径；除 loopback HTTP 外要求 HTTPS，拒绝 URL 内嵌凭据、查询和 fragment。

启用且具备 Key 的模型会出现在 **Runtime** 和 **Work Chat → Response settings → Model**，包括 SDK 目录未收录的自定义 ID。Agent 精确复用已知 SDK 定义，或按所选协议和原 ID 建立基础定义，不猜测其他型号。显示名称及安全标识用于区分同 ID 连接。

Key 只写不读。编辑时留空保留原 Key，填写完整新 Key 只轮换当前模型；不会修改其他连接、执行引用或已接受 Run 的固定凭据。Key 不进入浏览器持久存储、公开历史或错误。

## 编辑、启停与删除

每个模型独立支持 **Enable、Disable、Delete**。禁用阻止新的执行，不停止 Work、不删除对话，已经发送的请求可能继续完成。删除前须替换 Core 默认或 Work active/desired 对该模型的依赖，历史回复和不可用的 Session 偏好继续可读。

修改 Model ID、协议或实际端点会发布新的可选执行引用；Messages 根地址与等价 `/v1` 写法不会。已有 Work 保留捕获的默认值，需显式选择并 Apply 新配置；失效的 Chat override 需要重新选择。改名、Test 和 Key 轮换不改写捕获的型号或 Thinking 事实。

## 消息 Test

**Test** 使用当前表单的型号、协议、地址和 Key 发送固定短消息 `Reply with OK.`。编辑已保存模型时可以使用其已有 Key，当前草稿字段覆盖已保存值。Core 自身发送一次 HTTP 请求，无需安装 curl。

**Model Test** 弹窗展示目标、发送内容、实际回复或安全失败原因，以及检查时间和耗时。任何非空助手文本都可通过，不要求恰好回复 OK；仅 reasoning、工具结果、空文本或不兼容响应失败。回复转义显示，最多 8 KiB，截断会标明，回显的已知 Key 被遮蔽。请求最多 20 秒、响应最多 64 KiB，不携带凭据跟随重定向，不自动重试。

Test 是辅助诊断，不是保存、启用或选择的门槛。404、认证、网络或协议失败不会阻止保存结构合法的配置。Test 不保存草稿、不改变默认、不启动 Work 或创建对话；成功也不证明流式、工具或 Thinking 能力。

**Back to configuration** 聚焦错误字段并保留草稿。弹窗区分未开始、请求失败、结果未确认和已收到回复；供应商认证失败不注销管理员，Core/Console 会话失效才要求重新登录。关闭后晚到响应不重开弹窗，**View test result** 只查看原结果；修改或重读配置会标记结果陈旧。**Read current data、Configure runtime** 在页头，**All models** 返回模型列表。

## Runtime、Work 与 Thinking

在 **Runtime** 配置 Agent 镜像并选择模型，无需再次输入 Key。添加模型不改变默认；**Use for future Work** 仅更新新 Work 的默认模型并保留其他设置。已有 Work 和 Chat override 不变，自动 Service 请求使用 active Work 默认值。Work default 选项、响应设置和输入区域显示实际捕获的 Model ID，目录改名不暗示已有 Work 已采用新型号。

已知模型保留 SDK 的真实 Thinking 档位与协议映射，不新增管理员默认 Thinking。未知或自定义模型的 `thinkingAvailability` 为 `unknown`，没有确认档位；**Normal** 使用 `thinkingLevel: null`，表示未额外请求 Thinking。普通请求省略未确认参数，不代表供应商内部推理被关闭。未知默认模型的新 Session 可以直接普通发送。

已有非空 Thinking 偏好切换到未知模型时，需显式选择 **Normal** 后保存完整设置对；确认前保留原偏好，不兼容组合原子拒绝。旧记录缺少 Thinking 字段仍表示旧 Off，新 null 在重启、导出和导入后仍保留自身含义。自动 Run 使用默认普通模式，不继承 Chat High。

新行为协商 **Chat contract 3**。旧 Work 要先选择兼容的新 Agent 镜像并显式 Apply；后续新增模型无需重建镜像或再次 Apply。旧环境遇到不支持的记录或能力时明确要求升级，不把 Normal 解释为已确认 Off。

## 现有数据与迁移

升级时，旧 Provider 的每个子模型转换为独立连接，保留型号、执行引用、Key、有效启用状态、默认引用、Work 捕获及显式定义。没有子模型的 Provider 不生成猜测模型，之后各模型独立编辑和轮换 Key。迁移事务化且幂等，重启不重新启用已禁用模型。

新 registry 格式需要新版 Core；旧二进制不能直接读取已迁移数据。升级前正常停止安装，保留完整 Core 数据、相关受管卷与私有运行配置备份，以备配套回退。

Work 包保留非秘密模型要求与原 Thinking 事实（含 Normal/null），不复制源模型/Provider 身份、Key 或活跃执行授权。目标配置自己的模型和凭据，导入保持 stopped，不重放历史；匹配不唯一时保留可读历史并要求显式选择。nullable 历史需要兼容 reader。完整流程见 [Work 快照](work-snapshot.md)和[包格式](work-package-format.md)。

## 管理员 API

接口位于已认证的 `/api/v1/admin`：`POST /models` 原子创建完整配置，`GET /models` 与 `GET /models/:id` 读取平铺列表/详情，`PATCH /models/:id` 局部修改；`POST /models/:id/enable`、`POST /models/:id/disable` 与 `DELETE /models/:id` 管理生命周期，`POST /model-tests` 测试完整草稿或保存项的字段覆盖。准确字段见[英文接口说明](ai-models.md#administrator-api)及现行 schema。

公开 DTO 不含 Provider 字段、能力 JSON 或秘密。普通用户只能选择获准模型，不能使用管理员管理接口；旧 Provider 路由仅为兼容现有集成保留，新界面不依赖它们。
