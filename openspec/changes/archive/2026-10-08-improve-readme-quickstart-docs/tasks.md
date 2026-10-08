# Tasks

## 1. Docker run 配置材料

- [x] 1.1 新增仅含五个空白初始化值和可选 HTTPS Base URL 的 core.run.env.example，保留 Compose 专用模板；验证必填键与现行初始化源码一致、原始值无语法引号、模板无真实秘密。（DOCKER-DELIVERY-001、006）
- [x] 1.2 使用隔离文件和合成密码/key 验证实际 Docker env-file 与 Compose 对 `$`、空格和引号的解析；分别断言容器/配置中的实际值匹配输入，结果记录只包含是否匹配，不输出值。（DOCKER-DELIVERY-006：秘密包含特殊字符）

## 2. 双语 README 的默认终端路径

- [x] 2.1 重写两份根 README 的 Docker Quick Start：保留校验下载入口，增加新模板复制/旧包空白 heredoc 分支和镜像变量取得方式，采用设计中的 Core run、交互 CLI run、完整就绪等待、TTY 登录、自动启动 Work 和 chat；验证无 Compose/GUI、无冗余 start/list、已有 env 不被覆盖、新旧包分支得到相同模板及 0600 权限。（DOCKER-DELIVERY-001、002、005、006、010）
- [x] 2.2 将原生 CLI login/create/chat 放入默认关闭的 details，保留现有图片并居中显示；统一执行位置、变量说明、续行分组和代码语言，更新 Compose 为可选依赖及导航；验证 Markdown 渲染中 Logo 为 160×160 且居中、Docker 命令可见、原生区域折叠，展开后只有终端试用操作。（DOCKER-DELIVERY-002、010）
- [x] 2.3 新增 check-docker-quickstart.mjs 及对应 test.mjs，使用 Node 内置库提取设计限定的章节和参数，检查双语命令、模板/旧包分支、Core/CLI 网络与存储、秘密隔离和等待预算；注入错误路径、缺 host-gateway、误发布端口、秘密 env-file、关闭预算变化和语言漂移的夹具，验证非零退出且错误不含配置值，运行 node --test scripts/check-docker-quickstart.test.mjs。（DOCKER-DELIVERY-010、011）
- [x] 2.4 对下载和配置准备代码执行 shell 语法、成功分支及负向检查：下载失败、错误/非法 checksum、内部清单不符和已有 env 均不得继续安装或覆盖文件；验证相对链接与锚点、中英文对应代码块一致并通过 git diff --check。（DOCKER-DELIVERY-001、006、010）

## 3. Core Compose Demo 与完整手册

- [x] 3.1 在双语 Docker 安装手册增加可选 Core Compose Demo，使用现有 Compose 模板、原有独立数据目录和 up 的就绪等待，随后复用同一交互 Docker run CLI；明确两个 Core 入口二选一及切换前正常停机，保留高级 Desktop 材料；验证 Demo 主流程无 CLI Compose/GUI，合成配置下 docker compose config 的固定镜像、host 网络、socket、同路径数据及 60 秒关闭预算正确。（DOCKER-DELIVERY-002、006、011）
- [x] 3.2 补齐默认终端入口的状态/日志、退出重进、Core 停止/重启、Operation/Run 恢复和 Windows 远端 Linux Core 使用说明，将 exchange 挂载移至需要文件输入输出的高级步骤；验证命令与当前 CLI/operator 源码一致，停止/重建保留数据，不使用 down -v 或全局清理。（DOCKER-DELIVERY-005、006、010）
- [x] 3.3 扩展一致性检查覆盖手册中的 Core Demo、Core Compose 材料和 CLI 镜像 ENV，增加缺字段、错误网络/挂载及 Demo 漂移夹具；在 AGENTS.md 写入同步维护和检查入口，验证仓库材料正向检查及新增负向测试均通过。（DOCKER-DELIVERY-011）

## 4. 打包材料与检查门禁

- [x] 4.1 将 core.run.env.example 加入 build-docker-release.mjs 复制清单，并在复制前调用一致性检查；保留原始构建身份、sourceInputHash、公开 digest、协议和 manifest 格式门禁，验证检查器能发现漏打包模板及双语手册缺失。（DOCKER-DELIVERY-001、009、011）
- [x] 4.2 在明确标注的本机材料夹具中核对 staging 内容、两个模板与源文件一致、归档文件及 SHA256SUMS/压缩包 SHA256；验证改动或移除模板导致检查失败，夹具不能被报告为通过正式 package 门禁的新发行包。（DOCKER-DELIVERY-001、011）
- [x] 4.3 运行 node scripts/check-docker-quickstart.mjs、node --test scripts/check-docker-quickstart.test.mjs 和 node scripts/check-native-boundary.mjs，核对检查已被现有 scripts/*.test.mjs 发现；记录正式候选可执行状态，若构建/远端身份不满足就保留门禁及未执行项，不 push、不修改构建元数据。（DOCKER-DELIVERY-009、011）

## 5. 跨材料的终端运行验证

- [x] 5.1 在独立 Engine 28+ 或隔离安装中使用固定发行镜像按默认 Docker run 路径冷启动，确认 Core 自动准备依赖、完整探针成功，CLI 以真实 TTY 登录并通过 create --wait 自动启动 Work、chat 收到真实模型回复和成功结束状态；记录实际镜像与原 Work/Operation/Session/Run ID。（DOCKER-DELIVERY-009、010）
- [x] 5.2 在默认安装中退出并重建 CLI，确认同一状态卷可继续使用凭证且退出不停止 Work；正常停止 Core 后确认本安装受管运行容器停止，再重启核对原 Work/Session/Run/历史及受管卷身份保留；验证不删除数据、不覆盖持久初始化值。（DOCKER-DELIVERY-005、009）
- [x] 5.3 使用独立数据和状态卷验证 Core Compose Demo 配合同一交互 Docker run CLI，重复首条真实回复、CLI 重建和 Core 停止/恢复检查；确认新默认路径和 Demo 各有独立证据，且均不需要 GUI 操作。（DOCKER-DELIVERY-009、011）
- [x] 5.4 验证配置缺项、短密码、不合法模型地址、缺 socket、镜像不可取得、端口/名称冲突和完整就绪等待失败均不能报告成功；以受控故障验证等待命令非零退出及失败后的操作不会自动执行，验证 Operation/Run 中断按原 ID 恢复而不重提 mutation；检查每次故障仅清理精确测试身份的资源。（DOCKER-DELIVERY-006、009、010）
- [x] 5.5 新增 docs/docker-quickstart-acceptance.md，逐项记录上述终端验证、材料检查、命令/环境、结果、未执行项和清理范围，并在手册中链接；真实模型未验证时明确标记，历史 Windows/Desktop 事实保留，不能以 fixture 或 Linux 终端结果替代。最后运行 OpenSpec 严格校验和 git diff --check，确认所有任务结果可追溯且未执行对外推送/发布。（DOCKER-DELIVERY-009、011）
