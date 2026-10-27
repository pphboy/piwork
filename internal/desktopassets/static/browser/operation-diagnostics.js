const objectValue = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
const textValue = (value) => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !value.includes('\0') ? value : undefined;
const idValue = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value) ? value : undefined;
// Only these server codes state a concrete condition. A code for a failed
// stage, by itself, does not explain why that stage failed.
const specificCauseCodes = new Set([
    'CONTEXT_NOT_FOUND', 'CONTEXT_FORMAT_UNSUPPORTED', 'SKILL_VALIDATION_FAILED', 'SKILL_DIRECTORY_MISMATCH',
    'AGENT_CONTEXT_INCOMPATIBLE', 'AGENT_CONTEXT_MISMATCH', 'WORK_BUSY', 'INVALID_SERVICE_DEFINITION',
    'UNSUPPORTED_SERVICE_OPTION', 'SERVICE_FORMAT_UNSUPPORTED', 'MOUNT_DENIED', 'QUOTA_EXCEEDED',
    'DOCKER_UNAVAILABLE', 'PACKAGE_INCOMPATIBLE', 'TARGET_MODEL_UNAVAILABLE',
]);
const symptomCodes = new Set([
    'CONTEXT_COPY_FAILED', 'SKILL_LOAD_FAILED', 'PACKAGE_LOAD_FAILED', 'MCP_INITIALIZATION_FAILED',
    'RUNTIME_PREPARE_FAILED', 'RUNTIME_START_FAILED', 'AGENT_EXITED', 'AGENT_READINESS_TIMEOUT',
    'ROLLBACK_FAILED', 'DIAGNOSTIC_COLLECTION_FAILED', 'DIAGNOSTIC_PERSIST_FAILED', 'HISTORY_BACKUP_CLEANUP_REQUIRED',
    'IMAGE_UNAVAILABLE', 'SERVICE_START_FAILED', 'SERVICE_EXITED', 'SERVICE_INSTANCE_MISSING',
    'SERVICE_STATE_UNCONFIRMED', 'SERVICE_READINESS_TIMEOUT', 'WORK_OPERATION_FAILED',
]);
/** Unknown future codes do not establish whether a deeper cause was recorded. */
export function operationCauseStatus(diagnostic) {
    if (!diagnostic?.message || !diagnostic.code)
        return 'missing';
    if (specificCauseCodes.has(diagnostic.code))
        return 'recorded';
    if (symptomCodes.has(diagnostic.code))
        return 'missing';
    return 'unconfirmed';
}
/** Copy only typed public fields; unknown properties never enter the UI model. */
export function operationDiagnostic(raw) {
    const value = objectValue(raw);
    if (!value)
        return undefined;
    const result = {};
    for (const key of ['code', 'stage', 'correlationId', 'serviceId', 'skillName', 'field']) {
        const item = idValue(value[key]);
        if (item)
            result[key] = item;
    }
    for (const key of ['message', 'remediation']) {
        const item = textValue(value[key]);
        if (item)
            result[key] = item;
    }
    if (typeof value.retryable === 'boolean')
        result.retryable = value.retryable;
    if (typeof value.exitCode === 'number' && Number.isSafeInteger(value.exitCode))
        result.exitCode = value.exitCode;
    return Object.keys(result).length ? result : undefined;
}
export function operationDiagnostics(raw) {
    const value = objectValue(raw);
    if (!value)
        return undefined;
    const stages = [];
    if (Array.isArray(value.stages))
        for (const rawStage of value.stages.slice(0, 64)) {
            const stage = objectValue(rawStage);
            if (!stage)
                continue;
            const item = {};
            for (const key of ['component', 'stage', 'outcome', 'code', 'serviceId', 'skillName']) {
                const text = idValue(stage[key]);
                if (text)
                    item[key] = text;
            }
            for (const key of ['timestamp', 'message']) {
                const text = textValue(stage[key]);
                if (text)
                    item[key] = text;
            }
            if (Object.keys(item).length)
                stages.push(item);
        }
    const result = { stages };
    if (typeof value.truncated === 'boolean')
        result.truncated = value.truncated;
    const rollback = objectValue(value.rollback);
    if (rollback) {
        const state = idValue(rollback.state), error = operationDiagnostic(rollback.error);
        if (state || error)
            result.rollback = { ...(state ? { state } : {}), ...(error ? { error } : {}) };
    }
    const collection = objectValue(value.diagnosticCollection);
    if (collection) {
        const state = idValue(collection.state), code = idValue(collection.code);
        if (state || code)
            result.diagnosticCollection = { ...(state ? { state } : {}), ...(code ? { code } : {}) };
    }
    return stages.length || result.truncated !== undefined || result.rollback || result.diagnosticCollection ? result : undefined;
}
export function operationCorrelationId(value) { return idValue(value); }
export function legacyOperationError(value) { return textValue(value); }
//# sourceMappingURL=operation-diagnostics.js.map