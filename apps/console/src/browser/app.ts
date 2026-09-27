type Data = Record<string, unknown>;
const isData = (value: unknown): value is Data => value !== null && typeof value === "object" && !Array.isArray(value);
const app = document.getElementById("app") as HTMLElement;
const nav = document.getElementById("navigation") as HTMLElement;
const logout = document.getElementById("logout") as HTMLButtonElement;
let csrf = "", authenticated = false, dirty = false;
let currentUser: { id: string; account: string } | undefined;
let statusRefresh: (() => Promise<void>) | undefined;
let statusSnapshot: { status: Data; health: Data; checkedAt: Date } | undefined;
const links = [["/", "状态"], ["/users", "用户"], ["/runtime", "运行时"], ["/default-work", "默认 Work"],
  ["/skills", "Skills"], ["/packages", "Packages"], ["/operations", "操作查询"]] as const;
function el<K extends keyof HTMLElementTagNameMap>(name: K, content?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(name); if (content !== undefined) node.textContent = content; if (className) node.className = className; return node;
}
function add(parent: Node, ...children: Node[]) { for (const child of children) parent.appendChild(child); }
function reset(title: string) { app.replaceChildren(el("h1", title)); dirty = false; }
function card() { const item = el("section", undefined, "card"); app.append(item); return item; }
function note(root: Node, text: string, kind = "message") { const node = el("p", text, kind); root.appendChild(node); return node; }
function input(label: string, type = "text", value = "") { const wrapper = el("label", label), node = el("input"); node.type = type; node.value = value; wrapper.append(node); return { wrapper, node }; }
function action(label: string, fn: () => Promise<void> | void, secondary = false) { const b = el("button", label, secondary ? "secondary" : ""); b.type = "button"; b.onclick = () => { void fn(); }; return b; }
function anchor(path: string, text: string) { const a = el("a", text); a.href = path; return a; }
function time(value: unknown) { return typeof value === "string" && value ? new Date(value).toLocaleString("zh-CN") : "未提供"; }
function explainCatalogError(root: Node, error: unknown) {
  const code = (error as { code?: string }).code;
  note(root, errorMessage(error), "message error");
  if (code === "PI_PACKAGE_IN_DEFAULTS" || code === "SKILL_DEFAULT_REFERENCE") {
    note(root, "请先从默认 Work 配置中移除此项。"); root.appendChild(anchor("/default-work", "前往默认 Work"));
  }
  if (code === "PI_PACKAGE_BUSY") note(root, "Core 包任务正在进行，请等待后重试。", "message warn");
}
function errorMessage(error: unknown) { const e = error as { message?: string; code?: string; correlationId?: string; field?: string };
  const retryAfterMs = (error as { retryAfterMs?: unknown }).retryAfterMs;
  const wait = typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0
    ? ` · 请在 ${Math.ceil(retryAfterMs / 1000)} 秒后重试` : "";
  return `${e.message ?? "请求失败"}${e.code ? ` (${e.code})` : ""}${e.field ? ` · ${e.field}` : ""}${e.correlationId ? ` · ${e.correlationId}` : ""}${wait}`; }
const invalidResponse = () => ({ code: "INVALID_RESPONSE", message: "响应无效，请查询当前状态后再操作" });
function uncertainWrite(error: unknown): boolean {
  const value = error as { code?: string; httpStatus?: number };
  return (value.httpStatus ?? 0) >= 500 || ["CORE_TIMEOUT", "CORE_UNAVAILABLE", "CONSOLE_UNAVAILABLE",
    "CORE_INVALID_RESPONSE", "INVALID_RESPONSE"].includes(value.code ?? "");
}
async function api(path: string, method = "GET", body?: unknown): Promise<Data> {
  let response: Response;
  try { response = await fetch(`/console/api${path}`, { method, credentials: "same-origin",
    headers: { ...(method === "GET" ? {} : { "x-csrf-token": csrf }), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw { code: "CONSOLE_UNAVAILABLE", message: "连接中断，请查询当前状态后再操作" }; }
  if (response.status === 204) return {};
  const result = await response.json().catch(() => { if (response.ok) throw invalidResponse();
    return { code: "INVALID_RESPONSE", message: "响应无效" }; }) as Data;
  if (!response.ok) { if (response.status === 401 && path !== "/login") { authenticated = false; void showLogin(); }
    throw { ...result, httpStatus: response.status }; }
  if (!isData(result)) throw invalidResponse();
  return result;
}
const admin = (path: string, method = "GET", body?: unknown) => api(`/admin${path}`, method, body);
function navigation() { nav.replaceChildren(); logout.hidden = !authenticated;
  if (authenticated) for (const [path, text] of links) { const a = anchor(path, text); if (location.pathname === path) a.setAttribute("aria-current", "page"); nav.append(a); } }
function changed(form: HTMLElement) { form.addEventListener("input", () => { dirty = true; }); form.addEventListener("change", () => { dirty = true; }); }
function confirmDiscard(): boolean { return !dirty || confirm("当前页面有未提交的更改，确认丢弃吗？"); }
function refreshWithConfirmation(fn: () => Promise<void>): Promise<void> { return confirmDiscard() ? fn() : Promise.resolve(); }
window.addEventListener("beforeunload", (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
async function submit(button: HTMLButtonElement, root: Node, fn: () => Promise<void>, success: string,
  onError?: (error: unknown) => void) {
  button.disabled = true; try { await fn(); dirty = false; note(root.isConnected ? root : app, success); }
  catch (error) { if (onError) onError(error); else note(root.isConnected ? root : app, errorMessage(error), "message error"); }
  finally { button.disabled = false; }
}
logout.onclick = () => { if (!confirmDiscard()) return;
  void submit(logout, app, async () => { await api("/logout", "POST", {}); authenticated = false; currentUser = undefined; await showLogin(); }, "已退出登录"); };

async function showLogin() {
  reset("管理员登录"); navigation(); const panel = card(), form = el("form");
  const account = input("账号"), password = input("密码", "password"); password.node.autocomplete = "current-password";
  const go = el("button", "登录"); go.type = "submit"; add(form, account.wrapper, password.wrapper, go); panel.append(form);
  note(panel, "首次管理员请使用 piwork-serve 初始化；普通用户请使用 piwork-cli。", "small");
  form.onsubmit = (event) => { event.preventDefault(); void submit(go, panel, async () => {
    const result = await api("/login", "POST", { account: account.node.value, password: password.node.value });
    csrf = String(result.csrfToken); authenticated = true; currentUser = result.user as typeof currentUser; location.href = "/";
  }, "登录成功").finally(() => { password.node.value = ""; }); };
  try { const availability = await api("/availability");
    if (!availability.reachable) { note(panel, "Core 暂时不可达，请稍后重试。", "message warn"); panel.append(action("重试连接", showLogin)); }
    else if (!availability.administratorInitialized) note(panel, "尚未初始化管理员。", "message warn"); }
  catch { note(panel, "无法查询 Core 状态。", "message warn"); }
}

async function showStatus() {
  reset("Core 状态"); const panel = card(); note(panel, "正在查询 Core…", "small");
  const refresh = async () => {
    if (refreshing) return; refreshing = true;
    try { const [status, health] = await Promise.all([admin("/status"), api("/health")]);
      statusSnapshot = { status, health, checkedAt: new Date() }; panel.replaceChildren();
      add(panel, el("p", `管理员：${currentUser?.account ?? ""}`), el("p", `Core 可达 · 进程健康：${health.healthy ? "正常" : "异常"}`),
        el("p", `运行就绪：${status.ready ? "就绪" : "未就绪"} · ${status.state}`));
      for (const [key, value] of Object.entries((status.checks as Data) ?? {})) panel.append(el("p", `${key}: ${value ? "是" : "否"}`));
      if (status.state === "RUNTIME_NOT_CONFIGURED") panel.append(anchor("/runtime", "配置运行时"));
    } catch (error) { panel.replaceChildren(); note(panel, `Core 当前不可达：${errorMessage(error)}`, "message error");
      if (statusSnapshot) note(panel, `历史状态（${statusSnapshot.checkedAt.toLocaleString("zh-CN")}）：${statusSnapshot.status.state}，当前就绪状态未知。`, "message warn"); }
    finally { panel.append(action("刷新状态", refresh, true)); refreshing = false; }
  };
  let refreshing = false;
  statusRefresh = refresh;
  await refresh();
}

async function showUsers() {
  reset("用户管理"); const panel = card();
  panel.append(action("刷新用户", () => refreshWithConfirmation(showUsers), true));
  const loading = note(panel, "正在加载用户…", "small");
  type User = { id: string; account: string; role: string; enabled: boolean; createdAt?: string; updatedAt?: string };
  try { const users = (await admin("/users")).users as User[];
    loading.remove();
    if (!users.length) note(panel, "暂无用户，可在下方创建。");
    const wrap = el("div", undefined, "table-wrap"), table = el("table"), body = el("tbody");
    const head = el("tr"); for (const text of ["账号", "用户 ID", "角色", "状态", "创建时间", "更新时间", "操作"]) head.append(el("th", text)); table.append(head, body);
    for (const user of users) { const row = el("tr"), actions = el("td", undefined, "actions");
      actions.append(action(user.enabled ? "禁用" : "启用", async () => {
        if (!confirmDiscard()) return;
        if (!confirm(`确认${user.enabled ? "禁用" : "启用"} ${user.account}？${user.enabled ? "这会撤销该账号的全部登录会话。" : "旧会话不会恢复。"}`)) return;
        try { await admin(`/users/${encodeURIComponent(user.id)}/${user.enabled ? "disable" : "enable"}`, "POST", {});
          if (user.id === currentUser?.id && user.enabled) { authenticated = false; await showLogin(); } else await showUsers(); }
        catch (error) { note(panel, errorMessage(error), "message error"); panel.append(action("刷新用户", () => refreshWithConfirmation(showUsers), true)); }
      }));
      actions.append(action("重置密码", async () => {
        panel.querySelector(".reset-card")?.remove();
        const resetPanel = el("section", undefined, "card reset-card"), form = el("form");
        resetPanel.append(el("h2", `重置 ${user.account} 的密码`), form);
        const password = input("新密码", "password"), confirmation = input("确认新密码", "password");
        password.node.autocomplete = "new-password"; confirmation.node.autocomplete = "new-password";
        const buttons = el("div", undefined, "actions"), cancel = action("取消", () => { resetPanel.remove(); }, true);
        const save = el("button", "确认重置"); save.type = "submit";
        add(buttons, cancel, save); add(form, password.wrapper, confirmation.wrapper, buttons); panel.append(resetPanel);
        password.node.focus();
        form.onsubmit = (event) => { event.preventDefault();
          if (password.node.value.length < 12 || password.node.value.length > 1024) {
            note(resetPanel, "密码长度需为 12–1024 个字符", "message error"); password.node.focus(); return;
          }
          if (password.node.value !== confirmation.node.value) { note(resetPanel, "两次密码不一致", "message error"); return; }
          if (!confirm(`确认重置 ${user.account} 的密码？这会撤销该账号的全部登录会话。`) || !confirmDiscard()) return;
          void submit(save, resetPanel, async () => {
            try { await admin(`/users/${encodeURIComponent(user.id)}/reset-credential`, "POST", { password: password.node.value }); }
            catch (error) {
              if ((error as { httpStatus?: number }).httpStatus === 404) await showUsers();
              throw error;
            } finally { password.node.value = ""; confirmation.node.value = ""; }
            if (user.id === currentUser?.id) { authenticated = false; await showLogin(); }
            else await showUsers();
          }, "密码已重置"); };
      }, true));
      add(row, el("td", user.account), el("td", user.id), el("td", user.role), el("td", user.enabled ? "启用" : "禁用"),
        el("td", time(user.createdAt)), el("td", time(user.updatedAt)), actions); body.append(row); }
    wrap.append(table); panel.append(wrap);
  } catch (error) { loading.remove(); note(panel, errorMessage(error), "message error"); panel.append(action("重试", showUsers)); return; }
  const create = card(), form = el("form"); create.append(el("h2", "创建用户"), form);
  note(create, "普通用户使用 piwork-cli 登录并管理自己的 Work；管理员可登录此面板。", "small");
  const account = input("账号"), password = input("密码", "password"), confirmation = input("确认密码", "password");
  const role = el("select"); role.setAttribute("aria-label", "角色");
  for (const [value, text] of [["user", "普通用户"], ["admin", "管理员"]] as const) { const option = el("option", text); option.value = value; role.append(option); }
  const roleLabel = el("label", "角色"); roleLabel.append(role);
  const go = el("button", "创建用户"); go.type = "submit"; add(form, account.wrapper, password.wrapper, confirmation.wrapper, roleLabel, go); changed(form);
  form.onsubmit = (event) => { event.preventDefault();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(account.node.value)) { note(create, "账号格式无效", "message error"); account.node.focus(); return; }
    if (password.node.value.length < 12 || password.node.value.length > 1024) { note(create, "密码长度需为 12–1024 个字符", "message error"); password.node.focus(); return; }
    if (password.node.value !== confirmation.node.value) { note(create, "两次密码不一致", "message error"); confirmation.node.focus(); return; }
    void submit(go, create, async () => { const created = await admin("/users", "POST",
      { account: account.node.value, password: password.node.value, role: role.value });
      password.node.value = ""; confirmation.node.value = ""; await showUsers();
      note(app, String(created.account) + " 已创建，角色：" + String(created.role) + "。"
        + (created.role === "admin" ? "可使用新账号登录此面板。" : "请使用 piwork-cli 登录。"));
    }, "用户已创建"); };
}

async function showRuntime() {
  reset("全局运行时"); const panel = card(); let runtime: Data;
  try { runtime = await admin("/runtime"); } catch (error) { note(panel, errorMessage(error), "message error"); panel.append(action("重试", showRuntime)); return; }
  const model = runtime.configured ? runtime.model as Data : {};
  const summary = el("div"); panel.append(summary);
  const renderSummary = (value: Data) => { const details = value.configured ? value.model as Data : {};
    summary.replaceChildren(el("p", value.configured
      ? `当前镜像：${value.agentImage}，模型：${details.provider}/${details.id}，Base URL：${details.baseUrl ?? "默认"}` : "尚未配置运行时。"));
    if (value.configured) summary.append(el("p", `凭据：${details.credentialAvailable ? "可用" : "不可用"} · 更新：${time(value.updatedAt)}`)); };
  renderSummary(runtime);
  const form = el("form"), image = input("Agent 镜像", "text", String(runtime.agentImage ?? "")), provider = input("模型提供者", "text", String(model.provider ?? "")),
    id = input("模型 ID", "text", String(model.id ?? "")), base = input("自定义 Base URL", "url", String(model.baseUrl ?? "")), key = input("API Key", "password");
  key.node.autocomplete = "new-password"; const go = el("button", "保存运行时"); go.type = "submit";
  add(form, image.wrapper, provider.wrapper, id.wrapper, base.wrapper, key.wrapper, go); panel.append(form); changed(form);
  note(panel, "每次保存均需完整 API Key。已有 Work 不会改变。", "small");
  note(panel, "此设置影响后续新 Work 的运行时默认值。", "small");
  form.onsubmit = (event) => { event.preventDefault(); if (!key.node.value) { note(panel, "请重新输入 API Key", "message error"); key.node.focus(); return; }
    void submit(go, panel, async () => {
    const result = await admin("/runtime", "PUT", { agentImage: image.node.value, provider: provider.node.value,
      model: id.node.value, ...(base.node.value ? { baseUrl: base.node.value } : {}), credential: key.node.value });
    if (!isData(result.runtime) || result.runtime.configured !== true ||
      typeof result.runtime.agentImage !== "string" || typeof result.runtime.updatedAt !== "string" ||
      !isData(result.runtime.model) || typeof result.runtime.model.provider !== "string" ||
      typeof result.runtime.model.id !== "string" || typeof result.runtime.model.credentialAvailable !== "boolean" ||
      !isData(result.status) || typeof result.status.ready !== "boolean" || typeof result.status.state !== "string") {
      throw invalidResponse();
    }
    runtime = result.runtime as Data; renderSummary(runtime);
    const persistedModel = runtime.model as Data;
    image.node.value = String(runtime.agentImage ?? ""); provider.node.value = String(persistedModel.provider ?? "");
    id.node.value = String(persistedModel.id ?? ""); base.node.value = String(persistedModel.baseUrl ?? "");
    const status = result.status as Data; note(panel, status.ready ? "运行时已就绪" : `配置已保存，但运行时未就绪：${status.state}`, status.ready ? "message" : "message warn");
  }, "配置已保存", (error) => {
    if (!uncertainWrite(error)) { note(panel, errorMessage(error), "message error"); return; }
    note(panel, "保存结果待核实：" + errorMessage(error), "message warn");
    panel.append(action("读取当前运行时", async () => {
      try { runtime = await admin("/runtime"); renderSummary(runtime);
        note(panel, "已读取 Core 当前配置；请对照保留的表单草稿核实。", "message"); }
      catch (readError) { note(panel, errorMessage(readError), "message error"); }
    }, true));
  }).finally(() => { key.node.value = ""; }); };
}

async function showDefaultWork(saved?: Data, savedCatalogs?: {
  skills: Array<{ name: string; enabled: boolean }>; packages: Array<{ name: string; enabled: boolean }>;
}) {
  reset("默认 Work 配置"); const panel = card(); let data: Data, skills: Array<{ name: string; enabled: boolean }>, packages: Array<{ name: string; enabled: boolean }>;
  try { [data, skills, packages] = saved && savedCatalogs ? [saved, savedCatalogs.skills, savedCatalogs.packages]
    : await Promise.all([admin("/default-work"), admin("/skills").then((v) => v.skills as typeof skills),
      admin("/packages").then((v) => v.packages as typeof packages)]); }
  catch (error) { note(panel, errorMessage(error), "message error"); panel.append(action("重试", showDefaultWork)); return; }
  if (data.configuration === null) { note(panel, "默认配置未初始化，请先设置运行时。", "message warn"); panel.append(anchor("/runtime", "前往运行时")); return; }
  const config = data.configuration as Data, detail = el("details"); detail.append(el("summary", "查看完整公开配置"), el("pre", JSON.stringify(config, null, 2))); panel.append(detail);
  const form = el("form"), image = input("默认 Agent 镜像", "text", String(data.baseImage ?? "")); form.append(image.wrapper);
  const baselineSkills = [...config.skills as string[]];
  const baselinePackages = (config.packages as Array<{ name: string }>).map((item) => item.name);
  let skillOrder = [...baselineSkills], packageOrder = [...baselinePackages];
  const skillCatalog = new Map(skills.map((item) => [item.name, item]));
  const packageCatalog = new Map(packages.map((item) => [item.name, item]));
  const skillBox = el("fieldset"), packageBox = el("fieldset"), orderedSkills = el("div");
  skillBox.append(el("legend", "默认 Skills")); packageBox.append(el("legend", "默认 Packages"));
  const go = el("button", "保存默认配置"); go.type = "submit";
  const changedValues = () => ({
    image: image.node.value !== String(data.baseImage ?? ""),
    skills: JSON.stringify(skillOrder) !== JSON.stringify(baselineSkills),
    packages: JSON.stringify(packageOrder) !== JSON.stringify(baselinePackages),
    agents: agents.value !== String(config.agentsMd ?? ""),
  });
  const updateSaveState = () => { const edits = changedValues(); go.disabled = !Object.values(edits).some(Boolean); dirty = !go.disabled; };
  const renderSkillOrder = () => { orderedSkills.replaceChildren(el("p", "已选 Skills 顺序：", "small"));
    skillOrder.forEach((name, index) => { const row = el("div", undefined, "actions"); row.append(el("span", name));
      const move = (offset: number) => { const other = index + offset; if (other < 0 || other >= skillOrder.length) return;
        [skillOrder[index], skillOrder[other]] = [skillOrder[other]!, skillOrder[index]!];
        renderSkillOrder(); updateSaveState(); };
      const up = action(`上移 ${name}`, () => move(-1), true), down = action(`下移 ${name}`, () => move(1), true);
      up.disabled = index === 0; down.disabled = index === skillOrder.length - 1; row.append(up, down); orderedSkills.append(row); }); };
  for (const name of [...new Set([...skillOrder, ...skills.map((item) => item.name)])].sort((a, b) => a.localeCompare(b))) {
    const item = skillCatalog.get(name), selected = skillOrder.includes(name);
    const reason = item === undefined ? "（已从目录移除）" : item.enabled ? "" : "（已禁用）";
    const row = el("label", `${name}${reason}`), check = el("input");
    check.type = "checkbox"; check.value = name; check.checked = selected; check.disabled = !item?.enabled && !selected;
    check.onchange = () => { skillOrder = check.checked ? [...skillOrder, name] : skillOrder.filter((entry) => entry !== name);
      renderSkillOrder(); updateSaveState(); }; row.prepend(check); skillBox.append(row);
  }
  skillBox.append(orderedSkills); renderSkillOrder();
  for (const name of [...new Set([...packageOrder, ...packages.map((item) => item.name)])].sort((a, b) => a.localeCompare(b))) {
    const item = packageCatalog.get(name), selected = packageOrder.includes(name);
    const reason = item === undefined ? "（已从目录移除）" : item.enabled ? "" : "（已禁用）";
    const row = el("label", `${name}${reason}`), check = el("input");
    check.type = "checkbox"; check.value = name; check.checked = selected; check.disabled = !item?.enabled && !selected;
    check.onchange = () => { packageOrder = check.checked ? [...packageOrder, name] : packageOrder.filter((entry) => entry !== name);
      updateSaveState(); }; row.prepend(check); packageBox.append(row);
  }
  form.append(skillBox, packageBox);
  const agents = el("textarea"); agents.value = String(config.agentsMd ?? ""); agents.setAttribute("aria-label", "AGENTS.md 内容");
  const agentsLabel = el("label", "AGENTS.md 内容"); agentsLabel.append(agents); form.append(agentsLabel);
  const file = input("选择本地 AGENTS.md", "file"); file.node.accept = ".md,text/markdown,text/plain"; form.append(file.wrapper);
  const count = el("p", "", "small"), updateCount = () => { count.textContent = `${new TextEncoder().encode(agents.value).byteLength} / 262144 字节`; };
  let agentsDirty = false;
  agents.addEventListener("input", () => { agentsDirty = true; updateCount(); updateSaveState(); }); updateCount(); form.append(count);
  file.node.onchange = () => { const chosen = file.node.files?.[0]; if (!chosen) return;
    if (agentsDirty && !confirm("读取文件会覆盖当前 AGENTS.md 草稿，继续吗？")) { file.node.value = ""; return; }
    if (chosen.size > 262144) { note(panel, "AGENTS.md 文件超过 256 KiB，原草稿已保留", "message error"); file.node.value = ""; return; }
    void chosen.arrayBuffer().then((bytes) => { const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      if (new TextEncoder().encode(content).byteLength > 262144) throw new Error("AGENTS.md 文件超过 256 KiB");
      agents.value = content; updateCount(); agentsDirty = true; updateSaveState(); })
      .catch((error) => { note(panel, error instanceof Error && error.message.includes("256 KiB") ? error.message : "文件不是有效的 UTF-8 文本", "message error");
        file.node.value = ""; }); };
  form.append(go); panel.append(form); image.node.addEventListener("input", updateSaveState); updateSaveState();
  note(panel, "默认值仅影响后续新 Work，不会更新已有 Work。", "small");
  form.onsubmit = (event) => { event.preventDefault(); const edits = changedValues(), patch: Data = {};
    if (edits.image) patch.baseImage = image.node.value;
    if (edits.skills) patch.skills = skillOrder;
    if (edits.packages) patch.packages = packageOrder;
    if (edits.agents) patch.agentsMd = agents.value;
    if (!Object.keys(patch).length) return;
    if (packageOrder.length > 64) { note(panel, "默认 Package 最多选择 64 个", "message error"); return; }
    if (new TextEncoder().encode(agents.value).byteLength > 262144) { note(panel, "AGENTS.md 超过 256 KiB", "message error"); return; }
    void submit(go, panel, async () => { const saved = await admin("/default-work", "PATCH", patch);
      await showDefaultWork(saved, { skills, packages }); }, "默认配置已保存"); };
}

async function uploadFiles(path: string, directoryName: string, files: FileList, root: Node): Promise<Data> {
  const body = new FormData(); body.append("directoryName", directoryName);
  for (const file of files) { const relative = file.webkitRelativePath.split("/").slice(1).join("/");
    if (!relative) throw { code: "DIRECTORY_REQUIRED", message: "请选择目录" };
    body.append("files", file, encodeURIComponent(relative)); }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(), progress = note(root, "准备上传…", "small");
    xhr.open(path === "/skills" ? "POST" : "PUT", `/console/api/admin${path}`);
    xhr.withCredentials = true; xhr.setRequestHeader("x-csrf-token", csrf);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) progress.textContent = `上传 ${Math.floor(event.loaded / event.total * 100)}%`; };
    xhr.upload.onload = () => { progress.textContent = "上传已发送，Core 正在校验并发布…"; };
    xhr.onerror = () => reject({ code: "UPLOAD_INTERRUPTED", message: "上传中断；若请求已到达 Core，请先查询当前 Skill 状态再重试" });
    xhr.onload = () => { try { const value = JSON.parse(xhr.responseText) as Data; xhr.status >= 200 && xhr.status < 300 ? resolve(value) : reject(value); }
      catch { reject({ code: "INVALID_RESPONSE", message: "上传响应无效" }); } };
    xhr.send(body);
  });
}
function skillDirectory(files: FileList): string {
  if (!files.length) throw { message: "请选择 Skill 目录" };
  if (files.length > 2048) throw { message: "Skill 文件最多 2,048 个" };
  const root = files[0]!.webkitRelativePath.split("/")[0]!;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(root)) throw { message: "Skill 目录名称无效" };
  let total = 0, hasManifest = false;
  for (const file of files) {
    const [name, ...segments] = file.webkitRelativePath.split("/");
    if (name !== root || segments.length === 0 || segments.some((part) => !part || part === "." || part === "..")) {
      throw { message: "Skill 目录必须只有一个根且文件路径有效" };
    }
    if (segments.join("/") === "SKILL.md") hasManifest = true;
    if (file.size > 8 * 1024 * 1024) throw { message: "Skill 单文件最多 8 MiB" };
    total += file.size;
    if (total > 32 * 1024 * 1024) throw { message: "Skill 内容总量最多 32 MiB" };
  }
  if (!hasManifest) throw { message: "Skill 目录根部缺少 SKILL.md" };
  return root;
}
async function showSkills() {
  reset("Skills"); const panel = card(), loading = note(panel, "正在加载 Skills…", "small");
  type Skill = { name: string; enabled: boolean; fileCount: number; totalBytes: number };
  let skills: Skill[];
  try { skills = (await admin("/skills")).skills as Skill[]; loading.remove(); }
  catch (error) { loading.remove(); note(panel, errorMessage(error), "message error"); panel.append(action("重试", showSkills)); return; }
  panel.append(action("刷新 Skills", () => refreshWithConfirmation(showSkills), true));
  if (!skills.length) note(panel, "暂无 Skill，可选择本地目录上传。");
  for (const skill of skills) { const row = el("div", undefined, "card actions");
    add(row, anchor(`/skills/${encodeURIComponent(skill.name)}`, skill.name), el("span", `${skill.enabled ? "启用" : "禁用"} · ${skill.fileCount} 文件 · ${skill.totalBytes} 字节`)); panel.append(row); }
  const upload = card(), form = el("form"); upload.append(el("h2", "上传 Skill 目录"), form);
  const directory = input("选择 Skill 目录", "file"); directory.node.setAttribute("webkitdirectory", ""); directory.node.multiple = true;
  const directorySupported = "webkitdirectory" in directory.node;
  if (!directorySupported) note(upload, "当前浏览器不支持目录选择，请换用支持目录选择的浏览器。", "message warn");
  const preview = el("p", "请选择包含根 SKILL.md 的目录。", "small");
  directory.node.onchange = () => { const files = directory.node.files, name = files?.[0]?.webkitRelativePath.split("/")[0] ?? "";
    preview.textContent = files?.length ? `${name} · ${files.length} 个文件 · ${[...files].reduce((sum, file) => sum + file.size, 0)} 字节` : "请选择包含根 SKILL.md 的目录。"; };
  const go = el("button", "上传 Skill"); go.type = "submit"; go.disabled = !directorySupported;
  add(form, directory.wrapper, preview, go); changed(form);
  form.onsubmit = (event) => { event.preventDefault(); const files = directory.node.files; if (!files?.length) { note(upload, "请选择目录", "message error"); return; }
    let name: string; try { name = skillDirectory(files); } catch (error) { note(upload, errorMessage(error), "message error"); return; }
    void submit(go, upload, async () => { await uploadFiles("/skills", name, files, upload); await showSkills(); }, "Skill 已上传"); };
}
async function showSkill(name: string) {
  reset("Skill 详情"); const panel = card(); let skill: Data;
  try { skill = await admin(`/skills/${encodeURIComponent(name)}`); }
  catch (error) { note(panel, errorMessage(error), "message error"); panel.append(anchor("/skills", "返回列表")); return; }
  add(panel, el("h2", String(skill.name)), el("p", `${skill.enabled ? "启用" : "禁用"} · ${skill.fileCount} 文件 · ${skill.totalBytes} 字节`),
    el("p", `创建：${time(skill.createdAt)} · 更新：${time(skill.updatedAt)}`), action("刷新详情", () => refreshWithConfirmation(() => showSkill(name)), true));
  const controls = el("div", undefined, "actions"); panel.append(controls);
  controls.append(action(skill.enabled ? "禁用" : "启用", async () => { if (!confirmDiscard()) return;
    try { await admin(`/skills/${encodeURIComponent(name)}/${skill.enabled ? "disable" : "enable"}`, "POST", {}); await showSkill(name); }
    catch (error) { explainCatalogError(panel, error); } }));
  controls.append(action("移除", async () => { if (!confirmDiscard() || !confirm(`确认移除 ${name}？后续新 Work 将不能再选择该 Skill；已有 Work 副本保留。`)) return;
    try { await admin(`/skills/${encodeURIComponent(name)}`, "DELETE"); location.href = "/skills"; } catch (error) { explainCatalogError(panel, error); } }, true));
  const form = el("form"), directory = input("选择同名 Skill 目录更新", "file"); directory.node.setAttribute("webkitdirectory", ""); directory.node.multiple = true;
  const preview = el("p", "请选择同名目录。", "small");
  directory.node.onchange = () => { const files = directory.node.files, selected = files?.[0]?.webkitRelativePath.split("/")[0] ?? "";
    preview.textContent = files?.length ? `${selected} · ${files.length} 个文件 · ${[...files].reduce((sum, file) => sum + file.size, 0)} 字节` : "请选择同名目录。"; };
  const go = el("button", "上传更新"); go.type = "submit"; go.disabled = !("webkitdirectory" in directory.node);
  if (go.disabled) note(panel, "当前浏览器不支持目录选择，请换用支持目录选择的浏览器。", "message warn");
  add(form, directory.wrapper, preview, go); panel.append(form); changed(form);
  form.onsubmit = (event) => { event.preventDefault(); const files = directory.node.files; if (!files?.length) return;
    let selected: string; try { selected = skillDirectory(files); } catch (error) { note(panel, errorMessage(error), "message error"); return; }
    if (selected !== name) { note(panel, "SKILL_NAME_MISMATCH：目录名称必须与目标 Skill 一致", "message error"); return; }
    void submit(go, panel, async () => { await uploadFiles(`/skills/${encodeURIComponent(name)}`, selected, files, panel); await showSkill(name); }, "Skill 已更新"); };
}

async function showPackages() {
  reset("Packages"); const panel = card(), loading = note(panel, "正在加载 Packages…", "small");
  type Package = { name: string; version: string | null; enabled: boolean; isDefault: boolean; sourceKind: string };
  let packages: Package[];
  try { packages = (await admin("/packages")).packages as Package[]; loading.remove(); }
  catch (error) { loading.remove(); note(panel, errorMessage(error), "message error"); panel.append(action("重试", showPackages)); return; }
  panel.append(action("刷新 Packages", () => refreshWithConfirmation(showPackages), true));
  note(panel, "这里管理 Core 包库；安装成功不代表已有 Work 已加载。", "small");
  if (!packages.length) note(panel, "暂无 Core Package，可在下方安装。");
  const table = el("table"), body = el("tbody"), wrap = el("div", undefined, "table-wrap"), head = el("tr");
  for (const item of ["名称", "版本", "来源", "状态", "默认", "资源"]) head.append(el("th", item)); table.append(head, body);
  for (const item of packages) { const row = el("tr"), name = el("td"); name.append(anchor(`/packages/${encodeURIComponent(item.name)}`, item.name));
    add(row, name, el("td", item.version ?? "未提供"), el("td", item.sourceKind), el("td", item.enabled ? "启用" : "禁用"),
      el("td", item.isDefault ? "是" : "否"), el("td", resourceSummary(item as Data))); body.append(row); }
  wrap.append(table); panel.append(wrap);
  packageForm();
}
async function showPackage(name: string) {
  reset("Package 详情"); const panel = card(); let item: Data;
  try { item = await admin(`/packages/${encodeURIComponent(name)}`); }
  catch (error) { note(panel, errorMessage(error), "message error"); panel.append(anchor("/packages", "返回列表")); return; }
  add(panel, el("h2", name), el("p", `版本：${item.version ?? "未提供"} · 来源：${item.sourceKind}`),
    el("p", `状态：${item.enabled ? "启用" : "禁用"} · 默认 Work：${item.isDefault ? "已选" : "未选"}`),
    el("p", `资源：${resourceSummary(item)}`), el("p", `来源说明：${item.resolvedSource ?? ""}`),
    anchor("/default-work", "管理默认 Work"), action("刷新详情", () => refreshWithConfirmation(() => showPackage(name)), true));
  panel.append(action(item.enabled ? "禁用" : "启用", async () => { if (!confirmDiscard()) return;
    try { await admin(`/packages/${encodeURIComponent(name)}/${item.enabled ? "disable" : "enable"}`, "POST", {}); await showPackage(name); }
    catch (error) { explainCatalogError(panel, error); } }));
  panel.append(action("移除", async () => { if (!confirmDiscard() || !confirm(`确认移除 ${name}？`)) return;
    try { await admin(`/packages/${encodeURIComponent(name)}`, "DELETE"); location.href = "/packages"; }
    catch (error) { explainCatalogError(panel, error); } }, true));
  packageForm(name);
}
function resourceSummary(item: Data): string {
  const counts = item.resourceCounts as Data | undefined;
  return counts ? `扩展 ${counts.extensions ?? 0} · Skills ${counts.skills ?? 0} · Prompts ${counts.prompts ?? 0} · Themes ${counts.themes ?? 0}` : "未提供";
}
function uploadInput(kind: "directory" | "zip", file: File | FileList, root: Node): Promise<Data> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open("POST", `/console/api/package-inputs/${kind}`); xhr.withCredentials = true;
    xhr.setRequestHeader("x-csrf-token", csrf);
    if (kind === "zip") { xhr.setRequestHeader("content-type", "application/zip"); xhr.setRequestHeader("x-piwork-package-name", encodeURIComponent((file as File).name)); }
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) progress.textContent = `上传 ${Math.floor(event.loaded / event.total * 100)}%`; };
    const progress = note(root, "准备上传…", "small");
    xhr.upload.onload = () => { progress.textContent = "上传已发送，面板与 Core 正在校验并传送…"; };
    xhr.onerror = () => reject({ code: "UPLOAD_INTERRUPTED", message: "上传中断，请确认 Core 状态" });
    xhr.onload = () => { try { const value = JSON.parse(xhr.responseText) as Data; xhr.status >= 200 && xhr.status < 300 ? resolve(value) : reject(value); }
      catch { reject({ code: "INVALID_RESPONSE", message: "上传响应无效" }); } };
    if (kind === "zip") xhr.send(file as File);
    else { const list = file as FileList, body = new FormData(), rootName = list[0]?.webkitRelativePath.split("/")[0];
      body.append("directoryName", rootName ?? ""); for (const item of list) body.append("files", item, encodeURIComponent(item.webkitRelativePath.split("/").slice(1).join("/")));
      xhr.send(body); }
  });
}
function packageDirectory(files: FileList): void {
  if (!files.length) throw { message: "请选择本地目录" };
  if (files.length > 100000) throw { message: "Package 文件最多 100,000 个" };
  let total = 0, manifest = false;
  const root = files[0]!.webkitRelativePath.split("/")[0]!;
  for (const file of files) { const [name, ...parts] = file.webkitRelativePath.split("/");
    if (name !== root || !parts.length || parts.length > 64 || new TextEncoder().encode(parts.join("/")).byteLength > 4096) {
      throw { message: "Package 目录或文件路径超出限制" };
    }
    if (file.size > 64 * 1024 * 1024) throw { message: "Package 单文件最多 64 MiB" };
    total += file.size; if (total > 1024 * 1024 * 1024) throw { message: "Package 内容总量最多 1 GiB" };
    if (parts.join("/") === "package.json") { manifest = true; if (file.size > 1024 * 1024) throw { message: "package.json 最多 1 MiB" }; }
  }
  if (!manifest) throw { message: "目录根部缺少 package.json" };
}
function packageForm(target?: string) {
  const panel = card(), form = el("form"); panel.append(el("h2", target ? `更新 ${target}` : "安装 Package"), form);
  const kind = el("select"); kind.setAttribute("aria-label", "来源类型");
  for (const [value, text] of [["npm", "npm"], ["git", "Git"], ["directory", "本地目录"], ["zip", "ZIP 文件"]] as const) { const option = el("option", text); option.value = value; kind.append(option); }
  const kindLabel = el("label", "来源类型"); kindLabel.append(kind);
  const spec = input("npm 或 Git 来源"), directory = input("选择本地目录", "file"), zip = input("选择 ZIP 文件", "file");
  directory.node.setAttribute("webkitdirectory", ""); directory.node.multiple = true; zip.node.accept = ".zip,application/zip";
  const inputHint = el("p", "本地目录应包含 package.json；单文件最多 64 MiB、总内容最多 1 GiB。ZIP 最多 256 MiB。需要保留执行权限或包内链接时请使用 ZIP。", "small");
  const defaultCheck = input("安装并加入默认 Work", "checkbox"); defaultCheck.node.style.width = "auto";
  const directorySupported = "webkitdirectory" in directory.node;
  const showFields = () => { spec.wrapper.hidden = !["npm", "git"].includes(kind.value);
    directory.wrapper.hidden = kind.value !== "directory"; zip.wrapper.hidden = kind.value !== "zip";
    if (kind.value === "directory" && !directorySupported) inputHint.textContent = "此浏览器不支持目录选择，请使用 ZIP。";
    else inputHint.textContent = "本地目录应包含 package.json；单文件最多 64 MiB、总内容最多 1 GiB。ZIP 最多 256 MiB。需要保留执行权限或包内链接时请使用 ZIP。"; };
  let previousKind = kind.value, sourceDirty = false;
  for (const field of [spec.node, directory.node, zip.node]) field.addEventListener("change", () => { sourceDirty = true; });
  spec.node.addEventListener("input", () => { sourceDirty = true; });
  kind.onchange = () => { if (sourceDirty && !confirm("切换来源会丢弃当前来源，继续吗？")) { kind.value = previousKind; return; }
    spec.node.value = ""; directory.node.value = ""; zip.node.value = "";
    previousKind = kind.value; sourceDirty = false; showFields(); }; showFields();
  const go = el("button", target ? "提交更新" : "提交安装"); go.type = "submit";
  add(form, kindLabel, spec.wrapper, directory.wrapper, zip.wrapper, inputHint);
  if (target) { const targetName = input("目标 Package 名称", "text", target); targetName.node.readOnly = true; form.prepend(targetName.wrapper); }
  if (!target) form.append(defaultCheck.wrapper); form.append(go); changed(form);
  let intent: { source: Data; key: string; addToDefaults: boolean } | undefined;
  let uncertainIntent = false;
  const accept = async () => { if (!intent) return; const path = target ? `/packages/${encodeURIComponent(target)}/update` : "/packages";
    const accepted = await admin(path, "POST", { source: intent.source, idempotencyKey: intent.key,
      ...(target ? {} : { addToDefaults: intent.addToDefaults }) });
    if (typeof accepted.operationId !== "string" || !/^operation-[a-zA-Z0-9-]{8,128}$/.test(accepted.operationId)) {
      throw invalidResponse();
    }
    dirty = false; location.href = `/operations/${encodeURIComponent(accepted.operationId)}`; };
  form.onsubmit = (event) => { event.preventDefault();
    if (uncertainIntent) { note(panel, "上次提交结果待核实，请使用“恢复此次提交”。", "message warn"); return; }
    void submit(go, panel, async () => {
    let source: Data;
    if (kind.value === "npm" || kind.value === "git") { if (!spec.node.value.trim()) throw { message: "来源不能为空" }; source = { kind: kind.value, spec: spec.node.value.trim() }; }
    else if (kind.value === "zip") { if (!zip.node.files?.[0]) throw { message: "请选择 ZIP 文件" };
      if (zip.node.files[0].size > 256 * 1024 * 1024) throw { message: "ZIP 最多 256 MiB" };
      const upload = await uploadInput("zip", zip.node.files[0], panel); source = { kind: "upload", uploadId: upload.uploadId }; }
    else { if (!directorySupported) throw { message: "此浏览器不支持目录选择，请使用 ZIP" };
      if (!directory.node.files?.length) throw { message: "请选择本地目录" };
      packageDirectory(directory.node.files);
      const upload = await uploadInput("directory", directory.node.files, panel); source = { kind: "upload", uploadId: upload.uploadId }; }
    intent = { source, key: crypto.randomUUID(), addToDefaults: defaultCheck.node.checked };
    try { await accept(); } catch (error) {
      if (uncertainWrite(error)) {
        uncertainIntent = true;
        note(panel, "接受结果待核实；恢复会沿用原来源和幂等键。", "message warn");
        panel.append(action("恢复此次提交", async () => {
          try { await accept(); } catch (retryError) { note(panel, errorMessage(retryError), "message error"); }
        }));
      } else intent = undefined;
      throw error;
    }
  }, "已提交，正在打开操作详情").finally(() => { go.disabled = uncertainIntent; }); };
}

async function showOperation(id?: string) {
  reset(id ? "操作详情" : "按 ID 查询操作"); const panel = card();
  if (!id) { const form = el("form"), inputId = input("Operation ID"), go = el("button", "查询"); go.type = "submit";
    add(form, inputId.wrapper, go); panel.append(form); form.onsubmit = (event) => { event.preventDefault();
      const value = inputId.node.value.trim();
      if (!/^operation-[a-zA-Z0-9-]{8,128}$/.test(value)) { note(panel, "请输入有效的 Operation ID", "message error"); inputId.node.focus(); return; }
      location.href = `/operations/${encodeURIComponent(value)}`; }; return; }
  const header = el("div", undefined, "actions"); add(header, el("strong", id), action("复制 ID", async () => {
    try { await navigator.clipboard.writeText(id); note(panel, "已复制 ID"); }
    catch { note(panel, "复制失败，请选中上方 ID 手动复制", "message warn"); } }, true)); panel.append(header);
  const result = el("div"), observationError = el("div"); panel.append(result, observationError);
  let timer: number | undefined, stopped = false, inFlight = false, terminal = false;
  const poll = async () => { if (stopped || document.hidden || inFlight || terminal) return;
    inFlight = true; if (timer) { clearTimeout(timer); timer = undefined; }
    try { const operation = await admin(`/operations/${encodeURIComponent(id)}`); result.replaceChildren();
      observationError.replaceChildren();
      add(result, el("p", `状态：${operation.state} · 阶段：${operation.packagePhase}`), el("pre", JSON.stringify(operation, null, 2)));
      terminal = ["succeeded", "failed", "superseded"].includes(String(operation.state));
      if (operation.state === "failed" || operation.state === "superseded") result.append(anchor("/packages", "返回表单，以新来源和新幂等键重试"));
      if (!terminal) timer = window.setTimeout(() => { void poll(); }, 2000);
    } catch (error) { observationError.replaceChildren();
      note(observationError, `观察中断，上次结果为历史状态，操作 ID 已保留：${errorMessage(error)}`, "message warn");
      observationError.append(action("重试观察", poll)); }
    finally { inFlight = false; } };
  void poll(); document.addEventListener("visibilitychange", () => { if (document.hidden && timer) { clearTimeout(timer); timer = undefined; }
    else if (!document.hidden) void poll(); });
  window.addEventListener("beforeunload", () => { stopped = true; if (timer) clearTimeout(timer); }, { once: true });
}

async function bootstrap() {
  try { const session = await api("/session"); csrf = String(session.csrfToken); authenticated = session.authenticated === true;
    currentUser = authenticated ? session.user as typeof currentUser : undefined; navigation();
    if (!authenticated) { await showLogin(); return; }
    const path = location.pathname;
    if (path === "/") await showStatus(); else if (path === "/users") await showUsers(); else if (path === "/runtime") await showRuntime();
    else if (path === "/default-work") await showDefaultWork(); else if (path === "/skills") await showSkills();
    else if (path.startsWith("/skills/")) await showSkill(decodeURIComponent(path.slice(8)));
    else if (path === "/packages") await showPackages(); else if (path.startsWith("/packages/")) await showPackage(decodeURIComponent(path.slice(10)));
    else if (path === "/operations") await showOperation(); else if (path.startsWith("/operations/")) await showOperation(decodeURIComponent(path.slice(12)));
    else await showStatus();
  } catch (error) { reset("连接失败"); note(app, errorMessage(error), "message error"); app.append(action("重试", bootstrap)); }
}
void bootstrap();
window.setInterval(() => { if (authenticated && !document.hidden) {
  void api("/session").catch(() => undefined);
  if (location.pathname === "/") void statusRefresh?.();
} }, 15_000);
const checkOnReturn = () => { if (authenticated) {
  void api("/session").catch(() => undefined);
  if (location.pathname === "/") void statusRefresh?.();
} };
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkOnReturn(); });
window.addEventListener("focus", checkOnReturn);
