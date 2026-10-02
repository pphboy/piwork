type IdentityView = { coreUrl: string; state: "signed-out" | "authenticated" | "offline"; generation: number;
  user?: { id: string; account: string; role: string }; lastKnownUser?: { account: string };
  lastConfirmedAt?: string; error?: string; csrf?: string };

const app = document.getElementById("app");
let csrf = "";
let renderSequence = 0;
let currentView: IdentityView | undefined;
const serviceSelection = new Map<string, string>();
const servicePortSelection = new Map<string, number>();
const chatDraft = new Map<string, string>();
const sessionSelection = new Map<string, string>();
const runSelection = new Map<string, { runId: string; cursor: number }>();
let chatObserver: AbortController | undefined;
let workStatusPoll: number | undefined;
let leaveCurrentPanel: (() => boolean) | undefined;
let inspectedPackage: { transferId: string; summary: Record<string, unknown> } | undefined;
type Work = { id: string; name: string; desiredState: string; observedState: string; updatedAt?: string };
type Service = { serviceId: string; name: string; enabled: boolean; observedState: string;
  lastError?: { message?: string } | null;
  access: { hostname: string; defaultUrl: string | null; defaultPortName: string | null;
    status: string; ports: { name: string; port: number; url: string }[] } };
import { mountFiles } from "./files.js";

class DesktopApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, content?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function field(label: string, type: string, value = ""): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
  const wrapper = element("label", label, "form-field");
  const input = element("input");
  input.type = type;
  input.value = value;
  input.setAttribute("aria-label", label);
  wrapper.append(input);
  return { wrapper, input };
}

function button(label: string, action: (trigger: HTMLButtonElement) => Promise<void>, secondary = false): HTMLButtonElement {
  const control = element("button", label, secondary ? "secondary" : "primary");
  control.type = "button";
  control.onclick = () => { control.disabled = true; void action(control).finally(() => { control.disabled = false; }); };
  return control;
}

function createMenu(label: string): { container: HTMLDetailsElement; summary: HTMLElement } {
  const container = element("details", undefined, "row-menu");
  const summary = element("summary", label);
  container.append(summary);
  container.onkeydown = (event) => {
    if (event.key === "Escape" && container.open) {
      event.preventDefault();
      container.open = false;
      summary.focus();
    }
  };
  return { container, summary };
}

async function api<T = Record<string, unknown>>(path: string, method = "GET", body?: unknown,
  extraHeaders: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`/_desktop/api/${path}`, { method, credentials: "same-origin", headers: {
    ...(method === "GET" ? {} : { "x-piwork-csrf": csrf }),
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...extraHeaders,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json() as IdentityView & { code?: string; message?: string };
  if (!response.ok) throw new DesktopApiError(response.status, result.code ?? "HTTP_ERROR",
    result.message ?? result.code ?? `HTTP ${response.status}`);
  return result as T;
}

function watchTransfer(id: string, kind: "work-packages" | "downloads", update: (value: string) => void): () => void {
  let stopped = false;
  const poll = async () => {
    if (stopped) return;
    try {
      const state = await api<{ phase: string; transferred: number; total: number | null }>(`${kind}/${encodeURIComponent(id)}`);
      if (stopped) return;
      const amount = state.total === null ? `${state.transferred} bytes` : `${state.transferred} / ${state.total} bytes`;
      update(`${state.phase} · ${amount}`);
    } catch { /* POST may not have registered the transfer yet; its result owns terminal errors. */ }
    if (!stopped) window.setTimeout(() => { void poll(); }, 400);
  };
  void poll();
  return () => { stopped = true; };
}

async function refreshIdentity(): Promise<void> {
  const sequence = ++renderSequence;
  const view = await api<IdentityView>("session");
  if (sequence !== renderSequence) return;
  csrf = view.csrf ?? csrf;
  render(view);
}

function capabilityDiagnostics(signedIn: boolean): HTMLElement {
  const diagnostics = element("section", undefined, "diagnostics");
  const result = element("p", "Core and runtime availability are checked separately.", "muted");
  diagnostics.append(button("Check Core capabilities", async () => {
    result.textContent = "Checking Core, runtime, Service and Files…";
    try {
      const state = await api<{ health: { available: boolean }; readiness: { available: boolean };
        service: { available: boolean; value?: { protocols?: string[] } }; files: { available: boolean; value?: { reason?: string | null } } }>("status");
      if (!diagnostics.isConnected) return;
      result.textContent = `Core ${state.health.available ? "reachable" : "unreachable"}`
        + ` · Runtime ${state.readiness.available ? "responding" : "unavailable"}`
        + ` · Service ${signedIn ? state.service.available ? "available" : "unavailable" : "sign in to check"}`
        + ` · Files ${signedIn ? state.files.available ? "available" : state.files.value?.reason ?? "unavailable" : "sign in to check"}`;
    } catch (error) { if (diagnostics.isConnected) result.textContent = error instanceof Error ? error.message : "Core status unavailable."; }
  }, true), result);
  return diagnostics;
}

function render(view: IdentityView): void {
  if (!app) return;
  if (currentView && (currentView.generation !== view.generation || currentView.coreUrl !== view.coreUrl
    || currentView.user?.id !== view.user?.id && currentView.user && view.user)) {
    const preserveAnonymousInspect = currentView.state === "signed-out" && view.state === "authenticated"
      && currentView.coreUrl === view.coreUrl;
    serviceSelection.clear();
    servicePortSelection.clear();
    chatDraft.clear();
    sessionSelection.clear();
    runSelection.clear();
    chatObserver?.abort();
    chatObserver = undefined;
    leaveCurrentPanel = undefined;
    if (!preserveAnonymousInspect) inspectedPackage = undefined;
    history.replaceState(null, "", "/");
  }
  if (workStatusPoll !== undefined) { clearInterval(workStatusPoll); workStatusPoll = undefined; }
  currentView = view;
  const page = element("div", undefined, "desktop-page");
  const header = element("header", undefined, "desktop-header");
  header.append(element("strong", "Piwork"), element("span", "Desktop", "header-secondary"));
  page.append(header);
  const main = element("main", undefined, "desktop-main");
  page.append(main);
  if (view.state === "authenticated" && view.user) {
    const workId = /^\/works\/([A-Za-z0-9-]+)(?:\/services\/([A-Za-z0-9-]+))?$/.exec(location.pathname)?.[1];
    main.classList.add(workId ? "work-main" : "list-main");
    const workspace = element("div", "Loading Work…", "workspace-content");
    main.append(workspace);
    header.append(element("span", `${view.user.account} · ${view.coreUrl}`, "header-account"), button("Sign out", async () => {
      const sequence = ++renderSequence;
      try {
        const result = await api<IdentityView & { remoteRevocationConfirmed?: boolean; view?: IdentityView }>("logout", "POST");
        if (sequence !== renderSequence) return;
        history.replaceState(null, "", "/");
        render(result.view ?? { coreUrl: view.coreUrl, state: "signed-out", generation: view.generation + 1 });
        if (result.remoteRevocationConfirmed === false) showMessage("Local access ended; remote sign out could not be confirmed.");
      } catch (error) { if (sequence === renderSequence) showMessage(error instanceof Error ? error.message : "Sign out failed."); }
    }, true));
    if (workId) void loadWorkPanel(workspace, workId, view, ++renderSequence);
    else void loadWorkList(workspace, view, ++renderSequence);
    main.append(capabilityDiagnostics(true));
  } else {
    main.append(element("h1", view.state === "offline" ? "Core is unavailable" : "Sign in to Piwork"),
      element("p", view.state === "offline" ? "Your saved session will be checked again when Core responds." : "Use your Core account to open your Works.", "muted"));
    if (view.state === "offline" && view.lastKnownUser && view.lastConfirmedAt)
      main.append(element("p", `Last confirmed: ${view.lastKnownUser.account} at ${new Date(view.lastConfirmedAt).toLocaleString("en-US")}. This is older information.`, "muted"));
    const core = field("Core address", "url", view.coreUrl);
    const account = field("Account", "text");
    const password = field("Password", "password");
    password.input.autocomplete = "current-password";
    const actions = element("div", undefined, "form-actions");
    actions.append(button("Use Core", async () => {
      const sequence = ++renderSequence;
      try { const next = await api<IdentityView>("connection", "PUT", { coreUrl: core.input.value.trim() }); if (sequence === renderSequence) render(next); }
      catch (error) { if (sequence === renderSequence) showMessage(error instanceof Error ? error.message : "Could not change Core."); }
    }, true));
    actions.append(button("Sign in", async () => {
      const sequence = ++renderSequence;
      try {
        if (core.input.value.trim() !== view.coreUrl) await api("connection", "PUT", { coreUrl: core.input.value.trim() });
        const next = await api<IdentityView>("login", "POST", { account: account.input.value, password: password.input.value });
        password.input.value = "";
        if (sequence === renderSequence) render(next);
      } catch (error) { if (sequence === renderSequence) showMessage(error instanceof Error ? error.message : "Sign in failed."); }
    }));
    main.append(core.wrapper, account.wrapper, password.wrapper, actions);
    main.append(button("Inspect .work package", async (trigger) => showImport(main, view.state === "authenticated", trigger), true));
    if (view.error) main.append(element("p", view.error, "error"));
    if (view.state === "offline") main.append(button("Check connection", async () => {
      try { await refreshIdentity(); } catch (error) { showMessage(error instanceof Error ? error.message : "Core is unavailable."); }
    }, true));
    main.append(capabilityDiagnostics(false));
  }
  main.append(element("p", "", "message"));
  app.replaceChildren(page);
}

function navigate(path: string): void {
  if (leaveCurrentPanel && !leaveCurrentPanel()) return;
  leaveCurrentPanel = undefined;
  history.pushState(null, "", path);
  if (currentView) render(currentView);
}

function workState(work: Work): string {
  const observed = work.observedState || "unknown";
  if (work.desiredState === "running" && ["ready", "degraded"].includes(observed)) return observed;
  return work.desiredState && work.desiredState !== observed ? `${observed} · target ${work.desiredState}` : observed;
}

function workAction(work: Work): "start" | "stop" | "retry" | undefined {
  if (work.desiredState === "stopped" && work.observedState === "stopped") return "start";
  if (work.desiredState === "running" && ["failed", "error"].includes(work.observedState)) return "retry";
  if (work.desiredState === "running") return "stop";
  return undefined;
}

function workActionReason(work: Work, action: "start" | "stop" | "retry" | "delete"): string | undefined {
  if (action === "delete") return undefined;
  if (action === "start") return work.desiredState === "stopped" && work.observedState === "stopped"
    ? undefined : "Start is available after Work has fully stopped.";
  if (action === "stop") return work.desiredState === "running" ? undefined : "Work is already targeting stopped. Check the original Stop Operation.";
  return work.desiredState === "running" && ["failed", "error"].includes(work.observedState)
    ? undefined : "Retry is available only for a failed Work whose target is running.";
}

function serviceActionReason(work: Work, service: Service, action: "start" | "stop" | "restart" | "retry" | "remove"): string | undefined {
  if (action === "remove") return undefined;
  if (action === "start") return service.enabled ? "This Service is already enabled." : undefined;
  if (action === "stop") return service.enabled ? undefined : "This Service is already disabled.";
  if (!service.enabled) return "Enable this Service before restarting or retrying it.";
  if (work.desiredState !== "running") return "Start the Work before restarting or retrying this Service.";
  if (action === "retry" && !["failed", "error"].includes(service.observedState))
    return "Retry is available when this Service has failed.";
  return undefined;
}

function watchOperation(root: HTMLElement, operationId: string, label: string,
  onTerminal?: (state: string) => Promise<void>): void {
  const notice = root.querySelector(".operation-notice") ?? root.appendChild(element("div", undefined, "operation-notice"));
  if (typeof operationId !== "string" || !/^[A-Za-z0-9-]{1,128}$/.test(operationId)) {
    notice.textContent = `${label} · the response did not include a usable Operation ID. Check the object state before taking another action; Desktop will not submit it again automatically.`;
    return;
  }
  let observing = true;
  let delay = 250;
  let lastConfirmedAt: string | undefined;
  let checking = false;
  let terminalReported = false;
  const state = element("span", `${label} accepted · Operation ${operationId}. Checking Core…`);
  const stop = button("Stop checking", async () => { observing = false; stop.remove();
    state.textContent += " Automatic checking stopped; the Core operation continues."; }, true);
  const check = async (): Promise<boolean> => {
    if (checking) return false;
    checking = true;
    try {
      const result = await api<{ state?: string; packagePhase?: string; error?: { message?: string; remediation?: string } | null;
        diagnostics?: { rollback?: { state?: string } } }>(`operations/${encodeURIComponent(operationId)}`);
      if (!notice.isConnected || !observing) return true;
      lastConfirmedAt = new Date().toLocaleString("en-US");
      state.textContent = `${label} · ${result.state ?? "unknown"}${result.packagePhase ? ` · ${result.packagePhase}` : ""} · Operation ${operationId} · checked ${lastConfirmedAt}${result.error?.message ? ` · ${result.error.message}` : ""}${result.error?.remediation ? ` · ${result.error.remediation}` : ""}${result.diagnostics?.rollback?.state ? ` · rollback ${result.diagnostics.rollback.state}` : ""}`;
      if (["succeeded", "failed", "superseded"].includes(result.state ?? "")) {
        stop.remove();
        observing = false;
        if (!terminalReported && onTerminal) { terminalReported = true; void onTerminal(result.state!); }
        return true;
      }
      delay = 1000; return false;
    } catch (error) {
      if (!notice.isConnected || !observing) return true;
      if (error instanceof DesktopApiError && [401, 403, 404, 410].includes(error.status)) {
        const reason = error.status === 404 || error.status === 410 ? "Core no longer has this Operation"
          : "Sign in with the original account to check this Operation";
        state.textContent = `${label} · ${reason} · Operation ${operationId}${lastConfirmedAt ? ` · last checked ${lastConfirmedAt}` : ""}. The submitted action was not retried.`;
        stop.remove(); observing = false; return true;
      }
      state.textContent = `${label} · status unavailable for Operation ${operationId}${lastConfirmedAt ? ` · last checked ${lastConfirmedAt}` : " · never confirmed"}: ${error instanceof Error ? error.message : "network error"}. The submitted action is not retried.`;
      delay = Math.min(delay * 2, 5_000);
      return false;
    } finally {
      checking = false;
    }
  };
  const now = button("Check now", async () => { await check(); }, true);
  notice.replaceChildren(state, now, stop);
  void (async () => {
    while (observing && notice.isConnected) {
      if (await check()) return;
      await new Promise((done) => setTimeout(done, document.hidden ? Math.max(delay, 5_000) : delay));
    }
  })();
}

async function performWorkAction(work: Work, action: "start" | "stop" | "retry" | "delete", root: HTMLElement,
  onAccepted?: () => void): Promise<void> {
  const initialReason = workActionReason(work, action);
  if (initialReason) { showNotice(root, initialReason); return; }
  if (action === "stop" && !confirm(`Stop ${work.name}? Active Runs, all Services and Workspace files will become unavailable until you start this Work again.`)) return;
  if (action === "delete" && !confirm(`Delete ${work.name}? It will leave your Work List. Core keeps persistent data by default; Desktop cannot undo this action.`)) return;
  const notice = root.querySelector(".operation-notice") ?? root.appendChild(element("div", undefined, "operation-notice"));
  notice.textContent = `${action} ${work.name}: checking current state…`;
  try {
    const current = await api<Work>(`works/${encodeURIComponent(work.id)}`);
    const currentReason = workActionReason(current, action);
    if (currentReason) { notice.textContent = currentReason; return; }
    notice.textContent = `${action} ${work.name}: submitting…`;
    const accepted = await api<{ operationId: string; workId: string }>(`works/${encodeURIComponent(work.id)}/${action}`, "POST");
    watchOperation(root, accepted.operationId, `${action} ${work.name}`);
    if (typeof accepted.operationId === "string" && /^[A-Za-z0-9-]{1,128}$/.test(accepted.operationId)) onAccepted?.();
  } catch (error) { notice.textContent = `${work.name}: ${error instanceof Error ? error.message : "Request failed; result unknown."}`; }
}

async function loadWorkList(root: HTMLElement, view: IdentityView, sequence: number): Promise<void> {
  const heading = element("div", undefined, "page-heading");
  const titles = element("div");
  titles.append(element("h1", "Your Works"), element("p", `Signed in as ${view.user?.account} · Core ${view.coreUrl}`, "muted"));
  const actions = element("div", undefined, "toolbar-actions");
  actions.append(button("New Work", async (trigger) => showCreateWork(root, trigger), false),
    button("Import .work", async (trigger) => showImport(root, true, trigger), true));
  heading.append(titles, actions);
  const search = field("Search Works", "search");
  const operation = field("Operation ID", "text");
  const operationResult = element("div", undefined, "operation-result");
  const operationLookup = element("div", undefined, "operation-lookup");
  operationLookup.append(operation.wrapper, button("Check Operation", async () => {
    const id = operation.input.value.trim();
    if (!/^[A-Za-z0-9-]{1,128}$/.test(id)) { operationResult.textContent = "Enter a complete Operation ID."; return; }
    try {
      const result = await api<{ state?: string; kind?: string; workId?: string; error?: { message?: string } }>(`operations/${encodeURIComponent(id)}`);
      operationResult.textContent = `Operation ${id} · ${result.kind ?? "Work action"} · ${result.state ?? "unknown"}${result.workId ? ` · Work ${result.workId}` : ""}${result.error?.message ? ` · ${result.error.message}` : ""}`;
    } catch (error) { operationResult.textContent = `Operation ${id}: ${error instanceof Error ? error.message : "Could not check status."}`; }
  }, true), operationResult);
  const snapshot = field("Snapshot ID", "text");
  operationLookup.append(snapshot.wrapper, button("Prepare original Snapshot", async () => {
    const id = snapshot.input.value.trim();
    if (!/^[A-Za-z0-9-]{1,128}$/.test(id)) { operationResult.textContent = "Enter a complete Snapshot ID."; return; }
    await prepareSnapshot(root, id, "work");
  }, true));
  const list = element("div", "Loading Work List…", "work-list");
  const known = element("section", undefined, "known-operations");
  root.replaceChildren(heading, search.wrapper, list, operationLookup, known);
  void api<{ operations: { operationId: string; type: string; recordedAt: string; workId?: string; snapshotId?: string }[] }>("known-operations")
    .then((result) => {
      if (sequence !== renderSequence || !known.isConnected) return;
      known.replaceChildren(element("h2", "Known activity"), element("p", "This computer remembers accepted Operations. Check Core for the current result; this is not a global history.", "muted"));
      for (const item of result.operations.slice(0, 30)) {
        const row = element("div", undefined, "known-row");
        const summary = element("span", `${item.type} · ${item.operationId} · checking Core…`, "mono");
        const check = async () => {
          try {
            const state = await api<{ state?: string; error?: { message?: string } }>(`operations/${item.operationId}`);
            summary.textContent = `${item.type} · ${item.operationId} · ${state.state ?? "unknown"}${state.error?.message ? ` · ${state.error.message}` : ""}`;
          } catch (error) { summary.textContent = `${item.type} · ${item.operationId} · status unavailable: ${error instanceof Error ? error.message : "unknown"}`; }
        };
        row.append(summary, button("Check", check, true));
        if (item.snapshotId) row.append(button("Prepare Snapshot", async () => prepareSnapshot(root, item.snapshotId!, item.workId ?? "work"), true));
        row.append(button("Hide locally", async () => {
          await api(`known-operations/${item.operationId}`, "DELETE"); row.remove();
        }, true));
        known.append(row);
        void check();
      }
      if (!result.operations.length) known.append(element("p", "No Operations recorded on this computer yet.", "muted"));
    }, () => { if (sequence === renderSequence) known.textContent = "Known activity could not load. You can still check an Operation by ID above."; });
  try {
    const result = await api<{ works: Work[] }>("works");
    if (sequence !== renderSequence || !root.isConnected) return;
    const draw = () => {
      list.replaceChildren();
      const items = result.works.filter((work) => `${work.name} ${work.id}`.toLowerCase().includes(search.input.value.toLowerCase()));
      if (!items.length) { list.append(element("p", result.works.length ? "No Works match this search." : "No Works yet. Create one to start a task.", "empty-state")); return; }
      for (const work of items) {
        const row = element("div", undefined, "work-row");
        const title = element("button", work.name, "row-link");
        title.type = "button"; title.onclick = () => navigate(`/works/${encodeURIComponent(work.id)}`);
        const identity = element("div", undefined, "work-identity");
        identity.append(title, element("small", work.id, "mono muted"));
        const state = element("span", workState(work), "work-state");
        state.dataset.state = work.observedState;
        const quick = workAction(work);
        const quickButton = quick ? button(`${quick[0]!.toUpperCase()}${quick.slice(1)} Work`, async () => performWorkAction(work, quick, root), true)
          : button("Open Work", async () => { navigate(`/works/${encodeURIComponent(work.id)}`); }, true);
        const { container: menu } = createMenu("More actions");
        const choices = element("div", undefined, "menu-items");
        for (const action of ["start", "stop", "retry", "delete"] as const) {
          const control = button(`${action[0]!.toUpperCase()}${action.slice(1)} Work`, async () => {
            menu.open = false;
            await performWorkAction(work, action, root, action === "delete" ? () => {
              row.remove();
              if (!list.querySelector(".work-row")) list.append(element("p", "No Works visible. Reload to confirm the current list.", "empty-state"));
            } : undefined);
          }, true);
          const reason = workActionReason(work, action);
          if (reason) { control.disabled = true; control.title = reason; }
          choices.append(control);
        }
        menu.append(choices);
        row.append(identity, state, quickButton, menu);
        list.append(row);
      }
    };
    search.input.oninput = draw;
    draw();
  } catch (error) {
    if (sequence === renderSequence) list.textContent = `Work List could not load: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

function showNotice(root: HTMLElement, message: string): void {
  const notice = root.querySelector(".operation-notice") ?? root.appendChild(element("div", undefined, "operation-notice"));
  notice.textContent = message;
}

async function showCreateWork(root: HTMLElement, opener: HTMLElement): Promise<void> {
  const existing = root.querySelector(".create-work");
  if (existing) { existing.remove(); return; }
  const form = element("form", undefined, "create-work");
  const close = () => { form.remove(); if (opener?.isConnected) opener.focus(); };
  form.onkeydown = (event) => { if (event.key === "Escape") { event.preventDefault(); close(); } };
  const name = field("Work name", "text");
  name.input.required = true; name.input.maxLength = 128;
  const image = field("Base image catalog ID (optional)", "text");
  const advanced = element("details");
  advanced.append(element("summary", "Advanced creation"));
  const skills = field("Skill names (comma separated; blank uses Core defaults)", "text");
  const noSkills = element("input") as HTMLInputElement; noSkills.type = "checkbox";
  noSkills.onchange = () => { skills.input.disabled = noSkills.checked; };
  const noSkillsLabel = element("label", "Select no Skills"); noSkillsLabel.prepend(noSkills);
  const packages = field("Pi Package names (comma separated; blank uses Core defaults)", "text");
  const noPackages = element("input") as HTMLInputElement; noPackages.type = "checkbox";
  noPackages.onchange = () => { packages.input.disabled = noPackages.checked; };
  const noPackagesLabel = element("label", "Select no Pi Packages"); noPackagesLabel.prepend(noPackages);
  const agents = element("textarea") as HTMLTextAreaElement; agents.setAttribute("aria-label", "AGENTS.md content");
  const config = element("textarea") as HTMLTextAreaElement; config.setAttribute("aria-label", "Full configuration JSON");
  advanced.append(skills.wrapper, noSkillsLabel, packages.wrapper, noPackagesLabel, element("label", "AGENTS.md content"), agents,
    element("label", "Full configuration JSON (optional)"), config);
  const submit = element("button", "Create Work", "primary") as HTMLButtonElement; submit.type = "submit";
  const cancel = button("Cancel", async () => { close(); }, true);
  form.append(element("h2", "New Work"), name.wrapper, image.wrapper, advanced, submit, cancel, element("p", "", "form-error"));
  form.onsubmit = (event) => {
    event.preventDefault(); submit.disabled = true;
    void (async () => {
      try {
        const payload: Record<string, unknown> = { name: name.input.value.trim() };
        if (image.input.value.trim()) payload.baseImage = image.input.value.trim();
        if (noSkills.checked) payload.skills = [];
        else if (skills.input.value.trim()) payload.skills = skills.input.value.split(",").map((item) => item.trim()).filter(Boolean);
        if (noPackages.checked) payload.packages = [];
        else if (packages.input.value.trim()) payload.packages = packages.input.value.split(",").map((item) => ({ name: item.trim(), enabled: true }));
        if (agents.value) payload.agentsMd = agents.value;
        if (config.value.trim()) payload.configuration = JSON.parse(config.value);
        const accepted = await api<{ workId: string; operationId: string }>("works", "POST", payload);
        close();
        watchOperation(root, accepted.operationId, `Create Work ${name.input.value.trim()} · Work ${accepted.workId}`);
      } catch (error) { form.querySelector(".form-error")!.textContent = error instanceof Error ? error.message : "Could not create Work."; }
      finally { submit.disabled = false; }
    })();
  };
  root.prepend(form); name.input.focus();
}

function showImport(root: HTMLElement, signedIn: boolean, opener: HTMLElement): void {
  const existing = root.querySelector(".import-work");
  if (existing) { existing.remove(); return; }
  const section = element("section", undefined, "import-work");
  let importAccepted = false;
  let submitting = false;
  let inspecting: AbortController | undefined;
  const close = async () => {
    if (submitting) { status.textContent = "Import submission is in progress. Wait for its result before closing this review."; return; }
    inspecting?.abort();
    if (inspectedPackage) {
      await api(`work-packages/${inspectedPackage.transferId}`, "DELETE").catch(() => undefined);
      inspectedPackage = undefined;
    }
    section.remove();
    if (opener?.isConnected) opener.focus();
  };
  section.onkeydown = (event) => { if (event.key === "Escape") { event.preventDefault(); void close(); } };
  const file = element("input") as HTMLInputElement;
  file.type = "file"; file.accept = ".work,application/vnd.piwork.work-package";
  file.setAttribute("aria-label", "Select .work package");
  const summary = element("div", undefined, "package-summary");
  const status = element("p", "", "import-status");
  const outcome = element("div", undefined, "import-outcome");
  const name = field("Imported Work name (optional)", "text");
  name.input.oninput = () => name.input.setCustomValidity("");
  const review = () => {
    summary.replaceChildren();
    if (!inspectedPackage) return;
    const value = inspectedPackage.summary;
    summary.append(element("p", `Format ${String(value.formatVersion ?? "unknown")} · ${String(value.size ?? "unknown")} bytes · integrity verified`, "muted"),
      element("p", String(value.warning ?? "This package may contain private Work data and credentials."), "warning"));
    const requirements = value.bindingRequirements as { models?: unknown[]; secrets?: unknown[] } | undefined;
    if (requirements) summary.append(element("p", `Bindings: ${requirements.models?.length ?? 0} model(s), ${requirements.secrets?.length ?? 0} secret(s).`, "muted"));
    if (signedIn) summary.append(name.wrapper, button("Import inspected package", async () => {
      if (!inspectedPackage || importAccepted) return;
      submitting = true;
      status.textContent = "Uploading the checked package to Core, then submitting Import…";
      const stopProgress = watchTransfer(inspectedPackage.transferId, "work-packages", (value) => { if (section.isConnected) status.textContent = value; });
      try {
        const accepted = await api<{ workId: string; operationId: string; name: string }>("work-imports", "POST",
          { transferId: inspectedPackage.transferId, ...(name.input.value.trim() ? { name: name.input.value.trim() } : {}) });
        importAccepted = true;
        status.textContent = `Import accepted · ${accepted.name} · Work ${accepted.workId} · Operation ${accepted.operationId}. Waiting for Core to finish; the Work is not ready yet.`;
        watchOperation(root, accepted.operationId, `Import ${accepted.name}`, async (state) => {
          if (!section.isConnected) return;
          if (state !== "succeeded") {
            outcome.textContent = `Import ${state}. Check Operation ${accepted.operationId} for the cause. No new Work is shown as ready.`;
            return;
          }
          try {
            const work = await api<Work>(`works/${encodeURIComponent(accepted.workId)}`);
            if (!section.isConnected) return;
            if (work.desiredState !== "stopped" || work.observedState !== "stopped") {
              outcome.textContent = `Import Operation ${accepted.operationId} succeeded, but the stopped Work state is not confirmed. Check Work ${accepted.workId} before starting.`;
              return;
            }
            outcome.replaceChildren(element("p", `${work.name} imported · stopped · Work ${work.id}. Open it to inspect, or start it as a separate action.`),
              button("Open Work", async () => { await close(); navigate(`/works/${encodeURIComponent(work.id)}`); }, true),
              button("Start Work", async () => performWorkAction(work, "start", root), true));
          } catch (error) {
            outcome.textContent = `Import Operation ${accepted.operationId} succeeded, but Work ${accepted.workId} could not be checked: ${error instanceof Error ? error.message : "unknown error"}. Check the original Work ID.`;
          }
        });
      } catch (error) {
        if (error instanceof DesktopApiError && error.code === "WORK_NAME_CONFLICT") {
          name.input.setCustomValidity("This Work name is already in use. Enter another name, or leave it blank for Core to choose.");
          name.input.reportValidity();
          status.textContent = name.input.validationMessage;
        } else status.textContent = error instanceof Error ? error.message : "Import result unknown. Check the original Operation before retrying.";
      }
      finally { stopProgress(); submitting = false; }
    }));
    else summary.append(element("p", "Sign in to a Core account to import this checked package.", "muted"));
  };
  review();
  section.append(element("h2", "Inspect .work package"),
    element("p", "A .work package contains complete private Work data and may include credentials. It will be staged on this computer while Desktop runs.", "warning"),
    file, button("Inspect package", async () => {
      if (importAccepted) { status.textContent = "An Import was already accepted. Check its original Operation."; return; }
      const chosen = file.files?.[0]; if (!chosen) { status.textContent = "Choose a .work file first."; return; }
      const transferId = crypto.randomUUID();
      inspecting = new AbortController();
      status.textContent = "Receiving and validating package…";
      const stopProgress = watchTransfer(transferId, "work-packages", (value) => { if (section.isConnected) status.textContent = value; });
      try {
        const response = await fetch("/_desktop/api/work-packages", { method: "POST", credentials: "same-origin",
          headers: { "x-piwork-csrf": csrf, "x-piwork-transfer-id": transferId,
            "content-type": "application/vnd.piwork.work-package" }, body: chosen, signal: inspecting.signal });
        const result = await response.json() as { transferId?: string; summary?: Record<string, unknown>; message?: string };
        if (!response.ok || !result.transferId || !result.summary) throw new Error(result.message ?? `Inspect failed (${response.status})`);
        if (inspectedPackage) void api(`work-packages/${inspectedPackage.transferId}`, "DELETE").catch(() => undefined);
        inspectedPackage = { transferId: result.transferId, summary: result.summary };
        status.textContent = "Package verified. Review the summary before importing."; review();
      } catch (error) { if (section.isConnected) status.textContent = error instanceof Error ? error.message : "Package inspection failed."; }
      finally { stopProgress(); inspecting = undefined; }
    }), button("Close review", close, true), summary, status, outcome);
  root.prepend(section);
}

async function loadWorkPanel(root: HTMLElement, workId: string, view: IdentityView, sequence: number): Promise<void> {
  if (workStatusPoll !== undefined) { clearInterval(workStatusPoll); workStatusPoll = undefined; }
  root.replaceChildren(element("p", "Loading Work…", "muted"));
  const popout = new URL(location.href).searchParams.get("pop") === "1";
  let work: Work;
  try { work = await api<Work>(`works/${encodeURIComponent(workId)}`); }
  catch (error) {
    if (sequence === renderSequence) root.replaceChildren(element("h1", "Work unavailable"),
      element("p", `Work ${workId} · ${error instanceof Error ? error.message : "Unknown error"}`),
      button("Back to Works", async () => navigate("/"), true));
    return;
  }
  if (sequence !== renderSequence || !root.isConnected) return;
  root.classList.toggle("popout", popout);
  const identity = element("div", undefined, "work-panel-header");
  const back = button(popout ? "Back to Work" : "All Works", async () => navigate(popout ? `/works/${encodeURIComponent(workId)}` : "/"), true);
  const title = element("div"); title.append(element("h1", work.name), element("p", `${workState(work)} · ${work.id}`, "muted mono"));
  const controls = element("div", undefined, "toolbar-actions");
  const action = workAction(work);
  if (action) controls.append(button(`${action[0]!.toUpperCase()}${action.slice(1)} Work`, async () => performWorkAction(work, action, root), action !== "start"));
  if (work.desiredState === "stopped" && work.observedState === "stopped")
    controls.append(button("Prepare .work package", async () => prepareExport(root, work), true));
  const { container: lifecycle } = createMenu("More Work actions");
  const lifecycleChoices = element("div", undefined, "menu-items");
  for (const choice of ["start", "stop", "retry", "delete"] as const) {
    const control = button(`${choice[0]!.toUpperCase()}${choice.slice(1)} Work`, async () => {
      lifecycle.open = false;
      await performWorkAction(work, choice, root, choice === "delete" ? () => {
        leaveCurrentPanel = undefined;
        navigate("/");
      } : undefined);
    }, true);
    const reason = workActionReason(work, choice);
    if (reason) { control.disabled = true; control.title = reason; }
    lifecycleChoices.append(control);
  }
  lifecycle.append(lifecycleChoices);
  controls.append(lifecycle);
  controls.append(button("Refresh Work", async () => {
    if (leaveCurrentPanel && !leaveCurrentPanel()) return;
    leaveCurrentPanel = undefined;
    await loadWorkPanel(root, workId, view, ++renderSequence);
  }, true));
  identity.append(back, title, controls);
  const nav = element("nav", undefined, "work-tabs");
  const content = element("div", undefined, "work-content");
  const tabs = ["Services", "Files", "Chat", "Settings"] as const;
  const selected = new URL(location.href).searchParams.get("tab") ?? "Services";
  const requestedService = /^\/works\/[^/]+\/services\/([A-Za-z0-9-]+)$/.exec(location.pathname)?.[1];
  if (requestedService) serviceSelection.set(workId, requestedService);
  const display = (tab: typeof tabs[number]) => {
    if (leaveCurrentPanel && !leaveCurrentPanel()) return;
    leaveCurrentPanel = undefined;
    const tabSequence = ++renderSequence;
    content.replaceChildren();
    for (const item of nav.querySelectorAll("button")) item.setAttribute("aria-current", item.textContent === tab ? "page" : "false");
    const url = new URL(location.href); if (tab === "Services") url.searchParams.delete("tab"); else url.searchParams.set("tab", tab);
    history.replaceState(null, "", url.pathname + url.search);
    if (work.desiredState !== "running" && tab !== "Settings") {
      const state = element("section", undefined, "empty-state");
      const stopped = work.observedState === "stopped";
      state.append(element("h2", stopped ? "Work is stopped" : work.observedState === "failed" ? "Stop was not confirmed" : "Work is stopping"),
        element("p", stopped
          ? "Service previews, conversation and Workspace files need a running Work. Saved Service definitions remain manageable below."
          : "Service previews, conversation and Workspace files are unavailable. Check the original Stop Operation and refresh the Work state before continuing."));
      content.append(state);
      if (tab === "Services") void showStoppedServices(content, work, tabSequence);
      return;
    }
    if (tab === "Services") void showServices(content, work, tabSequence);
    else if (tab === "Chat") void showChat(content, work, tabSequence, false);
    else if (tab === "Files") void showFiles(content, work, tabSequence);
    else void showSettings(content, work, tabSequence);
  };
  for (const tab of tabs) {
    const control = button(tab, async () => display(tab), true);
    nav.append(control);
  }
  root.replaceChildren(identity, nav, content, element("div", undefined, "operation-notice"));
  display(popout ? "Services" : tabs.includes(selected as typeof tabs[number]) ? selected as typeof tabs[number] : "Services");
  if (popout) workStatusPoll = window.setInterval(() => {
    if (!root.isConnected) {
      if (workStatusPoll !== undefined) clearInterval(workStatusPoll);
      workStatusPoll = undefined;
      return;
    }
    void api<Work>(`works/${encodeURIComponent(workId)}`).then((current) => {
      if (!root.isConnected || currentView?.generation !== view.generation) return;
      if (current.desiredState !== work.desiredState || current.observedState !== work.observedState)
        void loadWorkPanel(root, workId, view, ++renderSequence);
    }, (error) => {
      if (root.isConnected && error instanceof DesktopApiError && [404, 410].includes(error.status))
        void loadWorkPanel(root, workId, view, ++renderSequence);
    });
  }, 1_000);
}

async function prepareExport(root: HTMLElement, work: Work): Promise<void> {
  const notice = root.querySelector(".operation-notice") ?? root.appendChild(element("div", undefined, "operation-notice"));
  notice.textContent = `Checking stopped Work ${work.name} before Export…`;
  let accepted: { operationId: string; snapshotId: string } | undefined;
  try {
    const current = await api<Work>(`works/${work.id}`);
    if (current.desiredState !== "stopped" || current.observedState !== "stopped") {
      notice.textContent = `Stop ${work.name} and wait for the confirmed stopped state before Export.`; return;
    }
    accepted = await api<{ operationId: string; snapshotId: string }>(`works/${work.id}/exports`, "POST");
    notice.textContent = `Export accepted · Operation ${accepted.operationId} · Snapshot ${accepted.snapshotId}. Waiting for the original snapshot…`;
    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise((done) => setTimeout(done, 1000));
      if (!notice.isConnected) return;
      const operation = await api<{ state?: string; error?: { message?: string } }>(`operations/${accepted.operationId}`);
      if (operation.state === "succeeded") return prepareSnapshot(root, accepted.snapshotId, work.name);
      if (operation.state === "failed" || operation.state === "superseded") {
        notice.textContent = `Export ${operation.state} · Operation ${accepted.operationId} · ${operation.error?.message ?? "Check the original Operation."}`; return;
      }
      notice.textContent = `Export ${operation.state ?? "running"} · Operation ${accepted.operationId} · Snapshot ${accepted.snapshotId}.`;
    }
    notice.textContent = `Export still running or status unknown · Operation ${accepted.operationId} · Snapshot ${accepted.snapshotId}. Check the original IDs; do not resubmit automatically.`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Could not confirm.";
    notice.textContent = accepted
      ? `Export status unavailable · Operation ${accepted.operationId} · Snapshot ${accepted.snapshotId}. ${reason} Check these original IDs; do not resubmit automatically.`
      : error instanceof DesktopApiError
        ? `Core rejected Export: ${reason}. Resolve the conflict and check the stopped Work before trying again.`
        : `Export submission result unknown: ${reason} Check Work and known Operations before trying again.`;
  }
}

async function prepareSnapshot(root: HTMLElement, snapshotId: string, workName: string): Promise<void> {
  const notice = root.querySelector(".operation-notice") ?? root.appendChild(element("div", undefined, "operation-notice"));
  notice.textContent = `Preparing original Snapshot ${snapshotId} for download…`;
  const transferId = crypto.randomUUID();
  const stopProgress = watchTransfer(transferId, "downloads", (value) => {
    if (notice.isConnected) notice.textContent = `Preparing Snapshot ${snapshotId} · ${value}`;
  });
  try {
    const prepared = await api<{ transferId: string; size: number }>(`work-snapshots/${encodeURIComponent(snapshotId)}/downloads`, "POST", undefined,
      { "x-piwork-transfer-id": transferId });
    const link = element("a", "Download .work package");
    link.href = `/_desktop/api/downloads/${encodeURIComponent(prepared.transferId)}/content`;
    link.download = `${workName}.work`;
    link.onclick = () => { notice.prepend(element("span", "Download started. Check your browser downloads. ")); };
    notice.replaceChildren(element("span", `Snapshot ${snapshotId} verified · ${prepared.size} bytes. This package may contain private Work data. `),
      link, button("Prepare original Snapshot again", async () => prepareSnapshot(root, snapshotId, workName), true));
  } catch (error) {
    const expired = error instanceof DesktopApiError && [404, 410].includes(error.status);
    notice.textContent = expired
      ? `Snapshot ${snapshotId} has expired or is unavailable. Return to the stopped Work and choose Prepare .work package again if you still need a new Export.`
      : `Snapshot ${snapshotId} could not be prepared: ${error instanceof Error ? error.message : "Unknown error"}. Retry this same snapshot ID when ready.${error instanceof DesktopApiError && error.status === 507 ? " You can also use the CLI snapshot download command with another local destination." : ""}`;
  } finally { stopProgress(); }
}

async function showServices(root: HTMLElement, work: Work, sequence: number): Promise<void> {
  root.replaceChildren(element("p", "Loading Services…", "muted"));
  try {
    const result = await api<{ services: Service[] }>(`works/${encodeURIComponent(work.id)}/services`);
    if (sequence !== renderSequence || !root.isConnected) return;
    const services = result.services;
    const selectable = services.filter((service) => service.access.ports.length > 0 && service.access.status === "available");
    const selectedId = serviceSelection.get(work.id);
    const selected = selectable.find((service) => service.serviceId === selectedId) ?? selectable[0];
    if (selected) serviceSelection.set(work.id, selected.serviceId);
    const serviceArea = element("div", undefined, "service-area");
    const toolbar = element("div", undefined, "service-toolbar");
    const manager = element("section", undefined, "service-manager");
    let previewSequence = 0;
    const renderSelected = async (service: Service): Promise<void> => {
      previewSequence++;
      serviceSelection.set(work.id, service.serviceId);
      toolbar.replaceChildren(); serviceArea.replaceChildren(element("p", "Opening Service…", "muted"));
      const picker = element("select"); picker.setAttribute("aria-label", "Choose Service");
      picker.classList.add("service-picker");
      for (const candidate of services) {
        const option = element("option", candidate.name); option.value = candidate.serviceId; option.selected = candidate.serviceId === service.serviceId; picker.append(option);
      }
      picker.onchange = () => {
        const next = services.find((item) => item.serviceId === picker.value);
        if (next && next.serviceId !== service.serviceId) void renderSelected(next);
      };
      const domainText = element("span", `Service domain · ${service.access.hostname}`, "mono service-domain");
      const domain = button("Copy domain", async () => {
        await navigator.clipboard.writeText(service.access.hostname); showMessage("Core Service domain copied. Browser access uses a separate local link.");
      }, true);
      domain.classList.add("service-copy-domain");
      domain.setAttribute("aria-label", `Copy Core domain ${service.access.hostname}`);
      toolbar.append(picker, domainText, domain);
      if (!service.access.ports.length) {
        serviceArea.replaceChildren(element("p", "This Service has no declared Web port. Choose another Service or inspect its details.", "empty-state"));
        return;
      }
      const port = element("select"); port.setAttribute("aria-label", "Web port");
      port.classList.add("service-port");
      const portKey = `${work.id}:${service.serviceId}`;
      const queryPort = Number(new URL(location.href).searchParams.get("port"));
      const rememberedPort = servicePortSelection.get(portKey);
      const initialPort = service.access.ports.some((candidate) => candidate.port === queryPort)
        && /^\/works\/[^/]+\/services\//.test(location.pathname) && serviceSelection.get(work.id) === service.serviceId
        ? queryPort : service.access.ports.some((candidate) => candidate.port === rememberedPort) ? rememberedPort : undefined;
      const defaultPort = service.access.ports.find((candidate) => candidate.name === service.access.defaultPortName)
        ?? service.access.ports.find((candidate) => candidate.url === service.access.defaultUrl)
        ?? service.access.ports[0]!;
      for (const candidate of service.access.ports) {
        const option = element("option", `${candidate.name} · ${candidate.port}`); option.value = String(candidate.port);
        option.selected = candidate.port === (initialPort ?? defaultPort.port);
        port.append(option);
      }
      servicePortSelection.set(portKey, Number(port.value));
      toolbar.append(port);
      const open = async (): Promise<{ entryUrl: string; origin: string; entryId: string }> => api(`service-entries`, "POST",
        { workId: work.id, serviceId: service.serviceId, port: Number(port.value) });
      const preview = async () => {
        const requestSequence = ++previewSequence;
        serviceArea.replaceChildren(element("p", "Checking Service access…", "muted"));
        try {
          const entry = await open();
          if (sequence !== renderSequence || requestSequence !== previewSequence || !serviceArea.isConnected
            || serviceSelection.get(work.id) !== service.serviceId) return;
          const frame = element("iframe"); frame.title = `${service.name} Service preview`;
          frame.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin allow-downloads allow-popups");
          frame.src = entry.entryUrl;
          const hint = element("p", "Preview loading is not proof that the application accepted embedding. If it stays blank, open the Service in a tab.", "muted preview-hint");
          const direct = button("Open application tab", async () => {
            const popup = window.open("about:blank", "_blank");
            if (!popup) { showMessage("Browser blocked the new tab. Allow a popup for this click and retry."); return; }
            popup.opener = null;
            try { popup.location.href = (await open()).entryUrl; }
            catch (error) { popup.close(); showMessage(error instanceof Error ? error.message : "Service unavailable."); }
          }, true);
          hint.append(direct);
          serviceArea.replaceChildren(frame, hint);
          setTimeout(() => { void (async () => {
            try {
              const state = await api<{ embed: string }>(`service-entries/${entry.entryId}`);
              if (sequence !== renderSequence || !hint.isConnected || serviceSelection.get(work.id) !== service.serviceId) return;
              if (state.embed === "blocked") {
                hint.replaceChildren(element("span", "This Service prevents embedding. Open its application in a separate tab. "), direct);
              }
            } catch { /* Preview remains unconfirmed; the direct action is still available from the toolbar. */ }
          })(); }, 900);
        } catch (error) {
          if (requestSequence !== previewSequence || !serviceArea.isConnected) return;
          serviceArea.replaceChildren(element("p", `Service access unavailable: ${error instanceof Error ? error.message : "Unknown error"}`, "error"),
            button("Retry preview", preview, true));
        }
      };
      port.onchange = () => { servicePortSelection.set(portKey, Number(port.value)); void preview(); };
      const refreshPreview = button("Open Service", preview, true);
      refreshPreview.classList.add("service-refresh-preview");
      const popoutService = button("Open in new tab", async () => {
          const url = `/works/${encodeURIComponent(work.id)}/services/${encodeURIComponent(service.serviceId)}?pop=1&port=${port.value}`;
          window.open(url, "_blank", "noopener");
        });
      popoutService.classList.add("service-popout");
      const localLink = button("Copy local link", async () => {
          const url = `${location.origin}/works/${encodeURIComponent(work.id)}/services/${encodeURIComponent(service.serviceId)}?port=${port.value}`;
          await navigator.clipboard.writeText(url);
          showMessage("Local Service link copied. It works only on this computer while Desktop is running and signed in.");
        }, true);
      localLink.classList.add("service-copy-link");
      toolbar.append(refreshPreview, popoutService, localLink);
      await preview();
    };
    if (selected) {
      const layout = element("div", undefined, "work-split");
      const primary = element("div", undefined, "work-primary"); primary.append(toolbar, serviceArea);
      const chat = element("aside", undefined, "agent-aside");
      layout.append(primary, chat);
      root.replaceChildren(layout);
      void showChat(chat, work, sequence, true);
      void renderSelected(selected);
    } else {
      const empty = element("section", undefined, "empty-state service-empty");
      empty.append(element("h2", "No Web Service is available"),
        element("p", "You can still talk with Agent. Services without a Web port remain manageable below."));
      const chat = element("section", undefined, "chat-focus");
      root.replaceChildren(empty, chat);
      void showChat(chat, work, sequence, false);
    }
    manager.append(element("h2", "Manage Services"));
    for (const service of services) {
      const row = element("div", undefined, "service-row");
      row.append(element("span", `${service.name} · ${service.observedState}${service.enabled ? "" : " · disabled"}`));
      row.append(button("Details", async () => showServiceDetails(root, work, service, sequence), true));
      manager.append(row);
    }
    if (!services.length) manager.append(element("p", "No Services have been created in this Work.", "muted"));
    root.append(manager);
  } catch (error) { if (sequence === renderSequence) root.textContent = `Services unavailable: ${error instanceof Error ? error.message : "Unknown error"}`; }
}

async function showStoppedServices(root: HTMLElement, work: Work, sequence: number): Promise<void> {
  const notice = () => {
    const state = element("section", undefined, "empty-state");
    const stopped = work.observedState === "stopped";
    state.append(element("h2", stopped ? "Work is stopped" : work.observedState === "failed" ? "Stop was not confirmed" : "Work is stopping"),
      element("p", stopped
        ? "Service definitions remain available. Enabling one does not start this Work."
        : "Service definitions remain available. Check the original Stop Operation and refresh the Work state before continuing."));
    return state;
  };
  root.replaceChildren(notice(), element("p", "Loading saved Services…", "muted"));
  try {
    const result = await api<{ services: Service[] }>(`works/${encodeURIComponent(work.id)}/services`);
    if (sequence !== renderSequence || !root.isConnected) return;
    const list = element("section", undefined, "service-manager");
    list.append(element("h2", "Saved Services"));
    for (const service of result.services) {
      const row = element("div", undefined, "service-row");
      row.append(element("span", `${service.name} · ${service.observedState}${service.enabled ? "" : " · disabled"}`),
        button("Details", async () => showServiceDetails(root, work, service, sequence), true));
      list.append(row);
    }
    if (!result.services.length) list.append(element("p", "No Services have been created in this Work.", "muted"));
    root.replaceChildren(notice(), list);
  } catch (error) {
    if (sequence === renderSequence) root.append(element("p", `Saved Services unavailable: ${error instanceof Error ? error.message : "Unknown error"}`, "error"));
  }
}

async function showServiceDetails(root: HTMLElement, work: Work, service: Service, sequence: number): Promise<void> {
  root.replaceChildren();
  const section = element("section", undefined, "detail-panel");
  section.append(button("Back to Services", async () => work.desiredState === "running"
    ? showServices(root, work, sequence) : showStoppedServices(root, work, sequence), true),
    element("h2", service.name), element("p", `${service.observedState} · ${service.enabled ? "enabled" : "disabled"}`),
    element("p", `Service domain · ${service.access.hostname}`, "mono"),
    element("p", service.access.ports.length ? `Declared Web ports: ${service.access.ports.map((port) => `${port.name} ${port.port}`).join(", ")}`
      : "No declared Web port. This Service can still be managed.", "muted"));
  if (work.desiredState !== "running") section.append(element("p", work.observedState === "stopped"
    ? "This Work is stopped. Enabling a Service does not start the Work."
    : "Work shutdown is not confirmed. Check the original Stop Operation before continuing.", "muted"));
  if (service.lastError?.message) section.append(element("p", service.lastError.message, "error"));
  section.append(button("Refresh Service", async () => {
    try { const current = await api<Service>(`works/${work.id}/services/${service.serviceId}`);
      await showServiceDetails(root, work, current, sequence); }
    catch (error) { showNotice(root, error instanceof Error ? error.message : "Service unavailable."); }
  }, true));
  for (const action of ["start", "stop", "restart", "retry", "remove"] as const) {
    const control = button(`${action[0]!.toUpperCase()}${action.slice(1)} Service`, async () => {
      if (["stop", "remove"].includes(action) && !confirm(`${action} ${service.name}? This changes the Service state in ${work.name}. Shared Workspace files remain.`)) return;
      try {
        const accepted = await api<{ operationId?: string }>(`works/${work.id}/services/${service.serviceId}/${action}`, "POST");
        if (accepted.operationId) watchOperation(root, accepted.operationId, `${action} ${service.name}`);
        else showNotice(root, `${action} ${service.name} accepted without an Operation ID. Check Service state before another action.`);
      } catch (error) { showNotice(root, error instanceof Error ? error.message : "Service action failed."); }
    }, true);
    const reason = serviceActionReason(work, service, action);
    if (reason) { control.disabled = true; control.title = reason; }
    section.append(control);
  }
  const logMeta = element("p", "Logs not loaded. Use Refresh logs for a bounded snapshot.", "muted");
  const log = element("pre", "", "service-log");
  section.append(button("Refresh logs", async () => {
    try { const data = await api<{ text: string; status: string; truncated: boolean; collectedAt: string; reason?: string }>(`works/${work.id}/services/${service.serviceId}/logs?tailLines=100`);
      logMeta.textContent = `Logs ${data.status} · collected ${new Date(data.collectedAt).toLocaleString("en-US")}`
        + `${data.truncated ? " · truncated to recent content" : ""}${data.reason ? ` · ${data.reason}` : ""}. This is a snapshot, not a live terminal.`;
      log.textContent = data.text || (data.reason ?? "No log content returned."); }
    catch (error) { logMeta.textContent = `Logs unavailable · ${error instanceof Error ? error.message : "Unknown error"}. Retry Refresh logs.`; log.textContent = ""; }
  }, true), logMeta, log);
  root.append(section);
}

async function showChat(root: HTMLElement, work: Work, sequence: number, auxiliary: boolean): Promise<void> {
  chatObserver?.abort();
  root.replaceChildren(element("h2", "Agent"), element("p", "Loading Sessions…", "muted"));
  try {
    const result = await api<{ sessions: { id?: string; sessionId?: string; title?: string; createdAt?: string }[] }>(`works/${work.id}/sessions`);
    if (sequence !== renderSequence || !root.isConnected) return;
    const header = element("div", undefined, "chat-heading"); header.append(element("h2", "Agent"));
    const selector = element("select"); selector.setAttribute("aria-label", "Session");
    for (const session of result.sessions) {
      const id = session.sessionId ?? session.id ?? "";
      const option = element("option", session.title || session.createdAt || id); option.value = id; selector.append(option);
    }
    selector.value = sessionSelection.get(work.id) ?? selector.value;
    sessionSelection.set(work.id, selector.value);
    if (!result.sessions.length) selector.hidden = true;
    const newSession = button("New session", async () => {
      try { const accepted = await api<Record<string, unknown>>(`works/${work.id}/sessions`, "POST");
        sessionSelection.set(work.id, String(accepted.sessionId ?? accepted.id ?? ""));
        void showChat(root, work, sequence, auxiliary); }
      catch (error) { showNotice(root, error instanceof Error ? error.message : "Could not create Session."); }
    }, true);
    header.append(selector, newSession);
    const messages = element("div", result.sessions.length ? "Loading Session…" : "No Sessions yet. Start one to work with Agent.", "chat-messages");
    const loadHistory = async () => {
      const sessionId = selector.value;
      sessionSelection.set(work.id, sessionId);
      if (!sessionId) return;
      try {
        const history = await api<{ messages: { role: string; text: string; createdAt: string }[] }>(`works/${work.id}/sessions/${encodeURIComponent(sessionId)}`);
        if (sequence !== renderSequence || selector.value !== sessionId || !root.isConnected) return;
        messages.replaceChildren();
        for (const entry of history.messages ?? []) {
          const item = element("div", undefined, entry.role === "user" ? "chat-user" : "chat-agent");
          item.append(element("small", entry.role || "message", "muted"), element("p", entry.text)); messages.append(item);
        }
        if (!history.messages?.length) messages.append(element("p", "No messages in this Session yet.", "muted"));
      } catch (error) { messages.textContent = error instanceof Error ? error.message : "Session history unavailable."; }
    };
    const sessionKey = (sessionId = selector.value) => `${work.id}:${sessionId}`;
    const composer = element("textarea") as HTMLTextAreaElement; composer.setAttribute("aria-label", "Message Agent");
    composer.value = chatDraft.get(sessionKey()) ?? "";
    composer.oninput = () => chatDraft.set(sessionKey(), composer.value);
    const context = element("label", " Include selected Service identity");
    const contextToggle = element("input") as HTMLInputElement; contextToggle.type = "checkbox"; contextToggle.className = "inline-check";
    context.prepend(contextToggle);
    const runStatus = element("div", undefined, "run-status");
    const observe = async (runId: string, from = 0, sessionId = selector.value) => {
      const key = sessionKey(sessionId);
      const controller = new AbortController(); chatObserver = controller;
      let cursor = from;
      const output = element("div", undefined, "run-output"); messages.append(output);
      const cancel = button("Cancel run", async () => {
        try { await api(`works/${work.id}/runs/${runId}/cancel`, "POST"); setRunStatus(`Cancel requested for Run ${runId}. Checking final state…`, false); }
        catch (error) { setRunStatus(error instanceof Error ? error.message : "Cancel request failed."); }
      }, true);
      const setRunStatus = (message: string, cancellable = true) => {
        runStatus.replaceChildren(element("span", message), ...(cancellable ? [cancel] : []));
      };
      setRunStatus(`Run ${runId} · observing`);
      let delay = 250;
      for (;;) {
        if (controller.signal.aborted || sequence !== renderSequence || !root.isConnected) return;
        try {
          const response = await fetch(`/_desktop/api/works/${encodeURIComponent(work.id)}/runs/${encodeURIComponent(runId)}/events?after=${cursor}`,
            { credentials: "same-origin", signal: controller.signal });
          if (!response.ok || !response.body) throw new Error(`Run events unavailable (${response.status})`);
          const reader = response.body.getReader();
          const decoder = new TextDecoder(); let pending = "", bytes = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.length;
            if (bytes > 16 * 1_024 * 1_024) throw new Error("Run event segment exceeded the limit");
            pending += decoder.decode(value, { stream: true });
            for (;;) {
              const index = pending.indexOf("\n"); if (index < 0) break;
              const line = pending.slice(0, index); pending = pending.slice(index + 1);
              if (!line) continue;
              const event = JSON.parse(line) as { sequence?: number | string; kind?: { $case?: string;
                text?: { delta?: string }; tool?: { toolName?: string; phase?: string }; state?: { state?: number; finalText?: string } } };
              const number = Number(event.sequence);
              if (!Number.isSafeInteger(number) || number <= cursor) continue;
              cursor = number; runSelection.set(key, { runId, cursor });
              if (event.kind?.$case === "text") output.append(document.createTextNode(event.kind.text?.delta ?? ""));
              else if (event.kind?.$case === "tool") output.append(element("p", `${event.kind.tool?.toolName ?? "Tool"}: ${event.kind.tool?.phase ?? "working"}`, "muted"));
              else if (event.kind?.$case === "state") setRunStatus(`Run ${runId} · state ${event.kind.state?.state ?? "unknown"}`,
                ![4, 5, 6, 7].includes(event.kind.state?.state ?? -1));
            }
          }
          if (pending.trim()) throw new Error("Incomplete Run event");
          const final = await api<{ state?: number; finalText?: string; error?: { message?: string } }>(`works/${work.id}/runs/${runId}`);
          if (final.state !== undefined && [4, 5, 6, 7].includes(final.state)) {
            setRunStatus(`Run ${runId} · ${["", "", "", "", "succeeded", "failed", "cancelled", "interrupted"][final.state]}`, false);
            if (final.error?.message) output.append(element("p", final.error.message, "error"));
            runSelection.delete(key); send.disabled = !selector.value || runSelection.has(sessionKey()); return;
          }
          delay = 250;
          await new Promise((done) => setTimeout(done, 500));
        } catch (error) {
          if (controller.signal.aborted) return;
          setRunStatus(`Run ${runId} · connection interrupted. Checking from event ${cursor}.`);
          if (error instanceof Error && /events unavailable \(410\)/.test(error.message)) {
            try {
              const final = await api<{ state?: number }>(`works/${work.id}/runs/${runId}`);
              await loadHistory();
              setRunStatus(`Run ${runId} · event history expired; current state ${final.state ?? "unknown"}. The message was not resubmitted.`,
                final.state === undefined || ![4, 5, 6, 7].includes(final.state));
              if (final.state !== undefined && [4, 5, 6, 7].includes(final.state)) {
                runSelection.delete(key); send.disabled = !selector.value || runSelection.has(sessionKey());
              }
            } catch { setRunStatus(`Run ${runId} · event history expired. Check the original Run and Session.`, false); }
            return;
          }
          if (error instanceof Error && /events unavailable \((401|404)\)/.test(error.message)) return;
          await new Promise((done) => setTimeout(done, delay));
          delay = Math.min(delay * 2, 5000);
        }
      }
    };
    const send = element("button", "Send message", "primary"); send.type = "button";
    send.onclick = async () => {
      if (!selector.value || !composer.value.trim() || runSelection.has(sessionKey())) return;
      send.disabled = true;
      const sessionId = selector.value;
      const key = sessionKey(sessionId);
      const draft = composer.value;
      const selectedService = serviceSelection.get(work.id);
      const prompt = contextToggle.checked && selectedService
        ? `${draft}\n\nSelected Service identity: ${selectedService}. Read actual accessible files or API for data; the browser page is not shared.`
        : draft;
      try {
        const accepted = await api<{ run?: { runId?: string } }>(`works/${work.id}/runs`, "POST", { sessionId, prompt });
        const runId = accepted.run?.runId;
        if (!runId) throw new Error("Core accepted the Run without a Run ID; check Session history before retrying.");
        chatDraft.delete(key);
        runSelection.set(key, { runId, cursor: 0 });
        if (selector.value === sessionId) { composer.value = ""; send.disabled = true; void observe(runId, 0, sessionId); }
      } catch (error) {
        if (selector.value === sessionId) runStatus.textContent = error instanceof Error
          ? `${error.message}. Your draft is preserved; check the active Run or Session before retrying.`
          : "Run result unknown. Your draft is preserved; check the active Run or Session before retrying.";
      }
      finally { send.disabled = !selector.value || runSelection.has(sessionKey()); }
    };
    send.disabled = !selector.value || runSelection.has(sessionKey());
    selector.onchange = () => {
      chatObserver?.abort();
      composer.value = chatDraft.get(sessionKey()) ?? "";
      contextToggle.checked = false;
      runStatus.replaceChildren();
      send.disabled = !selector.value || runSelection.has(sessionKey());
      void loadHistory();
      const selected = runSelection.get(sessionKey());
      if (selected) void observe(selected.runId, selected.cursor);
    };
    root.replaceChildren(header, messages, context, composer, send, runStatus);
    void loadHistory();
    const existing = runSelection.get(sessionKey());
    if (existing) void observe(existing.runId, existing.cursor);
    if (!auxiliary) root.classList.add("chat-focus");
  } catch (error) { if (sequence === renderSequence) root.textContent = `Conversation unavailable: ${error instanceof Error ? error.message : "Unknown error"}`; }
}

function showFiles(root: HTMLElement, work: Work, _sequence: number): void {
  root.classList.add("files-view");
  mountFiles(root, work.id, () => csrf, (guard) => { leaveCurrentPanel = guard; });
}

async function showSettings(root: HTMLElement, work: Work, sequence: number): Promise<void> {
  root.replaceChildren(element("h2", "Settings"), element("p", "Loading saved and active configuration…", "muted"));
  try {
    const configuration = await api<{ desired: Record<string, unknown>; active: Record<string, unknown> | null;
      pendingApply: boolean; runtime?: Record<string, unknown> }>(`works/${work.id}/configuration`);
    if (sequence !== renderSequence || !root.isConnected) return;
    const heading = element("div", undefined, "settings-heading");
    const configurationStatus = element("p", configuration.pendingApply
      ? "Saved changes are waiting to be applied. Current Work behavior may still use the previous configuration."
      : "Saved and active configuration are aligned.", "muted");
    heading.append(element("h2", "Settings"), configurationStatus);
    const notice = element("p", "", "settings-notice");
    heading.append(notice);
    const apply = button("Apply changes", async () => {
      try {
        const result = await api<{ operationId: string }>(`works/${work.id}/configuration/apply`, "POST");
        notice.textContent = "Apply accepted. Saved configuration and loaded runtime may differ until the Operation succeeds.";
        watchOperation(root, result.operationId, `Apply ${work.name}`);
      } catch (error) { notice.textContent = error instanceof Error ? error.message : "Apply result unknown. Check status."; }
    });
    apply.disabled = !configuration.pendingApply;
    heading.append(apply, button("Refresh configuration status", async () => {
      if (leaveCurrentPanel && !leaveCurrentPanel()) return;
      leaveCurrentPanel = undefined;
      await showSettings(root, work, sequence);
    }, true));
    const nav = element("nav", undefined, "settings-tabs");
    const body = element("section", undefined, "settings-body");
    const sections = ["Skills", "Pi Packages", "AGENTS.md", "Advanced"] as const;
    let dirty = false;
    leaveCurrentPanel = () => !root.isConnected || !dirty || confirm("Discard unsaved Settings changes and leave this section?");
    const saved = () => { dirty = false; configuration.pendingApply = true; apply.disabled = false;
      configurationStatus.textContent = "Saved changes are waiting to be applied. Current Work behavior may still use the previous configuration."; };
    const display = (section: typeof sections[number]) => {
      dirty = false;
      body.replaceChildren();
      for (const item of nav.querySelectorAll("button")) item.setAttribute("aria-current", item.textContent === section ? "page" : "false");
      if (section === "Skills") {
        body.append(element("h3", "Skills"), element("p", "Selecting a Core catalog Skill copies that choice into this Work's saved context. Existing Work context stays in use until Apply succeeds.", "muted"));
        const activeSkills = Array.isArray(configuration.active?.skills) ? configuration.active.skills.map(String) : [];
        const runtime = configuration.runtime as { state?: string; skills?: { name: string; loaded: boolean;
          modelVisible: boolean; visibilityReason?: string | null }[] } | undefined;
        body.append(element("p", `In use: ${activeSkills.length ? activeSkills.join(", ") : "none"} · Saved changes: ${Array.isArray(configuration.desired.skills) && configuration.desired.skills.length ? configuration.desired.skills.join(", ") : "none"} · ${configuration.pendingApply ? "Not applied" : "Applied"} · Runtime: ${runtime?.state ?? "unavailable"}.`, "muted"));
        if (runtime?.skills?.length) body.append(element("p", runtime.skills.map((item) =>
          `${item.name}: ${item.loaded ? "loaded" : "not loaded"}, ${item.modelVisible ? "visible to model" : item.visibilityReason ?? "not visible to model"}`).join(" · "), "muted"));
        const skills = element("textarea") as HTMLTextAreaElement;
        skills.setAttribute("aria-label", "Selected Skill names, one per line");
        skills.classList.add("settings-selection-editor");
        skills.value = Array.isArray(configuration.desired.skills) ? configuration.desired.skills.map((item) => String(item)).join("\n") : "";
        const catalog = element("div", "Loading available Skills…", "catalog-list");
        const selectedNames = () => skills.value.split("\n").map((item) => item.trim()).filter(Boolean);
        skills.oninput = () => {
          dirty = true;
          const names = new Set(selectedNames());
          for (const input of catalog.querySelectorAll("input[type=checkbox]"))
            (input as HTMLInputElement).checked = names.has((input as HTMLInputElement).value);
        };
        const clear = button("Clear selection", async () => {
          skills.value = ""; dirty = true;
          for (const input of catalog.querySelectorAll("input[type=checkbox]")) (input as HTMLInputElement).checked = false;
        }, true);
        body.append(skills, clear, button("Save Skills", async () => {
          try {
            const values = selectedNames();
            await api(`works/${work.id}/configuration/skills`, "PUT", { skills: values });
            configuration.desired.skills = values; saved();
            notice.textContent = values.length ? "Skills saved. Apply changes to load them." : "Skills explicitly cleared. Apply changes to load the empty selection.";
          } catch (error) { notice.textContent = error instanceof Error ? error.message : "Could not save Skills."; }
        }));
        body.append(catalog);
        void api<{ skills: { name?: string }[] }>("skills").then((value) => {
          if (!body.isConnected) return;
          catalog.replaceChildren();
          if (!value.skills.length) { catalog.append(element("p", "No Skills available from Core.", "muted")); return; }
          for (const item of value.skills) {
            if (!item.name) continue;
            const option = element("label", ` ${item.name}`, "catalog-option");
            const check = element("input") as HTMLInputElement; check.type = "checkbox";
            check.value = item.name;
            check.setAttribute("aria-label", `Select Skill ${item.name}`);
            check.checked = selectedNames().includes(item.name);
            check.onchange = () => {
              const next = new Set(selectedNames());
              if (check.checked) next.add(item.name!); else next.delete(item.name!);
              skills.value = [...next].join("\n"); dirty = true;
            };
            option.prepend(check); catalog.append(option);
          }
        }, () => { if (body.isConnected) catalog.textContent = "Skill catalog unavailable; saved selection remains visible."; });
      } else if (section === "AGENTS.md") {
        body.append(element("h3", "AGENTS.md"), element("p", "Edit the saved Work instructions. Apply is a separate step.", "muted"));
        const active = element("details");
        active.append(element("summary", "Currently active instructions"),
          element("pre", configuration.active ? String(configuration.active.agentsMd ?? "") : "No active Work instructions.", "mono"));
        body.append(active);
        const editor = element("textarea") as HTMLTextAreaElement;
        editor.setAttribute("aria-label", "AGENTS.md content"); editor.value = String(configuration.desired.agentsMd ?? "");
        const importFile = element("input") as HTMLInputElement; importFile.type = "file"; importFile.accept = ".md,text/markdown,text/plain";
        importFile.setAttribute("aria-label", "Import AGENTS.md text");
        importFile.onchange = () => { const selected = importFile.files?.[0]; if (!selected) return;
          if (selected.size > 1_048_576) { notice.textContent = "AGENTS.md must be at most 1 MiB."; return; }
          void selected.text().then((text) => { editor.value = text; dirty = true; notice.textContent = "Imported into the editor. Save to store this Work's instructions."; });
        };
        body.append(importFile);
        editor.oninput = () => { dirty = true; };
        body.append(editor, button("Save AGENTS.md", async () => {
          try { await api(`works/${work.id}/configuration/agents`, "PUT", { agentsMd: editor.value });
            configuration.desired.agentsMd = editor.value; saved();
            notice.textContent = "AGENTS.md saved. Apply changes to load it."; }
          catch (error) { notice.textContent = error instanceof Error ? error.message : "Could not save AGENTS.md."; }
        }));
      } else if (section === "Advanced") {
        body.append(element("h3", "Advanced configuration"), element("p", "Edit the complete saved configuration JSON. Save does not Apply.", "muted"));
        const editor = element("textarea") as HTMLTextAreaElement;
        editor.setAttribute("aria-label", "Complete configuration JSON"); editor.value = JSON.stringify(configuration.desired, null, 2);
        editor.className = "config-editor mono";
        editor.oninput = () => { dirty = true; };
        const importFile = element("input") as HTMLInputElement; importFile.type = "file"; importFile.accept = ".json,application/json";
        importFile.setAttribute("aria-label", "Import configuration JSON");
        importFile.onchange = () => { const selected = importFile.files?.[0]; if (!selected) return;
          if (selected.size > 1_048_576) { notice.textContent = "Configuration JSON must be at most 1 MiB."; return; }
          void selected.text().then((text) => { editor.value = text; dirty = true; notice.textContent = "Imported into the editor. Save to validate and store it."; });
        };
        body.append(importFile);
        body.append(editor, button("Save configuration", async () => {
          try {
            const next: unknown = JSON.parse(editor.value);
            if (!next || typeof next !== "object" || Array.isArray(next)) throw new Error("Configuration must be a JSON object.");
            await api(`works/${work.id}/configuration`, "PUT", { configuration: next });
            configuration.desired = next as Record<string, unknown>; saved();
            notice.textContent = "Configuration saved. Apply changes to load it.";
          } catch (error) { notice.textContent = error instanceof Error ? error.message : "Could not save configuration."; }
        }));
      } else {
        body.append(element("h3", "Pi Packages"), element("p", "Install into this Work, select the packages to use, then Apply.", "muted"));
        const available = element("div", "Loading Core package catalog…", "catalog-list"); body.append(available);
        void api<{ packages: { name?: string; version?: string }[] }>("packages").then((value) => {
          if (!body.isConnected) return;
          available.replaceChildren(element("h4", "Available from Core"),
            element("p", "Catalog entries are available to install; they are not installed in this Work yet.", "muted"));
          for (const item of value.packages) if (item.name)
            available.append(element("p", `${item.name}${item.version ? ` · ${item.version}` : ""}`, "muted"));
          if (!value.packages.length) available.append(element("p", "No Core catalog packages available.", "muted"));
        }, () => { if (body.isConnected) available.textContent = "Core package catalog unavailable; installed Work packages remain visible."; });
        const installed = element("div", "Loading installed packages…", "package-list"); body.append(installed);
        void api<{ packages: { name?: string; desired?: unknown; active?: unknown; runtime?: { loaded?: boolean | null; availability?: string }; pendingApply?: boolean }[] }>(`works/${work.id}/packages`).then((value) => {
          if (!body.isConnected) return;
          installed.replaceChildren();
          for (const item of value.packages) {
            const row = element("div", undefined, "package-row");
            row.append(element("span", `${item.name ?? "unnamed"} · ${item.desired ? "saved" : "not selected"} · ${item.active ? "active" : "not active"} · ${item.runtime?.loaded === true ? "loaded" : item.runtime?.availability ?? "not loaded"}${item.pendingApply ? " · pending Apply" : ""}`));
            if (item.name) {
              const packagePath = `works/${work.id}/packages/${encodeURIComponent(item.name)}`;
              row.append(button("Details", async () => {
                try { const detail = await api<Record<string, unknown>>(packagePath);
                  notice.textContent = JSON.stringify(detail, null, 2); }
                catch (error) { notice.textContent = error instanceof Error ? error.message : "Package details unavailable."; }
              }, true));
              row.append(button("Enable", async () => {
                try { await api(`${packagePath}/enable`, "POST"); notice.textContent = `${item.name} enabled in saved configuration. Apply to load.`; }
                catch (error) { notice.textContent = error instanceof Error ? error.message : "Could not enable package."; }
              }, true), button("Disable", async () => {
                try { await api(`${packagePath}/disable`, "POST"); notice.textContent = `${item.name} disabled in saved configuration. Apply to unload.`; }
                catch (error) { notice.textContent = error instanceof Error ? error.message : "Could not disable package."; }
              }, true));
              row.append(button("Update", async () => {
                const sourceText = prompt(`New npm or Git source for ${item.name} (npm:name@version or git:URL)`);
                if (!sourceText) return;
                const source = sourceText.startsWith("git:") ? { kind: "git", spec: sourceText.slice(4) }
                  : { kind: "npm", spec: sourceText.startsWith("npm:") ? sourceText.slice(4) : sourceText };
                try { const result = await api<{ operationId: string }>(`${packagePath}/update`, "POST", { source });
                  watchOperation(root, result.operationId, `Update ${item.name}`); }
                catch (error) { notice.textContent = error instanceof Error ? error.message : "Update result unknown."; }
              }, true));
              row.append(button("Remove", async () => {
              if (!confirm(`Remove Pi Package ${item.name} from ${work.name}? Saved and active states may differ until Apply.`)) return;
              try { await api(packagePath, "DELETE");
                notice.textContent = `${item.name} removal saved. Apply changes if required.`; }
              catch (error) { notice.textContent = error instanceof Error ? error.message : "Could not remove Pi Package."; }
              }, true));
            }
            installed.append(row);
          }
          if (!value.packages.length) installed.append(element("p", "No Pi Packages installed in this Work.", "muted"));
        }, () => { if (body.isConnected) installed.textContent = "Installed Pi Packages unavailable."; });
        const selected = element("textarea") as HTMLTextAreaElement;
        selected.setAttribute("aria-label", "Selected Pi Packages, one per line");
        selected.classList.add("settings-selection-editor");
        selected.value = Array.isArray(configuration.desired.packages) ? configuration.desired.packages.map((item) => {
          const entry = item as { name?: string; enabled?: boolean }; return `${entry.name ?? ""}${entry.enabled === false ? " (disabled)" : ""}`;
        }).join("\n") : "";
        selected.oninput = () => { dirty = true; };
        body.append(element("label", "Selected Pi Packages (one name per line; append (disabled) to keep installed but disabled)"), selected,
          button("Save selection", async () => {
            try { const packages = selected.value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => ({
              name: line.replace(/ \(disabled\)$/, ""), enabled: !line.endsWith(" (disabled)") }));
              await api(`works/${work.id}/configuration/packages`, "PUT", { packages });
              configuration.desired.packages = packages; saved();
              notice.textContent = "Package selection saved. Apply is a separate action.";
            } catch (error) { notice.textContent = error instanceof Error ? error.message : "Could not save package selection."; }
          }));
        const kind = element("select"); kind.setAttribute("aria-label", "Package source");
        for (const choice of ["core", "npm", "git", "zip", "local"]) { const option = element("option", choice); option.value = choice; kind.append(option); }
        const spec = field("Package name or source", "text");
        const upload = element("input") as HTMLInputElement;
        upload.type = "file"; upload.setAttribute("aria-label", "Select Pi Package ZIP or local directory");
        const setUploadKind = () => { const local = kind.value === "local";
          upload.hidden = !(local || kind.value === "zip"); spec.wrapper.hidden = local || kind.value === "zip";
          upload.accept = local ? "" : ".zip,application/zip"; upload.multiple = local;
          if (local) upload.setAttribute("webkitdirectory", ""); else upload.removeAttribute("webkitdirectory");
          upload.value = "";
        };
        kind.onchange = setUploadKind; setUploadKind();
        body.append(kind, spec.wrapper, upload,
          element("p", "Local directory upload includes regular files visible to your browser. File permissions and symbolic links are not preserved; use ZIP if they matter.", "muted"),
          button("Install Pi Package", async () => {
          let source: Record<string, unknown>;
          if (kind.value === "local" || kind.value === "zip") {
            const files = Array.from(upload.files ?? []);
            if (!files.length || kind.value === "zip" && files.length !== 1) { notice.textContent = "Select one ZIP or one local directory."; return; }
            const data = new FormData(); data.append("kind", kind.value);
            for (const file of files) data.append(kind.value === "zip" ? "zip" : "files", file,
              kind.value === "zip" ? file.name : file.webkitRelativePath);
            notice.textContent = "Uploading and validating package…";
            try {
              const response = await fetch(`/_desktop/api/works/${encodeURIComponent(work.id)}/package-uploads`, {
                method: "POST", credentials: "same-origin", headers: { "x-piwork-csrf": csrf }, body: data });
              const result = await response.json() as { uploadId?: string; message?: string };
              if (!response.ok || !result.uploadId) throw new Error(result.message ?? `Upload failed (${response.status})`);
              source = { kind: "upload", uploadId: result.uploadId };
            } catch (error) { notice.textContent = error instanceof Error ? error.message : "Package upload failed."; return; }
          } else {
            if (!spec.input.value.trim()) { notice.textContent = "Enter a package source."; return; }
            source = kind.value === "core" ? { kind: "core", name: spec.input.value.trim() }
              : { kind: kind.value, spec: spec.input.value.trim() };
          }
          try { const accepted = await api<{ operationId?: string }>(`works/${work.id}/packages`, "POST", { source });
            if (accepted.operationId) watchOperation(root, accepted.operationId, "Install Pi Package");
            else notice.textContent = "Install accepted without an Operation ID. Check installed packages before Apply."; }
          catch (error) { notice.textContent = error instanceof Error ? error.message : "Install result unknown."; }
        }));
      }
    };
    for (const section of sections) nav.append(button(section, async () => {
      if (dirty && !confirm("Discard unsaved Settings changes and switch section?")) return;
      display(section);
    }, true));
    root.replaceChildren(heading, nav, body);
    display("Skills");
  } catch (error) { if (sequence === renderSequence) root.textContent = `Settings unavailable: ${error instanceof Error ? error.message : "Unknown error"}`; }
}

function showMessage(message: string): void {
  const node = app?.querySelector(".message");
  if (node) node.textContent = message;
}

async function start(): Promise<void> {
  const ticket = new URLSearchParams(location.hash.slice(1)).get("ticket");
  if (ticket) history.replaceState(null, "", location.pathname + location.search);
  if (!app) return;
  try {
    if (ticket) {
      const response = await fetch("/_desktop/api/bootstrap", { method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket }) });
      if (!response.ok) throw new Error("Open the fresh Desktop address printed in your CLI terminal.");
      const initial = await response.json() as { csrf: string };
      csrf = initial.csrf;
    }
    await refreshIdentity();
    window.setInterval(() => {
      void api<IdentityView>("session").then((view) => {
        if (!currentView || (view.generation === currentView.generation && view.state === currentView.state
          && view.coreUrl === currentView.coreUrl && view.user?.id === currentView.user?.id)) return;
        ++renderSequence;
        render(view);
      }).catch(() => undefined);
    }, 2_000);
  } catch (error) {
    app.textContent = error instanceof Error ? error.message : "Desktop access is unavailable.";
  }
}
void start();
