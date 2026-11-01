import { LocalizedMessage } from './locale.js';
import { ReadFeedbackEpisodes } from './read-feedback.js';
export class ServiceReadFeedback {
    episodes = new ReadFeedbackEpisodes();
    observe(facts, recovery) {
        const error = facts.error || (facts.source === 'preview' && facts.unconfirmed ? new LocalizedMessage('service.previewUnconfirmed') : undefined);
        return this.episodes.observe({ owner: {
                identity: facts.identity, object: facts.workId,
                task: `service-read:${facts.source}:${facts.serviceId}:${facts.source !== 'cleanup' ? facts.port : ''}`, generation: 0,
            }, reading: facts.reading, error, tone: facts.source === 'preview' && facts.unconfirmed && !facts.error ? 'unknown' : 'error', confirmedVersion: facts.confirmedVersion }, recovery);
    }
}
export function serviceReadMatches(record, facts) {
    if (record.kind !== 'read' || record.work !== facts.workId || !record.error || !facts.error || String(record.errorMessage?.() || record.error) !== String(facts.error))
        return false;
    if (facts.source === 'entry')
        return ['retry-service-entry', 'select-service', 'open-controlled-service'].includes(record.action || '') && record.resource === `service:${facts.serviceId}:${facts.port}`
            || record.action === 'tab-Services' && record.sourceContext === `entry:${facts.workId}:${facts.serviceId}:${facts.port}`;
    if (facts.source === 'preview')
        return record.action === 'check-preview' && record.resource === `service:${facts.serviceId}:${facts.port}`;
    return record.action === 'refresh-temporary-cleanups' && record.resource === `cleanup:service:${facts.serviceId}`;
}
/** Both entry and explicit retry read the same port-independent Service log snapshot. */
export function serviceLogReadIdentity(action, workId, serviceId) {
    if (!workId || !serviceId || !['service-details', 'refresh-logs'].includes(action))
        return undefined;
    const resource = `service-logs:${serviceId}`;
    return { resource, key: `read:${workId}:${resource}` };
}
//# sourceMappingURL=service-read-feedback.js.map