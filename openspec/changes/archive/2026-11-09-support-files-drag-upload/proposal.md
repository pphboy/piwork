# Proposal

## Why

Files 已有完整的多文件上传与冲突处理，但用户仍须打开更多菜单再选择文件。从电脑直接拖入文件可以缩短这一高频操作，同时明确保持当前目录这一上传目标。

## What Changes

- 在 Files 目录列表及其空白区域接收从电脑拖入的单个或多个普通文件，统一上传到当前打开的目录；落在文件夹行上也不改变目标。
- 采用已确认的 A 方案：拖入时在列表内显示临时蒙层与完整目标目录，移出、取消或松手后移除，平时不占用列表空间。
- 松手后通过现有上传流程开始处理，不增加普通上传确认；同名文件沿用明确覆盖确认、条件请求、逐文件进度及成功／失败／未知结果保护。
- 保留 Upload 选择器及 Chat 原有图片拖放；首版不包含文件夹上传、目录树遍历、文件内部拖动整理或在文件预览／编辑器中新增上传落区。
- 在本变更内保留 A 的独立模拟原型，验证落区与目标目录的可辨识性；原型不连接真实文件后端。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-webui`：补充 Files 目录列表的外部文件拖放、临时落点提示及与原上传契约一致的提交行为。

## Impact

- Desktop 前端：`apps/desktop-webui/src/app.ts` 的 Files 渲染、文件输入和事件装配；必要的小型拖放模块；`public/style.css`；`src/i18n/catalog.js` 双语文案。
- 上传执行继续归 `src/adapter.ts` 的 `DesktopAdapter.upload`；复用 `file-results.ts`、原 ActionState、覆盖对话框及准入判断，不新增上传 API、持久队列或后端协议。
- 验证覆盖目录目标、空列表、混入文件夹、重复落下、身份／目录变化、覆盖与未知结果，以及与 Chat 拖放的隔离。
- 实施时通过既有 WebUI 构建链同步 `internal/desktopassets/static/` 并重建宿主程序，使托管工作台与独立 Desktop 使用同一前端资源。当前提案阶段只写本变更的规划与原型附件。
