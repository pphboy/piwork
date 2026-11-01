export class PageReadState {
    scope = null;
    state = { status: 'loading' };
    matches(scope) {
        return this.scope?.path === scope.path && this.scope.view === scope.view
            && this.scope.identity === scope.identity;
    }
    begin(scope) {
        if (this.matches(scope))
            return;
        this.scope = { ...scope };
        this.state = { status: 'loading' };
    }
    confirm(scope, confirmedAt) {
        if (this.matches(scope))
            this.state = { status: 'confirmed', confirmedAt };
    }
    fail(scope, error) {
        if (this.matches(scope) && this.state.status !== 'confirmed') {
            this.state = { status: 'unavailable', error };
        }
    }
    snapshot(scope) {
        return this.matches(scope) ? this.state : null;
    }
}
//# sourceMappingURL=page-read-state.js.map