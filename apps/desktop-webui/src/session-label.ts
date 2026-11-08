import { t } from './locale.js';
import type { Session } from './models.js';

type SessionLabel = Pick<Session, 'id' | 'title' | 'titleSource' | 'messages'>;

/** Use only confirmed metadata and the user message already loaded for this Session. */
export function sessionLabel(session: SessionLabel, listIndex: number): string {
  if (session.titleSource === 'manual' || session.titleSource === 'auto') return session.title;
  const first = session.messages.find(message => message.role === 'user');
  const summary = first?.text.slice(0, 256).replace(/\s+/gu, ' ').trim();
  if (summary) return Array.from(summary).slice(0, 80).join('');
  return Number.isSafeInteger(listIndex) && listIndex >= 0
    ? t('chat.sessionNumber', { index: listIndex + 1 })
    : t('d.session.defaultTitle', { id: session.id });
}
