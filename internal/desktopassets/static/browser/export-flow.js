const message = (error) => error instanceof Error ? error.message : String(error);
const isStop = (operation) => operation.action === 'stop' || /^stop[-_ ]work$/i.test(operation.kind);
const failedOperation = (operation) => ['failed', 'superseded'].includes(operation.state);
const controlVersion = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
/**
 * Reads only original IDs, submits each authorized stage at most once, and consumes
 * delivery before calling the browser. update() is fed by the adapter's existing
 * bounded observers; it creates no timers, persistence, or retrying mutation queue.
 */
export class ExportFlows {
    port;
    options;
    sequence = 0;
    visible = true;
    flows = new Map();
    runtime = new Map();
    constructor(port, options) {
        this.port = port;
        this.options = options;
    }
    get(id) { return this.flows.get(id); }
    workControlBlocked(workId) {
        return [...this.flows.values()].some(flow => {
            const runtime = this.runtime.get(flow.id);
            return flow.workId === workId && flow.identityEpoch === this.port.identityEpoch && flow.phase !== 'revoked' &&
                (runtime.workMutationPending || runtime.workMutationUnknown);
        });
    }
    forWork(workId) {
        return [...this.flows.values()].reverse().find(flow => flow.workId === workId && flow.identityEpoch === this.port.identityEpoch);
    }
    start(workId, intent) {
        this.updateIdentity();
        if (!this.authorized())
            throw new Error('Sign in before exporting.');
        if (intent.mode === 'existing' && !intent.snapshotId)
            throw new Error('Choose the exact snapshot to download.');
        if (intent.mode === 'new' && intent.snapshotId)
            throw new Error('A new export cannot target an existing snapshot.');
        const active = [...this.flows.values()].find(flow => flow.workId === workId && flow.identityEpoch === this.port.identityEpoch && !flow.terminal);
        if (active) {
            const original = this.runtime.get(active.id);
            if (active.mode === intent.mode && original.intentSnapshotId === intent.snapshotId && active.stopConfirmed === !!intent.stopConfirmed)
                return active;
            throw new Error('Another export intent is active for this Work. Check or finish its original snapshot before choosing a different export.');
        }
        const work = this.port.getWork(workId);
        const flow = {
            id: `export-${++this.sequence}`, workId, workName: work?.name || workId,
            identityEpoch: this.port.identityEpoch, mode: intent.mode, stopConfirmed: !!intent.stopConfirmed,
            snapshotId: intent.snapshotId, phase: 'checking', paused: false, error: '', autoDeliveryConsumed: false,
            get terminal() { return ['failed', 'revoked', 'delivered'].includes(this.phase) || this.phase === 'ready' && this.autoDeliveryConsumed; },
        };
        // A previous Stop record is not a dependency of a new, already-stopped
        // export. Uncertain stopped facts need a read, not an invented missing ID.
        const stopId = work?.lifecycleIntent?.action === 'stop' ? work.lifecycleIntent.operationId : work?.operationId;
        const originalStop = stopId && this.port.getOperation(stopId);
        const knownStop = originalStop && originalStop.workId === workId && isStop(originalStop) ? originalStop : undefined;
        const stopping = intent.mode === 'new' && work && !this.stopped(work) && (work.observed === 'stopping' || work.status === 'Stopping' ||
            knownStop && (work.desired === 'stopped' && work.status !== 'Stopped' ||
                work.lifecycleIntent?.action === 'stop' && !['succeeded', 'failed', 'superseded'].includes(knownStop.state)));
        if (stopping && knownStop)
            flow.stopOperationId = knownStop.id;
        const runtime = {
            intentSnapshotId: intent.snapshotId, stopSubmitted: !!flow.stopOperationId,
            stopVersionLimit: flow.stopOperationId && work && !work.statusError && work.desired === 'stopped' && controlVersion(work.controlVersion) ? work.controlVersion : undefined, exportSubmitted: false,
            preparationSubmitted: false, missingStopIdentity: !!stopping && !flow.stopOperationId, generation: 0, fingerprint: '',
            workMutationPending: false, workMutationUnknown: false, awaitingControlCheck: false,
        };
        this.flows.set(flow.id, flow);
        this.runtime.set(flow.id, runtime);
        this.changed();
        void this.run(flow, true);
        return flow;
    }
    pause(id) {
        const flow = this.require(id), runtime = this.runtime.get(id);
        flow.paused = true;
        runtime.generation++;
        runtime.validatedGeneration = undefined;
        this.changed();
    }
    async resume(id) {
        const flow = this.require(id), runtime = this.runtime.get(id);
        if (!this.live(flow) || flow.terminal)
            return;
        // Invalidate any old pass before unpausing; Resume always starts with fresh reads.
        flow.paused = false;
        runtime.generation++;
        runtime.validatedGeneration = undefined;
        this.changed();
        if (runtime.running)
            await runtime.running;
        await this.run(flow, true);
    }
    async check(id) { await this.run(this.require(id), true); }
    setVisible(visible) {
        if (this.visible === visible)
            return;
        this.visible = visible;
        for (const runtime of this.runtime.values()) {
            runtime.generation++;
            runtime.validatedGeneration = undefined;
        }
        if (visible)
            for (const flow of this.flows.values())
                if (!flow.terminal)
                    void (async () => {
                        const pending = this.runtime.get(flow.id).running;
                        if (pending)
                            await pending;
                        if (this.isVisible())
                            await this.run(flow, true);
                    })();
    }
    revoke(reason = 'Automatic delivery ended. Explicitly look up the original snapshot to download it again.') {
        for (const flow of this.flows.values())
            this.revokeFlow(flow, reason);
        this.changed();
    }
    update() {
        this.updateIdentity();
        for (const flow of this.flows.values()) {
            if (flow.terminal || !this.live(flow))
                continue;
            const runtime = this.runtime.get(flow.id);
            const transfer = flow.snapshotId && this.port.downloads.get(flow.snapshotId);
            if (transfer && flow.transferId && transfer.transferId === flow.transferId && transfer.snapshotId === flow.snapshotId && transfer.workId === flow.workId && transfer.terminalFailure) {
                this.fail(flow, transfer.error || 'The original download preparation failed. Retry this snapshot explicitly.');
                this.changed();
                continue;
            }
            if (runtime.running) {
                // The only permitted bypass is delivery, after this pass's exact original
                // snapshot/operation checks, while an older original transfer GET waits.
                this.deliverLateReady(flow);
            }
            else if (this.fingerprint(flow) !== runtime.fingerprint && !flow.paused && this.isVisible()) {
                void this.run(flow, false);
            }
        }
    }
    require(id) { const flow = this.get(id); if (!flow)
        throw new Error('The original export intent is no longer available.'); return flow; }
    authorized() { return this.port.state.signedIn; }
    isVisible() { return this.visible && (this.options.visible?.() ?? true); }
    changed() { this.options.changed(); }
    revokeFlow(flow, reason) {
        if (flow.phase === 'revoked')
            return;
        const runtime = this.runtime.get(flow.id);
        runtime.generation++;
        runtime.validatedGeneration = undefined;
        flow.phase = 'revoked';
        flow.error = reason;
        delete flow.contentURL;
    }
    updateIdentity() {
        for (const flow of this.flows.values())
            if (flow.phase !== 'revoked' && (flow.identityEpoch !== this.port.identityEpoch || !this.authorized()))
                this.revokeFlow(flow, 'The session or account changed. Look up the original snapshot explicitly after signing in.');
    }
    live(flow) {
        if (flow.identityEpoch !== this.port.identityEpoch || !this.authorized())
            this.revokeFlow(flow, 'The session or account changed. Look up the original snapshot explicitly after signing in.');
        return flow.phase !== 'revoked' && flow.phase !== 'failed';
    }
    canAdvance(flow, generation) { return this.live(flow) && !flow.terminal && !flow.paused && this.isVisible() && this.runtime.get(flow.id).generation === generation; }
    fail(flow, error) { flow.phase = 'failed'; flow.error = error; delete flow.contentURL; }
    unknown(flow, error) { flow.phase = 'unknown'; flow.error = error; }
    fingerprint(flow) {
        const work = this.port.getWork(flow.workId), stop = flow.stopOperationId && this.port.getOperation(flow.stopOperationId);
        const op = flow.exportOperationId && this.port.getOperation(flow.exportOperationId), snap = flow.snapshotId && this.port.getSnapshot(flow.snapshotId);
        const transfer = flow.snapshotId && this.port.downloads.get(flow.snapshotId);
        return JSON.stringify([this.port.identityEpoch, work?.desired, work?.observed, work?.statusError, work?.controlVersion, work?.lifecycleIntent,
            stop && [stop.state, stop.observationError], op && [op.state, op.snapshotId, op.observationError],
            snap && [snap.status, snap.operationId, snap.workId, snap.expiresAt], transfer && [transfer.transferId, transfer.ready, transfer.terminalFailure, transfer.phase, transfer.error, transfer.observationError]]);
    }
    async read(flow, kind, read) {
        const runtime = this.runtime.get(flow.id);
        runtime.reading = kind;
        runtime.failedRead = undefined;
        try {
            return await read();
        }
        catch (error) {
            runtime.failedRead = kind;
            throw error;
        }
        finally {
            runtime.reading = undefined;
        }
    }
    validOperation(flow, operation, id) {
        if (operation.id !== id || operation.workId !== flow.workId || operation.checkedWorkId !== flow.workId) {
            this.fail(flow, 'The original Operation could not be confirmed for this Work.');
            return false;
        }
        return true;
    }
    stopped(work) { return work.desired === 'stopped' && work.observed === 'stopped' && work.status === 'Stopped' && !work.statusError && this.port.project(work).exportable; }
    matchingStop(flow, work) {
        const stop = flow.stopOperationId && this.port.getOperation(flow.stopOperationId);
        const limit = this.runtime.get(flow.id).stopVersionLimit;
        if (!work.statusError) {
            if (limit === undefined) {
                this.fail(flow, 'The original Stop control version is not confirmed. Check the Work and start a new export explicitly.');
                return false;
            }
            if (!controlVersion(work.controlVersion) || work.controlVersion < limit) {
                flow.error = 'Waiting for the original Stop control version to be confirmed.';
                return false;
            }
            if (work.controlVersion > limit) {
                this.fail(flow, 'The Work control sequence changed beyond this Stop intent. Check the Work and start a new export explicitly.');
                return false;
            }
        }
        // A completed Stop cannot own a later, reliably observed running/deleted
        // target. End this intent permanently; a later stopped target cannot revive
        // it. The native Operation envelope does not publish its target version.
        const contraryTarget = stop && stop.state === 'succeeded' && !work.statusError && work.desired !== 'stopped';
        if (contraryTarget || work.lifecycleIntent && work.lifecycleIntent.operationId !== flow.stopOperationId || work.operationId && work.operationId !== flow.stopOperationId) {
            this.fail(flow, 'A newer Work control replaced the original Stop. Check the Work before starting another export.');
            return false;
        }
        return true;
    }
    mutationFailure(flow, error, action) {
        const failure = error;
        // Complete public permission/admission rejections do not represent an
        // accepted mutation. Keep both the code and its exact status: arbitrary
        // 403/409, malformed responses and lost bodies still remain unknown.
        const rejected = (action === 'Stop' || action === 'Export') && failure?.httpStatus === 403 && failure.code === 'PERMISSION_DENIED' ||
            action === 'Export' && failure?.httpStatus === 409 &&
                ['SNAPSHOT_REQUIRES_STOPPED', 'WORK_BUSY'].includes(failure.code || '');
        if (action === 'Stop' || action === 'Export')
            this.runtime.get(flow.id).workMutationUnknown = !rejected;
        if (!this.live(flow))
            return;
        if (rejected) {
            this.fail(flow, `${action} was rejected before acceptance. ${message(error)}`);
            return;
        }
        this.unknown(flow, `${action} result is unknown. Check the original IDs; this request will not be submitted again. ${message(error)}`);
    }
    admitWorkMutation(flow) {
        const runtime = this.runtime.get(flow.id);
        if (this.options.canSubmitWorkMutation?.(flow.workId, flow.id) === false) {
            runtime.awaitingControlCheck = true;
            flow.phase = 'checking';
            flow.error = 'Another Work control is pending or unknown. This stage was not submitted. Check its original result before continuing.';
            return false;
        }
        runtime.awaitingControlCheck = false;
        return true;
    }
    run(flow, explicit) {
        const runtime = this.runtime.get(flow.id);
        if (runtime.running)
            return runtime.running;
        if (!this.live(flow) || flow.terminal || !this.isVisible() || runtime.awaitingControlCheck && !explicit)
            return Promise.resolve();
        const generation = runtime.generation;
        // Schedule the body after storing the promise: a synchronous adapter emit must
        // never re-enter an unregistered pass and dispatch a second mutation.
        const running = Promise.resolve().then(async () => {
            try {
                if (!this.live(flow))
                    return;
                flow.error = '';
                if (flow.mode === 'new' && !runtime.exportSubmitted) {
                    if (runtime.missingStopIdentity) {
                        this.unknown(flow, 'The Work was already stopping, but its original Stop Operation is not known. Check that original operation before starting another export.');
                        return;
                    }
                    if (runtime.stopSubmitted && !flow.stopOperationId) {
                        this.unknown(flow, 'Stop acceptance is unknown and has no original Operation ID. Do not submit Stop again.');
                        return;
                    }
                    if (flow.stopOperationId) {
                        flow.phase = 'stopping';
                        const stop = await this.read(flow, 'stop', () => this.port.checkOperation(flow.stopOperationId, explicit));
                        if (!this.live(flow) || !this.validOperation(flow, stop, flow.stopOperationId))
                            return;
                        if (!isStop(stop)) {
                            this.fail(flow, 'The original Operation is not a Stop for this Work.');
                            return;
                        }
                        if (failedOperation(stop)) {
                            this.fail(flow, stop.error || `The original Stop ${stop.state}. Export was not submitted.`);
                            return;
                        }
                        const work = await this.read(flow, 'work', () => this.port.refreshWorkStatus(flow.workId, explicit));
                        if (!this.live(flow))
                            return;
                        if (!work || work.id !== flow.workId) {
                            this.fail(flow, 'The original Work is no longer available.');
                            return;
                        }
                        if (!this.matchingStop(flow, work))
                            return;
                        if (stop.state !== 'succeeded' || !this.stopped(work)) {
                            flow.error = 'Waiting for the original Stop and confirmed stopped Work.';
                            return;
                        }
                    }
                    else {
                        flow.phase = 'checking';
                        const work = await this.read(flow, 'work', () => this.port.refreshWorkStatus(flow.workId, explicit));
                        if (!this.live(flow))
                            return;
                        if (!work || work.id !== flow.workId) {
                            this.fail(flow, 'The original Work is no longer available.');
                            return;
                        }
                        if (!this.stopped(work)) {
                            if (work.desired === 'stopped' || work.statusError || this.port.project(work).action !== 'stop') {
                                flow.error = 'Work is not confirmed stopped and free of conflicting controls. Check its status.';
                                return;
                            }
                            if (!flow.stopConfirmed) {
                                this.fail(flow, 'Confirm Stop and export before stopping a running Work.');
                                return;
                            }
                            if (!this.canAdvance(flow, generation) || !this.admitWorkMutation(flow))
                                return;
                            if (!controlVersion(work.controlVersion) || work.controlVersion >= Number.MAX_SAFE_INTEGER) {
                                this.fail(flow, 'The Work control version is not confirmed. Check its status before Stop and export.');
                                return;
                            }
                            // Core AdvanceWorkControl commits exactly one version per accepted
                            // fresh action. Capture before dispatch and never raise this bound;
                            // intervening controls conservatively require a new explicit intent.
                            runtime.stopVersionLimit = work.controlVersion + 1;
                            runtime.workMutationPending = true;
                            runtime.stopSubmitted = true;
                            flow.phase = 'stopping';
                            this.changed();
                            try {
                                const stop = await this.port.lifecycle(flow.workId, 'stop');
                                if (!this.live(flow))
                                    return;
                                if (!stop.id || stop.workId !== flow.workId || !isStop(stop)) {
                                    runtime.workMutationUnknown = true;
                                    this.unknown(flow, 'Stop acceptance did not identify the original Work and Operation. Check known operations.');
                                    return;
                                }
                                flow.stopOperationId = stop.id;
                                runtime.workMutationUnknown = false;
                            }
                            catch (error) {
                                this.mutationFailure(flow, error, 'Stop');
                                return;
                            }
                            finally {
                                runtime.workMutationPending = false;
                                this.changed();
                            }
                            // The next pass must query the original Stop, even if acceptance looks terminal.
                            runtime.fingerprint = '';
                            return;
                        }
                    }
                    if (!this.canAdvance(flow, generation) || !this.admitWorkMutation(flow))
                        return;
                    runtime.workMutationPending = true;
                    runtime.exportSubmitted = true;
                    flow.phase = 'exporting';
                    this.changed();
                    try {
                        const operation = await this.port.prepareExport(flow.workId);
                        if (!this.live(flow))
                            return;
                        if (!operation.id || operation.workId !== flow.workId) {
                            runtime.workMutationUnknown = true;
                            this.unknown(flow, 'Export acceptance did not identify the original Work and Operation. Check known operations.');
                            return;
                        }
                        flow.exportOperationId = operation.id;
                        flow.snapshotId = operation.snapshotId;
                        runtime.workMutationUnknown = false;
                    }
                    catch (error) {
                        this.mutationFailure(flow, error, 'Export');
                        return;
                    }
                    finally {
                        runtime.workMutationPending = false;
                        this.changed();
                    }
                }
                if (!this.live(flow))
                    return;
                if (flow.mode === 'new' && !flow.exportOperationId) {
                    this.unknown(flow, 'Export acceptance is unknown and has no original Operation ID. Do not submit Export again.');
                    return;
                }
                // Existing-snapshot intents establish their operation exclusively through
                // this exact snapshot, never from Work array order or a newer export.
                let snapshot;
                if (flow.mode === 'existing' && !flow.exportOperationId) {
                    flow.phase = 'snapshot';
                    snapshot = await this.read(flow, 'snapshot', () => this.port.fetchSnapshot(flow.snapshotId, explicit));
                    if (!this.live(flow) || !this.validSnapshotIdentity(flow, snapshot))
                        return;
                    flow.exportOperationId = snapshot.operationId;
                }
                if (!flow.exportOperationId) {
                    this.unknown(flow, 'The original snapshot has no confirmed Export Operation.');
                    return;
                }
                flow.phase = 'exporting';
                const operation = await this.read(flow, 'operation', () => this.port.checkOperation(flow.exportOperationId, explicit));
                if (!this.live(flow) || !this.validOperation(flow, operation, flow.exportOperationId))
                    return;
                if (failedOperation(operation)) {
                    this.fail(flow, operation.error || `The original Export ${operation.state}.`);
                    return;
                }
                if (flow.snapshotId && operation.snapshotId !== flow.snapshotId) {
                    this.fail(flow, 'The Export Operation does not match the original snapshot.');
                    return;
                }
                if (!flow.snapshotId && operation.snapshotId)
                    flow.snapshotId = operation.snapshotId;
                if (operation.state !== 'succeeded') {
                    flow.phase = 'exporting';
                    return;
                }
                if (!flow.snapshotId) {
                    this.unknown(flow, 'The original Export has no confirmed snapshot ID.');
                    return;
                }
                flow.phase = 'snapshot';
                snapshot = await this.read(flow, 'snapshot', () => this.port.fetchSnapshot(flow.snapshotId, explicit));
                if (!this.live(flow) || !this.validSnapshotIdentity(flow, snapshot) || !this.available(flow, snapshot))
                    return;
                runtime.validatedSnapshot = flow.snapshotId;
                runtime.validatedOperation = flow.exportOperationId;
                runtime.validatedGeneration = generation;
                if (!runtime.preparationSubmitted) {
                    if (!this.canAdvance(flow, generation))
                        return;
                    const old = this.port.downloads.get(flow.snapshotId);
                    if (old && !old.terminalFailure) {
                        runtime.preparationSubmitted = true;
                        flow.transferId = old.transferId;
                    }
                    else {
                        runtime.preparationSubmitted = true;
                        flow.phase = 'preparing';
                        this.changed();
                        let pending;
                        try {
                            if (old?.terminalFailure) {
                                if (!this.port.retryDownloadSnapshot) {
                                    this.fail(flow, 'The previous transfer failed. Start an explicit new transfer for this snapshot.');
                                    return;
                                }
                                pending = this.port.retryDownloadSnapshot(flow.snapshotId);
                            }
                            else
                                pending = this.port.downloadSnapshot(flow.snapshotId);
                            flow.transferId = this.port.downloads.get(flow.snapshotId)?.transferId;
                        }
                        catch (error) {
                            this.mutationFailure(flow, error, 'Download preparation');
                            return;
                        }
                        // Do not await the POST: the original transfer can become ready through
                        // GET first, or its late POST can unblock a still-pending older GET.
                        void pending.then(() => { if (this.live(flow)) {
                            this.deliverLateReady(flow);
                            this.update();
                        } }, error => {
                            if (!this.live(flow) || flow.autoDeliveryConsumed)
                                return;
                            const job = this.port.downloads.get(flow.snapshotId);
                            if (job?.terminalFailure)
                                this.fail(flow, job.error || message(error));
                            else if (!job?.ready)
                                this.unknown(flow, `Download preparation is not confirmed. Check the original transfer. ${message(error)}`);
                            this.changed();
                            this.update();
                        });
                    }
                }
                if (!flow.transferId) {
                    this.unknown(flow, 'Download preparation has no original transfer ID. It will not be submitted again.');
                    return;
                }
                flow.phase = 'preparing';
                const transfer = await this.read(flow, 'transfer', () => this.port.checkDownload(flow.snapshotId, explicit));
                if (!this.live(flow) || flow.autoDeliveryConsumed || flow.terminal)
                    return;
                if (!transfer) {
                    flow.error = 'The original transfer has not been confirmed yet.';
                    return;
                }
                this.acceptTransfer(flow, transfer, generation);
            }
            catch (error) {
                if (this.live(flow) && !flow.autoDeliveryConsumed && !flow.terminal) {
                    flow.error = message(error);
                    const status = error?.httpStatus;
                    if (runtime.failedRead === 'transfer')
                        this.unknown(flow, `The original transfer could not be confirmed. ${message(error)}`);
                    else if (status === 404 || status === 410)
                        this.fail(flow, `The original resource is unavailable. ${message(error)}`);
                }
            }
            finally {
                runtime.validatedGeneration = undefined;
                runtime.reading = undefined;
                runtime.fingerprint = this.fingerprint(flow);
                this.changed();
            }
        });
        runtime.running = running;
        void running.finally(() => {
            if (runtime.running === running)
                runtime.running = undefined;
            // A newly accepted Stop needs its own original-ID read. No unknown mutation
            // or unsuccessful observation is ever retried by this continuation.
            if (!flow.terminal && !flow.paused && this.isVisible() && flow.stopOperationId && !runtime.exportSubmitted && !flow.error)
                void this.run(flow, false);
        });
        return running;
    }
    validSnapshotIdentity(flow, snapshot) {
        if (snapshot.id !== flow.snapshotId || snapshot.workId !== flow.workId || !snapshot.operationId || flow.exportOperationId && snapshot.operationId !== flow.exportOperationId) {
            this.fail(flow, 'The snapshot does not match the original Work and Export Operation.');
            return false;
        }
        return true;
    }
    available(flow, snapshot) {
        const runtime = this.runtime.get(flow.id);
        if (snapshot.expiresAt != null) {
            const expiry = Date.parse(snapshot.expiresAt);
            if (Number.isFinite(expiry))
                runtime.expiresAt = runtime.expiresAt === undefined ? expiry : Math.min(runtime.expiresAt, expiry);
        }
        if (snapshot.status === 'expired' || runtime.expiresAt !== undefined && runtime.expiresAt <= Date.now()) {
            this.fail(flow, 'The original snapshot expired. Export the Work again explicitly.');
            return false;
        }
        if (snapshot.status === 'failed' || snapshot.status === 'unavailable') {
            this.fail(flow, 'The original snapshot is unavailable. Export the Work again explicitly.');
            return false;
        }
        if (snapshot.status !== 'verified') {
            flow.phase = 'snapshot';
            return false;
        }
        if (typeof snapshot.packageSize !== 'number' || !Number.isFinite(snapshot.packageSize) || snapshot.packageSize < 0 || !snapshot.digest || runtime.expiresAt === undefined) {
            this.fail(flow, 'The original snapshot has no complete verified package metadata.');
            return false;
        }
        return true;
    }
    acceptTransfer(flow, transfer, generation) {
        if (transfer.transferId !== flow.transferId || transfer.snapshotId !== flow.snapshotId || transfer.workId !== flow.workId) {
            this.fail(flow, 'The download transfer does not match the original snapshot and transfer ID.');
            return;
        }
        if (transfer.terminalFailure) {
            this.fail(flow, transfer.error || 'The original download preparation failed. Retry this snapshot explicitly.');
            return;
        }
        if (!transfer.ready) {
            flow.phase = transfer.error && !transfer.pending ? 'unknown' : 'preparing';
            flow.error = transfer.observationError || transfer.error || '';
            return;
        }
        const snapshot = this.port.getSnapshot(flow.snapshotId);
        if (!snapshot || !this.validSnapshotIdentity(flow, snapshot) || !this.available(flow, snapshot))
            return;
        flow.contentURL = `/_desktop/api/downloads/${encodeURIComponent(flow.transferId)}/content`;
        flow.phase = 'ready';
        flow.error = '';
        if (!this.canAdvance(flow, generation) || flow.autoDeliveryConsumed)
            return;
        flow.autoDeliveryConsumed = true;
        flow.phase = 'delivered';
        try {
            this.options.deliver(flow, flow.contentURL);
        }
        catch (error) {
            flow.error = `Use Save file to download this verified transfer again. ${message(error)}`;
        }
        this.changed();
    }
    deliverLateReady(flow) {
        const runtime = this.runtime.get(flow.id);
        if (!this.live(flow) || flow.terminal || runtime.reading !== 'transfer' || runtime.validatedGeneration !== runtime.generation ||
            runtime.validatedSnapshot !== flow.snapshotId || runtime.validatedOperation !== flow.exportOperationId || !this.canAdvance(flow, runtime.generation))
            return;
        const transfer = flow.snapshotId && this.port.downloads.get(flow.snapshotId);
        if (transfer && (transfer.ready || transfer.terminalFailure))
            this.acceptTransfer(flow, transfer, runtime.generation);
    }
}
//# sourceMappingURL=export-flow.js.map