# Tasks

## 1. 共用上传入口与拖放单元

- [x] 1.1 将 app.ts 中 `upload-input` 的提交处理收拢为接收 File 列表、原目标与 ActionRecord 的共用操作，保留选择器原目录／身份核对、进度归属、覆盖弹层及逐文件账本；验证 Desktop typecheck，以及 recovery 中 `file chooser result cannot target a different directory` 和 file-admission 相关原用例通过。
- [x] 1.2 新增窄 `file-drop.ts` 单元，负责拖拽条目判型和原目标匹配；增加直接 import 实际模块的 `test/file-drop.test.ts`，验证普通单／多文件、空文件、混入目录整批拒绝、不可判定回退、非文件忽略及身份／目录变化，不通过读取或切片 app 源码测试。

## 2. A 落区与原型对应交互

- [x] 2.1 在 Files 目录列表及空目录挂载同一落区，拖入时显示 A 蒙层与完整当前目录，松手交给共用上传入口；同步 CSS 与双语 catalog。增加浏览器用例验证文件夹行与空白处均上传到当前目录、空目录可接收、普通上传无额外确认、列表和 Chat 草稿不移动／丢失；核对 360px、长中文路径及英文提示，并运行 `node scripts/check-ui-language.mjs`。
- [x] 2.2 接入真实离开／取消／drop／页面生命周期清理、上下文失效及非落区默认行为保护，保持 Chat 原图片拖放独立且预览／编辑器不新增 Files 落区；增加浏览器正负例验证子元素间移动不闪烁、Escape／移出／切目录后清除、Files 外层页面不被本地文件替换、文本／链接不误上传、Chat drop 不产生 Files PUT，并核对原 Upload 键盘入口。

## 3. 提交保护与结果回归

- [x] 3.1 扩展相关 feedback／recovery 浏览器用例，让拖放走真实前端上传链路，验证不存在目标的条件 PUT、同名取消与确认、确认后版本改变、混合成功／明确失败／未知及原目标目录读取失败；断言成功项不重做、未知不自动 PUT，待上传 File 和原结果保留，原 Upload 选择器用例仍通过。
- [x] 3.2 验证提交中重复 drop、待覆盖确认时 drop、Stop 在 HEAD 等待中接受、未知目标锁及身份／Work 切换时的边界：新批次未提交、不排队、不替换原 File，旧结果不写入新视图；将新增断言放入所属浏览器用例，并运行现有 file-admission 与 ActionState 冲突相关测试。

## 4. 集成与嵌入交付检查

- [x] 4.1 运行 `npm run typecheck -w @piwork/desktop-webui`、`npm run build -w @piwork/desktop-webui`，通过既有生成链同步 `internal/desktopassets/static/`，执行 `make check-generated-ui` 与 `make build-go`；核对托管工作台和独立 Desktop 使用更新后的同一 Files 资源，生成物没有手改或混入原型。
- [x] 4.2 编译并运行本变更相关模块与浏览器测试，完成双语、窄屏、真实浏览器文件管理器拖入及一个独立测试安装的 Core 上传核对；真实 Core 至少核对普通／空文件字节、子目录目标与同名取消，不隐式启动 Work。按实际条件记录浏览器／平台、通过／失败及未执行范围到本 design，临时截图／日志留在 dist，不用模拟原型代替真实上传验收。
- [x] 4.3 执行 `node scripts/check-webui-boundaries.mjs`、`node scripts/check-native-boundary.mjs`、`node scripts/check-repository-docs.mjs`、本变更的 OpenSpec strict validate 与 `git diff --check`；核对全部任务对齐增量规格、原型附件身份保持真实，未引入 API／依赖／持久队列或无关文档与发布修改。
