export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const icon = (name, size = 18) => {
    const paths = {
        check: '<path d="m5 12 4 4L19 6"/>',
        arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
        refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.5-2L20 8M4 16l2.4 3A7 7 0 0 0 18 17"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        chevron: '<path d="m9 5 7 7-7 7"/>',
        copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
        external: '<path d="M14 4h6v6m0-6L10 14M10 4H4v16h16v-6"/>',
        shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 11 3 3 5-5"/>',
        server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6h.01M7 17h.01M15 6h3m-3 11h3"/>',
        warning: '<path d="m12 3 10 18H2zM12 9v5m0 3h.01"/>',
        close: '<path d="m6 6 12 12M6 18 18 6"/>',
        upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
        key: '<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-3-3 3-3m-6 0 3-3"/>',
        box: '<path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M8 5l9 5"/>',
        book: '<path d="M4 3h13a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3zm0 14h16M8 7h8m-8 4h6"/>',
        users: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3m0-17a4 4 0 0 1 0 8m3 3a6 6 0 0 1 3 6"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
        settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
        up: '<path d="m6 15 6-6 6 6"/>',
        down: '<path d="m6 9 6 6 6-6"/>',
    };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.box}</svg>`;
};
export const Button = (text, action, kind = "secondary", attrs = "") => `<button type="button" class="btn ${kind}" data-action="${action}" ${attrs}>${text}</button>`;
export const NavLink = (text, path, cls = "text-link") => `<a class="${cls}" href="${esc(path)}" data-nav>${text}</a>`;
export const StatusLabel = (text, tone = "neutral") => `<span class="status-label ${tone}"><span class="status-dot"></span>${esc(text)}</span>`;
export const Feedback = (message, tone = "info", actions = "") => `<div class="feedback ${tone}" role="${tone === "error" ? "alert" : "status"}">${icon(tone === "success" ? "check" : tone === "error" || tone === "warning" ? "warning" : "shield", 17)}<div>${esc(message)}${actions ? `<div class="feedback-actions">${actions}</div>` : ""}</div></div>`;
export const PageHeader = (title, description, actions = "", back = "") => `${back ? `<div class="breadcrumb">${back}</div>` : ""}<div class="page-header"><div><h1>${esc(title)}</h1><p>${esc(description)}</p></div><div class="header-actions">${actions}</div></div>`;
export const Section = (title, description, body, actions = "", cls = "") => `<section class="section ${cls}"><div class="section-heading"><div><h2>${esc(title)}</h2>${description ? `<p>${esc(description)}</p>` : ""}</div>${actions ? `<div class="section-actions">${actions}</div>` : ""}</div>${body}</section>`;
export const Field = (id, label, control, help = "", error = "") => `<div class="field"><label for="${id}">${label}</label><div class="field-body">${control}${help ? `<p class="help" id="${id}-help">${help}</p>` : ""}<p class="field-error" id="${id}-error" ${error ? "" : "hidden"}>${esc(error)}</p></div></div>`;
export const Input = (id, value = "", attrs = "") => `<input id="${id}" name="${id}" value="${esc(value)}" ${attrs}>`;
export const DataTable = (head, rows, empty) => `<div class="table-scroll"><table><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${head.length}" class="empty-cell">${esc(empty)}</td></tr>`}</tbody></table></div>`;
export const date = (value) => !value ? "Not provided" : new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
});
export const bytes = (value) => value < 1024
    ? `${value} B`
    : value < 1048576
        ? `${(value / 1024).toFixed(1)} KiB`
        : `${(value / 1048576).toFixed(1)} MiB`;
export const Disclosure = (title, body) => `<details class="disclosure"><summary>${esc(title)}</summary><div class="disclosure-body">${body}</div></details>`;
export const Copy = (value) => Button(icon("copy", 15), "copy", "icon-button", `data-value="${esc(value)}" aria-label="Copy ${esc(value)}" title="Copy"`);
export const Empty = (title, message, action = "") => `<div class="empty-state">${icon("box", 26)}<h3>${esc(title)}</h3><p>${esc(message)}</p>${action}</div>`;
export const UploadProgress = (label, sent, total) => `<div class="upload-progress" role="status"><div><strong>${esc(label)}</strong><span>${total ? `${bytes(sent)} / ${bytes(total)}` : ""}</span></div>${total ? `<progress max="${total}" value="${sent}" aria-label="Bytes uploaded"></progress>` : '<span class="working-line">Waiting for Core confirmation…</span>'}</div>`;
//# sourceMappingURL=components.js.map