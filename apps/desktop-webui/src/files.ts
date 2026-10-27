import { t, formatTime } from './locale.js';

type FileEntry = { href: string; name: string; kind: string; directory: boolean; size: number | null;
  modified: string | null; contentType: string | null };
const dav = "DAV:";
const piwork = "urn:piwork:files";
const maxText = 1_048_576;
const mutations = new Set<string>();

/** Display label for the internal mutation verb; values never change. */
function actionLabel(action: string): string {
  return action === "rename" ? t('fileMenu.rename') : action === "move" ? t('fileMenu.move')
    : action === "copy" ? t('common.copy') : t('fileMenu.delete');
}
/** Lowercase verb used inside the accepted message, matching the original text. */
function actionVerb(action: string): string {
  return action === "rename" ? t('filesBrowser.verbRename') : action === "move" ? t('filesBrowser.verbMove')
    : action === "copy" ? t('filesBrowser.verbCopy') : t('filesBrowser.verbDelete');
}
function entryKindLabel(entry: FileEntry): string {
  return entry.directory ? t('files.kindFolder') : entry.kind === "file" ? t('files.kindFile') : t('filesBrowser.kindSpecialShort');
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function control(label: string, action: () => Promise<void>, secondary = true): HTMLButtonElement {
  const item = node("button", label, secondary ? "secondary" : "primary");
  item.type = "button";
  item.onclick = () => { item.disabled = true; void action().finally(() => { item.disabled = false; }); };
  return item;
}

function child(parent: Element, name: string): Element | undefined {
  return Array.from(parent.children).find((item) => item.namespaceURI === dav && item.localName === name);
}

function value(parent: Element, name: string): string | undefined { return child(parent, name)?.textContent ?? undefined; }

export function parseEntries(xml: string, base: string): FileEntry[] {
  if (xml.length > 16_777_216 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error(t('d.files.listingDoctype'));
  const documentXml = new DOMParser().parseFromString(xml, "application/xml");
  if (documentXml.querySelector("parsererror")) throw new Error(t('d.files.listingMalformed'));
  const entries: FileEntry[] = [];
  for (const response of Array.from(documentXml.getElementsByTagNameNS(dav, "response"))) {
    const href = value(response, "href");
    if (!href || !href.startsWith(base) || href.includes("?") || href.includes("#")) throw new Error(t('d.files.listingPath'));
    const propstat = Array.from(response.getElementsByTagNameNS(dav, "propstat")).find((item) => /^HTTP\/1\.1 200\b/.test(value(item, "status") ?? ""));
    const properties = propstat ? child(propstat, "prop") : undefined;
    if (!properties) throw new Error(t('d.files.listingMetadata'));
    const type = child(properties, "resourcetype");
    const directory = !!type && Array.from(type.children).some((item) => item.namespaceURI === dav && item.localName === "collection");
    const kind = properties.getElementsByTagNameNS(piwork, "kind")[0]?.textContent ?? (directory ? "directory" : "file");
    const relative = href.slice(base.length).replace(/\/$/, "");
    if (relative.includes("/")) continue;
    let name: string;
    try { name = decodeURIComponent(relative); } catch { throw new Error(t('d.files.listingEncoding')); }
    const sizeText = value(properties, "getcontentlength");
    entries.push({ href, name: name || "/", kind, directory,
      size: sizeText && /^\d+$/.test(sizeText) ? Number(sizeText) : null,
      modified: value(properties, "getlastmodified") ?? null,
      contentType: value(properties, "getcontenttype") ?? null });
  }
  return entries;
}

export interface FileMutationResult { path: string; status: 'succeeded' | 'failed' | 'unknown'; message: string; httpStatus: number }
/** Normalize an href only inside the exact Work root; never decode a separator. */
function mutationPath(href: string | undefined, base: string): string {
  if (!href || !href.startsWith(base) || href.includes('?') || href.includes('#')) throw new Error(t('d.files.resultInvalidPath'));
  const relative = href.slice(base.length).replace(/\/$/, '');
  const segments = relative ? relative.split('/').map(segment => {
    let decoded: string; try { decoded = decodeURIComponent(segment); } catch { throw new Error(t('d.files.resultEncoding')); }
    if (!decoded || decoded === '.' || decoded === '..' || /[\\/\x00-\x1f\x7f]/.test(decoded)) throw new Error(t('d.files.resultUnsafe'));
    return decoded;
  }) : [];
  return '/' + segments.join('/');
}
export function mutationResults(xml: string, base: string): { succeeded: string[]; failed: string[]; results: FileMutationResult[] } {
  if (xml.length > 16_777_216 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error(t('d.files.resultDoctype'));
  const documentXml = new DOMParser().parseFromString(xml, 'application/xml');
  if (documentXml.querySelector('parsererror')) throw new Error(t('d.files.resultMalformed'));
  const results: FileMutationResult[] = [];
  for (const response of Array.from(documentXml.getElementsByTagNameNS(dav, 'response'))) {
    const path = mutationPath(value(response, 'href'), base);
    const direct = value(response, 'status');
    const states = direct ? [direct] : Array.from(response.getElementsByTagNameNS(dav, 'propstat')).map(item => value(item, 'status') ?? '');
    if (!states.length) throw new Error(t('d.files.resultMissingStatus'));
    const statuses = states.map(state => {
      const match = /^HTTP\/(?:1\.[01]|2) (\d{3})\b/.exec(state);
      if (!match || Number(match[1]) < 100 || Number(match[1]) > 599) throw new Error(t('d.files.resultInvalidStatus'));
      return Number(match[1]);
    });
    const httpStatus = statuses.find(status => status >= 500 || status < 200 || status === 408) ?? statuses.find(status => status >= 300) ?? statuses[0]!;
    const status = httpStatus >= 500 || httpStatus < 200 || httpStatus === 408 ? 'unknown' : httpStatus < 300 ? 'succeeded' : 'failed';
    const code = response.getElementsByTagNameNS(piwork, 'code')[0]?.textContent?.trim();
    const description = value(response, 'responsedescription')?.trim();
    results.push({ path, status, httpStatus, message: code || description || (status === 'succeeded' ? t('d.files.resultConfirmed') : status === 'unknown' ? t('d.files.resultUnconfirmed', { status: httpStatus }) : t('d.files.requestFailed', { status: httpStatus })) });
  }
  if (!results.length) throw new Error(t('d.files.resultEmpty'));
  return { results, succeeded: results.filter(row => row.status === 'succeeded').map(row => row.path), failed: results.filter(row => row.status !== 'succeeded').map(row => `${row.path}: ${row.message}`) };
}

function childPath(base: string, name: string, directory = false): string {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || /[\x00-\x1f]/.test(name))
    throw new Error(t('filesBrowser.invalidName'));
  return `${base}${encodeURIComponent(name)}${directory ? "/" : ""}`;
}

async function request(path: string, method: string, csrf: string, headers: Record<string, string> = {}, body?: BodyInit): Promise<Response> {
  const response = await fetch(path, { method, credentials: "same-origin", headers: {
    ...(!["GET", "HEAD", "OPTIONS"].includes(method) ? { "x-piwork-csrf": csrf } : {}), ...headers,
  }, ...(body === undefined ? {} : { body }) });
  if (!response.ok && response.status !== 207) {
    const code = response.headers.get("x-piwork-file-error") ?? t('filesBrowser.requestFailed', { method, status: response.status });
    throw new Error(code);
  }
  return response;
}

async function smallFile(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxText) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(t('d.error.textEditorLimit'));
  }
  if (!response.body) throw new Error(t('d.error.fileContentUnavailable'));
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxText) throw new Error(t('d.error.textEditorLimit'));
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return data;
}

export function mountFiles(root: HTMLElement, workId: string, getCsrf: () => string,
  setLeaveGuard: (guard: () => boolean) => void): void {
  const base = `/_desktop/files/works/${encodeURIComponent(workId)}/files/`;
  let path = base;
  let dirty = false;
  const title = node("h2", t('term.workspaceFiles'));
  const location = node("p", "/", "mono muted");
  const actions = node("div", undefined, "toolbar-actions");
  const status = node("p", "", "file-status");
  const list = node("div", undefined, "file-list");
  const editor = node("section", undefined, "file-editor");
  const discardDraft = () => {
    if (!root.isConnected || !dirty) return true;
    if (!confirm(t('filesBrowser.discardChanges'))) return false;
    dirty = false; editor.replaceChildren(); return true;
  };
  setLeaveGuard(discardDraft);
  const showError = (error: unknown, action: string) => {
    status.textContent = t('filesBrowser.errorStatus', { action, message: error instanceof Error ? error.message : t('filesBrowser.unknownResult') });
    status.className = "file-status error";
  };
  const mutate = async (target: string, method: string, headers: Record<string, string> = {}, body?: BodyInit): Promise<Response> => {
    if (mutations.has(workId)) throw new Error(t('filesBrowser.mutationInProgress'));
    mutations.add(workId);
    try { return await request(target, method, getCsrf(), headers, body); }
    finally { mutations.delete(workId); }
  };
  const existing = async (target: string): Promise<FileEntry | undefined> => {
    const response = await fetch(target, { method: "PROPFIND", credentials: "same-origin",
      headers: { "x-piwork-csrf": getCsrf(), Depth: "0" } });
    if (response.status === 404) return undefined;
    if (response.status !== 207) throw new Error(t('filesBrowser.destinationCheckFailed', { status: response.status }));
    return parseEntries(await response.text(), target).find((item) => item.href === target);
  };
  const reportMutation = async (result: Response, success: string): Promise<{ message: string; failed: boolean }> => {
    if (result.status !== 207) return { message: success, failed: false };
    const paths = mutationResults(await result.text(), base);
    return { message: t('filesBrowser.webdavResult', {
      succeeded: paths.succeeded.length,
      succeededPaths: paths.succeeded.length ? `: ${paths.succeeded.join("; ")}` : "",
      failed: paths.failed.length,
      failedPaths: paths.failed.length ? `: ${paths.failed.join("; ")}` : "",
    }),
      failed: paths.failed.length > 0 };
  };
  const refresh = async (): Promise<boolean> => {
    status.textContent = t('filesBrowser.loading');
    try {
      const response = await request(path, "PROPFIND", getCsrf(), { Depth: "1" });
      if (response.status !== 207) throw new Error(t('filesBrowser.unexpectedListing', { status: response.status }));
      const entries = parseEntries(await response.text(), path).filter((item) => item.href !== path);
      if (!root.isConnected) return false;
      location.textContent = decodeURIComponent(path.slice(base.length)) || "/";
      list.replaceChildren(); editor.replaceChildren(); dirty = false;
      const parent = path.slice(0, -1).lastIndexOf("/");
      if (path !== base && parent >= base.length - 1) list.append(control(t('filesBrowser.upOneFolder'), async () => {
        if (!discardDraft()) return;
        path = path.slice(0, parent + 1); await refresh();
      }));
      if (!entries.length) list.append(node("p", t('filesBrowser.emptyFolder'), "empty-state"));
      for (const entry of entries) {
        const row = node("div", undefined, "file-row");
        const name = control(`${entryKindLabel(entry)} · ${entry.name}`, async () => {
          if (!discardDraft()) return;
          if (entry.directory) { path = entry.href; await refresh(); }
          else await openFile(entry);
        }, true);
        name.classList.add("file-name");
        const detail = [entry.kind, entry.contentType, entry.size === null ? null : t('filesBrowser.sizeBytes', { size: entry.size }), entry.modified]
          .filter((item): item is string => !!item).join(" · ");
        row.append(name, node("span", detail, "file-meta muted"));
        if (entry.kind === "file") {
          const download = node("a", t('filesBrowser.download')); download.href = entry.href; download.download = entry.name;
          row.append(download);
        }
        const menu = node("details", undefined, "file-actions");
        const summary = node("summary", t('filesBrowser.more'));
        const form = node("form", undefined, "file-action-form");
        const action = node("select"); action.setAttribute("aria-label", t('filesBrowser.actionFor', { name: entry.name }));
        for (const choice of ["rename", "move", "copy", "delete"]) {
          const option = node("option", actionLabel(choice)); option.value = choice; action.append(option);
        }
        const targetLabel = node("label", t('transfer.newName'), "form-field");
        const target = node("input"); target.type = "text"; target.setAttribute("aria-label", t('filesBrowser.destinationFor', { name: entry.name }));
        targetLabel.append(target);
        const impact = node("p", t('filesBrowser.destinationNote'), "muted");
        const submit = node("button", t('fileMenu.rename'), "primary"); submit.type = "submit";
        const update = () => {
          targetLabel.hidden = action.value === "delete";
          targetLabel.firstChild!.textContent = action.value === "rename" ? t('transfer.newName') : t('filesBrowser.destinationPath');
          submit.textContent = actionLabel(action.value);
          impact.textContent = action.value === "delete"
            ? t('filesBrowser.deleteWarning', { name: entry.name, contents: entry.directory ? t('filesBrowser.andContents') : "" })
            : action.value === "rename" ? t('filesBrowser.renameHint') : t('filesBrowser.moveHint');
        };
        action.onchange = update; update();
        const cancel = control(t('common.cancel'), async () => { menu.open = false; summary.focus(); });
        form.append(action, targetLabel, impact, submit, cancel);
        form.onkeydown = (event) => { if (event.key === "Escape") { event.preventDefault(); menu.open = false; summary.focus(); } };
        form.onsubmit = (event) => { event.preventDefault(); submit.disabled = true; void (async () => {
          try {
            if (action.value === "delete") {
              if (!confirm(t('filesBrowser.deleteConfirm', { name: entry.name, contents: entry.directory ? t('filesBrowser.andContents') : "" }))) { menu.open = false; return; }
              if (!discardDraft()) return;
              const result = await mutate(entry.href, "DELETE");
              const report = await reportMutation(result, t('filesBrowser.deleted', { name: entry.name }));
              if (await refresh()) { status.textContent = report.message; status.className = report.failed ? "file-status error" : "file-status muted"; }
            } else {
              const desired = target.value.trim();
              if (!desired) throw new Error(t('filesBrowser.destinationRequired'));
              let destination: string;
              if (action.value === "rename") destination = childPath(path, desired, entry.directory);
              else {
                const parts = desired.split("/");
                if (desired.startsWith("/") || desired.includes("\\") || parts.some((part) => !part || part === "." || part === ".." || /[\x00-\x1f]/.test(part)))
                  throw new Error(t('filesBrowser.destinationInvalid'));
                destination = `${base}${parts.map((part) => encodeURIComponent(part)).join("/")}${entry.directory ? "/" : ""}`;
              }
              const collision = await existing(destination);
              if (collision && !confirm(t('filesBrowser.replaceDestination', { name: collision.name }))) { menu.open = false; return; }
              if (!discardDraft()) return;
              const method = action.value === "copy" ? "COPY" : "MOVE";
              const result = await mutate(entry.href, method, { Destination: locationOrigin() + destination, Overwrite: collision ? "T" : "F" });
              const report = await reportMutation(result, t('filesBrowser.actionAccepted', { name: entry.name, verb: actionVerb(action.value) }));
              if (await refresh()) { status.textContent = report.message; status.className = report.failed ? "file-status error" : "file-status muted"; }
            }
          } catch (error) { showError(error, action.value); }
          finally { submit.disabled = false; }
        })(); };
        menu.append(summary, form); row.append(menu);
        list.append(row);
      }
      status.textContent = t('filesBrowser.lastChecked', { time: formatTime(new Date()) });
      status.className = "file-status muted";
      return true;
    } catch (error) { showError(error, t('filesBrowser.fileListing')); list.replaceChildren(); return false; }
  };
  const openFile = async (entry: FileEntry) => {
    editor.replaceChildren(node("h3", entry.name));
    if (entry.kind !== "file") { editor.append(node("p", t('filesBrowser.specialItem'))); return; }
    if (entry.size !== null && entry.size > maxText) { editor.append(node("p", t('filesBrowser.tooLarge'))); return; }
    try {
      const response = await request(entry.href, "GET", getCsrf());
      const data = await smallFile(response);
      const bom = data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf;
      const original = new TextDecoder("utf-8", { fatal: true }).decode(bom ? data.subarray(3) : data);
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(original))
        throw new Error(t('filesBrowser.binaryContent'));
      const withoutCrLf = original.replace(/\r\n/g, "");
      if (withoutCrLf.includes("\r") || original.includes("\r\n") && withoutCrLf.includes("\n"))
        throw new Error(t('filesBrowser.mixedLineEndings'));
      const crlf = original.includes("\r\n");
      const text = crlf ? original.replace(/\r\n/g, "\n") : original;
      const input = node("textarea"); input.value = text;
      input.setAttribute("aria-label", t('filesBrowser.editName', { name: entry.name }));
      input.oninput = () => { dirty = input.value !== text; };
      editor.append(input, control(t('editor.saveFile'), async () => {
        if (!dirty) return;
        status.textContent = t('filesBrowser.saving', { name: entry.name });
        status.className = "file-status muted";
        try {
          const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
          if (entry.modified) headers["If-Unmodified-Since"] = entry.modified;
          const encoded = new TextEncoder().encode(crlf ? input.value.replace(/\n/g, "\r\n") : input.value);
          const bytes = bom ? new Uint8Array(encoded.length + 3) : encoded;
          if (bom) { bytes.set([0xef, 0xbb, 0xbf]); bytes.set(encoded, 3); }
          const result = await mutate(entry.href, "PUT", headers, bytes);
          const report = await reportMutation(result, t('filesBrowser.saved', { name: entry.name }));
          if (report.failed) { status.textContent = report.message; status.className = "file-status error"; return; }
          dirty = false; if (await refresh()) status.textContent = report.message;
        } catch (error) { showError(error, t('editor.saveFile')); }
      }, false), control(t('editor.discard'), async () => { if (!dirty || confirm(t('filesBrowser.discardUnsaved', { name: entry.name }))) { dirty = false; editor.replaceChildren(); } }));
    } catch (error) { editor.append(node("p", error instanceof Error ? error.message : t('filesBrowser.cannotEdit'), "error")); }
  };
  const folder = node("details", undefined, "new-folder");
  const folderSummary = node("summary", t('files.newFolder'));
  const folderForm = node("form", undefined, "new-folder-form");
  const folderName = node("input"); folderName.type = "text"; folderName.setAttribute("aria-label", t('filesBrowser.newFolderName'));
  const createFolder = node("button", t('folder.create'), "primary"); createFolder.type = "submit";
  folderForm.append(folderName, createFolder, control(t('common.cancel'), async () => { folder.open = false; folderSummary.focus(); }));
  folderForm.onkeydown = (event) => { if (event.key === "Escape") { event.preventDefault(); folder.open = false; folderSummary.focus(); } };
  folderForm.onsubmit = (event) => { event.preventDefault(); createFolder.disabled = true; void (async () => {
    try { const target = childPath(path, folderName.value.trim(), true);
      if (!discardDraft()) return;
      const result = await mutate(target, "MKCOL");
      const report = await reportMutation(result, t('files.folderCreated'));
      if (report.failed) { status.textContent = report.message; status.className = "file-status error"; return; }
      folderName.value = ""; folder.open = false; if (await refresh()) status.textContent = report.message; }
    catch (error) { showError(error, t('files.newFolder')); }
    finally { createFolder.disabled = false; }
  })(); };
  folder.append(folderSummary, folderForm);
  actions.append(control(t('filesBrowser.upload'), async () => {
    const picker = node("input"); picker.type = "file"; picker.multiple = true;
    picker.onchange = () => { void (async () => {
      if (!discardDraft()) return;
      const failed: string[] = [];
      let uploaded = 0;
      for (const file of Array.from(picker.files ?? [])) {
        try {
          const target = childPath(path, file.name);
          const previous = await existing(target);
          if (previous && !confirm(t('filesBrowser.replaceExisting', { name: file.name }))) continue;
          const headers: Record<string, string> = { "Content-Type": "application/octet-stream",
            ...(previous ? previous.modified ? { "If-Unmodified-Since": previous.modified } : {} : { "If-None-Match": "*" }) };
          const result = await mutate(target, "PUT", headers, file);
          const report = await reportMutation(result, t('filesBrowser.uploaded', { name: file.name }));
          if (report.failed) failed.push(report.message);
          else uploaded++;
        } catch (error) { failed.push(t('filesBrowser.fileFailure', { name: file.name, message: error instanceof Error ? error.message : t('filesBrowser.resultUnknown') })); }
      }
      await refresh();
      if (status.classList.contains("error")) {
        status.textContent = t(uploaded === 1 ? 'filesBrowser.uploadsAcceptedOne' : 'filesBrowser.uploadsAcceptedMany', { count: uploaded, failed: failed.join("; ") });
        return;
      }
      if (failed.length) { status.textContent = t('filesBrowser.uploadFailed', { uploaded, failedCount: failed.length, failed: failed.join("; ") });
        status.className = "file-status error"; }
      else { status.textContent = t(uploaded === 1 ? 'filesBrowser.fileUploadedOne' : 'filesBrowser.filesUploadedMany', { count: uploaded }); status.className = "file-status muted"; }
    })(); };
    picker.click();
  }, false), folder, control(t('files.refresh'), async () => { if (discardDraft()) await refresh(); }));
  const webdav = node("details");
  const davUrl = `http://127.0.0.1:17890/works/${workId}/files/`;
  webdav.append(node("summary", t('files.connectWebdav')),
    node("p", t('filesBrowser.webdavInstructions')),
    node("code", davUrl), control(t('filesBrowser.copyWebdavUrl'), async () => { await navigator.clipboard.writeText(davUrl); }));
  root.replaceChildren(title, location, actions, status, list, editor, webdav);
  void refresh();
}

function locationOrigin(): string { return globalThis.location.origin; }
