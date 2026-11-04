# Desktop 实施来源与验证索引

此表是实际生产所有者与恢复/测试入口映射，不是把原型场景勾成已通过。D 编号保留附件真实名称；原型中的计时百分比、假取消和无真实 API 的 General 开关没有搬入生产。Launcher、第三方 iframe 内容不在本 change 内。

## 当前执行证据

- 2026-11-01：使用 Node 24 内置 `node:module.stripTypeScriptTypes({mode:"transform"})` 将实际源模块和依赖无第三方包的契约测试临时转换到 `dist/state-contract-smoke/`，初次 23 个文件 342/342 通过；补充安全读取/Admission 投影后，2026-11-01 09:34 的 33 个文件 414/414 通过（含 `image-drafts.test.ts` 3 例、`preferences-adapter.test.ts` 4 例、`session-adapter.test.ts` 2 例、`admission-feedback.test.ts` 5 例、Chat Run 两个文件 13 例，含原 Work 显示上下文捕获）。09:44 扩展到 44 个不重复的直接源文件测试，624/624 通过；09:50 最终当前来源（Works 来源内错误归属、About 与日志/cleanup deadline）47 个不重复文件 639/639 通过，无 skip（`dist/state-contract-smoke/results-final.log`）。它不是 TypeScript 类型检查或正式 workspace 构建。
- 新增 Request 列表五个测试（单独重跑 5/5 通过）覆盖同一 Promise 等待、确认空/首读失败/旧数据刷新失败、身份切换后旧读不释放新读，以及 Work/Service 过滤结果和失败恢复相互隔离、下一页失败保留原前缀/cursor/checkedAt且显式重试只追加确认结果；修改仅为只读请求协调，不改变取消或 Retry 协议。
- 新增 ImageDrafts 三个直接导入测试覆盖身份清理后的迟到图像、原接受快照只消费原图像、无效类型/第五图拒绝保留旧输入；解码器为合成窄替身，不能称真实浏览器图像解码已验证。
- 首轮误纳需要 Playwright 的 preferences 测试因依赖未安装而失败；已明确从无第三方依赖 smoke 集合移出，未记为通过。首轮 Request identity 测试修正为原 MetadataReads.cancel 的拒绝语义后通过。
- 结果日志：`dist/state-contract-smoke/results-latest.log`（临时、忽略）；正式 tsc/typecheck、WebUI build、浏览器截图与真实 Go/Core/Docker 链尚需集成验证；以下“浏览器/真实链”列全部是待执行入口，不是通过证据。

## 逐来源族

|族/真实名称|实际状态所有者与入口|可观察状态|安全恢复|已执行直接契约（仅所述 smoke）|待执行/跨端验证|
|---|---|---|---|---|---|
|D01 Core admission, session and connection|DesktopAdapter.checkSession / initializeAttempt / checkConnection; core-admission.ts；Session/Auth startup, connection and direct Work routes|session_loading, session_unavailable, signed_out, sign_in_unknown, credential_cleanup_required, checking, recovering, ready, unconfigured, failed, unreachable, unconfirmed, paused, retained_workspace_blocked|Original read-only session/status retry; clearIdentity invalidates epoch; no automatic login replay|pending-adapter,core-admission,session-adapter,admission-feedback|local-auth,feedback,native-auth|
|D02 Works list and retained reads|DesktopAdapter.listWorks; worksChecked/worksError; app works()；Works route, search and Refresh|首读/确认空/首败/保留刷新/刷新失败；search_no_matches, core_offline, environment_not_ready|Retain confirmed rows/search; explicit GET retry; empty only after confirmation|continuity-adapter|feedback|
|D03 Work lifecycle projection|lifecycle.ts projectWork; completion-exits.ts; adapter workSync/lifecycleIntent；Work row quick action, opened Work Header|stopped_startable, create_accepted, start_accepted, Preparing, Starting, Ready, Degraded, stop_accepted, Stopping, stop_unconfirmed, delete_accepted, Deleted, Failed_retryable, Unknown, access_revoked, succeeded_but_work_not_confirmed|Original Operation plus independent Work/list readback; lifecycle unknown remains locked|completion-exits,continuity-adapter|browser,feedback|
|D04 Create/stop/delete and unsent forms|draft-revision.ts; app createDraft/workControls; control-rules.ts；New Work, Stop/Delete confirmation|editable_draft, field_invalid, name_conflict, submitting, accepted, unknown_with_original_id, unknown_without_id, confirmed_failure, completed, unsaved_close_confirmation|Retain submitted identity and new draft revision; destructive confirmation remains separate|draft-revision,control-rules|feedback|
|D05 Service catalog and viewport|DesktopAdapter serviceLoads/entries/entryErrors/serviceDenials; projectWork；Service picker, iframe and Open in new tab|首读/确认空/首败/保留刷新/刷新失败；no_services, no_declared_port, disabled, Starting, Recovering, Running_once, Completed_once, Stopped, Failed, Unknown, Removed, entry_pending, entry_error, embed_denied, preview_unconfirmed, external_open_blocked, ready_iframe|Exact Work/Service/port entry retry; retain iframe on transient observation; revoke on authoritative denial|continuity-adapter,work-navigation|feedback,browser|
|D06 Service controls, logs and cleanup|DesktopAdapter operateService/logStates/logRequests/temporaryCleanups; app serviceControls；Manage services, Service details and logs|submit_start_stop_restart_remove, accepted_pending, unknown_locked, failed, succeeded_waiting_observation, removed_target, unassigned_original_task, logs_initial, logs_loading, logs_ready, logs_read_error_cached, logs_truncated, cleanup_unconfirmed, cleanup_diagnostics|Original control receipt; independent GET logs retains prior content; exact Service cleanup diagnostics|continuity-adapter|feedback|
|D07 File browser and selection|DesktopAdapter directories/directoryLoads; app files(); work-navigation.ts；Files tab/path/Refresh/selection|首读/确认空/首败/保留刷新/刷新失败；selected_multiple, directory, file, special_entry, restore_selection_failed|Current Work+path checked state; retain old rows and selection; safe directory fallback|work-navigation,file-admission|feedback,recovery|
|D08 File preview and editor|DesktopAdapter readFile/stopFileReads; image-content.ts; app fileDraft/fileBaseline；File preview/editor and request file links|idle, loading, text_ready, image_ready, download_only_binary, download_only_oversized, download_only_unsupported, download_only_document, missing, unavailable, error, dirty_draft, no_modification_baseline, reread_changed_type, reread_saved_version|Per-target abort/revision; dirty draft retained on missing/read failure; current baseline required|file-admission,file-preview-adapter|file-target,feedback,recovery|
|D09 File writes and batch mutation|file-results.ts FileMutationResults/UnknownFileLocks; DesktopAdapter writeFile/saveFile；Save/Rename/Copy/Move/Delete/New folder|pending, all_succeeded, confirmed_failed, partial_results, unknown_paths_locked, overwrite_consent, precondition_412, saved_but_readback_unconfirmed, not_submitted, retry_failed_subset|Per-path ledger; retry explicitly failed subset only; unknown locks survive display dismissal|file-results,file-admission|recovery,feedback|
|D10 File upload|DesktopAdapter uploadFiles/uploadIntents/uploadProgress; app pendingUploadTarget；Upload picker, overwrite and per-file result disclosure|choosing, preflight, uploading_known_bytes, uploading_unknown_total, verification, ready, failed, unknown, partial, overwrite_consent|Original File and target version; actual bytes only; explicit failure subset and consent|file-admission,file-results|recovery,feedback|
|D11 Configuration save and apply|configuration.ts; DesktopAdapter saveConfiguration/applyConfiguration; app config draft；Settings simple/Advanced/AGENTS Save and Apply|首读/确认空/首败/保留刷新/刷新失败；in_use, dirty, invalid_json, saving, saved_not_applied, applying, apply_unknown_locked, apply_failed, applied_confirmed, saved_but_refresh_unconfirmed, draft_during_other_apply|Save confirmation independent of readback; Apply original Operation; retain revision and draft|completion-exits|recovery,feedback|
|D12 Skills, packages and candidate adoption|DesktopAdapter catalog/installPackage/replaceSkill; app settingsTaskRows；Settings Skills/Packages/candidate details|首读/确认空/首败/保留刷新/刷新失败；selected, not_selected, saved_copy_unavailable, enabled, disabled, saved_not_applied, loaded, not_loaded, runtime_unconfirmed, install_upload, install_accepted, install_unknown, install_failed, remove_confirm, candidate_preparing, candidate_succeeded, candidate_failed, candidate_superseded, candidate_cleanup_pending, adoption_verified, adoption_failed, adoption_not_confirmed|Read back original acceptance; saved copy, active revision and adoption remain separate|continuity-adapter|recovery,feedback|
|D13 Sessions, history and command reads|DesktopAdapter loadSessions/loadSession/historyPage; HistoryProjection/LegacyHistoryProjection；Session chooser/history/load earlier/command reads|首读/确认空/首败/保留刷新/刷新失败；new_empty_session, history_more, history_exhausted, history_snapshot_expired, history_partial_or_order_unconfirmed, unavailable_session, commands_loading, commands_empty, commands_error, commands_filter_no_match|Frozen page/range identities; retain history/draft; no read failure interpreted as empty|continuity-adapter,paged-message-adapter,paged-message-identity,history,legacy-history-adapter|recovery,feedback|
|D14 Message submission, Run and tool execution|DesktopAdapter send/chatSubmissions/failedChatSnapshots; live-message-sources.ts; chat-run-feedback.ts accepted-original tracker；Composer, message recovery and Run/tool disclosure|sending, submission_unknown, submission_failed, submission_accepted, run_accepted, run_running, run_cancelling, run_succeeded, run_failed, run_cancelled, run_interrupted, tool_running, tool_succeeded, tool_failed, tool_waiting|Read original submission key; never automatic prompt replay; cancel acceptance independent of terminal Run|control-adapter,paged-message-adapter,paged-message-identity,chat-run-feedback,chat-run-observation-adapter|history,recovery,feedback|
|D15 Session model and thinking|DesktopAdapter modelSelections/pairSaves/saveModel; app chatSettings；Single Response settings Model+Thinking summary|首读/确认空/首败/保留刷新/刷新失败；clean, dirty, saving, unknown_locked, default_available, default_unavailable, saved_model_unavailable, catalog_unconfirmed, session_unavailable, thinking_unsupported, thinking_unconfirmed, compatibility_profile_required, normal_requires_confirmation|Whole pair serialized; unknown reads original Session; unsupported capabilities block only relevant choice|compatible-thinking|recovery,feedback|
|D16 Image attachment/history|images.ts ImageDrafts; DesktopAdapter imageCapabilities/imageLoads；Picker/paste/drop, image draft and history attachment|capability_reading, capability_unavailable, draft_reading, draft_ready, invalid_type, invalid_dimensions, size_or_count_limit, history_loading, history_ready, history_error|Bound bytes/count/dimensions/type; generation invalidation and original accepted image consumption|image-drafts|file-preview-adapter,feedback|
|D17 Pi Request inspection/cancellation|DesktopAdapter requests/requestPageReads/loadRequests/loadRequest/requestCancellations；Opened Work Requests and Service-filtered Request inspector|首读/确认空/首败/保留刷新/刷新失败；pending, running, waiting_result, waiting_apply, needs_attention, completed, cancelled, cancelling, failed, historical, read_unconfirmed, cancellation_pending, cancellation_accepted, cancellation_unknown, retry_unknown, evidence_more|Same Work+filter shared Promise; original Request detail/cancel identity; readback no replay|request-list-adapter,control-adapter,control-rules|recovery,feedback|
|D18 Import inspection and submission|DesktopAdapter InspectionContext/inspectWork/importWork; completion-exits.ts；Anonymous Inspect, Import and imported Work Start|no_file, receiving_known_bytes, receiving_unknown_total, validating, forwarding, inspection_verified, inspection_failed, binding_requirements, sign_in_required, name_conflict, submitting, accepted, unknown_original_id, unknown_missing_id, operation_failed, imported_stopped, start_after_import_pending, start_after_import_unknown, work_ready, cleanup_pending|Original inspection/Operation; unknown no resubmit; success stays stopped until explicit Start|completion-exits|recovery,native-auth,feedback|
|D19 Work export flow and progress-only Details|export-flow.ts / export-admission.ts / export-panel.ts (export worker)；Export compact progress, nonmodal Details, separate recovery|checking, stop_confirmation_required, stopping, exporting, snapshot_preparing, snapshot_validating, snapshot_verified, preparing_download, transferring_known_bytes, ready, delivered, paused, unknown, failed, snapshot_expired, snapshot_unavailable, revoked, readback_only, reopen_existing|Original Work/Operation/snapshot/transfer; Pause≠Close, Check≠Resume; single handoff|See export-evidence.md|export-presentation,export-adapter,export-flow; real-core.mjs|
|D20 Diagnostic log export|DesktopAdapter logExport/createLogExport/refreshLogExport；Account diagnostic log export|creating, collecting, packing, ready_complete, ready_with_gaps, failed, interrupted, expired, unknown, delivered|Original idempotency key, receipt and retained warning; query only after restore|log-export-adapter|log-export-presentation; log-export-real-core.mjs|
|D21 Explicit Operation/history recovery|operation-recovery.ts / operation-diagnostics.ts; adapter known Operation storage；Work task/history, no-visible-Work fixed task entry, scoped diagnostics|首读/确认空/首败/保留刷新/刷新失败；accepted, pending, preparing, running, succeeded, failed, unknown, superseded, observation_paused, observation_error, local_record_not_saved, historical_terminal_hint, missing_original_id, wrong_target_or_kind|Exact Core/account/Work/kind original ID; no global operation history; terminal hint not admission|completion-exits,continuity-adapter|recovery,feedback|
|D22 About, preference and recovery utilities|DesktopAdapter loadAbout/preferences/preferenceSequence; app defaultCorePreferences；About, default Core preference, clipboard and external opening|about_initial, about_loaded, about_unavailable, notes_unavailable, preferences_loading, preferences_saving, preferences_clearing, preferences_unconfirmed, clipboard_denied, external_open_blocked|Version unavailable is explicit; preference unknown requires GET; original input context retained|pending-adapter,preferences-adapter,admission-feedback,about-read-feedback|preferences,feedback|
|D23 Cross-surface action/notification ownership|action-state.ts / feedback-notices.ts and shared notices.js (integration lead)；All action buttons and one floating notice host|idle, pending, slow, accepted, confirmed, failed, unknown_blocked, readback_refreshing, readback_failed, owner_disappeared, stale_identity, notification_dismissed|Feature owner retains locks; notice dismissal only display; epoch and generation gate recovery|Shared notices.test.mjs / lead evidence|feedback,language-switch,modal-presentation|

## 未关闭的覆盖责任

- D01–D23 每族均映射，但同族“存在直接测试”不代表所有列出的视觉/稀有分支已执行；来源映射与实跑验收分别判断：本表可支持 1.2 的 Desktop 映射完整性审查，但未运行浏览器、资源嵌入和真实 Core 的责任仍保留，不能据此完成 5.x/8.x。
- D17 原 app 的首读失败可落到 Empty、首读显示普通 Reading 的问题由入口集成负责人修正；Service 过滤改经同 Work+filter ActionState 读取所有者，与 Retry 共享故障通知恢复。`feedback.test.ts` 新增首读/保留刷新、过滤失败通知恢复、迟到过滤拒绝测试；本表不能替代其 UI 回归。
- D19 原 ID、字节/hash、单次交付与真实 Docker/helper→下载→Inspect→Import stopped→显式 Start 由 export 实现/集成记录补证；缺 Docker 不得勾选 4.3。
- 初始独立登录/会话和 hosted admission 并未因原型没有完整页面而排除；`local-auth.test.ts`、`native-auth.test.ts`、`pending-adapter.test.ts`、`onboarding.test.ts` 为真实入口/协议测试分工。
- 新增检查只证明其断言范围；所有者接口、未知锁、焦点/草稿/iframe 保留还需源码审查及对应浏览器测试，不以文件行数或覆盖索引长度代替。

## 可访问 UI 预检夹具

`dist/ui-preflight/` 是临时的实际 Desktop 源码转换输出加合成 HTTP 服务。它复用原嵌入 marked、共享图标/通知/CSS，支持 Works/Requests 首读延迟、失败、确认空与保留内容刷新、配置保存拒绝及可编辑 Service iframe。无凭证/真实 Core 调用；managed preview/CUA 由主任务运行。该夹具不是正式构建、Go 嵌入或 Docker 证据。

## 原型外入口、独立表单与不适用组合

|实际入口|状态、所有者及恢复|准确测试入口（存在不等于本轮已跑）|
|---|---|---|
|独立 CLI Desktop `auth()` 登录表单、hosted `/login`、深链接初始壳|DesktopAdapter `initializeAttempt/checkSession/pendingSignIn`；10秒首读预算、至多既有次数安全读取重试、unknown登录只读核对、旧身份清理|`local-auth.test.ts`: `hung ... initialization offers a fresh readonly retry after ten seconds`、`a lost sign-in response is read back and never submitted automatically again`、`stale CSRF ... does not retry login`；hosted统一表单另归 Administration onboarding|
|独立默认 Core 表单|`preferences`/`preferenceSequence`；GET/PUT/DELETE各自状态，unknown锁直到GET确认，不影响当前Core连接|`preferences.test.ts`: `lost mutation reply stays protected until successful readonly confirmation`、`an old GET cannot replace a newer successful save`；`feedback.test.ts`: `default Core saving stays in its button without moving the sign-in fields`|
|文件编辑器、新目录、Rename/Move/Copy/Delete/Upload独立表单|`FileMutationResults/UnknownFileLocks`及原目标/覆盖同意；保留dirty draft、部分结果与未知目标|`file-results.test.ts`、`file-admission.test.ts`、`file-preview-adapter.test.ts`；`recovery.test.ts` R1；`feedback.test.ts`: `retrying a failed file read keeps the unsaved draft and its separate reread baseline`|
|Settings Advanced JSON、AGENTS、Skills/Packages独立编辑及上传|`Configuration`草稿/提交快照；Save和Apply分离，关联读失败不撤销确认|`recovery.test.ts` R2/R7；`feedback.test.ts`: `D14 configuration confirms before failed refresh and preserves newer edits`、`Apply and Package recovery stay in Settings and preserve a draft on readback failure`|
|Response settings Model/Thinking、消息恢复浮层、图像选择|`modelSelections/pairSaves`、原提交快照、`ImageDrafts`；原Session/profile/level成对、迟到结果不消费新草稿|`compatible-thinking.test.ts`、`image-drafts.test.ts`；`feedback.test.ts`: `automatic model save ends on unknown while the draft and original lock remain`、`unknown submission checks the original key and never retries a missing mapping`|
|匿名 Inspect/Import 表单、快照 ID 恢复、Operation查询|`InspectionContext`、ExportFlows和Operation所属身份；没有有效原ID说明恢复限制，不以用户输入ID猜测归属|`completion-exits.test.ts`；`recovery.test.ts` R4/R5；`feedback.test.ts`: `create can find a copied original ID without a saved record or Work`；导出直接tests由export-evidence记录|
|About、Clipboard、外部窗口恢复|`about`局部/core双读取，保留版本；clipboard拒绝只能手动复制原值；popup阻止保留原真实链接|`feedback.test.ts`: `About displays local version while Core is delayed and escapes embedded notes`、`About aggregates version reads and keeps the known version during refresh`；`feedback.test.ts`: `Clipboard denial retains the original value and persistent recovery without a business write`；外部Service入口由`browser.test.ts`运行中Service/新窗口测试与`continuity-adapter.test.ts`入口拒绝覆盖|

明确不适用而非遗漏：
- D21 `unknown/observation_paused/observation_error` 是 Desktop 原任务的观察/提交状态，不向 Core Operation 状态集合新增 cancelled/unknown 服务端枚举；来源为 `models.ts Operation`、`operation-recovery.ts` 和 adapter 的原 ID 观察字段。
- D15 不新增 Work General 的独立模型Save/Apply；生产所有者为 Session `modelSelections/pairSaves`，对应现行 Model+Thinking 成对自动保存。
- D05 Service `Stopped` 不等价 `enabled=false`；`models.ts Service` 分离 enabled/observed；无声明端口的Service没有可开的iframe，是明确准入分支。
- D10/D19 无分母时不显示百分比，未知/暂停/失败不伪造传输速度或后台取消；`adapter.ts`真实transfer字段与`export-flow.ts`原阶段控制为依据。
- Desktop Package 支持Core目录及npm/Git/目录/ZIP；Console“不支持Core目录来源”的限制不迁移到Desktop（`app.ts install-package`）。

## 独立 Session / 默认 Core 审查结果

审查实际 `DesktopAdapter.sessionRead/checkSession/initializeAttempt/signIn/checkSignInOutcome/preferenceRequest/loadPreferences/savePreferences/clearIdentity`，及 app 初始 `.app-loading`、`signIn/defaultCorePreferences`、`reportInitializationFailure`、通知投影和只读恢复入口。Session 10 秒读取预算、Cookie 二次确认、旧身份丢弃和未知登录只读核对不变；没有自动重放凭证。补齐默认 Core GET 的相同安全读取预算，保留确认值；旧身份/新写入仅终止本地旧 GET，不取消/重放 mutation。未确认 preference write 只有真正确认的 GET 才解锁。

新增 `admission-feedback.ts` 仅投影窄 readonly 事实：Session、默认 Core、原 sign-in unknown 各自 owner。通知关闭不清业务状态；Pending 不冒充确认；语言切换保持原事件身份。已知登录拒绝仍属于原 action，未知登录转交原 feature owner，确认后不再复活旧 generic 错误。默认 Core 普通成功转为 3 秒 notice，错误/unknown 同时保留原页面恢复。

上述直接测试不替代独立登录/Preferences 浏览器验证：`local-auth.test.ts` 补未知通知关闭与只读恢复断言；`preferences.test.ts` 补通知关闭不释放未知锁、读失败保锁、确认读恢复，均仍需正式环境执行。最新 smoke 为匹配临时目录层级，仅重定位 ImageDrafts 的 PNG fixture 路径；未改业务/测试断言。

## Chat 原接受 Run 的晚到结果

`chat-run-feedback.ts` 只登记本 UI 接受的原 Work/Session/Run（含原 unknown submission 只读核对得到的已接受 Run），不扫描旧历史、不借用 Operation 注册器。真实 Run 读取/事件只推进本地观察 revision；断流/重连开始清 error 不推进确认。失败/中断及底层执行错误保留原 Chat/Run 恢复，非终态观察错误为 unknown；另一次提示不覆盖旧 owner；成功/取消终态不弹完成通知。

`chat-run-feedback.test.ts` 直接验证历史不播报、精确接受、未知只凭新真实观察清除、失败关闭不改状态、后续提示不替换原 owner、身份失效、成功/取消退休无成功提醒。`chat-run-observation-adapter.test.ts` 验证原读取/事件证据、3 类显式错误身份拒绝，以及最终 GET 在身份或当前 Run 更换后不得变更旧对象/开启新身份后续读取。旧响应缺失 ID 的兼容形式保留；提供矛盾 ID 必须拒绝。浏览器晚到 Model failure 用实际 HTTP fixture 与发送入口补断言，尚需正式运行。

### 2026-11-01 09:38 托管预览/CUA 观察（主任务回传）

主任务通过 combined ignored preview 的实际 Desktop 源码与合成 HTTP fixture，用本 UI 的真实 composer 发送，随后让原 Run 异步失败：观察到**恰好 1 条**携带原 Work 上下文的失败通知；pending 标记已消失；关闭通知后，原 Chat/Run 的失败说明仍保留。此条是主任务 CUA 观察，不是本分工运行 Playwright；不能当作真实 Core/model 证据。unknown、跨 Work 的真实浏览器行为尚未验证，直接契约测试不能代替该缺口。


### D22 About 有界读取与独立所有者（2026-11-01 09:46）

`AboutReadFeedback` 只接收 identity、local/Core side、reading、error 与真实成功返回对象引用；不接收完整 adapter/view。两侧失败独立 sticky owner，刷新开始/清除错误不等于成功，只有该侧新成功 receipt 才静默恢复；登出时的 Core 登录提示不投影为读取失败。版本与 release notes 原有数据保留。适配器 About GET 采用既有十秒只读预算；身份清理解除旧 local loading/error，晚响应不跨身份落地。已有 request map 对同一 GET 合并，新增测试明确验证，不宣称修复不存在的同身份覆盖竞态。

`about-read-feedback.test.ts` 5/5 直接源测试通过：两侧独立/新 receipt、并行一次 GET、十秒读取超时保留已知版本、旧身份晚返回不能覆盖新读取。App 投影交付 `/tmp/desktop-about-projection.patch`，已由入口 owner 集成；浏览器 About 错误/恢复尚待 root CUA，不能据这四例声称完整 D22 或全部 5.4 验收。

### 有限候选验收差距（不以 8.1 构建阻塞替代逐条分析）

- **5.1**：已执行 pending/core-admission/continuity/control/read-feedback 契约涵盖十秒、空与失败、保留已有事实、未知不重放、原 Service/Work 恢复。首次 Works 启动重复通知已由入口 owner 按原错误对象/epoch 的 Works 来源归属修复，最终实际入口 CUA 复核尚待；不能把单个 Requests/资源 CUA 扩张为全部创建/生命周期浏览器路径。
- **5.3**：已执行 compatible-thinking 成组保存/序列化、draft/history/image/Requests/原 Run 观察契约。实际渲染的 Model+Thinking 单组摘要/自动保存、unknown prompt 只读恢复（feedback 1909/2648/2696）、Requests 关闭/切过滤器晚失败浏览器回归仍未执行。root 已报告的晚 Run 失败与 Requests 恢复 CUA 仅证明对应路径。
- **5.4**：已执行 Export/log export 原 ID、未知不重 POST、一次交付及诊断字段保留契约。Import 完成仍 Stopped/仅显式 Start、无可见 Work 固定恢复入口等实际 UI 浏览器路径尚未执行（例如 feedback 1315）；About CUA 待复核。真实 Docker/Core 导入导出链另属 4.3/8.2 明确阻塞，不与直接契约结果混淆。


D06 最终有限补充：`diagnostic-read-deadline.test.ts` 6/6，覆盖日志 tailLines=100、Run cleanup、Service cleanup 三个现有只读端点各自 headers/body 悬挂十秒收敛，保留原内容和 checkedAt，仅显式 GET 重试。不覆盖流式日志导出/下载，不扩展到写超时。`read-failure-origin.test.ts` 4/4 验证真实 HTTP/非法 Works shape 错误按原错误对象及 epoch 归属，字符串相同不匹配、跨身份失效、已知登录 POST 拒绝不误标为 GET。初版 provenance 的 Promise 包装暴露两处旧测试依赖固定 microtask 次数（最终实现已删除通用包装，仅在 Works 来源 catch 记录归属），改为 `node:timers/promises` 的下一实际事件循环轮次等待请求边界；保留原业务断言，diagnostic/history/pending 合并 76/76 通过。

09:50 最终47文件639/639通过后，触达7个 source/test 的 incremental style、ui-language、git diff --check 均通过。此 native transform 结果不等于 tsc、锁依赖构建、生成嵌入资源、全 Playwright 或真实 Core 链。

10:04 集成 owner 报告当前49个直接源文件测试664/664、0skip，日志 `dist/state-contract-smoke/results-integrated-final.log`，含新增 Export notice15、Service adapter2 与 known Model+Thinking 成组自动保存回归。Model 的真实浏览器选项点击尚待 CUA 事件/guard 证据；实际 adapter+fixture HTTP Thinking→Model 两次成组 PATCH 已验证，但不冒充 DOM 点击证据，也未推测性放宽守卫。

10:10 D13 unknown 原 submission 只读确认后旧 ActionState 错误残留的 CUA 缺陷：入口已集成 `chat-submission-feedback.ts` 精确 receipt 证明，匹配原 key/work/session、accepted 状态和当前 ActionRecord 后只解析原 notice，把显示交给原 Run/session，命名投影避免 history prune 后旧错误再现。删除同 Work 全部 blocked agent 的宽泛 review；new-session 也在实际 intent 创建时捕获原 key，retry 使用真正新尝试 key。直接测试4/4含 same-Work other-key、错误 session/receipt、跨 identity current guard 与真实 NoticeStore 原 notice 消失而其他 sticky/unknown 不变。最终新 CUA 复核待 root 报告，不将此实现声明为已复测通过。

10:12 Model CUA 定位更新：root 确认键盘 Enter 可选第二模型并产生预期第二次 modelRef/high PATCH，因此 DTO 与业务守卫无错；360px 时内容被 footer 截断、内部滚轮位置归零。源证据为 root capture-scroll 对 modal 内部滚动仍调用 positionOverlay，后者临时放宽 maxHeight 导致滚动偏移被浏览器夹回零。精确 app patch 仅排除当前 dialog 内部 scroll 的 anchor 重定位，外部祖先滚动仍重定位；actual HTTP + 原生 mousewheel 浏览器回归已交入口 owner（尚未执行），未放宽 Model/identity/context 守卫。

10:15 root CUA 回报：unknown prompt 原 POST 仅一次，首次只读 lookup pending 不重放，原 key accepted 后原 Run/assistant reply 恢复且旧502 sticky+inline消失；草稿只在确认后消费。Model+Thinking high 与第二模型均有预期成组 PATCH，键盘选择通过。5.3 原先这两个具体证据缺口已关闭；窄屏原生滚动修复仍待最终 pointer 复核。Requests 现有契约证明 Request/filter/cancel 所有权，源实现仅变更 requests map；尚未找到显式断言同 Work 既有 Session messages/terminal Run 在 Request 成败读取后不变的用例，已将这个单一证据缺口交入口 owner 决定是否补一条直接断言。

10:17 有限5.3复核收口：root 原生滚动 scrollTop68 保持；鼠标 default→supported 各一次成组 PATCH且保留 high，通过。授权补充唯一 Requests 独立性断言已加入 `request-list-adapter.test.ts`：真实 adapter 的同 Work Request 成功与503失败均不替换 Session/message/terminal Run 对象，完整已确认内容 deepEqual 保持；6/6通过，style及diffcheck通过。上述5.3具体行为缺口已关闭；未执行的完整 Playwright/正式构建/真实Core 仍按8.1/8.2独立报告，不把本轮选中 CUA 等同全套浏览器。此处停止进一步扫描。


10:26最终检查点：5.1三来源bootstrap CUA均通过（status、深链Works、零Work已知任务失败的通知关闭后固定原任务恢复入口）；5.3 unknown原submission确认、成组Model+Thinking键盘/鼠标自动保存与Requests消息独立性均完成上述特定证据。最终51直接套件676/676；5.1/5.3已据此勾选。历史“待复核”仅为当时状态，以本条及implementation-evidence最终检查点为准。完整Playwright、正式构建/嵌入及真实Core仍未执行；5.2/5.4不得据此完成。

10:33 native 登录 CUA 精确核验：初测提交 account 与返回 account 不同，保留原未知 intent 合法，不能据此清除 owner。root 用 matching account/Core 复测确认只读 session 成功后 canonical toast 已为0，唯一缺陷为旧 source-owned sign-in inline 残留。最小修复仅在 `signInActionFeedbackVisible` 中对 sign-in + sign-in-owner + adapter.signInUnknown=false 隐藏旧 inline，unknown=true（含不同 account 已登录）仍保留原事实；不改 adapter receipt/锁、不去重通用文字、不改 fallback。admission-feedback6/6、style/diff通过；app精确patch已交入口owner，待最终UI复核。
