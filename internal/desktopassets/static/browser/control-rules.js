/** Use the decoded workspace path; literal percent text is part of the name. */
export function renameField(path, directory) {
    const withoutTrailingSlash = path.replace(/\/+$/, '');
    const value = withoutTrailingSlash.slice(withoutTrailingSlash.lastIndexOf('/') + 1);
    const extension = value.lastIndexOf('.');
    return { value, selectionStart: 0, selectionEnd: !directory && extension > 0 ? extension : value.length };
}
/** Match name trimming and the existing workspace path restrictions, without URL decoding. */
export function validLocalName(name) {
    const value = name.trim();
    return !!value && value !== '.' && value !== '..' && !/[\\/\x00-\x1f\x7f]/.test(value);
}
/** The caller must use the current dialog's button and the existing action admission path. */
export function canSubmitName(context) {
    return (context.modal === 'new-folder' || context.modal === 'file-transfer' && context.transfer === 'rename') &&
        context.targetId === 'form-name' && context.key === 'Enter' && context.keyCode !== 229 &&
        !context.composing && !context.isComposing && context.enabled && !context.busy && !context.blocked &&
        !context.overwrite && validLocalName(context.name);
}
/** Unknown or newly added modal names are deliberately ineligible. Recheck at pointerup. */
export function canDismissLightModal(context) {
    if (context.modal === 'account')
        return true; // No local editor or submit action belongs to this menu.
    return (context.modal === 'work-menu' || context.modal === 'service-menu' || context.modal === 'work-info') &&
        !context.busy && !context.dirty && !context.unknown;
}
/** Edges count as inside. Invalid/empty geometry must never qualify for dismissal. */
export function pointOutsideDialog(point, rect) {
    return [point.x, point.y, rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) &&
        rect.right > rect.left && rect.bottom > rect.top &&
        (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom);
}
/** Only a live, positively known active request can admit a new cancel action. */
export function canCancelPiRequest(request, usable) {
    return usable && request?.disposition === 'live' &&
        ['pending', 'running', 'waiting_result', 'waiting_apply'].includes(request.state || '');
}
/** A modal follows its target's in-flight/unknown action even after route navigation. */
export function modalActionRelevant(record, route, targetWork) {
    return record.view === route || !!targetWork && record.work === targetWork;
}
//# sourceMappingURL=control-rules.js.map