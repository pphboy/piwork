import { ConsoleError } from './adapter.js';
import { LocalizedMessage } from './locale.js';
/** A successful session read resolves presentation, not a credential write or another task's lock. */
export function retireConfirmedLoginFailure(original, receipt, owners) {
    const record = original.record;
    if (record.kind !== 'identity' || record.key !== 'login'
        || !['RESULT_UNKNOWN', 'INVALID_RESPONSE'].includes(record.errorCode || '')
        || !owners.current(record))
        return false;
    if (receipt.authenticated && receipt.account !== original.account)
        return false;
    owners.retire(record);
    owners.resolve(original.notice);
    return true;
}
/** Preserve uncertain transport outcomes; only known failures use the existing failed copy. */
export function signOutFailure(error) {
    if (error instanceof ConsoleError && ['RESULT_UNKNOWN', 'INVALID_RESPONSE'].includes(error.code))
        return error;
    return new ConsoleError('SIGNOUT_FAILED', new LocalizedMessage('login.signOutFailed'));
}
/** Supersede only this feature's signed-out guidance after a confirmed new session. */
export function retireLoginReadbackInfo(owner, receipt, resolve) {
    if (!owner || !receipt.authenticated || !receipt.account)
        return false;
    resolve(owner);
    return true;
}
/** A newer successful sign-in supersedes the same account's earlier admission failure. */
export function retirePreviousLoginFailure(original, receipt, resolve) {
    if (!original || original.record.kind !== 'identity' || original.record.key !== 'login'
        || !receipt.authenticated || receipt.account !== original.account
        || receipt.identity !== original.notice.identity)
        return false;
    resolve(original.notice);
    return true;
}
//# sourceMappingURL=login-feedback.js.map