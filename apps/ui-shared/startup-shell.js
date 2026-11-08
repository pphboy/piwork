import { pendingDots } from './feedback-primitives.js';

const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

/** Pure presentation: the caller owns reads, identity, deadlines and recovery. */
export function startupShell({ logoUrl, message, error = '', pending = true, retry, home, cold = false }) {
  const button = retry ? `<button type="${cold ? 'submit' : 'button'}" class="button btn secondary startup-retry" ${cold ? 'data-boot-recovery' : `data-action="${escape(retry.action)}"`}>${escape(retry.label)}</button>` : '';
  const link = home ? `<a href="${escape(home.href)}"${cold ? ' data-boot-home' : ''}>${escape(home.label)}</a>` : '';
  const recovery = cold
    ? `<p data-boot-error>页面加载尚未完成，可重新加载或返回首页。 / Page loading is incomplete. Reload or return home.</p><form method="get" data-boot-recovery-form><!-- PIWORK_BOOT_RECOVERY -->${button}${link}</form>`
    : error ? `<p class="startup-error">${escape(error)}</p><div class="startup-actions">${button}${link}</div>` : '';
  return `<main class="startup-screen" ${cold ? 'data-static-startup' : ''} role="status" aria-busy="${pending && !cold}">
    <div class="startup-brand">
      <img class="startup-logo" src="${escape(logoUrl)}" alt="" width="48" height="48">
      <p class="startup-message"${cold ? ' data-boot-loading' : ''}>${escape(message)}</p>
      <div class="startup-indicator">${pendingDots()}</div>
    </div>
    <div class="startup-recovery">${recovery}</div>
  </main>`;
}
