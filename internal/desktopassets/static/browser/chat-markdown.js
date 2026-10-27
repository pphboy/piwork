import { Marked, Renderer } from './marked.js';
import { fileReferenceLink } from './file-reference.js';
import { t } from './locale.js';
const MAX_MARKDOWN_LENGTH = 64 * 1024;
const MAX_MARKDOWN_LINES = 4096;
const MAX_MARKDOWN_MARKERS = 4096;
function escapeHTML(text) {
    return text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
// Only explicit external navigation is supported. Relative/file URLs must not
// accidentally navigate the authenticated Desktop or invoke its local actions.
function safeLink(href) {
    if (/[\u0000-\u0020\u007f-\u009f\\]/.test(href))
        return undefined;
    if (!/^(?:https?:\/\/|mailto:)/i.test(href))
        return undefined;
    try {
        const url = new URL(href);
        if (url.protocol === 'mailto:')
            return /%0[ad]/i.test(href) ? undefined : href;
        if ((url.protocol === 'https:' || url.protocol === 'http:') && url.hostname)
            return href;
    }
    catch { /* Malformed or still-streaming destinations stay readable text. */ }
    return undefined;
}
class ChatRenderer extends Renderer {
    workId;
    constructor(workId) {
        super();
        this.workId = workId;
    }
    html({ text }) {
        return escapeHTML(text);
    }
    code({ text, lang }) {
        const language = (lang || '').split(/\s/, 1)[0];
        const label = language
            ? ` aria-label="${escapeHTML(t('d.chat.codeLabelLanguage', { language }))}"`
            : ` aria-label="${escapeHTML(t('d.chat.codeLabel'))}"`;
        return `<pre class="chat-markdown-code" tabindex="0"${label}><code>${escapeHTML(text)}\n</code></pre>\n`;
    }
    table(token) {
        return `<div class="chat-markdown-table" tabindex="0" role="region" aria-label="${escapeHTML(t('d.chat.tableLabel'))}">${super.table(token)}</div>\n`;
    }
    link({ href, title, tokens }) {
        const label = this.parser.parseInline(tokens);
        // A model-authored reference becomes navigation only when its raw format
        // and the reply's real Work both validate. Otherwise it stays label text.
        const file = fileReferenceLink(href, this.workId);
        if (file)
            return `<a class="chat-file-link" href="${escapeHTML(file.href)}" data-path="${escapeHTML(file.path)}" title="${escapeHTML(t('d.chat.openInFiles'))}">${label}</a>`;
        const destination = safeLink(href);
        if (!destination)
            return label;
        return `<a href="${escapeHTML(destination)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${escapeHTML(title)}"` : ''}>${label}</a>`;
    }
    image({ text }) {
        // Do not fetch model-provided remote images or tracking URLs. Actual chat
        // attachments use the existing authenticated image pipeline separately.
        const alt = escapeHTML(text || t('d.chat.imageFallback'));
        return `<span class="chat-markdown-image">${t('d.chat.imageLabel', { text: alt })}</span>`;
    }
}
/** Safe GFM for assistant prose, including incomplete streamed fences.
 * Oversized/malformed input remains complete, escaped plain text. No message
 * contents are cached across renders, conversations, or authenticated identities.
 */
export function renderChatMarkdown(text, context) {
    const plain = () => `<div class="chat-markdown-plain">${escapeHTML(text)}</div>`;
    if (!text)
        return '';
    if (text.length > MAX_MARKDOWN_LENGTH || text.split('\n', MAX_MARKDOWN_LINES + 1).length > MAX_MARKDOWN_LINES)
        return plain();
    // Avoid quadratic scans of pathological partial delimiters on each streamed
    // frame. This linear preflight also bounds excessive list/quote nesting.
    let markers = 0;
    for (const character of text) {
        if ('[]*_>`~'.includes(character) && ++markers > MAX_MARKDOWN_MARKERS)
            return plain();
    }
    try {
        // setOptions preserves the renderer prototype; extension registration via
        // the constructor only copies own methods and would discard our overrides.
        const markdown = new Marked();
        markdown.setOptions({ gfm: true, breaks: true, async: false, renderer: new ChatRenderer(context?.workId) });
        return markdown.parse(text, { async: false });
    }
    catch {
        // A partial/malformed message must never take down the rest of Chat.
        return plain();
    }
}
//# sourceMappingURL=chat-markdown.js.map