/** Readiness, not a Work or optional-helper status, controls this gate. */
export function coreAdmission(status, admitted, held, checking, error, paused) {
    let phase;
    const value = status.readiness?.value;
    if (paused)
        phase = 'paused';
    else if (error)
        phase = 'unconfirmed';
    else if (status.health?.available === false)
        phase = 'unreachable';
    else if (status.health?.available && status.readiness?.available && value?.ready === true)
        phase = 'ready';
    else if (status.health?.available && status.readiness?.available && value?.state === 'RECOVERING')
        phase = 'recovering';
    else if (['ADMIN_REQUIRED', 'RUNTIME_NOT_CONFIGURED'].includes(value?.state))
        phase = 'unconfigured';
    else if (value?.state === 'RUNTIME_UNAVAILABLE' || value?.ready === false && status.readiness?.available)
        phase = 'failed';
    else
        phase = checking || !status.health ? 'checking' : 'unconfirmed';
    return { phase, blocked: !admitted || held };
}
//# sourceMappingURL=core-admission.js.map