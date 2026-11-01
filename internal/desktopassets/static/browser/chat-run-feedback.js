const key = (work, session, run) => JSON.stringify([work, session, run]);
/** Local observation evidence only; never a Run state machine or network owner. */
export class RunFeedbackObservations {
    sequence = 0;
    entries = new Map();
    record(work, run, confirmed) {
        if (!work || !run.id || !run.sessionId)
            return;
        const id = key(work, run.sessionId, run.id);
        const revision = confirmed ? ++this.sequence : this.entries.get(id)?.revision ?? 0;
        this.entries.set(id, { revision, run: {
                id: run.id, sessionId: run.sessionId, status: run.status, cursor: run.cursor,
                error: run.error, executionError: run.executionError, errorCode: run.errorCode,
            } });
    }
    get(work, session, run) { return this.entries.get(key(work, session, run)); }
    forget(work, session, run) { this.entries.delete(key(work, session, run)); }
    clear() { this.entries.clear(); }
}
/** Only explicit UI acceptance registers a Run; arbitrary history reads cannot announce one. */
export class ChatRunFeedback {
    identity = '';
    tracked = new Map();
    setIdentity(identity) {
        if (identity === this.identity)
            return;
        this.identity = identity;
        this.tracked.clear();
    }
    accept(target) {
        if (target.identity !== this.identity || !target.work || !target.session || !target.run)
            return false;
        const id = key(target.work, target.session, target.run);
        if (!this.tracked.has(id))
            this.tracked.set(id, { target: { ...target }, failedAt: -1, episode: 0 });
        return true;
    }
    project(read, message, recovery) {
        const output = [];
        for (const [id, entry] of this.tracked) {
            const observation = read(entry.target);
            if (!observation || observation.run.id !== entry.target.run || observation.run.sessionId !== entry.target.session)
                continue;
            const { run, revision } = observation;
            const owner = { identity: this.identity, object: entry.target.work, task: `chat-run:${id}`, generation: 0 };
            const tone = run.executionError || ['failed', 'interrupted'].includes(run.status) ? 'error'
                : run.error && ['accepted', 'running', 'cancelling'].includes(run.status) ? 'unknown' : undefined;
            if (tone) {
                if (entry.tone !== tone)
                    entry.episode++;
                entry.tone = tone;
                entry.failedAt = revision;
                output.push({ target: entry.target, owner, resolve: false, retired: false, event: {
                        ...owner, key: `${entry.episode}:${tone}:${run.status}:${run.errorCode || ''}`, tone,
                        message: () => message(run, entry.target), recovery: recovery(entry.target),
                    } });
                continue;
            }
            // Error clearing at reconnect start is not a successful observation.
            const confirmed = revision > entry.failedAt;
            const resolved = entry.tone === 'unknown' && confirmed;
            const retired = entry.tone !== 'error' && !run.error && !run.executionError && confirmed && ['succeeded', 'cancelled'].includes(run.status);
            if (resolved)
                entry.tone = undefined;
            output.push({ target: entry.target, owner, resolve: resolved || retired, retired });
            if (retired)
                this.tracked.delete(id);
        }
        return output;
    }
}
//# sourceMappingURL=chat-run-feedback.js.map