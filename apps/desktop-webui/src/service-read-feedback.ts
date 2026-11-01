import { LocalizedMessage } from './locale.js';
import type { ActionRecord } from './action-state.js';
import type { NoticeEvent } from './notices.js';
import { ReadFeedbackEpisodes, type ReadFeedbackFacts } from './read-feedback.js';

export interface ServiceReadFacts {
  readonly identity: string;
  readonly workId: string;
  readonly serviceId: string;
  readonly source: 'entry' | 'preview' | 'cleanup';
  readonly unconfirmed?: boolean;
  readonly port?: number;
  readonly reading: boolean;
  readonly error?: ReadFeedbackFacts['error'];
  readonly confirmedVersion?: ReadFeedbackFacts['confirmedVersion'];
}
export class ServiceReadFeedback {
  private episodes = new ReadFeedbackEpisodes();
  observe(facts: ServiceReadFacts, recovery: NoticeEvent['recovery']) {
    const error = facts.error || (facts.source === 'preview' && facts.unconfirmed ? new LocalizedMessage('service.previewUnconfirmed') : undefined);
    return this.episodes.observe({ owner: {
      identity: facts.identity, object: facts.workId,
      task: `service-read:${facts.source}:${facts.serviceId}:${facts.source !== 'cleanup' ? facts.port : ''}`, generation: 0,
    }, reading: facts.reading, error, tone: facts.source === 'preview' && facts.unconfirmed && !facts.error ? 'unknown' : 'error', confirmedVersion: facts.confirmedVersion }, recovery);
  }
}
export function serviceReadMatches(record: Readonly<ActionRecord>, facts: ServiceReadFacts): boolean {
  if (record.kind !== 'read' || record.work !== facts.workId || !record.error || !facts.error || String(record.errorMessage?.() || record.error) !== String(facts.error)) return false;
  if (facts.source === 'entry') return ['retry-service-entry', 'select-service', 'open-controlled-service'].includes(record.action || '') && record.resource === `service:${facts.serviceId}:${facts.port}`
    || record.action === 'tab-Services' && record.sourceContext === `entry:${facts.workId}:${facts.serviceId}:${facts.port}`;
  if (facts.source === 'preview') return record.action === 'check-preview' && record.resource === `service:${facts.serviceId}:${facts.port}`;
  return record.action === 'refresh-temporary-cleanups' && record.resource === `cleanup:service:${facts.serviceId}`;
}

/** Both entry and explicit retry read the same port-independent Service log snapshot. */
export function serviceLogReadIdentity(action: string, workId: string | undefined, serviceId: string | undefined) {
  if (!workId || !serviceId || !['service-details', 'refresh-logs'].includes(action)) return undefined;
  const resource = `service-logs:${serviceId}`;
  return { resource, key: `read:${workId}:${resource}` };
}
