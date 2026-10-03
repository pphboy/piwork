const dav = "DAV:";
const piwork = "urn:piwork:files";
const maxText = 1_048_576;
const mutations = new Set();
function node(tag, text, className) {
    const item = document.createElement(tag);
    if (text !== undefined)
        item.textContent = text;
    if (className)
        item.className = className;
    return item;
}
function control(label, action, secondary = true) {
    const item = node("button", label, secondary ? "secondary" : "primary");
    item.type = "button";
    item.onclick = () => { item.disabled = true; void action().finally(() => { item.disabled = false; }); };
    return item;
}
function child(parent, name) {
    return Array.from(parent.children).find((item) => item.namespaceURI === dav && item.localName === name);
}
function value(parent, name) { return child(parent, name)?.textContent ?? undefined; }
export function parseEntries(xml, base) {
    if (xml.length > 16_777_216 || /<!DOCTYPE|<!ENTITY/i.test(xml))
        throw new Error("File listing contains unsupported XML.");
    const documentXml = new DOMParser().parseFromString(xml, "application/xml");
    if (documentXml.querySelector("parsererror"))
        throw new Error("File listing is malformed.");
    const entries = [];
    for (const response of Array.from(documentXml.getElementsByTagNameNS(dav, "response"))) {
        const href = value(response, "href");
        if (!href || !href.startsWith(base) || href.includes("?") || href.includes("#"))
            throw new Error("File listing contains an invalid path.");
        const propstat = Array.from(response.getElementsByTagNameNS(dav, "propstat")).find((item) => /^HTTP\/1\.1 200\b/.test(value(item, "status") ?? ""));
        const properties = propstat ? child(propstat, "prop") : undefined;
        if (!properties)
            throw new Error("File listing is missing metadata.");
        const type = child(properties, "resourcetype");
        const directory = !!type && Array.from(type.children).some((item) => item.namespaceURI === dav && item.localName === "collection");
        const kind = properties.getElementsByTagNameNS(piwork, "kind")[0]?.textContent ?? (directory ? "directory" : "file");
        const relative = href.slice(base.length).replace(/\/$/, "");
        if (relative.includes("/"))
            continue;
        let name;
        try {
            name = decodeURIComponent(relative);
        }
        catch {
            throw new Error("File name encoding is invalid.");
        }
        const sizeText = value(properties, "getcontentlength");
        entries.push({ href, name: name || "/", kind, directory,
            size: sizeText && /^\d+$/.test(sizeText) ? Number(sizeText) : null,
            modified: value(properties, "getlastmodified") ?? null,
            contentType: value(properties, "getcontenttype") ?? null });
    }
    return entries;
}
export function mutationResults(xml) {
    if (xml.length > 16_777_216 || /<!DOCTYPE|<!ENTITY/i.test(xml))
        throw new Error("WebDAV result contains unsupported XML.");
    const documentXml = new DOMParser().parseFromString(xml, "application/xml");
    if (documentXml.querySelector("parsererror"))
        throw new Error("WebDAV result is malformed.");
    const succeeded = [];
    const failed = [];
    for (const response of Array.from(documentXml.getElementsByTagNameNS(dav, "response"))) {
        const path = value(response, "href") ?? "unknown path";
        const direct = value(response, "status");
        const states = direct ? [direct] : Array.from(response.getElementsByTagNameNS(dav, "propstat"))
            .map((item) => value(item, "status") ?? "");
        if (!states.length)
            throw new Error("WebDAV result is missing a path status.");
        for (const state of states) {
            const match = /^HTTP\/(?:1\.[01]|2) (\d{3})\b/.exec(state);
            if (!match)
                throw new Error("WebDAV result contains an invalid path status.");
            (Number(match[1]) >= 200 && Number(match[1]) < 300 ? succeeded : failed).push(`${path}: ${state}`);
        }
    }
    if (!succeeded.length && !failed.length)
        throw new Error("WebDAV result contains no paths.");
    return { succeeded, failed };
}
function childPath(base, name, directory = false) {
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || /[\x00-\x1f]/.test(name))
        throw new Error("Enter a single valid file name.");
    return `${base}${encodeURIComponent(name)}${directory ? "/" : ""}`;
}
async function request(path, method, csrf, headers = {}, body) {
    const response = await fetch(path, { method, credentials: "same-origin", headers: {
            ...(!["GET", "HEAD", "OPTIONS"].includes(method) ? { "x-piwork-csrf": csrf } : {}), ...headers,
        }, ...(body === undefined ? {} : { body }) });
    if (!response.ok && response.status !== 207) {
        const code = response.headers.get("x-piwork-file-error") ?? `${method} failed (${response.status})`;
        throw new Error(code);
    }
    return response;
}
async function smallFile(response) {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxText) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("This file exceeds the 1 MiB text editor limit.");
    }
    if (!response.body)
        throw new Error("File content is unavailable.");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.length;
            if (size > maxText)
                throw new Error("This file exceeds the 1 MiB text editor limit.");
            chunks.push(value);
        }
    }
    catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
    }
    return data;
}
export function mountFiles(root, workId, getCsrf, setLeaveGuard) {
    const base = `/_desktop/files/works/${encodeURIComponent(workId)}/files/`;
    let path = base;
    let dirty = false;
    const title = node("h2", "Workspace files");
    const location = node("p", "/", "mono muted");
    const actions = node("div", undefined, "toolbar-actions");
    const status = node("p", "", "file-status");
    const list = node("div", undefined, "file-list");
    const editor = node("section", undefined, "file-editor");
    const discardDraft = () => {
        if (!root.isConnected || !dirty)
            return true;
        if (!confirm("Discard unsaved file changes? Choose Cancel to keep editing."))
            return false;
        dirty = false;
        editor.replaceChildren();
        return true;
    };
    setLeaveGuard(discardDraft);
    const showError = (error, action) => {
        status.textContent = `${action}: ${error instanceof Error ? error.message : "unknown result"}. Refresh to confirm the current state.`;
        status.className = "file-status error";
    };
    const mutate = async (target, method, headers = {}, body) => {
        if (mutations.has(workId))
            throw new Error("Another file change is still in progress for this Work.");
        mutations.add(workId);
        try {
            return await request(target, method, getCsrf(), headers, body);
        }
        finally {
            mutations.delete(workId);
        }
    };
    const existing = async (target) => {
        const response = await fetch(target, { method: "PROPFIND", credentials: "same-origin",
            headers: { "x-piwork-csrf": getCsrf(), Depth: "0" } });
        if (response.status === 404)
            return undefined;
        if (response.status !== 207)
            throw new Error(`Could not check destination (${response.status}).`);
        return parseEntries(await response.text(), target).find((item) => item.href === target);
    };
    const reportMutation = async (result, success) => {
        if (result.status !== 207)
            return { message: success, failed: false };
        const paths = mutationResults(await result.text());
        return { message: `WebDAV result · ${paths.succeeded.length} succeeded${paths.succeeded.length ? `: ${paths.succeeded.join("; ")}` : ""}`
                + ` · ${paths.failed.length} failed${paths.failed.length ? `: ${paths.failed.join("; ")}` : ""}. Refresh to confirm the current state.`,
            failed: paths.failed.length > 0 };
    };
    const refresh = async () => {
        status.textContent = "Loading files…";
        try {
            const response = await request(path, "PROPFIND", getCsrf(), { Depth: "1" });
            if (response.status !== 207)
                throw new Error(`Unexpected listing status ${response.status}`);
            const entries = parseEntries(await response.text(), path).filter((item) => item.href !== path);
            if (!root.isConnected)
                return false;
            location.textContent = decodeURIComponent(path.slice(base.length)) || "/";
            list.replaceChildren();
            editor.replaceChildren();
            dirty = false;
            const parent = path.slice(0, -1).lastIndexOf("/");
            if (path !== base && parent >= base.length - 1)
                list.append(control("Up one folder", async () => {
                    if (!discardDraft())
                        return;
                    path = path.slice(0, parent + 1);
                    await refresh();
                }));
            if (!entries.length)
                list.append(node("p", "This folder is empty.", "empty-state"));
            for (const entry of entries) {
                const row = node("div", undefined, "file-row");
                const name = control(`${entry.directory ? "Folder" : entry.kind === "file" ? "File" : "Special"} · ${entry.name}`, async () => {
                    if (!discardDraft())
                        return;
                    if (entry.directory) {
                        path = entry.href;
                        await refresh();
                    }
                    else
                        await openFile(entry);
                }, true);
                name.classList.add("file-name");
                const detail = [entry.kind, entry.contentType, entry.size === null ? null : `${entry.size} bytes`, entry.modified]
                    .filter((item) => !!item).join(" · ");
                row.append(name, node("span", detail, "file-meta muted"));
                if (entry.kind === "file") {
                    const download = node("a", "Download");
                    download.href = entry.href;
                    download.download = entry.name;
                    row.append(download);
                }
                const menu = node("details", undefined, "file-actions");
                const summary = node("summary", "More");
                const form = node("form", undefined, "file-action-form");
                const action = node("select");
                action.setAttribute("aria-label", `Action for ${entry.name}`);
                for (const choice of ["rename", "move", "copy", "delete"]) {
                    const option = node("option", choice[0].toUpperCase() + choice.slice(1));
                    option.value = choice;
                    action.append(option);
                }
                const targetLabel = node("label", "New name", "form-field");
                const target = node("input");
                target.type = "text";
                target.setAttribute("aria-label", `Destination for ${entry.name}`);
                targetLabel.append(target);
                const impact = node("p", "Destination is relative to this Work's workspace root and includes the final name.", "muted");
                const submit = node("button", "Rename", "primary");
                submit.type = "submit";
                const update = () => {
                    targetLabel.hidden = action.value === "delete";
                    targetLabel.firstChild.textContent = action.value === "rename" ? "New name" : "Destination path";
                    submit.textContent = action.value[0].toUpperCase() + action.value.slice(1);
                    impact.textContent = action.value === "delete"
                        ? `Deleting ${entry.name}${entry.directory ? " and its contents" : ""} cannot be undone in Desktop.`
                        : action.value === "rename" ? "Enter one new name in this folder." : "Enter a path within this Work, including the final name.";
                };
                action.onchange = update;
                update();
                const cancel = control("Cancel", async () => { menu.open = false; summary.focus(); });
                form.append(action, targetLabel, impact, submit, cancel);
                form.onkeydown = (event) => { if (event.key === "Escape") {
                    event.preventDefault();
                    menu.open = false;
                    summary.focus();
                } };
                form.onsubmit = (event) => {
                    event.preventDefault();
                    submit.disabled = true;
                    void (async () => {
                        try {
                            if (action.value === "delete") {
                                if (!confirm(`Delete ${entry.name}${entry.directory ? " and its contents" : ""}? This cannot be undone in Desktop.`)) {
                                    menu.open = false;
                                    return;
                                }
                                if (!discardDraft())
                                    return;
                                const result = await mutate(entry.href, "DELETE");
                                const report = await reportMutation(result, `${entry.name} deleted.`);
                                if (await refresh()) {
                                    status.textContent = report.message;
                                    status.className = report.failed ? "file-status error" : "file-status muted";
                                }
                            }
                            else {
                                const desired = target.value.trim();
                                if (!desired)
                                    throw new Error("Enter a destination.");
                                let destination;
                                if (action.value === "rename")
                                    destination = childPath(path, desired, entry.directory);
                                else {
                                    const parts = desired.split("/");
                                    if (desired.startsWith("/") || desired.includes("\\") || parts.some((part) => !part || part === "." || part === ".." || /[\x00-\x1f]/.test(part)))
                                        throw new Error("Destination must be a path inside this Work.");
                                    destination = `${base}${parts.map((part) => encodeURIComponent(part)).join("/")}${entry.directory ? "/" : ""}`;
                                }
                                const collision = await existing(destination);
                                if (collision && !confirm(`Replace ${collision.name} at the destination? Existing content may be lost.`)) {
                                    menu.open = false;
                                    return;
                                }
                                if (!discardDraft())
                                    return;
                                const method = action.value === "copy" ? "COPY" : "MOVE";
                                const result = await mutate(entry.href, method, { Destination: locationOrigin() + destination, Overwrite: collision ? "T" : "F" });
                                const report = await reportMutation(result, `${entry.name} ${action.value} accepted.`);
                                if (await refresh()) {
                                    status.textContent = report.message;
                                    status.className = report.failed ? "file-status error" : "file-status muted";
                                }
                            }
                        }
                        catch (error) {
                            showError(error, action.value);
                        }
                        finally {
                            submit.disabled = false;
                        }
                    })();
                };
                menu.append(summary, form);
                row.append(menu);
                list.append(row);
            }
            status.textContent = `Files last checked ${new Date().toLocaleTimeString("en-US")}.`;
            status.className = "file-status muted";
            return true;
        }
        catch (error) {
            showError(error, "File listing");
            list.replaceChildren();
            return false;
        }
    };
    const openFile = async (entry) => {
        editor.replaceChildren(node("h3", entry.name));
        if (entry.kind !== "file") {
            editor.append(node("p", "This special item cannot be edited here. Use a compatible external tool if needed."));
            return;
        }
        if (entry.size !== null && entry.size > maxText) {
            editor.append(node("p", "This file is larger than the 1 MiB text editor limit. Download it to edit elsewhere."));
            return;
        }
        try {
            const response = await request(entry.href, "GET", getCsrf());
            const data = await smallFile(response);
            const bom = data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf;
            const original = new TextDecoder("utf-8", { fatal: true }).decode(bom ? data.subarray(3) : data);
            if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(original))
                throw new Error("This file contains binary control bytes. Download it to edit elsewhere.");
            const withoutCrLf = original.replace(/\r\n/g, "");
            if (withoutCrLf.includes("\r") || original.includes("\r\n") && withoutCrLf.includes("\n"))
                throw new Error("This file has mixed or legacy line endings. Download it to edit without changing them.");
            const crlf = original.includes("\r\n");
            const text = crlf ? original.replace(/\r\n/g, "\n") : original;
            const input = node("textarea");
            input.value = text;
            input.setAttribute("aria-label", `Edit ${entry.name}`);
            input.oninput = () => { dirty = input.value !== text; };
            editor.append(input, control("Save file", async () => {
                if (!dirty)
                    return;
                status.textContent = `Saving ${entry.name}…`;
                status.className = "file-status muted";
                try {
                    const headers = { "Content-Type": "application/octet-stream" };
                    if (entry.modified)
                        headers["If-Unmodified-Since"] = entry.modified;
                    const encoded = new TextEncoder().encode(crlf ? input.value.replace(/\n/g, "\r\n") : input.value);
                    const bytes = bom ? new Uint8Array(encoded.length + 3) : encoded;
                    if (bom) {
                        bytes.set([0xef, 0xbb, 0xbf]);
                        bytes.set(encoded, 3);
                    }
                    const result = await mutate(entry.href, "PUT", headers, bytes);
                    const report = await reportMutation(result, `${entry.name} saved.`);
                    if (report.failed) {
                        status.textContent = report.message;
                        status.className = "file-status error";
                        return;
                    }
                    dirty = false;
                    if (await refresh())
                        status.textContent = report.message;
                }
                catch (error) {
                    showError(error, "Save file");
                }
            }, false), control("Discard", async () => { if (!dirty || confirm(`Discard unsaved changes to ${entry.name}?`)) {
                dirty = false;
                editor.replaceChildren();
            } }));
        }
        catch (error) {
            editor.append(node("p", error instanceof Error ? error.message : "This file cannot be edited here.", "error"));
        }
    };
    const folder = node("details", undefined, "new-folder");
    const folderSummary = node("summary", "New folder");
    const folderForm = node("form", undefined, "new-folder-form");
    const folderName = node("input");
    folderName.type = "text";
    folderName.setAttribute("aria-label", "New folder name");
    const createFolder = node("button", "Create folder", "primary");
    createFolder.type = "submit";
    folderForm.append(folderName, createFolder, control("Cancel", async () => { folder.open = false; folderSummary.focus(); }));
    folderForm.onkeydown = (event) => { if (event.key === "Escape") {
        event.preventDefault();
        folder.open = false;
        folderSummary.focus();
    } };
    folderForm.onsubmit = (event) => {
        event.preventDefault();
        createFolder.disabled = true;
        void (async () => {
            try {
                const target = childPath(path, folderName.value.trim(), true);
                if (!discardDraft())
                    return;
                const result = await mutate(target, "MKCOL");
                const report = await reportMutation(result, "Folder created.");
                if (report.failed) {
                    status.textContent = report.message;
                    status.className = "file-status error";
                    return;
                }
                folderName.value = "";
                folder.open = false;
                if (await refresh())
                    status.textContent = report.message;
            }
            catch (error) {
                showError(error, "New folder");
            }
            finally {
                createFolder.disabled = false;
            }
        })();
    };
    folder.append(folderSummary, folderForm);
    actions.append(control("Upload", async () => {
        const picker = node("input");
        picker.type = "file";
        picker.multiple = true;
        picker.onchange = () => {
            void (async () => {
                if (!discardDraft())
                    return;
                const failed = [];
                let uploaded = 0;
                for (const file of Array.from(picker.files ?? [])) {
                    try {
                        const target = childPath(path, file.name);
                        const previous = await existing(target);
                        if (previous && !confirm(`Replace existing file ${file.name} in this folder? Its previous bytes will be lost.`))
                            continue;
                        const headers = { "Content-Type": "application/octet-stream",
                            ...(previous ? previous.modified ? { "If-Unmodified-Since": previous.modified } : {} : { "If-None-Match": "*" }) };
                        const result = await mutate(target, "PUT", headers, file);
                        const report = await reportMutation(result, `${file.name} uploaded.`);
                        if (report.failed)
                            failed.push(report.message);
                        else
                            uploaded++;
                    }
                    catch (error) {
                        failed.push(`${file.name}: ${error instanceof Error ? error.message : "result unknown"}`);
                    }
                }
                await refresh();
                if (status.classList.contains("error")) {
                    status.textContent = `${uploaded} upload${uploaded === 1 ? "" : "s"} accepted; file listing is unavailable. ${failed.join("; ")}`;
                    return;
                }
                if (failed.length) {
                    status.textContent = `${uploaded} uploaded; ${failed.length} failed: ${failed.join("; ")}. Refresh to check unknown results.`;
                    status.className = "file-status error";
                }
                else {
                    status.textContent = `${uploaded} file${uploaded === 1 ? "" : "s"} uploaded.`;
                    status.className = "file-status muted";
                }
            })();
        };
        picker.click();
    }, false), folder, control("Refresh files", async () => { if (discardDraft())
        await refresh(); }));
    const webdav = node("details");
    const davUrl = `http://127.0.0.1:17890/works/${workId}/files/`;
    webdav.append(node("summary", "Connect with WebDAV"), node("p", "Run piwork-cli proxy in a separate terminal. In your WebDAV client, use the server URL below and username piwork. Read the temporary password only from that proxy terminal; it changes on restart. If you started proxy with --port, replace 17890 in the URL."), node("code", davUrl), control("Copy default WebDAV URL", async () => { await navigator.clipboard.writeText(davUrl); }));
    root.replaceChildren(title, location, actions, status, list, editor, webdav);
    void refresh();
}
function locationOrigin() { return globalThis.location.origin; }
//# sourceMappingURL=files.js.map