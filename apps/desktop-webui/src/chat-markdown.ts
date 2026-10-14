import { Marked, Renderer } from './marked.js';
import type { Tokens } from './marked.js';

const MAX_MARKDOWN_LENGTH = 64 * 1024;
const MAX_MARKDOWN_LINES = 4096;
const MAX_MARKDOWN_MARKERS = 4096;

function escapeHTML(text: string): string {
  return text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

// Only explicit external navigation is supported. Relative/file URLs must not
// accidentally navigate the authenticated Desktop or invoke its local actions.
function safeLink(href: string): string | undefined {
  if (/[\u0000-\u0020\u007f-\u009f\\]/.test(href)) return undefined;
  if (!/^(?:https?:\/\/|mailto:)/i.test(href)) return undefined;
  try {
    const url = new URL(href);
    if (url.protocol === 'mailto:') return /%0[ad]/i.test(href) ? undefined : href;
    if ((url.protocol === 'https:' || url.protocol === 'http:') && url.hostname) return href;
  } catch { /* Malformed or still-streaming destinations stay readable text. */ }
  return undefined;
}

class ChatRenderer extends Renderer {
  override html({ text }: Tokens.HTML | Tokens.Tag): string {
    return escapeHTML(text);
  }

  override code({ text, lang }: Tokens.Code): string {
    const language = (lang || '').split(/\s/, 1)[0];
    const label = language ? ` aria-label="${escapeHTML(language)} code"` : ' aria-label="Code"';
    return `<pre class="chat-markdown-code" tabindex="0"${label}><code>${escapeHTML(text)}\n</code></pre>\n`;
  }

  override table(token: Tokens.Table): string {
    return `<div class="chat-markdown-table" tabindex="0" role="region" aria-label="Table">${super.table(token)}</div>\n`;
  }

  override link({ href, title, tokens }: Tokens.Link): string {
    const label = this.parser.parseInline(tokens);
    const destination = safeLink(href);
    if (!destination) return label;
    return `<a href="${escapeHTML(destination)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${escapeHTML(title)}"` : ''}>${label}</a>`;
  }

  override image({ text }: Tokens.Image): string {
    // Do not fetch model-provided remote images or tracking URLs. Actual chat
    // attachments use the existing authenticated image pipeline separately.
    return `<span class="chat-markdown-image">[Image: ${escapeHTML(text || 'image')}]</span>`;
  }
}

/** Safe GFM for assistant prose, including incomplete streamed fences.
 * Oversized/malformed input remains complete, escaped plain text. No message
 * contents are cached across renders, conversations, or authenticated identities.
 */
export function renderChatMarkdown(text: string): string {
  const plain = () => `<div class="chat-markdown-plain">${escapeHTML(text)}</div>`;
  if (!text) return '';
  if (text.length > MAX_MARKDOWN_LENGTH || text.split('\n', MAX_MARKDOWN_LINES + 1).length > MAX_MARKDOWN_LINES) return plain();
  // Avoid quadratic scans of pathological partial delimiters on each streamed
  // frame. This linear preflight also bounds excessive list/quote nesting.
  let markers = 0;
  for (const character of text) {
    if ('[]*_>`~'.includes(character) && ++markers > MAX_MARKDOWN_MARKERS) return plain();
  }
  try {
    // setOptions preserves the renderer prototype; extension registration via
    // the constructor only copies own methods and would discard our overrides.
    const markdown = new Marked();
    markdown.setOptions({ gfm: true, breaks: true, async: false, renderer: new ChatRenderer() });
    return markdown.parse(text, { async: false });
  } catch {
    // A partial/malformed message must never take down the rest of Chat.
    return plain();
  }
}
