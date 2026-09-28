type Data = Record<string, unknown>;
const isData = (value: unknown): value is Data => value !== null && typeof value === "object" && !Array.isArray(value);
const app = document.getElementById("app") as HTMLElement;
const nav = document.getElementById("navigation") as HTMLElement;
const logout = document.getElementById("logout") as HTMLButtonElement;
let csrf = "", authenticated = false, dirty = false;
let currentUser: { id: string; account: string } | undefined;
let statusRefresh: (() => Promise<void>) | undefined;
let statusSnapshot: { status: Data; health: Data; checkedAt: Date } | undefined;
const links = [["/", "Status"], ["/users", "Users"], ["/runtime", "Runtime"], ["/default-work", "Default Work"],
  ["/skills", "Skills"], ["/packages", "Packages"], ["/operations", "Find Operation"]] as const;
function el<K extends keyof HTMLElementTagNameMap>(name: K, content?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(name); if (content !== undefined) node.textContent = content; if (className) node.className = className; return node;
}
function add(parent: Node, ...children: Node[]) { for (const child of children) parent.appendChild(child); }
const descriptions: Record<string, string> = {
  "Administrator sign in": "Administrators manage Core here. Other users sign in through piwork-cli.",
  "Core status": "View Core health and runtime readiness. Health does not imply readiness.",
  "Users": "Manage administrators and piwork-cli users.",
  "Runtime": "Set the Core runtime for future Work. Existing Work is unchanged.",
  "Default Work": "These defaults apply only to future Work.",
  Skills: "Manage Core Skills. Select a directory from this device to upload.",
  "Skill details": "View the current Skill and manage its state.",
  Packages: "Manage Core Packages. Existing Work does not load newly installed Packages automatically.",
  "Package details": "View the current Core Package and manage its state.",
  "Find Operation": "Use an Operation ID to find an install or update result.",
  "Operation details": "View the accepted task and its current phase by ID.",
};
function reset(title: string) { app.className = title === "Administrator sign in" ? "page-login" : "page-wide";
  app.replaceChildren(el("h1", title)); if (descriptions[title]) app.append(el("p", descriptions[title], "page-description")); dirty = false; }
function card() { const item = el("section", undefined, "card"); app.append(item); return item; }
function sectionHeader(root: Node, title: string, control?: Node) { const header = el("div", undefined, "section-header"); header.append(el("h2", title)); if (control) header.append(control); root.appendChild(header); return header; }
function note(root: Node, text: string, kind = "message") { const node = el("p", text, kind); root.appendChild(node); return node; }
function input(label: string, type = "text", value = "", field?: string) { const wrapper = el("label", label), node = el("input");
  if (field) wrapper.dataset.field = field; node.type = type; node.value = value; node.setAttribute("aria-label", label); wrapper.append(node); return { wrapper, node }; }
function action(label: string, fn: () => Promise<void> | void, secondary = false, danger = false) { const b = el("button", label, danger ? "danger" : secondary ? "secondary" : ""); b.type = "button"; b.onclick = () => { void fn(); }; return b; }
function anchor(path: string, text: string) { const a = el("a", text); a.href = path; return a; }
function time(value: unknown) { return typeof value === "string" && value ? new Date(value).toLocaleString("en-US") : "Not provided"; }
function fileCount(value: unknown) { return `${value} ${value === 1 ? "file" : "files"}`; }
function explainCatalogError(root: Node, error: unknown) {
  const code = (error as { code?: string }).code;
  noteError(root, error);
  if (code === "PI_PACKAGE_IN_DEFAULTS" || code === "SKILL_DEFAULT_REFERENCE") {
    note(root, "Remove this item from Default Work first."); root.appendChild(anchor("/default-work", "Open Default Work"));
  }
  if (code === "PI_PACKAGE_BUSY") note(root, "A Core Package task is in progress. Wait and try again.", "message warn");
}
function errorMessage(error: unknown) { const e = error as { message?: string; code?: string; httpStatus?: number; retryAfterMs?: unknown };
  const known: Record<string, string> = {
    AUTHENTICATION_FAILED: "Sign in failed. Check the account and password.",
    CONFLICT: "This value conflicts with the current record. Check it and try again.",
    LAST_ADMINISTRATOR: "The last enabled administrator cannot be disabled.",
    NOT_FOUND: "The requested item was not found. Refresh the list.",
    PI_PACKAGE_IN_DEFAULTS: "This Package is selected in Default Work.",
    SKILL_DEFAULT_REFERENCE: "This Skill is selected in Default Work.",
    PI_PACKAGE_BUSY: "A Package task is in progress. Wait and retry.",
    CORE_TIMEOUT: "Core did not respond in time. Check the current state before retrying.",
    CORE_UNAVAILABLE: "Core is unavailable. Check its status and retry.",
    CONSOLE_UNAVAILABLE: "Connection interrupted. Check the current state before retrying.",
    CORE_INVALID_RESPONSE: "Core returned an invalid response. Check the current state.",
    INVALID_RESPONSE: "Invalid response. Check the current state before retrying.",
    RATE_LIMITED: "Too many requests. Wait before retrying.",
    UPLOAD_INTERRUPTED: "Upload interrupted. Check the current item before retrying.",
  };
  const code = safeDiagnostic(e.code);
  const message = code && known[code] ? known[code] : typeof e.httpStatus === "number" || code || typeof e.message !== "string" || /[^\x00-\x7F]/.test(e.message)
    ? "The request failed. Check the current state and try again." : e.message;
  const retryAfterMs = e.retryAfterMs;
  const wait = typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0
    ? ` · Try again in ${Math.ceil(retryAfterMs / 1000)} seconds` : "";
  return `${message}${wait}`; }
function safeDiagnostic(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : undefined;
}
function noteFieldError(wrapper: HTMLElement, message: string) { wrapper.querySelector(".field-error")?.remove();
  const error = el("span", message, "field-error"); error.setAttribute("role", "alert"); wrapper.append(error); return error; }
function noteDiagnostics(root: Node, error: unknown) {
  const e = error as { code?: unknown; field?: unknown; correlationId?: unknown };
  const code = safeDiagnostic(e.code), field = safeDiagnostic(e.field), correlationId = safeDiagnostic(e.correlationId);
  const details = [code && `Code: ${code}`, field && `Field: ${field}`, correlationId && `Correlation ID: ${correlationId}`].filter(Boolean);
  if (details.length) note(root, details.join(" · "), "small error-details");
  if (field && root instanceof HTMLElement) { const wrapper = [...root.querySelectorAll<HTMLElement>("[data-field]")]
    .find((item) => item.dataset.field === field); if (wrapper) noteFieldError(wrapper, "Check this field and try again."); }
}
function noteError(root: Node, error: unknown) {
  const message = note(root, errorMessage(error), "message error");
  noteDiagnostics(root, error);
  return message;
}
const invalidResponse = () => ({ code: "INVALID_RESPONSE", message: "Invalid response. Check the current state before trying again." });
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
  catch { throw { code: "CONSOLE_UNAVAILABLE", message: "Connection interrupted. Check the current state before trying again." }; }
  if (response.status === 204) return {};
  const result = await response.json().catch(() => { if (response.ok) throw invalidResponse();
    return { code: "INVALID_RESPONSE", message: "Invalid response" }; }) as Data;
  if (!response.ok) { if (response.status === 401 && path !== "/login") { authenticated = false; void showLogin(); }
    throw { ...result, httpStatus: response.status }; }
  if (!isData(result)) throw invalidResponse();
  return result;
}
const admin = (path: string, method = "GET", body?: unknown) => api(`/admin${path}`, method, body);
function navigation() { nav.replaceChildren(); logout.hidden = !authenticated;
  if (authenticated) for (const [path, text] of links) { const a = anchor(path, text); if (location.pathname === path) a.setAttribute("aria-current", "page"); nav.append(a); } }
function changed(form: HTMLElement) { form.addEventListener("input", () => { dirty = true; }); form.addEventListener("change", () => { dirty = true; }); }
function confirmDiscard(): boolean { return !dirty || confirm("Discard unsaved changes on this page?"); }
function refreshWithConfirmation(fn: () => Promise<void>): Promise<void> { return confirmDiscard() ? fn() : Promise.resolve(); }
window.addEventListener("beforeunload", (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
async function submit(button: HTMLButtonElement, root: Node, fn: () => Promise<void>, success?: string,
  onError?: (error: unknown) => void) {
  button.disabled = true; try { await fn(); dirty = false; if (success) note(root.isConnected ? root : app, success); }
  catch (error) { if (onError) onError(error); else noteError(root.isConnected ? root : app, error); }
  finally { button.disabled = false; }
}
logout.onclick = () => { if (!confirmDiscard()) return;
  void submit(logout, app, async () => { await api("/logout", "POST", {}); authenticated = false; currentUser = undefined; await showLogin(); }, "Signed out"); };

async function showLogin() {
  reset("Administrator sign in"); navigation(); const panel = card(), form = el("form"); panel.classList.add("login-card"); form.classList.add("login-form");
  const account = input("Account"), password = input("Password", "password"); password.node.autocomplete = "current-password";
  note(panel, "Set up the first administrator with piwork-serve. Other users sign in through piwork-cli.", "small");
  const go = el("button", "Sign in"); go.type = "submit"; add(form, account.wrapper, password.wrapper, go); panel.append(form);
  form.onsubmit = (event) => { event.preventDefault(); void submit(go, panel, async () => {
    const result = await api("/login", "POST", { account: account.node.value, password: password.node.value });
    csrf = String(result.csrfToken); authenticated = true; currentUser = result.user as typeof currentUser; location.href = "/";
  }).finally(() => { password.node.value = ""; }); };
  const checking = note(panel, "Checking Core availability…", "small");
  try { const availability = await api("/availability"); checking.remove();
    if (!availability.reachable) { note(panel, "Core is unavailable. Retry the connection.", "message warn"); panel.append(action("Retry connection", showLogin)); }
    else if (!availability.administratorInitialized) note(panel, "Administrator setup is required.", "message warn"); }
  catch { checking.remove(); note(panel, "Core availability is unknown. Retry the connection.", "message warn"); panel.append(action("Retry connection", showLogin)); }
}

async function showStatus() {
  reset("Core status"); const panel = card(); sectionHeader(panel, "Current status", action("Refresh status", () => { void refresh(); }, true)); note(panel, "Checking Core…", "small");
  const refresh = async () => {
    if (refreshing) return; refreshing = true;
    try { const [status, health] = await Promise.all([admin("/status"), api("/health")]);
      statusSnapshot = { status, health, checkedAt: new Date() }; panel.replaceChildren();
      sectionHeader(panel, "Current status", action("Refresh status", () => { void refresh(); }, true));
      const summary = el("div", undefined, "summary-list"); panel.append(summary);
      add(summary, el("p", `Administrator: ${currentUser?.account ?? ""}`), el("p", `Core reachable · Process health: ${health.healthy ? "Healthy" : "Unhealthy"}`),
        el("p", `Runtime readiness: ${status.ready ? "Ready" : "Not ready"} · ${status.state}`));
      for (const [key, value] of Object.entries((status.checks as Data) ?? {})) summary.append(el("p", `${key}: ${value ? "Yes" : "No"}`));
      if (status.state === "RUNTIME_NOT_CONFIGURED") panel.append(anchor("/runtime", "Configure runtime"));
    } catch (error) { panel.replaceChildren(); sectionHeader(panel, "Current status", action("Refresh status", () => { void refresh(); }, true)); note(panel, "Current Core status is unknown. Refresh status.", "message error"); noteError(panel, error);
      if (statusSnapshot) note(panel, `Previous status (${statusSnapshot.checkedAt.toLocaleString("en-US")}): ${statusSnapshot.status.state}. Current readiness is unknown.`, "message warn"); }
    finally { refreshing = false; }
  };
  let refreshing = false;
  statusRefresh = refresh;
  await refresh();
}

async function showUsers() {
  reset("Users"); const panel = card();
  sectionHeader(panel, "User list", action("Refresh users", () => refreshWithConfirmation(showUsers), true));
  const loading = note(panel, "Loading users…", "small");
  type User = { id: string; account: string; role: string; enabled: boolean; createdAt?: string; updatedAt?: string };
  try { const users = (await admin("/users")).users as User[];
    loading.remove();
    if (!users.length) note(panel, "No users yet. Create one below.");
    const wrap = el("div", undefined, "table-wrap"), table = el("table"), body = el("tbody");
    const head = el("tr"); for (const text of ["Account", "User ID", "Role", "Status", "Created", "Updated", "Actions"]) head.append(el("th", text)); table.append(head, body);
    for (const user of users) { const row = el("tr"), actions = el("td", undefined, "actions");
      actions.append(action(user.enabled ? "Disable" : "Enable", async () => {
        if (!confirmDiscard()) return;
        if (!confirm(`${user.enabled ? "Disable" : "Enable"} ${user.account}? ${user.enabled ? "This revokes all sessions for this account." : "Previous sessions will not be restored."}`)) return;
        try { await admin(`/users/${encodeURIComponent(user.id)}/${user.enabled ? "disable" : "enable"}`, "POST", {});
          if (user.id === currentUser?.id && user.enabled) { authenticated = false; await showLogin(); } else await showUsers(); }
        catch (error) { noteError(panel, error); panel.append(action("Refresh users", () => refreshWithConfirmation(showUsers), true)); }
      }, !user.enabled, user.enabled));
      actions.append(action("Reset password", async () => {
        app.querySelector(".reset-card")?.remove();
        const resetPanel = el("section", undefined, "card form-card reset-card"), form = el("form");
        resetPanel.append(el("h2", `Reset password for ${user.account}`), form);
        const password = input("New password", "password", "", "password"), confirmation = input("Confirm new password", "password", "", "passwordConfirmation");
        password.node.autocomplete = "new-password"; confirmation.node.autocomplete = "new-password";
        const buttons = el("div", undefined, "actions"), cancel = action("Cancel", () => { resetPanel.remove(); }, true);
        const save = el("button", "Confirm reset", "danger"); save.type = "submit";
        add(buttons, cancel, save); add(form, password.wrapper, confirmation.wrapper, buttons); panel.after(resetPanel);
        password.node.focus();
        form.onsubmit = (event) => { event.preventDefault();
          if (password.node.value.length < 12 || password.node.value.length > 1024) {
            noteFieldError(password.wrapper, "Password must be 12–1024 characters."); password.node.focus(); return;
          }
          if (password.node.value !== confirmation.node.value) { noteFieldError(confirmation.wrapper, "Passwords do not match."); return; }
          if (!confirm(`Reset ${user.account} password? This revokes all sessions for the account.`) || !confirmDiscard()) return;
          void submit(save, resetPanel, async () => {
            try { await admin(`/users/${encodeURIComponent(user.id)}/reset-credential`, "POST", { password: password.node.value }); }
            catch (error) {
              if ((error as { httpStatus?: number }).httpStatus === 404) await showUsers();
              throw error;
            } finally { password.node.value = ""; confirmation.node.value = ""; }
            if (user.id === currentUser?.id) { authenticated = false; await showLogin(); }
            else await showUsers();
          }, user.id === currentUser?.id ? undefined : "Password reset. All sessions for this account were revoked."); };
      }, false, true));
      add(row, el("td", user.account), el("td", user.id), el("td", user.role === "admin" ? "Administrator" : "User"), el("td", user.enabled ? "Enabled" : "Disabled"),
        el("td", time(user.createdAt)), el("td", time(user.updatedAt)), actions); body.append(row); }
    wrap.append(table); panel.append(wrap);
  } catch (error) { loading.remove(); noteError(panel, error); panel.append(action("Retry", showUsers)); return; }
  const create = card(), form = el("form"); create.classList.add("form-card"); sectionHeader(create, "Create user");
  note(create, "Users sign in through piwork-cli and manage their own Work. Administrators can sign in here.", "small"); create.append(form);
  const account = input("Account", "text", "", "account"), password = input("Password", "password", "", "password"), confirmation = input("Confirm password", "password", "", "passwordConfirmation");
  const role = el("select"); role.setAttribute("aria-label", "Role");
  for (const [value, text] of [["user", "User"], ["admin", "Administrator"]] as const) { const option = el("option", text); option.value = value; role.append(option); }
  const roleLabel = el("label", "Role"); roleLabel.dataset.field = "role"; roleLabel.append(role);
  const go = el("button", "Create user"); go.type = "submit"; add(form, account.wrapper, password.wrapper, confirmation.wrapper, roleLabel, go); changed(form);
  form.onsubmit = (event) => { event.preventDefault();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(account.node.value)) { noteFieldError(account.wrapper, "Use 1–128 letters, numbers, periods, underscores, colons or hyphens. Start with a letter or number."); account.node.focus(); return; }
    if (password.node.value.length < 12 || password.node.value.length > 1024) { noteFieldError(password.wrapper, "Password must be 12–1024 characters."); password.node.focus(); return; }
    if (password.node.value !== confirmation.node.value) { noteFieldError(confirmation.wrapper, "Passwords do not match."); confirmation.node.focus(); return; }
    void submit(go, create, async () => { const created = await admin("/users", "POST",
      { account: account.node.value, password: password.node.value, role: role.value });
      password.node.value = ""; confirmation.node.value = ""; await showUsers();
      note(app, String(created.account) + " created as " + (created.role === "admin" ? "an administrator" : "a user") + ". "
        + (created.role === "admin" ? "The account can sign in here." : "Sign in through piwork-cli."));
    }); };
}

async function showRuntime() {
  reset("Runtime"); const panel = card(); sectionHeader(panel, "Current configuration"); let runtime: Data;
  note(panel, "Loading runtime…", "small loading-state");
  try { runtime = await admin("/runtime"); panel.querySelector(".loading-state")?.remove(); }
  catch (error) { panel.querySelector(".loading-state")?.remove(); noteError(panel, error); panel.append(action("Retry", showRuntime)); return; }
  const model = runtime.configured ? runtime.model as Data : {};
  const summary = el("div", undefined, "summary-list"); panel.append(summary);
  const renderSummary = (value: Data) => { const details = value.configured ? value.model as Data : {};
    summary.replaceChildren(el("p", value.configured
      ? `Current image: ${value.agentImage} · Model: ${details.provider}/${details.id} · Base URL: ${details.baseUrl ?? "Default"}` : "Runtime is not configured."));
    if (value.configured) summary.append(el("p", `Credential: ${details.credentialAvailable ? "Available" : "Unavailable"} · Updated: ${time(value.updatedAt)}`)); };
  renderSummary(runtime);
  const edit = card(); edit.classList.add("form-card"); sectionHeader(edit, "Edit runtime");
  note(edit, "Enter the full API Key for each save. Existing Work is unchanged; new settings apply to future Work.", "small");
  const form = el("form"), image = input("Agent image", "text", String(runtime.agentImage ?? ""), "agentImage"), provider = input("Model provider", "text", String(model.provider ?? ""), "provider"),
    id = input("Model ID", "text", String(model.id ?? ""), "model"), base = input("Custom Base URL", "url", String(model.baseUrl ?? ""), "baseUrl"), key = input("API Key", "password", "", "credential");
  key.node.autocomplete = "new-password"; const go = el("button", "Save runtime"); go.type = "submit";
  const runtimeState = el("p", "Enter the full API Key to save runtime changes.", "small draft-state");
  let uncertainRuntime = false;
  add(form, image.wrapper, provider.wrapper, id.wrapper, base.wrapper, key.wrapper, runtimeState, go); edit.append(form); changed(form);
  form.addEventListener("input", () => { runtimeState.textContent = "Unsaved runtime changes."; });
  form.onsubmit = (event) => { event.preventDefault(); if (uncertainRuntime) return;
    if (!key.node.value) { noteFieldError(key.wrapper, "Enter the full API Key again."); key.node.focus(); return; }
    runtimeState.textContent = "Saving runtime…";
    void submit(go, edit, async () => {
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
    const status = result.status as Data; runtimeState.textContent = "Current runtime configuration loaded.";
    note(form, status.ready ? "Configuration saved. Runtime is ready." : `Configuration saved. Runtime is not ready: ${status.state}`, status.ready ? "message" : "message warn");
  }, undefined, (error) => {
    if (!uncertainWrite(error)) { noteError(edit, error); runtimeState.textContent = "Unsaved runtime changes. Review the error and try again."; return; }
    uncertainRuntime = true; runtimeState.textContent = "Runtime save result is unknown.";
    note(edit, "Save result is uncertain. Read the current runtime before retrying.", "message warn"); noteDiagnostics(edit, error);
    edit.append(action("Read current runtime", async () => {
      try { runtime = await admin("/runtime"); renderSummary(runtime);
        uncertainRuntime = false; go.disabled = false;
        note(edit, "Current Core configuration loaded. Compare it with the retained draft.", "message"); }
      catch (readError) { noteError(edit, readError); }
    }, true));
  }).finally(() => { key.node.value = ""; go.disabled = uncertainRuntime; }); };
}

async function showDefaultWork(saved?: Data, savedCatalogs?: {
  skills: Array<{ name: string; enabled: boolean }>; packages: Array<{ name: string; enabled: boolean }>;
}) {
  reset("Default Work"); const panel = card(); sectionHeader(panel, "Current defaults"); let data: Data, skills: Array<{ name: string; enabled: boolean }>, packages: Array<{ name: string; enabled: boolean }>;
  if (!saved) note(panel, "Loading defaults…", "small loading-state");
  try { [data, skills, packages] = saved && savedCatalogs ? [saved, savedCatalogs.skills, savedCatalogs.packages]
    : await Promise.all([admin("/default-work"), admin("/skills").then((v) => v.skills as typeof skills),
      admin("/packages").then((v) => v.packages as typeof packages)]); panel.querySelector(".loading-state")?.remove(); }
  catch (error) { panel.querySelector(".loading-state")?.remove(); noteError(panel, error); panel.append(action("Retry", showDefaultWork)); return; }
  if (data.configuration === null) { note(panel, "Defaults are not initialized. Set up the runtime first.", "message warn"); panel.append(anchor("/runtime", "Open Runtime")); return; }
  const config = data.configuration as Data, detail = el("details");
  panel.append(el("p", `Base image: ${data.baseImage ?? "Not set"} · Skills: ${(config.skills as string[]).length} · Packages: ${(config.packages as unknown[]).length}`));
  detail.append(el("summary", "View full public configuration"), el("pre", JSON.stringify(config, null, 2))); panel.append(detail);
  const edit = card(); edit.classList.add("form-card"); sectionHeader(edit, "Edit Default Work");
  note(edit, "Defaults affect only future Work. Selecting a local AGENTS.md fills the draft; save to apply it.", "small");
  const form = el("form"), image = input("Default Agent image", "text", String(data.baseImage ?? ""), "baseImage"); form.append(image.wrapper);
  const baselineSkills = [...config.skills as string[]];
  const baselinePackages = (config.packages as Array<{ name: string }>).map((item) => item.name);
  let skillOrder = [...baselineSkills], packageOrder = [...baselinePackages];
  const skillCatalog = new Map(skills.map((item) => [item.name, item]));
  const packageCatalog = new Map(packages.map((item) => [item.name, item]));
  const skillBox = el("fieldset"), packageBox = el("fieldset"), orderedSkills = el("div", undefined, "skill-order");
  const skillChecks = new Map<string, HTMLInputElement>();
  skillBox.append(el("legend", "Default Skills")); packageBox.append(el("legend", "Default Packages"));
  skillBox.dataset.field = "skills"; packageBox.dataset.field = "packages";
  const go = el("button", "Save defaults"); go.type = "submit";
  const draftState = el("p", "No changes to save.", "small draft-state");
  const changedValues = () => ({
    image: image.node.value !== String(data.baseImage ?? ""),
    skills: JSON.stringify(skillOrder) !== JSON.stringify(baselineSkills),
    packages: JSON.stringify(packageOrder) !== JSON.stringify(baselinePackages),
    agents: agents.value !== String(config.agentsMd ?? ""),
  });
  let uncertainDefault = false;
  const updateSaveState = () => { const edits = changedValues(); const changed = Object.values(edits).some(Boolean);
    go.disabled = !changed || uncertainDefault; dirty = changed;
    draftState.textContent = uncertainDefault ? "Save result is uncertain. Read the current defaults before retrying."
      : changed ? "Unsaved changes to Default Work." : "No changes to save."; };
  const renderSkillOrder = () => { orderedSkills.replaceChildren();
    if (!skillOrder.length) { orderedSkills.append(el("p", "No Skills selected. Choose from the list above.", "small")); return; }
    orderedSkills.append(el("p", "Selected Skill order:", "small"));
    skillOrder.forEach((name, index) => { const row = el("div", undefined, "skill-order-row");
      const item = skillCatalog.get(name), nameNode = el("span", `${index + 1}. ${name}`, "skill-order-name");
      row.append(nameNode);
      if (!item?.enabled) row.append(el("span", item ? "Disabled" : "Removed from catalog", "skill-order-status"));
      const controls = el("div", undefined, "actions");
      const move = (offset: number) => { const other = index + offset; if (other < 0 || other >= skillOrder.length) return;
        [skillOrder[index], skillOrder[other]] = [skillOrder[other]!, skillOrder[index]!];
        renderSkillOrder(); updateSaveState(); };
      const up = action("Move up", () => move(-1), true), down = action("Move down", () => move(1), true);
      up.setAttribute("aria-label", `Move up Skill ${name}`); down.setAttribute("aria-label", `Move down Skill ${name}`);
      up.disabled = index === 0; down.disabled = index === skillOrder.length - 1;
      const remove = action("Remove", () => { skillOrder = skillOrder.filter((entry) => entry !== name);
        const check = skillChecks.get(name); if (check) check.checked = false;
        renderSkillOrder(); updateSaveState(); }, true);
      remove.setAttribute("aria-label", `Remove Skill ${name} from defaults`);
      controls.append(up, down, remove); row.append(controls); orderedSkills.append(row); }); };
  for (const name of [...new Set([...skillOrder, ...skills.map((item) => item.name)])].sort((a, b) => a.localeCompare(b))) {
    const item = skillCatalog.get(name), selected = skillOrder.includes(name);
    const reason = item === undefined ? " (removed from catalog)" : item.enabled ? "" : " (disabled)";
    const row = el("label", `${name}${reason}`), check = el("input");
    check.type = "checkbox"; check.value = name; check.checked = selected; check.disabled = !item?.enabled && !selected;
    skillChecks.set(name, check);
    check.onchange = () => { skillOrder = check.checked ? [...skillOrder, name] : skillOrder.filter((entry) => entry !== name);
      renderSkillOrder(); updateSaveState(); }; row.prepend(check); skillBox.append(row);
  }
  skillBox.append(orderedSkills); renderSkillOrder();
  for (const name of [...new Set([...packageOrder, ...packages.map((item) => item.name)])].sort((a, b) => a.localeCompare(b))) {
    const item = packageCatalog.get(name), selected = packageOrder.includes(name);
    const reason = item === undefined ? " (removed from catalog)" : item.enabled ? "" : " (disabled)";
    const row = el("label", `${name}${reason}`), check = el("input");
    check.type = "checkbox"; check.value = name; check.checked = selected; check.disabled = !item?.enabled && !selected;
    check.onchange = () => { packageOrder = check.checked ? [...packageOrder, name] : packageOrder.filter((entry) => entry !== name);
      updateSaveState(); }; row.prepend(check); packageBox.append(row);
  }
  form.append(skillBox, packageBox);
  const agents = el("textarea"); agents.value = String(config.agentsMd ?? ""); agents.setAttribute("aria-label", "AGENTS.md content");
  const agentsLabel = el("label", "AGENTS.md content"); agentsLabel.dataset.field = "agentsMd"; agentsLabel.append(agents); form.append(agentsLabel);
  const file = input("Select local AGENTS.md", "file"); file.node.accept = ".md,text/markdown,text/plain"; form.append(file.wrapper);
  const count = el("p", "", "small"), updateCount = () => { count.textContent = `${new TextEncoder().encode(agents.value).byteLength} / 262144 bytes`; };
  let agentsDirty = false;
  agents.addEventListener("input", () => { agentsDirty = true; updateCount(); updateSaveState(); }); updateCount(); form.append(count);
  file.node.onchange = () => { const chosen = file.node.files?.[0]; if (!chosen) return;
    if (agentsDirty && !confirm("Reading this file will replace the AGENTS.md draft. Continue?")) { file.node.value = ""; return; }
    if (chosen.size > 262144) { note(edit, "AGENTS.md exceeds 256 KiB. The draft was kept.", "message error"); file.node.value = ""; return; }
    void chosen.arrayBuffer().then((bytes) => { const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      if (new TextEncoder().encode(content).byteLength > 262144) throw new Error("AGENTS.md exceeds 256 KiB.");
      agents.value = content; updateCount(); agentsDirty = true; updateSaveState(); })
      .catch((error) => { note(edit, error instanceof Error && error.message.includes("256 KiB") ? error.message : "The file is not valid UTF-8 text.", "message error");
        file.node.value = ""; }); };
  form.append(draftState, go); edit.append(form); image.node.addEventListener("input", updateSaveState); updateSaveState();
  form.onsubmit = (event) => { event.preventDefault(); const edits = changedValues(), patch: Data = {};
    if (edits.image) patch.baseImage = image.node.value;
    if (edits.skills) patch.skills = skillOrder;
    if (edits.packages) patch.packages = packageOrder;
    if (edits.agents) patch.agentsMd = agents.value;
    if (!Object.keys(patch).length) return;
    if (packageOrder.length > 64) { noteFieldError(packageBox, "Select at most 64 default Packages."); return; }
    if (new TextEncoder().encode(agents.value).byteLength > 262144) { noteFieldError(agentsLabel, "AGENTS.md exceeds 256 KiB."); return; }
    if (uncertainDefault) return;
    draftState.textContent = "Saving Default Work…";
    void submit(go, edit, async () => { const saved = await admin("/default-work", "PATCH", patch);
      await showDefaultWork(saved, { skills, packages }); }, "Defaults saved. Only future Work is affected.", (error) => {
      if (!uncertainWrite(error)) { noteError(edit, error); draftState.textContent = "Unsaved changes to Default Work. Review the error and try again."; return; }
      uncertainDefault = true; note(edit, "Save result is uncertain. Read the current defaults before retrying.", "message warn"); noteDiagnostics(edit, error);
      edit.append(action("Read current defaults", async () => { try { const current = await admin("/default-work");
        const currentConfig = current.configuration;
        const readback = el("details"); readback.open = true;
        readback.append(el("summary", "Current Core defaults for comparison"), el("pre", JSON.stringify(currentConfig, null, 2)));
        edit.append(readback); uncertainDefault = false; updateSaveState();
        note(edit, "Current defaults loaded. Compare them with the retained draft before saving again."); }
      catch (readError) { noteError(edit, readError); } }, true));
      updateSaveState();
    }).finally(() => { if (edit.isConnected) updateSaveState(); }); };
}

async function uploadFiles(path: string, directoryName: string, files: FileList, root: Node): Promise<Data> {
  const body = new FormData(); body.append("directoryName", directoryName);
  for (const file of files) { const relative = file.webkitRelativePath.split("/").slice(1).join("/");
    if (!relative) throw { code: "DIRECTORY_REQUIRED", message: "Select a directory." };
    body.append("files", file, encodeURIComponent(relative)); }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(), progress = note(root, "Preparing upload…", "small");
    xhr.open(path === "/skills" ? "POST" : "PUT", `/console/api/admin${path}`);
    xhr.withCredentials = true; xhr.setRequestHeader("x-csrf-token", csrf);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) progress.textContent = `Uploading ${Math.floor(event.loaded / event.total * 100)}%`; };
    xhr.upload.onload = () => { progress.textContent = "Files sent. Core is validating and publishing…"; };
    xhr.onerror = () => reject({ code: "UPLOAD_INTERRUPTED", message: "Upload interrupted. Check the current Skill before retrying." });
    xhr.onload = () => { try { const value = JSON.parse(xhr.responseText) as Data; xhr.status >= 200 && xhr.status < 300 ? resolve(value) : reject(value); }
      catch { reject({ code: "INVALID_RESPONSE", message: "Invalid upload response." }); } };
    xhr.send(body);
  });
}
function skillDirectory(files: FileList): string {
  if (!files.length) throw { message: "Select a Skill directory." };
  if (files.length > 2048) throw { message: "A Skill may contain at most 2,048 files." };
  const root = files[0]!.webkitRelativePath.split("/")[0]!;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(root)) throw { message: "Invalid Skill directory name." };
  let total = 0, hasManifest = false;
  for (const file of files) {
    const [name, ...segments] = file.webkitRelativePath.split("/");
    if (name !== root || segments.length === 0 || segments.some((part) => !part || part === "." || part === "..")) {
      throw { message: "Select one Skill root with valid file paths." };
    }
    if (segments.join("/") === "SKILL.md") hasManifest = true;
    if (file.size > 8 * 1024 * 1024) throw { message: "Each Skill file must be at most 8 MiB." };
    total += file.size;
    if (total > 32 * 1024 * 1024) throw { message: "Skill content must be at most 32 MiB." };
  }
  if (!hasManifest) throw { message: "The Skill root must contain SKILL.md." };
  return root;
}
async function showSkills() {
  reset("Skills"); const panel = card(); sectionHeader(panel, "Skill list", action("Refresh Skills", () => refreshWithConfirmation(showSkills), true));
  const loading = note(panel, "Loading Skills…", "small");
  type Skill = { name: string; enabled: boolean; fileCount: number; totalBytes: number };
  let skills: Skill[];
  try { skills = (await admin("/skills")).skills as Skill[]; loading.remove(); }
  catch (error) { loading.remove(); noteError(panel, error); panel.append(action("Retry", showSkills)); return; }
  if (!skills.length) note(panel, "No Skills yet. Upload a local directory.");
  for (const skill of skills) { const row = el("div", undefined, "list-row");
    add(row, anchor(`/skills/${encodeURIComponent(skill.name)}`, skill.name), el("span", `${skill.enabled ? "Enabled" : "Disabled"} · ${fileCount(skill.fileCount)} · ${skill.totalBytes} bytes`)); panel.append(row); }
  const upload = card(), form = el("form"); upload.classList.add("form-card"); sectionHeader(upload, "Upload Skill directory");
  note(upload, "Select a complete directory from this device. Core validates and publishes it after upload.", "small"); upload.append(form);
  const directory = input("Select Skill directory", "file"); directory.node.setAttribute("webkitdirectory", ""); directory.node.multiple = true;
  const directorySupported = "webkitdirectory" in directory.node;
  if (!directorySupported) note(upload, "This browser cannot select directories. Use a browser that supports directory selection.", "message warn");
  const preview = el("p", "Select a directory with SKILL.md at its root.", "small");
  directory.node.onchange = () => { const files = directory.node.files, name = files?.[0]?.webkitRelativePath.split("/")[0] ?? "";
    preview.textContent = files?.length ? `${name} · ${fileCount(files.length)} · ${[...files].reduce((sum, file) => sum + file.size, 0)} bytes` : "Select a directory with SKILL.md at its root."; };
  const go = el("button", "Upload Skill"); go.type = "submit"; go.disabled = !directorySupported;
  add(form, directory.wrapper, preview, go); changed(form);
  form.onsubmit = (event) => { event.preventDefault(); const files = directory.node.files; if (!files?.length) { note(upload, "Select a directory.", "message error"); return; }
    let name: string; try { name = skillDirectory(files); } catch (error) { noteError(upload, error); return; }
    void submit(go, upload, async () => { await uploadFiles("/skills", name, files, upload); await showSkills(); }, `Skill ${name} published by Core.`); };
}
async function showSkill(name: string) {
  reset("Skill details"); const panel = card(); let skill: Data;
  const loading = note(panel, "Loading Skill…", "small");
  try { skill = await admin(`/skills/${encodeURIComponent(name)}`); loading.remove(); }
  catch (error) { loading.remove(); noteError(panel, error); panel.append(anchor("/skills", "Back to list")); return; }
  sectionHeader(panel, String(skill.name), action("Refresh details", () => refreshWithConfirmation(() => showSkill(name)), true));
  add(panel, el("p", `${skill.enabled ? "Enabled" : "Disabled"} · ${fileCount(skill.fileCount)} · ${skill.totalBytes} bytes`),
    el("p", `Created: ${time(skill.createdAt)} · Updated: ${time(skill.updatedAt)}`, "detail-meta"), anchor("/skills", "Back to Skills"));
  const controls = el("div", undefined, "actions danger-zone"); panel.append(controls);
  controls.append(action(skill.enabled ? "Disable" : "Enable", async () => { if (!confirmDiscard()) return;
    try { await admin(`/skills/${encodeURIComponent(name)}/${skill.enabled ? "disable" : "enable"}`, "POST", {}); await showSkill(name); }
    catch (error) { explainCatalogError(panel, error); } }, skill.enabled !== true, skill.enabled === true));
  controls.append(action("Remove", async () => { if (!confirmDiscard() || !confirm(`Remove ${name}? Future Work cannot select this Skill. Existing Work copies remain.`)) return;
    try { await admin(`/skills/${encodeURIComponent(name)}`, "DELETE"); location.href = "/skills"; } catch (error) { explainCatalogError(panel, error); } }, false, true));
  const edit = card(); edit.classList.add("form-card"); sectionHeader(edit, "Update Skill"); note(edit, "Select a local directory with the same name. Core validates and publishes it after upload.", "small");
  const form = el("form"), directory = input("Select matching Skill directory", "file"); directory.node.setAttribute("webkitdirectory", ""); directory.node.multiple = true;
  const preview = el("p", "Select a directory with the same name.", "small");
  directory.node.onchange = () => { const files = directory.node.files, selected = files?.[0]?.webkitRelativePath.split("/")[0] ?? "";
    preview.textContent = files?.length ? `${selected} · ${fileCount(files.length)} · ${[...files].reduce((sum, file) => sum + file.size, 0)} bytes` : "Select a directory with the same name."; };
  const go = el("button", "Upload update"); go.type = "submit"; go.disabled = !("webkitdirectory" in directory.node);
  if (go.disabled) note(edit, "This browser cannot select directories. Use a browser that supports directory selection.", "message warn");
  add(form, directory.wrapper, preview, go); edit.append(form); changed(form);
  form.onsubmit = (event) => { event.preventDefault(); const files = directory.node.files; if (!files?.length) return;
    let selected: string; try { selected = skillDirectory(files); } catch (error) { noteError(edit, error); return; }
    if (selected !== name) { note(edit, "SKILL_NAME_MISMATCH: Directory name must match this Skill.", "message error"); return; }
    void submit(go, edit, async () => { await uploadFiles(`/skills/${encodeURIComponent(name)}`, selected, files, edit); await showSkill(name); }, `Skill ${name} updated by Core.`); };
}

async function showPackages() {
  reset("Packages"); const panel = card(); sectionHeader(panel, "Package list", action("Refresh Packages", () => refreshWithConfirmation(showPackages), true));
  const loading = note(panel, "Loading Packages…", "small");
  type Package = { name: string; version: string | null; enabled: boolean; isDefault: boolean; sourceKind: string };
  let packages: Package[];
  try { packages = (await admin("/packages")).packages as Package[]; loading.remove(); }
  catch (error) { loading.remove(); noteError(panel, error); panel.append(action("Retry", showPackages)); return; }
  if (!packages.length) note(panel, "No Core Packages yet. Install one below.");
  const table = el("table"), body = el("tbody"), wrap = el("div", undefined, "table-wrap"), head = el("tr");
  for (const item of ["Name", "Version", "Source", "Status", "Default", "Resources"]) head.append(el("th", item)); table.append(head, body);
  for (const item of packages) { const row = el("tr"), name = el("td"); name.append(anchor(`/packages/${encodeURIComponent(item.name)}`, item.name));
    add(row, name, el("td", item.version ?? "Not provided"), el("td", item.sourceKind), el("td", item.enabled ? "Enabled" : "Disabled"),
      el("td", item.isDefault ? "Yes" : "No"), el("td", resourceSummary(item as Data))); body.append(row); }
  wrap.append(table); panel.append(wrap);
  packageForm();
}
async function showPackage(name: string) {
  reset("Package details"); const panel = card(); let item: Data;
  const loading = note(panel, "Loading Package…", "small");
  try { item = await admin(`/packages/${encodeURIComponent(name)}`); loading.remove(); }
  catch (error) { loading.remove(); noteError(panel, error); panel.append(anchor("/packages", "Back to list")); return; }
  sectionHeader(panel, name, action("Refresh details", () => refreshWithConfirmation(() => showPackage(name)), true));
  add(panel, el("p", `Version: ${item.version ?? "Not provided"} · Source: ${item.sourceKind}`),
    el("p", `Status: ${item.enabled ? "Enabled" : "Disabled"} · Default Work: ${item.isDefault ? "Selected" : "Not selected"}`),
    el("p", `Resources: ${resourceSummary(item)}`), el("p", `Resolved source: ${item.resolvedSource ?? ""}`),
    anchor("/packages", "Back to Packages"), anchor("/default-work", "Manage Default Work"));
  const controls = el("div", undefined, "actions danger-zone"); panel.append(controls);
  controls.append(action(item.enabled ? "Disable" : "Enable", async () => { if (!confirmDiscard()) return;
    try { await admin(`/packages/${encodeURIComponent(name)}/${item.enabled ? "disable" : "enable"}`, "POST", {}); await showPackage(name); }
    catch (error) { explainCatalogError(panel, error); } }, item.enabled !== true, item.enabled === true));
  controls.append(action("Remove", async () => { if (!confirmDiscard() || !confirm(`Remove ${name}? Future Work cannot select this Package. Existing Work is unchanged.`)) return;
    try { await admin(`/packages/${encodeURIComponent(name)}`, "DELETE"); location.href = "/packages"; }
    catch (error) { explainCatalogError(panel, error); } }, false, true));
  packageForm(name);
}
function resourceSummary(item: Data): string {
  const counts = item.resourceCounts as Data | undefined;
  return counts ? `Extensions ${counts.extensions ?? 0} · Skills ${counts.skills ?? 0} · Prompts ${counts.prompts ?? 0} · Themes ${counts.themes ?? 0}` : "Not provided";
}
function uploadInput(kind: "directory" | "zip", file: File | FileList, root: Node): Promise<Data> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open("POST", `/console/api/package-inputs/${kind}`); xhr.withCredentials = true;
    xhr.setRequestHeader("x-csrf-token", csrf);
    if (kind === "zip") { xhr.setRequestHeader("content-type", "application/zip"); xhr.setRequestHeader("x-piwork-package-name", encodeURIComponent((file as File).name)); }
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) progress.textContent = `Uploading ${Math.floor(event.loaded / event.total * 100)}%`; };
    const progress = note(root, "Preparing upload…", "small");
    xhr.upload.onload = () => { progress.textContent = "Files sent. The console and Core are validating and transferring…"; };
    xhr.onerror = () => reject({ code: "UPLOAD_INTERRUPTED", message: "Upload interrupted. Check Core status." });
    xhr.onload = () => { try { const value = JSON.parse(xhr.responseText) as Data; xhr.status >= 200 && xhr.status < 300 ? resolve(value) : reject(value); }
      catch { reject({ code: "INVALID_RESPONSE", message: "Invalid upload response." }); } };
    if (kind === "zip") xhr.send(file as File);
    else { const list = file as FileList, body = new FormData(), rootName = list[0]?.webkitRelativePath.split("/")[0];
      body.append("directoryName", rootName ?? ""); for (const item of list) body.append("files", item, encodeURIComponent(item.webkitRelativePath.split("/").slice(1).join("/")));
      xhr.send(body); }
  });
}
function packageDirectory(files: FileList): void {
  if (!files.length) throw { message: "Select a local directory." };
  if (files.length > 100000) throw { message: "A Package may contain at most 100,000 files." };
  let total = 0, manifest = false;
  const root = files[0]!.webkitRelativePath.split("/")[0]!;
  for (const file of files) { const [name, ...parts] = file.webkitRelativePath.split("/");
    if (name !== root || !parts.length || parts.length > 64 || new TextEncoder().encode(parts.join("/")).byteLength > 4096) {
      throw { message: "Package directory or file path is invalid." };
    }
    if (file.size > 64 * 1024 * 1024) throw { message: "Each Package file must be at most 64 MiB." };
    total += file.size; if (total > 1024 * 1024 * 1024) throw { message: "Package content must be at most 1 GiB." };
    if (parts.join("/") === "package.json") { manifest = true; if (file.size > 1024 * 1024) throw { message: "package.json must be at most 1 MiB." }; }
  }
  if (!manifest) throw { message: "The directory root must contain package.json." };
}
function packageForm(target?: string) {
  const panel = card(), form = el("form"); panel.classList.add("form-card"); sectionHeader(panel, target ? `Update ${target}` : "Install Package");
  note(panel, "After Core accepts the request, an Operation opens. Check its final state before treating installation as complete.", "small"); panel.append(form);
  const kind = el("select"); kind.setAttribute("aria-label", "Source type");
  for (const [value, text] of [["npm", "npm"], ["git", "Git"], ["directory", "Local directory"], ["zip", "ZIP file"]] as const) { const option = el("option", text); option.value = value; kind.append(option); }
  const kindLabel = el("label", "Source type"); kindLabel.append(kind);
  const spec = input("npm or Git source"), directory = input("Select local directory", "file"), zip = input("Select ZIP file", "file");
  directory.node.setAttribute("webkitdirectory", ""); directory.node.multiple = true; zip.node.accept = ".zip,application/zip";
  const inputHint = el("p", "A local directory needs package.json. Each file may be up to 64 MiB; total content up to 1 GiB. ZIP may be up to 256 MiB. Use ZIP to preserve permissions or links.", "small");
  const defaultCheck = input("Add to Default Work after install", "checkbox"); defaultCheck.node.style.width = "auto";
  const directorySupported = "webkitdirectory" in directory.node;
  const showFields = () => { spec.wrapper.hidden = !["npm", "git"].includes(kind.value);
    directory.wrapper.hidden = kind.value !== "directory"; zip.wrapper.hidden = kind.value !== "zip";
    if (kind.value === "directory" && !directorySupported) inputHint.textContent = "This browser cannot select directories. Use ZIP.";
    else inputHint.textContent = "A local directory needs package.json. Each file may be up to 64 MiB; total content up to 1 GiB. ZIP may be up to 256 MiB. Use ZIP to preserve permissions or links."; };
  let previousKind = kind.value, sourceDirty = false;
  for (const field of [spec.node, directory.node, zip.node]) field.addEventListener("change", () => { sourceDirty = true; });
  spec.node.addEventListener("input", () => { sourceDirty = true; });
  kind.onchange = () => { if (sourceDirty && !confirm("Changing source type will discard the current source. Continue?")) { kind.value = previousKind; return; }
    spec.node.value = ""; directory.node.value = ""; zip.node.value = "";
    previousKind = kind.value; sourceDirty = false; showFields(); }; showFields();
  const go = el("button", target ? "Update Package" : "Install Package"); go.type = "submit";
  add(form, kindLabel, spec.wrapper, directory.wrapper, zip.wrapper, inputHint);
  if (target) { const targetName = input("Target Package name", "text", target); targetName.node.readOnly = true; form.prepend(targetName.wrapper); }
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
    if (uncertainIntent) { note(panel, "The previous submission is uncertain. Use Resume submission.", "message warn"); return; }
    void submit(go, panel, async () => {
    let source: Data;
    if (kind.value === "npm" || kind.value === "git") { if (!spec.node.value.trim()) throw { message: "Enter a source." }; source = { kind: kind.value, spec: spec.node.value.trim() }; }
    else if (kind.value === "zip") { if (!zip.node.files?.[0]) throw { message: "Select a ZIP file." };
      if (zip.node.files[0].size > 256 * 1024 * 1024) throw { message: "ZIP must be at most 256 MiB." };
      const upload = await uploadInput("zip", zip.node.files[0], panel); source = { kind: "upload", uploadId: upload.uploadId }; }
    else { if (!directorySupported) throw { message: "This browser cannot select directories. Use ZIP." };
      if (!directory.node.files?.length) throw { message: "Select a local directory." };
      packageDirectory(directory.node.files);
      const upload = await uploadInput("directory", directory.node.files, panel); source = { kind: "upload", uploadId: upload.uploadId }; }
    intent = { source, key: crypto.randomUUID(), addToDefaults: defaultCheck.node.checked };
    try { await accept(); } catch (error) {
      if (uncertainWrite(error)) {
        uncertainIntent = true;
        note(panel, "Acceptance is uncertain. Resume uses the same source and idempotency key.", "message warn");
        panel.append(action("Resume submission", async () => {
          try { await accept(); } catch (retryError) { noteError(panel, retryError); }
        }));
      } else intent = undefined;
      throw error;
    }
  }).finally(() => { go.disabled = uncertainIntent; }); };
}

async function showOperation(id?: string) {
  reset(id ? "Operation details" : "Find Operation"); const panel = card();
  if (!id) { panel.classList.add("form-card"); sectionHeader(panel, "Search by ID"); const form = el("form"), inputId = input("Operation ID"), go = el("button", "Find Operation"); go.type = "submit";
    add(form, inputId.wrapper, go); panel.append(form); form.onsubmit = (event) => { event.preventDefault();
      const value = inputId.node.value.trim();
      if (!/^operation-[a-zA-Z0-9-]{8,128}$/.test(value)) { note(panel, "Enter a valid Operation ID.", "message error"); inputId.node.focus(); return; }
      location.href = `/operations/${encodeURIComponent(value)}`; }; return; }
  sectionHeader(panel, "Current Operation", anchor("/operations", "Back to Find Operation"));
  const header = el("div", undefined, "actions"); add(header, el("strong", id, "technical-id"), action("Copy ID", async () => {
    try { await navigator.clipboard.writeText(id); note(panel, "Operation ID copied."); }
    catch { note(panel, "Copy failed. Select the ID above and copy it manually.", "message warn"); } }, true)); panel.append(header);
  const result = el("div"), observationError = el("div"); panel.append(result, observationError);
  note(result, "Reading Operation…", "small");
  let timer: number | undefined, stopped = false, inFlight = false, terminal = false;
  const poll = async () => { if (stopped || document.hidden || inFlight || terminal) return;
    inFlight = true; if (timer) { clearTimeout(timer); timer = undefined; }
    try { const operation = await admin(`/operations/${encodeURIComponent(id)}`); result.replaceChildren();
      observationError.replaceChildren();
      add(result, el("p", `Status: ${operation.state} · Phase: ${operation.packagePhase}`),
        el("p", `Last checked: ${new Date().toLocaleString("en-US")}`, "detail-meta"));
      terminal = ["succeeded", "failed", "superseded"].includes(String(operation.state));
      if (operation.state === "succeeded") note(result, "Operation succeeded. Check the result in Packages.", "message");
      else if (operation.state === "failed") note(result, "Operation failed. Review technical details, then retry with a new source.", "message error");
      else if (operation.state === "superseded") note(result, "Operation was superseded. Check the current Package state.", "message warn");
      else note(result, "Core accepted the task and is processing it. Keep the Operation ID for the final result.", "message");
      const technical = el("details"); technical.append(el("summary", "View Operation technical details"), el("pre", JSON.stringify(operation, null, 2))); result.append(technical);
      if (operation.state === "failed" || operation.state === "superseded") result.append(anchor("/packages", "Return to the form and retry with a new source and idempotency key."));
      if (!terminal) timer = window.setTimeout(() => { void poll(); }, 2000);
    } catch (error) { observationError.replaceChildren();
      note(observationError, "Observation interrupted. Current result is uncertain; the previous result is historical. Retry with the same Operation ID above.", "message warn"); noteDiagnostics(observationError, error);
      observationError.append(action("Retry observation", poll)); }
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
  } catch (error) { reset("Connection failed"); noteError(app, error); app.append(action("Retry", bootstrap)); }
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
