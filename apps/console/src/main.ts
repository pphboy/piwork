export const CONSOLE_VERSION = "0.1.0";

export function consoleTitle(): string {
  return `piwork Console ${CONSOLE_VERSION}`;
}

export interface ConsolePageData { readonly account?: string; readonly works?: readonly unknown[]; readonly services?: readonly unknown[]; }
export function renderConsole(data: ConsolePageData = {}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${consoleTitle()}</title></head><body><main><h1>${consoleTitle()}</h1><p data-testid="identity">${escapeHtml(data.account ?? "signed out")}</p><section><h2>Works</h2><pre>${escapeHtml(JSON.stringify(data.works ?? [], null, 2))}</pre></section><section><h2>Services</h2><pre>${escapeHtml(JSON.stringify(data.services ?? [], null, 2))}</pre></section></main></body></html>`;
}
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!)); }
