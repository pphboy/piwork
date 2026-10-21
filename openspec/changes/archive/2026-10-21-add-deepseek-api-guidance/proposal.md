# Proposal

## Why

Quick setup 首次配置已默认使用 DeepSeek，但 API Key 输入框缺少获取 Key 的指引。用户要求在该字段上方推荐直接使用 DeepSeek API，并把平台链接与配套样式一起做好，便于首次配置时找到正确入口。

## What Changes

- 在 Quick setup 新增模型表单的 API Key 标签正上方增加常显说明：`We recommend using the DeepSeek API directly.`，下一行显示 `Get your API key at platform.deepseek.com.`，其中域名链接到 `https://platform.deepseek.com`。
- 提示使用紧凑的浅色背景、细边框、圆角和明确的文字层级，与表单同宽；链接具有可辨的悬停、键盘焦点及外链标记，宽屏与 360px 窄屏均自然换行。
- 平台在新标签页打开，原 Quick setup 页面和未保存输入保留；沿用浏览器原生链接行为，不触发保存、Test 或站内离开确认。
- 范围为 Quick setup 的新增模型模式，包括首次空安装及已有安装主动 Add model；选择已有模型和准备阶段不显示提示。完整 AI models 的通用新增/编辑表单继续保持原有呈现。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `web-onboarding`：新增 Quick setup 的 DeepSeek API 推荐与 Key 获取指引契约，规定出现位置、外链行为、草稿连续性及基本样式表现。

## Impact

- `apps/console-webui/src/quick-setup.ts`：在新增模型表单中插入局部提示；现有点击代理拦截所有普通链接，需要让新标签页外链保留浏览器默认行为，并保留站内离开的原保护。
- `apps/console-webui/public/style.css`：增加仅属于 Quick setup 提示的样式，使用现有颜色、圆角与焦点规则；无需新增依赖或资源模块。
- `apps/console-webui/test/quick-setup.spec.mjs` 及现有管理页测试：复用夹具核对出现范围、位置、外链/草稿行为和宽窄屏表现，不为静态文案建立独立测试框架。
- 实施时按既有 Console build/copy-static/sync 链更新 Go 嵌入资源，并核对生成内容。宿主二进制需在独立构建目录重建；保留 `dist/go/a` 等现有数据，运行中的 Core 更新另行显式重启。
- 不改变现有模型默认值、API/存储、安全身份、保存/Test/准备逻辑，无数据迁移。此前 `improve-server-ui-core-flow` 的已归档记录保持冻结。
