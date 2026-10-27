import { modelErrors } from './model-form.js';
import { t, LocalizedMessage, messageText } from './locale.js';
export class ConsoleError extends Error {
    code;
    retryAfterMs;
    correlationId;
    field;
    feedback;
    constructor(code, message, retryAfterMs = 0, correlationId = "", field = "") {
        super(messageText(message));
        this.code = code;
        this.retryAfterMs = retryAfterMs;
        this.correlationId = correlationId;
        this.field = field;
        this.feedback = message;
        if (message != null && typeof message !== 'string')
            this.setLocalizedMessage(message);
    }
    /** Re-render a locally generated message in the current language. */
    setLocalizedMessage(message) {
        Object.defineProperty(this, 'message', { get: () => messageText(message), configurable: true });
    }
}
const codeAliases = {
    CORE_UNAVAILABLE: "CORE_UNREACHABLE", SKILL_IN_DEFAULTS: "DEFAULT_REFERENCE",
    PI_PACKAGE_IN_DEFAULTS: "DEFAULT_REFERENCE", PI_PACKAGE_BUSY: "PACKAGE_BUSY",
    LAST_ADMINISTRATOR: "LAST_ADMIN", AUTH_REQUIRED: "SESSION_EXPIRED",
};
const explanations = {
    MODEL_IN_USE: new LocalizedMessage('adapter.explain.MODEL_IN_USE'),
    MODEL_TEST_BUSY: new LocalizedMessage('adapter.explain.MODEL_TEST_BUSY'),
    DEFAULT_WORK_NOT_CONFIGURED: new LocalizedMessage('adapter.explain.DEFAULT_WORK_NOT_CONFIGURED'),
    CORE_UNREACHABLE: new LocalizedMessage('adapter.explain.CORE_UNREACHABLE'),
    SESSION_EXPIRED: new LocalizedMessage('adapter.explain.SESSION_EXPIRED'),
    ADMIN_ONLY: new LocalizedMessage('adapter.explain.ADMIN_ONLY'),
    AUTHENTICATION_FAILED: new LocalizedMessage('adapter.explain.AUTHENTICATION_FAILED'),
    LAST_ADMIN: new LocalizedMessage('adapter.explain.LAST_ADMIN'),
    DEFAULT_REFERENCE: new LocalizedMessage('adapter.explain.DEFAULT_REFERENCE'),
    PACKAGE_BUSY: new LocalizedMessage('adapter.explain.PACKAGE_BUSY'),
    OPERATION_UNAVAILABLE: new LocalizedMessage('adapter.explain.OPERATION_UNAVAILABLE'),
};
const invalidFields = {
    baseUrl: new LocalizedMessage('adapter.invalid.baseUrl'),
    credential: new LocalizedMessage('adapter.invalid.credential'),
    model: new LocalizedMessage('adapter.invalid.model'),
    modelRef: new LocalizedMessage('adapter.invalid.modelRef'),
    name: new LocalizedMessage('adapter.invalid.name'),
    api: new LocalizedMessage('adapter.invalid.api'),
    agentImage: new LocalizedMessage('adapter.invalid.agentImage'),
    capabilities: new LocalizedMessage('adapter.invalid.capabilities'),
};
function errorFrom(value, status, write, login = false) {
    const raw = String(value.code ?? value.error?.code ?? "REQUEST_FAILED");
    const code = status === 401 && !login ? "SESSION_EXPIRED" : codeAliases[raw] ?? raw;
    const uncertain = write && status >= 500 && !["CORE_UNAVAILABLE", "CORE_ADMIN_API_UNAVAILABLE"].includes(raw);
    const field = typeof value.field === 'string' ? value.field : typeof value.error?.field === 'string' ? value.error.field : '';
    const fieldMessage = code === 'INVALID_REQUEST' ? invalidFields[field.split('.')[0]] : undefined;
    const fallback = uncertain ? new LocalizedMessage('adapter.error.resultUnknown')
        : fieldMessage ?? (code === 'INVALID_REQUEST' ? new LocalizedMessage('adapter.error.invalidRequest') : undefined) ?? explanations[code] ?? new LocalizedMessage('adapter.error.unknown', { code });
    return new ConsoleError(uncertain ? "RESULT_UNKNOWN" : code, fallback, Number(value.retryAfterMs ?? 60000), typeof value.correlationId === "string" ? value.correlationId : "", field);
}
function userView(value) {
    return { id: value.id, account: value.account, role: value.role === "admin" ? "Administrator" : "User", enabled: value.enabled,
        createdAt: value.createdAt ?? "", updatedAt: value.updatedAt ?? "" };
}
function runtimeView(value) {
    if (value?.configured === false)
        return null;
    if (value?.configured !== true || typeof value.agentImage !== "string" || typeof value.model?.provider !== "string" || typeof value.model?.id !== "string" || typeof value.model?.credentialAvailable !== "boolean")
        throw new ConsoleError("INVALID_RESPONSE", new LocalizedMessage("adapter.error.runtimeIncomplete"));
    return { ...(typeof value.modelRef === 'string' ? { modelRef: value.modelRef } : {}), agentImage: value.agentImage, provider: value.model.provider, modelId: value.model.id,
        baseUrl: value.model.baseUrl ?? "", credentialAvailable: value.model.credentialAvailable, updatedAt: value.updatedAt };
}
function defaultsView(value) {
    if (!value.configuration)
        return null;
    const c = value.configuration;
    return { agentImage: value.baseImage ?? c.agentImage ?? "", skills: c.skills ?? [],
        packages: (c.packages ?? []).map((p) => typeof p === "string" ? p : p.name),
        agentsMd: c.agentsMd ?? "", networkMode: c.networkMode ?? t('ui.notProvided'), workspacePolicy: c.workspacePolicy ?? t('ui.notProvided'),
        updatedAt: value.updatedAt ?? "", publicConfiguration: c };
}
function packageView(value) {
    const source = value.sourceKind;
    return { name: value.name, enabled: value.enabled, version: value.version ?? null,
        sourceKind: source === "git" ? "Git" : source === "local" ? "Local directory" : source === "zip" || source === "upload" ? "ZIP" : "npm",
        resolvedSource: typeof value.resolvedSource === "string" ? value.resolvedSource : value.resolvedSource ? JSON.stringify(value.resolvedSource) : t('ui.notProvided'),
        updatedAt: value.updatedAt ?? "", resources: value.resourceCounts ? Object.values(value.resourceCounts).reduce((n, x) => n + Number(x), 0) : null };
}
function operationView(value, intent) {
    if (typeof value.operationId !== "string" || typeof value.state !== "string")
        throw new ConsoleError("INVALID_RESPONSE", new LocalizedMessage("adapter.error.operationInvalid"));
    return { id: value.operationId, packageName: value.packageName ?? value.name ?? value.result?.name ?? t('adapter.value.identityPending'),
        state: ["succeeded", "failed", "superseded"].includes(value.state) ? value.state : "running",
        packagePhase: value.packagePhase ?? "", createdAt: value.createdAt ?? "", updatedAt: value.updatedAt ?? "",
        result: value.result ? JSON.stringify(value.result, null, 2) : null,
        ...(value.error ? { diagnostic: { stage: value.error.stage ?? value.stage ?? "", code: value.error.code ?? "", message: value.error.message ?? "" } } : {}),
        polls: 0, sourceKind: intent?.kind ?? "npm", source: intent?.source ?? "", addDefault: intent?.addDefault ?? false,
        ...(intent?.target ? { target: intent.target } : {}) };
}
export class ConsoleAdapter {
    about() { return this.request('about'); }
    scenario = "normal";
    session = false;
    currentUserId = "";
    account = "";
    coreUrl = "";
    lastHealth = null;
    availability = null;
    store = { users: [], skills: [], packages: [], runtime: null, defaults: null, operations: [] };
    csrf = "";
    epoch = 0;
    get identityEpoch() { return this.epoch; }
    get csrfToken() { return this.csrf; }
    reads = new Map();
    intents = new Map();
    request(path, method = "GET", body, login = false) {
        if (method !== 'GET')
            return this.requestOnce(path, method, body, login);
        const key = `${this.epoch}:${path}`, old = this.reads.get(key);
        if (old)
            return old;
        const pending = this.requestOnce(path, method, body, login).finally(() => { if (this.reads.get(key) === pending)
            this.reads.delete(key); });
        this.reads.set(key, pending);
        return pending;
    }
    async requestOnce(path, method = "GET", body, login = false) {
        const epoch = this.epoch;
        let response;
        try {
            response = await fetch(`/console/api/${path}`, { method, credentials: "same-origin",
                headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(method !== "GET" ? { "X-Csrf-Token": this.csrf } : {}) },
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        }
        catch {
            throw new ConsoleError(method === "GET" ? "CORE_UNREACHABLE" : "RESULT_UNKNOWN", method === "GET" ? new LocalizedMessage('adapter.explain.CORE_UNREACHABLE') : new LocalizedMessage('adapter.error.writeLost'));
        }
        if (epoch !== this.epoch)
            throw new ConsoleError("SESSION_CHANGED", new LocalizedMessage('adapter.error.accountChanged'));
        if (response.status === 204)
            return {};
        const value = await response.json().catch(() => null);
        if (epoch !== this.epoch)
            throw new ConsoleError('SESSION_CHANGED', new LocalizedMessage('adapter.error.accountChangedRead'));
        if (!value || typeof value !== "object")
            throw new ConsoleError(method === "GET" ? "INVALID_RESPONSE" : "RESULT_UNKNOWN", new LocalizedMessage('adapter.error.invalidResponse'));
        if (!response.ok) {
            const error = errorFrom(value, response.status, method !== "GET", login);
            if (error.code === "SESSION_EXPIRED") {
                this.clearIdentity();
                if (document.querySelector('meta[name="piwork-mode"]')?.getAttribute('content') === 'hosted')
                    location.assign('/login');
            }
            throw error;
        }
        return value;
    }
    clearIdentity() {
        this.epoch++;
        this.session = false;
        this.currentUserId = "";
        this.account = "";
        this.coreUrl = "";
        this.intents.clear();
        this.store = { users: [], skills: [], packages: [], runtime: null, defaults: null, operations: [] };
    }
    async initialize() {
        const value = await this.request("session");
        this.csrf = value.csrfToken ?? "";
        if (this.currentUserId && this.currentUserId !== (value.user?.id ?? ""))
            this.clearIdentity();
        this.session = value.authenticated === true;
        this.currentUserId = value.user?.id ?? "";
        this.account = value.user?.account ?? "";
        this.coreUrl = typeof value.coreUrl === 'string' ? value.coreUrl : "";
        return this.session;
    }
    async guard(_write = false) {
        await this.initialize();
        if (!this.session)
            throw new ConsoleError("SESSION_EXPIRED", new LocalizedMessage('adapter.explain.SESSION_EXPIRED'));
    }
    async login(account, password) {
        if (!this.csrf)
            await this.initialize();
        const value = await this.request("login", "POST", { account, password }, true);
        this.csrf = value.csrfToken;
        this.session = true;
        this.currentUserId = value.user.id;
        this.account = value.user.account;
        this.coreUrl = typeof value.coreUrl === 'string' ? value.coreUrl : "";
    }
    async connection() {
        const value = await this.request("availability");
        this.availability = value;
        if (!value.reachable)
            throw new ConsoleError("CORE_UNREACHABLE", new LocalizedMessage('adapter.explain.CORE_UNREACHABLE'));
        return value;
    }
    async signOut() { await this.request("logout", "POST", {}); this.clearIdentity(); await this.initialize(); }
    async health() {
        const [status, process] = await Promise.all([this.request("admin/status"), this.request("health")]);
        this.lastHealth = { reachable: true, healthy: process.healthy === true, ready: status.ready === true,
            reason: typeof status.state === 'string' ? status.state : '', checkedAt: new Date().toISOString(),
            checks: Object.entries(status.checks ?? {}).map(([name, state]) => ({ name, state: state === true ? true : state === false ? false : null, detail: "" })) };
        return this.lastHealth;
    }
    async users() { this.store.users = (await this.request("admin/users")).users.map(userView); return this.store.users; }
    async createUser(input) {
        const value = await this.request("admin/users", "POST", { ...input, role: input.role === "Administrator" ? "admin" : "user" });
        if (typeof value.id !== "string" || value.account !== input.account || typeof value.enabled !== "boolean")
            throw new ConsoleError("RESULT_UNKNOWN", new LocalizedMessage('adapter.error.createUser'));
        return userView(value);
    }
    async userAction(id, action, password) {
        await this.request(`admin/users/${encodeURIComponent(id)}/${action === "reset" ? "reset-credential" : action}`, "POST", action === "reset" ? { password } : {});
        const selfRevoked = id === this.currentUserId && (action === "reset" || action === "disable");
        if (selfRevoked)
            this.clearIdentity();
        return { selfRevoked };
    }
    async runtime() { this.store.runtime = runtimeView(await this.request("admin/runtime")); return this.store.runtime; }
    async runtimeDefaults() {
        const value = await this.request('admin/runtime-defaults');
        if (typeof value.agentImage !== 'string' || !value.agentImage)
            throw new ConsoleError('RELEASE_DEFAULTS_UNAVAILABLE', new LocalizedMessage('adapter.error.releaseAgent'));
        return value.agentImage;
    }
    async modelRequest(resource, method = 'GET', body) {
        try {
            return await this.request(`admin/${resource}`, method, body);
        }
        catch (error) {
            if ((resource === 'models' || resource.startsWith('models/') || resource === 'model-tests') && error instanceof ConsoleError && error.code === 'INVALID_REQUEST' && modelErrors[error.field.split('.')[0]])
                throw new ConsoleError('INVALID_REQUEST', modelErrors[error.field.split('.')[0]], error.retryAfterMs, error.correlationId, error.field);
            if (resource === 'model-tests' && error instanceof ConsoleError && error.code === 'RESULT_UNKNOWN')
                throw new ConsoleError('TEST_RESULT_UNAVAILABLE', new LocalizedMessage('adapter.error.testUnconfirmed'), error.retryAfterMs, error.correlationId);
            throw error;
        }
    }
    async saveRuntimeSelection(modelRef) {
        const value = await this.request('admin/runtime', 'PUT', { modelRef });
        try {
            this.store.runtime = runtimeView(value.runtime);
        }
        catch {
            throw new ConsoleError('RESULT_UNKNOWN', new LocalizedMessage('adapter.error.readRuntime'));
        }
        return this.store.runtime;
    }
    async saveRuntime(input, apiKey) {
        const value = await this.request("admin/runtime", "PUT", { provider: input.provider, model: input.modelId,
            ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}), credential: apiKey });
        try {
            this.store.runtime = runtimeView(value.runtime);
        }
        catch {
            throw new ConsoleError("RESULT_UNKNOWN", new LocalizedMessage('adapter.error.runtimeAcceptIncomplete'));
        }
        return this.store.runtime;
    }
    async defaults() { this.store.defaults = defaultsView(await this.request("admin/default-work")); return this.store.defaults; }
    async saveDefaults(patch) {
        const { agentImage, ...other } = patch;
        this.store.defaults = defaultsView(await this.request("admin/default-work", "PATCH", { ...other, ...(agentImage !== undefined ? { baseImage: agentImage } : {}) }));
        return this.store.defaults;
    }
    async skills() {
        this.store.skills = (await this.request("admin/skills")).skills.map((s) => ({ name: s.name, enabled: s.enabled,
            source: s.source ?? t('ui.notProvided'), updatedAt: s.updatedAt ?? "", files: s.fileCount, bytes: s.totalBytes }));
        return this.store.skills;
    }
    async packages() { this.store.packages = (await this.request("admin/packages")).packages.map(packageView); return this.store.packages; }
    async packageDetails(name) { return packageView(await this.request(`admin/packages/${encodeURIComponent(name)}`)); }
    async catalogAction(kind, name, action) {
        await this.request(`admin/${kind}/${encodeURIComponent(name)}${action === "remove" ? "" : `/${action}`}`, action === "remove" ? "DELETE" : "POST", action === "remove" ? undefined : {});
    }
    async upload(path, body, method, progress) {
        const epoch = this.epoch;
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(method, `/console/api/${path}`);
            xhr.withCredentials = true;
            xhr.setRequestHeader("X-Csrf-Token", this.csrf);
            if (body instanceof File) {
                xhr.setRequestHeader("Content-Type", "application/zip");
                xhr.setRequestHeader("X-Piwork-Package-Name", encodeURIComponent(body.name));
            }
            xhr.upload.onprogress = e => progress?.(e.loaded, e.lengthComputable ? e.total : 0);
            xhr.onload = () => {
                if (epoch !== this.epoch) {
                    reject(new ConsoleError("SESSION_CHANGED", new LocalizedMessage('adapter.error.accountChangedUpload')));
                    return;
                }
                let value = {};
                try {
                    value = JSON.parse(xhr.responseText);
                }
                catch { /* handled below */ }
                if (xhr.status >= 200 && xhr.status < 300)
                    resolve(value);
                else
                    reject(errorFrom(value, xhr.status, true));
            };
            xhr.onerror = () => reject(new ConsoleError("RESULT_UNKNOWN", new LocalizedMessage('adapter.error.uploadLost')));
            xhr.onabort = xhr.onerror;
            xhr.send(body);
        });
    }
    async uploadSkill(selection, target, progress) {
        const body = new FormData();
        body.append("directoryName", selection.name);
        for (const file of selection.files)
            body.append("files", file, encodeURIComponent(file.webkitRelativePath.split("/").slice(1).join("/")));
        const value = await this.upload(`admin/skills${target ? `/${encodeURIComponent(target)}` : ""}`, body, target ? "PUT" : "POST", progress);
        if (typeof value.name !== 'string')
            throw new ConsoleError('RESULT_UNKNOWN', new LocalizedMessage('adapter.error.skillConfirm'));
        return { name: value.name };
    }
    async submitPackage(intent, progress, _bytes = 0, selection) {
        let saved = this.intents.get(intent.key);
        if (!saved) {
            let source;
            if (intent.kind === "ZIP" || intent.kind === "Local directory") {
                if (!selection)
                    throw new ConsoleError("FILES_REQUIRED", new LocalizedMessage('adapter.error.filesRequired'));
                const body = new FormData();
                if (intent.kind === "ZIP")
                    body.append("zip", selection.files[0]);
                else {
                    body.append("directoryName", selection.files[0].webkitRelativePath.split("/")[0]);
                    for (const file of selection.files)
                        body.append("files", file, encodeURIComponent(file.webkitRelativePath.split("/").slice(1).join("/")));
                }
                const upload = await this.upload(`package-inputs/${intent.kind === "ZIP" ? "zip" : "directory"}`, intent.kind === "ZIP" ? selection.files[0] : body, "POST", progress);
                source = { kind: "upload", uploadId: upload.uploadId };
            }
            else
                source = { kind: intent.kind === "Git" ? "git" : "npm", spec: intent.source };
            saved = { source, intent: { ...intent } };
            this.intents.set(intent.key, saved);
        }
        else if (JSON.stringify(saved.intent) !== JSON.stringify(intent))
            throw new ConsoleError("INTENT_CONFLICT", new LocalizedMessage('adapter.error.intentConflict'));
        let accepted;
        try {
            accepted = await this.request(`admin/packages${intent.target ? `/${encodeURIComponent(intent.target)}/update` : ""}`, "POST", { source: saved.source, idempotencyKey: intent.key, ...(!intent.target && intent.addDefault ? { addToDefaults: true } : {}) });
        }
        catch (e) {
            if (e instanceof ConsoleError && ["RESULT_UNKNOWN", "CORE_UNREACHABLE"].includes(e.code))
                throw new ConsoleError("ACCEPTANCE_UNKNOWN", new LocalizedMessage('adapter.error.acceptanceLost'));
            throw e;
        }
        if (typeof accepted.operationId !== "string" || !accepted.operationId)
            throw new ConsoleError("ACCEPTANCE_UNKNOWN", new LocalizedMessage('adapter.error.acceptanceNoId'));
        const op = operationView({ operationId: accepted.operationId, state: "accepted", packagePhase: "" }, intent);
        this.store.operations = [op];
        return op;
    }
    async operation(id, intent) {
        const value = await this.request(`admin/operations/${encodeURIComponent(id)}`);
        const previous = this.store.operations.find(o => o.id === id);
        const op = operationView(value, intent ?? (previous ? { key: "", kind: previous.sourceKind, source: previous.source, name: previous.packageName, addDefault: previous.addDefault, ...(previous.target ? { target: previous.target } : {}) } : undefined));
        this.store.operations = [op];
        return op;
    }
}
export const adapter = new ConsoleAdapter();
export async function inspectSkillFiles(files, target) {
    if (!files.length)
        throw new ConsoleError("NO_FILES", new LocalizedMessage('adapter.inspect.noFilesSkill'));
    const name = files[0].webkitRelativePath.split("/")[0];
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name))
        throw new ConsoleError("NAME_INVALID", new LocalizedMessage('adapter.inspect.nameInvalid'));
    if (target && name !== target)
        throw new ConsoleError("NAME_MISMATCH", new LocalizedMessage('adapter.inspect.nameMismatch', { target }));
    if (!files.some((f) => f.webkitRelativePath === `${name}/SKILL.md`))
        throw new ConsoleError("MANIFEST_MISSING", new LocalizedMessage('adapter.inspect.skillManifest'));
    const bytes = files.reduce((n, f) => n + f.size, 0);
    if (files.length > 2048 ||
        bytes > 32 * 1024 * 1024 ||
        files.some((f) => f.size > 8 * 1024 * 1024))
        throw new ConsoleError("UPLOAD_LIMIT", new LocalizedMessage('adapter.inspect.skillLimit'));
    return { name, files, bytes, summary: t('adapter.summary.files', { count: files.length }) };
}
export async function inspectPackageFiles(files, kind) {
    if (!files.length)
        throw new ConsoleError("NO_FILES", new LocalizedMessage('adapter.inspect.noFilesPackage'));
    const bytes = files.reduce((n, f) => n + f.size, 0);
    if (kind === "ZIP") {
        if (!files[0].name.toLowerCase().endsWith(".zip"))
            throw new ConsoleError("ZIP_REQUIRED", new LocalizedMessage('adapter.inspect.zipRequired'));
        if (bytes > 256 * 1024 * 1024)
            throw new ConsoleError("UPLOAD_LIMIT", new LocalizedMessage('adapter.inspect.zipLimit'));
        const name = await inspectZipName(files[0]);
        return { name, files, bytes, summary: files[0].name };
    }
    const root = files[0].webkitRelativePath.split("/")[0];
    const manifest = files.find((f) => f.webkitRelativePath === root + "/package.json");
    if (!manifest)
        throw new ConsoleError("MANIFEST_MISSING", new LocalizedMessage('adapter.inspect.packageManifest'));
    if (manifest.size > 1048576 ||
        bytes > 1073741824 ||
        files.length > 100000 ||
        files.some((f) => f.size > 67108864 || f.webkitRelativePath.split("/").length > 65))
        throw new ConsoleError("UPLOAD_LIMIT", new LocalizedMessage('adapter.inspect.packageLimit'));
    let data;
    try {
        data = JSON.parse(await manifest.text());
    }
    catch {
        throw new ConsoleError("MANIFEST_INVALID", new LocalizedMessage('adapter.inspect.manifestJson'));
    }
    if (typeof data.name !== "string" || !data.name.trim())
        throw new ConsoleError("NAME_MISSING", new LocalizedMessage('adapter.inspect.nameMissing'));
    return {
        name: data.name,
        files,
        bytes,
        summary: t('adapter.summary.rootFiles', { root, count: files.length }),
    };
}
/** Browser manifest preflight; full trust/security validation still belongs to Core. */
async function inspectZipName(file) {
    const data = await file.arrayBuffer(), view = new DataView(data);
    let end = -1;
    for (let i = data.byteLength - 22; i >= Math.max(0, data.byteLength - 65557); i--)
        if (view.getUint32(i, true) === 0x06054b50) {
            end = i;
            break;
        }
    if (end < 0)
        throw new ConsoleError("ZIP_INVALID", new LocalizedMessage('adapter.inspect.zipRead'));
    const count = view.getUint16(end + 10, true);
    let pos = view.getUint32(end + 16, true), expanded = 0;
    const entries = [];
    try {
        for (let i = 0; i < count; i++) {
            if (view.getUint32(pos, true) !== 0x02014b50)
                throw new Error("central");
            const size = view.getUint32(pos + 24, true), compressed = view.getUint32(pos + 20, true), length = view.getUint16(pos + 28, true), extra = view.getUint16(pos + 30, true), comment = view.getUint16(pos + 32, true);
            const name = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(data, pos + 46, length));
            if (name.startsWith("/") ||
                name.includes("\\") ||
                name.split("/").includes(".."))
                throw new Error("unsafe");
            expanded += size;
            if (expanded > 1073741824 ||
                size > 67108864 ||
                name.split("/").filter(Boolean).length > 64)
                throw new Error("limit");
            entries.push({
                name,
                method: view.getUint16(pos + 10, true),
                flags: view.getUint16(pos + 8, true),
                size,
                compressed,
                offset: view.getUint32(pos + 42, true),
            });
            pos += 46 + length + extra + comment;
        }
    }
    catch {
        throw new ConsoleError("ZIP_INVALID", new LocalizedMessage('adapter.inspect.zipInvalid'));
    }
    const manifests = entries.filter((e) => e.name === "package.json" || /^[^/]+\/package\.json$/.test(e.name));
    if (manifests.length !== 1)
        throw new ConsoleError("MANIFEST_MISSING", new LocalizedMessage('adapter.inspect.manifestRoot'));
    const manifest = manifests[0];
    const root = manifest.name === "package.json" ? "" : manifest.name.slice(0, -12);
    if (root && entries.some((e) => !e.name.startsWith(root)))
        throw new ConsoleError("ZIP_ROOT_INVALID", new LocalizedMessage('adapter.inspect.zipRoot'));
    if (manifest.size > 1048576 || manifest.flags & 1)
        throw new ConsoleError("MANIFEST_INVALID", new LocalizedMessage('adapter.inspect.manifestLimit'));
    try {
        if (view.getUint32(manifest.offset, true) !== 0x04034b50)
            throw new Error("header");
        const start = manifest.offset +
            30 +
            view.getUint16(manifest.offset + 26, true) +
            view.getUint16(manifest.offset + 28, true);
        let payload;
        if (manifest.method === 0)
            payload = new Uint8Array(data, start, manifest.compressed);
        else if (manifest.method === 8) {
            const stream = new Blob([data.slice(start, start + manifest.compressed)])
                .stream()
                .pipeThrough(new DecompressionStream("deflate-raw"));
            const reader = stream.getReader();
            const chunks = [];
            let size = 0;
            while (true) {
                const part = await reader.read();
                if (part.done)
                    break;
                size += part.value.length;
                if (size > 1048576) {
                    await reader.cancel();
                    throw new Error("limit");
                }
                chunks.push(part.value);
            }
            payload = new Uint8Array(size);
            let p = 0;
            for (const chunk of chunks) {
                payload.set(chunk, p);
                p += chunk.length;
            }
        }
        else
            throw new Error("compression");
        const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
        if (typeof parsed.name !== "string" || !parsed.name.trim())
            throw new Error("name");
        return parsed.name;
    }
    catch {
        throw new ConsoleError("MANIFEST_INVALID", new LocalizedMessage('adapter.inspect.manifestRead'));
    }
}
//# sourceMappingURL=adapter.js.map