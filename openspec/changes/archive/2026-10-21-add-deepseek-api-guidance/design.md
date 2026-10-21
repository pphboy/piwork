# Design

## Context

动机与用户可见范围见 [proposal.md](proposal.md)，验收契约见 [ONBOARD-006](specs/web-onboarding/spec.md)。当前 Quick setup 在 `quick-setup.ts` 的新增模式调用共享 `modelFields`，Key 位于可折叠高级区之前；完整 AI models 页面也复用该函数。现有 `.form-grid` 是纵向 flex，Quick setup 另有独立样式作用域。

现有 `quick-setup.ts` 点击代理会把所有无修饰键的链接交给站内导航，未识别 `target="_blank"` 或外部 origin。单独增加链接属性仍会触发错误的站内处理。此次在编码前明确局部样式及原生外链与站内保护的边界，因此保留这份简短设计。

## Goals / Non-Goals

**Goals:** 在 Key 输入前提供安静、清晰的获取入口；用现有视觉令牌完成宽窄屏样式；打开平台时保留同一表单与原安全生命周期。

**Non-Goals:** 品牌推广横幅、第三方登录/取 Key 集成、新组件库、共享模型表单重构、全站链接治理及后端行为调整。

## Decisions

### 1. 提示由 Quick setup 局部拥有

在新增模式的表单中、共享 `modelFields` 输出之前插入静态说明块，使用局部类名（如 `.setup-api-guidance`）。新增表单已经拥有模式切换与重绘生命周期，无须状态或网络请求。保留共享模型字段的签名和渲染，避免让完整 AI models 页面也出现供应商推荐。

组件选择为静态帮助内容加原生 Link；不复用表示状态结果的 Feedback，也不建立 Banner、Toast 或 Dialog。这样推荐有清晰分组，同时不会与真实配置错误或保存结果混淆。

### 2. 采用与表单对齐的两段式浅色提示块

示意仅表达层级，文案允许随视口自然折行：

```text
+----------------------------------------------------------+
| We recommend using the DeepSeek API directly.             |
| Get your API key at platform.deepseek.com. [external]     |
+----------------------------------------------------------+

API Key
+----------------------------------------------------------+
|                                                          |
+----------------------------------------------------------+
Write-only. Used by this model only.

> Advanced settings
```

| 项目 | 计划样式 |
| --- | --- |
| 位置和宽度 | 新增模型表单首个内容块，宽度 100%，`min-width: 0`；跟随现有纵向布局，与 Key 输入外边界对齐 |
| 底色和边框 | `var(--surface-subtle)`（当前 `#f8fbff`）；1px 实线 `var(--border)`（当前 `#dce7f2`） |
| 圆角和阴影 | `var(--radius)`（当前 8px）；无阴影 |
| 内外间距 | 内边距 12px；两段间距 4px；下方沿用表单 20px gap，避免再叠加外边距 |
| 推荐句 | 13px，字重 550，行高 1.5，`var(--ink)`；普通段落语义，无额外标题层级 |
| 获取说明 | 12px，行高 1.6，`var(--muted)` |
| 平台链接 | 继承说明字号，`var(--accent)`，常显细下划线；inline-block 与 max-width:100% 使域名和外链图标优先整体换行，避免图标单独落行；hover 使用 `var(--accent-hover)`；保留全局 focus-visible 2px accent 描边及 3px 偏移 |
| 外链标记 | 复用已有 `icon('external', 14)`，紧随域名，装饰图形不重复播报；链接可访问说明包含新标签页行为 |
| 响应式 | 容器与域名允许自然换行（必要处 `overflow-wrap: anywhere`），不设固定高度或截断；360px 与宽屏使用同一结构，焦点描边不被裁切 |
| 动效和状态 | 静态内容无动效；不使用 live region、Pending、成功/警告色或额外按钮 |

采用中性浅色提示块，而非强品牌色大卡片，使它从次级帮助中可发现，同时继续让 Key 输入与 Save and continue 承担主要任务。样式仅作用于本提示，不改共享 tokens、链接或其他卡片。

### 3. 保留原生外链，不进入站内离开流程

使用固定 `href="https://platform.deepseek.com"`、`target="_blank"` 和 `rel="noopener noreferrer"`，不拼接任何运行时字段。局部点击代理在普通链接分支识别新窗口目标及外部 origin，让浏览器执行其默认行为；原修饰键分支和内部同页导航继续沿用原有处理。

平台链接不附加 `data-action`、`data-nav` 或工作台离开标记，不调用表单提交、Test 或 dirty 清理。对比方案是在点击时调用 `window.open`；选择原生 Link 是为了同时保留键盘、复制链接及浏览器修饰键行为。后台回读仍只更新既有所属状态，不为提示新增重绘或轮询。

### 4. 复用现有浏览器夹具验证真实交互与样式

在 `quick-setup.spec.mjs` 的首设和模式切换场景中追加必要断言；单独验证鼠标/键盘外链与草稿保留，复用原站内离开/晚响应用例保护点击代理改动。平台请求通过 Playwright 合成响应处理，不依赖真实账号、外部网络或付费模型。

采用已有截图/几何检查方式，核对 1440px 与 360px 的位置、对齐、换行、可见域名、hover 和 focus-visible。截图只使用合成数据；提交到变更的必要验收图须标明 fixture，临时输出归 `dist/`。普通文案和样式复用这些浏览器断言，不增加镜像实现的单元测试。

### 5. 按既有构建链交付

| 文件或入口 | 职责 |
| --- | --- |
| `apps/console-webui/src/quick-setup.ts` | 局部提示与链接点击边界 |
| `apps/console-webui/public/style.css` | scoped 提示样式 |
| `apps/console-webui/test/quick-setup.spec.mjs`、现有管理页测试 | 行为、模式范围、草稿及视觉核对 |
| Console `typecheck` / `build`、`scripts/sync-console-assets.mjs` | 编译、合成共享 CSS、同步 `internal/consoleassets/static/` |
| Go 独立构建（沿 `scripts/build-go.sh` 的 Go 参数及元数据生成） | 保留 CGO=0、readonly、trimpath、真实 commit/dirty/UI hash 等参数，直接输出 `dist/deepseek-api-guidance/go/`；`managed-output` 只允许固定目录，不能用 `PIWORK_GO_BUILD_DIR` 指定嵌套输出，也不能因此替换含数据的 `dist/go` |

## Risks / Trade-offs

- [外链被站内代理拦截，导致离开确认或丢失 Key] → 同时明确链接属性与代理分流，验证新页面和原文档身份、草稿、dirty 以及零写入请求。
- [提示看起来像故障或抢占保存动作] → 中性底色、无状态角色、无主要按钮，使用两段文字和普通链接。
- [窄屏长域名或焦点描边溢出] → 不截断，允许折行与内容自适应高度，实际检查 360px 的几何边界和键盘焦点。
- [给通用模型管理引入供应商倾向] → 提示归 Quick setup 新增模式；共享字段和完整管理页维持原有作用域。

## Migration Plan

无数据迁移。实施、构建及验证完成后，更新包含对应 Console 资源的 Core 成品，运行实例通过正常重启加载新嵌入页面；验证使用隔离目录，不停止用户现有安装。回退局部 TS/CSS 与对应嵌入资源即可，模型、Key、Runtime 与 Work 数据无须更改。
